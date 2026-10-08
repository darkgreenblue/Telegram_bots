import { archiveIntelligenceEvidence } from './intelligence.js';

// Adapter for the existing public HTML collector. Only text actually extracted
// from the public page is archived; synthetic labels or guesses are not facts.
export function archivePublicPeerIntelligence(store,projectId,proof){
  if(!['bots','channels'].includes(proof.kind))return null;
  const parts=[proof.title,proof.description,proof.audience?.raw].filter(v=>typeof v==='string'&&v.trim());
  if(!parts.length)return null;
  const facts=[];
  if(proof.description)facts.push({domain:'positioning',kind:'competitor-claim',label:'Public profile introduction',
    quote:proof.description.slice(0,3000),metric:null});
  const a=proof.audience;
  const labeled=a?.unit==='monthly_users'&&/monthly users/i.test(a.raw??'')||a?.unit==='subscribers'&&/subscribers/i.test(a.raw??'');
  if(labeled&&Number.isFinite(a.value)&&a.value>=0)facts.push({domain:'audience',kind:'measured',label:'Publicly displayed audience count',
    quote:a.raw,metric:{value:a.value,unit:a.unit==='monthly_users'?'users':'subscribers',
      definition:a.unit==='monthly_users'?'Telegram monthly users as displayed; calculation unknown':'Telegram channel subscribers as displayed',
      population:a.unit==='monthly_users'?'Telegram reported monthly audience':'Channel subscriber accounts',
      period:a.unit==='monthly_users'?'monthly as labeled; exact window unknown':'snapshot',asOf:proof.checkedAt}});
  const visibleText=parts.join('\n').slice(0,60000);
  const out=archiveIntelligenceEvidence(store,projectId,{entityUrl:proof.url,hostUrl:proof.url,sourceUrl:proof.url,destinationUrl:null,
    checkedAt:proof.checkedAt,source:'public-web',language:null,context:'Public Telegram HTML profile',visibleText,facts,
    artifacts:[],parentRef:null,limitations:['Public text collector; no screenshot captured. Interface language and audience proportions unknown.',
      'Profile claims are not exercised features. Pricing, payment adoption and competitor revenue not inspected.']});
  for(const post of proof.sampledPosts??[]){
    if(!post.text?.trim())continue;
    archiveIntelligenceEvidence(store,projectId,{entityUrl:proof.url,hostUrl:proof.url,sourceUrl:post.url,destinationUrl:null,
      checkedAt:proof.checkedAt,source:'public-web',language:null,context:`Sampled public post; publication ${post.date??'unknown'}`,
      visibleText:post.text,facts:[{domain:'growth',kind:'visible-text',label:'Sampled public post',quote:post.text,metric:null}],
      artifacts:[],parentRef:out.ref,limitations:['Public text only; no screenshot or sponsorship verification. Post may be truncated by collector.']});
  }
  return out;
}
