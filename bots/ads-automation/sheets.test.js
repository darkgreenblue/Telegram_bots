import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { GoogleSheetsMirror } from './sheets.js';

test('mirror replaces six tabs atomically and safely replays an ambiguous write',async()=>{
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl@en','https://t.me/samplebot','global','en','test')`).run();
  store.db.prepare(`INSERT INTO candidates(project_id,surface,value,source,hypothesis)
    VALUES (1,'search','=formula-looking text','fixture','direct')`).run();
  const calls=[],writes=[];
  const mirror=new GoogleSheetsMirror({spreadsheetId:'sheet',credentialsPath:'unused',sleep:async()=>{},fetcher:async(url,options)=>{
    calls.push(url);
    if(options.method==='GET')return Response.json({sheets:['Candidates','Tests','Insights','CompetitorEvidence','IntelligenceEstimates','MarketIntelligence','Archive'].map((title,sheetId)=>
      ({properties:{title,sheetId,gridProperties:{rowCount:1000}}}))});
    writes.push(JSON.parse(options.body));
    if(writes.length===1)throw new Error('response lost after commit');
    return Response.json({});
  }});
  mirror.cached={value:'fixture',until:Date.now()+3600000};
  assert.equal(await mirror.sync(store,1),true);
  assert.equal(calls.some(url=>url.includes('batchClear')),false);
  assert.deepEqual(writes[0],writes[1]);
  assert.deepEqual(writes[0].requests.map(r=>r.updateCells.range.sheetId),[0,1,2,3,4,5]);
  const cells=writes[0].requests[0].updateCells;
  assert.equal(cells.range.endRowIndex,1000);assert.equal(cells.fields,'userEnteredValue');
  assert.deepEqual(cells.rows[1].values[2].userEnteredValue,{stringValue:'=formula-looking text'});
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='sheets.sync'").get().n,1);
  store.close();
});

test('missing-tab creation is not retried on an ambiguous response',async()=>{
  let writes=0;
  const mirror=new GoogleSheetsMirror({spreadsheetId:'sheet',sleep:async()=>{},fetcher:async(url,options)=>{
    if(options.method==='GET')return Response.json({sheets:[]});
    writes++;throw new Error('unknown outcome');
  }});
  mirror.cached={value:'fixture',until:Date.now()+3600000};
  await assert.rejects(mirror.ensureTabs(),/network request failed/);assert.equal(writes,1);
});

test('HTTP rate limits retry with a bound and authorization failures fail promptly',async()=>{
  const delays=[];let calls=0;
  const mirror=new GoogleSheetsMirror({spreadsheetId:'sheet',sleep:async ms=>delays.push(ms),fetcher:async(url,options)=>{
    assert.ok(options.signal instanceof AbortSignal);
    calls++;return calls===1?new Response('',{status:429,headers:{'retry-after':'100'}}):Response.json({ok:true});
  }});
  assert.deepEqual(await mirror.request('https://example.com',{}, {label:'Sheets'}),{ok:true});
  assert.deepEqual(delays,[2000]);
  mirror.fetcher=async()=>{calls++;return new Response('',{status:403});};
  await assert.rejects(mirror.request('https://example.com',{}, {label:'Sheets'}),/HTTP 403/);
  assert.equal(calls,3);
});
