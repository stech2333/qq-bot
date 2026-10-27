import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import { PersonaManager } from './persona-manager.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';

const TOKEN = 'persona-fixture-admin-token';
async function fixture(t) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_port, _host, ready) { ready(); }, on() {} };
  const h = await bridgeHarness({ config: {
    consolePort: 3106, consoleToken: TOKEN, bigfatfish: { expectedQQ: '123456789' },
    allow: { groups: ['123456', '123457'], private: ['987654321'] }, socialV2: { sticker: { enabled: false } }
  }, files: {
    'roles/轻松.md': '# 轻松\n喜欢幽默和轻松表达。\n## 专用 〔一代〕\n一代特有标记\n## 专用 〔二代〕\n二代特有标记',
    'roles/认真.md': '# 认真\n回答严谨，解释清晰。',
    'state/current-role.json': { role: '轻松', mode: 'active' }
  }, globals: { ...roleCard, http: { createServer(callback) { handler = callback; return server; } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('大肥鱼', '123456789'); h.startConsoleServer();
  const call = async (url, body, headers = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method: body === undefined ? 'GET' : 'POST', headers: {
      host: '127.0.0.1:3106', 'x-console-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}), ...headers
    } });
    let status, data; const res = { writeHead(code) { status = code; }, end(text) { data = JSON.parse(text); } };
    await handler(req, res); return { status, ...data };
  };
  const bind = async (key, mode, role) => {
    const snapshot = await call('/api/bigfatfish/personas');
    return call('/api/bigfatfish/personas', { key, mode, role, revision: snapshot.revision });
  };
  const prompt = async key => { const result = await call('/api/socialV2/prompt?key=' + encodeURIComponent(key)); assert.equal(result.ok, true, result.error); return result; };
  return { h, call, bind, prompt };
}

test('different groups and private chats resolve their selected existing templates in real prompt APIs', async t => {
  const { h, bind, prompt } = await fixture(t);
  assert.equal((await bind('group:123456', 'template', '认真')).ok, true);
  assert.equal((await bind('private:987654321', 'template', '轻松')).ok, true);
  const group = await prompt('group:123456'), peer = await prompt('private:987654321');
  assert.equal(group.role.name, '认真'); assert.match(group.role.hint, /回答严谨/); assert.doesNotMatch(group.role.hint, /喜欢幽默/);
  assert.equal(peer.role.name, '轻松'); assert.match(peer.role.hint, /二代特有标记/); assert.doesNotMatch(peer.role.hint, /一代特有标记/);
  assert.match(h.buildWakePromptV2('group:123456', 'direct'), /【当前角色】认真/);
  assert.match(h.buildWakeReminderPromptV2('private:987654321'), /【当前角色】轻松/);
});

test('global default changes affect inherited chats while explicit choices and no-template stay independent', async t => {
  const { call, bind, prompt, h } = await fixture(t);
  await bind('group:123456', 'template', '轻松'); await bind('private:987654321', 'none');
  assert.equal((await call('/api/role', { role: '认真' })).ok, true);
  assert.equal((await prompt('group:123456')).role.name, '轻松');
  assert.equal((await prompt('group:123457')).role.name, '认真');
  assert.equal((await prompt('private:987654321')).role.name, null);
  assert.equal((await prompt('private:987654321')).role.hint, '');
  assert.match(h.buildWakePromptV2('private:987654321', 'direct'), /不使用人格模板/);
  await bind('group:123456', 'inherit'); assert.equal((await prompt('group:123456')).role.name, '认真');
});

test('renaming updates all bindings durably, deleting falls back to the current global default', async t => {
  const { h, call, bind, prompt } = await fixture(t);
  await bind('group:123456', 'template', '认真'); await bind('private:987654321', 'template', '认真');
  assert.equal((await call('/api/roles/rename', { from: '认真', to: '耐心' })).ok, true);
  assert.equal((await prompt('group:123456')).role.name, '耐心');
  const reloaded = new PersonaManager({ root: h.temp }); assert.equal(reloaded.data.bindings['private:987654321'], '耐心');
  assert.equal((await call('/api/roles/delete', { name: '耐心' })).ok, true);
  assert.equal((await prompt('private:987654321')).role.name, '轻松');
  assert.equal((await call('/api/bigfatfish/personas')).sessions.find(s => s.key === 'group:123456').mode, 'inherit');
});

test('missing templates, path traversal, unknown peers, stale saves and agent writes cannot change bindings', async t => {
  const { h, call, bind } = await fixture(t);
  for (const role of ['不存在', '../轻松', 'C:\\secret']) assert.equal((await bind('group:123456', 'template', role)).ok, false);
  assert.equal((await bind('group:7654321', 'template', '认真')).ok, false);
  await bind('group:123456', 'template', '认真');
  assert.equal((await call('/api/bigfatfish/personas', { key: 'group:123456', mode: 'none', revision: 0 })).ok, false);
  assert.equal((await call('/api/bigfatfish/personas', { key: 'group:123456', mode: 'none', revision: 1 }, { 'x-agent-token': 'model' })).status, 403);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.temp, 'state/bigfatfish-personas.json'))).bindings['group:123456'], '认真');
});

