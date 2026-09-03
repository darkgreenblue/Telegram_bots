#!/usr/bin/env node
// چکِ «کسر در لحظه‌ی انتخابِ اندازه» (tarot UX v2.6).
//
// چرا این فایل جداست و چرا **رفتاری** است نه فقط ساختاری: این تغییر مسیرِ **پول** را
// عوض می‌کند. تا قبل از v2.6 کسر در `unlock:` بود و هر مسیرِ لغو فقط یک وضعیتِ
// `pending_payment` را canceled می‌کرد؛ حالا از همان تپِ اول پول رفته، پس همان مسیرهای
// لغو اگر دست‌نخورده می‌ماندند **بی‌صدا پولِ کاربر را می‌خوردند**. این‌جا خودِ منطق روی یک
// دیتابیسِ واقعیِ در-حافظه اجرا می‌شود، نه اینکه به regex روی سورس اکتفا شود.
//
// اجرا: node tools/check-pay-at-size.mjs
import fs from 'node:fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

const SRC = fs.readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const LOC = fs.readFileSync(new URL('../bots/tarot/locales/fa.js', import.meta.url), 'utf8');

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); } };

// ── یک کپیِ کوچک از همان schema و همان statementها، تا منطق واقعاً اجرا شود ──
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
                      state TEXT NOT NULL DEFAULT 'idle');
  CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    type TEXT NOT NULL, price INTEGER NOT NULL, focus_area TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL DEFAULT '', seed TEXT NOT NULL DEFAULT '',
    cards_json TEXT NOT NULL DEFAULT '', llm_json TEXT NOT NULL DEFAULT '',
    question_audio TEXT NOT NULL DEFAULT '', question_audio_fmt TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_payment', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
