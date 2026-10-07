import { dashboardBridge } from './bridge.js';
import { createHash } from 'node:crypto';

const now=()=>Math.floor(Date.now()/1000);

// One grouped dashboard scan per scope, not one scan per ad. Late payments are
// retained as new snapshots so cohort quality can be reassessed over time.
export async function syncProductStats(store,{bridge=dashboardBridge,at=now(),minInterval=6*3600}={}){
  const db=store.db;
  const due=db.prepare(`SELECT e.id,e.tracking_code,p.scope FROM experiments e
    JOIN projects p ON p.id=e.project_id
    WHERE e.tracking_code IS NOT NULL AND e.ad_id IS NOT NULL
      AND COALESCE((SELECT MAX(o.at) FROM product_observations o WHERE o.experiment_id=e.id),0) <= ?
    ORDER BY p.scope,e.id`).all(at-minInterval);
  const groups=new Map();
  for(const ex of due){const xs=groups.get(ex.scope)||[];xs.push(ex);groups.set(ex.scope,xs);}
  let count=0;
  for(const [scope,experiments] of groups){
    const stats=await bridge({action:'stats_all',scope,cohortCodes:[...new Set(experiments.map(e=>e.tracking_code))],at});
    if(!stats?.byCode||typeof stats.byCode!=='object')throw new Error('dashboard returned invalid grouped stats');
    for(const ex of experiments){
      const s=stats.byCode[ex.tracking_code]||{};
      const values=['starts','returning','newUsers','payers','revenue'].map(k=>Number(s[k]||0));
      if(values.some(v=>!Number.isFinite(v)||v<0))throw new Error('dashboard returned invalid product metric');
      const unit=s.revenueUnit||stats.revenueUnit;
      if(!['star','toman'].includes(unit))throw new Error('dashboard revenue unit missing');
      const inserted=db.prepare(`INSERT OR IGNORE INTO product_observations
        (experiment_id,at,starts,returning_users,new_users,payers,revenue,revenue_unit,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(ex.id,at,...values,unit,JSON.stringify({
          ...s,hasPayments:s.hasPayments??null,refunds:null,
          cohorts:stats.cohorts?.instances?.map(instance=>({instance:instance.instance,
            ...instance.byCode?.[ex.tracking_code]}))??null,
          caveat:'All-time grouped refunds remain unavailable. Comparable-age cohorts separately preserve verified recorded money refunds; internal credit returns are excluded.'}));
      if(inserted.changes){
        store.audit('product','cohort.snapshot',ex.id,{at,windows:[7,30],cohortDataAvailable:!!stats.cohorts});
        count++;
      }
    }
  }
  return count;
}

// Descriptive comparable-age evidence, without automatic financial authority
// or an invented Stars/TON exchange rate. Preserve product versions separately.
export function paymentFeedback(store,projectId){
  const snapshots=store.db.prepare(`SELECT e.id,c.surface,c.value,o.at,o.raw_json FROM experiments e
    JOIN candidates c ON c.id=e.candidate_id JOIN product_observations o ON o.experiment_id=e.id
    WHERE e.project_id=? AND o.at=(SELECT MAX(recent.at) FROM product_observations recent WHERE recent.experiment_id=e.id)
    ORDER BY e.id LIMIT 100`).all(projectId);
  return {windows:[7,30],basis:'First 7/30 days from new campaign acquisition and approved payment time. Late verified money refunds revise the original window. Read separate received/refunded/net ledger metrics where available; unknown is not zero.',
    experiments:snapshots.map(snapshot=>({experimentId:snapshot.id,surface:snapshot.surface,candidate:snapshot.value,
      observedAt:snapshot.at,cohorts:JSON.parse(snapshot.raw_json).cohorts??null})),
    rules:'Do not compare immature users with mature cohorts or merge different product versions. Zero eligibleUsers means no mature evidence. Missing metrics are unknown. Small cohorts remain weak evidence. Do not claim net profit or convert Stars to TON.'};
}

export function paymentFingerprint(feedback){
  const canonical=value=>{
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort()
      .filter(key=>!['observedAt','asOf'].includes(key)).map(key=>[key,canonical(value[key])]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(feedback))).digest('hex');
}
