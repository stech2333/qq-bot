import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const BOT = '123456789';

async function fixture(t) {
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: BOT }, allow: { groups: ['123456'], private: ['987654321'] } } });
  t.after(() => h.close());
  h.setMode('reserved2'); h.setSelfIdentity('肥鱼', BOT);
  return h;
}

test('sent messages keep their gateway message id so they can be recalled later', async t => {
  const h = await fixture(t);
  const sent = await h.sendMessagesV2('group:123456', ['第一条', '第二条'], []);
  assert.equal(sent.length, 2);
  assert.equal(sent.messageIds.length, 2, '发送结果要带上每条消息的 id');
  assert.ok(sent.messageIds.every(Boolean), '不能是 null —— 否则事后无法撤回/审计');
  // 真实链路里由路由在发送成功后调用；这里直接调它，验证落库字段。
  h.recordSentMessagesV2('group:123456', sent);
  const self = h.getSocialV2State('group:123456').recentMessages.filter(m => m.isSelf);
  assert.equal(self.length, 2);
  assert.deepEqual(self.map(m => m.messageId), sent.messageIds, '本地记录必须和网关返回的 id 一致');
});

test('a private reply records its id too', async t => {
  const h = await fixture(t);
  const sent = await h.sendMessagesV2('private:987654321', ['私聊一条'], []);
  h.recordSentMessagesV2('private:987654321', sent);
  const self = h.getSocialV2State('private:987654321').recentMessages.filter(m => m.isSelf);
  assert.equal(self.at(-1).messageId, sent.messageIds[0]);
  assert.match(String(self.at(-1).messageId), /^\d+$/);
});
