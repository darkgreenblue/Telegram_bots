import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root=resolve('bots/tarot'),require=createRequire(join(root,'index.js'));
const dotenv=require('dotenv');
const source=dotenv.parse(readFileSync(join(root,'.env.ru'))).BOT_TOKEN;
const destination=dotenv.parse(readFileSync(join(root,'.env.pt'))).BOT_TOKEN;
const folder=join(root,'data','handover','profile');mkdirSync(folder,{recursive:true,mode:0o700});
const applying=process.argv.includes('--apply');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function api(token,method,args={},form=null){
  try{
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
      method:'POST',signal:AbortSignal.timeout(20000),
      ...(form?{body:form}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(args)})});
    const body=await response.json();
    if(!body.ok)throw new Error(`API ${method} rejected (${body.error_code})`);
    return body.result;
  }catch(error){
    // Never print a transport URL containing credentials or blindly replay a write.
    if(error.message.startsWith('API '))throw error;
    throw new Error(`API ${method} outcome unavailable; reconcile before retry`);
  }
}
async function photo(token,id){
  const photos=await api(token,'getUserProfilePhotos',{user_id:id,limit:1});
  const largest=photos.photos?.[0]?.at(-1);if(!largest)return null;
  const file=await api(token,'getFile',{file_id:largest.file_id});
  try{
    const response=await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error();return Buffer.from(await response.arrayBuffer());
  }catch{throw new Error('profile photo download unavailable');}
}
async function capture(token,id){
  const fields=[];
  for(const language_code of ['','en','es','ru','pt']){
    const arg=language_code?{language_code}:{};
    fields.push({language_code,name:(await api(token,'getMyName',arg)).name,
      short_description:(await api(token,'getMyShortDescription',arg)).short_description,
      description:(await api(token,'getMyDescription',arg)).description,
      commands:await api(token,'getMyCommands',arg)});
  }
  const bytes=await photo(token,id);return {fields,photoSha:bytes?digest(bytes):null,bytes};
}
try{
  const sourceMe=await api(source,'getMe'),destinationMe=await api(destination,'getMe');
  if(sourceMe.username!=='TAROOT_RU_BOT'||destinationMe.username!=='TAROT_PT_BOT')throw new Error('profile identity mismatch');
  const snapshotPath=join(folder,'original.json');let snapshot;
  if(existsSync(snapshotPath))snapshot=JSON.parse(readFileSync(snapshotPath));
  else{
    const from=await capture(source,sourceMe.id),to=await capture(destination,destinationMe.id);
    if(from.bytes)writeFileSync(join(folder,'source.jpg'),from.bytes,{mode:0o600});
    if(to.bytes)writeFileSync(join(folder,'destination-before.jpg'),to.bytes,{mode:0o600});
    snapshot={at:new Date().toISOString(),source:{username:sourceMe.username,fields:from.fields,photoSha:from.photoSha},
      destination:{username:destinationMe.username,fields:to.fields,photoSha:to.photoSha}};
    writeFileSync(snapshotPath,JSON.stringify(snapshot),{mode:0o600});
  }
  if(!applying){console.log(JSON.stringify({event:'profile.snapshot',source:sourceMe.username,destination:destinationMe.username,localizedProfiles:snapshot.source.fields.length}));process.exit(0);}
  for(const field of snapshot.source.fields){
    const arg=field.language_code?{language_code:field.language_code}:{};
    for(const [get,set,key] of [['getMyName','setMyName','name'],['getMyShortDescription','setMyShortDescription','short_description'],['getMyDescription','setMyDescription','description']]){
      if((await api(destination,get,arg))[key]!==field[key])await api(destination,set,{...arg,[key]:field[key]});
      if((await api(destination,get,arg))[key]!==field[key])throw new Error(`profile ${key} verification failed`);
    }
    if(JSON.stringify(await api(destination,'getMyCommands',arg))!==JSON.stringify(field.commands))
      await api(destination,'setMyCommands',{...arg,commands:field.commands});
  }
  const photoMarker=join(folder,'photo-attempt.json');
  if(snapshot.source.photoSha&&snapshot.source.photoSha!==snapshot.destination.photoSha&&!existsSync(photoMarker)){
    const bytes=readFileSync(join(folder,'source.jpg'));
    if(digest(bytes)!==snapshot.source.photoSha)throw new Error('source photo digest mismatch');
    writeFileSync(photoMarker,JSON.stringify({status:'attempted',sha:snapshot.source.photoSha}),{mode:0o600});
    const form=new FormData();form.set('photo',JSON.stringify({type:'static',photo:'attach://image'}));
    form.set('image',new Blob([bytes],{type:'image/jpeg'}),'profile.jpg');
    await api(destination,'setMyProfilePhoto',{},form);
    writeFileSync(photoMarker,JSON.stringify({status:'confirmed',sha:snapshot.source.photoSha}),{mode:0o600});
  }
  if(existsSync(photoMarker)&&JSON.parse(readFileSync(photoMarker)).status!=='confirmed')
    throw new Error('profile photo outcome requires reconciliation');
  const verified=await capture(destination,destinationMe.id);
  if(JSON.stringify(verified.fields)!==JSON.stringify(snapshot.source.fields))throw new Error('profile verification failed');
  if(verified.bytes)writeFileSync(join(folder,'destination-after.jpg'),verified.bytes,{mode:0o600});
  writeFileSync(join(folder,'verified.json'),JSON.stringify({at:new Date().toISOString(),username:destinationMe.username,
    fieldsMatch:true,photoPresent:!!verified.photoSha,photoSha:verified.photoSha}),{mode:0o600});
  console.log(JSON.stringify({event:'profile.copy.verified',username:destinationMe.username,fieldsMatch:true,localizedProfiles:verified.fields.length}));
}catch(error){console.error(JSON.stringify({event:'profile.copy.failed',reason:error.message}));process.exitCode=1;}
