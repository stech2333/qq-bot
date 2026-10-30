import {zhihuHash} from './community-zhihu.mjs';

export function zhihuPart(reading) {const r=reading.records?.[0];return r?zhihuHash(JSON.stringify([r.unitId,r.offset,r.contentHash])):null;}
export function zhihuEvidence(r) {return `zh:${zhihuHash(r.unitId)}:${r.version}:${zhihuHash(r.quote)}`;}
export function zhihuCheckpoint(row,reading,{extracted=[],approved=[],generation,revision}={}) {
  if(!reading.stableContent)return {};
  const record=reading.records?.[0],key=zhihuPart(reading),versions={...row.zhihuVersions},parts={...row.zhihuParts},cache={...row.zhihuCache};
  if(record){versions[zhihuHash(record.unitId)]=record.version;parts[key]=true;
    // Reuse only single-fragment reviews. Enriched multi-document decisions must be reviewed afresh.
    const decisions=approved.filter(c=>c.verifiedAt&&c.confidence>=.85&&!c.conflict&&c.refs?.length&&c.refs.every(r=>r.platform==='zhihu'&&r.document===reading.id&&r.zhihuLocation?.version===record.version&&r.zhihuLocation?.contentHash===record.contentHash)).map(c=>({key:c.key,confidence:c.confidence,verifiedAt:c.verifiedAt,quotes:c.refs.map(r=>r.quote).sort()}));
    cache[key]={extracted,decisions,generation,revision,unitVersion:record.version,unitKey:zhihuHash(record.unitId),at:Date.now()};
  }
  return {zhihuVersions:versions,zhihuParts:parts,zhihuCache:cache,zhihuSnapshot:reading.zhihuSnapshot,lastScannedAt:Date.now()};
}
