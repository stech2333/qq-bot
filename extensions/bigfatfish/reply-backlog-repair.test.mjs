import test from 'node:test';
import assert from 'node:assert/strict';
import { repairRepliedBacklog } from '../../scripts/repair-replied-backlog.mjs';
const key = 'group:123456';
const row = (type, fields = {}) => ({ type, key, sessionId: 'fixture-session', tool: 'qq_reply', time: '2026-10-23T12:00:00Z', ...fields });
test('repair removes only confirmed explicit replies and preserves unanswered input, history and memory', () => {
  const recentMessages = [{ text: '保留聊天档案' }], facts = [{ text: '保留记忆' }];
  const st = { lastUnreadSeq: 3, lastReadThroughSeq: 0, unread: [1, 2, 3].map(n => ({ seq: n, messageId: String(n), time: 1 })), recentMessages, bigfatfish: { facts } };
  const changes = repairRepliedBacklog({ conversations: { [key]: st } }, [row('call', { args: '{"replyToMessageId":"1"}' }), row('result', { ok: true }), row('call', { args: { replyToMessageId: '2' } }), row('result', { ok: false })]);
  assert.equal(changes[0].removed, 1); assert.deepEqual(st.unread.map(m => m.messageId), ['2', '3']); assert.equal(st.lastReadThroughSeq, 1);
  assert.strictEqual(st.recentMessages, recentMessages); assert.strictEqual(st.bigfatfish.facts, facts);
});
test('ambiguous parallel tool results and failed or missing results are not evidence of an answer', () => {
  const st = { lastUnreadSeq: 2, unread: [1, 2].map(n => ({ seq: n, messageId: String(n), time: 1 })) };
  const rows = [row('call', { args: { replyToMessageId: '1' } }), row('call', { args: { replyToMessageId: '2' } }), row('result', { ok: true }), row('result', { ok: true })];
  assert.deepEqual(repairRepliedBacklog({ conversations: { [key]: st } }, rows), []); assert.equal(st.unread.length, 2);
});
