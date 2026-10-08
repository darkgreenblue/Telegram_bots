import {readFileSync,statSync} from 'node:fs';

// Only the Persian and unified bot were authorized. The retired Russian and standalone Spanish
// locale processes share this directory but must never inherit these grants.
export function extraAdmins(profile,{env=process.env,read=()=>{
  const path='./data/admin-access.json',info=statSync(path);
  if(!info.isFile()||(info.mode&0o077))throw new Error('private administrator configuration required');
  return readFileSync(path,'utf8');
},log=()=>{}}={}){
  const unified=profile==='.env.pt'&&env.LOCALE==='en'&&env.STORAGE_LOCALE==='pt';
  if(profile!=='.env'&&!unified)return [];
  try{
    const c=JSON.parse(read());
    if(c.schema!==1||!Array.isArray(c.adminIds)||c.adminIds.some(id=>!Number.isSafeInteger(id)||id<1))
      throw new Error('invalid scoped administrator configuration');
    return [...new Set(c.adminIds)];
  }catch(error){
    if(error.code!=='ENOENT')log('ADMIN_ACCESS_REJECTED',{profile,kind:error.name||'Error'});
    return [];
  }
}
