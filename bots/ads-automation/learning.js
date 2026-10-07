import { canGraduate, TEST_TON } from './policy.js';

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
  const experiments=db.prepare(`SELECT e.id,e.candidate_id,e.creative_id,c.value,c.surface,c.hypothesis,cr.angle
    FROM experiments e JOIN candidates c ON c.id=e.candidate_id JOIN creatives cr ON cr.id=e.creative_id
    WHERE e.project_id=? AND e.ad_id IS NOT NULL`).all(projectId);
  const groups=new Map(),validated=new Set();
  for(const e of experiments){
    const rounds=db.prepare('SELECT number,spent,actions,views,ended_at FROM rounds WHERE experiment_id=? ORDER BY number').all(e.id);
    if(!rounds.length)continue;
    const evidence={market:project.market,language:project.language,surface:e.surface,candidate:e.value,
      experimentId:e.id,creativeId:e.creative_id,angle:e.angle,rounds,
      qualification:{targetCpa:project.target_cpa,testTon:TEST_TON,minimumActions:5}};
    const claim=`${e.value}: نتیجهٔ مشاهده‌شده برای زاویهٔ ${e.angle} (تست #${e.id})`;
    upsert(store,projectId,'candidate',claim,'observed',evidence,e.hypothesis);
    if(canGraduate(rounds,project.target_cpa)){
      validated.add(upsert(store,projectId,'channel',`${e.value}: دو نوبت تست زاویهٔ ${e.angle} زیر CPA هدف بود (تست #${e.id})`,
        'validated',evidence,e.hypothesis));
      if(e.hypothesis.trim()){
        const arr=groups.get(e.hypothesis)||[];arr.push(evidence);groups.set(e.hypothesis,arr);
      }
    }
  }
  for(const [hypothesis,entries] of groups){
    const candidates=new Set(entries.map(e=>e.candidate)),angles=new Set(entries.map(e=>e.angle));
    if(candidates.size<3||angles.size<2)continue;
    const claim=`در ${candidates.size} مقصد مستقل، فرضیهٔ «${hypothesis}» با حداقل دو زاویه زیر CPA هدف تکرار شد`;
    validated.add(upsert(store,projectId,'product',claim,'validated',{
      market:project.market,language:project.language,candidates:[...candidates],angles:[...angles],experiments:entries},hypothesis));
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
