// DSH normalized usage has disjoint input/cache buckets; reasoning is already in output.
const valid=n=>Number.isSafeInteger(n)&&n>=0;
export function contextHead(event,previous) {
  if(event?.type!=='assistant/message')return previous;
  const u=event.data?.usage;if(!u||!valid(u.inputTokens)||!valid(u.outputTokens))return previous;
  if(['cacheReadTokens','cacheWriteTokens','totalTokens'].some(k=>u[k]!==undefined&&!valid(u[k])))return previous;
  const seq=event.seq;if(!valid(seq)||previous&&seq<=previous.seq)return previous;
  const input=u.inputTokens+(u.cacheReadTokens||0)+(u.cacheWriteTokens||0);
  return {seq,tokens:Math.max(input+u.outputTokens,u.totalTokens||0),at:Number.isFinite(event.time)?event.time:Date.now()};
}
export function contextPolicy(model={}) {
  const window=Number.isSafeInteger(model.contextWindow)&&model.contextWindow>=4096?model.contextWindow:65536;
  const output=Number.isSafeInteger(model.maxTokens)&&model.maxTokens>0?Math.min(model.maxTokens,window/2):Math.min(4096,window/2);
  return {window,threshold:Math.floor(Math.max(window/2,window-Math.max(window/4,output*2)))};
}
export const needsContextRenewal=(head,policy)=>valid(head?.tokens)&&head.tokens>=policy.threshold;
