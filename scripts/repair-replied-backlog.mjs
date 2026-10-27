// Repair only explicit, successfully delivered replies. Default is a dry run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function repairRepliedBacklog(snapshot, rows) {
  const pending = new Map(), confirmed = new Map();
  for (const row of rows) {
    if (!/qq_(reply|send_message)$/.test(String(row.tool))) continue;
    const bucket = JSON.stringify([row.key, row.sessionId, row.tool]);
    if (row.type === 'call') {
      let args; try { args = typeof row.args === 'string' ? JSON.parse(row.args) : row.args; } catch { args = null; }
      const queue = pending.get(bucket) || [];
      if (queue.length) queue.forEach(item => { item.ambiguous = true; });
      queue.push({ id: String(args?.replyToMessageId ?? ''), ambiguous: queue.length > 0 }); pending.set(bucket, queue);
    } else if (row.type === 'result') {
      const queue = pending.get(bucket), call = queue?.shift();
      if (!queue?.length) pending.delete(bucket);
      const at = Date.parse(row.time);
      if (!call || call.ambiguous || row.ok !== true || !/^-?[1-9]\d*$/.test(call.id) || !Number.isFinite(at)) continue;
      const replies = confirmed.get(row.key) || new Map(); replies.set(call.id, at); confirmed.set(row.key, replies);
    }
  }
  const changes = [];
  for (const [key, st] of Object.entries(snapshot.conversations || {})) {
    const replies = confirmed.get(key); if (!replies || !Array.isArray(st.unread)) continue;
    const answered = st.unread.filter(m => !m.isSelf && replies.has(String(m.messageId)) && Number.isFinite(Number(m.time)) && Number(m.time) <= replies.get(String(m.messageId)));
    if (!answered.length) continue;
    const ids = new Set(answered.map(m => String(m.messageId))), seqs = new Set(answered.map(m => m.seq));
    st.unread = st.unread.filter(m => !ids.has(String(m.messageId)));
    const stillPending = new Set(st.unread.map(m => m.seq));
    st.lastReadThroughSeq ||= 0;
    while (st.lastReadThroughSeq < st.lastUnreadSeq && !stillPending.has(st.lastReadThroughSeq + 1)) st.lastReadThroughSeq++;
    if (Array.isArray(st.pendingWakeReasons)) st.pendingWakeReasons = st.pendingWakeReasons.filter(item => ['timeout', 'replyCheck', 'proactiveCheck', 'bootstrap', 'admin'].includes(item?.reason) || !seqs.has(item?.seq));
    if (st.bigfatfish?.assistantMessageIds) st.bigfatfish.assistantMessageIds = st.bigfatfish.assistantMessageIds.filter(id => !ids.has(String(id)));
    changes.push({ key, removed: answered.length, remaining: st.unread.length, messageIds: [...ids] });
  }
  return changes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url))), directory = path.join(root, 'integrations/qq-bridge/state');
  const file = path.join(directory, 'social-v2.json'), snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = fs.readFileSync(path.join(directory, 'tool-calls.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } });
  const changes = repairRepliedBacklog(snapshot, rows), apply = process.argv.includes('--apply');
  if (apply) {
    if (snapshot.paused !== true) throw Error('Repair requires AI to be paused first.');
    const lock = path.join(directory, 'bridge.lock');
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf8').trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Cannot verify bridge lock; repair cancelled.');
      let alive = true; try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw Error('Stop the bridge before applying the repair.');
    }
    if (changes.length) { const temporary = file + '.' + process.pid + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file); }
  }
  console.log(JSON.stringify({ applied: apply, changes }, null, 2));
}
