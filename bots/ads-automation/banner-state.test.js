import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,row } from './db.js';
import { submitBannerImage,currentBannerRequest } from './banner-state.js';
import { applyBrainResult } from './brain.js';
import { sendAdminQueue } from './admin.js';

function fixture(){
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl@en','https://t.me/examplebot','Global','en','test')`).run();
  store.db.prepare(`INSERT INTO creatives(id,project_id,angle,ad_text,banner_text,status)
    VALUES (1,1,'curiosity','Explore a reading','Your daily reflection','needs_image')`).run();
  store.db.prepare(`INSERT INTO banner_requests(id,creative_id,revision,prompt,message_id,status)
    VALUES (1,1,1,'first prompt',100,'sent')`).run();
  return store;
}

test('a repeated or superseded banner reply cannot enqueue another QA job',()=>{
  const store=fixture();
  try{
    const id=submitBannerImage(store,1,'/test/current.png');
    assert.equal(row(store.db,'creatives',1).status,'awaiting_qa');
    assert.throws(()=>submitBannerImage(store,1,'/test/duplicate.png'),/stale or already submitted/);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
    const job=row(store.db,'jobs',id);
    store.db.prepare("INSERT INTO banner_requests(creative_id,revision,prompt,status) VALUES (1,2,'new prompt','pending')").run();
    assert.equal(currentBannerRequest(store.db,1),null);
    assert.throws(()=>applyBrainResult(store,job,{approved:true,text_matches:true,language_matches:true,issues:[]},
      {preparedBanner:{path:'/test/old.jpg',sha256:'old'}}),/stale banner QA/);
    assert.equal(row(store.db,'creatives',1).image_path,null);
  }finally{store.close();}
});

test('failed QA requests a revision and current approved QA accepts only prepared output',()=>{
  const store=fixture();
  try{
    let id=submitBannerImage(store,1,'/test/current.png');
    applyBrainResult(store,row(store.db,'jobs',id),{approved:false,text_matches:false,language_matches:true,issues:['misspelled word']});
    assert.equal(row(store.db,'creatives',1).status,'qa_failed');
    const revision=store.db.prepare("SELECT * FROM jobs WHERE kind='image_revision'").get();
    applyBrainResult(store,revision,{prompt:'corrected prompt'});
    const request=store.db.prepare('SELECT * FROM banner_requests ORDER BY revision DESC LIMIT 1').get();
    store.db.prepare("UPDATE banner_requests SET status='sent',message_id=101 WHERE id=?").run(request.id);
    id=submitBannerImage(store,request.id,'/test/new.png');
    const job=row(store.db,'jobs',id),result={approved:true,text_matches:true,language_matches:true,issues:[]};
    assert.throws(()=>applyBrainResult(store,job,result),/was not prepared/);
    applyBrainResult(store,job,result,{preparedBanner:{path:'/test/new.jpg',sha256:'new'}});
    assert.equal(row(store.db,'creatives',1).status,'approved');
    assert.equal(row(store.db,'creatives',1).image_sha256,'new');
  }finally{store.close();}
});

test('long prompts are delivered intact with their reply mapping',async()=>{
  const store=fixture();
  try{
    const prompt='Exact English prompt. '.repeat(250);
    store.db.prepare("UPDATE banner_requests SET prompt=?,status='pending',message_id=NULL WHERE id=1").run(prompt);
    let received;
    const bot={telegram:{sendMessage:async()=>assert.fail('long prompt must not be truncated'),
      sendDocument:async(owner,document,options)=>{received={owner,document,options};return {message_id:321};}}};
    await sendAdminQueue(store,bot,123);
    assert.equal(received.document.source.toString('utf8'),prompt);
    assert.equal(store.db.prepare('SELECT message_id,status FROM banner_requests WHERE id=1').get().message_id,321);
  }finally{store.close();}
});
