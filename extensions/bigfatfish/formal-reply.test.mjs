import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';

const KEY = 'group:123456', BOT = '123456789', TOKEN = 'formal-fixture-token';
async function fixture(t) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ config: { consolePort: 3106, consoleToken: TOKEN, ownerQQ: '987654321',
    allow: { groups: ['123456'], private: ['987654321'] }, bigfatfish: { expectedQQ: BOT },
    socialV2: { sticker: { enabled: false }, wait: { minMs: 1, minQuietAfterNewMs: 1, defaultQuietMs: 1 } }
  }, files: { 'state/current-role.json': { role: '角色', mode: 'active' }, 'roles/角色.md': '# 角色\n平时喜欢开玩笑。' },
  globals: { ...roleCard, http: { createServer(cb) { handler = cb; return server; } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', BOT); h.startConsoleServer();
  const call = async (route, body) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { url: route, method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:3106', 'content-type': 'application/json',
      'x-console-token': TOKEN, 'x-agent-token': h.getSocialV2State(KEY).agentToken } });
    let response; await handler(req, { writeHead() {}, on() {}, off() {}, end(body) { response = JSON.parse(body); } }); return response;
  };
  const incoming = async (messageId, segments) => h.handleIncoming('group', 123456, { self_id: BOT, user_id: '111111', message_id: messageId,
    message: segments, sender: { nickname: '测试群友' } }, h.cfg);
  return { h, call, incoming };
}
const text = value => ({ type: 'text', data: { text: value } });
const at = qq => ({ type: 'at', data: { qq } });

test('a real platform at requires a full formal answer even after a later ordinary message is batched', async t => {
  const { h, call, incoming } = await fixture(t);
  await incoming('formal', [at(BOT), text('请解释多项式插值的原理')]);
  await incoming('casual', [text('再补充一下')]);
  const unread = await call('/api/socialV2/unread?key=' + KEY);
  assert.equal(unread.response.mode, 'ASSISTANT');
  assert.equal(unread.messages[0].replyStyle, 'formal');
  assert.match(unread.response.instruction, /正式回答要求.*先给结论/);
  assert.match(unread.response.instruction, /不受闲聊25字目标限制/);
  assert.deepEqual(unread.response.messageIds, ['formal']);
  assert.match(unread.response.instruction, /不扩大到同批普通话题或未@的后续聊天/);
  const prompt = h.buildWakePromptV2(KEY, 'addressed');
  assert.ok(prompt.indexOf('【正式回答要求】', prompt.indexOf('【当前角色卡结束】')) > prompt.indexOf('【当前角色卡结束】'));
  const context = await call('/api/socialV2/prompt?key=' + KEY);
  assert.equal(context.response.mode, 'ASSISTANT');
  const wait = await call('/api/socialV2/wait', { key: KEY, purpose: 'reply', timeoutMs: 10, quietMs: 1 });
  assert.equal(wait.ok, true, wait.error);
  assert.equal(wait.response.mode, 'ASSISTANT');
  h.getSocialV2State(KEY).unread = [];
  await incoming('followup', [text('肥鱼，今天想聊点什么')]);
  const followup = await call('/api/socialV2/recent?key=' + KEY);
  assert.equal(followup.response.mode, 'CASUAL');
  assert.match(followup.response.instruction, /当前角色卡.*最初的口吻/);
  assert.match(followup.response.instruction, /约25字只是表达参考，不是拆条门槛/);
  assert.match(followup.response.instruction, /不得截断半句或半个单词/);
  assert.doesNotMatch(followup.response.instruction, /【正式回答要求】/);
  assert.match(h.buildWakePromptV2(KEY, 'addressed'), /平时喜欢开玩笑/);
});

test('plain text at, mentions of someone else, and at-all do not enable formal answers', async t => {
  const { call, incoming } = await fixture(t);
  for (const [id, segments] of [['fake', [text('@肥鱼 请回答')]], ['other', [at('222222'), text('请回答')]], ['all', [at('all'), text('大家好')]]]) {
    await incoming(id, segments);
    const data = await call('/api/socialV2/unread?key=' + KEY);
    assert.equal(data.response.mode, 'CASUAL');
    assert.ok(data.messages.every(m => !m.replyStyle));
  }
});

test('a real at addressing a casual opinion retains character expression without requiring a lecture', async t => {
  const { h, call, incoming } = await fixture(t);
  await incoming('opinion', [at(BOT), text('有时坚持原来的计划也挺累的')]);
  const data = await call('/api/socialV2/unread?key=' + KEY);
  assert.equal(data.response.mode, 'ASSISTANT', 'real-at handling remains enabled');
  assert.match(data.response.instruction, /不清除当前角色的用词、态度和个性/);
  assert.match(data.response.instruction, /简单问候、感慨或一句观点按原意简短回应/);
  assert.match(data.response.instruction, /不自动扩写成建议、评价或人生道理/);
  const prompt = h.buildWakePromptV2(KEY, 'addressed');
  assert.match(prompt, /平时喜欢开玩笑/);
  assert.match(prompt, /不要求套统一的助手口吻/);
});

test('ongoing casual chat receives its own memory material, respects personalization and refreshes after edits', async t => {
  const { h, call, incoming } = await fixture(t);
  const st = h.getSocialV2State(KEY), other = h.getSocialV2State('group:123457');
  st.bigfatfish.facts.push({ text: '喜欢讨论茶叶的香气', source: { userId: '111111' }, confidence: 1 });
  other.bigfatfish.facts.push({ text: '隔壁群喜欢讨论太空电梯', confidence: 1 });
  await incoming('tea', [text('肥鱼，聊聊茶叶香气')]);
  const data = await call('/api/socialV2/unread?key=' + KEY);
  assert.equal(data.response.mode, 'CASUAL');
  assert.match(data.response.instruction, /喜欢讨论茶叶的香气/);
  assert.match(data.response.instruction, /自己的观点、偏好、具体联想/);
  assert.match(data.response.instruction, /不连续靠提问/);
  assert.match(data.response.instruction, /presetTopics/);
  assert.doesNotMatch(data.response.instruction, /隔壁群喜欢讨论太空电梯/);
  st.bigfatfish.facts[0].text = '希望多分享茶叶方面的看法';
  const wait = await call('/api/socialV2/wait', { key: KEY, purpose: 'reply', timeoutMs: 10, quietMs: 1 });
  assert.match(wait.response.instruction, /希望多分享茶叶方面的看法/);
  assert.doesNotMatch(wait.response.instruction, /喜欢讨论茶叶的香气/);
  st.bigfatfish.memoryControl.personalization = false;
  const plain = await call('/api/socialV2/recent?key=' + KEY);
  assert.doesNotMatch(plain.response.instruction, /希望多分享茶叶方面的看法/);
  assert.match(plain.response.instruction, /"facts":\[\],"topics":\[\]/);
  assert.match(plain.response.instruction, /约25字只是表达参考，不是拆条门槛/);
});