`);
const stmts = {
  credit: db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id=?'),
  deduct: db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id=? AND balance >= ?'),
  claimState: db.prepare('UPDATE users SET state=? WHERE telegram_id=? AND state<>?'),
  insertReading: db.prepare(`INSERT INTO readings (user_id, type, price, focus_area, question, seed, cards_json, question_audio, question_audio_fmt) VALUES (?,?,?,?,?,?,?,?,?)`),
  setReadingCards: db.prepare(`UPDATE readings SET seed=?, cards_json=?, focus_area=?, question=?, question_audio=?, question_audio_fmt=? WHERE id=? AND cards_json=''`),
  getReading: db.prepare('SELECT * FROM readings WHERE id=?'),
  setReadingStatus: db.prepare('UPDATE readings SET status=? WHERE id=?'),
};
const bal = (uid) => db.prepare('SELECT balance FROM users WHERE telegram_id=?').get(uid).balance;
const mkUser = (uid, balance) => db.prepare('INSERT INTO users (telegram_id, balance) VALUES (?,?)').run(uid, balance);

// همان تراکنش و همان تابعِ لغو که در index.js اند (اگر آن‌جا عوض شوند، بخشِ «سینک» پایین قرمز می‌شود)
const payForSpread = db.transaction((uid, spread, focusKey) => {
  if (spread.price > 0 && stmts.deduct.run(spread.price, uid, spread.price).changes === 0) return 0;
  const id = Number(stmts.insertReading.run(uid, spread.id, spread.price, focusKey || '', '', '', '', '', '').lastInsertRowid);
  stmts.setReadingStatus.run('paid', id);
  return id;
});
/* ⚠️ `cancelReading` عمداً **کپی نمی‌شود**: از خودِ `index.js` بریده و اجرا می‌شود.
   کپیِ محلیِ منطق دقیقاً همان تله‌ای است که ریپو بارها ثبت کرده (`check-lucky`,
   `check-announce`): تست سبز می‌ماند در حالی که کدِ محصول عوض شده. این‌طوری پرچمِ
   `REFUND_ON_CANCEL` هم واقعاً در هر دو حالت اجرا می‌شود، نه اینکه ادعا شود. */
function bodyOf(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return null;
}
const CANCEL_SRC = bodyOf(SRC, 'function cancelReading(');
const events = [];   // هر track که کدِ محصول می‌زند این‌جا ثبت می‌شود
const trackSpy = (_db, uid, name, props) => events.push({ uid, name, props });
/** همان تابعِ واقعیِ ربات، با پرچمِ دلخواه. */
const makeCancel = (refundOnCancel) => new Function(
  'stmts', 'track', 'db', 'EVENTS', 'REFUND_ON_CANCEL',
  `${CANCEL_SRC}; return cancelReading;`,
)(stmts, trackSpy, db, { REFUND: 'refund' }, refundOnCancel);
const cancelReading = makeCancel(false);          // رفتارِ زنده‌ی امروز
const SP3 = { id: 'love3', price: 30_000, size: 3 };
const SP10 = { id: 'love10', price: 100_000, size: 10 };

console.log('▶ کسرِ اتمیک در لحظه‌ی انتخابِ اندازه');
{
  mkUser(1, 50_000);
  const id = payForSpread(1, SP3, 'love');
  ok(id > 0, 'کاربرِ باموجودی فالِ پرداخت‌شده می‌گیرد');
  ok(bal(1) === 20_000, `دقیقاً قیمتِ همان چیدمان کم شد (${bal(1)})`);
  const r = stmts.getReading.get(id);
  ok(r.status === 'paid', 'وضعیت `paid` است، نه `started` و نه `pending_payment`');
  ok(r.cards_json === '' && r.seed === '' && r.question === '', 'کارت و seed و سؤال هنوز خالی‌اند');
  ok(r.price === SP3.price && r.type === SP3.id, 'قیمت و نوع همان لحظه ثبت می‌شوند (ردپای DB)');
}

console.log('\n▶ کم‌موجودی: نه پولی کم می‌شود، نه رکوردی می‌ماند');
{
  mkUser(2, 20_000);
  const before = bal(2);
  const id = payForSpread(2, SP10, 'love');
  ok(id === 0, 'کاربرِ کم‌موجودی فال نمی‌گیرد');
  ok(bal(2) === before, 'موجودی دست‌نخورده می‌ماند');
  const n = db.prepare('SELECT COUNT(*) c FROM readings WHERE user_id=2').get().c;
  ok(n === 0, 'هیچ رکوردِ نیمه‌کاره‌ای جا نمی‌ماند (تراکنش rollback شد)');
}

console.log('\n▶ گاردِ دوبار-تپ (باگی که `deduct` تنها نمی‌گیردش)');
{
  mkUser(3, 50_000);
  // کاربر با ۵۰٬۰۰۰ دو بار «۳ کارتی» را می‌زند: از نظرِ SQL هر دو خریدِ معتبرند،
  // پس تنها چیزی که نجاتش می‌دهد ادعای اتمیکِ استیت است.
  const first = stmts.claimState.run('await_question', 3, 'await_question').changes;
  const second = stmts.claimState.run('await_question', 3, 'await_question').changes;
  ok(first === 1 && second === 0, 'فقط تپِ اول ادعا را می‌برد');
  if (first) payForSpread(3, SP3, 'love');
  ok(bal(3) === 20_000, `فقط یک بار کم شد (${bal(3)})`);
  ok(db.prepare("SELECT COUNT(*) c FROM readings WHERE user_id=3 AND status='paid'").get().c === 1,
    'فقط یک فالِ پرداخت‌شده ساخته شد');
  // و اثبات کن که بدونِ گارد **واقعاً** دو بار کم می‌شد، وگرنه این تست توخالی است.
  // موجودی عمداً ۷۰٬۰۰۰ است تا هر دو خرید از نظرِ `deduct` معتبر باشند — دقیقاً همان
  // حالتی که نشان می‌دهد شرطِ `balance >= ?` جلوی دوبار-خرید را **نمی‌گیرد**.
  mkUser(33, 70_000);
  payForSpread(33, SP3, 'love'); payForSpread(33, SP3, 'love');
  ok(bal(33) === 10_000, `بدونِ گارد دو بار کم می‌شد (${bal(33)}) — پس گاردِ استیت واقعاً لازم است`);
  ok(db.prepare("SELECT COUNT(*) c FROM readings WHERE user_id=33 AND status='paid'").get().c === 2,
    'و دو فالِ پرداخت‌شده‌ی موازی می‌ساخت');
}

/* 💎 v3.54.0 — تصمیمِ صریحِ مالک: انصرافِ **خودِ کاربر** بعد از کسر، پول را برنمی‌گرداند.
   این بلوک جای بلوکِ «لغو = ریفاندِ کامل» را گرفت. عمداً هر دو جهت سنجیده می‌شود: هم
   اینکه پول نمی‌رود، هم اینکه رول‌بکِ یک‌خطی واقعاً رفتارِ قبلی را برمی‌گرداند. */
console.log('\n▶ لغو = فالِ terminal، ولی پول برنمی‌گردد (v3.54.0)');
{
  mkUser(4, 50_000);
  const id = payForSpread(4, SP3, 'love');
  ok(bal(4) === 20_000, 'اول پول کم شد');
  events.length = 0;
  const back = cancelReading(4, id);
  ok(back === 0, 'خروجی صفر است، پس هیچ نقطه‌ای پیامِ «پولت برگشت» نمی‌فرستد');
  ok(bal(4) === 20_000, 'موجودی دست‌نخورده ماند (پول برنگشت)');
  ok(stmts.getReading.get(id).status === 'canceled',
    'فال terminal شد (canceled) — کاربر پشتِ گاردِ «فالِ باز» گیر نمی‌کند');
  ok(events.length === 1 && events[0].name === 'reading_forfeited',
    `دقیقاً یک رویداد، و نامش reading_forfeited است (${events.map(e => e.name).join(',') || 'هیچ'})`);
  ok(events[0].props?.amount === SP3.price && events[0].props?.reason === 'cancel',
    'مبلغِ سوخته و دلیلش ثبت می‌شود (برای گزارشِ درآمدِ بدونِ تحویل)');
  ok(!events.some(e => e.name === 'refund'),
    'هیچ رویدادِ refund ثبت نمی‌شود (وگرنه داشبورد پولی را برگشتی می‌شمرد که نرفته)');
  // دوبار-لغو هم نه پول می‌دهد نه رویدادِ دوم
  events.length = 0;
  ok(cancelReading(4, id) === 0 && bal(4) === 20_000 && events.length === 0,
    'لغوِ دوباره بی‌اثر است (نه پول، نه رویدادِ تکراری)');
}

console.log('\n▶ رول‌بکِ یک‌خطی: REFUND_ON_CANCEL = true دقیقاً رفتارِ قبلی را برمی‌گرداند');
{
  ok(/const REFUND_ON_CANCEL = false;/.test(SRC), 'پرچم در ربات هست و خاموش است');
  const cancelWithRefund = makeCancel(true);
  mkUser(41, 50_000);
  const id = payForSpread(41, SP3, 'love');
  events.length = 0;
  const back = cancelWithRefund(41, id);
  ok(back === SP3.price && bal(41) === 50_000, 'با پرچمِ روشن، پولِ کامل برمی‌گردد');
  ok(stmts.getReading.get(id).status === 'refunded', 'و وضعیت refunded می‌شود');
  ok(events.length === 1 && events[0].name === 'refund', 'و رویدادِ refund دوباره ثبت می‌شود');
}

console.log('\n▶ فالِ پول‌داده‌ی در جریان هرگز با لغو دست نمی‌خورد');
{
  mkUser(5, 50_000);
  const id = payForSpread(5, SP3, 'love');
  stmts.setReadingStatus.run('started', id); // کارت‌ها کشیده شد، افشا شروع شد
  const back = cancelReading(5, id);
  ok(back === 0, 'فالِ started ریفاند نمی‌شود');
  ok(stmts.getReading.get(id).status === 'started', 'و وضعیتش هم عوض نمی‌شود');
  stmts.setReadingStatus.run('delivered', id);
  ok(cancelReading(5, id) === 0, 'فالِ delivered هم دست‌نخورده می‌ماند');
}

console.log('\n▶ مالکیتِ رکورد');
{
  mkUser(6, 50_000); mkUser(7, 0);
  const id = payForSpread(6, SP3, 'love');
  ok(cancelReading(7, id) === 0, 'کاربرِ دیگر نمی‌تواند فالِ من را ریفاند کند');
  ok(bal(7) === 0 && bal(6) === 20_000, 'و هیچ پولی جابه‌جا نمی‌شود');
}

console.log('\n▶ نوشتنِ کارت‌ها فقط یک بار (ضدِ کشیدنِ دوباره‌ی یک فالِ پرداخت‌شده)');
{
  mkUser(8, 50_000);
  const id = payForSpread(8, SP3, 'love');
  const first = stmts.setReadingCards.run('seed-1', '[{"k":1}]', 'love', 'q', '', '', id).changes;
  const second = stmts.setReadingCards.run('seed-2', '[{"k":2}]', 'love', 'q2', '', '', id).changes;
  ok(first === 1 && second === 0, 'تلاشِ دوم برای نوشتنِ کارت‌ها بی‌اثر است');
  ok(stmts.getReading.get(id).seed === 'seed-1', 'کارت‌های اصلی دست‌نخورده ماندند');
}

console.log('\n▶ جاروی فالِ رهاشده: با پرچمِ خاموش کاملاً no-op است');
{
  const sweep = bodyOf(SRC, 'function sweepAbandonedPaidReadings(');
  ok(!!sweep, 'تابعِ جارو پیدا شد');
  ok(/^\s*if \(!REFUND_ON_CANCEL\) return;/m.test(sweep),
    'اولین خطِ جارو گاردِ پرچم است — پس با پرچمِ خاموش هیچ ردیفی لمس نمی‌شود');
  const iGuard = sweep.indexOf('if (!REFUND_ON_CANCEL) return;');
  ok(iGuard > 0 && iGuard < sweep.indexOf('stmts.credit.run'),
    'گارد **قبل از** هر واریزی می‌آید (گاردِ بعد از خرجِ پول بی‌فایده است)');
  // و با پرچمِ روشن، همان انتخابِ ۲۴ساعته‌ی قبلی سرِ جایش است
  mkUser(9, 100_000);   // کافی برای هر دو خرید، وگرنه دومی اصلاً ساخته نمی‌شود
  const fresh = payForSpread(9, SP3, 'love');            // همین الان
  const oldId = payForSpread(9, SP3, 'love');            // رهاشده
  db.prepare('UPDATE readings SET created_at = unixepoch()-90000 WHERE id=?').run(oldId);
  const q = db.prepare("SELECT id, user_id, price FROM readings WHERE status='paid' AND created_at < unixepoch()-86400");
  const rows = q.all();
  ok(oldId > 0 && rows.length === 1 && rows[0].id === oldId,
    `فقط رکوردِ کهنه‌تر از ۲۴ ساعت انتخاب می‌شود (${rows.length} مورد)`);
  ok(!rows.some(r => r.id === fresh), 'کاربرِ وسطِ نوشتنِ سؤال لمس نمی‌شود (فالش از زیرِ پایش کشیده نمی‌شود)');
  // 💎 و با پرچمِ خاموش، رکوردِ رهاشده عمداً `paid` می‌ماند: تنها راهی که کاربرِ برگشته
  // می‌تواند فالِ پول‌داده‌اش را تمام کند. نبودنِ ریفاند نباید به نابودیِ رکورد هم برسد.
  ok(stmts.getReading.get(oldId).status === 'paid',
    'رکوردِ رهاشده باز می‌ماند تا کاربرِ برگشته بتواند فالش را تمام کند');
}

/* 🛟 مرزِ اصلیِ این تغییر: ریفاند حذف نشد، فقط از «انصرافِ کاربر» برداشته شد.
   خرابیِ **خودمان** باید هنوز کاملاً برگردد، وگرنه پولِ کاربر بابتِ باگِ ما می‌سوزد. */
console.log('\n▶ ریفاندِ خرابیِ خودمان دست‌نخورده است (به پرچم وصل نیست)');
{
  const recover = bodyOf(SRC, 'function recoverOrphanReadings(');
  ok(!!recover && /stmts\.credit\.run\(r\.price, r\.user_id\)/.test(recover),
    'یتیمِ ری‌استارتِ وسطِ فراخوانی هنوز واریز می‌شود');
  ok(!/REFUND_ON_CANCEL/.test(recover || ''),
    'و عمداً به REFUND_ON_CANCEL وصل نیست (باگِ ما ربطی به انصرافِ کاربر ندارد)');
  ok(/status='started' AND llm_json=''/.test(recover || ''),
    'دامنه‌اش همان فالِ بی‌متنِ started است');
  // شکستِ کاملِ مدل بعد از همه‌ی فالبک‌ها هم باید ریفاند بدهد
  const reveal = bodyOf(SRC, 'async function startReveal(');
  ok(!!reveal && /stmts\.credit\.run\(r\.price, uid\)/.test(reveal),
    'شکستِ کاملِ مدل هنوز پولِ کاربر را کامل برمی‌گرداند');
  ok(!/REFUND_ON_CANCEL/.test(reveal || ''), 'و آن هم به پرچم وصل نیست');
}

console.log('\n▶ سینکِ منطقِ این تست با خودِ ربات');
{
  // اگر منطقِ index.js عوض شود ولی این تست نه، تست بی‌صدا چیزِ اشتباهی را سبز می‌کند.
  ok(/const payForSpread = db\.transaction\(\(uid, spread, focusKey\) => \{/.test(SRC), 'payForSpread در ربات همان امضا را دارد');
  ok(/if \(spread\.price > 0 && stmts\.deduct\.run\(spread\.price, uid, spread\.price\)\.changes === 0\) return 0;/.test(SRC),
    'شرطِ کسر در ربات همانی است که این‌جا تست شد');
  ok(/stmts\.setReadingStatus\.run\('paid', id\);/.test(SRC), 'ربات هم وضعیتِ paid می‌گذارد');
  ok(/claimState: db\.prepare\('UPDATE users SET state=\? WHERE telegram_id=\? AND state<>\?'\)/.test(SRC),
    'ادعای اتمیکِ استیت در ربات تعریف شده');
  // ⚠️ وجودِ statement کافی نیست — باید واقعاً **صدا زده** شود، و **قبل از** کسر.
  // (این ادعا بعد از یک mutationِ نگرفته اضافه شد: حذفِ خودِ فراخوانی از چشمِ چک در رفت.)
  const charge = SRC.slice(SRC.indexOf('async function chargeForSpread('), SRC.indexOf('bot.action(/^spread:'));
  ok(charge.length > 0, 'تابعِ chargeForSpread پیدا شد');
  const iClaim = charge.indexOf('stmts.claimState.run(');
  const iPay = charge.indexOf('payForSpread(');
  ok(iClaim > 0, 'گاردِ دوبار-تپ داخلِ chargeForSpread **صدا زده** می‌شود');
  ok(iPay > 0 && iClaim < iPay, 'و **قبل از** کسرِ پول می‌آید (گاردِ بعد از خرج بی‌فایده است)');
  ok(/changes === 0\) return false;/.test(charge.slice(iClaim, iClaim + 160)),
    'شکستِ ادعا یعنی خروجِ بی‌صدا، نه ادامه‌ی فلو');
  // و هیچ awaitی نباید بینِ ورودِ تابع و گارد باشد (وگرنه دو تپ لایش جا می‌شوند)
  ok(!/\bawait\b/.test(charge.slice(0, iClaim)),
    'هیچ awaitی قبل از گارد نیست (دو تپ نمی‌توانند لایش جا شوند)');
  ok(/WHERE id=\? AND cards_json=''/.test(SRC), 'شرطِ یک‌بار-نوشتنِ کارت‌ها در ربات هست');
  ok(/status='paid' AND created_at < unixepoch\(\)-86400/.test(SRC), 'جاروی رهاشده همان بازه را دارد');

  // هر سه مسیرِ لغو باید از همین تک‌تابع رد شوند، نه از setReadingStatus مستقیم
  const cancels = (SRC.match(/cancelReading\(uid, /g) || []).length;
  ok(cancels >= 3, `هر سه نقطه‌ی لغو از تک‌تابعِ لغو رد می‌شوند (${cancels} مورد)`);
  // ⚠️ و هر سه باید پیامِ ریفاند را **مشروط** بفرستند. این تنها چیزی است که نگه می‌دارد
  // «هیچ متنی عوض نشد»: با خروجیِ صفر، جمله‌ی «پولت برگشت» خودبه‌خود نمی‌رود. اگر روزی
  // یکی‌شان بی‌قید بفرستد، ربات به کاربر دروغ می‌گوید.
  const guarded = (SRC.match(/if \(back\) await ctx\.reply\(L\.reading\.refundedOnCancel\(/g) || []).length;
  ok(guarded === (SRC.match(/L\.reading\.refundedOnCancel\(back/g) || []).length && guarded >= 3,
    `هر ${guarded} پیامِ ریفاند پشتِ شرطِ if (back) است (هیچ‌کدام بی‌قید نیست)`);
  ok(!/r\.status === 'pending_payment'\) stmts\.setReadingStatus\.run\('canceled'/.test(SRC),
    'هیچ مسیرِ لغوی دیگر مستقیم canceled نمی‌کند (وگرنه پولِ paid را می‌خورد)');

  // گاردِ هزینه (v3.53.0): `paid` یعنی پول کسر شده، پس فراخوانی مجاز است؛ چیزی که `paid`
  // ممکن است نداشته باشد **کارت** است و آن گاردِ جداگانه در callReadingLLM دارد.
  const guard = SRC.slice(SRC.indexOf('function paidForReading('), SRC.indexOf('async function callReadingLLM('));
  const paidFor = new Function(`${guard}; return paidForReading;`)();
  ok(paidFor({ price: 30_000, status: 'paid' }) === true, 'فالِ paid (پول کسر شده) اجازه‌ی فراخوانیِ LLM دارد');
  ok(paidFor({ price: 30_000, status: 'started' }) === true, 'بعد از کشیدنِ کارت‌ها (started) هم مجاز است');
  ok(paidFor({ price: 30_000, status: 'pending_payment' }) === false, 'فالِ پرداخت‌نشده همچنان ممنوع');
  const callBody = SRC.slice(SRC.indexOf('async function callReadingLLM('), SRC.indexOf('// ⛔️ `startPrefetch` حذف شد'));
  ok(/if \(!r\.cards_json\) \{[\s\S]{0,220}return null;/.test(callBody)
    && callBody.indexOf('if (!r.cards_json)') < callBody.indexOf('JSON.parse(r.cards_json)'),
    'فالِ بی‌کارت قبل از JSON.parse و قبل از هر فراخوانی متوقف می‌شود');

  // رول‌بکِ یک‌خطی
  ok(/const PAY_AT_SIZE = true;/.test(SRC) && /payAtSizeFor = \(uid\) => PAY_AT_SIZE && uxV2For\(uid\)/.test(SRC),
    'پرچمِ مستقلِ رول‌بک هست (جدا از UX_V2)');
  ok(/paidForSpread: \(size, price, balance, cur\)/.test(LOC), 'متنِ تأییدِ کسر در locale هست');
  ok(/refundedOnCancel: \(price, cur\)/.test(LOC), 'متنِ اعلامِ ریفاند در locale هست');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
