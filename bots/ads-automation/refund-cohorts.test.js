import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readCampaignCohorts } from './cohorts.js';

const DAY=86400,at=100*DAY;
const profile={userPk:'telegram_id',paymentTable:'payments',amountColumn:'amount',successStatus:'approved',
  revenueUnit:'star',refundEvidence:'tarot-stars-v1'};
function fixture(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE users(telegram_id INTEGER PRIMARY KEY,first_source TEXT,first_version TEXT);
    CREATE TABLE events(id INTEGER PRIMARY KEY,user_id INTEGER,event TEXT,props TEXT,created_at INTEGER);
    CREATE TABLE payments(id INTEGER PRIMARY KEY,user_id INTEGER,amount INTEGER,status TEXT,approved_at INTEGER,charge_id TEXT);
    INSERT INTO users VALUES(1,'campaign:A','v1'),(2,'campaign:B','v2');`);
  const event=(uid,name,props,time)=>db.prepare('INSERT INTO events(user_id,event,props,created_at) VALUES(?,?,?,?)')
    .run(uid,name,JSON.stringify(props),time);
  event(1,'start',{new:true,kind:'campaign',code:'A'},at-40*DAY);
  event(2,'start',{new:true,kind:'campaign',code:'B'},at-40*DAY);
  db.prepare('INSERT INTO payments VALUES(1,1,40,?,?,?)').run('approved',at-38*DAY,'charge');
  const read=(time=at,p=profile)=>readCampaignCohorts(db,{codes:['A','B'],at:time,profile:p}).byCode;
  return {db,event,read};
}

test('late real Stars refunds revise original windows once and remain separate from internal credit',()=>{
  const f=fixture();try{
    assert.equal(f.read().A[7].netReceivedRevenue,40);
    f.event(1,'refund',{amount:9000},at-2*DAY);f.event(1,'chat_refund',{amount:5000},at-DAY);
    assert.equal(f.read().A[7].refunds,0);
    f.db.exec("UPDATE payments SET status='reversed'");
    f.event(1,'payment_refunded',{payment_id:1,amount:40,clawed:9000},at-DAY);
    f.event(1,'payment_refunded',{payment_id:1,amount:40,clawed:9000},at-DAY);
    for(const days of [7,30]){
      const c=f.read().A[days];assert.equal(c.grossReceivedRevenue,40);assert.equal(c.refunds,40);
      assert.equal(c.netReceivedRevenue,0);assert.equal(c.lateRefundRevenue,40);assert.equal(c.refundedPayments,1);
      assert.equal(c.revenue,0);assert.equal(c.versions[0].refundedRevenue,40);
    }
    assert.equal(f.read().B[7].refunds,0);
  }finally{f.db.close();}
});

test('reversal, missing charge, amount conflict, wrong user and future refund cannot masquerade as known net receipts',()=>{
  for(const fault of ['reversal','charge','amount','user','future','before-approval','ledger']){
    const f=fixture();try{
      if(fault!=='ledger')f.db.exec("UPDATE payments SET status='reversed'");
      if(fault==='charge')f.db.exec('UPDATE payments SET charge_id=NULL');
      if(fault!=='reversal')f.event(fault==='user'?2:1,'payment_refunded',
        {payment_id:1,amount:fault==='amount'?999:40},fault==='future'?at+DAY:fault==='before-approval'?at-39*DAY:at-DAY);
      const c=f.read().A[7];assert.equal(c.refundEvidenceKnown,false,fault);
      assert.equal(c.refunds,null,fault);assert.equal(c.netReceivedRevenue,null,fault);
    }finally{f.db.close();}
  }
});

test('refund age cannot pull a payment outside the acquisition window into it',()=>{
  const f=fixture();try{
    f.db.prepare("UPDATE payments SET approved_at=?,status='reversed'").run(at-30*DAY);
    f.event(1,'payment_refunded',{payment_id:1,amount:40},at-DAY);
    assert.equal(f.read().A[7].refunds,0);assert.equal(f.read().A[30].refunds,40);
    assert.equal(f.read(at-35*DAY).A[7].eligibleUsers,0);
  }finally{f.db.close();}
});

test('unknown schema, wrong unit or missing contract keeps refunds unavailable; malformed orphan evidence is not ignored',()=>{
  const f=fixture();try{
    for(const p of [{...profile,refundEvidence:null},{...profile,revenueUnit:'toman'}]){
      assert.equal(f.read(at,p).A[7].refunds,null);
    }
    f.event(1,'payment_refunded',{payment_id:999,amount:40},at-DAY);
    assert.equal(f.read().A[7].refunds,null);
    f.db.exec('ALTER TABLE payments DROP COLUMN charge_id');
    assert.equal(f.read().A[7].refunds,null);
  }finally{f.db.close();}
});
