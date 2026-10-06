import { Telegraf,Markup } from 'telegraf';
import { resolve } from 'node:path';
import { saveTelegramImage } from './images.js';
import { row } from './db.js';
import { currentBannerRequest,submitBannerImage } from './banner-state.js';
import { decide,requestDecision,pauseManaged,projectCapacity,projectSpendCommitment } from './workflow.js';

const compact=(value,limit=350)=>Array.from(String(value??'')).slice(0,limit).join('');
export const decisionBrief=(store,d,{live=false,costVerified=false}={})=>{
  const p=JSON.parse(d.payload_json),e=JSON.parse(d.evidence_json);
  const names={create:'ساخت تبلیغ و تخصیص ۱ TON',delete:'حذف تبلیغ و آزادسازی باقیمانده',recharge:'افزودن ۱ TON',
    graduate:'برداشتن سقف روزانهٔ برنده',continue:'ادامهٔ تست',review:'ارزیابی نوبت تست'};
  let t=`🧭 تصمیم #${d.id}\n${names[d.kind]||d.kind}\nپروژه: ${d.project_id}`;
  if(d.experiment_id)t+=` | تست: ${d.experiment_id}`;
  const context=d.experiment_id?store.db.prepare(`SELECT c.surface,c.value,c.hypothesis,c.source,c.evidence_json,c.features_json,
    cr.angle,cr.ad_text FROM experiments ex JOIN candidates c ON c.id=ex.candidate_id
    JOIN creatives cr ON cr.id=ex.creative_id WHERE ex.id=?`).get(d.experiment_id):null;
  if(context){
    const surfaces={channels:'کانال',bots:'ربات',search:'عبارت جست‌وجو',users:'ترکیب مخاطب'};
    t+=`\nمحل تبلیغ (${surfaces[context.surface]}): ${compact(context.value,180)}`;
    t+=`\nزاویه: ${compact(context.angle,180)}\nمتن تبلیغ: ${compact(context.ad_text,160)}`;
  }
  const ownerHypothesis=context?JSON.parse(context.features_json).ownerHypothesisFa:null;
  const reason=p.reason||ownerHypothesis||context?.hypothesis;
  if(reason)t+=`\nدلیل / فرضیه: ${compact(reason,500)}`;
  if(e.cpa!=null)t+=`\nCPA: ${Number(e.cpa).toFixed(5)} TON`;
  if(e.spent!=null)t+=`\nخرج: ${Number(e.spent).toFixed(5)} TON`;
  if(e.views!=null)t+=` | ویو: ${e.views}`;
  if(e.actions!=null)t+=` | اکشن: ${e.actions}`;
  if(e.rounds)t+=`\nتکرارهای ثبت‌شده: ${e.rounds.length}`;
  const quality=e.paymentQuality?.experiments?.find(item=>item.experimentId===d.experiment_id);
  if(quality?.cohorts){
    for(const instance of quality.cohorts.slice(0,3))for(const days of [7,30]){
      const age=instance[days];if(!age)continue;
      if(!age.eligibleUsers)t+=`\nکیفیت ${days}روزه: هنوز کاربر با سن کافی نداریم.`;
      else if(!age.paymentQualityKnown)t+=`\nکیفیت ${days}روزه: زمان یا مبلغ پرداخت نامعلوم؛ مقایسهٔ درآمد ممکن نیست.`;
      else t+=`\nکیفیت ${days}روزه (${compact(instance.instance,50)}): ${age.eligibleUsers} کاربر هم‌سن؛ `+
        `${age.payers} پرداخت‌کننده؛ درآمد ناخالص ${age.revenue} ${age.revenueUnit==='star'?'Stars':'تومان'}.`;
    }
    t+='\nبازپرداخت نامعلوم است؛ این اعداد سود خالص نیستند. نسخه‌های محصول در شواهد جدا نگهداری می‌شوند.';
  }
  if(context){
    t+=`\nمنبع: ${compact(context.source,180)}`;
    const sources=JSON.parse(context.evidence_json).filter(v=>typeof v.url==='string').slice(0,2);
    for(const source of sources)t+=`\n${compact(source.url,220)}`;
    t+='\nاین شواهد، فرضیهٔ انتخاب‌اند؛ نتیجهٔ تست تبلیغ نیستند.';
  }
  if(d.kind==='create')t+='\nاثر تأیید: ساخت همین تبلیغ با تخصیص ۱ TON و مجوز تست مجموعاً ۰٫۰۵ TON.\nاثر رد: این تبلیغ ساخته نمی‌شود.';
  if(d.kind==='continue')t+='\nاثر تأیید: مجوز یک نوبت تازهٔ ۰٫۰۵ TON در سقف پروژه.\nاثر رد: تبلیغ متوقف می‌ماند.';
  if(d.kind==='graduate')t+='\nاثر تأیید: برداشتن سقف روزانه تا سقف تجمعی ۱ TON، در محدودهٔ مجوز پروژه.\nاثر رد: ارتقا اجرا نمی‌شود.';
  if(d.kind==='delete')t+='\nاثر تأیید: توقف و حذف پس از انتظار API؛ فقط ماندهٔ تأییدشده آزاد می‌شود و شواهد حفظ می‌شوند.\nاثر رد: حذف اجرا نمی‌شود.';
  if(d.kind==='recharge')t+='\nاثر تأیید: تخصیص ۱ TON بعدی، در سقف مجوز پروژه.\nاثر رد: کمپین متوقف می‌ماند.';
  if(!live||!costVerified)t+='\n🔒 خرج غیرفعال است؛ تأیید این پیام به‌تنهایی مجوز عبور از گیت مالی نیست.';
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
    if(!currentBannerRequest(store.db,req.id))return ctx.reply('این پرامپت قدیمی است؛ تصویر را در پاسخ به آخرین پرامپت همین بنر بفرست.');
    const doc=ctx.message.document;
    if(doc && !['image/png','image/jpeg','image/webp'].includes(doc.mime_type))return ctx.reply('فایل PNG یا JPEG بفرست.');
    const fileId=doc?.file_id||ctx.message.photo?.at(-1)?.file_id;
    if(!fileId)return ctx.reply('تصویر معتبر پیدا نشد.');
    const rawPath=resolve('./data/banners',`raw-${req.id}-${ctx.message.message_id}.img`);
    try{
      await saveTelegramImage(bot,fileId,rawPath);
      submitBannerImage(store,req.id,rawPath);
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
    const sent=await bot.telegram.sendMessage(ownerId,decisionBrief(store,d,{live:process.env.ADS_LIVE_ENABLED==='1',
      costVerified:process.env.ADS_COST_GATE_VERIFIED==='1'}),Markup.inlineKeyboard(buttons));
    store.db.prepare(`UPDATE decisions SET message_id=? WHERE id=? AND message_id IS NULL`).run(sent.message_id,d.id);
  }
  for(const req of store.db.prepare(`SELECT b.* FROM banner_requests b JOIN creatives c ON c.id=b.creative_id
    WHERE b.status='pending' AND c.status='needs_image' ORDER BY b.id LIMIT 10`).all()){
    const text=`🎨 بنر #${req.creative_id}، نسخهٔ ${req.revision}\n\n${req.prompt}\n\nتصویر نهایی را در پاسخ به همین پیام، ترجیحاً به‌صورت فایل، بفرست.`;
    const sent=Array.from(text).length<=4000
      ?await bot.telegram.sendMessage(ownerId,text)
      :await bot.telegram.sendDocument(ownerId,{source:Buffer.from(req.prompt,'utf8'),filename:`banner-${req.creative_id}-v${req.revision}.txt`},
        {caption:`🎨 بنر #${req.creative_id}، نسخهٔ ${req.revision}\nپرامپت کامل در فایل است. تصویر نهایی را در پاسخ به همین پیام بفرست.`});
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
