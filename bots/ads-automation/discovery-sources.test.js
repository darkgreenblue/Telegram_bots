import test from 'node:test';import assert from 'node:assert/strict';
import {openStore,addCandidate} from './db.js';
import {parseLyzem,parseCatalog,parseBotDirectory,searchDiscoverySources,discoverFromSources,queueSourceDiscovery,runSourceDiscovery} from './discovery-sources.js';
import {expandPublicPeers,publicUsernames} from './discovery-graph.js';
import {channelFeatures} from './channel-evidence.js';
import {useCompetitorFirst,prepareCandidates} from './preparation.js';
import {parsePublicPeer,recordPeerEvidence,peerReadiness} from './peer-evidence.js';

function fixture(){const s=openStore(':memory:');s.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,status)
 VALUES(1,'baseline','Baseline','en','https://t.me/examplebot','Global','en','Tarot','ready')`).run();return s;}
const proof=(name,kind='bots')=>({...parsePublicPeer(`<div class="tgme_page_extra">24 000 monthly users</div>` ,name),kind});

test('directory parser reads result cards, excludes groups and footer bots, and rejects demo catalogs',()=>{
 const card=(kind,value)=>`<li class="search-result"><div title="${kind}"></div><a href="https://t.me/${value}">Tarot</a></li>`;
 const html=card('bot','tarot_bot')+card('channel','tarot_channel')+card('group','tarot_group')+'<a href="https://t.me/support_bot">Support</a>';
 assert.deepEqual(parseLyzem(html,'https://lyzem.com/search?q=tarot').map(s=>s.value),['@tarot_bot','@tarot_channel']);
 assert.throws(()=>parseCatalog({isDemo:true,items:[]},{}),/demo/);
 assert.throws(()=>parseCatalog({data:[],meta:{isDemo:true}},{}),/demo/);
 const [seed]=parseCatalog({data:[{username:'Tarot_bot',members:123000,isSponsoredEligible:true}]},{url:'https://source',kind:'channels'});
 assert.equal(seed.providerClaims.audience,123000);assert.equal(seed.surface,undefined);
 assert.throws(()=>parseLyzem('<html>challenge</html>','https://lyzem.com/search?q=tarot'),/unexpected/);
});

test('source outage is recorded while independent sources continue; 429 is not replayed',async()=>{
 let calls=0;const routes=await searchDiscoverySources('tarot',{wait:async()=>{},fetcher:async url=>{
  calls++;if(url.includes('lyzem'))return {ok:false,status:429,headers:{get:()=>120}};
  return {ok:true,status:200,text:async()=>JSON.stringify({data:[]})};}});
 assert.equal(calls,5);assert.equal(routes[0].status,'unavailable');assert.equal(routes[1].status,'ok');
});

test('graph follows actual public mentions into bots without treating groups as channels and preserves provenance',async()=>{
 const s=fixture();try{
  useCompetitorFirst(s,1);let collected=[];
  const out=await expandPublicPeers(s,{projectId:1,seeds:['@seed_bot','@SEED_BOT'],max:3,depth:2,wait:async()=>{},collect:async name=>{
   collected.push(name);return {...proof(name,name==='@group_name'?'group':'bots'),
    description:name==='@seed_bot'?'Try @next_bot and https://t.me/group_name':''};}});
  assert.equal(out.length,2);assert.equal(collected.length,3);
  const child=s.db.prepare('SELECT * FROM candidates WHERE value=?').get('@next_bot');
  assert.equal(JSON.parse(child.evidence_json)[0].parent,'https://t.me/seed_bot');
  assert.equal(s.db.prepare('SELECT count(*) n FROM jobs WHERE kind=?').get('peer_review').n,2);
  assert.equal(s.db.prepare('SELECT count(*) n FROM operations').get().n,0);
  assert.deepEqual(publicUsernames('me@example.com @next_bot https://t.me/s/next_bot/3'),['@next_bot']);
 }finally{s.close();}
});

test('multiple discovery routes deduplicate the peer while retaining both sources and measured evidence',async()=>{
 const s=fixture();try{
  const routes=['lyzem','telemetr-catalog'].map(source=>({provider:source,status:'ok',seeds:[{value:'@tarot_bot',source,url:'https://'+source}]}));
  const out=await discoverFromSources(s,{projectId:1,query:'tarot',search:async()=>routes,collect:async name=>proof(name)});
  assert.equal(out.uniqueSeeds,1);assert.equal(out.verifiedPublicPeers,1);
  const c=s.db.prepare('SELECT * FROM candidates').get();assert.equal(JSON.parse(c.features_json).publicPeer.audience.value,24000);
  assert.equal(JSON.parse(c.evidence_json).filter(e=>e.type==='directory-source').length,2);
 }finally{s.close();}
});

test('view comparisons use post-age cohorts and exclude future/service posts',()=>{
 const now=Date.now(),post=(days,views,extra={})=>({date:new Date(now-days*86400000).toISOString(),views,...extra});
 const out=channelFeatures({ok:true,posts:[post(3,100),post(4,null),post(20,900),post(100,99999),post(-1,5000),post(3,8000,{isService:true})]},now);
 assert.equal(out.viewsByAge.days2to7.medianViews,100);assert.equal(out.viewsByAge.days2to7.posts,2);
 assert.equal(out.viewsByAge.days7to30.medianViews,900);assert.equal(out.recentPosts14d,2);
});

test('changing initial policy holds legacy drafts, preserves their history and requires a fresh decision on release',()=>{
 const s=fixture();try{
  const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@tarot_bot',source:'web',hypothesis:'direct'});
  s.db.prepare("INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status) VALUES(1,1,?,'love','Explore tarot','approved')").run(id);
  const [ex]=prepareCandidates(s);assert.ok(ex);
  useCompetitorFirst(s,1);assert.equal(s.db.prepare('SELECT status FROM experiments WHERE id=?').get(ex).status,'discovery_held');
  assert.equal(s.db.prepare('SELECT status FROM decisions').get().status,'rejected');
  const p=proof('@tarot_bot');recordPeerEvidence(s,id,p);
  s.db.prepare('UPDATE candidates SET features_json=? WHERE id=?').run(JSON.stringify({publicPeer:p,
   initialReview:{status:'eligible',relevance:'direct',reason:'Measured competitor',marketEvidence:'English presentation; audience share unknown',peerCheckedAt:p.checkedAt}}),id);
  prepareCandidates(s);assert.equal(s.db.prepare('SELECT status FROM experiments WHERE id=?').get(ex).status,'draft');
  assert.equal(s.db.prepare("SELECT count(*) n FROM decisions WHERE status='pending'").get().n,1);
  prepareCandidates(s);assert.equal(s.db.prepare('SELECT count(*) n FROM decisions').get().n,2);
  assert.equal(s.db.prepare('SELECT count(*) n FROM operations').get().n,0);
 }finally{s.close();}
});

test('large but inactive channels and search/user drafts cannot bypass initial competitor baseline',()=>{
 const p={...proof('@tarotchannel','channels'),audience:{value:8000,unit:'subscribers'},activity:{availability:'public-preview',recentPosts14d:0},sampledPosts:[]};
 const c={surface:'channels',value:'@tarotchannel',features_json:JSON.stringify({publicPeer:p})};
 assert.equal(peerReadiness(c,'competitor-first').ready,false);
 for(const surface of ['search','users'])assert.equal(peerReadiness({surface},'competitor-first').ready,false);
});

test('a source outage is retried durably instead of being recorded as a valid empty discovery',async()=>{
 const s=fixture();try{
  const search=async()=>[{provider:'lyzem',status:'unavailable',seeds:[],retryAfter:400}];
  const id=queueSourceDiscovery(s,1,'Tarot');assert.equal(queueSourceDiscovery(s,1,' tarot '),id);
  let now=1000;const options={clock:()=>now,discover:(store,input)=>discoverFromSources(store,{...input,search})};
  assert.equal(await runSourceDiscovery(s,options),true);
  let row=s.db.prepare('SELECT * FROM discovery_runs').get();assert.equal(row.status,'queued');assert.equal(row.next_at,1400);
  assert.equal(await runSourceDiscovery(s,options),false);
  now=1400;await runSourceDiscovery(s,options);now=1800;await runSourceDiscovery(s,options);
  row=s.db.prepare('SELECT * FROM discovery_runs').get();assert.equal(row.status,'failed');assert.equal(row.attempts,3);
  assert.equal(s.db.prepare('SELECT count(*) n FROM operations').get().n,0);
 }finally{s.close();}
});

test('interrupted discovery recovers its lease and cannot complete over a newer worker result',async()=>{
 const s=fixture();try{
  const id=queueSourceDiscovery(s,1,'tarot');let now=Math.floor(Date.now()/1000),resolveFirst;
  const first=runSourceDiscovery(s,{clock:()=>now,discover:()=>new Promise(r=>{resolveFirst=r;})});
  assert.equal(await runSourceDiscovery(s,{clock:()=>now,discover:async()=>{throw Error('must not run');}}),false);
  now+=3601;await runSourceDiscovery(s,{clock:()=>now,discover:async()=>({query:'tarot',peers:['new worker']})});
  resolveFirst({peers:['stale worker']});await first;
  let row=s.db.prepare('SELECT * FROM discovery_runs WHERE id=?').get(id);
  assert.equal(row.status,'done');assert.deepEqual(JSON.parse(row.response_json).peers,['new worker']);
  assert.equal(queueSourceDiscovery(s,1,'tarot'),id);assert.equal(s.db.prepare('SELECT status FROM discovery_runs').get().status,'done');
  s.db.prepare("UPDATE discovery_runs SET status='running',attempts=3,lease_until=1,lease_token='crashed'").run();
  assert.equal(await runSourceDiscovery(s,{clock:()=>now}),false);
  assert.equal(s.db.prepare('SELECT status FROM discovery_runs').get().status,'failed');
 }finally{s.close();}
});

test('provider and Telegram public cooldowns survive later queries without replay',async()=>{
 const s=fixture();try{
  let calls=0;const fetcher=async()=>{calls++;return {ok:false,status:429,headers:{get:()=>600}};};
  const options={store:s,clock:()=>1000,wait:async()=>{},fetcher};
  await searchDiscoverySources('tarot',options);assert.equal(calls,4); // both catalog routes share one provider
  await searchDiscoverySources('love tarot',options);assert.equal(calls,4);
  let collected=0;
  await assert.rejects(expandPublicPeers(s,{projectId:1,seeds:['@tarot_bot'],clock:()=>1000,
   collect:async()=>{collected++;const e=Error('429');e.retryAfter=600;throw e;}}),/429/);
  await assert.rejects(expandPublicPeers(s,{projectId:1,seeds:['@other_bot'],clock:()=>1000,
   collect:async()=>{collected++;return proof('@other_bot');}}),/cooldown/);
  assert.equal(collected,1);
 }finally{s.close();}
});

test('bot directories distinguish result resource paths from categories and require a real page',()=>{
 const gram='Search Telegram bots <a href="/bots/Tarotnatalbot">Card</a><a href="/categories/tarot">Category</a><a href="https://t.me/supportbot">Support</a>';
 assert.deepEqual(parseBotDirectory(gram,{provider:'grambots',url:'https://www.grambots.com/?q=tarot'}).map(s=>s.value),['@tarotnatalbot']);
 const tele='search-form-right <a href="/bot/tarot_bot/">Card</a><a href="/bots/personal/">Category</a><a href="/bot/tarot_bot/">Again</a>';
 assert.deepEqual(parseBotDirectory(tele,{provider:'telegramic',url:'https://telegramic.org/bots/?q=tarot'}).map(s=>s.value),['@tarot_bot']);
 assert.throws(()=>parseBotDirectory('challenge',{provider:'grambots'}),/unexpected/);
});

test('partial peer discovery retains its sources before deferring on Telegram rate limits',async()=>{
 const s=fixture();try{
  const seeds=['@first_bot','@second_bot'].map(value=>({value,source:'lyzem',url:'https://lyzem.com/search?q=tarot'}));
  await assert.rejects(discoverFromSources(s,{projectId:1,query:'tarot',
   search:async()=>[{provider:'lyzem',status:'ok',seeds}],collect:async value=>{
    if(value==='@first_bot')return proof(value);const e=Error('rate limited');e.retryAfter=120;throw e;}}),/rate limited/);
  const candidate=s.db.prepare('SELECT * FROM candidates').get();
  assert.ok(JSON.parse(candidate.evidence_json).some(e=>e.type==='directory-source'));
  assert.equal(s.db.prepare('SELECT count(*) n FROM audit WHERE action=?').get('sources.partial').n,1);
 }finally{s.close();}
});
