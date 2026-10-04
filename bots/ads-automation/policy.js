export const TEST_TON = 0.05;
export const CAMPAIGN_TON = 1;
export const SLOW_CPA_TON = 0.03;
export const FALLBACK_DAILY_TON = 0.1;
const EPS = 0.000001;

export function cpa(spent, actions) {
  return actions > 0 ? spent/actions : null;
}

export function cadence({views=0,spent=0,firstViewAt=null,lastCheckedAt=null,lastViews=0,lastSpent=0}, now) {
  if (!firstViewAt) return 3*3600; // review or no delivery
  if (now-firstViewAt < 600) return 60;
  const dt = Math.max(60, now-(lastCheckedAt||now-60));
  const tonPerSecond = Math.max(0,spent-lastSpent)/dt;
  const viewsPerSecond = Math.max(0,views-lastViews)/dt;
  if (tonPerSecond > 0) return Math.max(60, Math.min(3600, Math.floor((TEST_TON/8)/tonPerSecond)));
  if (viewsPerSecond > 0.1) return 300;
  if (viewsPerSecond > 0) return 900;
  return 3600;
}

export function assessTest({spent,actions,views,firstViewAt,now,testStartSpent=0,targetCpa}) {
  if (!Number.isFinite(spent) || spent < testStartSpent-EPS || !Number.isInteger(actions) || !Number.isInteger(views)) return {kind:'pause',reason:'invalid or stale metric'};
  const used = spent-testStartSpent;
  const value = cpa(used,actions);
  if (used >= TEST_TON-EPS) return {kind:'review',reason:'test share consumed',cpa:value};
  if (remainingTest(spent,testStartSpent)===0) return {kind:'pause',reason:'budget precision exhausted before 0.05; admin review required',cpa:value};
  if (!firstViewAt) return {kind:'wait',reason:'no first view yet'};
  if (now-firstViewAt >= 48*3600 && views < 100) {
    if (actions > 0 && value !== null && value < SLOW_CPA_TON) return {kind:'continue',reason:'slow traffic with CPA below 0.03',cpa:value};
    return {kind:'reclaim',reason:'fewer than 100 views in 48 hours without viable CPA',cpa:value};
  }
  if (targetCpa != null && actions > 0 && value > 4*targetCpa && views >= 100) return {kind:'review',reason:'far above target CPA',cpa:value};
  return {kind:'continue',reason:'test still gathering data',cpa:value};
}

export function canGraduate(rounds,targetCpa) {
  if (!(targetCpa>0) || rounds.length<2) return false;
  const last = rounds.slice(-2);
  return last.every(r => r.actions>0 && r.spent>0 && r.spent/r.actions<=targetCpa)
    && last.reduce((a,r)=>a+r.actions,0)>=5;
}

export function remainingTest(spent,startSpent) {
  // Budget fields are only two decimals; round down so a new day cannot exceed the test cap.
  return Math.max(0,Math.floor((TEST_TON-(spent-startSpent)+1e-7)*100)/100);
}