test('editing a selected native template refreshes prompt content without rebinding', async t => {
  const { call, bind, prompt } = await fixture(t); await bind('group:123456', 'template', '认真');
  await prompt('group:123456');
  await call('/api/roles/update', { name: '认真', content: '# 认真\n新的模板正文，强调清楚、准确和耐心。' });
  assert.match((await prompt('group:123456')).role.hint, /新的模板正文/);
});

test('native wake memory formatting prunes expired topics before the first prompt is serialized', async t => {
  const { h } = await fixture(t), key = 'group:123456', st = h.getSocialV2State(key);
  st.activeTopics.push({ text: '已经过期的旧话题标记', lastMentionAt: Date.now() - 3 * 86400000 }, { text: '仍在进行的新话题标记', lastMentionAt: Date.now() });
  const prompt = h.buildWakePromptV2(key, 'direct');
  assert.doesNotMatch(prompt, /已经过期的旧话题标记/); assert.match(prompt, /仍在进行的新话题标记/);
});

test('an externally removed template is visible as missing and falls back without erasing the assignment', async t => {
  const { h, bind, prompt, call } = await fixture(t); await bind('group:123456', 'template', '认真');
  fs.unlinkSync(path.join(h.temp, 'roles/认真.md'));
  assert.equal((await prompt('group:123456')).role.name, '轻松');
  const row = (await call('/api/bigfatfish/personas')).sessions.find(s => s.key === 'group:123456');
  assert.equal(row.missing, true); assert.equal(row.role, '认真');
});

test('binding persistence failure cannot rename or remove the native template', async t => {
  const { h } = await fixture(t), manager = new PersonaManager({ root: h.temp }); manager.file = h.temp;
  assert.throws(() => manager.rename('认真', '新名字'));
  assert.equal(fs.existsSync(path.join(h.temp, 'roles/认真.md')), true);
  assert.throws(() => manager.remove('认真'));
  assert.equal(fs.existsSync(path.join(h.temp, 'roles/认真.md')), true);
});

