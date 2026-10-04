import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

const base='https://sheets.googleapis.com/v4/spreadsheets';
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');

export class GoogleSheetsMirror {
  constructor({spreadsheetId,credentialsPath,fetcher=fetch}){
    this.spreadsheetId=spreadsheetId;this.credentialsPath=credentialsPath;this.fetcher=fetcher;this.cached=null;
  }
  async token(){
    if(this.cached && this.cached.until>Date.now()+60000)return this.cached.value;
    const creds=JSON.parse(await readFile(this.credentialsPath,'utf8'));
    if(creds.type!=='service_account'||!creds.private_key||!creds.client_email)throw new Error('invalid Google service account');
    const epoch=Math.floor(Date.now()/1000),head=b64({alg:'RS256',typ:'JWT'});
    const claim=b64({iss:creds.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',
      aud:'https://oauth2.googleapis.com/token',iat:epoch,exp:epoch+3600});
    const sign=createSign('RSA-SHA256');sign.update(`${head}.${claim}`);sign.end();
    const assertion=`${head}.${claim}.${sign.sign(creds.private_key).toString('base64url')}`;
    const r=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if(!r.ok)throw new Error(`Google token HTTP ${r.status}`);
    const data=await r.json();this.cached={value:data.access_token,until:Date.now()+data.expires_in*1000};return data.access_token;
  }
  async api(path,{method='GET',body}={}){
    const token=await this.token();const r=await this.fetcher(`${base}/${this.spreadsheetId}${path}`,{method,
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok)throw new Error(`Google Sheets HTTP ${r.status}`);
    return r.status===204?{}:r.json();
  }
  async ensureTabs(){
    const meta=await this.api('?fields=sheets.properties.title');
    const existing=new Set((meta.sheets||[]).map(s=>s.properties.title));
    const missing=['Candidates','Tests','Insights'].filter(t=>!existing.has(t));
    if(missing.length)await this.api(':batchUpdate',{method:'POST',body:{requests:missing.map(title=>({addSheet:{properties:{title}}}))}});
  }
  async sync(store,projectId){
    if(!this.spreadsheetId||!this.credentialsPath)return false;
    await this.ensureTabs();
    const db=store.db;
    const candidates=db.prepare('SELECT * FROM candidates WHERE project_id=? ORDER BY score DESC,id').all(projectId);
    const tests=db.prepare(`SELECT e.*,c.surface,c.value FROM experiments e JOIN candidates c ON c.id=e.candidate_id
      WHERE e.project_id=? ORDER BY e.id`).all(projectId);
    const insights=db.prepare('SELECT * FROM insights WHERE project_id=? ORDER BY id').all(projectId);
    const tables={
      Candidates:[['شناسه','نوع','مقصد یا عبارت','وضعیت','امتیاز','فرضیه','منبع','ویژگی‌ها','شواهد'],
        ...candidates.map(c=>[c.id,c.surface,c.value,c.status,c.score,c.hypothesis,c.source,c.features_json,c.evidence_json])],
      Tests:[['شناسه','نوع','مقصد','کد رهگیری','شناسه Ads','وضعیت','CPM','خرج TON','ویو','اکشن','CPA TON','دور تست'],
        ...tests.map(e=>[e.id,e.surface,e.value,e.tracking_code||'',e.ad_id||'',e.status,e.cpm,e.last_spent,e.last_views,e.last_actions,
          e.last_actions?e.last_spent/e.last_actions:'',e.test_round])],
      Insights:[['شناسه','سطح','ادعا','وضعیت','فرضیه','شواهد'],
        ...insights.map(i=>[i.id,i.scope,i.claim,i.status,i.hypothesis,i.evidence_json])]
    };
    const names=Object.keys(tables);
    await this.api('/values:batchClear',{method:'POST',body:{ranges:names.map(n=>`${n}!A:Z`)}});
    await this.api('/values:batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data:names.map(n=>({range:`${n}!A1`,values:tables[n]}))}});
    store.audit('system','sheets.sync',projectId,{counts:names.map(n=>tables[n].length-1)});
    return true;
  }
}
