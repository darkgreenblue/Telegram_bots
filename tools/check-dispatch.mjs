#!/usr/bin/env node
/* گاردِ «تحویلِ per کاربر» (tarot v3.65.0).
 *
 * چیزی که این چک می‌سنجد، **رفتار** است نه شکلِ کد: خودِ telegraf را با یک ترنسپورتِ
 * قلابی می‌دواند و ترتیبِ واقعیِ اجرای هندلرها را می‌بیند. دلیلش درسِ ثبت‌شده‌ی بند ۶ب
 * ریشه است: چکی که فقط وجودِ چیزی را بسنجد، وقتی مسیرِ رسیدنش خراب شود سبز می‌ماند.
 *
 * چهار ادعای مرکزی:
 *   ۱) با پرچمِ روشن، هندلرِ کاربرِ B **قبل از تمام‌شدنِ** کارِ کند کاربر A شروع می‌شود.
 *   ۲) با پرچمِ روشن، دو آپدیتِ **همان** کاربر هرگز هم‌پوشانی ندارند — حتی در یک بسته.
 *   ۳) با پرچمِ خاموش، هر دو مورد بالا عکس می‌شوند (کنترلِ مثبت: چک واقعاً می‌تواند قرمز شود،
 *      و هم‌زمان ثابت می‌کند که رقابتِ درون-کاربری **امروز در پروداکشن وجود دارد**).
 *   ۴) سناریوی پولیِ واقعی روی SQLite: با جداسازیِ ساده رسیدِ تأییدشده می‌سوزد، با صفِ
 *      per کاربر نمی‌سوزد.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(ROOT, 'bots/tarot/package.json'));
const { Telegraf } = require_('telegraf');
const Database = require_('better-sqlite3');
const { installSerialDispatch, actorKey } = await import(
  'file://' + join(ROOT, 'bots/tarot/dispatch.js'));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { errs.push(m); console.log('  ❌ ' + m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ═══════════ ۱) رفتارِ واقعیِ حلقه‌ی telegraf ═══════════ */
// هر «بسته» یک نوبتِ getUpdates است. حلقه‌ی تلگراف بستهٔ بعدی را فقط وقتی می‌گیرد که
// Promise.all بستهٔ فعلی resolve شود — دقیقاً همان چیزی که این‌جا سنجیده می‌شود.
async function runLoop({ serial, batches, work }) {
  const bot = new Telegraf('1:fake');
  bot.botInfo = { id: 1, is_bot: true, username: 'fake', first_name: 'f' };
  let i = 0;
  bot.telegram.callApi = async (method) => {
    if (method !== 'getUpdates') return {};
    if (i < batches.length) return batches[i++];
    await sleep(5);
    return [];
  };
  const ev = [];   // رویدادهای شروع/پایانِ هر هندلر با مهرِ زمان
  bot.on('message', async (ctx) => {
    const tag = ctx.message.text;
    ev.push({ tag, kind: 'start', t: Date.now() });
    await work(tag);
    ev.push({ tag, kind: 'end', t: Date.now() });
  });
  if (serial) installSerialDispatch(bot, { maxInflight: 128 });
  const stop = bot.launch({ dropPendingUpdates: false });
  await sleep(500);
  bot.stop('test');
  await stop.catch(() => {});
  await sleep(30);
  return ev;
}
const at = (ev, tag, kind) => ev.find(e => e.tag === tag && e.kind === kind)?.t;

const upd = (id, uid, text) => ({
  update_id: id,
  message: { message_id: id, date: 1, text, chat: { id: uid, type: 'private' }, from: { id: uid, is_bot: false, first_name: 'u' } },
});
// A کُند است (شبیهِ انتظارِ مدل)، B سریع. دو **بستهٔ جدا** تا مرزِ بین بسته‌ها سنجیده شود.
const SLOW = 300, FAST = 5;
const workAB = (tag) => sleep(tag.startsWith('A') ? SLOW : FAST);

console.log('\n▶ ۱) کاربرِ دیگر پشتِ کارِ کندِ یک کاربر نمی‌ماند');
{
  const batches = [[upd(1, 111, 'A1')], [upd(2, 222, 'B1')]];
  const on  = await runLoop({ serial: true,  batches, work: workAB });
  const off = await runLoop({ serial: false, batches, work: workAB });
  ok(at(on, 'B1', 'start') !== undefined && at(on, 'A1', 'end') !== undefined,
    'روشن: هر دو هندلر اجرا شدند');
  ok(at(on, 'B1', 'start') < at(on, 'A1', 'end'),
    'روشن: B **قبل از پایانِ** A شروع شد (قفل برداشته شد)');
  ok(at(off, 'B1', 'start') >= at(off, 'A1', 'end'),
    '⭐ خاموش: B تا پایانِ A منتظر ماند (کنترلِ مثبت — همان باگی که داریم)');
  ok(at(off, 'B1', 'start') - at(off, 'A1', 'start') >= SLOW - 40,
    `خاموش: تأخیرِ B دستِ‌کم به اندازه‌ی کارِ A بود (~${SLOW}ms)`);
}

