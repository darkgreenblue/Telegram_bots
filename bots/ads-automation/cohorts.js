import { refundCohortReader } from './refund-cohorts.js';
const DAY=86400;
export const COHORT_WINDOWS=[7,30];
const identifier=value=>{
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value||''))throw new Error('invalid cohort schema identifier');
  return value;
};
const columns=(db,table)=>new Set(db.pragma(`table_info(${identifier(table)})`).map(c=>c.name));

// Read-only aggregates. Acquisition is the actual first campaign start of a
// newly acquired user, never a returning start or the date of a report. Revenue
// uses approval time, not the earlier invoice/receipt creation time.
export function readCampaignCohorts(db,{codes,at,profile}){
  if(!Array.isArray(codes)||!codes.length||codes.length>100||
    codes.some(c=>typeof c!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(c)))throw new Error('invalid cohort codes');
  if(!Number.isSafeInteger(at)||at<=0)throw new Error('invalid cohort time');
  const pk=identifier(profile.userPk),table=identifier(profile.paymentTable),amount=identifier(profile.amountColumn);
  const users=columns(db,'users'),events=columns(db,'events'),payments=columns(db,table);
  if(!users.has(pk)||!users.has('first_source')||
    ['user_id','event','props','created_at'].some(c=>!events.has(c)))throw new Error('cohort acquisition schema unavailable');
  if(!['star','toman'].includes(profile.revenueUnit))throw new Error('unsupported cohort revenue unit');
  if(![1,10].includes(profile.amountDivisor||1))throw new Error('invalid cohort amount divisor');
  const hasPayments=['id','user_id','status',amount].every(c=>payments.has(c));
  const timingAvailable=hasPayments&&payments.has('approved_at');
  const excluded=(profile.excludedUsers||[]).map(Number);
  if(excluded.some(id=>!Number.isSafeInteger(id)))throw new Error('invalid excluded cohort user');
  const exclude=excluded.length?` AND u.${pk} NOT IN (${excluded.map(()=>'?').join(',')})`:'';
  const version=users.has('first_version')?"NULLIF(u.first_version,'')":"NULL";
  const acquisition=`WITH acquired AS (
    SELECT u.${pk} uid,substr(u.first_source,10) code,${version} product_version,
      (SELECT MIN(e.created_at) FROM events e WHERE e.user_id=u.${pk} AND e.event='start'
        AND json_extract(e.props,'$.new')=1 AND json_extract(e.props,'$.kind')='campaign'
        AND json_extract(e.props,'$.code')=substr(u.first_source,10)
        AND typeof(e.created_at) IN ('integer','real') AND e.created_at>0) acquired_at
    FROM users u WHERE u.first_source IN (${codes.map(()=>'?').join(',')})${exclude}
      AND u.${pk} NOT IN (SELECT user_id FROM events WHERE json_extract(props,'$.adm')=1)
  )`;
  const params=[...codes.map(code=>`campaign:${code}`),...excluded];
  const refundsFor=refundCohortReader(db,{acquisition,params,profile,columns:payments,at});
  const byCode=Object.fromEntries(codes.map(code=>[code,{}]));
  for(const days of COHORT_WINDOWS){
    // Only approved events with an actual timestamp can be attributed to a
    // bounded age window. Missing times remain unknown, never fabricated zero.
    const join=timingAvailable?`LEFT JOIN ${table} p ON p.user_id=a.uid AND p.status=?
      ${profile.paymentFilter?`AND p.${profile.paymentFilter}`:''}`:'';
    const valid=timingAvailable?`typeof(p.approved_at) IN ('integer','real')
      AND p.approved_at>=a.acquired_at AND p.approved_at<a.acquired_at+${days*DAY}
      AND typeof(p.${amount}) IN ('integer','real') AND p.${amount}>=0`:'0';
    const rows=db.prepare(`${acquisition}
      SELECT a.code,a.product_version,
        COUNT(DISTINCT CASE WHEN a.acquired_at>0 AND a.acquired_at<=? THEN a.uid END) eligible_users,
        COUNT(DISTINCT CASE WHEN a.acquired_at>? AND a.acquired_at<=? THEN a.uid END) immature_users,
        COUNT(DISTINCT CASE WHEN a.acquired_at IS NULL OR a.acquired_at>? THEN a.uid END) unknown_acquisition_users,
        ${timingAvailable?`COUNT(DISTINCT CASE WHEN a.acquired_at<=? AND ${valid} THEN a.uid END)`:'0'} recorded_payers,
        ${timingAvailable?`COALESCE(SUM(CASE WHEN a.acquired_at<=? AND ${valid} THEN p.${amount} ELSE 0 END),0)`:'0'} recorded_revenue,
        ${timingAvailable?`COUNT(CASE WHEN a.acquired_at<=? AND (p.approved_at IS NULL OR p.approved_at<=0
          OR typeof(p.approved_at) NOT IN ('integer','real') OR p.approved_at>?
          OR typeof(p.${amount}) NOT IN ('integer','real') OR p.${amount}<0) THEN p.id END)`:'0'} unknown_payments
      FROM acquired a ${join} GROUP BY a.code,a.product_version`).all(...params,
        at-days*DAY,at-days*DAY,at,at,...(timingAvailable?[at-days*DAY,at-days*DAY,at-days*DAY,at,profile.successStatus]:[]));
    for(const code of codes){
      const versions=rows.filter(r=>r.code===code).map(r=>({productVersion:r.product_version,
        eligibleUsers:r.eligible_users,immatureUsers:r.immature_users,unknownAcquisitionUsers:r.unknown_acquisition_users,
        recordedPayers:r.recorded_payers,recordedRevenue:r.recorded_revenue/(profile.amountDivisor||1),
        unknownPayments:r.unknown_payments,...refundsFor(code,r.product_version,days)}));
      const total=key=>versions.reduce((sum,v)=>sum+v[key],0);
      const paymentQualityKnown=timingAvailable&&total('unknownPayments')===0;
      const refundEvidenceKnown=paymentQualityKnown&&total('unknownAcquisitionUsers')===0&&
        versions.every(v=>v.refundEvidenceKnown===true)&&!!refundsFor(code,null,days);
      const refundMetric=key=>refundEvidenceKnown?total(key):null;
      byCode[code][days]={days,asOf:at,eligibleUsers:total('eligibleUsers'),immatureUsers:total('immatureUsers'),
        unknownAcquisitionUsers:total('unknownAcquisitionUsers'),paymentQualityKnown,
        payers:paymentQualityKnown?total('recordedPayers'):null,
        revenue:paymentQualityKnown?total('recordedRevenue'):null,
        revenueUnit:profile.revenueUnit,refunds:refundMetric('refundedRevenue'),versions,refundEvidenceKnown,
        grossReceivedRevenue:refundMetric('grossReceivedRevenue'),netReceivedRevenue:refundMetric('netReceivedRevenue'),
        lateRefundRevenue:refundMetric('lateRefundRevenue'),refundedPayments:refundMetric('refundedPayments'),
        unknownRefundPayments:versions.some(v=>v.unknownRefundPayments===undefined)?null:total('unknownRefundPayments'),
        caveat:'revenue is currently approved payments only. Received/refunded/net fields use the recorded Tarot Stars refund ledger; late refunds revise the original acquisition window. Internal credit refunds are excluded. Missing or conflicting evidence stays unknown. This is not net profit or proof of a Telegram payout.'};
    }
  }
  return {windows:COHORT_WINDOWS,asOf:at,hasPayments,paymentTimingAvailable:timingAvailable,byCode};
}
