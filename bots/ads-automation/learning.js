import { canGraduate } from './policy.js';

function upsert(store,projectId,scope,claim,status,evidence,hypothesis=''){
  const db=store.db,old=db.prepare('SELECT id FROM insights WHERE project_id=? AND scope=? AND claim=?').get(projectId,scope,claim);
  if(old)db.prepare('UPDATE insights SET evidence_json=?,status=? WHERE id=?').run(JSON.stringify(evidence),status,old.id);
  else db.prepare(`INSERT INTO insights(project_id,scope,claim,evidence_json,hypothesis,status) VALUES (?,?,?,?,?,?)`).run(
    projectId,scope,claim,JSON.stringify(evidence),hypothesis,status);
}

export function refreshInsights(store,projectId){
  const db=store.db,project=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if(!project)return;
  const experiments=db.prepare(`SELECT e.id,e.candidate_id,e.creative_id,c.value,c.surface,c.hypothesis,cr.angle
    FROM experiments e JOIN candidates c ON c.id=e.candidate_id JOIN creatives cr ON cr.id=e.creative_id
    WHERE e.project_id=? AND e.ad_id IS NOT NULL`).all(projectId);
  const groups=new Map();
  for(const e of experiments){
    const rounds=db.prepare('SELECT number,spent,actions,views,ended_at FROM rounds WHERE experiment_id=? ORDER BY number').all(e.id);
    if(!rounds.length)continue;
    const evidence={market:project.market,language:project.language,surface:e.surface,candidate:e.value,
      experimentId:e.id,creativeId:e.creative_id,angle:e.angle,rounds};
    const claim=`${e.value}: نتیجهٔ مشاهده‌شده برای زاویهٔ ${e.angle}`;
    upsert(store,projectId,'candidate',claim,'observed',evidence,e.hypothesis);
    if(canGraduate(rounds,project.target_cpa)){
      upsert(store,projectId,'channel',`${e.value}: دو نوبت تست این زاویه زیر CPA هدف بود`,
        'validated',evidence,e.hypothesis);
      const arr=groups.get(e.hypothesis)||[];arr.push(evidence);groups.set(e.hypothesis,arr);
    }
  }
  for(const [hypothesis,entries] of groups){
    const candidates=new Set(entries.map(e=>e.candidate)),angles=new Set(entries.map(e=>e.angle));
    if(candidates.size<3||angles.size<2)continue;
    const claim=`در ${candidates.size} مقصد مستقل، فرضیهٔ «${hypothesis}» با حداقل دو زاویه زیر CPA هدف تکرار شد`;
    upsert(store,projectId,'product',claim,'validated',{
      market:project.market,language:project.language,candidates:[...candidates],angles:[...angles],experiments:entries},hypothesis);
  }
}
