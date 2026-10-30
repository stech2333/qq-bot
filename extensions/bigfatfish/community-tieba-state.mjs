import { hash } from './community-adapters.mjs';

// Scoped to a stable source/tid queue row. Never evict paid content identities.
export const tiebaItemKey = r => r.pid + (r.replyId ? '/'+r.replyId : '');
export const tiebaPartKey = r => `${tiebaItemKey(r)}:${r.offset}:${r.contentHash}`;
export function freshTiebaRead(row, reading) {
  const records=reading.records||[];
  const fresh=records.filter(r=>!row.tiebaParts?.[tiebaPartKey(r)]&&!((row.tiebaItems?.[tiebaItemKey(r)]?.hash===r.itemHash)&&row.tiebaItems[tiebaItemKey(r)].complete));
  const useful=fresh.filter(r=>{
    const text=r.text.trim();
    return text.length>=4&&!/^(?:顶|顶帖|打卡|签到|路过|哈哈|呵呵|[\s\p{P}\p{S}])+$/u.test(text)&&!/(?:加[微vV]信|扫码.{0,4}(?:领|赚)|代开发票)/u.test(text);
  });
  return {...reading,text:useful.length?reading.text:'',duplicateItems:records.length-fresh.length,filteredItems:fresh.length-useful.length};
}
export function tiebaCheckpoint(row, reading) {
  if(!reading.stableThread)return {};
  const tiebaItems={...row.tiebaItems},tiebaParts={...row.tiebaParts},scanSeen={...row.scanSeen};
  for(const r of reading.records||[]){
    const key=tiebaItemKey(r),old=tiebaItems[key];
    tiebaItems[key]={hash:r.itemHash,complete:r.itemComplete||old?.hash===r.itemHash&&old.complete,deleted:false};
    tiebaParts[tiebaPartKey(r)]=true;scanSeen[key]=true;
  }
  const scanUncertain=!!(row.scanUncertain||reading.paginationStopped);
  if(reading.complete&&!scanUncertain)for(const [key,v] of Object.entries(tiebaItems))if(!scanSeen[key])tiebaItems[key]={...v,deleted:true};
  return {tiebaItems,tiebaParts,scanSeen,scanUncertain,lastScannedAt:Date.now()};
}
export function tiebaEvidenceFingerprint(r) {
  return r.location?`tb:${r.location.pid}:${r.location.replyId||'0'}:${r.location.itemHash}:${hash(r.quote)}`:hash(r.fingerprint+':'+r.quote);
}
