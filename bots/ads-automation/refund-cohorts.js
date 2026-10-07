const DAY=86400;
const validTime=value=>Number.isSafeInteger(value)&&value>0;

// This contract is specific to Tarot's successful refundStarPayment path.
// A reversal alone also represents receipt fraud and must not imply a refund.
export function refundCohortReader(db,{acquisition,params,profile,columns,at}){
  if(profile.refundEvidence!=='tarot-stars-v1'||profile.revenueUnit!=='star'||
    !['id','user_id','status','amount','approved_at','charge_id'].every(k=>columns.has(k))||
    profile.amountColumn!=='amount'||(profile.amountDivisor||1)!==1)return ()=>null;
  const payments=db.prepare(`${acquisition} SELECT a.code,a.product_version,a.acquired_at,
      p.id,p.user_id,p.amount,p.status,p.approved_at,p.charge_id
    FROM acquired a JOIN ${profile.paymentTable} p ON p.user_id=a.uid
    WHERE p.status IN (?,'reversed','refunded') ${profile.paymentFilter?`AND p.${profile.paymentFilter}`:''}`)
    .all(...params,profile.successStatus);
  const events=db.prepare(`${acquisition} SELECT a.code,a.product_version,a.acquired_at,e.user_id,e.props,e.created_at
    FROM acquired a JOIN events e ON e.user_id=a.uid WHERE e.event='payment_refunded'`).all(...params);
  const byPayment=new Map(),unlinked=[];
  for(const event of events){
    if(validTime(event.created_at)&&event.created_at>at)continue;
    let props;try{props=JSON.parse(event.props);}catch{props=null;}
    const entry={...event,props};
    if(!Number.isSafeInteger(props?.payment_id)){unlinked.push(entry);continue;}
    const list=byPayment.get(props.payment_id)||[];list.push(entry);byPayment.set(props.payment_id,list);
  }
  const knownIds=new Set(payments.map(p=>p.id));
  for(const [id,list] of byPayment)if(!knownIds.has(id))unlinked.push(...list);
  return (code,version,days)=>{
    let gross=0,refunded=0,late=0,refundCount=0,unknown=0;
    for(const p of payments){
      if(p.code!==code||p.product_version!==version||!validTime(p.acquired_at)||p.acquired_at>at-days*DAY)continue;
      if(!validTime(p.approved_at)||!Number.isFinite(p.amount)||p.amount<0||p.approved_at>at){unknown++;continue;}
      if(p.approved_at<p.acquired_at||p.approved_at>=p.acquired_at+days*DAY)continue;
      const proof=byPayment.get(p.id)||[];
      if(p.status===profile.successStatus&&!proof.length){gross+=p.amount;continue;}
      const verified=p.status==='reversed'&&typeof p.charge_id==='string'&&p.charge_id.trim()&&proof.length&&
        proof.every(e=>e.user_id===p.user_id&&e.props.amount===p.amount&&validTime(e.created_at)&&
          e.created_at>=p.approved_at&&e.created_at<=at);
      if(!verified){unknown++;continue;}
      gross+=p.amount;refunded+=p.amount;refundCount++;
      // Duplicate delivery is one refund; the earliest valid ledger event sets its date.
      if(Math.min(...proof.map(e=>e.created_at))>=p.acquired_at+days*DAY)late+=p.amount;
    }
    unknown+=unlinked.filter(e=>e.code===code&&e.product_version===version&&
      validTime(e.acquired_at)&&e.acquired_at<=at-days*DAY).length;
    return {refundEvidenceKnown:unknown===0,unknownRefundPayments:unknown,
      grossReceivedRevenue:unknown?null:gross,refundedRevenue:unknown?null:refunded,
      netReceivedRevenue:unknown?null:gross-refunded,lateRefundRevenue:unknown?null:late,
      refundedPayments:unknown?null:refundCount};
  };
}
