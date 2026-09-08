#!/usr/bin/env node
/* گاردِ بازیابیِ فال‌های نیمه‌تمام (tarot v3.67.0).
 *
 * این‌جا پول و پیامِ برگشت‌ناپذیر در کار است، پس چک **رفتاری** است نه متنی: ابزار را
 * روی یک SQLite واقعی با `fetch` استابی می‌دواند و می‌بیند دقیقاً چه کسی چه چیزی گرفت.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(ROOT, 'bots/tarot/package.json'));
const Database = require_('better-sqlite3');
const T = await import('file://' + join(ROOT, 'tools/recover-stuck-readings.mjs'));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { errs.push(m); console.log('  ❌ ' + m); } };

/* ═══════ ۱) قاعده‌ی انتخاب ═══════ */
console.log('\n▶ ۱) چه کسی پیام می‌گیرد');
{
  const rows = [
    { id: 10, user_id: 111, price: 5, status: 'paid',    later: 0 },  // آخرین فالش → بله
    { id: 11, user_id: 222, price: 3, status: 'started', later: 1 },  // بعدش فالِ تحویل‌شده → نه
    { id: 14, user_id: 444, price: 3, status: 'paid',    later: 0 },  // دو فالِ گیرکرده…
    { id: 15, user_id: 444, price: 5, status: 'started', later: 0 },  // …فقط تازه‌ترینش
    { id: 12, user_id: 333, price: 3, status: 'started', later: 0 },  // آخرین فالش → بله
    { id: 13, user_id: T.TICKET_UID, price: 5, status: 'paid', later: 2 }, // استثنا → بله
  ];
  const plan = T.planFrom(rows);
  const ids = plan.map(p => p.readingId);
  ok(ids.includes(10) && ids.includes(12), 'فالِ گیرکرده‌ای که آخرین فالِ کاربر بوده انتخاب می‌شود');
  ok(!ids.includes(11), '⭐ کسی که بعدش فال دیگری گرفته رد می‌شود');
  ok(ids.includes(13), '⭐ کاربرِ تیکت با اینکه بعدش فال گرفته، استثناست');
  ok(plan.find(p => p.readingId === 13).refund === 5, 'ریفاند فقط برای کاربرِ تیکت و به اندازه‌ی قیمتِ همان فال');
  ok(plan.filter(p => p.refund > 0).length === 1, '⭐ هیچ‌کس جز کاربرِ تیکت ریفاند نمی‌گیرد');
  ok(plan.find(p => p.readingId === 13).lastOne === false, 'کاربرِ تیکت متنِ «یکی از فال‌ها» می‌گیرد');
  ok(plan.find(p => p.readingId === 10).lastOne === true, 'بقیه متنِ «فال آخری» می‌گیرند');
  ok(!ids.includes(14) && ids.includes(15),
    '⭐ کاربری با دو فالِ گیرکرده فقط یک پیام می‌گیرد، برای تازه‌ترینش');
  ok(new Set(plan.map(p => p.userId)).size === plan.length, '⭐ هیچ کاربری دو پیام نمی‌گیرد');
}

/* ═══════ ۲) متن ═══════ */
console.log('\n▶ ۲) متنِ پیام');
{
  const a = T.messageFor({ lastOne: true, refunded: 0 });
  const b = T.messageFor({ lastOne: false, refunded: 5 });
  ok(a.includes('فال آخری که داشتی می‌گرفتی'), 'نسخه‌ی الف: «فال آخری که داشتی می‌گرفتی»');
  ok(b.includes('یکی از فال‌هایی که داشتی می‌گرفتی'), 'نسخه‌ی ب: «یکی از فال‌هایی که داشتی می‌گرفتی»');
  ok(!a.includes('یکی از فال‌هایی'), 'نسخه‌ی الف آن عبارت را ندارد');
  ok(a.includes('هیچ الماسی ازت دوباره کم نمی‌شه'), 'هر دو: تضمینِ کسر نشدنِ دوباره');
  ok(b.includes('به ذخایرت برگشت'), 'نسخه‌ی ب خطِ ریفاند دارد');
  ok(!a.includes('برگشت'), '⭐ نسخه‌ی الف خطِ ریفاند **ندارد** (وگرنه به ۳۸ نفر وعده‌ی نادرست می‌دهد)');
  ok(a.includes(T.CTA_LABEL) && b.includes(T.CTA_LABEL), 'نامِ دکمه داخلِ متن هم آمده');
  ok(!/\d/.test(a) && !/\d/.test(b), '⭐ هیچ رقمِ لاتینی در متن نیست (کلِ ربات فارسی است)');
  ok(!a.includes('—') && !a.includes('--'), 'بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)');
}

