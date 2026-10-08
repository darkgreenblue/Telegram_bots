import { INTELLIGENCE_DOMAINS } from './intelligence.js';
const str={type:'string'},strings={type:'array',items:str};
const obj=(properties)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullableString={type:['string','null']},nullableNumber={type:['number','null']};
export const INTELLIGENCE_SCHEMA=obj({
  coverage:{type:'array',items:obj({domain:{type:'string',enum:INTELLIGENCE_DOMAINS},
    status:{type:'string',enum:['observed','not-observed','not-inspected','blocked']},limitations:str})},
  findings:{type:'array',items:obj({domain:{type:'string',enum:INTELLIGENCE_DOMAINS},claim:str,
    purpose:{type:'string',enum:['creative','copywriting','market-selection','product-strategy','pricing','monetization',
      'market-sizing','competitor-revenue','business-opportunity','experiment']},
    scope:obj({market:str,language:str,productVersion:str}),
    evidence:{type:'array',minItems:1,items:obj({ref:str,quote:str})},caveats:{...strings,minItems:1},hypothesis:str,ownDataTest:str})},
  estimates:{type:'array',items:obj({entityUrl:str,title:str,
    formula:{type:'string',enum:['population * participation * spend_per_participant_period']},unit:str,period:str,asOf:str,
    inputs:{type:'array',items:obj({key:{type:'string',enum:['population','participation','spend_per_participant_period']},
      low:{type:'number'},high:{type:'number'},unit:str,definition:str,population:str,period:str,
      basis:{type:'string',enum:['evidence','assumption']},evidenceRef:nullableString,factIndex:nullableNumber})},
    assumptions:strings,caveats:strings,confidence:{type:'string',enum:['low','medium']}})}
});
