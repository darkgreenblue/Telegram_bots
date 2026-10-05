// Telegraf.launch resolves when polling ENDS, not when it becomes ready.
// Keep polling and work concurrent, but drain both before closing the store.
export function startRuntime({bot,cycle,close,log=()=>{},intervalMs=30000,
  setTimer=setInterval,clearTimer=clearInterval}){
  let timer,running,stopping=false,cleanup;
  function tick(){
    if(stopping||running)return;
    running=Promise.resolve().then(cycle).catch(error=>{
      log('cycle.failed',{message:String(error.message).slice(0,200)});
    }).finally(()=>{running=null;});
    return running;
  }
  function stopPolling(){
    try{bot.stop('ads runtime stopping');}
    catch(error){
      // A stop during getMe/deleteWebhook is retried until polling is created.
      if(error.message!=='Bot is not running!')log('polling.stop_failed',{message:String(error.message).slice(0,200)});
    }
  }
  const polling=Promise.resolve().then(()=>bot.launch({},()=>{
    if(stopping)return;
    log('bot.initialized',{});
    tick();timer=setTimer(tick,intervalMs);
  }));
  function stop(){
    if(cleanup)return cleanup;
    stopping=true;clearTimer(timer);
    cleanup=(async()=>{
      let ended=false;
      const settled=polling.catch(()=>{}).then(()=>{ended=true;});
      while(!ended){
        stopPolling();
        await Promise.race([settled,new Promise(resolve=>setTimeout(resolve,100))]);
      }
      await running;
      log('runtime.stopped',{});
      await close();
    })();
    return cleanup;
  }
  const done=(async()=>{
    try{
      await polling;
      if(!stopping)throw new Error('Telegram polling ended unexpectedly');
    }catch(error){
      if(!stopping)log('runtime.failed',{message:String(error.message).slice(0,200)});
      throw error;
    }finally{await stop();}
  })();
  return {done,stop};
}
