import { intelligenceRows } from './intelligence.js';
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

const base='https://sheets.googleapis.com/v4/spreadsheets';
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');

export class GoogleSheetsMirror {
  constructor({spreadsheetId,credentialsPath,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=15000}){
    this.spreadsheetId=spreadsheetId;this.credentialsPath=credentialsPath;this.fetcher=fetcher;this.cached=null;
    this.sleep=sleep;this.timeoutMs=timeoutMs;
  }
  async request(url,options,{retry=true,label}={}){
    for(let attempt=0;attempt<3;attempt++){
      let response;
      try{response=await this.fetcher(url,{...options,signal:AbortSignal.timeout(this.timeoutMs)});}
      catch(error){
        if(!retry||attempt===2)throw new Error(`${label} network request failed`);
      }
      if(response?.ok)return response.status===204?{}:response.json();
      if(response && (!retry||attempt===2||![429,500,502,503,504].includes(response.status)))
        throw new Error(`${label} HTTP ${response.status}`);
      const retryAfter=Number(response?.headers?.get('retry-after'));
      await this.sleep(Math.max(250*2**attempt,Math.min(2000,Number.isFinite(retryAfter)?retryAfter*1000:0)));
    }
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
    const data=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})},{label:'Google token'});
    if(typeof data.access_token!=='string'||!Number.isFinite(Number(data.expires_in)))throw new Error('invalid Google token response');
    this.cached={value:data.access_token,until:Date.now()+data.expires_in*1000};return data.access_token;
  }
  async api(path,{method='GET',body,retry=true}={}){
    const token=await this.token();
    return this.request(`${base}/${this.spreadsheetId}${path}`,{method,
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},
      {retry,label:'Google Sheets'});
  }
  async ensureTabs(){
    const path='?fields=sheets.properties(sheetId,title,gridProperties.rowCount)';
    let meta=await this.api(path);
    const existing=new Set((meta.sheets||[]).map(s=>s.properties.title));
    const missing=['Candidates','Tests','Insights','CompetitorEvidence','IntelligenceEstimates','MarketIntelligence'].filter(t=>!existing.has(t));
    // addSheet is not replayed after an ambiguous response. The next sync reads
    // the actual tab list again, rather than blindly creating it twice.
    if(missing.length){
      await this.api(':batchUpdate',{method:'POST',retry:false,body:{requests:missing.map(title=>({addSheet:{properties:{title}}}))}});
      meta=await this.api(path);
    }
    return meta.sheets.map(s=>s.properties);
  }
  async sync(store,projectId){
    if(!this.spreadsheetId||!this.credentialsPath)return false;
    const tabs=await this.ensureTabs();
    const db=store.db;
    const candidates=db.prepare('SELECT * FROM candidates WHERE project_id=? ORDER BY score DESC,id').all(projectId);
    const tests=db.prepare(`SELECT e.*,c.surface,c.value FROM experiments e JOIN candidates c ON c.id=e.candidate_id
      WHERE e.project_id=? ORDER BY e.id`).all(projectId);
    const insights=db.prepare('SELECT * FROM insights WHERE project_id=? ORDER BY id').all(projectId);
    const intelligence=intelligenceRows(store,projectId);
    const cellJson=v=>JSON.stringify(v).slice(0,45000);
    const tables={
      Candidates:[['شناسه','نوع','مقصد یا عبارت','وضعیت','امتیاز','فرضیه','منبع','ویژگی‌ها','شواهد'],
        ...candidates.map(c=>[c.id,c.surface,c.value,c.status,c.score,c.hypothesis,c.source,c.features_json,c.evidence_json])],
      Tests:[['شناسه','نوع','مقصد','کد رهگیری','شناسه Ads','وضعیت','CPM','خرج TON','ویو','اکشن','CPA TON','دور تست'],
        ...tests.map(e=>[e.id,e.surface,e.value,e.tracking_code||'',e.ad_id||'',e.status,e.cpm,e.last_spent,e.last_views,e.last_actions,
          e.last_actions?e.last_spent/e.last_actions:'',e.test_round])],
      Insights:[['شناسه','سطح','ادعا','وضعیت','فرضیه','شواهد'],
        ...insights.map(i=>[i.id,i.scope,i.claim,i.status,i.hypothesis,i.evidence_json])],
      CompetitorEvidence:[['مرجع','طبقه','رقیب','میزبان','منبع','زمان مشاهده','زبان','متن دقیق (حداکثر ۴۵هزار کاراکتر)','متریک و تعریف','فایل و هش','محدودیت','مقصد','زمینه'],
        ...intelligence.evidence.map(e=>[e.ref,e.classification,e.entityUrl,e.hostUrl,e.sourceUrl,e.checkedAt,e.language??'unknown',
          e.visibleText.slice(0,45000),cellJson(e.facts),cellJson(e.artifacts),cellJson(e.limitations),e.destinationUrl??'',e.context])],
      IntelligenceEstimates:[['شناسه','طبقه','عنوان','فرمول','نتیجه و واحد','دوره','تاریخ','ورودی و منبع','فرضیات','محدودیت','اطمینان','تفسیر'],
        ...intelligence.estimates.map(e=>[e.id,e.classification,e.title,e.formula,cellJson(e.result),e.period,e.asOf,
          cellJson(e.inputs),cellJson(e.assumptions),cellJson(e.caveats),e.confidence,e.interpretation])],
      MarketIntelligence:[['گزارش','طبقه','حوزه','کاربرد','ادعا','محدوده','مرجع و نقل قول','فرضیه','شناسه فرضیه','آزمون با داده خودمان','محدودیت','وضعیت'],
        ...intelligence.reports.flatMap(r=>r.findings.map(f=>[r.id,f.classification,f.domain,f.purpose,f.claim,cellJson(f.scope),
          cellJson(f.evidence),f.hypothesis,f.hypothesisId,f.ownDataTest,cellJson(f.caveats),f.status]))]
    };
    const names=Object.keys(tables);
    const requests=[];
    for(const name of names){
      const tab=tabs.find(t=>t.title===name),values=tables[name];
      const rowCount=Math.max(tab.gridProperties.rowCount,values.length);
      if(rowCount>tab.gridProperties.rowCount)requests.push({updateSheetProperties:{
        properties:{sheetId:tab.sheetId,gridProperties:{rowCount}},fields:'gridProperties.rowCount'}});
      requests.push({updateCells:{range:{sheetId:tab.sheetId,startRowIndex:0,endRowIndex:rowCount,startColumnIndex:0,endColumnIndex:26},
        fields:'userEnteredValue',rows:values.map(row=>({values:row.map(value=>({userEnteredValue:
          typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')}}))}))}});
    }
    // A single atomic batch replaces values AND clears obsolete rows. Replaying
    // this exact payload after a timeout is safe; archives and formatting survive.
    await this.api(':batchUpdate',{method:'POST',body:{requests}});
    store.audit('system','sheets.sync',projectId,{counts:names.map(n=>tables[n].length-1)});
    return true;
  }
}
