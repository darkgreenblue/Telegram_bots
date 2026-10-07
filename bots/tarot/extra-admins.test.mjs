import test from 'node:test';
import assert from 'node:assert/strict';
import {extraAdmins} from './extra-admins.js';

test('support grants apply only to the two approved bots, never other locale bots',()=>{
 let reads=0;
 const read=()=>{reads++;return JSON.stringify({schema:1,adminIds:[123,123,456]});};
 for(const profile of ['.env','.env.ru'])assert.deepEqual(extraAdmins(profile,{read}),[123,456]);
 for(const profile of ['.env.pt','.env.es','../.env','other'])assert.deepEqual(extraAdmins(profile,{read}),[]);
 assert.equal(reads,2);
});
test('invalid or absent additional grants cannot authorize anyone or log file contents',()=>{
 const events=[];
 for(const c of [{schema:2,adminIds:[123]},{schema:1,adminIds:['123']},{schema:1,adminIds:[-1]}])
  assert.deepEqual(extraAdmins('.env',{read:()=>JSON.stringify(c),log:(event,detail)=>events.push({event,detail})}),[]);
 assert.equal(events.length,3);
 assert.deepEqual(extraAdmins('.env',{read:()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});}}),[]);
 assert.deepEqual(extraAdmins('.env',{read:()=>{throw Error('SECRET');},log:(event,detail)=>events.push({event,detail})}),[]);
 assert.equal(JSON.stringify(events).includes('SECRET'),false);
});
