// جبرانِ یک‌باره‌ی یک کاربرِ آسیب‌دیده از باگِ کدِ تخفیف (تصمیم صریح مالک ۱۴۰۵/۰۵/۰۹).
//
// چرا وجود دارد: کاربرِ ۸۹۸۵۹۹۹۲۴۴ کدِ تخفیفی گرفت که به‌خاطر باگ اعمال نشد، متنش به‌عنوان
// «رسید» ثبت شد و ساعت‌ها بعد پیامِ «پرداخت شما تأیید نشد» گرفت، بدونِ اینکه یک ریال فرستاده
// باشد. باگ‌ها در PRهای #97/#98/#99 فیکس شدند؛ این اسکریپت فقط همان یک کاربر را جبران می‌کند.
//
//   node tools/goodwill-credit-tarot.mjs <dataDir>      (BOT_TOKEN از env)
//
// امن و یک‌باره:
//   • قبل از هر نوشتن، بکاپِ سازگارِ VACUUM INTO می‌گیرد.
//   • فایلِ marker کنارِ دیتابیس؛ اجرای دوم هیچ‌کاری نمی‌کند (هرگز دوبار اعتبار نمی‌دهد).
//   • ترتیب: بکاپ → تراکنشِ DB → marker → ارسالِ پیام. اگر ارسالِ پیام شکست بخورد، اسکریپت
//     با کدِ ۱ خارج می‌شود (جاب قرمز) ولی اعتبار سالم است و اجرای دوباره پول دوباره نمی‌دهد.
//   • هیچ ردیفی در `payments` ساخته نمی‌شود: این هدیه است نه درآمد، و نباید آمار مالی را آلوده کند.
import { existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

const UID = 8985999244;
const AMOUNT = 100_000;
const REASON = 'discount_bug';
const DB_FILE = 'bot-fa.db';

const TEXT = [
  '🔔 اطلاعیه',
  '',
  'یک خطای فنی در سیستم پرداخت باعث شده بود کد تخفیف اولین شارژ درست اعمال نشه و پیام «پرداخت تأیید نشد» به اشتباه ارسال بشه. این مشکل برطرف شد.',
  '',
  'به عنوان جبران، ۱۰۰٬۰۰۰ تومان اعتبار هدیه به کیف پول شما اضافه شد 🎁',
  '',
  '💰 موجودی فعلی: ۱۰۰٬۰۰۰ تومان',
  '',
  'با این اعتبار می‌تونید هر فالی رو، حتی کامل‌ترینشون، دریافت کنید 👇',
].join('\n');

// همان دکمه‌های زیرِ پیامِ «یه قرار کوچیک» + صلیب سلتی (برچسب‌ها عیناً از locales/fa.js)
const KEYBOARD = {
  inline_keyboard: [
    [{ text: '🎴 کارت امروزم رو ببینم (رایگان)', callback_data: 'daily_go' }],
    [{ text: '🔮 فال گذشته، حال، آینده (محبوب‌ترین)', callback_data: 'spread:three' }],
    [{ text: '✨ صلیب سلتی (کامل)', callback_data: 'spread:celtic' }],
    [{ text: '🗂 مشاهده‌ی همه‌ی فال‌ها', callback_data: 'onboard_allspreads' }],
  ],
};

const dataDir = process.argv[2];
if (!dataDir || !existsSync(dataDir)) {
  console.error(`❌ مسیر data نامعتبر: ${dataDir}`);
  process.exit(1);
}
const file = path.join(dataDir, DB_FILE);
if (!existsSync(file)) {
  console.error(`❌ ${DB_FILE} در ${dataDir} نیست`);
  process.exit(1);
}
const marker = path.join(dataDir, `.goodwill-${UID}-done`);
if (existsSync(marker)) {
  console.log(`ℹ️ جبرانِ کاربر ${UID} قبلاً انجام شده (marker موجود) — رد شد`);
  process.exit(0);
}
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN خالی است — بدون توکن پیام قابل ارسال نیست');
  process.exit(1);
}

const db = new Database(file);
db.pragma('busy_timeout = 5000');

const user = db.prepare('SELECT telegram_id, balance, state FROM users WHERE telegram_id=?').get(UID);
if (!user) {
  console.error(`❌ کاربر ${UID} در دیتابیس نیست — متوقف شد`);
  db.close();
  process.exit(1);
}

const bak = `${file}.pre-goodwill.bak`;
if (existsSync(bak)) rmSync(bak);
db.prepare('VACUUM INTO ?').run(bak);
console.log(`💾 بکاپ گرفته شد → ${path.basename(bak)}`);

// کدِ تخفیفِ اولین شارژِ همین کاربر (همان فرمولِ firstCodeFor در index.js)
const firstCode = 'T50' + Number(UID).toString(36).toUpperCase();

const apply = db.transaction(() => {
  db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id=?').run(AMOUNT, UID);
  // استیتِ گیرکرده (await_question) و سشنِ کهنه پاک می‌شود، وگرنه دکمه‌های همین پیام به
  // گاردِ «یه فالِ باز داری» می‌خورند به‌جای اینکه کار کنند.
  db.prepare("UPDATE users SET state='idle', session_json='{}' WHERE telegram_id=?").run(UID);
  // تخفیفِ اولین شارژش همین‌جا خرج شد: از این به بعد نه دکمه‌اش را می‌بیند نه کد را می‌پذیرد.
  const dc = db.prepare('SELECT id FROM discount_codes WHERE code=?').get(firstCode);
  if (dc) {
    db.prepare('INSERT INTO discount_uses (code_id, user_id, payment_id, discount_amount) VALUES (?,?,NULL,?)')
      .run(dc.id, UID, AMOUNT);
    db.prepare('UPDATE discount_codes SET total_uses = total_uses + 1 WHERE id=?').run(dc.id);
    console.log(`🎟️ کد ${firstCode} (id=${dc.id}) به‌عنوان مصرف‌شده ثبت شد`);
  } else {
    console.log(`ℹ️ کد ${firstCode} در discount_codes نبود — فقط اعتبار داده شد`);
  }
  db.prepare("INSERT INTO events (user_id, event, props) VALUES (?, 'gift_credited', ?)")
    .run(UID, JSON.stringify({ amount: AMOUNT, reason: REASON }));
});
apply();

const after = db.prepare('SELECT balance, state FROM users WHERE telegram_id=?').get(UID);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`✅ اعتبار: ${user.balance} → ${after.balance} | استیت: ${user.state} → ${after.state}`);

writeFileSync(marker, `${new Date().toISOString()} amount=${AMOUNT} reason=${REASON}\n`);
console.log(`🔒 marker نوشته شد → ${path.basename(marker)}`);

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: UID, text: TEXT, reply_markup: KEYBOARD }),
});
const body = await res.json().catch(() => ({}));
if (!body.ok) {
  console.error(`❌ ارسالِ پیام شکست خورد: ${JSON.stringify(body)}`);
  console.error('   اعتبار و marker سالم‌اند (اجرای دوباره پول دوباره نمی‌دهد) — پیام را دستی بفرست.');
  process.exit(1);
}
console.log(`📨 پیام برای ${UID} ارسال شد (message_id=${body.result?.message_id})`);
