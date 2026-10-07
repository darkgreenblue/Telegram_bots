import { canGraduate, TEST_TON } from './policy.js';
import { readExperimentContext,hasVerifiedContext,learningGroupKey } from './learning-context.js';

function upsert(store,projectId,scope,claim,status,evidence,hypothesis=''){
  const db=store.db,old=db.prepare('SELECT * FROM insights WHERE project_id=? AND scope=? AND claim=?').get(projectId,scope,claim);
  const serialized=JSON.stringify(evidence);
  if(old){
    if(old.evidence_json===serialized&&old.status===status&&old.hypothesis===hypothesis)return old.id;
    // The current row is a view. Its complete prior evidence remains in the
    // durable audit log, including revisions after a campaign was deleted.
    store.audit('learning','insight.revised',old.id,{previous:old,
      next:{status,evidence,hypothesis}});
    db.prepare('UPDATE insights SET evidence_json=?,status=?,hypothesis=? WHERE id=?').run(serialized,status,hypothesis,old.id);
    return old.id;
  }
  const id=Number(db.prepare(`INSERT INTO insights(project_id,scope,claim,evidence_json,hypothesis,status) VALUES (?,?,?,?,?,?)`).run(
    projectId,scope,claim,serialized,hypothesis,status).lastInsertRowid);
  store.audit('learning','insight.created',id,{scope,claim,status,evidence,hypothesis});
  return id;
}

export function refreshInsights(store,projectId){
  return store.db.transaction(()=>refresh(store,projectId))();
}

function refresh(store,projectId){
  const db=store.db,project=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if(!project)return;
  const experiments=db.prepare(`SELECT e.id,e.candidate_id,e.creative_id,c.value,c.surface
    FROM experiments e JOIN candidates c ON c.id=e.candidate_id JOIN creatives cr ON cr.id=e.creative_id
    WHERE e.project_id=? AND e.ad_id IS NOT NULL`).all(projectId);
  const groups=new Map(),validated=new Set();
  for(const e of experiments){
    const rounds=db.prepare('SELECT number,spent,actions,views,ended_at FROM rounds WHERE experiment_id=? ORDER BY number').all(e.id);
    if(!rounds.length)continue;
    const context=readExperimentContext(db,e.id);
    const value=context?.candidate??e.value,angle=context?.angle??'نامعلوم',hypothesis=context?.hypothesis??'';
    const evidence={context,contextStatus:hasVerifiedContext(context)?'verified':context?'product_version_unknown':'legacy_unknown',
      market:context?.market??null,language:context?.language??null,surface:context?.surface??e.surface,candidate:value,
      experimentId:e.id,creativeId:e.creative_id,angle,rounds,
      qualification:{targetCpa:context?.targetCpa??null,testTon:TEST_TON,minimumActions:5}};
    const claim=`${value}: نتیجهٔ مشاهده‌شده برای زاویهٔ ${angle} (تست #${e.id})`;
    upsert(store,projectId,'candidate',claim,'observed',evidence,hypothesis);
    if(hasVerifiedContext(context)&&canGraduate(rounds,context.targetCpa)){
      validated.add(upsert(store,projectId,'channel',`${value}: دو نوبت تست زاویهٔ ${angle} زیر CPA هدف بود (تست #${e.id})`,
        'validated',evidence,hypothesis));
      const key=learningGroupKey(context),arr=groups.get(key)||[];arr.push(evidence);groups.set(key,arr);
    }
  }
  for(const entries of groups.values()){
    const context=entries[0].context,hypothesis=context.hypothesis;
    const candidates=new Set(entries.map(e=>e.candidate)),angles=new Set(entries.map(e=>e.angle));
    if(candidates.size<3||angles.size<2)continue;
    const scope=`${context.market}، ${context.language}، ${context.surface}، نسخهٔ ${context.productVersion}، CPA هدف ${context.targetCpa}، فرضیهٔ #${context.hypothesisId}`;
    const claim=`در ${candidates.size} مقصد مستقل، فرضیهٔ «${hypothesis}» با حداقل دو زاویه زیر CPA هدف تکرار شد (${scope})`;
    validated.add(upsert(store,projectId,'product',claim,'validated',{
      context,market:context.market,language:context.language,candidates:[...candidates],angles:[...angles],experiments:entries},hypothesis));
  }
  // New weak/contradictory evidence removes current validation, not historical
  // proof. This also retires legacy claims that conflated separate creatives.
  for(const insight of db.prepare(`SELECT * FROM insights WHERE project_id=?
    AND scope IN ('channel','product') AND status='validated'`).all(projectId)){
    if(validated.has(insight.id))continue;
    const evidence=JSON.parse(insight.evidence_json);
    if(!Array.isArray(evidence.rounds)&&!Array.isArray(evidence.experiments))continue;
    store.audit('learning','insight.review_required',insight.id,{previous:insight,
      reason:'Current repeated complete-test evidence no longer supports this generated claim.'});
    db.prepare("UPDATE insights SET status='needs_review' WHERE id=?").run(insight.id);
  }
}
