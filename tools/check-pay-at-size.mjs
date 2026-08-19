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
function cancelReading(uid, readingId) {
  const r = readingId && stmts.getReading.get(readingId);
  if (!r || r.user_id !== uid) return 0;
  if (r.status === 'pending_payment') { stmts.setReadingStatus.run('canceled', readingId); return 0; }
  if (r.status !== 'paid') return 0;
  if (r.price > 0) stmts.credit.run(r.price, uid);
  stmts.setReadingStatus.run('refunded', readingId);
  return r.price;
}
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

console.log('\n▶ لغو = ریفاندِ کامل (نه فقط canceled)');
{
  mkUser(4, 50_000);
  const id = payForSpread(4, SP3, 'love');
  ok(bal(4) === 20_000, 'اول پول کم شد');
  const back = cancelReading(4, id);
  ok(back === SP3.price, 'مبلغِ برگشتی دقیقاً قیمتِ فال است');
  ok(bal(4) === 50_000, 'موجودی کامل برگشت');
  ok(stmts.getReading.get(id).status === 'refunded', 'وضعیت refunded شد');
  // دوبار-لغو نباید دوبار پول بدهد
  const again = cancelReading(4, id);
  ok(again === 0 && bal(4) === 50_000, 'لغوِ دوباره پولِ اضافه نمی‌دهد');
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

console.log('\n▶ جاروی فالِ رهاشده: فقط کهنه‌ترها، و فقط یک بار');
{
  mkUser(9, 100_000);   // کافی برای هر دو خرید، وگرنه دومی اصلاً ساخته نمی‌شود
  const fresh = payForSpread(9, SP3, 'love');            // همین الان
  const oldId = payForSpread(9, SP3, 'love');            // رهاشده
  db.prepare('UPDATE readings SET created_at = unixepoch()-90000 WHERE id=?').run(oldId);
  const q = db.prepare("SELECT id, user_id, price FROM readings WHERE status='paid' AND created_at < unixepoch()-86400");
  const rows = q.all();
  ok(oldId > 0 && rows.length === 1 && rows[0].id === oldId,
    `فقط رکوردِ کهنه‌تر از ۲۴ ساعت انتخاب می‌شود (${rows.length} مورد)`);
  ok(!rows.some(r => r.id === fresh), 'کاربرِ وسطِ نوشتنِ سؤال ریفاند نمی‌شود (فالش از زیرِ پایش کشیده نمی‌شود)');
  for (const r of rows) { stmts.credit.run(r.price, r.user_id); stmts.setReadingStatus.run('refunded', r.id); }
  ok(q.all().length === 0, 'اجرای دوم چیزی برای ریفاند پیدا نمی‌کند (پولِ دوباره نمی‌دهد)');
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

  // هر سه مسیرِ لغو باید از تابعِ ریفاند رد شوند، نه از setReadingStatus مستقیم
  const cancels = (SRC.match(/cancelReading\(uid, /g) || []).length;
  ok(cancels >= 3, `هر سه نقطه‌ی لغو ریفاند می‌کنند (${cancels} مورد)`);
  ok(!/r\.status === 'pending_payment'\) stmts\.setReadingStatus\.run\('canceled'/.test(SRC),
    'هیچ مسیرِ لغوی دیگر مستقیم canceled نمی‌کند (وگرنه پولِ paid را می‌خورد)');

  // گاردِ هزینه: فالِ `paid` هنوز کارت ندارد، پس فراخوانیِ LLM رویش ممنوع است
  const guard = SRC.slice(SRC.indexOf('function paidForReading('), SRC.indexOf('async function callReadingLLM('));
  const paidFor = new Function(`${guard}; return paidForReading;`)();
  ok(paidFor({ price: 30_000, status: 'paid' }) === false, 'فالِ paid هنوز اجازه‌ی فراخوانیِ LLM ندارد (کارت ندارد)');
  ok(paidFor({ price: 30_000, status: 'started' }) === true, 'بعد از کشیدنِ کارت‌ها (started) مجاز می‌شود');

  // رول‌بکِ یک‌خطی
  ok(/const PAY_AT_SIZE = true;/.test(SRC) && /payAtSizeFor = \(uid\) => PAY_AT_SIZE && uxV2For\(uid\)/.test(SRC),
    'پرچمِ مستقلِ رول‌بک هست (جدا از UX_V2)');
  ok(/paidForSpread: \(size, price, balance, cur\)/.test(LOC), 'متنِ تأییدِ کسر در locale هست');
  ok(/refundedOnCancel: \(price, cur\)/.test(LOC), 'متنِ اعلامِ ریفاند در locale هست');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
