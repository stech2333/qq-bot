import { randomUUID } from 'node:crypto';

// Generation leases are separate from DSH turns: queued generations cannot replace a running turn.
export class DeliveryLedger {
  constructor(app) { this.app = app; this.turns = new Map(); this.queue = new Map(); this.running = new Map(); this.dsh = new Map(); this.error = ''; }
  begin(key, st) {
    const id = randomUUID(), row = { id, key, token: st.agentToken, sent: new Set(), failures: 0, unknown: false, settled: false, createdAt: Date.now() };
    this.turns.set(id, row); const queue = this.queue.get(key) || []; queue.push(id); this.queue.set(key, queue);
    for (const [old, r] of this.turns) if ((r.settled || Date.now() - r.createdAt > 3600000) && this.turns.size > 500) { this.turns.delete(old); if(r.dshTurn)this.dsh.delete(r.key+':'+r.dshTurn); this.app.styleResolver?.pending.delete(old); }
    return id;
  }
  start(key, st, dshTurn) {
    const known=this.turns.get(this.dsh.get(key+':'+dshTurn));if(known)return known.id;
    const queue = this.queue.get(key) || []; let row;
    while (queue.length && !row) { const candidate = this.turns.get(queue.shift()); if (candidate && !candidate.settled) {if(candidate.token===st.agentToken)row=candidate;else this.finish(candidate,false);} }
    if (!row) { const id = this.begin(key, st); queue.pop(); row = this.turns.get(id); }
    this.queue.set(key, queue); row.dshTurn = String(dshTurn); this.dsh.set(key+':'+dshTurn,row.id); this.running.set(key, row.id); return row.id;
  }
  capture(key, st) {
    const running = this.turns.get(this.running.get(key));
    if (running && !running.settled && running.token === st.agentToken) return running.id;
    const pending = (this.queue.get(key) || []).map(id => this.turns.get(id)).find(r => r && !r.settled && r.token === st.agentToken);
    return pending?.id || this.begin(key, st);
  }
  accepted(key, st, turnId, sendId) {
    const row = this.turns.get(turnId);
    if (!row || row.key !== key || row.token !== st.agentToken || row.settled || row.sent.has(sendId)) return null;
    row.sent.add(sendId); return { first: row.sent.size === 1, row };
  }
  batch(turnId, failures, unknown = false) { const row = this.turns.get(turnId); if (row) { row.failures += failures; row.unknown ||= unknown; } }
  complete(key, dshTurn, completed, st) {
    let row = this.turns.get(this.dsh.get(key+':'+dshTurn));
    // A disconnect may lose turn/start. Only a unique, actually delivered lease can settle without it.
    if(!row&&st){const delivered=(this.queue.get(key)||[]).map(id=>this.turns.get(id)).filter(r=>r&&!r.settled&&!r.dshTurn&&r.token===st.agentToken&&r.sent.size);if(delivered.length===1){row=delivered[0];row.dshTurn=String(dshTurn);this.dsh.set(key+':'+dshTurn,row.id);}}
    if (!row || row.settled || row.dshTurn !== String(dshTurn)) return;
    this.finish(row,completed);
  }
  finish(row,completed) {
    if(!row||row.settled)return;
    row.settled=true;row.status=!completed?(row.sent.size?'partial':'cancelled'):row.unknown?'unknown':row.failures?(row.sent.size?'partial':'failed'):row.sent.size?'completed':'silent';
    if(this.running.get(row.key)===row.id)this.running.delete(row.key);
    this.queue.set(row.key,(this.queue.get(row.key)||[]).filter(id=>id!==row.id));
    if(row.sent.size)this.app.styleResolver.sent(row.id);else this.app.styleResolver.pending.delete(row.id);
  }
  cancel(key) {
    for (const row of this.turns.values()) if (row.key === key && !row.settled) this.finish(row,false);
    this.running.delete(key); this.queue.delete(key);
  }
  cancelGeneration(id) {
    const row=this.turns.get(id); if(!row || row.settled) return;
    this.finish(row,false);
  }
}
