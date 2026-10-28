import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const BOT = '123456789', KEY = 'group:123456';
async function fixture(t) {
  const h = await bridgeHarness({
    config: { allow: { groups: ['123456'], private: ['987654321'] }, bigfatfish: { expectedQQ: BOT } },
    files: { 'state/bigfatfish-settings.json': { participation: { requireDirected: true } } },
    globals: { setTimeout: (fn, ms) => ({ fn, ms, unref() {} }), clearTimeout() {} },
  });
  t.after(() => h.close()); h.setSelfIdentity('肥鱼', BOT);
  const incoming = (qq) => h.handleIncoming('group', 123456, {
    group_id: 123456, self_id: BOT, user_id: '111111', message_id: '101',
    sender: { nickname: '群友' }, message: [{ type: 'at', data: { qq } }],
  }, h.cfg);
  return { h, incoming };
}

test('a first self mention uses verified identity without a gateway name lookup and keeps the direct batch', async t => {
  const { h, incoming } = await fixture(t); let lookups = 0;
  h.bot.getGroupMemberInfo = h.bot.getGroupMemberList = async () => { lookups++; throw Error('gateway unavailable'); };
  await incoming(BOT);
  const st = h.getSocialV2State(KEY);
  assert.equal(lookups, 0); assert.equal(st.unread[0].plain, '@肥鱼');
  assert.equal(st.pendingWakeReason, 'addressed'); assert.equal(st.pendingWakeTimer.ms, 100);
  assert.equal(st.unread[0].addressedToBot, true);
});

test('failed names of other members are resolved only once across full and plain text and do not wake a strict group', async t => {
  const { h, incoming } = await fixture(t); let infoCalls = 0, listCalls = 0;
  h.bot.getGroupMemberInfo = async () => { infoCalls++; throw Error('gateway unavailable'); };
  h.bot.getGroupMemberList = async () => { listCalls++; throw Error('gateway unavailable'); };
  await incoming('222222');
  const st = h.getSocialV2State(KEY);
  assert.equal(infoCalls, 1); assert.equal(listCalls, 1);
  assert.equal(st.unread[0].plain, '@222222'); assert.equal(st.pendingWakeTimer, null);
});

test('the first private message keeps private priority instead of an ambient bootstrap delay', async t => {
  const { h } = await fixture(t);
  await h.handleIncoming('private', '987654321', { self_id: BOT, user_id: '987654321', message_id: '102',
    message: [{ type: 'text', data: { text: '在吗' } }] }, h.cfg);
  const st = h.getSocialV2State('private:987654321');
  assert.equal(st.pendingWakeReason, 'private'); assert.equal(st.pendingWakeTimer.ms, 100);
});
