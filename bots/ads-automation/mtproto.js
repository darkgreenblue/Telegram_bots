// Dedicated user session. No member scraping, private history or paid Stars search.
// @mtcute/node docs: https://mtcute.dev/guide/ and https://ref.mtcute.dev/modules/_mtcute_node
export async function openDiscoveryAccount({apiId,apiHash,storage='./data/discovery-account'}){
  if(!Number.isInteger(apiId)||!apiHash)throw new Error('dedicated account API credentials missing');
  const {TelegramClient}=await import('@mtcute/node');
  const client=new TelegramClient({apiId,apiHash,storage});
  await client.start(); // initial login is performed by the owner on this dedicated account
  return client;
}

export async function findPublicPeers(client,query,limit=30){
  const result=await client.call({_: 'contacts.search',q:query,limit:Math.min(limit,100)});
  const channels=(result.chats||[]).filter(c=>c._==='channel' && c.broadcast && c.username)
    .map(c=>({surface:'channels',value:`@${c.username}`,title:c.title,source:`contacts.search:${query}`}));
  const bots=(result.users||[]).filter(u=>u.bot && u.username)
    .map(u=>({surface:'bots',value:`@${u.username}`,title:u.firstName||u.username,
      monthlyActiveUsers:Number.isInteger(u.botActiveUsers)?u.botActiveUsers:null,source:`contacts.search:${query}`}));
  return [...channels,...bots];
}

export async function similarPublicChannels(client,username){
  const result=await client.getSimilarChannels(username);
  return Array.from(result).filter(c=>c.username).map(c=>({surface:'channels',value:`@${c.username}`,
    source:`recommendation:${username}`,totalAvailable:result.total??null}));
}