console.log('\n▶ ۲) دو آپدیتِ همان کاربر هرگز هم‌پوشانی ندارند');
{
  // هر دو در **یک بسته** — این همان حالتی است که امروز در پروداکشن هم‌زمان اجرا می‌شود.
  const batches = [[upd(1, 111, 'A1'), upd(2, 111, 'A2')]];
  const work = () => sleep(120);
  const on  = await runLoop({ serial: true,  batches, work });
  const off = await runLoop({ serial: false, batches, work });
  ok(at(on, 'A2', 'start') >= at(on, 'A1', 'end'),
    'روشن: A2 فقط بعد از پایانِ A1 شروع شد (صفِ per کاربر)');
  ok(at(off, 'A2', 'start') < at(off, 'A1', 'end'),
    '⭐ خاموش: A1 و A2 هم‌زمان دویدند (اثباتِ اینکه این رقابت **امروز** وجود دارد)');
}

console.log('\n▶ ۳) کلیدِ صف');
ok(actorKey({ message: { from: { id: 7 } } }) === 'u7', 'پیام → کلیدِ کاربر');
ok(actorKey({ callback_query: { from: { id: 9 } } }) === 'u9', 'کال‌بک → کلیدِ کاربر');
ok(actorKey({ poll_answer: { user: { id: 5 } } }) === 'u5', 'poll_answer فیلدِ user دارد نه from');
ok(actorKey({ my_chat_member: { from: { id: 3 } } }) === 'u3', 'my_chat_member → کلیدِ کاربر');
ok(actorKey({ channel_post: { chat: { id: -100 } } }) === 'c-100', 'بدونِ from → کلیدِ چت');
ok(actorKey({ weird_new_type: {} }) === 'g', 'نوعِ ناشناخته → صفِ محافظه‌کارانه‌ی مشترک');
ok(actorKey(null) === 'g' && actorKey(undefined) === 'g', 'ورودیِ خراب نمی‌ترکاند');
// دو کاربرِ مختلف هرگز یک کلید نمی‌گیرند، وگرنه بی‌دلیل منتظرِ هم می‌مانند
ok(actorKey({ message: { from: { id: 1 } } }) !== actorKey({ message: { from: { id: 2 } } }),
  'دو کاربر دو صفِ جدا');

console.log('\n▶ ۴) وبهوک هرگز جدا نمی‌شود (پاسخِ HTTP باید باز بماند)');
{
  const bot = new Telegraf('1:fake');
  bot.botInfo = { id: 1, is_bot: true, username: 'f', first_name: 'f' };
  let finished = false;
  bot.on('message', async () => { await sleep(60); finished = true; });
  installSerialDispatch(bot, {});
  const res = { writableEnded: true };
  await bot.handleUpdate(upd(1, 111, 'W'), res);
  ok(finished, 'با webhookResponse، handleUpdate تا پایانِ هندلر منتظر ماند');
}

console.log('\n▶ ۵) سقفِ هم‌زمانی: بالای سقف به رفتارِ امن برمی‌گردیم، آپدیت دور نمی‌ریزد');
{
  const bot = new Telegraf('1:fake');
  bot.botInfo = { id: 1, is_bot: true, username: 'f', first_name: 'f' };
  let seen = 0;
  bot.on('message', async () => { seen++; await sleep(80); });
  const stats = installSerialDispatch(bot, { maxInflight: 2 });
  const p = [];
  for (let k = 0; k < 5; k++) p.push(bot.handleUpdate(upd(k, 300 + k, 'x')));
  await Promise.all(p);
  await sleep(400);
  ok(seen === 5, 'هر ۵ آپدیت اجرا شدند (هیچ‌کدام دور ریخته نشد)');
  ok(stats.backpressure > 0, 'فشارِ برگشتی واقعاً فعال شد');
  ok(stats.peak <= 2, `بیشینه‌ی هم‌زمانی از سقف رد نشد (peak=${stats.peak})`);
  ok(stats.inflight === 0, 'بعد از تمام‌شدن، شمارنده صفر شد');
  ok(stats.queues === 0, '⭐ همه‌ی صف‌های خالی از Map پاک شدند (نشتیِ حافظه — سنجشِ رفتاری، نه متنی)');
}

