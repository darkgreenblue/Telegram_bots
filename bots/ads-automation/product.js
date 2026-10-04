import { dashboardBridge } from './bridge.js';

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
    const stats=await bridge({action:'stats_all',scope});
    if(!stats?.byCode||typeof stats.byCode!=='object')throw new Error('dashboard returned invalid grouped stats');
    for(const ex of experiments){
      const s=stats.byCode[ex.tracking_code]||{};
      const values=['starts','returning','newUsers','payers','revenue'].map(k=>Number(s[k]||0));
      if(values.some(v=>!Number.isFinite(v)||v<0))throw new Error('dashboard returned invalid product metric');
      const unit=s.revenueUnit||stats.revenueUnit;
      if(!['star','toman'].includes(unit))throw new Error('dashboard revenue unit missing');
      db.prepare(`INSERT OR IGNORE INTO product_observations
        (experiment_id,at,starts,returning_users,new_users,payers,revenue,revenue_unit,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(ex.id,at,...values,unit,JSON.stringify({
          ...s,hasPayments:s.hasPayments??null,refunds:null,
          caveat:'Refund attribution is unavailable in the existing grouped dashboard API.'}));
      count++;
    }
  }
  return count;
}
