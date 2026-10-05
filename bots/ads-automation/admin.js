import { Telegraf,Markup } from 'telegraf';
import { resolve } from 'node:path';
import { saveTelegramImage } from './images.js';
import { addJob,row } from './db.js';
import { decide,requestDecision,pauseManaged,projectCapacity,projectSpendCommitment } from './workflow.js';

const brief=d=>{
  const p=JSON.parse(d.payload_json),e=JSON.parse(d.evidence_json);
  const names={create:'ساخت تبلیغ و تخصیص ۱ TON',delete:'حذف تبلیغ و آزادسازی باقیمانده',recharge:'افزودن ۱ TON',
    graduate:'برداشتن سقف روزانهٔ برنده',continue:'ادامهٔ تست',review:'ارزیابی نوبت تست'};
  let t=`🧭 تصمیم #${d.id}\n${names[d.kind]||d.kind}\nپروژه: ${d.project_id}`;
  if(d.experiment_id)t+=` | تست: ${d.experiment_id}`;
  if(p.reason)t+=`\nدلیل: ${p.reason}`;
  if(e.cpa!=null)t+=`\nCPA: ${Number(e.cpa).toFixed(5)} TON`;
  if(e.spent!=null)t+=`\nخرج: ${Number(e.spent).toFixed(5)} TON`;
  if(e.views!=null)t+=` | ویو: ${e.views}`;
  if(e.actions!=null)t+=` | اکشن: ${e.actions}`;
  if(e.rounds)t+=`\nتکرارهای ثبت‌شده: ${e.rounds.length}`;
  if(d.kind==='create')t+='\nسقف تست: مجموعاً ۰٫۰۵ TON؛ بودجهٔ کمپین: ۱ TON.';
  if(d.kind==='recharge')t+='\nدر صورت رد، کمپین متوقف می‌ماند.';
  return t.slice(0,3500);
};

export function createAdminBot(store,{token,ownerId,api}){
  if(!token||!Number.isSafeInteger(ownerId))throw new Error('admin Telegram bot config missing');
  const bot=new Telegraf(token);
  bot.use(async(ctx,next)=>{if(ctx.from?.id!==ownerId)return;await next();});
  bot.start(ctx=>ctx.reply('ربات مدیریت تبلیغات آماده است. /status وضعیت، /pauseall توقف حفاظتی.'));
  bot.command('status',ctx=>{
    const projects=store.db.prepare(`SELECT p.id,p.slug,p.status,p.mode,p.approved_spend,p.max_allocated,COUNT(e.id) experiments,
      SUM(CASE WHEN e.status='winner' THEN 1 ELSE 0 END) winners FROM projects p LEFT JOIN experiments e ON e.project_id=p.id GROUP BY p.id`).all();
    ctx.reply(projects.length?projects.map(p=>{
      const cap=projectCapacity(store.db,p.id),committed=projectSpendCommitment(store.db,p.id);
      return `${p.slug}: ${p.status}، ${p.mode}، ${p.experiments} تست، ${p.winners||0} برنده\n`+
        `تخصیص: ${cap.allocated.toFixed(2)} از ${p.max_allocated.toFixed(2)} TON؛ `+
        `مجوز خرج: ${committed.toFixed(2)} از ${p.approved_spend.toFixed(2)} TON`;
    }).join('\n\n'):'پروژه‌ای ثبت نشده است.');
  });
  bot.command('pauseall',async ctx=>{
    store.db.prepare(`UPDATE projects SET status='paused' WHERE status IN ('draft','ready')`).run();
    const active=store.db.prepare(`SELECT * FROM experiments WHERE ad_id IS NOT NULL AND status IN ('review','testing','winner','limited_winner')`).all();
    let stopped=0,failed=0;
    for(const ex of active){
      try{await pauseManaged(store,api,ex,'admin-pauseall');stopped++;}
      catch(e){failed++;store.audit('admin-bot','pause.failed',ex.id,{message:String(e.message).slice(0,200)});}
    }
    store.audit(`admin:${ownerId}`,'projects.pauseall','all',{stopped,failed});
    await ctx.reply(`توقف محافظتی ثبت شد. ${stopped} تبلیغ متوقف شد؛ ${failed} مورد خطا داشت. تمدید تست و خرج تازه قفل شد.`);
  });
  bot.on('callback_query',async ctx=>{
    const m=/^d:(Y|N|C|X):(\d+)$/.exec(ctx.callbackQuery.data||'');
    if(!m)return ctx.answerCbQuery('دستور نامعتبر');
    const id=Number(m[2]),d=row(store.db,'decisions',id);
    if(!d||d.status!=='pending')return ctx.answerCbQuery('این تصمیم قبلاً ثبت شده است.');
    if(m[1]==='C'||m[1]==='X'){
      if(d.kind!=='review')return ctx.answerCbQuery('گزینه نامعتبر');
      decide(store,id,false,`admin:${ownerId}`);
      const kind=m[1]==='C'?'continue':'delete';
      const next=requestDecision(store,d.project_id,d.experiment_id,kind,{reason:`admin choice on review ${id}`},JSON.parse(d.evidence_json));
      decide(store,next,true,`admin:${ownerId}`);
      await ctx.answerCbQuery(kind==='continue'?'ادامه ثبت شد':'حذف ثبت شد');
    }else{
      decide(store,id,m[1]==='Y',`admin:${ownerId}`);
      await ctx.answerCbQuery(m[1]==='Y'?'تأیید ثبت شد':'رد شد');
    }
    await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
  });
  bot.on(['photo','document'],async ctx=>{
    const replyId=ctx.message.reply_to_message?.message_id;
    const req=replyId?store.db.prepare(`SELECT * FROM banner_requests WHERE message_id=?`).get(replyId):null;
    if(!req)return ctx.reply('تصویر را در پاسخ به پرامپت همان بنر بفرست.');
    if(req.status==='submitted')return ctx.reply('این تصویر قبلاً دریافت شده است.');
    const doc=ctx.message.document;
    if(doc && !['image/png','image/jpeg','image/webp'].includes(doc.mime_type))return ctx.reply('فایل PNG یا JPEG بفرست.');
    const fileId=doc?.file_id||ctx.message.photo?.at(-1)?.file_id;
    if(!fileId)return ctx.reply('تصویر معتبر پیدا نشد.');
    const rawPath=resolve('./data/banners',`raw-${req.id}-${ctx.message.message_id}.img`);
    try{
      await saveTelegramImage(bot,fileId,rawPath);
      const creative=row(store.db,'creatives',req.creative_id);
      addJob(store.db,creative.project_id,'image_qa',{creativeId:creative.id,rawPath,
        exactText:creative.banner_text,language:row(store.db,'projects',creative.project_id).language,
        rules:'Reject missing/incorrect lettering, spelling, poor readability or unsafe misleading visual claims.'});
      store.db.prepare(`UPDATE banner_requests SET status='submitted' WHERE id=?`).run(req.id);
      await ctx.reply('تصویر رسید؛ بررسی متن و کیفیت در صف است.');
    }catch(e){await ctx.reply(`تصویر دریافت نشد: ${String(e.message).slice(0,100)}`);}
  });
  bot.catch(e=>{store.audit('admin-bot','error','update',{message:String(e.message).slice(0,200)});});
  return bot;
}

