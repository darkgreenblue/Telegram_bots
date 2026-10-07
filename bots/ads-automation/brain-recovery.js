import { row } from './db.js';
import { isProviderQuotaError } from './brain-errors.js';
export { isProviderQuotaError } from './brain-errors.js';

// Only a provider execution error is classified here. A rejected model answer
// remains a bounded validation failure, even when its text mentions limits.
export function failBrainJob(store,{id,owner,error,provider='codex',quota=false},now=Math.floor(Date.now()/1000)) {
  if(!['codex','claude'].includes(provider))throw new Error('invalid brain provider');
  return store.db.transaction(()=>{
    const job=row(store.db,'jobs',Number(id));
    if(!job||job.lease_owner!==owner||job.status!=='leased'||job.lease_until<now)
      throw new Error('invalid or expired job lease');
    const message=String(error||'worker error').slice(0,500);
    if(quota&&!isProviderQuotaError(message))throw new Error('quota error evidence required');
    const delay=quota?1800:Math.min(900,30*2**Math.min(5,job.attempts));
    const status=quota||job.attempts<3?'queued':'error';
    store.db.prepare(`UPDATE jobs SET status=?,error=?,not_before=?,
      attempts=MAX(0,attempts-?),lease_owner=NULL,lease_until=NULL WHERE id=?`)
      .run(status,message,now+delay,quota?1:0,job.id);
    if(quota)store.db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES (?,?,'subscription quota')
      ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at),reason=excluded.reason`)
      .run(`brain:${provider}`,now+delay);
    store.audit('brain',quota?'job.quota_wait':'job.failed',job.id,{provider,status,retryAt:now+delay});
    return {failed:job.id,status,retryAt:now+delay};
  })();
}

export function recoverQuotaJobs(store) {
  return store.db.transaction(()=>{
    const jobs=store.db.prepare("SELECT * FROM jobs WHERE status='error'").all();
    const recovered=[];
    for(const job of jobs){
      if(!isProviderQuotaError(job.error))continue;
      store.db.prepare("UPDATE jobs SET status='queued',attempts=0,not_before=0,lease_owner=NULL,lease_until=NULL WHERE id=?").run(job.id);
      store.audit('brain','job.quota_recovered',job.id,{previousError:job.error,previousAttempts:job.attempts});
      recovered.push(job.id);
    }
    return {recovered};
  })();
}
