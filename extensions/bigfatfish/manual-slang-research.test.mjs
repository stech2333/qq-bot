import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BigFatFish } from './runtime.mjs';
import { ManualSlangResearch } from './manual-slang-research.mjs';
import { createSlangEntry, saveSlang, loadSlang } from '../../integrations/qq-bridge/src/slang-learner.js';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
const words = job => [...job.prompt.matchAll(/^\d+\. ([^（\n]+)/gm)].map(m => m[1]);
const output = job => JSON.stringify(words(job).map(content => ({ content, confirmed: true, confidence: 0.95, meaning: '已核实的网络用语含义', reason: '网络用法明确', risk: '无', sources: ['https://example.com/slang'] })));
function fixture(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-manual-slang-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = new BigFatFish(root, { allow: { groups: [], private: [] }, deny: { groups: [], private: [] }, bigfatfish: { expectedQQ: '123456789' }, slang: { enabled: true } });
  let entries = Array.from({ length: count }, (_, i) => createSlangEntry({ content: '词语' + i, status: 'candidate' })); const file = path.join(root, 'slang.json');
  const store = { entries: () => entries, writable: () => true, save() { saveSlang(file, entries); entries = loadSlang(file); return true; } };
  app.research.connect(async job => { await job.onStart?.(); job.onStage?.('收取研究结果'); return output(job); }, () => true);
  return { app, root, store, entry: () => entries[0] };
}

test('manual research reserves the selected words once, splits batches and persists visible results', async t => {
  const f = fixture(t, 6), manager = f.app.slang.manual; let calls = 0;
  f.app.research.connect(async job => { calls++; assert.ok(words(job).length <= 5); assert.equal(job.timeoutMs, 300000); await job.onStart?.(); job.onStage?.('模型返回'); return output(job); }, () => true);
  const first = manager.queue(f.store.entries(), f.store); assert.equal(first.count, 6); assert.ok(first.jobId);
  assert.equal(manager.queue(f.store.entries(), f.store).count, 0);
  await manager.chain;
  assert.equal(calls, 2); assert.equal(manager.snapshot()[0].done, 6); assert.equal(manager.snapshot()[0].approved, 6);
  assert.equal(manager.snapshot()[0].returns.length, 2); assert.equal(f.entry().research.status, 'approved'); assert.equal(f.entry().research.result.meaning, f.entry().meaning);
  assert.equal(manager.snapshot()[0].results.length, 6);
  assert.deepEqual(f.entry().research.result.sources, ['https://example.com/slang']);
  assert.equal(f.entry().status, 'candidate', 'research does not bypass original admission policy');
  assert.equal(new ManualSlangResearch(f.app).snapshot()[0].status, 'completed');
});

test('pending manual review suspends promotion of an older definition until the new result arrives', async t => {
  const f = fixture(t), now = Date.now(); f.app.config.allow.groups.push('123456'); f.app.settings.slangPolicy.autoConfirm = true;
  f.app.bind('group:123456', { recentMessages: Array.from({ length: 6 }, (_, i) => ({ messageId: String(i), userId: i % 2 ? '111111' : '222222', time: now - (i + 1) * 600000, plain: '词语0继续讨论' })) });
  f.entry().meaning = '此前研究的释义'; f.entry().lastInferenceCount = 1; f.entry().research = { status: 'approved' }; f.store.save();
  f.app.slang.manual.queue(f.store.entries(), f.store); f.app.slang.scan(f.store, { force: true });
  assert.equal(f.entry().status, 'candidate'); await f.app.slang.manual.chain;
  assert.equal(f.entry().status, 'confirmed');
});

test('uncertain model replies remain available to inspect without becoming a definition', async t => {
  const f = fixture(t); f.app.research.connect(async job => JSON.stringify([{ content: words(job)[0], confirmed: false, confidence: 0.5, meaning: '可能是临时说法', reason: '缺少可靠来源' }]), () => true);
  f.app.slang.manual.queue(f.store.entries(), f.store); await f.app.slang.manual.chain;
  assert.equal(f.entry().meaning, ''); assert.equal(f.entry().research.status, 'rejected'); assert.equal(f.entry().research.result.meaning, '可能是临时说法');
  assert.equal(f.app.slang.manual.snapshot()[0].uncertain, 1);
});

test('public references remain visible while local and credential-bearing links are excluded', t => {
  const f = fixture(t), manager = f.app.slang.manual;
  assert.equal(manager.publicUrl('https://fda.gov/news'), 'https://fda.gov/news');
  assert.equal(manager.publicUrl('http://127.0.0.1:3106/'), ''); assert.equal(manager.publicUrl('https://example.com/?token=secret'), '');
  assert.match(manager.preview('[{"sources":["https://example.com/slang"]}]'), /https:\/\/example/);
});

