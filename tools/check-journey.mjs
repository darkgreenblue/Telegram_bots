// چکِ قراردادِ «مسیرِ ریزِ کاربر» (shared/journey.js + لایه‌ی تحلیلِ داشبورد).
// اجرا از ریشه‌ی ریپو:  node tools/check-journey.mjs      (نیازمندِ نصبِ dependencyهای bots/dashboard)
//
// چرا این چک هست: کلیدِ صفحه از «شکلِ تعاملیِ پیام» ساخته می‌شود، پس یک تغییرِ ظاهراً بی‌ضرر در
// نرمال‌سازی می‌تواند بی‌صدا یک صفحه را به چند کلید تکه‌تکه کند (یا چند صفحه را قاطی کند) و همه‌ی
// قیف‌های ریز را خراب کند بدونِ اینکه هیچ خطایی بدهد. این‌جا یک مسیرِ کاملِ کاربر شبیه‌سازی و
// تک‌تکِ تضمین‌ها چک می‌شود: پایداریِ کلید، عدمِ ذخیره‌ی متنِ کاربر، حذفِ ادمین، و یکی‌بودنِ
// «عدد» با «لیستِ کاربرانِ پشتِ آن عدد».
//
// فیکسچر در bots/tarot/data ساخته و در پایان پاک می‌شود (اگر ربات واقعی دیتا دارد، اجرا نکن).
import { mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// از ریشه‌ی ریپو اجرا می‌شود (مثل بقیه‌ی چک‌های tools/)
const ROOT = path.resolve(process.cwd());
const Database = require(path.join(ROOT, 'bots/dashboard/node_modules/better-sqlite3'));

const DATA = path.join(ROOT, 'bots/tarot/data');
const DBF = path.join(DATA, 'bot-fa.db');
// گاردِ ایمنی: اگر این‌جا دیتای واقعی هست (اجرای اشتباهی روی سرور/لوکالِ دارای دیتا)، هرگز پاک نکن.
if (existsSync(DATA)) {
  console.error('❌ bots/tarot/data از قبل وجود دارد — این چک فقط روی محیطِ تمیز (CI) اجرا می‌شود.');
  process.exit(1);
}
mkdirSync(DATA, { recursive: true });

const db = new Database(DBF);
db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
  display_name TEXT DEFAULT '', created_at INTEGER DEFAULT (unixepoch()), last_seen INTEGER DEFAULT (unixepoch()));`);

const { ensureAnalytics, track } = await import(path.join(ROOT, 'shared/analytics.js'));
const { registerJourney } = await import(path.join(ROOT, 'shared/journey.js'));
ensureAnalytics(db);

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { bad++; console.log(`  ❌ ${name} ${extra}`); }
};

/* ───── ربات و ctx ساختگی ───── */
const mw = [];
const bot = { use: (f) => mw.push(f) };
const NAMES = { 1: 'علیرضا', 2: 'مریم', 3: 'سارا', 4: 'کیوان' };
db.prepare('INSERT INTO users (telegram_id, name, display_name) VALUES (?,?,?)').run(1, 'a', NAMES[1]);
db.prepare('INSERT INTO users (telegram_id, name, display_name) VALUES (?,?,?)').run(2, 'b', NAMES[2]);
db.prepare('INSERT INTO users (telegram_id, name, display_name) VALUES (?,?,?)').run(3, 'c', NAMES[3]);
db.prepare('INSERT INTO users (telegram_id, name, display_name) VALUES (?,?,?)').run(4, 'd', NAMES[4]);

const KB = new Set(['🔮 فال بگیر', '🎴 کارت روز (رایگان)']);
registerJourney(bot, {
  db,
  isAdmin: (uid) => uid === 4,
  isButtonLabel: (t) => KB.has(t),
  redact: (ctx) => [NAMES[ctx.from.id]],
});

let msgSeq = 100;
function makeCtx(uid, update) {
  const ctx = {
    from: { id: uid }, chat: { id: uid }, state: {}, updateType: update.updateType || 'message',
    ...update,
    async reply(text, extra) { return { message_id: ++msgSeq, chat: { id: uid }, text, extra }; },
    async replyWithPhoto(media, extra) { return { message_id: ++msgSeq, chat: { id: uid } }; },
    async editMessageText(text, extra) { return { message_id: ++msgSeq, chat: { id: uid } }; },
  };
  return ctx;
}
// اجرای میدل‌ور و بعد «هندلر» (کاری که ربات واقعی می‌کند)
async function run(uid, update, handler) {
  const ctx = makeCtx(uid, update);
  await mw[0](ctx, async () => { if (handler) await handler(ctx); });
  return ctx;
}

const IK = (...rows) => ({ reply_markup: { inline_keyboard: rows } });
const cb = (text, data) => ({ text, callback_data: data });

/* ───── شبیه‌سازیِ مسیرِ واقعیِ tarot ───── */
// پی‌وال: متنِ شخصی‌شده (نام + تعداد + قیمت) ولی **یک صفحه** است — کلیدش باید برای همه یکی باشد
const paywall = (name, cards, price) =>
  `${name} جان، موجودیت کافی نیست.\nهزینه‌ی این ${cards} تا کارت می‌شه ${price} تومان.\nباید موجودیت رو افزایش بدی.`;

async function journey(uid, { dropAt = 99 } = {}) {
  const nm = NAMES[uid];
  track(db, uid, 'start', { v: '1.6.0' });
  await run(uid, { message: { text: '/start' } }, async (c) => {
    await c.reply('اول بگو اسمت چیه؟ 🌙');
  });
  if (dropAt <= 1) return;
  await run(uid, { message: { text: nm } }, async (c) => {
    await c.reply(`خوش اومدی ${nm}!`);
    await c.reply('حالا بگو بیشتر حول چه موضوعی؟', IK([cb('عشق', 'focus:love')], [cb('کار', 'focus:career')]));
  });
  if (dropAt <= 2) return;
  await run(uid, { updateType: 'callback_query', callbackQuery: { data: 'focus:love', message: { message_id: msgSeq } } }, async (c) => {
    track(db, uid, 'onboard_done', { focus: 'love' });
    await c.reply('یه قرار کوچیک بذاریم', IK([cb('کارت روز', 'daily_go')], [cb('فال سه کارتی', 'spread:three')]));
  });
  if (dropAt <= 3) return;
  await run(uid, { updateType: 'callback_query', callbackQuery: { data: 'spread:three', message: { message_id: msgSeq } } }, async (c) => {
    track(db, uid, 'spread_selected', { spread: 'three' });
    await c.reply('⬇️ *سؤالت رو همین‌جا بنویس یا ویس بفرست*'); // استیتِ ورودی: بدونِ دکمه
  });
  if (dropAt <= 4) return; // ← نقطه‌ی دراپِ موردِ انتظار در تست
  await run(uid, { message: { text: 'سؤال من درباره‌ی رابطه‌ام است و خیلی طولانی نیست' } }, async (c) => {
    track(db, uid, 'question_submitted', {});
    await c.reply('دریافت شد 🤲');
    await c.reply('نفس عمیق بکش', IK([cb('آماده‌ام', 'ready_breath')]));
  });
  if (dropAt <= 5) return;
  await run(uid, { updateType: 'callback_query', callbackQuery: { data: 'ready_breath', message: { message_id: msgSeq } } }, async (c) => {
    await c.reply('دارم بُر می‌زنم', IK([cb('نگه‌دار', 'shuffle_stop')]));
  });
  await run(uid, { updateType: 'callback_query', callbackQuery: { data: 'shuffle_stop', message: { message_id: msgSeq } } }, async (c) => {
    // گریدِ ۲۴تایی: همه‌ی دکمه‌ها pick:N هستند → باید **یک** صفحه باشد نه ۲۴ تا
    await c.reply('سه کارت انتخاب کن', IK(...Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 4 }, (_, c2) => cb('🂠', `pick:${r * 4 + c2}`)))));
  });
  for (let i = 0; i < 3; i++) {
    await run(uid, { updateType: 'callback_query', callbackQuery: { data: `pick:${i}`, message: { message_id: msgSeq } } }, async () => {});
  }
  track(db, uid, 'cards_picked', {});
  // پی‌وال با متنِ شخصی‌شده و قیمتِ متفاوت per کاربر
  await run(uid, { updateType: 'callback_query', callbackQuery: { data: 'pick:3', message: { message_id: msgSeq } } }, async (c) => {
    track(db, uid, 'paywall_shown', {});
    await c.reply(paywall(nm, uid === 3 ? 'پنج' : 'سه', uid === 3 ? '۵۰٬۰۰۰' : '۳۰٬۰۰۰'),
      IK([cb('➕ افزایش موجودی', 'recharge')], [cb('🎁 تخفیف می‌خوام', 'want_discount')]));
  });
  if (dropAt <= 6) return;
  await run(uid, { updateType: 'callback_query', callbackQuery: { data: 'unlock:5', message: { message_id: msgSeq } } }, async (c) => {
    track(db, uid, 'reading_started', {});
    // خروجیِ LLM: بلند و per کاربر یکتا → باید در سطلِ 'content' بیفتد، نه کلیدِ جدید
    await c.reply('🧵 ' + 'روایتِ یکتای فالِ ' + nm + ' که خیلی طولانی است. '.repeat(20));
    track(db, uid, 'product_delivered', {});
  });
}

console.log('\n▶ شبیه‌سازیِ مسیرِ کاربران');
await journey(1);                 // کامل
await journey(2, { dropAt: 4 });  // دراپ روی «سؤالت رو بنویس»
await journey(3, { dropAt: 6 });  // دراپ روی پی‌وال
await journey(4);                 // ادمین (باید از قیف حذف شود)

/* ───── ۱) کلیدِ صفحه پایدار است؟ ───── */
console.log('\n▶ پایداریِ کلیدِ صفحه');
const screens = db.prepare('SELECT * FROM screens').all();
const views = db.prepare("SELECT user_id, json_extract(props,'$.k') k FROM events WHERE event='view'").all();
const paywallKeys = new Set(views.filter(v => {
  const s = screens.find(x => x.k === v.k);
  return s && s.buttons.includes('c:recharge');
}).map(v => v.k));
check('پی‌والِ شخصی‌شده (نام/تعداد/قیمتِ متفاوت) یک کلیدِ واحد دارد', paywallKeys.size === 1, `→ ${paywallKeys.size} کلید`);

const gridScreen = screens.find(s => s.buttons === 'i[c:pick]');
check('گریدِ ۲۴ دکمه‌ی pick یک صفحه است (نه ۲۴ صفحه)', !!gridScreen);

const contentViews = db.prepare("SELECT COUNT(*) c FROM events WHERE event='view' AND json_extract(props,'$.k')='content'").get().c;
check('خروجیِ بلندِ LLM در سطلِ content افتاده (کاتالوگ منفجر نشده)', contentViews >= 2, `→ ${contentViews}`);
check('کاتالوگِ صفحه‌ها کوچک و معنادار مانده', screens.length > 0 && screens.length < 20, `→ ${screens.length} صفحه`);

/* ───── ۲) اکشن‌ها ───── */
console.log('\n▶ ثبتِ اکشن‌ها');
const acts = db.prepare("SELECT json_extract(props,'$.a') a, COUNT(*) n FROM events WHERE event='act' GROUP BY a").all();
const actMap = Object.fromEntries(acts.map(r => [r.a, r.n]));
check('کلیکِ callback با کلیدِ کدمحور ثبت شده (spread/pick/unlock)', actMap.spread >= 3 && actMap.pick >= 12, JSON.stringify(actMap));
check('دستور /start ثبت شده', actMap.cmd >= 4);
check('تایپِ آزاد به‌عنوان text ثبت شده (بدونِ محتوای متن)', actMap.text >= 4);
const textProps = db.prepare("SELECT props FROM events WHERE event='act' AND json_extract(props,'$.a')='text' LIMIT 1").get();
check('محتوای متنِ کاربر ذخیره نشده (فقط طول)', !/سؤال من/.test(textProps.props), textProps.props);
const withScreen = db.prepare("SELECT COUNT(*) c FROM events WHERE event='act' AND json_extract(props,'$.s') IS NOT NULL").get().c;
check('اکشن می‌داند روی کدام صفحه زده شده (prop s)', withScreen > 0, `→ ${withScreen}`);
const admTagged = db.prepare("SELECT COUNT(*) c FROM events WHERE json_extract(props,'$.adm')=1").get().c;
check('رویدادهای ادمین تگ خورده‌اند', admTagged > 0, `→ ${admTagged}`);

/* ───── ۳) کوئری‌های داشبورد ───── */
console.log('\n▶ داشبورد: قدم‌های ریز، نقطه‌ی خروج، صفحه‌ها');
process.chdir(path.join(ROOT, 'bots/dashboard'));
const J = await import(path.join(ROOT, 'bots/dashboard/lib/journey.js'));

const ms = J.microSteps('tarot', { stageEv: 'spread_selected', nextEv: 'question_submitted' });
check('قدم‌های ریزِ بینِ «انتخاب فال» و «ارسال سؤال» پیدا شد', ms.steps.length > 0, `→ ${ms.steps.length}`);
check('ادمین از قیف حذف شده (۳ کاربر رسیدند نه ۴)', ms.stageUsers === 3, `→ ${ms.stageUsers}`);
const askStep = ms.steps.find(s => s.ev === 'view');
const askScreen = J.screenMap('tarot').get(askStep?.k);
check('اولین قدمِ ریز همان پیامِ «سؤالت رو بنویس» است', /سؤالت رو/.test(askScreen?.sample || ''), askScreen?.sample?.slice(0, 40));
check('افتِ کاربر روی همان پیام دیده می‌شود', ms.steps.some(s => s.drop > 0) || ms.steps[0].users > (ms.steps[1]?.users ?? 0),
  JSON.stringify(ms.steps.map(s => [s.ev, s.users, s.drop])));

const ex = J.exitPoints('tarot', { now: Math.floor(Date.now() / 1000) + 48 * 3600 });
check('نقاطِ خروج محاسبه شد', ex.list.length > 0, `→ ${ex.list.length}`);
check('ادمین در نقاطِ خروج نیست', ex.total === 3, `→ ${ex.total}`);

const rep = J.screensReport('tarot', { since: 0 });
check('گزارشِ صفحه‌ها ساخته شد', rep.length > 0, `→ ${rep.length}`);
const askRep = rep.find(r => r.k === askStep?.k);
check('نرخِ عبورِ پیامِ «سؤالت رو بنویس» کمتر از ۱۰۰٪ است (یکی ریخت)', askRep && askRep.pass < 1, JSON.stringify(askRep));

/* ───── ۴) کوهورت: عدد ↔ لیستِ کاربران ───── */
console.log('\n▶ کوهورت (پشتِ هر عدد، آدم‌هایش)');
const { resolveCohort } = await import(path.join(ROOT, 'bots/dashboard/lib/cohorts.js'));
const q = new URL(`http://x/cohort?k=micro&bot=tarot&ev=${askStep.ev}&key=${askStep.k}&stage=spread_selected&next=question_submitted&since=0&ch=0`);
const c1 = resolveCohort(q);
check('لیستِ کاربرانِ پشتِ عددِ قدمِ ریز با خودِ عدد یکی است',
  c1.users?.length === askStep.users, `عدد=${askStep.users} لیست=${c1.users?.length}`);
