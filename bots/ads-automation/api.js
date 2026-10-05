import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE = 'https://promoteapi.telegram.org';
const now = () => Math.floor(Date.now()/1000);
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

export class AdsApi {
  constructor({token,store,fetcher=fetch,live=false,clock=now,wait=sleep}) {
    this.token=token; this.store=store; this.fetcher=fetcher; this.live=live;
    this.clock=clock;this.wait=wait;
    this.accountKey=createHash('sha256').update(token||'').digest('hex');
  }
  assertAvailable(){
    const cooldown=this.store.db.prepare('SELECT until_at FROM api_cooldowns WHERE account_key=?').get(this.accountKey);
    if(cooldown?.until_at>this.clock()){
      const error=new Error(`Ads API cooling down until ${cooldown.until_at}`);
      error.retryAt=cooldown.until_at;throw error;
    }
  }
  retryDelay(response){
    const header=response.headers?.get('retry-after');
    if(!header)return null;
    const seconds=Number(header);
    if(Number.isFinite(seconds)&&seconds>=0)return seconds;
    const date=Date.parse(header);
    return Number.isFinite(date)?Math.max(0,Math.ceil(date/1000-this.clock())):null;
  }
  defer(response,delay){
    const until=this.clock()+Math.max(1,Math.ceil(delay));
    this.store.db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES (?,?,?)
      ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at),reason=excluded.reason`)
      .run(this.accountKey,until,`HTTP ${response.status}`);
    this.store.audit('ads-api','api.cooldown',response.status,{until});
    const error=new Error(`Ads API temporary HTTP ${response.status}; retry after ${until}`);
    error.retryAt=until;throw error;
  }
  async call(method,params={},opKey=null) {
    if (!this.token) throw new Error('Telegram Ads token missing');
    const changing = ['createAd','editAd','deleteAd','increaseAdBudget','decreaseAdBudget','uploadAdPhoto','submitAdForReview'].includes(method);
    if (changing && (!this.live || !opKey)) throw new Error('live write disabled or operation key missing');
    const body=JSON.stringify(params);
    let op;
    if (changing) {
      op=this.store.db.prepare('SELECT * FROM operations WHERE op_key=?').get(opKey);
      if (op) {
        if (op.method!==method || op.request_json!==body) throw new Error('idempotency key reused with changed request');
        if (op.status==='done') return JSON.parse(op.response_json);
        if (now()-op.created_at>=23*3600) throw new Error('old uncertain operation: reconcile before retry');
      }
    }
    this.assertAvailable();
    if(changing&&!op)this.store.db.prepare('INSERT INTO operations(op_key,method,request_json) VALUES (?,?,?)').run(opKey,method,body);
    for (let attempt=0;attempt<4;attempt++) {
      let response;
      try {
        response=await this.fetcher(`${BASE}/${method}`,{
          method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',...(opKey?{'Idempotency-Key':opKey}:{})},
          body,signal:AbortSignal.timeout(25000)
        });
      } catch(e) { if (attempt<3) {await this.wait((attempt+1)*1000);continue;} throw e; }
      if (response.status===429 || response.status>=500) {
        const wait=this.retryDelay(response);
        // Persist provider limits instead of blocking the entire worker loop.
        // A restart or a different endpoint must respect the same deadline.
        if(response.status===429)this.defer(response,wait??60);
        if(wait!==null&&wait>8)this.defer(response,wait);
        if (attempt===3) throw new Error(`Ads API temporary HTTP ${response.status}`);
        await this.wait((wait??(attempt+1)*2)*1000);
        continue;
      }
      let parsed;
      try {parsed=await response.json();} catch {throw new Error(`Ads API invalid HTTP ${response.status}`);}
      if (!response.ok || !parsed.ok) throw new Error(`Ads API ${method}: ${String(parsed.error||response.status).slice(0,150)}`);
      if (changing) this.store.db.prepare(`UPDATE operations SET status='done',response_json=?,completed_at=unixepoch() WHERE op_key=?`).run(JSON.stringify(parsed.result),opKey);
      return parsed.result;
    }
    throw new Error('Ads API retry exhausted');
  }
  getAccount(){return this.call('getCurrentAccount');}
  getAd(id){return this.call('getAdsById',{ad_ids:[id],return_target:true}).then(v=>Array.isArray(v)?v[0]:v?.ads?.[0]);}
  getStats(id,from,to,interval=300){return this.call('getAdStats',{ad_id:id,from_time:from,to_time:to,interval});}
  async findByTitle(title){
    let offset;
    for(let page=0;page<50;page++){
      const out=await this.call('getAdsList',{limit:100,...(offset?{offset}:{})});
      const ads=out.ads||out.items||[];
      const match=ads.find(a=>a.title===title);
      if(match)return match;
      offset=out.next_offset;
      if(!offset)break;
    }
    return null;
  }
  async uploadPhoto(path,opKey){
    if (!this.live || !this.token||!opKey) throw new Error('live upload disabled or operation key missing');
    this.assertAvailable();
    const bytes=await readFile(path);
    if (bytes.length>5_000_000) throw new Error('photo over 5 MB');
    const form=new FormData();form.set('file',new Blob([bytes],{type:'image/jpeg'}),'ad.jpg');
    const res=await this.fetcher(`${BASE}/uploadAdPhoto`,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Idempotency-Key':opKey},body:form,signal:AbortSignal.timeout(30000)});
    if(res.status===429||res.status>=500)this.defer(res,this.retryDelay(res)??60);
    const obj=await res.json();if(!res.ok||!obj.ok||!obj.result?.photo_id)throw new Error('photo upload failed');
    return obj.result;
  }
}
