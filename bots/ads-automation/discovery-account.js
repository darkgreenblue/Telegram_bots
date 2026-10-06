import { stat } from 'node:fs/promises';

// The Telegram session itself has broad rights. Only this capability facade
// may be handed to discovery code: never expose the SDK, storage or auth key.
const publicName=value=>{
  if(typeof value!=='string'||!/^@?[A-Za-z0-9_]{5,32}$/.test(value))throw new Error('public username required');
  return value.replace(/^@/,'');
};
const peerKey=peer=>`${peer?._}:${String(peer?.userId??peer?.channelId)}:${String(peer?.accessHash)}`;
const callOptions={timeout:15000,floodSleepThreshold:0,maxRetryCount:0};
const publicChannel=chat=>chat?._==='channel'&&chat.broadcast&&chat.username;
const publicBot=user=>user?.bot&&user.username;

export function publicDiscoveryClient(client,{manualPostSearch=false,log=()=>{}}={}){
  const bots=new Set(),channels=new Set();
  const request=async params=>{
    log('native.request',{method:params._});
    try{
      const result=await client.call(params,callOptions);
      log('native.completed',{method:params._});return result;
    }catch(error){
      // Log categories, not arbitrary SDK messages that may contain credentials.
      log('native.failed',{method:params._,kind:error.name||'Error',
        floodSeconds:Number.isFinite(error.seconds)?error.seconds:null});throw error;
    }
  };
  const resolve=async(username,kind)=>{
    username=publicName(username);
    const result=await request({_: 'contacts.resolveUsername',username});
    const peers=kind==='bot'?result.users:result.chats;
    const peer=(peers||[]).find(p=>String(p.username).toLowerCase()===username.toLowerCase()
      &&(kind==='bot'?publicBot(p):publicChannel(p)));
    if(!peer||peer.accessHash==null)throw new Error(`public ${kind} not found`);
    const input=kind==='bot'?{_: 'inputUser',userId:peer.id,accessHash:peer.accessHash}
      :{_: 'inputChannel',channelId:peer.id,accessHash:peer.accessHash};
    (kind==='bot'?bots:channels).add(peerKey(input));return input;
  };
  const call=async params=>{
    if(!params||typeof params!=='object')throw new Error('native discovery request invalid');
    switch(params._){
      case 'contacts.search':
        if(typeof params.q!=='string'||!params.q.trim()||params.q.length>200||
          !Number.isInteger(params.limit)||params.limit<1||params.limit>100)throw new Error('bounded public search required');
        break;
      case 'bots.getBotRecommendations':
        if(!bots.has(peerKey(params.bot)))throw new Error('verified public bot required');
        break;
      case 'channels.getChannelRecommendations':
        if(!channels.has(peerKey(params.channel)))throw new Error('verified public channel required');
        break;
      case 'channels.checkSearchPostsFlood':
      case 'channels.searchPosts':
        if(!manualPostSearch)throw new Error('public post search requires explicit manual initiation');
        if('allowPaidStars' in params||'paidStars' in params)throw new Error('paid Stars search prohibited');
        if(params._==='channels.checkSearchPostsFlood'){
          if(typeof params.query!=='string'||!params.query.trim()||params.query.length>200)throw new Error('invalid public post query');
        }else if(Boolean(params.query)===Boolean(params.hashtag)||
          typeof (params.query||params.hashtag)!=='string'||!(params.query||params.hashtag).trim()||
          (params.query||params.hashtag).length>200||!Number.isInteger(params.limit)||params.limit<1||params.limit>100||
          params.offsetPeer?._!=='inputPeerEmpty'||params.offsetId!==0||params.offsetRate!==0)
          throw new Error('only a bounded first page of public posts is allowed');
        break;
      default:throw new Error('method prohibited by read-only public discovery policy');
    }
    const result=await request(params);
    if(params._==='channels.checkSearchPostsFlood')return result;
    const users=(result.users||[]).filter(publicBot),chats=(result.chats||[]).filter(publicChannel);
    const channelIds=new Set(chats.map(c=>String(c.id)));
    const userIds=new Set(users.map(u=>String(u.id)));
    const allowedPeer=p=>p?._==='peerChannel'?channelIds.has(String(p.channelId)):
      p?._==='peerUser'?userIds.has(String(p.userId)):false;
    return {...result,users,chats,
      ...(result.myResults?{myResults:result.myResults.filter(allowedPeer)}:{}),
      ...(result.results?{results:result.results.filter(allowedPeer)}:{}),
      ...(result.messages?{messages:result.messages.filter(m=>allowedPeer(m.peerId))}:{})};
  };
  return Object.freeze({call,resolveUser:username=>resolve(username,'bot'),
    getSimilarChannels:async username=>{
      const channel=await resolve(username,'channel');
      const result=await call({_: 'channels.getChannelRecommendations',channel});
      return Object.assign(result.chats.map(c=>({username:c.username,title:c.title,chatType:'channel'})),
        {total:result.count??result.chats.length});
    },destroy:()=>client.destroy()});
}

export async function openReadOnlyDiscoveryAccount({apiId,apiHash,expectedUserId,
  storage='./data/discovery-account',manualPostSearch=false,log=()=>{},clientFactory,
  checkStorage=async path=>{const info=await stat(path);
    if(!info.isFile()||(info.mode&0o077))throw new Error('private existing discovery session required');}}={}){
  if(!Number.isInteger(apiId)||apiId<=0||typeof apiHash!=='string'||!/^[a-f0-9]{32}$/i.test(apiHash))
    throw new Error('dedicated account API credentials missing');
  if(!Number.isSafeInteger(expectedUserId)||expectedUserId<=0)throw new Error('pinned discovery account ID required');
  await checkStorage(storage);
  const factory=clientFactory||((await import('@mtcute/node')).TelegramClient);
  const client=new factory({apiId,apiHash,storage,disableUpdates:true,updates:false,logLevel:0,
    initConnectionOptions:{deviceModel:'Telegram Ads Discovery',appVersion:'1.0',systemVersion:'Read-only public research'}});
  try{
    // Never start an interactive login, consume updates or inspect dialogs on
    // the server. Initial authentication is an explicit, separate setup step.
    const users=await client.call({_: 'users.getUsers',id:[{_: 'inputUserSelf'}]},callOptions);
    const me=users[0];
    if(me?._!=='user'||me.bot||Number(me.id)!==expectedUserId)throw new Error('discovery session account mismatch');
    log('native.account_verified',{userId:expectedUserId,updatesDisabled:true});
    return publicDiscoveryClient(client,{manualPostSearch,log});
  }catch(error){await client.destroy().catch(()=>{});throw error;}
}
