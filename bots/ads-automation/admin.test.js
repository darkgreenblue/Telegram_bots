import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from './db.js';
import {decisionBrief,sendAdminQueue} from './admin.js';

test('a financial approval shows its actual target, copy, evidence, cost and disabled gate',async()=>{
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl@en','https://t.me/samplebot','global','en','test')`).run();
  store.db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis,evidence_json)
    VALUES (1,1,'bots','@samplebot','research','علایق مشترک مخاطبان','[{"url":"https://t.me/samplebot"}]')`).run();
  store.db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status)
    VALUES (1,1,1,'Daily reflection','Explore your daily tarot','approved')`).run();
  store.db.prepare(`INSERT INTO experiments(id,project_id,candidate_id,creative_id,title,cpm,placement)
    VALUES (1,1,1,1,'test',0.13,'bot_banner')`).run();
  store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json,evidence_json)
    VALUES (1,1,1,'create','{}','{}')`).run();
  const d=store.db.prepare('SELECT * FROM decisions WHERE id=1').get();
  const text=decisionBrief(store,d);
  for(const part of ['@samplebot','Explore your daily tarot','https://t.me/samplebot','علایق مشترک مخاطبان',
    '۱ TON','۰٫۰۵ TON','اثر رد','خرج غیرفعال'])assert.ok(text.includes(part),part);
  assert.equal(decisionBrief(store,d,{live:true,costVerified:true}).includes('خرج غیرفعال'),false);
  let message;
  await sendAdminQueue(store,{telegram:{sendMessage:async(owner,text)=>{message=text;return {message_id:100};}}},123);
  assert.ok(message.includes('@samplebot'));
  assert.equal(store.db.prepare('SELECT message_id FROM decisions WHERE id=1').get().message_id,100);
  assert.equal(store.db.prepare('SELECT spend_authorized FROM experiments WHERE id=1').get().spend_authorized,0);
  store.close();
});
