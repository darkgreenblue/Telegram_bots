import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {processFingerprint,startRuntimeProof} from './runtime-proof.js';

test('kernel boot and process start protect against PID reuse and zombies',()=>{
  const fields=Array(20).fill('0');fields[0]='R';fields[19]='1234';
  const read=path=>path.endsWith('boot_id')?'12345678-1234-1234-1234-123456789012':`42 (name with ) parentheses) ${fields.join(' ')}`;
  assert.equal(processFingerprint(42,{read}),'12345678-1234-1234-1234-123456789012:42:1234');
  fields[19]='5678';assert.match(processFingerprint(42,{read}),/:5678$/);
  fields[0]='Z';assert.equal(processFingerprint(42,{read}),null);
  assert.equal(processFingerprint(0,{read}),null);
  assert.equal(processFingerprint(42,{read:()=>{throw new Error('gone');}}),null);
});

test('launched runtime writes atomic private metadata without altering product state',()=>{
  const dir=mkdtempSync(join(tmpdir(),'runtime-proof-')),file=join(dir,'runtime-ru.json');
  let stop;try{
    stop=startRuntimeProof(file,{version:'3.154.0',username:'examplebot',languages:['en','ru'],fingerprint:'fixture-process',clock:()=>1000});
    const proof=JSON.parse(readFileSync(file));assert.equal(proof.version,'3.154.0');
    assert.equal(proof.at,1000);assert.equal(proof.launchedAt,1000);
    assert.deepEqual(proof.languages,['en','ru']);assert.equal(statSync(file).mode&0o077,0);
  }finally{stop?.();rmSync(dir,{recursive:true,force:true});}
});

test('unavailable identity and write failures are fail-safe',()=>{
  const logs=[];
  const stop=startRuntimeProof('/not/a/writable/runtime.json',{version:'bad',username:'examplebot',languages:['en'],
    fingerprint:null,logErr:(...args)=>logs.push(args)});
  stop();assert.equal(logs.length,1);assert.match(logs[0][1],/identity/);
});
