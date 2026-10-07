import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readProductRuntime,sameProductRuntime,sameProductVersion} from './product-runtime.js';
import {verifiedRoundContext} from './learning-context.js';

const project={scope:'tarot-intl@en',destination:'https://t.me/examplebot',language:'en'};
const proof={schema:1,version:'3.154.0',username:'examplebot',languages:['en','ru'],pid:42,
  fingerprint:'fixture-process',at:100000,launchedAt:50000};
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'ads-runtime-')),file=join(dir,'runtime-ru.json');
  const write=value=>writeFileSync(file,JSON.stringify(value),{mode:0o600});write(proof);
  return {dir,file,write,options:{dataDirectory:dir,at:101000,fingerprint:()=>proof.fingerprint},close:()=>rmSync(dir,{recursive:true,force:true})};
}

test('version comes from the matching live process and requested language, not source HEAD',()=>{
  const f=fixture();try{
    const result=readProductRuntime(project,f.options);assert.equal(result.verified,true);assert.equal(result.version,'3.154.0');
    renameSync(f.file,join(f.dir,'runtime-en.json'));assert.equal(readProductRuntime(project,f.options).verified,true);
    assert.equal(readProductRuntime({...project,language:'de'},f.options).verified,false);
    assert.equal(readProductRuntime({...project,destination:'https://t.me/otherbot'},f.options).verified,false);
    assert.equal(readProductRuntime({...project,scope:'other'},f.options).verified,false);
  }finally{f.close();}
});

test('stale, future, dead/reused PID, malformed, public and symlink metadata fail closed',()=>{
  const f=fixture();try{
    for(const change of [x=>x.at=1,x=>x.at=200000,x=>x.launchedAt=200000,x=>x.version='unknown',x=>x.fingerprint='reused']){
      const value={...proof};change(value);f.write(value);assert.equal(readProductRuntime(project,f.options).verified,false);
    }
    f.write(proof);chmodSync(f.file,0o644);assert.equal(readProductRuntime(project,f.options).verified,false);chmodSync(f.file,0o600);
    assert.equal(readProductRuntime(project,{...f.options,fingerprint:()=>null}).verified,false);
    rmSync(f.file);const target=join(f.dir,'other.json');writeFileSync(target,JSON.stringify(proof),{mode:0o600});
    symlinkSync(target,f.file);assert.equal(readProductRuntime(project,f.options).verified,false);
  }finally{f.close();}
});

test('changed process or version holds test validation; a same-version later boot may reuse completed insights',()=>{
  const captured={...proof,verified:true,source:'isolated fixture'},context={schema:2,hypothesisId:1,productVersion:proof.version,productVersionEvidence:captured};
  const round=value=>({product_runtime_json:JSON.stringify(value)});
  assert.equal(verifiedRoundContext(context,[round(captured),round(captured)]),true);
  assert.equal(verifiedRoundContext(context,[round(captured),round({...captured,version:'3.155.0'})]),false);
  assert.equal(verifiedRoundContext(context,[round(captured),round({...captured,fingerprint:'other-process'})]),false);
  assert.equal(verifiedRoundContext(context,[round(captured),round({verified:false})]),false);
  assert.equal(verifiedRoundContext(context,[]),false);
  assert.equal(sameProductRuntime(captured,{...captured,fingerprint:'other'}),false);
  assert.equal(sameProductVersion(captured,{...captured,fingerprint:'other'}),true);
  assert.equal(verifiedRoundContext({...context,schema:1},[round(captured)]),false);
});
