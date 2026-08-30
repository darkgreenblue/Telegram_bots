// shared/journey.js — ثبتِ خودکارِ «مسیرِ ریزِ کاربر» (قرارداد CLAUDE.md ریشه، بند ۲الف/journey)
//
// چرا خودکار و نه دستی: قیفِ milestone محورِ shared/analytics.js می‌گوید کاربر به «انتخاب نوع فال»
// رسید یا نه، ولی نمی‌گوید بین دو milestone دقیقاً کجا ریخت. برچسب‌زدنِ دستیِ ~۲۰۰ نقطه هم
// نگه‌داشتنی نیست (هر پیامِ جدیدی که بعداً اضافه شود بی‌صدا از قیف جا می‌ماند). این ماژول به‌جایش
// یک میدل‌ورِ Telegraf می‌گذارد که **هر پیامِ خروجی و هر اکشنِ ورودی** را خودش ثبت می‌کند؛
// پوشش کامل می‌ماند حتی برای فلوهایی که بعداً نوشته می‌شوند.
//
// دو رویدادِ جدید (افزایشی — هیچ رویداد/قراردادِ موجودی عوض نمی‌شود):
//   view  props: { k, t, n?, adm? }        k = کلیدِ صفحه، t = msg|photo|edit، n = طولِ متنِ محتوایی
//   act   props: { a, d?, s?, n?, adm? }   a = کلیدِ اکشن، d = دیتای کامل، s = صفحه‌ای که دکمه رویش بود
//                                         (برای a='my_chat_member'، d = وضعیتِ تازه: kicked|member|…)
//
// قوانین shared: بدون import از npm؛ db و isAdmin و... با dependency injection می‌آیند.
// خطای این ماژول هرگز نباید فلو را بشکند: همه‌چیز در try/catch و در بدترین حالت فقط logErr.
import { createHash } from 'crypto';
import { logErr } from './logger.js';
import { track } from './analytics.js';

// نسخه‌ی قراردادِ journey — عمداً از ANALYTICS_SCHEMA_VERSION جداست، چون این ماژول جدول events و
// ستون‌های اتریبیوشن را دست نمی‌زند (فقط رویدادِ جدید اضافه می‌کند + جدولِ کاتالوگِ خودش).
// پس کپیِ محلیِ voice2text و پورتِ پایتونیِ tabir لازم نیست هم‌زمان بامپ شوند.
export const JOURNEY_SCHEMA_VERSION = 1;
export const JOURNEY_EVENTS = { VIEW: 'view', ACT: 'act' };

// پیامِ بدونِ دکمه و بلندتر از این = «محتوا» (خروجیِ LLM، غزل، تفسیر کارت) نه «صفحه».
// محتوا per کاربر یکتاست؛ اگر هش می‌شد، کاتالوگِ صفحه‌ها با کلیدهای یک‌بارمصرف منفجر می‌شد.
// همه‌ی محتواها زیرِ کلیدِ ثابتِ 'content' با طولشان ثبت می‌شوند.
const CONTENT_MIN_CHARS = 220;
// یک (کاربر × صفحه) در این پنجره فقط یک‌بار ثبت می‌شود (ضدِ انیمیشن/ادیتِ پیاپی)
const DEDUP_MS = 4000;
// سقفِ ایمنیِ کاتالوگ: اگر روزی نرمال‌سازی خراب شد، جدول screens بی‌نهایت رشد نکند
const CATALOG_MAX = 5000;

/* ═══ جدولِ کاتالوگِ صفحه‌ها ═══
   کلیدِ صفحه یک هشِ کوتاه است؛ این جدول همان کلید را به **متنِ واقعیِ فارسی** وصل می‌کند تا
   داشبورد به‌جای هشِ کور، خودِ پیامی که کاربر دیده را نشان دهد. (فقط یک‌بار per کلید نوشته
   می‌شود؛ شمارش‌ها در زمانِ خواندن از events محاسبه می‌شوند تا نوشتنِ اضافه نداشته باشیم.) */