const c2 = resolveCohort(new URL(`http://x/cohort?k=exit&bot=tarot&ev=${ex.list[0].ev}&key=${ex.list[0].k}&since=0&idle=${ex.idleBefore}`));
check('لیستِ کاربرانِ نقطه‌ی خروج با عددش یکی است',
  c2.users?.length === ex.list[0].n, `عدد=${ex.list[0].n} لیست=${c2.users?.length}`);

/* ───── ۵) ورودیِ خصمانه ───── */
console.log('\n▶ ورودیِ خصمانه (تزریق SQL)');
for (const evil of ["'; DROP TABLE users;--", '../../etc/passwd', 'x" OR "1"="1']) {
  const r = resolveCohort(new URL(`http://x/cohort?k=micro&bot=${encodeURIComponent(evil)}&ev=view&key=${encodeURIComponent(evil)}&stage=${encodeURIComponent(evil)}&since=0`));
  if (r.error || !r.users?.length) ok++; else { bad++; console.log(`  ❌ ورودیِ خصمانه رد نشد: ${evil}`); }
}
check('جدولِ users بعد از ورودیِ خصمانه سالم است', db.prepare('SELECT COUNT(*) c FROM users').get().c === 4);

/* ───── ۶) سشن‌بندی ───── */
console.log('\n▶ سشن‌بندی');
const sess = J.groupSessions([{ ts: 1000 }, { ts: 1100 }, { ts: 1000 + 3 * 3600 }, { ts: 1000 + 3 * 3600 + 60 }]);
check('دو سشنِ جدا تشخیص داده شد', sess.length === 2, `→ ${sess.length}`);
check('جدیدترین سشن اول است', sess[0].start > sess[1].start);

console.log(`\n${bad ? '❌' : '✅'} نتیجه: ${ok} پاس، ${bad} خطا\n`);
db.close();
rmSync(DATA, { recursive: true, force: true }); // فیکسچر هرگز روی دیسک نمی‌ماند
process.exit(bad ? 1 : 0);
