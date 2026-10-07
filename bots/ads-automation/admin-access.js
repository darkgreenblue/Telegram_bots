import { readFileSync,statSync } from 'node:fs';

export function adminAccess(ownerId,{path='./data/admin-access.json',read=()=>{
  const info=statSync(path);
  if(!info.isFile()||(info.mode&0o077))throw new Error('private admin configuration required');
  return readFileSync(path,'utf8');
},log=()=>{}}={}){
  if(!Number.isSafeInteger(ownerId)||ownerId<1)throw new Error('valid owner required');
  const fallback={adminIds:[ownerId],notificationId:ownerId};
  try{
    const c=JSON.parse(read());
    if(c.schema!==1||!Array.isArray(c.adminIds)||c.adminIds.some(id=>!Number.isSafeInteger(id)||id<1))
      throw new Error('invalid administrator list');
    const adminIds=[...new Set([ownerId,...c.adminIds])],notificationId=c.notificationId??ownerId;
    if(!adminIds.includes(notificationId))throw new Error('notification recipient must be an administrator');
    return {adminIds,notificationId};
  }catch(error){
    if(error.code!=='ENOENT')log('admin.config_rejected',{kind:error.name||'Error'});
    return fallback;
  }
}

export function bannerReply(store,{chatId,messageId,legacyOwnerId}){
  return store.db.prepare(`SELECT b.* FROM banner_requests b JOIN admin_deliveries d
    ON d.kind='banner' AND d.entity_id=b.id WHERE d.chat_id=? AND d.message_id=?`).get(chatId,messageId)
    ??(chatId===legacyOwnerId?store.db.prepare('SELECT * FROM banner_requests WHERE message_id=?').get(messageId):null);
}
