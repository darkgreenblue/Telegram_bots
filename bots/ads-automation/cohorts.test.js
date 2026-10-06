import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readCampaignCohorts } from './cohorts.js';

const DAY=86400,at=100*DAY;
const profile={userPk:'telegram_id',paymentTable:'payments',amountColumn:'amount',successStatus:'approved',revenueUnit:'star'};
function fixture(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE users(telegram_id INTEGER PRIMARY KEY,first_source TEXT,first_version TEXT);
    CREATE TABLE events(id INTEGER PRIMARY KEY,user_id INTEGER,event TEXT,props TEXT,created_at INTEGER);
    CREATE TABLE payments(id INTEGER PRIMARY KEY,user_id INTEGER,amount INTEGER,status TEXT,approved_at INTEGER,created_at INTEGER);`);
  const user=(id,age,version='v1',source='campaign:A')=>{
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,source,version);
    db.prepare("INSERT INTO events(user_id,event,props,created_at) VALUES(?,'start',?,?)")
      .run(id,JSON.stringify({new:true,kind:source.startsWith('campaign:')?'campaign':'organic',code:source.slice(9)}),at-age*DAY);
  };
  const payment=(id,days,amount,status='approved')=>db.prepare(`INSERT INTO payments(user_id,amount,status,approved_at,created_at)
    SELECT ?,?,?,MIN(created_at)+?,MIN(created_at) FROM events WHERE user_id=?`).run(id,amount,status,days*DAY,id);
  return {db,user,payment,read:()=>readCampaignCohorts(db,{codes:['A','B'],at,profile})};
}

test('7/30-day cohorts exclude immature users, retain versions, and use approval time with half-open windows',()=>{
  const f=fixture();
  try{
    f.user(1,40);f.user(2,10,'v2');f.user(3,3);f.user(4,40,'v2','campaign:B');
    f.payment(1,1,10);f.payment(1,7,20);f.payment(1,12,30);f.payment(1,31,40);
    f.payment(2,2,50);f.payment(3,1,99);f.payment(4,3,15);
    const {byCode}=f.read();
    assert.equal(byCode.A[7].eligibleUsers,2);assert.equal(byCode.A[7].immatureUsers,1);
    assert.equal(byCode.A[7].payers,2);assert.equal(byCode.A[7].revenue,60);
    assert.equal(byCode.A[30].eligibleUsers,1);assert.equal(byCode.A[30].immatureUsers,2);
    assert.equal(byCode.A[30].revenue,60);assert.equal(byCode.B[7].revenue,15);
    assert.deepEqual(byCode.A[7].versions.map(v=>v.productVersion),['v1','v2']);
    assert.equal(byCode.A[7].refunds,null);
  }finally{f.db.close();}
});

test('returning organic payers, administrators, test accounts, pending and refunded payments stay outside acquisition quality',()=>{
  const f=fixture();
  try{
    f.user(1,40);f.user(2,40,'v1','organic');f.user(3,40);f.user(4,40);
    f.db.prepare("INSERT INTO events(user_id,event,props,created_at) VALUES(2,'start',?,?)")
      .run(JSON.stringify({new:false,kind:'campaign',code:'A'}),at-8*DAY);
    f.db.prepare("INSERT INTO events(user_id,event,props,created_at) VALUES(3,'start','{\"adm\":1}',?)").run(at-40*DAY);
    f.payment(1,1,10);f.payment(1,2,90,'pending');f.payment(1,3,80,'refunded');
    f.payment(2,2,100);f.payment(3,2,100);f.payment(4,2,100);
    const data=readCampaignCohorts(f.db,{codes:['A'],at,profile:{...profile,excludedUsers:[4]}}).byCode.A[7];
    assert.equal(data.eligibleUsers,1);assert.equal(data.payers,1);assert.equal(data.revenue,10);
  }finally{f.db.close();}
});

test('late records refresh historical age windows; missing acquisition/payment timestamps are unknown',()=>{
  const f=fixture();
  try{
    f.user(1,40);f.user(2,40);f.db.prepare('DELETE FROM events WHERE user_id=2').run();
    assert.equal(f.read().byCode.A[7].revenue,0);
    f.payment(1,2,25);assert.equal(f.read().byCode.A[7].revenue,25);
    f.db.prepare('UPDATE payments SET approved_at=NULL').run();
    const data=f.read().byCode.A[7];
    assert.equal(data.paymentQualityKnown,false);assert.equal(data.revenue,null);assert.equal(data.payers,null);
    assert.equal(data.unknownAcquisitionUsers,1);
    f.db.exec('ALTER TABLE payments DROP COLUMN approved_at');
    assert.equal(f.read().byCode.A[7].paymentQualityKnown,false);
  }finally{f.db.close();}
});

test('an unavailable acquisition schema and invalid inputs fail instead of returning zeros',()=>{
  const f=fixture();
  try{
    assert.throws(()=>readCampaignCohorts(f.db,{codes:["A'); DROP TABLE users;"],at,profile}),/invalid cohort codes/);
    assert.throws(()=>readCampaignCohorts(f.db,{codes:['A'],at:NaN,profile}),/invalid cohort time/);
    f.db.exec('DROP TABLE events');assert.throws(()=>f.read(),/schema unavailable/);
  }finally{f.db.close();}
});
