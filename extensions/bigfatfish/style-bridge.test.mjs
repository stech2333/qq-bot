import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';
import { personaSectionText, installPersonaSection } from '../../integrations/qq-bridge/plugins/qq-agent-presets/qq-persona.mjs';
import { createSlangEntry, upsertSlangEntry, normalizeSlangEntry, saveSlang, loadSlang } from '../../integrations/qq-bridge/src/slang-learner.js';
import { fixture, A, B, P } from './style-test-fixture.mjs';

test('real bridge intake attests human sources, assembles once, publishes card to system only', async t => {
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] }, socialV2: { sticker: { enabled: false } } },
    files: { 'roles/鱼.md': '# 鱼\n稳定的人格核心，不冒充真人。', 'state/current-role.json': { role: '鱼', mode: 'active' } }, globals: roleCard });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('测试机器人', '123456789');
  await h.handleIncoming('group', 123456, { self_id: '123456789', user_id: '111111', message_id: 1001, sender: { nickname: '虚拟群友' }, message: [{ type: 'text', data: { text: '肥鱼，今天聊聊天' } }] }, h.cfg);
  const rows = h.bff.learningWindow.messages(A, h.getSocialV2State(A)); assert.equal(rows[0].styleSourceVersion, 2); assert.equal(rows[0].sourceScope, A);
  const preview = h.buildWakePromptV2(A, 'addressed'); assert.equal(preview.split('【本轮表达参考】').length - 1, 1); assert.equal(preview.split('【当前角色卡】').length - 1, 1);
  await h.deliverPrompt(A, preview); const sessionId = h.calls.created.at(-1)?.sessionId || h.state.sessions[A];
  const system = personaSectionText(sessionId, h.temp); assert.match(system, /稳定的人格核心/);
  const sent = JSON.stringify(h.calls.prompts.at(-1)); assert.doesNotMatch(sent, /稳定的人格核心/); assert.match(sent, /本轮表达参考/); assert.equal(h.calls.sent.length, 0);
  const sections = []; installPersonaSection({ systemPrompt: { section: value => sections.push(value) } }); assert.equal(sections[0].interpolate, false); assert.equal(sections[0].name, 'bigfatfish:trusted-persona');
});
test('group-specific same-term meanings remain separate and legacy lexicon is preserved pending review', t => {
  const f = fixture(t), entries = [];
  upsertSlangEntry(entries, '鱼塘', { scope: A, meaning: '本群游戏频道', status: 'confirmed' });
  upsertSlangEntry(entries, '鱼塘', { scope: B, meaning: '本群摄影讨论区', status: 'confirmed' });
  assert.equal(entries.length, 2); assert.equal(f.app.slang.contextEntries(entries, A)[0].meaning, '本群游戏频道'); assert.equal(f.app.slang.contextEntries(entries, B)[0].meaning, '本群摄影讨论区');
  assert.deepEqual(f.app.slang.contextEntries(entries, P), []); assert.deepEqual(f.app.slang.contextEntries(entries, A, 'help'), []);
  const legacy = normalizeSlangEntry({ id: 'legacy', content: '旧词', meaning: '原有释义', status: 'confirmed' }); assert.equal(legacy.scope, 'legacy'); assert.equal(f.app.slang.visible(legacy, A), false);
  const file = path.join(f.root, 'state/slang.json'); saveSlang(file, [...entries, legacy]); assert.equal(loadSlang(file).length, 3); assert.equal(loadSlang(file)[2].meaning, '原有释义');
  const publicTerm = createSlangEntry({ content: '通用词', meaning: '公开释义', status: 'confirmed', scope: 'public' }); assert.ok(f.app.slang.visible(publicTerm, P));
});
test('scoped slang endpoints deny other groups and agent writes to scope manager', async t => {
  let handler; const token = 'isolated-admin-token', server = { address: () => ({ port: 3106 }), listen(_p,_h,cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ config: { consolePort: 3106, consoleToken: token, bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456', '123457'], private: [] }, slang: { enabled: true } },
    files: { 'state/slang.json': [createSlangEntry({ content: '内梗', meaning: '本群含义', scope: A, status: 'confirmed' })] }, globals: { ...roleCard, http: { createServer(fn) { handler = fn; return server; } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.startConsoleServer();
  async function call(route, key, body) { const req = Readable.from(body ? [JSON.stringify(body)] : []); Object.assign(req, { method: body ? 'POST' : 'GET', url: route, headers: { host: '127.0.0.1:3106', 'x-console-token': token, 'content-type': 'application/json', 'x-agent-token': h.getSocialV2State(key).agentToken } }); let result; await handler(req, { writeHead() {}, end(data) { result = JSON.parse(data); } }); return result; }
  const own = await call('/api/socialV2/slang/query?key=' + A, A); assert.equal(own.ok, true, own.error); assert.equal(own.entries.length, 1);
  const other = await call('/api/socialV2/slang/query?key=' + B, B); assert.equal(other.entries.length, 0); assert.doesNotMatch(other.block, /本群含义/);
  assert.equal((await call('/api/bigfatfish/slang-scope', A, { id: 'x', scope: 'public', revision: 0 })).ok, false);
});
