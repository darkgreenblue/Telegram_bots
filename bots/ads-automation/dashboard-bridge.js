// Run with cwd=bots/dashboard so existing platform and bot paths retain their contracts.
import { createCampaign, listCampaigns, getSetting, audit } from '../dashboard/lib/platform.js';
import { campaignStatsAll, validScope } from '../dashboard/routes/marketing.js';
import { moneyOf,botByKey,instancesOf,withDb,userPk } from '../dashboard/lib/bots.js';
import { readCampaignCohorts } from './cohorts.js';

const request=JSON.parse(await new Promise((resolve,reject)=>{
  let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{s+=x;if(s.length>10000)reject(new Error('bridge input too large'));});
  process.stdin.on('end',()=>resolve(s));
}));
const scope=validScope(request.scope);
if(!scope)throw new Error('invalid dashboard scope');
const username=getSetting(`username:${scope}`);
if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new Error('dashboard bot username missing');
let result;
if(request.action==='handle') result={username};
else if(request.action==='campaign') {
  if(!/^ads-experiment-\d+$/.test(request.marker))throw new Error('invalid experiment marker');
  let c=listCampaigns().find(x=>x.bot===scope && x.notes===request.marker);
  if(!c){
    c=createCampaign({bot:scope,source:'telegram_ads',medium:request.surface,name:request.title,notes:request.marker});
    audit('ads.campaign.create',`c_${c.code}`,request.marker);
  }
  result={code:c.code,url:`https://t.me/${username}?start=c_${c.code}`};
} else if(request.action==='stats'||request.action==='stats_all') {
  const all=campaignStatsAll(scope);
  const unit=moneyOf(scope).unit==='rial'?'toman':moneyOf(scope).unit;
  const stats=(code,a)=>({code,starts:a?.starts||0,returning:a?.returning||0,newUsers:a?.newUsers||0,
    firstValue:a?.firstValue||0,paywall:a?.paywall||0,payers:a?.payers||0,
    revenue:a?.revenue||0,revenueUnit:unit,hasPayments:all.hasPayments});
  result=request.action==='stats'
    ?stats(request.code,all.byCode.get(String(request.code)))
    :{scope,revenueUnit:unit,hasPayments:all.hasPayments,
      byCode:Object.fromEntries([...all.byCode].map(([code,a])=>[code,stats(code,a)]))};
  if(request.action==='stats_all'&&request.cohortCodes){
    const money=moneyOf(scope);
    const snapshots=instancesOf(scope).map(instance=>{
      const snapshot=withDb(instance.file,db=>readCampaignCohorts(db,{codes:request.cohortCodes,at:request.at,
        profile:{userPk:userPk(scope),paymentTable:money.table,amountColumn:money.amountCol,
          successStatus:money.successStatus,paymentFilter:money.testFilter,
          excludedUsers:botByKey(scope)?.testUsers||[],revenueUnit:unit,amountDivisor:money.unit==='rial'?10:1,
          refundEvidence:botByKey(scope)?.family==='tarot'&&unit==='star'?'tarot-stars-v1':null}}));
      if(!snapshot)throw new Error('cohort read unavailable; no zero substitute');
      return {instance:instance.id,...snapshot};
    });
    if(!snapshots.length)throw new Error('cohort product instance unavailable');
    result.cohorts={windows:[7,30],asOf:request.at,instances:snapshots};
  }
} else throw new Error('unknown bridge action');
process.stdout.write(JSON.stringify(result));
