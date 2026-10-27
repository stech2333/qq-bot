import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish, normalizeState, validateSettings } from './runtime.mjs';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('bff-')); fs.rmSync(root, { recursive: true, force: true }); });
  const config = { bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321', allow: { groups: ['123456'], private: ['987654321'] }, deny: { groups: [], private: [] } };
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  const app = new BigFatFish(root, config), state = { unread: [], recentMessages: [], lastIncomingAt: Date.parse('2026-10-23T02:00:00Z'), activeTopics: [], pendingThoughts: [], memberImpressions: {} };
  app.bind('group:123456', state); return { app, state, config, root };
}

test('global delivery preference validates, persists and immediately reaches casual and formal response contexts', async t => {
  const { app, state, config, root } = fixture(t);
  assert.equal(app.settings.replyDelivery, 'natural'); assert.throws(() => validateSettings({ replyDelivery: 'two' }), /分条/);
  const before = JSON.stringify(state.bigfatfish);
  for (const [replyDelivery, label] of [['single', '尽量一条'], ['flow', '适度分条'], ['natural', '自然分条']]) {
    let response;
    await app.handle({ method: 'POST', headers: {} }, new URL('http://localhost/api/bigfatfish/settings'), async () => ({ replyDelivery }), value => { response = value; }, {});
    assert.equal(response.ok, true); assert.equal(new BigFatFish(root, config).settings.replyDelivery, replyDelivery);
    assert.match(app.responseContext('group:123456', state).instruction, new RegExp(label));
    state.unread = [{ messageId: 'delivery-at', isSelf: false }]; state.bigfatfish.assistantMessageIds = ['delivery-at'];
    assert.match(app.responseContext('group:123456', state).instruction, /正式回答要求/);
    assert.match(app.responseContext('group:123456', state).instruction, new RegExp(label));
    state.unread = []; state.bigfatfish.assistantMessageIds = []; app.responseMode('group:123456', state);
  }
  assert.equal(JSON.stringify(state.bigfatfish), before);
});
test('real mention, self echo and repeated delivery are distinguished', t => {
  const { app, state } = fixture(t);
  assert.equal(app.inbound('group:123456', { self_id: '123456789', user_id: '987654321', message_id: '1', message: [{ type: 'text', data: { text: '@机器人' } }] }), true);
  assert.equal(state.bigfatfish.mode, 'CASUAL');
  assert.equal(app.inbound('group:123456', { self_id: '123456789', user_id: '987654321', message_id: '2', message: [{ type: 'at', data: { qq: '123456789' } }] }), true);
  assert.equal(state.bigfatfish.mode, 'ASSISTANT');
  assert.equal(app.inbound('group:123456', { self_id: '123456789', user_id: '987654321', message_id: '2' }), false);
  assert.equal(app.inbound('group:123456', { self_id: '123456789', user_id: '123456789' }), false);
  assert.equal(app.inbound('group:123456', { self_id: '111111111', user_id: '987654321' }), false);
});

