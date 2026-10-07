import 'dotenv/config';
import { openStore,addCandidate,row } from './db.js';
import { queueMarketResearch,queueResearch,queueStrategy } from './brain.js';
import { shortlist,expandPublicChannels } from './discovery.js';
import { GoogleSheetsMirror } from './sheets.js';
import { projectCapacity,projectSpendCommitment } from './workflow.js';
import { expandPublicPeers } from './discovery-graph.js';
import { useCompetitorFirst } from './preparation.js';
import { discoverFromSources,queueSourceDiscovery } from './discovery-sources.js';
import { recordBotInterfaceEvidence } from './peer-evidence.js';
import { archiveCompetitorObservation,competitorBenchmark } from './competitor-observations.js';

const store=openStore(),db=store.db;
const input=async()=>{let s='';for await(const c of process.stdin){s+=c;if(s.length>100000)throw new Error('input too large');}return JSON.parse(s||'{}');};
try{
  const cmd=process.argv[2],arg=await input();let result;
  if(cmd==='init'){
    const {slug,name,scope,destination,market='',language,context}=arg;
    if(!/^[a-z0-9-]{3,40}$/.test(slug||'')||!name||!scope||!destination||!language||!context)throw new Error('missing project brief');
    const id=Number(db.prepare(`INSERT INTO projects(slug,name,scope,destination,market,language,context) VALUES (?,?,?,?,?,?,?)`).run(
      slug,name,scope,destination,market,language,context).lastInsertRowid);
    store.audit('admin-cli','project.init',id,{slug});result={projectId:id,status:'draft'};
  }else if(cmd==='activate'){
    const p=row(db,'projects',Number(arg.projectId));
    if(!p||typeof arg.targetCpa!=='number'||!Number.isFinite(arg.targetCpa)||arg.targetCpa<=0||
      typeof arg.approvedSpend!=='number'||!Number.isFinite(arg.approvedSpend)||arg.approvedSpend<=0||
      arg.approvedSpend>20||!arg.market)throw new Error('project, CPA, approved spend and market required');
    db.prepare(`UPDATE projects SET target_cpa=?,approved_spend=?,market=?,status='ready' WHERE id=?`).run(arg.targetCpa,arg.approvedSpend,arg.market,p.id);
    store.audit('admin-cli','project.activate',p.id,{targetCpa:arg.targetCpa,approvedSpend:arg.approvedSpend,market:arg.market});
    result={projectId:p.id,status:'ready'};
  }else if(cmd==='automatic'){
    const p=row(db,'projects',Number(arg.projectId));if(!p||p.status!=='ready'||arg.confirm!==p.slug)throw new Error('ready project and exact slug confirmation required');
    db.prepare(`UPDATE projects SET mode='automatic' WHERE id=?`).run(p.id);
    store.audit('admin-cli','project.mode',p.id,{mode:'automatic'});result={projectId:p.id,mode:'automatic'};
  }else if(cmd==='market')result={jobId:queueMarketResearch(store,Number(arg.projectId))};
  else if(cmd==='discovery-policy')result=useCompetitorFirst(store,Number(arg.projectId));
  else if(cmd==='discovery-queue')result={runId:queueSourceDiscovery(store,Number(arg.projectId),arg.query)};
  else if(cmd==='discover')result=await discoverFromSources(store,{projectId:Number(arg.projectId),query:arg.query,
    max:Math.min(Number(arg.max)||30,100)});
  else if(cmd==='research')result={jobId:queueResearch(store,Number(arg.projectId),arg.feedback||{})};
  else if(cmd==='candidate')result={candidateId:addCandidate(db,arg)};
  else if(cmd==='peer-interface')result={jobId:recordBotInterfaceEvidence(store,Number(arg.candidateId),arg.evidence)};
  else if(cmd==='competitor-observation')result=archiveCompetitorObservation(store,Number(arg.candidateId),arg.observation);
  else if(cmd==='competitor-benchmark')result=competitorBenchmark(store,Number(arg.candidateId),{limit:arg.limit??10});
  else if(cmd==='strategy')result={jobId:queueStrategy(store,Number(arg.candidateId))};
  else if(cmd==='shortlist')result=shortlist(db.prepare(`SELECT * FROM candidates WHERE project_id=?`).all(Number(arg.projectId)),Number(arg.limit)||20,
    {policy:row(db,'projects',Number(arg.projectId))?.initial_peer_policy});
  else if(cmd==='expand-peers')result=await expandPublicPeers(store,{projectId:Number(arg.projectId),seeds:arg.seeds,
    max:Math.min(Number(arg.max)||100,500),depth:arg.depth===0?0:Math.min(Number(arg.depth)||2,3)});
  else if(cmd==='expand')result=await expandPublicChannels(store,{projectId:Number(arg.projectId),seeds:arg.seeds,max:Math.min(Number(arg.max)||100,500),depth:Math.min(Number(arg.depth)||2,3)});
  else if(cmd==='sheet'){
    const mirror=new GoogleSheetsMirror({spreadsheetId:process.env.ADS_SHEETS_ID,credentialsPath:process.env.ADS_GOOGLE_CREDENTIALS});
    result={synced:await mirror.sync(store,Number(arg.projectId))};
  }else if(cmd==='status'){
    result={projects:db.prepare('SELECT id,slug,market,language,status,mode,target_cpa,approved_spend,max_allocated,max_campaigns FROM projects').all()
      .map(p=>({...p,allocation:projectCapacity(db,p.id),spendCommitted:projectSpendCommitment(db,p.id)})),
      experiments:db.prepare('SELECT id,project_id,status,ad_id,last_spent,last_views,last_actions FROM experiments ORDER BY id DESC LIMIT 30').all(),
      pending:db.prepare(`SELECT id,kind,experiment_id FROM decisions WHERE status='pending'`).all()};
  }else throw new Error('unknown command');
  process.stdout.write(JSON.stringify(result));
}catch(e){process.stderr.write(String(e.message));process.exitCode=1;}finally{store.close();}
