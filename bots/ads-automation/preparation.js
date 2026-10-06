import { shortlist } from './discovery.js';
import { createExperiment } from './workflow.js';

// Prepare each approved creative once, including new variants for a previously
// tested candidate. Drafts still consume campaign slots; preparation never
// approves a decision, reserves spending or calls the advertising provider.
export function prepareCandidates(store,{minimumCpms={},onError=()=>{}}={}){
  const db=store.db,prepared=[];
  db.transaction(()=>{
    for(const project of db.prepare("SELECT * FROM projects WHERE status IN ('draft','ready')").all()){
      const occupied=db.prepare(`SELECT COUNT(*) n FROM experiments WHERE project_id=?
        AND status NOT IN ('deleted','rejected')`).get(project.id).n;
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
      const selected=shortlist(eligible.map(c=>({...c,status:'found'})),available);
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
