import { row } from './db.js';
import { isDeepStrictEqual } from 'node:util';

// A rediscovered candidate is mutable. An experiment's claim and evaluation
// boundary are not. Do not backfill old experiments from today's candidate.
export function captureExperimentContext(store, experimentId) {
  const db=store.db,experiment=row(db,'experiments',experimentId);
  if(!experiment)throw new Error('experiment absent');
  const existing=db.prepare('SELECT * FROM experiment_contexts WHERE experiment_id=?').get(experimentId);
  if(existing)return existing;
  if(experiment.ad_id!==null||experiment.spend_authorized>0||
    db.prepare('SELECT 1 FROM rounds WHERE experiment_id=? LIMIT 1').get(experimentId)||
    db.prepare('SELECT 1 FROM operations WHERE op_key=? LIMIT 1').get(`create-${experimentId}`))
    throw new Error('cannot reconstruct historical experiment context');
  const project=row(db,'projects',experiment.project_id),candidate=row(db,'candidates',experiment.candidate_id),
    creative=row(db,'creatives',experiment.creative_id);
  const claim=candidate.hypothesis.trim();
  if(!claim)throw new Error('experiment hypothesis absent');
  // Exact claims share an identity; semantic similarity is not equivalence.
  db.prepare('INSERT OR IGNORE INTO hypotheses(project_id,claim) VALUES (?,?)').run(project.id,claim);
  const hypothesis=db.prepare('SELECT id FROM hypotheses WHERE project_id=? AND claim=?').get(project.id,claim);
  const context={schema:1,hypothesisId:hypothesis.id,hypothesis:claim,market:project.market,
    productScope:project.scope,destination:project.destination,
    language:project.language,targetCpa:project.target_cpa,surface:candidate.surface,candidate:candidate.value,
    target:JSON.parse(candidate.target_json),angle:creative.angle,
    creative:{adText:creative.ad_text,bannerText:creative.banner_text,imageSha256:creative.image_sha256},productVersion:null,
    productVersionEvidence:null};
  // Source code HEAD and a user cohort's first_version do not attest to the
  // version serving the entire test. Runtime attestation is a separate gate.
  db.prepare('INSERT INTO experiment_contexts(experiment_id,context_json) VALUES (?,?)')
    .run(experimentId,JSON.stringify(context));
  store.audit('system','experiment.context_captured',experimentId,context);
  return db.prepare('SELECT * FROM experiment_contexts WHERE experiment_id=?').get(experimentId);
}

export function readExperimentContext(db,experimentId){
  const saved=db.prepare('SELECT context_json FROM experiment_contexts WHERE experiment_id=?').get(experimentId);
  return saved?JSON.parse(saved.context_json):null;
}

export function assertExperimentContextCurrent(db,experiment){
  const context=readExperimentContext(db,experiment.id);
  if(!context)throw new Error('experiment context missing; refresh the unfunded proposal before approval');
  const project=row(db,'projects',experiment.project_id),candidate=row(db,'candidates',experiment.candidate_id),
    creative=row(db,'creatives',experiment.creative_id);
  const current={productScope:project.scope,destination:project.destination,market:project.market,
    language:project.language,targetCpa:project.target_cpa,surface:candidate.surface,candidate:candidate.value,
    target:JSON.parse(candidate.target_json),angle:creative.angle,
    creative:{adText:creative.ad_text,bannerText:creative.banner_text,imageSha256:creative.image_sha256}};
  if(Object.entries(current).some(([key,value])=>!isDeepStrictEqual(context[key],value)))
    throw new Error('experiment context changed; prepare and approve a new creative');
}

export function hasVerifiedContext(context){
  return context?.schema===1&&Number.isInteger(context.hypothesisId)&&context.hypothesisId>0&&
    typeof context.productVersion==='string'&&!!context.productVersion.trim()&&
    typeof context.productVersionEvidence==='object'&&context.productVersionEvidence!==null&&
    context.productVersionEvidence.verified===true&&typeof context.productVersionEvidence.source==='string'&&
    !!context.productVersionEvidence.source.trim();
}

export function learningGroupKey(context){
  return JSON.stringify([context.hypothesisId,context.productScope,context.destination,context.market,context.language,context.surface,
    context.productVersion,context.targetCpa]);
}

export function usableInsights(store,project){
  return store.db.prepare(`SELECT scope,claim,evidence_json FROM insights
    WHERE project_id=? AND status='validated' ORDER BY id DESC`).all(project.id).filter(insight=>{
    let evidence;try{evidence=JSON.parse(insight.evidence_json);}catch{return false;}
    return hasVerifiedContext(evidence.context)&&evidence.context.market===project.market&&
      evidence.context.language===project.language&&evidence.context.targetCpa===project.target_cpa&&
      evidence.context.productScope===project.scope&&evidence.context.destination===project.destination;
  }).slice(0,30);
}
