import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,addJob,leaseJob,row } from './db.js';
import { failBrainJob,recoverQuotaJobs,isProviderQuotaError } from './brain-recovery.js';
const fixture=()=>openStore(':memory:');

test('quota waits do not consume attempts or lease other jobs, and persist in the database',()=>{
  const s=fixture();try{
    const id=addJob(s.db,null,'copy',{});addJob(s.db,null,'research',{});
    leaseJob(s.db,'owner',1000);
    assert.equal(failBrainJob(s,{id,owner:'owner',quota:true,error:"You’ve hit your usage limit"},1001).status,'queued');
    assert.equal(row(s.db,'jobs',id).attempts,0);
    assert.equal(leaseJob(s.db,'other',2000),null);
    assert.equal(leaseJob(s.db,'other',2801).id,id);
    assert.equal(s.db.prepare('SELECT count(*) n FROM operations').get().n,0);
  }finally{s.close();}
});

test('quota cooldown is provider scoped, and the individual job cannot immediately retry elsewhere',()=>{
  const s=fixture();try{
    const id=addJob(s.db,null,'copy',{}),second=addJob(s.db,null,'copy',{});
    leaseJob(s.db,'one',1000);
    failBrainJob(s,{id,owner:'one',quota:true,error:'usage limit reached'},1001);
    assert.equal(leaseJob(s.db,'two',1002,'claude').id,second);
    assert.equal(leaseJob(s.db,'three',1003),null);
  }finally{s.close();}
});

test('validation errors have bounded delayed retries and cannot forge quota evidence',()=>{
  const s=fixture();try{
    const id=addJob(s.db,null,'copy',{});
    for(let attempt=1;attempt<=3;attempt++){
      const now=1000*attempt;leaseJob(s.db,'owner',now);
      assert.throws(()=>failBrainJob(s,{id,owner:'owner',quota:true,error:'invalid result'},now),/evidence/);
      failBrainJob(s,{id,owner:'owner',error:'invalid result'},now);
      assert.equal(row(s.db,'jobs',id).status,attempt<3?'queued':'error');
      assert.equal(leaseJob(s.db,'owner',now+1),null);
    }
    assert.deepEqual(recoverQuotaJobs(s),{recovered:[]});
  }finally{s.close();}
});

test('expired and wrong leases cannot fail or defer a job',()=>{
  const s=fixture();try{
    const id=addJob(s.db,null,'copy',{});leaseJob(s.db,'owner',1000);
    assert.throws(()=>failBrainJob(s,{id,owner:'wrong'},1001),/lease/);
    assert.throws(()=>failBrainJob(s,{id,owner:'owner'},1901),/lease/);
    assert.equal(row(s.db,'jobs',id).status,'leased');
  }finally{s.close();}
});

test('historical quota failures recover once with original errors and audit evidence retained',()=>{
  const s=fixture();try{
    const id=addJob(s.db,null,'peer_review',{}),invalid=addJob(s.db,null,'peer_review',{});
    s.db.prepare("UPDATE jobs SET status='error',attempts=3,error=? WHERE id=?").run('codex exited 1: You’ve hit your usage limit',id);
    s.db.prepare("UPDATE jobs SET status='error',attempts=3,error='invalid result' WHERE id=?").run(invalid);
    assert.deepEqual(recoverQuotaJobs(s),{recovered:[id]});
    assert.deepEqual(recoverQuotaJobs(s),{recovered:[]});
    assert.match(row(s.db,'jobs',id).error,/usage limit/);
    assert.equal(row(s.db,'jobs',invalid).status,'error');
    assert.equal(s.db.prepare("SELECT count(*) n FROM audit WHERE action='job.quota_recovered'").get().n,1);
    assert.equal(isProviderQuotaError('network timeout'),false);
  }finally{s.close();}
});

test('measured established peers are reviewed before small peers without granting eligibility',()=>{
  const s=fixture();try{
    const small=addJob(s.db,null,'peer_review',{peer:{kind:'bots',audience:{value:30}}});
    const big=addJob(s.db,null,'peer_review',{peer:{kind:'bots',audience:{value:23000}}});
    assert.equal(leaseJob(s.db,'first',1000).id,big);
    assert.equal(leaseJob(s.db,'second',1000).id,small);
    assert.equal(s.db.prepare('SELECT count(*) n FROM experiments').get().n,0);
  }finally{s.close();}
});