export async function sendAdminQueue(store,bot,ownerId){
  for(const d of store.db.prepare(`SELECT * FROM decisions WHERE status='pending' AND message_id IS NULL ORDER BY id LIMIT 20`).all()){
    const buttons=d.kind==='review'
      ? [[Markup.button.callback('ادامهٔ تست',`d:C:${d.id}`),Markup.button.callback('حذف کمپین',`d:X:${d.id}`)],
         [Markup.button.callback('فعلاً متوقف بماند',`d:N:${d.id}`)]]
      : [[Markup.button.callback('تأیید',`d:Y:${d.id}`),Markup.button.callback('رد',`d:N:${d.id}`)]];
    const sent=await bot.telegram.sendMessage(ownerId,brief(d),Markup.inlineKeyboard(buttons));
    store.db.prepare(`UPDATE decisions SET message_id=? WHERE id=? AND message_id IS NULL`).run(sent.message_id,d.id);
  }
  for(const req of store.db.prepare(`SELECT b.* FROM banner_requests b JOIN creatives c ON c.id=b.creative_id
    WHERE b.status='pending' AND c.status='needs_image' ORDER BY b.id LIMIT 10`).all()){
    const text=`🎨 بنر #${req.creative_id} — نسخهٔ ${req.revision}\n\n${req.prompt}\n\nتصویر نهایی را در پاسخ به همین پیام، ترجیحاً به‌صورت فایل، بفرست.`;
    const sent=await bot.telegram.sendMessage(ownerId,text.slice(0,4000));
    store.db.prepare(`UPDATE banner_requests SET message_id=?,status='sent' WHERE id=? AND status='pending'`).run(sent.message_id,req.id);
  }
  for(const n of store.db.prepare(`SELECT * FROM notifications WHERE message_id IS NULL ORDER BY id LIMIT 20`).all()){
    const sent=await bot.telegram.sendMessage(ownerId,n.text);
    store.db.prepare('UPDATE notifications SET message_id=? WHERE id=?').run(sent.message_id,n.id);
  }
}

export function notify(store,key,text){
  store.db.prepare(`INSERT OR IGNORE INTO notifications(key,text) VALUES (?,?)`).run(key,text.slice(0,4000));
}
