import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { retargetUnfundedProject } from './project-retarget.js';
const options={env:{ADS_LIVE_ENABLED:'0',ADS_COST_GATE_VERIFIED:'0'},runtime:()=>({verified:true,languages:['en','pt'],username:'TAROT_PT_BOT',version:'3.155.0'})};
function fixture(){const s=openStore(':memory:');s.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
  VALUES(1,'pilot','Pilot','tarot-intl@en','https://t.me/TAROOT_RU_BOT','English global','en','fixture')`).run();return s;}
test('identity cutover is audited and idempotent without financial authority',()=>{
  const s=fixture();try{
    assert.equal(retargetUnfundedProject(s,{projectId:1,confirm:'pilot'},options).changed,true);
    const p=s.db.prepare('SELECT * FROM projects WHERE id=1').get();assert.equal(p.scope,'tarot-intl@pt');assert.equal(p.language,'en');
    assert.equal(p.approved_spend,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM operations').get().n,0);
    assert.equal(retargetUnfundedProject(s,{projectId:1,confirm:'pilot'},options).changed,false);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM audit').get().n,1);
  }finally{s.close();}
});
test('active gates, unverifiable runtime and historic operations fence retargeting',()=>{
  const s=fixture();try{
    assert.throws(()=>retargetUnfundedProject(s,{projectId:1,confirm:'pilot'},{...options,env:{...options.env,ADS_LIVE_ENABLED:'1'}}));
    assert.throws(()=>retargetUnfundedProject(s,{projectId:1,confirm:'pilot'},{...options,runtime:()=>({verified:false})}));
    s.db.prepare("INSERT INTO operations(op_key,method,request_json) VALUES('fixture','fixture','{}')").run();
    assert.throws(()=>retargetUnfundedProject(s,{projectId:1,confirm:'pilot'},options));
    assert.equal(s.db.prepare('SELECT destination FROM projects WHERE id=1').get().destination,'https://t.me/TAROOT_RU_BOT');
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
  }finally{s.close();}
});
