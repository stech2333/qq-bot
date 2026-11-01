import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';

const KEY = 'group:123456', BOT = '123456789', TOKEN = 'react-fixture-token';

// SnowLuma 真实提供 set_msg_emoji_like { message_id, emoji_id, set }，只支持群聊。
// 这里验证桥接这一层：权限、可见性、频率、以及真的把动作发给了网关。
async function fixture(t, { react = true } = {}) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({
    config: { consolePort: 3106, consoleToken: TOKEN, ownerQQ: '987654321',
      allow: { groups: ['123456'], private: ['987654321'] }, bigfatfish: { expectedQQ: BOT },
      socialV2: { sticker: { enabled: false }, tools: { react } } },
    files: { 'state/current-role.json': { role: '角色', mode: 'active' }, 'roles/角色.md': '# 角色\n平时喜欢开玩笑。' },
    globals: { ...roleCard, http: { createServer(cb) { handler = cb; return server; } } }
  });
  t.after(() => h.close());
  h.setMode('reserved2'); h.setSelfIdentity('肥鱼', BOT); h.startConsoleServer();
  const call = async (route, body, token = h.getSocialV2State(KEY).agentToken) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { url: route, method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:3106',
      'content-type': 'application/json', 'x-console-token': TOKEN, 'x-agent-token': token } });
    let response; await handler(req, { writeHead() {}, on() {}, off() {}, end(raw) { response = JSON.parse(raw); } });
    return response;
  };
  const incoming = async (messageId, text) => h.handleIncoming('group', 123456, {
    self_id: BOT, user_id: '111111', message_id: messageId,
    message: [{ type: 'text', data: { text } }], sender: { nickname: '测试群友' } }, h.cfg);
  return { h, call, incoming };
}

test('react applies a real emoji reaction to a message visible in this conversation', async t => {
  const { h, call, incoming } = await fixture(t);
  await incoming('201', '肥鱼在吗');
  const response = await call('/api/socialV2/react', { key: KEY, messageId: '201', emojiId: '128077' });
  assert.equal(response.ok, true, response.error);
  const calls = h.calls.http.filter(c => /\/set_msg_emoji_like$/.test(c.url));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { message_id: 201, emoji_id: '128077', set: true });
});

test('react refuses messages the conversation cannot see, private chats and unknown formats', async t => {
  const { h, call, incoming } = await fixture(t);
  await incoming('201', '肥鱼在吗');
  const unknown = await call('/api/socialV2/react', { key: KEY, messageId: '999999', emojiId: '128077' });
  assert.equal(unknown.ok, false); assert.match(unknown.error, /可见范围/);
  const priv = await call('/api/socialV2/react', { key: 'private:987654321', messageId: '201', emojiId: '128077' },
    h.getSocialV2State('private:987654321').agentToken);
  assert.equal(priv.ok, false); assert.match(priv.error, /只支持群聊/);
  const badEmoji = await call('/api/socialV2/react', { key: KEY, messageId: '201', emojiId: '👍' });
  assert.equal(badEmoji.ok, false); assert.match(badEmoji.error, /数字表情 ID/);
  assert.equal(h.calls.http.filter(c => /\/set_msg_emoji_like$/.test(c.url)).length, 0);
});

test('react stays off until the admin enables socialV2.tools.react', async t => {
  const { h, call, incoming } = await fixture(t, { react: false });
  await incoming('201', '肥鱼在吗');
  const response = await call('/api/socialV2/react', { key: KEY, messageId: '201', emojiId: '128077' });
  assert.equal(response.ok, false); assert.match(response.error, /未启用/);
  assert.equal(h.calls.http.filter(c => /\/set_msg_emoji_like$/.test(c.url)).length, 0);
});

test('an inbound reaction notice is recorded as a readable event without waking the model', async t => {
  const { h } = await fixture(t);
  await h.handleIncoming('group', 123456, { self_id: BOT, user_id: '111111', message_id: '201',
    message: [{ type: 'text', data: { text: '肥鱼在吗' } }], sender: { nickname: '测试群友' } }, h.cfg);
  const before = h.getSocialV2State(KEY).recentMessages.length;
  h.recordReactionNotice({ post_type: 'notice', notice_type: 'group_msg_emoji_like', sub_type: 'add',
    group_id: 123456, user_id: '111111', message_id: 201, likes: [{ emoji_id: '128077', count: 1 }] });
  const st = h.getSocialV2State(KEY);
  assert.equal(st.recentMessages.length, before + 1);
  const line = st.recentMessages.at(-1);
  assert.equal(line.kind, 'reaction');
  assert.match(line.text, /emojiId=128077/);
  assert.equal(line.reaction.added, true);
});
