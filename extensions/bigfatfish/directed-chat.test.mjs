import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { participationDecision, participationSettings, recordParticipationSent, isDirectCall } from './participation.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';

const BOT = '123456789', KEY = 'group:123456', NOW = 1800000000000;
const settings = participationSettings({ requireDirected: true, quoteReplies: false, idleProbability: 1, engagedProbability: 1, interestProbability: 1 });
const at = qq => ({ type: 'at', data: { qq } });
const event = (user = '111111', message = []) => ({ user_id: user, self_id: BOT, message });
const decide = (state, text, extra = {}) => participationDecision(state, extra.event || event(), { kind: 'group', text, nickname: '肥鱼',
  interests: ['AI'], now: NOW, random: () => 0, ...extra }, settings);

test('strict recipient checking rejects third-person mentions, general questions, and conversations addressed to others', () => {
  for (const text of ['你是谁', '你是不是AI模型', 'AI模型怎么样', '古月方鲸说他在摸鱼', '大家觉得肥鱼怎么样']) {
    const d = decide({}, text); assert.equal(d.recipientConfirmed, false, text); assert.equal(d.probability, 0); assert.equal(d.reason, null);
  }
  for (const message of [[at('222222')], [{ type: 'reply', data: { id: 'other' } }]]) {
    assert.equal(decide({}, '肥鱼，你怎么看AI', { event: event('111111', message) }).recipientConfirmed, false);
  }
  assert.equal(isDirectCall('肥鱼在群里聊天', ['肥鱼']), false);
  assert.equal(isDirectCall('肥鱼说他在看书', ['肥鱼']), false);
  for (const text of ['肥鱼在吗', '古月方鲸，你怎么看', '肥鱼你觉得呢']) assert.equal(decide({}, text).direct, true);
});

test('unpunctuated direct questions and nudges recognize the bot name without treating third-person reports as calls', () => {
  for(const text of ['肥鱼怎么不理我','肥鱼为什么没回复','肥鱼如何实现这个功能','肥鱼说话','古月方鲸回我','小鲸鱼在线吗']){
    const d=decide({},text,{random:()=>0.99});assert.equal(d.direct,true,text);assert.equal(d.reason,'addressed',text);assert.equal(d.probability,1,text);
  }
  for(const text of ['肥鱼在群里聊天','肥鱼说他在看书','我觉得肥鱼说得挺好'])assert.equal(decide({},text).recipientConfirmed,false,text);
  assert.equal(decide({},'肥鱼怎么不理我',{event:event('111111',[at('222222')])}).recipientConfirmed,false);
});

test('explicit questions from the current confirmed partner are not dropped by the ambient lottery',()=>{
  const policy=participationSettings({requireDirected:true,engagedProbability:0.2,idleProbability:0.1});
  const state={},pick=(text,extra={})=>participationDecision(state,extra.event||event(),{kind:'group',text,nickname:'肥鱼',now:NOW,random:()=>0.99,...extra},policy);
  pick('肥鱼，解释这个算法');recordParticipationSent(state,'算法先校验输入',NOW);
  const question=pick('那具体怎么实现呢',{now:NOW+1000});assert.equal(question.recipientConfirmed,true);assert.equal(question.reason,'followUp');assert.equal(question.selected,true);assert.equal(question.probability,1);
  assert.equal(pick('嗯',{now:NOW+2000}).selected,false,'casual acknowledgements retain the configured probability');
  const other=pick('那具体怎么实现呢',{now:NOW+3000,event:event('222222',[at('333333')])});assert.equal(other.recipientConfirmed,false);assert.equal(other.selected,false);
});

test('only the current uninterrupted conversation partner can continue without naming the bot', () => {
  const state = {}; decide(state, '肥鱼讲讲秘密分享'); recordParticipationSent(state, '秘密分享用多项式插值', NOW);
  assert.equal(decide(state, '那多项式具体怎么做', { now: NOW + 1000 }).reason, 'followUp');
  assert.equal(decide(state, '那多项式具体怎么做', { now: NOW + 2000, event: event('222222') }).recipientConfirmed, false);
  assert.equal(decide(state, '你觉得呢', { now: NOW + 3000 }).recipientConfirmed, false);
  assert.equal(decide(state, '肥鱼，接着聊', { now: NOW + 4000 }).recipientConfirmed, true);
  assert.equal(decide({}, '你好', { kind: 'private' }).reason, 'private');
});