/* ═══════════ ۶) سناریوی پولیِ واقعی ═══════════ */
// بازسازیِ دقیقِ سه چیزی که در index.js هست:
//   • saveReceiptFile   → وضعیت را عوض **نمی‌کند** (ردیف `pending` می‌ماند)
//   • pay_exit/pay_back → هر ردیفِ `pending` را `canceled` می‌کند
//   • approvePayment    → فقط ['pending','waiting_review'] را می‌پذیرد، وگرنه null
console.log('\n▶ ۶) رسیدِ واقعی نباید وسطِ بررسی بسوزد');
async function moneyRun({ serial }) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER,
             status TEXT, step TEXT);
           CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER DEFAULT 0);
           INSERT INTO payments VALUES (1, 111, 50000, 'pending', 'receipt');
           INSERT INTO users VALUES (111, 0);`);
  const getPayment  = db.prepare('SELECT * FROM payments WHERE id=?');
  const setStatus   = db.prepare('UPDATE payments SET status=? WHERE id=?');
  const saveFile    = db.prepare('UPDATE payments SET step=step WHERE id=?'); // بدونِ تغییرِ وضعیت
  const credit      = db.prepare('UPDATE users SET balance=balance+? WHERE telegram_id=?');

  const bot = new Telegraf('1:fake');
  bot.botInfo = { id: 1, is_bot: true, username: 'f', first_name: 'f' };
  bot.on('message', async (ctx) => {
    const t = ctx.message.text;
    if (t === 'receipt') {
      saveFile.run(1);
      await sleep(120);                       // دانلودِ عکس + ایجنت + تأخیرِ عمدی
      const p = getPayment.get(1);
      if (!['pending', 'waiting_review'].includes(p.status)) return;   // approvePayment
      setStatus.run('approved', 1);
      credit.run(p.amount, 111);
    } else if (t === 'cancel') {
      const p = getPayment.get(1);
      if (p.user_id === 111 && p.status === 'pending') setStatus.run('canceled', 1);
    }
  });
  if (serial) installSerialDispatch(bot, {});
  else {                                       // جداسازیِ **ساده** (بدونِ صف) — برای مقایسه
    const orig = bot.handleUpdate.bind(bot);
    bot.handleUpdate = (u, r) => { if (r) return orig(u, r); orig(u).catch(() => {}); return Promise.resolve(); };
  }
  await bot.handleUpdate(upd(1, 111, 'receipt'));
  await sleep(20);                             // کاربر وسطِ بررسی «انصراف» می‌زند
  await bot.handleUpdate(upd(2, 111, 'cancel'));
  await sleep(400);
  return { status: getPayment.get(1).status, balance: db.prepare('SELECT balance b FROM users WHERE telegram_id=111').get().b };
}
{
  const naive = await moneyRun({ serial: false });
  const safe  = await moneyRun({ serial: true });
  ok(naive.status === 'canceled' && naive.balance === 0,
    '⭐ جداسازیِ ساده: پرداخت لغو شد و کاربر صفر اعتبار گرفت (پول سوخت — کنترلِ مثبت)');
  ok(safe.status === 'approved',
    'صفِ per کاربر: پرداخت تأیید شد');
  ok(safe.balance === 50000,
    'صفِ per کاربر: اعتبارِ کامل به کاربر رسید');
}

/* ═══════════ ۷) ادعاهای ساختاری روی سورس ═══════════ */
console.log('\n▶ ۷) سیم‌کشی در index.js');
const SRC = readFileSync(join(ROOT, 'bots/tarot/index.js'), 'utf8');
const DSP = readFileSync(join(ROOT, 'bots/tarot/dispatch.js'), 'utf8');
ok(/const SERIAL_DISPATCH\s*=\s*true;/.test(SRC), 'پرچمِ SERIAL_DISPATCH روشن است');
ok(/if \(SERIAL_DISPATCH\) installSerialDispatch\(/.test(SRC), 'نصب پشتِ همان پرچم است (رول‌بکِ یک‌خطی)');
{
  // ⚠️ ترتیب مهم است: بعد از launch نصب شود، پولر با هندلرِ اصلی شروع کرده و پیچیدن بی‌اثر است.
  const iInstall = SRC.indexOf('installSerialDispatch(bot');
  const iLaunch  = SRC.search(/^launch\(\);$/m);
  ok(iInstall > 0 && iLaunch > 0 && iInstall < iLaunch, '⭐ نصب **قبل از** launch() است');
}
ok(SRC.split('installSerialDispatch(bot').length - 1 === 1, 'دقیقاً یک نقطه‌ی نصب');
ok(/return Promise\.resolve\(\);/.test(DSP), 'مسیرِ عادی فوراً برمی‌گردد (پولر آزاد)');
ok(/if \(webhookResponse\) return orig\(update, webhookResponse\);/.test(DSP), 'مسیرِ وبهوک delegate می‌شود');
{
  // بدنه‌ی wrapper نباید هیچ‌جا زنجیره را await کند، وگرنه دوباره پولر را می‌بندد.
  const body = DSP.slice(DSP.indexOf('function serialHandleUpdate'), DSP.indexOf('log(`🚦'));
  ok(!/\bawait\b/.test(body), '⭐ بدنه‌ی wrapper هیچ awaitی ندارد');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
