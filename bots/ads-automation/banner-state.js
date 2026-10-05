import { addJob,row } from './db.js';

export function currentBannerRequest(db,requestId){
  const request=db.prepare('SELECT * FROM banner_requests WHERE id=?').get(requestId);
  if(!request)return null;
  const latest=db.prepare('SELECT id FROM banner_requests WHERE creative_id=? ORDER BY revision DESC,id DESC LIMIT 1').get(request.creative_id);
  const creative=row(db,'creatives',request.creative_id);
  return latest?.id===request.id&&request.status==='sent'&&creative?.status==='needs_image'?request:null;
}

export function submitBannerImage(store,requestId,rawPath){
  return store.db.transaction(()=>{
    const request=currentBannerRequest(store.db,requestId);
    if(!request)throw new Error('banner request is stale or already submitted');
    const creative=row(store.db,'creatives',request.creative_id);
    const jobId=addJob(store.db,creative.project_id,'image_qa',{creativeId:creative.id,bannerRequestId:request.id,
      rawPath,exactText:creative.banner_text,language:row(store.db,'projects',creative.project_id).language,
      rules:'Reject missing/incorrect lettering, spelling, poor readability or unsafe misleading visual claims.'});
    store.db.prepare("UPDATE banner_requests SET status='submitted' WHERE id=?").run(request.id);
    store.db.prepare("UPDATE creatives SET status='awaiting_qa' WHERE id=?").run(creative.id);
    store.audit('admin-bot','banner.submitted',request.id,{creativeId:creative.id,jobId});
    return jobId;
  })();
}

export function assertCurrentBannerQa(db,input){
  const request=db.prepare('SELECT * FROM banner_requests WHERE id=?').get(input.bannerRequestId);
  const latest=db.prepare('SELECT id FROM banner_requests WHERE creative_id=? ORDER BY revision DESC,id DESC LIMIT 1').get(input.creativeId);
  const creative=row(db,'creatives',input.creativeId);
  if(!request||request.creative_id!==input.creativeId||request.id!==latest?.id||
    request.status!=='submitted'||creative?.status!=='awaiting_qa')throw new Error('stale banner QA result');
}
