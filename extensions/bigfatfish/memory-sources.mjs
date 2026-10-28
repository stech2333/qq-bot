// Precise provenance invalidation shared by explicit source removal and restart cleanup.
export const dependsOn = (entry, id) => String(entry?.source?.messageId ?? '') === String(id)
  || (entry?.sourceIds || []).some(value => String(value) === String(id));
export function removeMemorySource(app, key, st, id) {
  const s = st.bigfatfish;
  for(const fact of s.facts.filter(f=>dependsOn(f,id))) {
    const remaining=(fact.sourceIds||[]).filter(value=>String(value)!==String(id));
    if(remaining.length){fact.sourceIds=remaining;if(String(fact.source?.messageId)===String(id)){const next=(st.recentMessages||[]).find(m=>String(m.messageId)===String(remaining[0]));fact.source={...fact.source,messageId:remaining[0],...(next?{at:next.time}:{})};}fact.confirmations=remaining.length;}
  }
  const facts = s.facts.filter(f => dependsOn(f,id));
  // Tombstones prevent re-importing the same removed fact, but leave unrelated summaries intact.
  for (const f of facts) app.memory.forgetSourceFact(s, f);
  s.facts = s.facts.filter(f=>!dependsOn(f,id));
  s.memoryArchive = s.memoryArchive.filter(r=>!dependsOn(r.fact,id));
  if (dependsOn(s.summaryMeta,id)) { s.summary='';s.summaryMeta=null; }
  for (const field of ['activeTopics','pendingThoughts']) st[field]=(st[field]||[]).filter(r=>!dependsOn(r,id));
  for (const [user, impression] of Object.entries(st.memberImpressions||{})) {
    if (Array.isArray(impression.evidence)) {
      impression.evidence=impression.evidence.filter(e=>String(e.messageId)!==String(id));
      impression.traits=impression.evidence.map(e=>e.text);
      if(!impression.traits.length)delete st.memberImpressions[user];
    } else if(dependsOn(impression,id)) delete st.memberImpressions[user];
  }
  for (const topic of s.learnedInterests||[]) if((topic.evidence||[]).some(e=>String(e.messageId)===String(id))) {
    topic.evidence=topic.evidence.filter(e=>String(e.messageId)!==String(id));
    if(!topic.admin){topic.status='candidate';topic.research={status:'pending'};}
  }
  s.lastRecall=null; app.discussions.cache.delete(s);
}