/* ═══════ ۳) اجرای واقعی روی SQLite ═══════ */
console.log('\n▶ ۳) اجرای واقعی: چه کسی چه چیزی گرفت');
const tmp = mkdtempSync(join(tmpdir(), 'recov-'));
function freshDb() {
  const f = join(tmp, 'bot-fa.db');
  try { rmSync(f); } catch {}
  const db = new Database(f);
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER DEFAULT 0);
           CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, price INTEGER,
             status TEXT, llm_json TEXT DEFAULT '', cards_json TEXT DEFAULT '');`);
  const u = db.prepare('INSERT INTO users VALUES (?,?)');
  const r = db.prepare('INSERT INTO readings VALUES (?,?,?,?,?,?)');
  for (const id of [111, 222, 333, T.TICKET_UID]) u.run(id, 0);
  const J = '{"x":1}', C = '["a","b","c"]';
  r.run(10, 111, 5, 'paid', J, C);                 // آخرین فالش → پیام
  r.run(11, 222, 3, 'started', J, C);              // بعدش فال دارد → رد
  r.run(12, 222, 3, 'delivered', J, C);            //   ← همان فالِ بعدی
  r.run(13, 333, 3, 'started', J, C);              // آخرین فالش → پیام
  r.run(14, T.TICKET_UID, 5, 'paid', J, C);        // استثنا → پیام + ریفاند
  r.run(15, T.TICKET_UID, 10, 'delivered', J, C);  //   ← فالِ بعدیِ کاربرِ تیکت
  r.run(16, 111, 3, 'paid', '', C);                // بدونِ خوانش → اصلاً انتخاب نمی‌شود
  db.close();
  return f;
}
const calls = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  calls.push(body);
  return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
};
try {
  const f = freshDb();
  const sent1 = await T.run(f, { token: 'x', only: [], sendReal: true });
  const db = new Database(f);
  const bal = (id) => db.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(id).b;

  ok(sent1 === 3, `⭐ دقیقاً ۳ پیام رفت (شد ${sent1}) — فالِ خرابِ بعدی نباید کسی را حذف کند`);
  const to = calls.map(c => c.chat_id).sort();
  ok(JSON.stringify(to) === JSON.stringify([111, 333, T.TICKET_UID].sort()), 'به همان سه نفرِ درست');
  ok(!to.includes(222), '⭐ کسی که بعدش فال گرفته پیام نگرفت');
  ok(bal(T.TICKET_UID) === 5, '⭐ کاربرِ تیکت دقیقاً ۵ الماس گرفت');
  ok(bal(111) === 0 && bal(333) === 0, '⭐ بقیه هیچ الماسی نگرفتند');
  const cb = calls.map(c => c.reply_markup.inline_keyboard[0][0]);
  ok(cb.every(b => b.text === T.CTA_LABEL), 'برچسبِ دکمه در همه‌ی پیام‌ها درست است');
  ok(cb.every(b => /^rview:\d+$/.test(b.callback_data)), '⭐ دکمه به `rview:<id>` وصل است');
  ok(cb.find(b => b.callback_data === 'rview:14'), 'شناسه‌ی فالِ هر کاربر روی دکمه‌ی خودش است');
  ok(!calls.some(c => c.chat_id === 111 && c.text.includes('برگشت')), 'به کسی که ریفاند ندارد وعده‌ی ریفاند داده نشد');
  db.close();

  // اجرای دوباره: نه پیامِ تکراری، نه الماسِ تکراری
  calls.length = 0;
  const sent2 = await T.run(f, { token: 'x', only: [], sendReal: true });
  const db2 = new Database(f);
  ok(sent2 === 0 && calls.length === 0, '⭐ اجرای دوباره هیچ‌کس را دوبار پیام نداد');
  ok(db2.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(T.TICKET_UID).b === 5,
    '⭐ اجرای دوباره الماس را دوبار نداد');
  db2.close();

  // حالتِ آزمایشی: هیچ اثری
  const f2 = freshDb();
  calls.length = 0;
  const sent3 = await T.run(f2, { token: 'x', only: [], sendReal: false });
  const db3 = new Database(f2);
  ok(sent3 === 0 && calls.length === 0, '⭐ حالتِ آزمایشی هیچ پیامی نمی‌فرستد');
  ok(db3.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(T.TICKET_UID).b === 0,
    '⭐ حالتِ آزمایشی هیچ الماسی جابه‌جا نمی‌کند');
  db3.close();

  // ⭐ ترتیبِ مقدس: اگر ارسال شکست بخورد، پول باید برگشته باشد
  const f3 = freshDb();
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error_code: 403, description: 'blocked' }) });
  await T.run(f3, { token: 'x', only: [], sendReal: true });
  const db4 = new Database(f3);
  ok(db4.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(T.TICKET_UID).b === 5,
    '⭐ کاربری که ربات را بلاک کرده هم الماسش برگشت (اول پول، بعد پیام)');
  db4.close();
} finally {
  globalThis.fetch = origFetch;
  rmSync(tmp, { recursive: true, force: true });
}

/* ═══════ ۴) ادعاهای ساختاری روی خودِ ربات ═══════ */
console.log('\n▶ ۴) هندلرِ دکمه در index.js');
const SRC = readFileSync(join(ROOT, 'bots/tarot/index.js'), 'utf8');
ok(/bot\.action\(\/\^rview:\(\\d\+\)\$\//.test(SRC), 'هندلرِ `rview:` ثبت شده');
{
  const claim = (SRC.match(/claimReadingForReview: db\.prepare\("([^"]+)"\)/) || [])[1] || '';
  ok(/status='started'/.test(claim), 'ادعا وضعیت را به started می‌برد');
  ok(/status IN \('paid','started'\)/.test(claim), '⭐ فقط فالِ نیمه‌تمام را می‌گیرد');
  ok(!/delivered|refunded/.test(claim), '⭐ فالِ تحویل‌شده یا ریفاندشده هرگز دوباره پخش نمی‌شود');
}
{
  const h = SRC.slice(SRC.indexOf('bot.action(/^rview:'), SRC.indexOf('bot.action(/^rview:') + 1400);
  const body = h.slice(0, h.indexOf('\n});'));
  ok(/\.changes === 0/.test(body), '⭐ نتیجه‌ی ادعا چک می‌شود (ضدِ دوبار-تپ)');
  ok(!/stmts\.deduct/.test(body), '⭐⭐ هیچ کسرِ اعتباری در این مسیر نیست (پول قبلاً گرفته شده)');
  ok(!/stmts\.credit/.test(body), 'و هیچ اعتباری هم این‌جا داده نمی‌شود');
  ok(/r\.user_id !== uid/.test(body), 'مالکیتِ رکورد چک می‌شود');
  ok(/!r\.cards_json \|\| !r\.llm_json/.test(body), 'گاردِ عمقی: بدونِ کارت یا خوانش اجرا نمی‌شود');
  ok(/startReveal\(ctx, uid, readingId\)/.test(body), 'تحویل از همان مسیرِ همیشگیِ افشا می‌رود');
}
/* ⚠️ عددِ دقیق پین **نمی‌شود**، فقط کف.
   نسخه‌ی اولِ این ادعا `3.67.x` را عیناً می‌خواست و با اولین بامپِ بعدی (v3.69.0) قرمز
   شد — یعنی چکی که قرار بود رعایتِ بند ۲ج/۴ را تضمین کند، خودش جلوی همان قاعده را
   می‌گرفت. `check-tarot-video.mjs` همین درس را از قبل ثبت کرده بود و کف می‌گذاشت؛
   این‌جا جا افتاده بود. مقایسه هم عددی است نه رشته‌ای، وگرنه '3.100.0' از '3.67.0'
   کوچک‌تر خوانده می‌شد. */
{
  const v = (SRC.match(/const\s+PRODUCT_VERSION\s*=\s*['"`]([\d.]+)['"`]/) || [])[1] || '0';
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  ok(cmp(v, '3.67.0') >= 0, `PRODUCT_VERSION دستِ‌کم روی 3.67.0 بامپ شده (فعلی: ${v} — بند ۲ج/۴)`);
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
