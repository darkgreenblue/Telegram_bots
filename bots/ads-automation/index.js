import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openStore,row } from './db.js';
import { AdsApi } from './api.js';
import { createAdminBot,sendAdminQueue,notify } from './admin.js';
import { decide,executeDecision,pollExperiment } from './workflow.js';
import { GoogleSheetsMirror } from './sheets.js';
import { refreshInsights } from './learning.js';
import { queueResearch } from './brain.js';
import { prepareCandidates } from './preparation.js';
import { syncProductStats,paymentFeedback,paymentFingerprint } from './product.js';
import { startRuntime } from './runtime.js';

if(!process.env.ADS_ADMIN_BOT_TOKEN)throw new Error('ADS_ADMIN_BOT_TOKEN خالی است');
if(!Number.isSafeInteger(Number(process.env.ADS_ADMIN_ID)))throw new Error('ADS_ADMIN_ID نامعتبر است');

const store=openStore(),db=store.db,owner=randomUUID();
const ownerId=Number(process.env.ADS_ADMIN_ID),resetMinute=Number(process.env.ADS_DAILY_RESET_UTC_MINUTE);
const apiToken=process.env.ADS_API_TOKEN||await readFile(process.env.ADS_API_TOKEN_PATH||'./data/ads-api-token.txt','utf8')
  .then(value=>value.trim()).catch(error=>{
    if(error.code==='ENOENT')return undefined;
    throw new Error('Ads API credential file unreadable');
  });
const api=new AdsApi({token:apiToken,store,live:process.env.ADS_LIVE_ENABLED==='1'});
const bot=createAdminBot(store,{token:process.env.ADS_ADMIN_BOT_TOKEN,ownerId,api});
const sheets=new GoogleSheetsMirror({spreadsheetId:process.env.ADS_SHEETS_ID,
  credentialsPath:process.env.ADS_GOOGLE_CREDENTIALS});

function claimWorker(){
  const t=Math.floor(Date.now()/1000);
  return db.transaction(()=>{
    db.prepare(`INSERT OR IGNORE INTO worker_lease(id,owner,until_at) VALUES (1,?,?)`).run(owner,t+120);
    db.prepare(`UPDATE worker_lease SET owner=?,until_at=? WHERE id=1 AND (owner=? OR until_at<?)`).run(owner,t+120,owner,t);
    return db.prepare('SELECT owner FROM worker_lease WHERE id=1').get().owner===owner;
  })();
}

function autoDecide(){
  const decisions=db.prepare(`SELECT d.*,p.mode,p.target_cpa FROM decisions d JOIN projects p ON p.id=d.project_id
    WHERE d.status='pending' AND p.mode='automatic' ORDER BY d.id LIMIT 30`).all();
  for(const d of decisions){
    if(d.kind==='recharge')continue; // always owner-authorized
    if(d.kind==='review'){
      if(JSON.parse(d.payload_json).reason?.includes('budget precision'))continue;
      const ex=row(db,'experiments',d.experiment_id),rounds=db.prepare(`SELECT * FROM rounds WHERE experiment_id=? ORDER BY number`).all(ex.id);
      const latest=rounds.at(-1),peers=db.prepare(`SELECT MIN(r.spent/NULLIF(r.actions,0)) best FROM rounds r JOIN experiments e ON e.id=r.experiment_id
        WHERE e.project_id=? AND r.actions>0`).get(d.project_id).best;
      const poor=latest && ((rounds.length>=2 && rounds.slice(-2).every(r=>r.actions===0)) ||
        (latest.actions>0 && latest.views>=100 && latest.spent/latest.actions>Math.max(4*d.target_cpa,3*(peers||0))));
      decide(store,d.id,false,'policy');
      const kind=poor?'delete':'continue';
      const nextId=Number(db.prepare(`INSERT INTO decisions(project_id,experiment_id,kind,payload_json,evidence_json,status,decided_at)
        VALUES (?,?,?,?,?,'approved',unixepoch())`).run(d.project_id,d.experiment_id,kind,
          JSON.stringify({reason:poor?'consistently poor compared with peers':'more evidence needed'}),d.evidence_json).lastInsertRowid);
      store.audit('policy','review.resolve',d.id,{nextId,kind});
    }else if(['create','delete','graduate','continue'].includes(d.kind))decide(store,d.id,true,'policy');
  }
}