export function ensureJourney(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS screens (
      k          TEXT PRIMARY KEY,
      label      TEXT    NOT NULL DEFAULT '',
      kind       TEXT    NOT NULL DEFAULT '',
      sample     TEXT    NOT NULL DEFAULT '',
      buttons    TEXT    NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

const hash8 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);

/* نرمال‌سازیِ متن برای ساختِ کلیدِ پایدار: هر چیزی که per کاربر/لحظه فرق می‌کند حذف می‌شود
   (اعداد → #، نامِ کاربر → §، تگ‌های HTML سبک) تا یک «صفحه» برای همه‌ی کاربران یک کلید بدهد. */
// عددهای حرفی هم مثل رقم «مقدارِ پویا»اند (مثلِ «هزینه‌ی این سه تا کارت» که برای فالِ پنج‌کارتی
// «پنج» می‌شود). بدونِ این، یک صفحه‌ی واحد به چند کلید تکه‌تکه می‌شد.
const NUM_WORDS = /(?<![؀-ۿ])(یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده|یازده|دوازده)(?![؀-ۿ])/g;

function normText(s, redactions = []) {
  let t = String(s ?? '');
  for (const r of redactions) {
    const v = String(r ?? '').trim();
    if (v.length >= 2) t = t.split(v).join('§');
  }
  return t
    .replace(/<\/?[a-zA-Z][^>]{0,60}>/g, '')
    .replace(/[0-9۰-۹٠-٩][0-9۰-۹٠-٩,،٬.]*/g, '#')
    .replace(NUM_WORDS, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

/* اثرانگشتِ دکمه‌ها = هویتِ اصلیِ یک صفحه (کدمحور است، نه کاربرمحور).
   پارامترِ callback_data حذف می‌شود تا `pick:0..23` یا `spread:love|three` همان یک صفحه بمانند. */
function btnPrint(rm) {
  if (!rm) return '';
  if (Array.isArray(rm.inline_keyboard)) {
    const out = [];
    for (const row of rm.inline_keyboard) {
      for (const b of row || []) {
        if (b?.callback_data) out.push('c:' + String(b.callback_data).split(':')[0]);
        else if (b?.url) out.push('u');
        else if (b?.copy_text) out.push('p');
        else if (b?.switch_inline_query !== undefined || b?.switch_inline_query_current_chat !== undefined) out.push('s');
        else out.push('?');
      }
    }
    return 'i[' + [...new Set(out)].sort().join(',') + ']';
  }
  if (Array.isArray(rm.keyboard)) {
    const out = [];
    for (const row of rm.keyboard) {
      for (const b of row || []) out.push(typeof b === 'string' ? b : (b?.text || ''));
    }
    return 'k[' + out.join('|').slice(0, 120) + ']';
  }
  if (rm.remove_keyboard) return 'rm';
  return '';
}

// reply_markup را از شکل‌های مختلفِ extra بیرون می‌کشد (Markup تلگراف، آبجکت خام، اسپرد)
const markupOf = (extra) => (extra && typeof extra === 'object' ? extra.reply_markup || null : null);

/* ═══ وضعیتِ درون‌پروسه‌ای (فقط بهینه‌سازی — منبعِ حقیقت خودِ events است) ═══ */
const state = new WeakMap(); // db -> { known:Set، count:number، seen:Map، msg:Map }

function st(db) {
  let s = state.get(db);
  if (!s) {
    s = { known: new Set(), count: -1, seen: new Map(), msg: new Map() };
    state.set(db, s);
  }
  return s;
}

// ثبتِ یک‌بارِ صفحه در کاتالوگ (فقط اولین باری که این کلید در این پروسه دیده می‌شود)
function catalog(db, k, { label, kind, sample, buttons }) {
  const s = st(db);
  if (s.known.has(k)) return;
  s.known.add(k);
  try {
    if (s.count < 0) s.count = db.prepare('SELECT COUNT(*) c FROM screens').get()?.c ?? 0;
    if (s.count >= CATALOG_MAX) return;
    const info = db.prepare('INSERT OR IGNORE INTO screens (k, label, kind, sample, buttons) VALUES (?,?,?,?,?)')
      .run(k, label || '', kind || '', String(sample ?? '').slice(0, 400), buttons || '');
    if (info.changes) s.count++;
    // اگر بعداً برچسبِ خوانا (ctx.step) اضافه شد، همان ردیفِ قبلی به‌روز شود
    else if (label) db.prepare("UPDATE screens SET label=? WHERE k=? AND label=''").run(label, k);
  } catch (e) { logErr('journey catalog:', e.message); }
}

// ضدِ ثبتِ تکراریِ یک صفحه برای یک کاربر در چند ثانیه (انیمیشن/ادیتِ پیاپی)
function deduped(db, uid, k) {
  const s = st(db);
  const key = `${uid}:${k}`;
  const now = Date.now();
  const prev = s.seen.get(key);
  if (prev && now - prev < DEDUP_MS) return true;
  s.seen.set(key, now);
  if (s.seen.size > 500) for (const [kk, ts] of s.seen) if (now - ts > 60_000) s.seen.delete(kk);
  return false;
}

// نگاشتِ پیام → صفحه (تا بدانیم کاربر کدام دکمه را روی **کدام صفحه** زده). بعد از ری‌استارت
// خالی است و prop `s` صرفاً غایب می‌شود (بدونِ خطا) — یک nice-to-have، نه وابستگیِ حیاتی.
function rememberMsg(db, chatId, msgId, k) {
  if (!chatId || !msgId) return;
  const s = st(db);
  s.msg.set(`${chatId}:${msgId}`, k);
  if (s.msg.size > 2000) { const it = s.msg.keys(); for (let i = 0; i < 500; i++) s.msg.delete(it.next().value); }
}
const msgScreen = (db, chatId, msgId) => (chatId && msgId ? st(db).msg.get(`${chatId}:${msgId}`) : undefined) || undefined;

/* ═══ ثبتِ یک پیامِ خروجی ═══ */
function logView(o, ctx, { text, rm, kind, sentMsg }) {
  const uid = ctx.from?.id;
  if (!uid) return;
  let redactions = [];
  try { redactions = o.redact(ctx) || []; } catch {}
  const raw = String(text ?? '');
  const buttons = btnPrint(rm);
  // برچسبِ صریحِ ctx.step(...) بالاترین اولویت را دارد (برای صفحه‌های مهمِ بدونِ دکمه)
  const label = ctx.state?.__journeyStep || '';
  if (label) ctx.state.__journeyStep = '';

  let k, props;
  if (label) {
    k = label;
    props = { k, t: kind };
  } else if (!buttons && raw.length > CONTENT_MIN_CHARS) {
    // محتوا (خروجیِ LLM و…): کلیدِ ثابت + طول، تا کاتالوگ با کلیدهای یک‌بارمصرف پر نشود
    k = 'content';
    props = { k, t: kind, n: raw.length };
  } else {
    // وقتی پیام دکمه دارد، **خودِ دکمه‌ها** هویتِ اصلیِ صفحه‌اند و متن فقط تفکیک‌کننده‌ی درشت است؛
    // پس فقط ابتدای متن به هش می‌رود. وگرنه یک صفحه‌ی واحد (مثل پی‌وال) به‌خاطرِ تفاوت‌های پویای
    // میانِ متن («سه تا کارت» / «پنج تا کارت») به چند کلید تکه‌تکه می‌شد و قیف را می‌شکست.
    const t = normText(raw, redactions);
    k = hash8(buttons + '|' + (buttons ? t.slice(0, 32) : t));
    props = { k, t: kind };
  }
  if (o.isAdmin(uid)) props.adm = 1;

  rememberMsg(o.db, ctx.chat?.id, sentMsg?.message_id, k);
  if (deduped(o.db, uid, k)) return;
  // نمونه‌ی متن (چیزی که داشبورد نشان می‌دهد) با جای‌گزینیِ مقادیرِ شخصی ذخیره می‌شود: هم داده‌ی
  // یک کاربرِ خاص در کاتالوگِ عمومی نمی‌ماند، هم واضح است که آن تکه پویاست نه بخشی از خودِ پیام.
  if (k !== 'content') {
    let sample = raw;
    for (const r of redactions) {
      const v = String(r ?? '').trim();
      if (v.length >= 2) sample = sample.split(v).join('‹نام›');
    }
    catalog(o.db, k, { label, kind, sample, buttons });
  }
  track(o.db, uid, JOURNEY_EVENTS.VIEW, props);
}

/* ═══ ثبتِ یک اکشنِ ورودی ═══
   callback_data از قبل یک کلیدِ پایدارِ کدمحور است (spread:three / pick:5 / unlock:12) — پس
   سمتِ ورودی صددرصد خودکار و بدونِ هیچ برچسب‌گذاری کار می‌کند. */
function logAct(o, ctx) {
  const uid = ctx.from?.id;
  if (!uid) return;
  const props = {};
  const cq = ctx.callbackQuery;
  const msg = ctx.message;

  if (cq?.data) {
    const d = String(cq.data);
    props.a = d.split(':')[0] || 'cb';
    if (d !== props.a) props.d = d.slice(0, 64);
    const s = msgScreen(o.db, ctx.chat?.id, cq.message?.message_id);
    if (s) props.s = s;
  } else if (msg?.text) {
    const t = msg.text;
    if (t.startsWith('/')) { props.a = 'cmd'; props.d = t.split(/\s+/)[0].slice(0, 32); }
    else if (o.isButtonLabel(t)) { props.a = 'kb'; props.d = t.slice(0, 48); }
    else { props.a = 'text'; props.n = t.length; } // محتوای متنِ کاربر هرگز ثبت نمی‌شود
  } else if (msg?.voice || msg?.audio) {
    props.a = 'voice';
    props.n = msg.voice?.duration || msg.audio?.duration || 0;
  } else if (msg?.photo) props.a = 'photo';
  else if (msg?.document) props.a = 'doc';
  else if (ctx.inlineQuery) props.a = 'inline';
  else if (ctx.myChatMember) {
    // آپدیتِ سرویسیِ تلگرام، نه اقدامی داخلِ فلو. در چتِ خصوصی دقیقاً یعنی: کاربر ربات را
    // بلاک کرد (`kicked`) یا آنبلاک/استارت کرد (`member`). این پرتکرارترین «آخرین ردپا»ی
    // کاربرانِ ریخته است، پس بدونِ وضعیت فقط یک نامِ خامِ بی‌معنی در گزارشِ خروج می‌ماند.
    // کلیدِ `a` عمداً همان `my_chat_member` قبلی مانده (بند ۲ج/۳: رویدادِ موجود تغییر
    // نمی‌کند) و وضعیت در propِ **جدیدِ** `d` می‌نشیند — کاملاً افزایشی.
    props.a = 'my_chat_member';
    props.d = String(ctx.myChatMember.new_chat_member?.status || '').slice(0, 16);
  } else props.a = ctx.updateType || 'other';

  if (o.isAdmin(uid)) props.adm = 1;
  track(o.db, uid, JOURNEY_EVENTS.ACT, props);
}

/* ═══ نصب ═══
   باید **قبل از همه‌ی هندلرها** صدا زده شود (میدل‌ورِ تلگراف به ترتیبِ ثبت اجرا می‌شود).
   گزینه‌ها:
     db            اتصالِ better-sqlite3 همان ربات (اجباری)
     enabled       فلگِ رول‌بکِ یک‌خطی (false → هیچ چیزی ثبت و هیچ متدی رپ نمی‌شود)
     isAdmin(uid)  رویدادهای ادمین با prop `adm:1` تگ می‌شوند تا داشبورد بتواند از قیف حذفشان کند
     isButtonLabel(text) آیا این متن، برچسبِ یکی از دکمه‌های کیبوردِ ماندگار است (اکشن، نه تایپِ آزاد)
     redact(ctx)   مقادیرِ پویا (مثل نامِ کاربر) که باید قبل از هش‌کردنِ متن حذف شوند */
export function registerJourney(bot, opts = {}) {
  const o = {
    db: opts.db,
    isAdmin: opts.isAdmin || (() => false),
    isButtonLabel: opts.isButtonLabel || (() => false),
    redact: opts.redact || (() => []),
  };
  if (opts.enabled === false || !o.db) return false;
  try { ensureJourney(o.db); } catch (e) { logErr('journey ensure:', e.message); return false; }

  bot.use(async (ctx, next) => {
    try {
      ctx.state = ctx.state || {};
      // برچسبِ خوانا برای صفحه‌ی بعدی (اختیاری — فقط برای صفحه‌های مهمِ بدونِ دکمه)
      ctx.step = (name) => { ctx.state.__journeyStep = String(name || '').slice(0, 40); };

      const wrap = (method, pick) => {
        const orig = ctx[method];
        if (typeof orig !== 'function') return;
        ctx[method] = async (...args) => {
          const sent = await orig.apply(ctx, args);
          try { logView(o, ctx, { ...pick(args), sentMsg: sent }); } catch (e) { logErr('journey view:', e.message); }
          return sent;
        };
      };
      wrap('reply', (a) => ({ text: a[0], rm: markupOf(a[1]), kind: 'msg' }));
      wrap('replyWithPhoto', (a) => ({ text: a[1]?.caption ?? '', rm: markupOf(a[1]), kind: 'photo' }));
      wrap('editMessageText', (a) => ({ text: a[0], rm: markupOf(a[1]), kind: 'edit' }));

      logAct(o, ctx);
    } catch (e) { logErr('journey mw:', e.message); }
    return next();
  });
  return true;
}