test('an unread real mention keeps detailed mode across an unrelated message and clears after acknowledgement', t => {
  const { app, state } = fixture(t), key = 'group:123456';
  const mention = { self_id: '123456789', user_id: '987654321', message_id: 'detail', message: [{ type: 'at', data: { qq: '123456789' } }] };
  app.inbound(key, mention); state.unread.push({ messageId: 'detail', seq: 1 });
  app.inbound(key, { ...mention, user_id: '111111', message_id: 'ambient', message: [{ type: 'text', data: { text: '今天吃什么' } }] });
  state.unread.push({ messageId: 'ambient', seq: 2 });
  assert.match(app.instruction(key, state), /当前模式 ASSISTANT/);
  state.bigfatfish = normalizeState(JSON.parse(JSON.stringify(state.bigfatfish)));
  assert.match(app.instruction(key, state), /当前模式 ASSISTANT/, 'restart must preserve the pending real mention');
  state.unread = state.unread.filter(m => m.messageId !== 'detail');
  assert.match(app.instruction(key, state), /当前模式 CASUAL/);
  app.bind('private:987654321', state); app.settings.privateAssistant = true;
  assert.match(app.instruction('private:987654321', state), /当前模式 CASUAL/, 'legacy privateAssistant must not bypass the real-at requirement');
  app.settings.privateAssistant = false;
  assert.match(app.instruction('private:987654321', state), /当前模式 CASUAL/);
});
test('cold-start limits use Shanghai time and successful sends only', t => {
  const { app, state } = fixture(t); app.settings.coldStart.dryRun = false;
  const now = Date.parse('2026-10-23T04:00:00Z');
  assert.equal(app.coldGate(state, now), '');
  assert.equal(app.coldGate(state, Date.parse('2026-10-23T16:00:00Z')), '静默时段');
  assert.equal(state.bigfatfish.coldCount, 0);
  state.bffColdRound = true; app.sent('group:123456'); app.sent('group:123456');
  assert.equal(state.bigfatfish.coldCount, 1);
});
test('access enable/disable persists without changing membership', t => {
  const { app, config, root } = fixture(t);
  app.setAccess('group', '456789', true); assert.ok(config.allow.groups.includes('456789'));
  app.setAccess('group', '456789', false); assert.ok(config.deny.groups.includes('456789'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'config.json'))).deny.groups.includes('456789'));
  assert.throws(() => app.setAccess('group', '../1', true));
});
test('ordinary senders cannot issue account commands or requests from another bot', async t => {
  const { app } = fixture(t); let count = 0;
  const denied = await app.adminCommand('private', { user_id: '111111111' }, '/qq group enable 123456', () => count++);
  assert.match(denied, /仅管理员/); assert.equal(count, 0);
  app.recordRequest({ post_type: 'request', request_type: 'friend', self_id: '000000000', user_id: '111111111', flag: 'flag' });
  assert.equal(app.requestList().length, 0);
});
test('only captured requests can be approved; private flags stay server-side', async t => {
  const { app } = fixture(t);
  app.recordRequest({ post_type: 'request', request_type: 'group', sub_type: 'invite', self_id: '123456789', user_id: '111111111', group_id: '123456', flag: 'private-flag' });
  const record = app.requestList()[0]; assert.equal(record.flag, undefined);
  let call; await app.accountAction({ requestId: record.id, approve: true }, async (...args) => { call = args; });
  assert.equal(call[0], 'set_group_add_request'); assert.equal(call[1].flag, 'private-flag');
  await assert.rejects(() => app.accountAction({ requestId: record.id, approve: true }, async () => {}));
  await assert.rejects(() => app.accountAction({ action: 'addFriend' }, async () => {}), /未提供/);
});
test('agent cannot access admin management endpoints', async t => {
  const { app } = fixture(t); let result;
  await app.handle({ method: 'POST', headers: { 'x-agent-token': 'model' } }, new URL('http://localhost/api/bigfatfish/access'), async () => ({}), (body, status) => { result = status; }, {});
  assert.equal(result, 403);
});
test('memory isolation denies a valid token from a different conversation', async t => {
  const { app } = fixture(t); let result;
  await app.handle({ method: 'GET', headers: { 'x-agent-token': 'other-session' } }, new URL('http://localhost/api/socialV2/memory?key=group:123456'), async () => ({}), (body, status) => { result = status; }, { agentTokenOk: () => false });
  assert.equal(result, 403);
});
test('casual length is advisory; content, privacy and silence handling are preserved', t => {
  const { app } = fixture(t);
  assert.deepEqual(app.prepareMessages('group:123456', ['[IGNORE]']), []);
  const texts = app.prepareMessages('group:123456', ['鱼'.repeat(30), '鲸'.repeat(30)]);
  assert.deepEqual(texts, ['鱼'.repeat(30), '鲸'.repeat(30)]);
  assert.throws(() => app.prepareMessages('group:123456', ['C:\\private\\secret.txt']));
});
test('invalid settings and missing independent voice fail explicitly', async t => {
  const { app } = fixture(t); assert.throws(() => validateSettings({ casualMaxChars: -1 }));
  assert.equal(app.voiceStatus().installed, false); await assert.rejects(() => app.openVoice(), /未安装/);
  assert.equal(normalizeState({ facts: Array(500).fill({ text: 'a' }) }).facts.length, 200);
});
test('long-term memory is deduplicated, persisted in state and bound to its source', async t => {
  const { app, state } = fixture(t); let result, saves = 0;
  state.recentMessages.push({ messageId: '10', userId: '987654321', plain: '我喜欢喝茶', isSelf: false });
  const hooks = { state: () => state, save: () => saves++, format: st => app.formatMemory(st), agentTokenOk: () => true, allowed: () => true, memoryEnabled: () => true };
  const request = { method: 'POST', headers: { 'x-agent-token': 'valid' } }, url = new URL('http://localhost/api/socialV2/memory-append');
  const body = { key: 'group:123456', category: 'longTerm', content: '喜欢喝茶', extra: { sourceMessageId: '10' } };
  for (let i = 0; i < 2; i++) await app.handle(request, url, async () => body, value => { result = value; }, hooks);
  assert.equal(result.ok, true); assert.equal(state.bigfatfish.facts.length, 1); assert.equal(state.bigfatfish.facts[0].source.userId, '987654321');
  assert.equal(normalizeState(JSON.parse(JSON.stringify(state.bigfatfish))).facts[0].text, '喜欢喝茶'); assert.equal(saves, 2);
});
test('legacy migration requires an explicit enabled destination and prevents repeated copying', t => {
  const { app, state } = fixture(t);
  app.legacy = { tables: { summaries: [{ data: { record: { peerKey: 'legacy-1', summary: '喜欢讨论人工智能。' } } }] }, bound: {} };
  assert.throws(() => app.importLegacy('legacy-1', 'group:123456', { allowed: () => false }));
  app.importLegacy('legacy-1', 'group:123456', { allowed: () => true, state: () => state, save() {} });
  assert.equal(state.bigfatfish.summary, '喜欢讨论人工智能。');
  assert.throws(() => app.importLegacy('legacy-1', 'group:123456', { allowed: () => true }));
});