test('timeouts and malformed replies are visible failures, never a successful zero-result job', async t => {
  for (const runner of [async () => { throw Error('语料研究失败：收取研究结果（等待结果超时）'); }, async () => '没有可用的JSON结果']) {
    const f = fixture(t); f.app.research.connect(runner, () => true); f.app.slang.manual.queue(f.store.entries(), f.store); await f.app.slang.manual.chain;
    assert.equal(f.app.slang.manual.snapshot()[0].status, 'failed'); assert.equal(f.entry().research.status, 'failed'); assert.equal(f.entry().meaning, '');
    assert.ok(f.entry().research.reason); assert.equal(f.app.slang.manual.snapshot()[0].failed, 1);
  }
});

test('human changes during model work are never overwritten by a late result', async t => {
  const f = fixture(t); let release, signal; const started = new Promise(resolve => { signal = resolve; });
  f.app.research.connect(async job => { await job.onStart(); signal(); await new Promise(resolve => { release = resolve; }); return output(job); }, () => true);
  f.app.slang.manual.queue(f.store.entries(), f.store); await started;
  f.entry().meaning = '人工修改的释义'; f.entry().updatedAt = 'edited-during-study'; f.store.save(); release(); await f.app.slang.manual.chain;
  assert.equal(f.entry().meaning, '人工修改的释义'); assert.equal(f.entry().research.status, 'failed'); assert.match(f.entry().research.reason, /已修改/);
});

test('restart recovery reports interrupted work and clears stuck researching flags', async t => {
  const f = fixture(t); let signal; const started = new Promise(resolve => { signal = resolve; });
  f.app.research.connect(async job => { await job.onStart(); signal(); return new Promise(() => {}); }, () => true);
  f.app.slang.manual.queue(f.store.entries(), f.store); await started;
  const recovered = new ManualSlangResearch(f.app); recovered.recover(f.store);
  assert.equal(recovered.snapshot()[0].status, 'interrupted'); assert.equal(f.entry().research.status, 'failed'); assert.match(f.entry().research.reason, /重启中断/);
});

test('a failed store write cannot report an approved result or overwrite definitions', async t => {
  const f = fixture(t); let writes = 0; const save = f.store.save;
  f.store.save = () => ++writes === 2 ? false : save();
  f.app.slang.manual.queue(f.store.entries(), f.store); await f.app.slang.manual.chain;
  assert.equal(f.entry().meaning, ''); assert.equal(f.entry().research.status, 'failed'); assert.equal(f.app.slang.manual.snapshot()[0].approved, 0);
});

test('native research API exposes job results and immediately rejects offline DSH', async t => {
  let handler; const server = { address: () => ({ port: 3106 }), listen(_port, _host, done) { done(); }, on() {} };
  const entry = createSlangEntry({ content: '摸鱼', status: 'candidate' });
  const h = await bridgeHarness({ config: { consolePort: 3106, slang: { enabled: true }, allow: { groups: ['123456'], private: [] } },
    files: { 'state/slang.json': [entry] }, globals: { http: { createServer(cb) { handler = cb; return server; } } } }); t.after(() => h.close()); h.startConsoleServer();
  const call = async (url, body) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []); Object.assign(req, { method: body ? 'POST' : 'GET', url, headers: { host: '127.0.0.1:3106', 'x-console-token': 'fixture-console-token', ...(body ? { 'content-type': 'application/json' } : {}) } });
    let data, status; await handler(req, { writeHead(code) { status = code; }, end(text) { data = JSON.parse(text); } }); return { ...data, httpStatus: status };
  };
  h.setReady(false); assert.equal((await call('/api/slang/research', { ids: [entry.id] })).httpStatus, 503);
  h.setReady(true); h.api.sessions.prompt = async params => {
    h.completeSlangTurn(params.sessionId, output({ prompt: params.content[0].text })); return { result: { ok: true, value: {} } };
  };
  const queued = await call('/api/slang/research', { ids: [entry.id] }); assert.equal(queued.ok, true); assert.equal(queued.count, 1); assert.ok(queued.jobId);
  await h.bff.slang.manual.chain;
  const data = await call('/api/slang'); assert.equal(data.researchJobs[0].done, 1); assert.equal(data.entries[0].research.status, 'approved');
  assert.ok(data.researchJobs[0].returns[0].text.includes('已核实'), JSON.stringify(data.researchJobs[0].returns)); assert.equal(h.calls.sent.length, 0);
});
