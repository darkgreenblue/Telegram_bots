import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore } from './db.js';

test('existing automation databases gain spend reservations without losing campaigns',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ads-db-migration-'));
  const path=join(dir,'ads.db');
  try{
    const store=openStore(path);
    store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
      VALUES (1,'pilot','Pilot','tarot-intl@en','https://t.me/examplebot','EN-global','en','test')`).run();
    store.db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis)
      VALUES (1,1,'bots','@examplebot','test','test')`).run();
    store.db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text)
      VALUES (1,1,1,'test','test')`).run();
    store.db.prepare(`INSERT INTO experiments(id,project_id,candidate_id,creative_id,title,cpm,placement,
      ad_id,status,allocated_total,last_spent) VALUES (1,1,1,1,'existing',0.13,'bot_banner',444,'winner',1,0.2)`).run();
    store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json)
      VALUES (1,1,1,'recharge','{}')`).run();
    store.close();
    const old=new Database(path);
    old.exec('ALTER TABLE experiments DROP COLUMN spend_authorized');
    old.exec('ALTER TABLE decisions DROP COLUMN spend_reservation_applied');
    old.close();
    const upgraded=openStore(path);
    assert.deepEqual(upgraded.db.prepare(`SELECT ad_id,spend_authorized FROM experiments WHERE id=1`).get(),
      {ad_id:444,spend_authorized:1});
    assert.equal(upgraded.db.prepare(`SELECT spend_reservation_applied FROM decisions WHERE id=1`).get().spend_reservation_applied,0);
    upgraded.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rediscovery preserves candidate identity, collected measurements and evidence across routes',async()=>{
  const {addCandidate}=await import('./db.js');const s=openStore(':memory:');try{
    s.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
      VALUES (1,'discovery','Discovery','en','https://t.me/examplebot','Global','en','Tarot')`).run();
    const proof={audience:{value:24000},checkedAt:'now'};
    const first=addCandidate(s.db,{projectId:1,surface:'bots',value:'@ExampleBot',source:'web',hypothesis:'Direct',
      target:{z:1,a:2},features:{publicPeer:proof,initialReview:{status:'pending'}},evidence:[{url:'https://t.me/examplebot'}]});
    // A subsequent INSERT used to leave a stale lastInsertRowid for an upsert.
    addCandidate(s.db,{projectId:1,surface:'bots',value:'@AnotherBot',source:'web',hypothesis:'Other'});
    const again=addCandidate(s.db,{projectId:1,surface:'bots',value:'@examplebot',source:'recommendation',hypothesis:'Similar',
      target:{a:2,z:1},features:{publicPeer:{audience:{value:999999999}},tag:'tarot'},evidence:[{url:'https://example.com/reference'}]});
    assert.equal(again,first);
    const stored=s.db.prepare('SELECT * FROM candidates WHERE id=?').get(first);
    assert.deepEqual(JSON.parse(stored.features_json).publicPeer,proof);
    assert.equal(JSON.parse(stored.features_json).tag,'tarot');
    assert.equal(JSON.parse(stored.evidence_json).length,2);
    assert.equal(s.db.prepare('SELECT count(*) n FROM candidates').get().n,2);
  }finally{s.close();}
});
