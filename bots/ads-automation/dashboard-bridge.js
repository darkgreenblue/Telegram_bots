// Run with cwd=bots/dashboard so existing platform and bot paths retain their contracts.
import { createCampaign, listCampaigns, getSetting, audit } from '../dashboard/lib/platform.js';
import { campaignStatsAll, validScope } from '../dashboard/routes/marketing.js';
import { moneyOf } from '../dashboard/lib/bots.js';

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
} else throw new Error('unknown bridge action');
process.stdout.write(JSON.stringify(result));
