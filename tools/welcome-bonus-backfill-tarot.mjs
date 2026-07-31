// هدیه‌ی خوش‌آمدِ ۳۰٬۰۰۰ تومانی برای کاربرانِ فعلی (تصمیم صریح مالک ۱۴۰۵/۰۵/۰۹).
//
// دامنه (انتخابِ مالک): فقط کسانی که **هنوز هیچ فالی تحویل نگرفته‌اند** — یعنی همان‌هایی که
// وارد شدند، پی‌وال را دیدند و ریختند. کسی که قبلاً فال گرفته (و پول داده) چیزی نمی‌گیرد.
//
//   node tools/welcome-bonus-backfill-tarot.mjs <dataDir>      (BOT_TOKEN از env)
//
// امن و یک‌باره: بکاپِ VACUUM INTO → تراکنش per کاربر با گاردِ write-once روی
// users.welcome_bonus_at (همان ستونی که خودِ ربات استفاده می‌کند، پس هرگز دوبار نمی‌دهد)
// → پیامِ اطلاعیه. فایلِ marker جلوی اجرای دوباره در دیپلوی‌های بعدی را می‌گیرد.
// هیچ ردیفی در `payments` ساخته نمی‌شود (هدیه است نه درآمد).
import { existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

const AMOUNT = 30_000;
const DB_FILE = 'bot-fa.db';
const MARKER = '.welcome-backfill-done';

const TEXT = [
  '🎁 اعتبار هدیه',
  '',
  'به همه‌ی کاربران، ۳۰٬۰۰۰ تومان اعتبار هدیه‌ی خوشامدگویی تعلق گرفت و به حساب شما اضافه شد.',
  '',
  'این مبلغ دقیقاً هزینه‌ی یک فال کامل «گذشته، حال، آینده» است، پس می‌تونید همین حالا بدون پرداخت امتحانش کنید 👇',
].join('\n');

const KEYBOARD = {
  inline_keyboard: [
    [{ text: '🔮 فال گذشته، حال، آینده (محبوب‌ترین)', callback_data: 'spread:three' }],
    [{ text: '🎴 کارت روز (رایگان)', callback_data: 'daily_go' }],
    [{ text: '🗂 مشاهده‌ی همه‌ی فال‌ها', callback_data: 'onboard_allspreads' }],
  ],
};

const dataDir = process.argv[2];
if (!dataDir || !existsSync(dataDir)) { console.error(`❌ مسیر data نامعتبر: ${dataDir}`); process.exit(1); }
const file = path.join(dataDir, DB_FILE);
if (!existsSync(file)) { console.error(`❌ ${DB_FILE} در ${dataDir} نیست`); process.exit(1); }
const marker = path.join(dataDir, MARKER);
if (existsSync(marker)) { console.log('ℹ️ backfill قبلاً انجام شده (marker موجود) — رد شد'); process.exit(0); }
const token = process.env.BOT_TOKEN;
if (!token) { console.error('❌ BOT_TOKEN خالی است'); process.exit(1); }

const db = new Database(file);
db.pragma('busy_timeout = 5000');

const bak = `${file}.pre-welcome-backfill.bak`;
if (existsSync(bak)) rmSync(bak);
db.prepare('VACUUM INTO ?').run(bak);
console.log(`💾 بکاپ گرفته شد → ${path.basename(bak)}`);

// کاربرانِ واجد شرط: آنبورد شده، هنوز هدیه نگرفته، و هیچ فالِ delivered ندارند
const targets = db.prepare(`
  SELECT telegram_id FROM users
   WHERE welcomed = 1
     AND welcome_bonus_at IS NULL
     AND telegram_id NOT IN (SELECT user_id FROM readings WHERE status='delivered')
   ORDER BY telegram_id`).all();
console.log(`👥 واجد شرط: ${targets.length} کاربر`);

const claim = db.prepare('UPDATE users SET welcome_bonus_at=unixepoch() WHERE telegram_id=? AND welcome_bonus_at IS NULL');
const credit = db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id=?');
const event = db.prepare("INSERT INTO events (user_id, event, props) VALUES (?, 'welcome_bonus', ?)");
const grant = db.transaction((uid) => {
  if (!claim.run(uid).changes) return false;   // گاردِ write-once
  credit.run(AMOUNT, uid);
  event.run(uid, JSON.stringify({ amount: AMOUNT, backfill: 1 }));
  return true;
});

const granted = [];
for (const { telegram_id } of targets) {
  try { if (grant(telegram_id)) granted.push(telegram_id); }
  catch (e) { console.error(`❌ ${telegram_id}: ${e.message}`); }
}
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`✅ اعتبار داده شد به ${granted.length} کاربر (مجموع ${granted.length * AMOUNT} تومان)`);

writeFileSync(marker, `${new Date().toISOString()} granted=${granted.length} amount=${AMOUNT}\n`);
console.log(`🔒 marker نوشته شد → ${MARKER}`);

let sent = 0, failed = 0;
for (const uid of granted) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: uid, text: TEXT, reply_markup: KEYBOARD }),
  }).then(r => r.json()).catch(() => ({}));
  if (res.ok) sent++; else { failed++; console.error(`⚠️ پیام به ${uid} نرفت: ${JSON.stringify(res).slice(0, 160)}`); }
  await new Promise(r => setTimeout(r, 350));   // احترام به rate limit تلگرام
}
console.log(`📨 پیام: ${sent} موفق، ${failed} ناموفق (اعتبار همه‌شان داده شده)`);