async function fixture(t) {
  let handler;
  const token = 'directed-fixture-token', server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ config: { consolePort: 3106, consoleToken: token, ownerQQ: '987654321', allow: { groups: ['123456'], private: ['987654321'] },
    bigfatfish: { expectedQQ: BOT }, socialV2: { sticker: { enabled: true }, wake: { maxWakePerMinute: 100, maxWakePerHour: 100 } } },
    files: { 'state/bigfatfish-settings.json': { participation: { requireDirected: true, quoteReplies: false } } },
    globals: { ...roleCard, http: { createServer(cb) { handler = cb; return server; } }, safeFetchBuffer: async () => ({
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=', 'base64') }) } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', BOT); h.startConsoleServer();
  const incoming = async (id, text, user = '111111', segments = []) => h.handleIncoming('group', 123456, {
    ...event(user, [...segments, { type: 'text', data: { text } }]), message_id: id, sender: { nickname: '群友' } }, h.cfg);
  const read = async () => {
    const req = Readable.from([]); Object.assign(req, { method: 'GET', url: '/api/socialV2/unread?key=' + KEY,
      headers: { host: '127.0.0.1:3106', 'x-console-token': token, 'x-agent-token': h.getSocialV2State(KEY).agentToken } });
    let result; await handler(req, { writeHead() {}, end(v) { result = JSON.parse(v); } }); return result;
  };
  return { h, incoming, read };
}
const sends = h => h.calls.http.filter(c => /\/send_(group|private)_msg$/.test(c.url));

test('unknown group conversation does not bootstrap or bypass checking through configured triggers and send tools', async t => {
  const { h, incoming, read } = await fixture(t);
  const st = h.getSocialV2State(KEY); st.wakeConfig.triggers = { anyMessage: true, keywords: ['AI'], probability: 1 };
  await incoming('1', 'AI模型你怎么看', '111111', [at('222222')]);
  assert.equal(st.bootstrapSent, false); assert.equal(st.pendingWakeTimer, null);
  assert.equal((await read()).response.recipient.confirmed, false);
  await assert.rejects(h.sendMessagesV2(KEY, ['不应抢答'], []), /未确认是在跟机器人聊天/);
  assert.equal(sends(h).length, 0);
});

test('real intake of an unpunctuated named request wakes the model with mandatory response priority',async t=>{
  const {h,incoming}=await fixture(t);await incoming('201','肥鱼怎么不理我');
  for(let i=0;i<40&&!h.calls.prompts.length;i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(h.calls.prompts.length,1);const st=h.getSocialV2State(KEY);assert.equal(st.bigfatfish.participation.lastDecision.direct,true);
  const prompt=JSON.stringify(h.calls.prompts[0].content);assert.match(prompt,/本轮接话优先/);assert.match(prompt,/先回应已确认的待答消息/);assert.equal(h.calls.sent.length,0,'scheduler never sends an invented test reply');
});

test('real at remains answerable in a mixed batch, plain sends omit quote segments and targeted acknowledgement is preserved', async t => {
  const { h, incoming, read } = await fixture(t);
  await incoming('101', '解释一下秘密分享', '111111', [at(BOT)]);
  await incoming('102', '你周末去哪里玩', '222222', [at('333333')]);
  const response = await read();
  assert.deepEqual(Array.from(response.response.recipient.messageIds), ['101']);
  assert.equal(response.response.mode, 'ASSISTANT'); assert.equal(response.response.style.scene, 'help');
  assert.match(h.buildWakePromptV2(KEY, 'addressed'), /不带QQ引用条/);
  await h.sendMessagesV2(KEY, ['先把秘密分成多份。', '达到阈值才能还原。'], [], '101');
  assert.equal(sends(h).length, 2); assert.ok(sends(h).every(c => !c.body.message.some(m => m.type === 'reply')));
  assert.deepEqual(Array.from(h.getSocialV2State(KEY).unread.map(m => m.messageId)), ['102']);
  await incoming('103', '哈哈我也去', '222222');
  assert.equal((await read()).response.recipient.confirmed, false);
  await assert.rejects(h.sendMessagesV2(KEY, ['继续接走别人的话'], []), /未确认是在跟机器人聊天/);
  assert.equal(sends(h).length, 2);
});

test('group stickers omit quotes too, while private quoting remains available', async t => {
  const { h, incoming } = await fixture(t);
  await incoming('201', '肥鱼在吗');
  await h.sendStickerV2(KEY, 'fixture-sticker', { replyToMessageId: '201' });
  assert.ok(!sends(h).at(-1).body.message.some(m => m.type === 'reply'));
  assert.ok(sends(h).at(-1).body.message.some(m => m.type === 'image'));
  await h.sendMessagesV2('private:987654321', ['私聊正常回复'], [], '301');
  assert.ok(sends(h).at(-1).body.message.some(m => m.type === 'reply'));
});
