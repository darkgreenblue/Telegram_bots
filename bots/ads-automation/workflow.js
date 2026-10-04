import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { row } from './db.js';
import { dashboardBridge } from './bridge.js';
import { targetFor,validateCreative } from './targets.js';
import { assessTest,cadence,canGraduate,cpa,remainingTest,TEST_TON } from './policy.js';

const now=()=>Math.floor(Date.now()/1000);
const money=n=>Math.round(n*100000)/100000;
const checkMoney=(n,name)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new Error(`${name} missing`);return n;};
const asDecision=(db,id)=>row(db,'decisions',id);

export function requestDecision(store,projectId,experimentId,kind,payload,evidence={}) {
  const d=store.db.prepare(`SELECT * FROM decisions WHERE project_id=? AND experiment_id IS ? AND kind=? AND status='pending' ORDER BY id DESC LIMIT 1`).get(projectId,experimentId,kind);
  if(d)return d.id;
  const id=Number(store.db.prepare(`INSERT INTO decisions(project_id,experiment_id,kind,payload_json,evidence_json) VALUES (?,?,?,?,?)`).run(projectId,experimentId,kind,JSON.stringify(payload),JSON.stringify(evidence)).lastInsertRowid);
  store.audit('system','decision.proposed',id,{kind,experimentId});
  return id;
}

export function decide(store,id,approve,actor='admin') {
  const d=asDecision(store.db,id);
  if(!d || d.status!=='pending')return false;
  store.db.prepare(`UPDATE decisions SET status=?,decided_at=unixepoch() WHERE id=? AND status='pending'`).run(approve?'approved':'rejected',id);
  store.audit(actor,approve?'decision.approve':'decision.reject',id,{kind:d.kind});
  return true;
}

export function createExperiment(store,{projectId,candidateId,creativeId,cpm,placement}) {
  const db=store.db,project=row(db,'projects',projectId),candidate=row(db,'candidates',candidateId),creative=row(db,'creatives',creativeId);
  if(!project||!candidate||!creative)throw new Error('missing project/candidate/creative');
  validateCreative(creative,candidate,project);
  const target=targetFor(candidate);
  if(target.placement!==placement)throw new Error('placement does not match surface');
  if(!(Number.isFinite(cpm)&&cpm>0))throw new Error('valid minimum CPM required');
  const title=`${project.slug}-${candidate.surface}-${candidateId}-${creativeId}-${Date.now().toString(36)}`;
  if(Buffer.byteLength(title,'utf8')>128)throw new Error('title too long');
  const id=Number(db.prepare(`INSERT INTO experiments(project_id,candidate_id,creative_id,title,cpm,placement)
    VALUES (?,?,?,?,?,?)`).run(projectId,candidateId,creativeId,title,cpm,placement).lastInsertRowid);
  requestDecision(store,projectId,id,'create',{initialBudget:1,testBudget:TEST_TON},{candidateId,creativeId,cpm,placement});
  store.audit('system','experiment.prepare',id,{candidateId,creativeId});
  return id;
}

function nextReset(nowSec,minute){
  const today=Math.floor(nowSec/86400)*86400+minute*60;
  return today>nowSec?today:today+86400;
}

export function leaseEnd(nowSec,resetMinute){
  if(!Number.isInteger(resetMinute)||resetMinute<0||resetMinute>=1440)throw new Error('verified daily reset minute missing');
  const end=Math.min(nowSec+3600,nextReset(nowSec,resetMinute)-120);
  if(end-nowSec<120)throw new Error('too close to daily reset to start test');
  return end;
}

function safetyGate(project,api,resetMinute) {
  if(project.status!=='ready'||!(project.target_cpa>0)||!(project.approved_spend>0))throw new Error('project not approved for live spending');
  if(!api.live||process.env.ADS_COST_GATE_VERIFIED!=='1')throw new Error('cost capability gate not verified');
  leaseEnd(now(),resetMinute);
}

export function projectCapacity(db,projectId){
  const rows=db.prepare(`SELECT status,allocated_total,returned_total FROM experiments WHERE project_id=? AND ad_id IS NOT NULL`).all(projectId);
  return {slots:rows.filter(r=>!['deleted','rejected'].includes(r.status)).length,
    allocated:money(rows.reduce((s,r)=>s+Math.max(0,r.allocated_total-r.returned_total),0))};
}