test('switching replaces the active model session, revokes its token and injects the new card without losing memory', async t => {
  const { h, bind, call } = await fixture(t), key = 'private:987654321';
  const oldSession = await h.ensureSession(key), other = await h.ensureSession('group:123457');
  const st = h.getSocialV2State(key), token = st.agentToken;
  st.bigfatfish.summary = '用户喜欢清楚解释'; st.bootstrapSent = true;
  st.recentMessages.push({ isSelf: false, text: '记住这件事', messageId: 'fixture-memory' });
  assert.match(h.buildWakePromptV2(key, 'private'), /喜欢幽默和轻松表达/);
  assert.equal((await bind(key, 'template', '认真')).ok, true);
  assert.equal(h.state.sessions[key], undefined);
  assert.equal(h.state.sessions['group:123457'], other);
  assert.notEqual(st.agentToken, token); assert.equal(st.bootstrapSent, false);
  assert.equal(st.bigfatfish.summary, '用户喜欢清楚解释'); assert.equal(st.recentMessages.at(-1).text, '记住这件事');
  assert.equal((await call('/api/socialV2/prompt?key=' + key, undefined, { 'x-agent-token': token })).status, 403);
  assert.notEqual(await h.ensureSession(key), oldSession); assert.ok(h.calls.cancelled.includes(oldSession));
  for (const prompt of [h.buildWakePromptV2(key, 'private'), h.buildWakeReminderPromptV2(key)]) {
    assert.match(prompt, /【当前角色卡】\n# 认真\n回答严谨，解释清晰。/);
    assert.doesNotMatch(prompt, /喜欢幽默和轻松表达/);
  }
});

test('editing active card resets only affected sessions and same-size same-mtime changes never reuse stale content', async t => {
  const { h, bind, call, prompt } = await fixture(t), key = 'group:123456';
  await bind(key, 'template', '认真');
  const oldSession = await h.ensureSession(key), other = await h.ensureSession('group:123457');
  await prompt(key);
  await call('/api/roles/update', { name: '认真', content: '# 认真\n回答耐心，解释明白。' });
  assert.equal(h.state.sessions[key], undefined); assert.equal(h.state.sessions['group:123457'], other);
  const nextSession = await h.ensureSession(key); assert.notEqual(nextSession, oldSession);
  const file = path.join(h.temp, 'roles/认真.md'), before = fs.statSync(file);
  await prompt(key);
  fs.writeFileSync(file, '# 认真\n回答温和，解释细致。'); fs.utimesSync(file, before.atime, before.mtime);
  assert.match((await prompt(key)).role.hint, /回答温和/);
  assert.notEqual(await h.ensureSession(key), nextSession);
});

test('system preset delegates identity to the selected card rather than a fixed whale persona', () => {
  const source = fs.readFileSync(new URL('../../integrations/qq-bridge/dsh/agent-presets/qq-chat-v2/agent.cordis.yml', import.meta.url), 'utf8');
  const installed = fs.readFileSync(new URL('../../integrations/qq-bridge/plugins/qq-agent-presets/presets/qq-chat-v2.patch.yml', import.meta.url), 'utf8');
  for (const text of [source, installed]) {
    assert.doesNotMatch(text, /你只代表 DeepSeek 的鲸鱼形象/);
    assert.match(text, /本轮【当前角色卡】取代历史中的旧人格/);
    assert.doesNotMatch(text, /You are a coding agent/);
    assert.match(text, /人物身份、态度、用词和说话节奏以本轮【当前角色卡】为准/);
  }
});

test('old persona self-introductions cannot re-enter wakes or model history tools, while the archive remains available', async t => {
  const { h, bind, call } = await fixture(t), key = 'private:987654321';
  const st = h.getSocialV2State(key);
  h.appendSocialV2Message(key, '真人', '你是谁', '你是谁', false, true, [], '100');
  st.recentMessages.push({ isSelf: true, sender: '我', text: '我是原来的大肥鱼', plain: '我是原来的大肥鱼', time: Date.now() });
  h.recordSentMessagesV2(key, ['我是轻松']);
  await bind(key, 'template', '认真');
  h.recordSentMessagesV2(key, ['我是认真，回答严谨']);
  const packet = h.buildWakeSnapshotV2(key);
  const view = JSON.stringify(packet);
  assert.doesNotMatch(view, /我是原来的大肥鱼|我是轻松/);
  assert.match(view, /我是认真/); assert.match(view, /你是谁/);
  for (const route of ['recent', 'my-recent']) {
    const response = await call('/api/socialV2/' + route + '?key=' + key, undefined, { 'x-agent-token': st.agentToken });
    assert.equal(response.ok, true, response.error);
    assert.doesNotMatch(JSON.stringify(response.messages), /我是原来的大肥鱼|我是轻松/);
    assert.match(JSON.stringify(response.messages), /我是认真/);
    const admin = await call('/api/socialV2/' + route + '?key=' + key);
    assert.match(JSON.stringify(admin.messages), /我是原来的大肥鱼/);
  }
  assert.equal(st.recentMessages.filter(m => m.isSelf).length, 3);
  const wake = h.buildWakePromptV2(key, 'private');
  assert.match(wake, /当前扮演的人物是「认真」/);
  assert.match(wake, /账号昵称不等于人物姓名/);
});
