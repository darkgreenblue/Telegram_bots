const median=xs=>{
  if(!xs.length)return null;
  const sorted=[...xs].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;
};

export function channelFeatures(snapshot,at=Date.now()){
  if(!snapshot.ok)return {availability:'unknown',error:snapshot.error};
  const posts=(snapshot.posts||[]).filter(p=>p.date&&!p.isService&&Number.isFinite(Date.parse(p.date))&&Date.parse(p.date)<=at);
  const mature=posts.filter(p=>at-Date.parse(p.date)>=48*3600000);
  const recent=posts.filter(p=>at-Date.parse(p.date)<14*86400000);
  const cohort=(min,max)=>{
    const sample=posts.filter(p=>{const days=(at-Date.parse(p.date))/86400000;return days>=min&&days<max;});
    const views=sample.map(p=>p.views).filter(Number.isFinite);
    return {posts:sample.length,measuredViews:views.length,medianViews:median(views),
      medianReactions:median(sample.map(p=>p.reactionTotal).filter(Number.isFinite))};
  };
  return {availability:'public-preview',subscribers:snapshot.header?.subscribers??null,
    sampledPosts:(snapshot.posts||[]).length,maturePosts:mature.length,recentPosts14d:recent.length,
    // Historical field is retained for compatibility; use dated cohorts for comparisons.
    medianViews48h:median(mature.map(p=>p.views).filter(Number.isFinite)),
    medianReactions48h:median(mature.map(p=>p.reactionTotal).filter(Number.isFinite)),
    sampledViewCoverage:mature.length?mature.filter(p=>Number.isFinite(p.views)).length/mature.length:0,
    viewsByAge:{days2to7:cohort(2,7),days7to30:cohort(7,30)},
    latestPostAt:posts.map(p=>p.date).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null};
}