export async function createApproved(store,api,experimentId,{resetMinute}) {
  const db=store.db,ex=row(db,'experiments',experimentId);
  if(!ex)throw new Error('experiment absent');
  if(ex.ad_id)return ex.ad_id;
  const approved=db.prepare(`SELECT * FROM decisions WHERE experiment_id=? AND kind='create' AND status='approved' ORDER BY id DESC LIMIT 1`).get(ex.id);
  if(!approved)throw new Error('admin approval missing');
  const project=row(db,'projects',ex.project_id),candidate=row(db,'candidates',ex.candidate_id),creative=row(db,'creatives',ex.creative_id);
  safetyGate(project,api,resetMinute);
  validateCreative(creative,candidate,project);
  const cap=projectCapacity(db,project.id);
  if(cap.slots>=project.max_campaigns||cap.allocated+1>Math.min(project.max_allocated,project.approved_spend)+1e-6)throw new Error('project allocation capacity exhausted');
  const account=await api.getAccount();
  if(account.currency!=='TON'||checkMoney(account.remaining_budget,'account remaining budget')<1)throw new Error('account is not funded in TON');
  const configured=await dashboardBridge({action:'handle',scope:project.scope});
  const destUser=new URL(project.destination).pathname.replace(/^\//,'').replace(/\/$/,'');
  if(destUser.toLowerCase()!==configured.username.toLowerCase())throw new Error('destination differs from dashboard scope');
  let tracking=ex.tracking_code;
  if(!tracking){
    const c=await dashboardBridge({action:'campaign',scope:project.scope,surface:candidate.surface,title:ex.title,marker:`ads-experiment-${ex.id}`});
    tracking=c.code;
    db.prepare('UPDATE experiments SET tracking_code=? WHERE id=?').run(tracking,ex.id);
  }
  const link=`https://t.me/${configured.username}?start=c_${tracking}`;
  let photoId;
  if(candidate.surface==='channels'){
    if(!existsSync(creative.image_path))throw new Error('approved banner file missing');
    const digest=createHash('sha256').update(await readFile(creative.image_path)).digest('hex');
    if(digest!==creative.image_sha256)throw new Error('approved banner changed');
    photoId=creative.uploaded_photo_id;
    if(!photoId){
      const photo=await api.uploadPhoto(creative.image_path,`photo-${creative.id}-${digest.slice(0,32)}`);
      photoId=photo.photo_id;
      db.prepare('UPDATE creatives SET uploaded_photo_id=? WHERE id=?').run(photoId,creative.id);
    }
  }
  const {target,placement}=targetFor(candidate);
  const params={title:ex.title,text:creative.ad_text,promote_url:link,cpm:ex.cpm,placement,target,
    initial_budget:1,daily_budget_limit:TEST_TON,is_paused:false,
    deactivate_date:leaseEnd(now(),resetMinute),...(photoId?{photo_id:photoId}:candidate.surface==='bots'?{show_userpic:true}:{})};
  // A prior uncertain response can be reconciled by unique title before retry.
  const existing=await api.findByTitle(ex.title);
  const ad=existing||await api.call('createAd',params,`create-${ex.id}`);
  if(!Number.isInteger(ad.ad_id))throw new Error('Ads API returned no ad_id');
  db.prepare(`UPDATE experiments SET ad_id=?,status='review',review_status=?,activated_at=?,
    lease_until=?,test_started_at=?,next_check_at=? WHERE id=?`).run(
      ad.ad_id,ad.status||'',now(),params.deactivate_date,now(),now()+1800,ex.id);
  store.audit('system','ad.create',ex.id,{adId:ad.ad_id,tracking,placement});
  return ad.ad_id;
}

export async function pauseManaged(store,api,ex,reason){
  if(!ex.ad_id||ex.status==='deleted')return;
  const ad=await api.getAd(ex.ad_id);
  if(!ad||ad.ad_id!==ex.ad_id)throw new Error('managed ad missing from account');
  if(!ad.is_paused)await api.call('editAd',{ad_id:ex.ad_id,is_paused:true},`pause-${ex.id}-${ex.test_round}-${reason}`);
  store.db.prepare(`UPDATE experiments SET status='paused',stopped_at=?,lease_until=NULL WHERE id=?`).run(now(),ex.id);
  store.audit('system','ad.pause',ex.id,{reason,adId:ex.ad_id});
}

async function recordRound(store,ex,ad,reason){
  const spent=money(ad.spent_budget-ex.start_spent),actions=ad.actions-ex.start_actions,views=ad.views-ex.start_views;
  store.db.prepare(`INSERT OR IGNORE INTO rounds(experiment_id,number,spent,actions,views,reason) VALUES (?,?,?,?,?,?)`).run(ex.id,ex.test_round,spent,actions,views,reason);
  return {spent,actions,views};
}

async function extendLease(store,api,ex,ad,resetMinute){
  const end=leaseEnd(now(),resetMinute);
  const remaining=remainingTest(ad.spent_budget,ex.start_spent);
  if(remaining<=0)throw new Error('no test share remains');
  const daily=checkMoney(ad.daily_spent_budget,'daily spent');
  const limit=Math.min(1,Math.floor((daily+remaining+1e-7)*100)/100);
  if(limit<0.01)throw new Error('daily budget precision cannot preserve test cap');
  await api.call('editAd',{ad_id:ex.ad_id,daily_budget_limit:limit,deactivate_date:end,is_paused:false},`lease-${ex.id}-${ex.test_round}-${end}`);
  store.db.prepare('UPDATE experiments SET lease_until=?,status=?,next_check_at=? WHERE id=?').run(end,'testing',now()+60,ex.id);
}

export async function pollExperiment(store,api,experimentId,{resetMinute}){
  const db=store.db,ex=row(db,'experiments',experimentId);
  if(!ex?.ad_id||['deleted','rejected','draft'].includes(ex.status))return;
  const project=row(db,'projects',ex.project_id);
  if(project.status==='paused'){
    if(ex.status!=='paused')await pauseManaged(store,api,ex,'project-paused');
    return;
  }
  const ad=await api.getAd(ex.ad_id);
  if(!ad||ad.ad_id!==ex.ad_id)throw new Error('managed ad missing');
  const spent=checkMoney(ad.spent_budget,'spent'),views=ad.views,actions=ad.actions;
  if(!Number.isInteger(views)||!Number.isInteger(actions)||views<ex.last_views||actions<ex.last_actions||spent+1e-6<ex.last_spent)throw new Error('non-monotonic ad metrics');
  const time=now();
  const first=ex.first_view_at||(views>0?time:null);
  db.prepare(`INSERT OR IGNORE INTO observations(experiment_id,at,views,actions,spent,daily_spent,status,raw_json)
    VALUES (?,?,?,?,?,?,?,?)`).run(ex.id,time,views,actions,spent,ad.daily_spent_budget??null,ad.status||'',JSON.stringify(ad));
  const remaining=checkMoney(ad.remaining_budget,'remaining budget');
  db.prepare(`UPDATE experiments SET last_spent=?,last_remaining=?,last_views=?,last_actions=?,first_view_at=?,
    serving_at=CASE WHEN serving_at IS NULL AND ? IN ('active','on_hold') THEN ? ELSE serving_at END,
    last_checked_at=?,review_status=? WHERE id=?`).run(spent,remaining,views,actions,first,ad.status||'',time,time,ad.status||'',ex.id);
  const update=()=>row(db,'experiments',ex.id);
  if(ad.status==='declined'){
    await pauseManaged(store,api,update(),'declined');
    requestDecision(store,ex.project_id,ex.id,'delete',{reason:'declined by Telegram'},{status:ad.status});
    return;
  }
  if(ad.status==='ready_for_review'){
    await api.call('submitAdForReview',{ad_id:ex.ad_id},`review-submit-${ex.id}`);
    db.prepare(`UPDATE experiments SET status='review',next_check_at=? WHERE id=?`).run(time+3*3600,ex.id);
    return;
  }
  if(ad.status==='in_review'){
    db.prepare(`UPDATE experiments SET status='review',next_check_at=? WHERE id=?`).run(time+3*3600,ex.id);
    return;
  }
  // The short provider-side deadline can expire while Telegram reviews a new ad.
  // Resume only an untouched ad whose last observed state was review, with a
  // fresh deadline that still ends before the verified daily reset.
  if(ad.status==='stopped' && !first && spent===0 && !ex.serving_at &&
      ['ready_for_review','in_review'].includes(ex.review_status) && ex.lease_until<=time){
    await extendLease(store,api,update(),ad,resetMinute);
    return;
  }
  if(!first && update().serving_at && time-update().serving_at>=48*3600){
    await pauseManaged(store,api,update(),'no-delivery');
    requestDecision(store,ex.project_id,ex.id,'delete',{reason:'۴۸ ساعت پس از آماده‌شدن نمایش، هنوز ویویی ثبت نشده است.'},{spent,views,actions});
    return;
  }
  if(ex.status==='winner'||ex.status==='limited_winner'){
    const currentCpa=cpa(spent,actions);
    const prior=db.prepare(`SELECT spent,actions,at FROM observations WHERE experiment_id=? AND at>=? AND at<? ORDER BY at LIMIT 1`).get(ex.id,time-86400,time);
    const recentSpent=prior?spent-prior.spent:0,recentActions=prior?actions-prior.actions:0;
    const recentBad=recentSpent>=TEST_TON-1e-6&&(recentActions===0||recentSpent/recentActions>project.target_cpa);
    if(((currentCpa!==null && currentCpa>project.target_cpa)||recentBad) && ex.status==='winner'){
      await api.call('editAd',{ad_id:ex.ad_id,daily_budget_limit:0.1},`winner-fallback-${ex.id}`);
      db.prepare(`UPDATE experiments SET status='limited_winner' WHERE id=?`).run(ex.id);
      store.audit('system','winner.limit',ex.id,{cpa:currentCpa,recentSpent,recentActions});
    }
    if(ad.status==='stopped'||ad.remaining_budget<=0){
      db.prepare(`UPDATE experiments SET status='paused' WHERE id=?`).run(ex.id);
      requestDecision(store,ex.project_id,ex.id,'recharge',{amount:1},{spent,actions,cpa:currentCpa});
    } else db.prepare(`UPDATE experiments SET next_check_at=? WHERE id=?`).run(time+Math.min(3600,cadence({views,spent,firstViewAt:first,lastCheckedAt:ex.last_checked_at,lastViews:ex.last_views,lastSpent:ex.last_spent},time)),ex.id);
    return;
  }
  const result=ad.status==='stopped'?{kind:'review',reason:'provider stopped ad'}:assessTest({spent,actions:actions-ex.start_actions,views,
    firstViewAt:first,now:time,testStartSpent:ex.start_spent,targetCpa:project.target_cpa});
  if(['review','reclaim','pause'].includes(result.kind)){
    await pauseManaged(store,api,update(),result.kind);
    const round=await recordRound(store,ex,ad,result.reason);
    const rounds=db.prepare('SELECT spent,actions,views FROM rounds WHERE experiment_id=? ORDER BY number').all(ex.id);
    const graduate=canGraduate(rounds,project.target_cpa);
    requestDecision(store,ex.project_id,ex.id,graduate?'graduate':result.kind==='reclaim'?'delete':'review',
      {reason:result.reason,graduate},{round,rounds,cpa:result.cpa,spent,views,actions});
    return;
  }
  // Always stop at the provider-side deadline before crossing an unverified day boundary.
  if(ad.is_paused||!ex.lease_until||ex.lease_until-time<300)await extendLease(store,api,update(),ad,resetMinute);
  const delay=cadence({views,spent,firstViewAt:first,lastCheckedAt:ex.last_checked_at,lastViews:ex.last_views,lastSpent:ex.last_spent},time);
  db.prepare(`UPDATE experiments SET status='testing',next_check_at=? WHERE id=?`).run(time+delay,ex.id);
}

export async function executeDecision(store,api,decisionId,config){
  const d=asDecision(store.db,decisionId);
  if(!d||d.status!=='approved')return;
  const ex=d.experiment_id?row(store.db,'experiments',d.experiment_id):null;
  const project=row(store.db,'projects',d.project_id);
  if(['create','graduate','recharge','continue'].includes(d.kind)&&project.status!=='ready')throw new Error('project is not ready for spending');
  if(d.kind==='create')await createApproved(store,api,ex.id,config);
  else if(d.kind==='delete'){
    if(ex.status!=='deleted'){
      if(ex.status!=='paused')await pauseManaged(store,api,ex,'admin-delete');
      const fresh=row(store.db,'experiments',ex.id);
      if(now()-fresh.stopped_at<600)return; // API requires ten inactive minutes
      const ad=await api.getAd(ex.ad_id);
      if(!ad.is_paused && ad.status!=='stopped')throw new Error('ad not inactive');
      await api.call('deleteAd',{ad_id:ex.ad_id},`delete-${ex.id}`);
      store.db.prepare(`UPDATE experiments SET status='deleted',returned_total=? WHERE id=?`).run(ad.remaining_budget,ex.id);
      store.audit('admin','ad.delete',ex.id,{adId:ex.ad_id,returnedBudget:ad.remaining_budget});
    }
  } else if(d.kind==='graduate'){
    const project=row(store.db,'projects',ex.project_id);
    const rounds=store.db.prepare('SELECT spent,actions,views FROM rounds WHERE experiment_id=? ORDER BY number').all(ex.id);
    if(!canGraduate(rounds,project.target_cpa))throw new Error('winner evidence insufficient');
    await api.call('editAd',{ad_id:ex.ad_id,daily_budget_limit:0,is_paused:false},`graduate-${ex.id}`);
    store.db.prepare(`UPDATE experiments SET status='winner',next_check_at=?,lease_until=NULL WHERE id=?`).run(now()+60,ex.id);
    store.audit('admin','ad.graduate',ex.id,{rounds:rounds.length});
  } else if(d.kind==='recharge'){
    const p=row(store.db,'projects',ex.project_id);
    safetyGate(p,api,config.resetMinute);
    const account=await api.getAccount();
    if(account.currency!=='TON'||checkMoney(account.remaining_budget,'balance')<1)throw new Error('insufficient TON balance');
    const opKey=`recharge-${ex.id}-${d.id}`;
    const op=store.db.prepare('SELECT status FROM operations WHERE op_key=?').get(opKey);
    if(!op||op.status!=='done'){
      const pending=store.db.prepare(`SELECT COUNT(*) n FROM decisions WHERE project_id=? AND kind='recharge'
        AND status='approved' AND allocation_applied=0`).get(p.id).n;
      if(projectCapacity(store.db,p.id).allocated+pending>Math.min(p.max_allocated,p.approved_spend)+1e-6)throw new Error('allocation cap');
    }
    await api.call('increaseAdBudget',{ad_id:ex.ad_id,amount:1},opKey);
    store.db.transaction(()=>{
      const applied=store.db.prepare('UPDATE decisions SET allocation_applied=1 WHERE id=? AND allocation_applied=0').run(d.id);
      if(applied.changes)store.db.prepare(`UPDATE experiments SET allocated_total=allocated_total+1,last_remaining=last_remaining+1 WHERE id=?`).run(ex.id);
    })();
    await api.call('editAd',{ad_id:ex.ad_id,is_paused:false,daily_budget_limit:0},`recharge-resume-${ex.id}-${d.id}`);
    store.db.prepare(`UPDATE experiments SET status='winner',next_check_at=? WHERE id=?`).run(now()+60,ex.id);
  } else if(d.kind==='continue'){
    if(ex.status!=='paused')throw new Error('experiment not paused');
    const ad=await api.getAd(ex.ad_id);
    if(remainingTest(ad.spent_budget,ex.start_spent)<=0) {
      store.db.prepare(`UPDATE experiments SET test_round=test_round+1,start_spent=?,start_actions=?,start_views=?,test_started_at=? WHERE id=?`).run(
        ad.spent_budget,ad.actions,ad.views,now(),ex.id);
    }
    await extendLease(store,api,row(store.db,'experiments',ex.id),ad,config.resetMinute);
  } else if(d.kind==='review') {
    // Review is an information-only approval; it never resumes spending.
  } else throw new Error('unknown decision');
  store.db.prepare(`UPDATE decisions SET status='executed' WHERE id=?`).run(d.id);
  store.audit('system','decision.executed',d.id,{kind:d.kind});
}
