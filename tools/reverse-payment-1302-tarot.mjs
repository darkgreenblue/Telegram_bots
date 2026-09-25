// اصلاحِ یک‌باره‌ی پرداختِ #۱۳۰۲ (شناسه‌ی داخلی id=3491) که مالک اشتباهاً approve کرده بود.
//
// چرا وجود دارد: مالک صریح گزارش داد این رسید را اشتباهی تأیید کرده و خواست دقیقاً همان
// فرآیندِ «برگشتِ رسیدِ فیک» (شبکه‌ی ایمنیِ `reversePayment` در index.js) روی این یک ردیف
// اجرا شود: الماسِ باقی‌مانده از این اعتبار کسر شود (کفِ صفر) و کاربر `pay_distrust` بخورد.
// چون این یک اقدامِ ادمینیِ بیرون از فلوی زنده‌ی ربات است (نه یک باگ)، مستقیم از راهِ
// دیپلوی روی سرور اجرا می‌شود؛ منطقش عیناً از `reversePayment` کپی شده، نه بازنویسی.
//
//   node tools/reverse-payment-1302-tarot.mjs <dataDir>      (BOT_TOKEN از env)
//
// امن و یک‌باره:
//   • قبل از هر نوشتن، بکاپِ سازگارِ VACUUM INTO می‌گیرد.
//   • فایلِ marker کنارِ دیتابیس؛ اجرای دوم هیچ‌کاری نمی‌کند (هرگز دوبار کسر نمی‌کند).
//   • ترتیب: بکاپ → تراکنشِ DB → marker → ارسالِ پیام. اگر ارسالِ پیام شکست بخورد، اسکریپت
//     با کدِ ۱ خارج می‌شود (جاب قرمز) ولی اصلاحِ دیتا سالم است (اجرای دوباره چیزی را عوض نمی‌کند).
import { existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

const PAYMENT_ID = 3491; // invoice_no=1302 فقط برچسبِ نمایشی است؛ id ستونِ واقعیِ ردیف است
const UID = 6359103092;
const DB_FILE = 'bot-fa.db';
const SUPPORT_CONTACT = '@Efficient_Support';

const TEXT =
  'پرداختِ قبلی‌ات لغو شد و اعتبارِ ناشی از اون از ذخایر الماست برداشته شد. 🌙\n' +
  `اگه فکر می‌کنی اشتباهی شده، با پشتیبانی در ارتباط باش: ${SUPPORT_CONTACT}`;

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
const marker = path.join(dataDir, `.reverse-payment-${PAYMENT_ID}-done`);
if (existsSync(marker)) {
  console.log(`ℹ️ برگشتِ پرداختِ ${PAYMENT_ID} قبلاً انجام شده (marker موجود) — رد شد`);
  process.exit(0);
}
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN خالی است — بدون توکن پیام قابل ارسال نیست');
  process.exit(1);
}

const db = new Database(file);
db.pragma('busy_timeout = 5000');

const p = db.prepare('SELECT * FROM payments WHERE id=?').get(PAYMENT_ID);
if (!p) {
  console.error(`❌ پرداختِ ${PAYMENT_ID} در دیتابیس نیست — متوقف شد`);
  db.close();
  process.exit(1);
}
if (p.user_id !== UID) {
  console.error(`❌ کاربرِ ردیف (${p.user_id}) با UID موردانتظار (${UID}) یکی نیست — متوقف شد`);
  db.close();
  process.exit(1);
}
if (p.status !== 'approved') {
  console.log(`ℹ️ پرداختِ ${PAYMENT_ID} در وضعیتِ approved نیست (وضعیتِ فعلی: ${p.status}) — رد شد`);
  db.close();
  process.exit(0);
}

const userBefore = db.prepare('SELECT balance, pay_distrust FROM users WHERE telegram_id=?').get(UID);
if (!userBefore) {
  console.error(`❌ کاربر ${UID} در دیتابیس نیست — متوقف شد`);
  db.close();
  process.exit(1);
}

const bak = `${file}.pre-reverse-${PAYMENT_ID}.bak`;
if (existsSync(bak)) rmSync(bak);
db.prepare('VACUUM INTO ?').run(bak);
console.log(`💾 بکاپ گرفته شد → ${path.basename(bak)}`);

const markPaymentReversed = db.prepare(
  "UPDATE payments SET status='reversed', updated_at=unixepoch() WHERE id=? AND status='approved'"
);
const clawback = db.prepare('UPDATE users SET balance = MAX(0, balance - ?) WHERE telegram_id=?');
const setDistrust = db.prepare('UPDATE users SET pay_distrust=1 WHERE telegram_id=?');
const insertEvent = db.prepare(
  "INSERT INTO events (user_id, event, props) VALUES (?, 'payment_reversed', ?)"
);

const creditAmount = p.original_amount || p.amount; // = 5 (بسته‌ی basic، پنج الماس)
// p.pkg='basic' یعنی این بسته است، پس bonusFor صدا زده نمی‌شود (دقیقاً منطقِ reversePayment)
const back = creditAmount;

const apply = db.transaction(() => {
  const res = markPaymentReversed.run(PAYMENT_ID);
  if (res.changes === 0) throw new Error('گذارِ approved→reversed شکست خورد (مسابقه یا تغییرِ وضعیت)');
  clawback.run(back, UID);
  setDistrust.run(UID);
  insertEvent.run(UID, JSON.stringify({ payment_id: PAYMENT_ID, amount: p.amount, clawed: back }));
});
apply();

const after = db.prepare('SELECT balance, pay_distrust FROM users WHERE telegram_id=?').get(UID);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(
  `✅ پرداخت #${p.invoice_no || p.id} (id=${PAYMENT_ID}) برگشت خورد | اعتبارِ کسرشده: ${back} الماس | ` +
  `موجودی: ${userBefore.balance} → ${after.balance} | pay_distrust: ${userBefore.pay_distrust} → ${after.pay_distrust}`
);

writeFileSync(marker, `${new Date().toISOString()} payment_id=${PAYMENT_ID} uid=${UID} clawed=${back}\n`);
console.log(`🔒 marker نوشته شد → ${path.basename(marker)}`);

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: UID, text: TEXT }),
});
const body = await res.json().catch(() => ({}));
if (!body.ok) {
  console.error(`❌ ارسالِ پیام شکست خورد: ${JSON.stringify(body)}`);
  console.error('   اصلاحِ دیتا و marker سالم‌اند (اجرای دوباره چیزی را عوض نمی‌کند) — پیام را دستی بفرست.');
  process.exit(1);
}
console.log(`📨 پیام برای ${UID} ارسال شد (message_id=${body.result?.message_id})`);