let cycleNo=0,busy=false;
async function cycle(){
  if(busy)return;busy=true;
  try{
    if(!claimWorker())throw new Error('another ads worker owns the lease');
    prepareCandidates(store,{
      minimumCpms:Object.fromEntries(['channels','bots','search','users']
        .map(surface=>[surface,process.env[`ADS_MIN_CPM_${surface.toUpperCase()}`]])),
      onError:(candidate,creative,error)=>notify(store,`prepare:${candidate.id}:${creative.id}`,
        `⚠️ آماده‌سازی کاندید ${candidate.id}، نسخهٔ ${creative.id}: ${error.message}`)
    });autoDecide();
    for(const d of db.prepare(`SELECT * FROM decisions WHERE status='approved' ORDER BY id LIMIT 30`).all()){
      try{await executeDecision(store,api,d.id,{resetMinute});}
      catch(e){notify(store,`decision-error:${d.id}:${Math.floor(Date.now()/86400000)}`,
        `⚠️ اجرای تصمیم ${d.id} متوقف شد: ${e.message}`);}
    }
    const time=Math.floor(Date.now()/1000);
    for(const e of db.prepare(`SELECT * FROM experiments WHERE ad_id IS NOT NULL AND status IN ('review','testing','winner','limited_winner')
      AND COALESCE(next_check_at,0)<=? ORDER BY next_check_at LIMIT 30`).all(time)){
      try{await pollExperiment(store,api,e.id,{resetMinute});}
      catch(error){notify(store,`poll-error:${e.id}:${Math.floor(Date.now()/86400000)}`,
        `⚠️ بررسی کمپین ${e.id} ناموفق شد؛ توقف زمان‌دار تلگرام محافظ خرج است. ${error.message}`);}
    }
    if(++cycleNo%20===0){
      try{await syncProductStats(store);}catch(e){notify(store,`product-stats:${Math.floor(Date.now()/86400000)}`,
        `⚠️ دریافت آمار محصول متوقف شد: ${e.message}`);}
      for(const p of db.prepare('SELECT id,market FROM projects').all()){
        refreshInsights(store,p.id);
        const latest=db.prepare(`SELECT MAX(r.ended_at) at FROM rounds r JOIN experiments e ON e.id=r.experiment_id WHERE e.project_id=?`).get(p.id).at;
        const lastResearch=db.prepare(`SELECT created_at,input_json FROM jobs WHERE project_id=? AND kind='research' ORDER BY id DESC LIMIT 1`).get(p.id);
        const quality=paymentFeedback(store,p.id);
        const paymentChanged=quality.experiments.some(ex=>ex.cohorts!==null)&&
          paymentFingerprint(quality)!==JSON.parse(lastResearch?.input_json||'{}').paymentFingerprint;
        if(p.market && ((latest && latest>(lastResearch?.created_at||0))||paymentChanged)){
          const evidence=db.prepare(`SELECT e.id,c.surface,c.value,r.spent,r.actions,r.views FROM rounds r
            JOIN experiments e ON e.id=r.experiment_id JOIN candidates c ON c.id=e.candidate_id
            WHERE e.project_id=? ORDER BY r.ended_at DESC LIMIT 20`).all(p.id);
          queueResearch(store,p.id,{recentTests:evidence,paymentChanged,
            goal:'Find similar peers to winners and alternatives to failed hypotheses; use comparable-age payment quality without claiming net profitability.'});
        }
        if(sheets.spreadsheetId && sheets.credentialsPath){
          try{await sheets.sync(store,p.id);}catch(e){notify(store,`sheets:${p.id}:${Math.floor(Date.now()/86400000)}`,`⚠️ همگام‌سازی شیت پروژه ${p.id}: ${e.message}`);}
        }
      }
    }
    await sendAdminQueue(store,bot,ownerId);
    store.audit('worker','cycle.completed',owner,{cycleNo});
  }catch(e){store.audit('worker','error','cycle',{message:e.message});}
  finally{busy=false;}
}

const runtime=startRuntime({bot,cycle,close:()=>store.close(),log:(event,detail)=>{
  store.audit('worker',event,owner,detail);
  console.log(JSON.stringify({at:new Date().toISOString(),event,...detail}));
}});
const stop=()=>runtime.stop().catch(error=>{
  console.error(JSON.stringify({event:'runtime.shutdown_failed',message:String(error.message).slice(0,200)}));
  process.exitCode=1;
});
process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{await runtime.done;}catch(error){
  console.error(JSON.stringify({event:'runtime.exit',message:String(error.message).slice(0,200)}));
  process.exitCode=1;
}
