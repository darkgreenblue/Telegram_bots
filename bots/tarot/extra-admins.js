import {readFileSync,statSync} from 'node:fs';

// Only the Persian and unified bot were authorized. The two legacy standalone
// locale processes share this directory but must never inherit these grants.
export function extraAdmins(profile,{read=()=>{
  const path='./data/admin-access.json',info=statSync(path);
  if(!info.isFile()||(info.mode&0o077))throw new Error('private administrator configuration required');
  return readFileSync(path,'utf8');
},log=()=>{}}={}){
  if(!['.env','.env.ru'].includes(profile))return [];
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
