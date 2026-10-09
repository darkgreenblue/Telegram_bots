import { shortlist } from './discovery.js';
import { createExperiment,requestDecision } from './workflow.js';
import { peerReadiness } from './peer-evidence.js';
import { captureExperimentContext,assertExperimentContextCurrent } from './learning-context.js';

// Prepare each approved creative once, including new variants for a previously
// tested candidate. Drafts still consume campaign slots; preparation never
// approves a decision, reserves spending or calls the advertising provider.
export function prepareCandidates(store,{minimumCpms={},onError=()=>{}}={}){
  const db=store.db,prepared=[];
  db.transaction(()=>{
    for(const project of db.prepare("SELECT * FROM projects WHERE status IN ('draft','ready')").all()){
      reconcileInitialDrafts(store,project);
      const occupied=db.prepare(`SELECT COUNT(*) n FROM experiments WHERE project_id=?
        AND status NOT IN ('deleted','rejected','discovery_held')`).get(project.id).n;
      const available=Math.max(0,project.max_campaigns-occupied);
      if(!available)continue;
      const eligible=db.prepare(`SELECT c.* FROM candidates c
        WHERE c.project_id=? AND c.status IN ('found','prepared') AND EXISTS
        (SELECT 1 FROM creatives cr WHERE cr.project_id=c.project_id AND cr.candidate_id=c.id
          AND cr.status='approved' AND NOT EXISTS
          (SELECT 1 FROM experiments e WHERE e.candidate_id=c.id AND e.creative_id=cr.id))
        ORDER BY c.score DESC,c.id LIMIT 5000`).all(project.id);
      // The shortlist algorithm expects the discovery state; preserve the
      // persisted candidate state rather than resetting tested peers to found.
      const selected=shortlist(eligible.filter(c=>peerReadiness(c,project.initial_peer_policy).ready)
        .map(c=>({...c,status:'found'})),available,{policy:project.initial_peer_policy});
      for(const candidate of selected){
        const creative=db.prepare(`SELECT cr.* FROM creatives cr
          WHERE cr.project_id=? AND cr.candidate_id=? AND cr.status='approved' AND NOT EXISTS
          (SELECT 1 FROM experiments e WHERE e.candidate_id=? AND e.creative_id=cr.id)
          ORDER BY cr.id LIMIT 1`).get(project.id,candidate.id,candidate.id);
        const cpm=Number((minimumCpms[candidate.surface]===''?undefined:minimumCpms[candidate.surface])??
          ({channels:0.18,bots:0.13,search:0.1,users:0.1})[candidate.surface]);
        const placement=({channels:'channel_post',bots:'bot_banner',search:'search_result',users:'channel_post'})[candidate.surface];
        try{
          const id=createExperiment(store,{projectId:project.id,candidateId:candidate.id,
            creativeId:creative.id,cpm,placement});
          db.prepare("UPDATE candidates SET status='prepared' WHERE id=?").run(candidate.id);
          prepared.push(id);
        }catch(error){
          store.audit('system','experiment.prepare_failed',candidate.id,{creativeId:creative.id,message:error.message});
          onError(candidate,creative,error);
        }
      }
    }
  })();
  return prepared;
}

// Hold unfunded legacy drafts when the owner changes initial discovery priority.
// Never mutate a provider-owned/authorized experiment. Preserve tracking links,
// images and previous decisions; a released draft needs a new owner decision.
export function reconcileInitialDrafts(store,project){
  if(project.initial_peer_policy!=='competitor-first')return;
  const db=store.db;
  for(const ex of db.prepare(`SELECT * FROM experiments WHERE project_id=? AND ad_id IS NULL
    AND spend_authorized=0 AND status='draft'`).all(project.id)){
    const candidate=db.prepare('SELECT * FROM candidates WHERE id=?').get(ex.candidate_id);
    const result=peerReadiness(candidate,project.initial_peer_policy);
    if(result.ready)continue;
    db.prepare("UPDATE experiments SET status='discovery_held' WHERE id=?").run(ex.id);
    db.prepare(`UPDATE decisions SET status='rejected',decided_at=unixepoch() WHERE experiment_id=?
      AND kind='create' AND status IN ('pending','approved')`).run(ex.id);
    store.audit('discovery','draft.held',ex.id,{reason:result.reason,previousStatus:ex.status});
  }
  let occupied=db.prepare(`SELECT count(*) n FROM experiments WHERE project_id=?
    AND status NOT IN ('deleted','rejected','discovery_held')`).get(project.id).n;
  for(const ex of db.prepare(`SELECT e.* FROM experiments e JOIN creatives cr ON cr.id=e.creative_id
    WHERE e.project_id=? AND e.status='discovery_held' AND e.ad_id IS NULL AND e.spend_authorized=0
    AND cr.status='approved' ORDER BY e.id`).all(project.id)){
    if(occupied>=project.max_campaigns)break;
    const candidate=db.prepare('SELECT * FROM candidates WHERE id=?').get(ex.candidate_id);
    if(!peerReadiness(candidate,project.initial_peer_policy).ready)continue;
    captureExperimentContext(store,ex.id);
    try{assertExperimentContextCurrent(db,ex);}
    catch(error){
      if(!/experiment context changed|product runtime changed or unavailable/.test(error.message))throw error;
      // A new suitability review cannot revive a proposal for a retired bot or
      // process. Keep its immutable context; prepare a fresh creative instead.
      if(!db.prepare("SELECT 1 FROM audit WHERE action='draft.release_held' AND subject=? LIMIT 1").get(String(ex.id)))
        store.audit('discovery','draft.release_held',ex.id,{reason:error.message});
      continue;
    }
    db.prepare("UPDATE experiments SET status='draft' WHERE id=?").run(ex.id);
    requestDecision(store,project.id,ex.id,'create',{reason:'Measured direct competitor passed initial discovery review'},
      {discovery:JSON.parse(candidate.features_json)});
    store.audit('discovery','draft.released',ex.id,{});occupied++;
  }
}

export function useCompetitorFirst(store,projectId){
  return store.db.transaction(()=>{
    const project=store.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if(!project)throw new Error('project absent');
    store.db.prepare("UPDATE projects SET initial_peer_policy='competitor-first' WHERE id=?").run(projectId);
    reconcileInitialDrafts(store,{...project,initial_peer_policy:'competitor-first'});
    store.audit('admin-cli','discovery.policy',projectId,{policy:'competitor-first',channelSubscribers:5000,botMonthlyUsers:10000});
    return {projectId,policy:'competitor-first',channelSubscribers:5000,botMonthlyUsers:10000};
  })();
}
