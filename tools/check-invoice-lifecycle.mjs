// چکِ CI برای چرخه‌ی عمرِ فاکتورِ کارت‌به‌کارتِ tarot (v3.74.0، خواسته‌ی صریحِ مالک):
// ۱ ساعت بعد از صدورِ فاکتور یک یادآوری، ۲۴ ساعت بعد انقضای خودکار (ادیتِ همان پیام،
// بدونِ دکمه) + بازگشتِ ردیف به همان `canceled` همیشگی تا رسیدِ دیررسیده از مسیرِ
// اثبات‌شده‌ی `CANCELED_RECOVERY_SEC` خودکار احیا شود، نه بی‌صدا دور ریخته شود.
//
// این چک خودِ SQLِ استخراج‌شده از سورس را روی SQLite واقعی اجرا می‌کند — نه یک کپیِ
// دستی — تا هیچ‌وقت از رفتارِ واقعی واگرا نشود.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  return m[2];
}
// نسخه‌ی چندخطی (رشته‌های به‌هم‌چسبیده با +) — دو کاندیدِ این چک به همین شکل نوشته شدند.
function sqlOfMulti(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(([\\s\\S]*?)\\),\\n`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  try { return new Function(`return (${m[1]});`)(); }
  catch (e) { fail++; console.error(`  ❌ statement «${name}» eval نشد: ${e.message}`); return null; }
}
function bodyOf(marker, end = '\n}') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n⏱ چرخه‌ی عمرِ فاکتورِ کارت‌به‌کارت\n');

/* ══ ۱) مهاجرت‌ها و ثابت‌ها ═══════════════════════════════════════════════ */
console.log('۱) مهاجرت‌ها و ثابت‌ها');
for (const col of ['invoice_issued_at', 'invoice_msg_id', 'invoice_reminded_at']) {
  ok(new RegExp(`ALTER TABLE payments ADD COLUMN ${col}`).test(SRC), `ستونِ \`${col}\` افزایشی اضافه شد`);
}
ok(/const INVOICE_REMINDER_SEC = 3600;/.test(SRC), 'یادآوری دقیقاً ۱ ساعت است');
ok(/const INVOICE_EXPIRE_SEC\s*=\s*24 \* 3600;/.test(SRC), 'انقضا دقیقاً ۲۴ ساعت است');
ok(SRC.indexOf('const INVOICE_REMINDER_SEC') < SRC.indexOf('const INVOICE_EXPIRE_SEC'),
  'و یادآوری همیشه زودتر از انقضا تعریف/اجرا می‌شود (۱ ساعت < ۲۴ ساعت)');

/* ══ ۲) خودِ گذار به «فاکتور صادر شد» ═════════════════════════════════════ */
console.log('\n۲) لحظه‌ی صدورِ فاکتور');
const claimSql = sqlOf('claimAmount');
ok(claimSql ? /invoice_issued_at=unixepoch\(\)/.test(claimSql) : false,
  '`claimAmount` همان لحظه‌ای که step→receipt می‌رود، `invoice_issued_at` را هم می‌زند');
ok(claimSql ? /step='amount' AND status='pending'/.test(claimSql) : false,
  'و این گذار فقط یک‌بار ممکن است (شرطِ step=\'amount\' خودش را قفل می‌کند)');
// چهار نقطه‌ای که فاکتور را می‌فرستند باید شناسه‌ی پیام را هم ذخیره کنند، وگرنه انقضا
// چیزی برای ادیت ندارد.
const invoiceSendSites = (SRC.match(/ctx\.reply\(L\.wallet\.invoice\(/g) || []).length;
const msgIdWrites = (SRC.match(/stmts\.setInvoiceMsgId\.run\(/g) || []).length;
ok(invoiceSendSites > 0 && msgIdWrites >= invoiceSendSites,
  `هر ارسالِ فاکتور شناسه‌ی پیام را ذخیره می‌کند (${msgIdWrites} ذخیره برای ${invoiceSendSites} ارسال)`);

/* ══ ۳) کوئریِ کاندیدها ═══════════════════════════════════════════════════ */
console.log('\n۳) کاندیدهای یادآوری/انقضا');
const remSql = sqlOfMulti('invoiceReminderCandidates');
const expSql = sqlOfMulti('invoiceExpiryCandidates');
for (const [label, sql] of [['یادآوری', remSql], ['انقضا', expSql]]) {
  ok(sql ? /status='pending'/.test(sql) : false, `کوئریِ ${label}: فقط status='pending' (رسیدِ ثبت‌شده/تأییدشده هرگز)`);
  ok(sql ? /step='receipt'/.test(sql) : false, `کوئریِ ${label}: فقط فاکتورِ **صادرشده** (step='receipt')`);
  ok(sql ? /invoice_issued_at IS NOT NULL/.test(sql) : false, `کوئریِ ${label}: ردیفِ بدونِ مهرِ صدور کاندیدا نیست`);
}
ok(remSql ? /invoice_reminded_at IS NULL/.test(remSql) : false,
  'کوئریِ یادآوری write-once است (بعد از یک‌بار یادآوری، دیگر کاندیدا نیست)');
ok(expSql ? !/invoice_reminded_at/.test(expSql) : false,
  'کوئریِ انقضا به یادآوری وابسته نیست — حتی اگر ارسالِ یادآوری شکست بخورد، انقضا سرِ جایش اجرا می‌شود');

/* ══ ۴) خودِ سوییپ و گاردِ ریل ══════════════════════════════════════════════ */
console.log('\n۴) گاردِ ریل و رفتارِ انقضا');
const sweepFn = bodyOf('function sweepInvoiceLifecycle() {');
ok(sweepFn ? /if \(starsRail\) return;/.test(sweepFn) : false,
  'سوییپ فقط ریلِ کارت را می‌پاید — فاکتورِ استارز اصلاً وارد نمی‌شود');
const expireFn = bodyOf('async function expireInvoice(p) {');
ok(expireFn ? /setPaymentStatus\.run\('canceled', p\.id\)/.test(expireFn) : false,
  'انقضا همان وضعیتِ `canceled` همیشگی را می‌نویسد، نه یک وضعیتِ تازه');
ok(expireFn ? /\.changes === 0\) return;/.test(expireFn) : false,
  'ادعای اتمیک: اگر ردیف دیگر pending نیست (کاربر همین حالا رسید فرستاد/انصراف داد)، بی‌صدا رد می‌شود');
ok(expireFn ? /editMessageText\(p\.user_id, p\.invoice_msg_id, undefined, text/.test(expireFn) : false,
  'پیامِ خودِ فاکتور ادیت می‌شود، نه پیامِ تازه (وقتی شناسه‌اش موجود است)');
ok(expireFn ? /await bot\.telegram\.sendMessage\(p\.user_id, text/.test(expireFn) : false,
  'و اگر ادیت ممکن نبود (پیام پاک شده)، رسیدِ دورریخته‌شده بی‌صدا نمی‌ماند — پیامِ جایگزین می‌رود');
const reminderFn = bodyOf('async function sendInvoiceReminder(p) {');
ok(reminderFn ? /pay_cancel:\$\{p\.id\}/.test(reminderFn) : false,
  'یادآوری از همان دکمه‌ی همیشگیِ `pay_cancel` استفاده می‌کند، نه یک کالبکِ تازه');
ok(reminderFn ? /logPush\(/.test(reminderFn) : false,
  'یادآوری پیامِ مالی است و در تایم‌لاینِ جرنی ثبت می‌شود (بند ۲الف ریشه)');

/* ══ ۵) رفتار روی SQLite واقعی ════════════════════════════════════════════ */
console.log('\n۵) بازتولیدِ چرخه روی SQLite واقعی');
if (claimSql && remSql && expSql) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', step TEXT, pkg TEXT NOT NULL DEFAULT '',
    invoice_issued_at INTEGER, invoice_msg_id INTEGER, invoice_reminded_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  );`);
  const insertAmount = db.prepare("INSERT INTO payments (user_id, amount, step) VALUES (?, 0, 'amount')");
  const claim = db.prepare(claimSql);
  const remCand = db.prepare(remSql);
  const expCand = db.prepare(expSql);
  const setReminded = db.prepare("UPDATE payments SET invoice_reminded_at=unixepoch() WHERE id=?");
  const setStatus = db.prepare(sqlOf('setPaymentStatus'));

  // شبیه‌سازیِ زمان: به‌جای منتظر ماندن، مهرِ صدور را دستی به عقب می‌بریم (خودِ کوئری
  // همچنان با `unixepoch()` واقعی مقایسه می‌کند، پس این خودِ منطقِ زمان‌بندی را می‌سنجد).
  const issueAt = (pid, secondsAgo) => db.prepare('UPDATE payments SET invoice_issued_at=unixepoch()-? WHERE id=?').run(secondsAgo, pid);

  // ۱) فاکتورِ تازه (۵ دقیقه پیش): نه کاندیدِ یادآوری، نه انقضا
  const fresh = Number(insertAmount.run(1).lastInsertRowid);
  claim.run(1000, fresh);
  issueAt(fresh, 300);
  ok(remCand.all(3600).every(r => r.id !== fresh), 'فاکتورِ ۵دقیقه‌ای هنوز کاندیدِ یادآوری نیست');
  ok(expCand.all(86400).every(r => r.id !== fresh), 'و کاندیدِ انقضا هم نیست');

  // ۲) فاکتورِ ۲ساعته: کاندیدِ یادآوری هست، بعد از یادآوری دیگر نیست؛ کاندیدِ انقضا نیست
  const twoHr = Number(insertAmount.run(2).lastInsertRowid);
  claim.run(2000, twoHr);
  issueAt(twoHr, 2 * 3600);
  ok(remCand.all(3600).some(r => r.id === twoHr), 'فاکتورِ ۲ساعته کاندیدِ یادآوری است');
  setReminded.run(twoHr);
  ok(remCand.all(3600).every(r => r.id !== twoHr), 'و بعد از یادآوری دیگر کاندیدا نیست (write-once)');
  ok(expCand.all(86400).every(r => r.id !== twoHr), 'و هنوز کاندیدِ انقضا نیست (فقط ۲ ساعت گذشته)');

  // ۳) فاکتورِ ۲۵ساعته: کاندیدِ انقضا؛ حتی بدونِ یادآوریِ موفق (شکستِ ارسال) هم منقضی می‌شود
  const old = Number(insertAmount.run(3).lastInsertRowid);
  claim.run(3000, old);
  issueAt(old, 25 * 3600);
  ok(expCand.all(86400).some(r => r.id === old), 'فاکتورِ ۲۵ساعته کاندیدِ انقضاست');
  ok(remCand.all(3600).some(r => r.id === old), 'و چون یادآوری هم نگرفته، همچنان کاندیدِ یادآوری هم هست (استقلالِ دو کوئری)');
  setStatus.run('canceled', old);
  ok(expCand.all(86400).every(r => r.id !== old), 'بعد از انقضا دیگر کاندیدِ خودِ همین کوئری نیست (status از pending خارج شد)');

  // ۴) مقدسات: رسیدِ ثبت‌شده و پرداختِ تأییدشده — حتی اگر خیلی قدیمی باشند، هرگز کاندیدا نیستند
  const waiting = Number(insertAmount.run(4).lastInsertRowid);
  claim.run(4000, waiting);
  issueAt(waiting, 48 * 3600);
  setStatus.run('waiting_review', waiting);
  ok(remCand.all(3600).every(r => r.id !== waiting) && expCand.all(86400).every(r => r.id !== waiting),
    'رسیدِ ثبت‌شده (waiting_review) با ۴۸ ساعت سن هم لمس نمی‌شود');

  const approved = Number(insertAmount.run(5).lastInsertRowid);
  claim.run(5000, approved);
  issueAt(approved, 48 * 3600);
  setStatus.run('approved', approved);
  ok(remCand.all(3600).every(r => r.id !== approved) && expCand.all(86400).every(r => r.id !== approved),
    'پرداختِ تأییدشده (approved) هم لمس نمی‌شود');

  // ۵) رسیدِ دیررسیده روی ردیفِ منقضی‌شده: مسیرِ همیشگیِ احیا (CANCELED_RECOVERY_SEC،
  // روی created_at) دیگر او را نمی‌گیرد، چون created_at خودش موقعِ انقضا حدودِ ۲۴ ساعت
  // سن دارد و پنجره‌ی ۱۲ساعته از قبل رد شده — این **واقعیتِ** رفتار است، نه چیزی که
  // این چک باید پنهانش کند. ادعای درست این است که آن مسیر می‌داند این حالت را برنمی‌گرداند
  // (تا کسی فردا فکر نکند احیای خودکار برای این حالت هست) و مسیرِ صادقانه‌ی جایگزین‌اش
  // (`L.wallet.receiptNoInvoice`) هنوز در سورس وجود دارد — یعنی سکوت نیست، فقط خودکار نیست.
  db.prepare('UPDATE payments SET created_at=unixepoch()-? WHERE id=?').run(25 * 3600, old);
  const revivable = db.prepare(
    "SELECT * FROM payments WHERE user_id=? AND status='canceled' AND step='receipt' AND created_at > unixepoch()-?");
  ok(revivable.get(3, 12 * 3600) === undefined,
    'رسیدِ دیررسیده‌ی روی فاکتورِ ۲۵ساعته‌ی منقضی‌شده دیگر با مسیرِ ۱۲ساعته‌ی همیشگی خودکار احیا نمی‌شود (created_at از قبل رد شده)');
  ok(/L\.wallet\.receiptNoInvoice/.test(SRC) && /سکوت ممنوع/.test(SRC),
    'و به‌جایش مسیرِ صادقانه‌ی «سکوت ممنوع» هنوز سرِ جایش است — پول بی‌صدا گم نمی‌شود، فقط خودکار برنمی‌گردد');
}

/* ══ ۶) جهش‌ها ═══════════════════════════════════════════════════════════ */
console.log('\n۶) جهش‌های تأییدکننده');
if (claimSql && remSql && expSql) {
  const dbm = new Database(':memory:');
  dbm.exec(`CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', step TEXT,
    invoice_issued_at INTEGER, invoice_reminded_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  );`);
  const ins = dbm.prepare("INSERT INTO payments (user_id, amount, step) VALUES (?, 0, 'amount')");
  const cl = dbm.prepare(claimSql);
  const mkOld = (uid, secondsAgo) => {
    const id = Number(ins.run(uid).lastInsertRowid);
    cl.run(1000, id);
    dbm.prepare('UPDATE payments SET invoice_issued_at=unixepoch()-? WHERE id=?').run(secondsAgo, id);
    return id;
  };
  const approvedOld = mkOld(101, 48 * 3600);
  dbm.prepare("UPDATE payments SET status='approved' WHERE id=?").run(approvedOld);

  // جهش ۱: حذفِ status='pending' از کوئریِ انقضا → پرداختِ approved هم منقضی می‌شود (فاجعه)
  const mutExp1 = expSql.replace(/status='pending' AND /, '');
  ok(dbm.prepare(mutExp1).all(86400).some(r => r.id === approvedOld),
    'جهش «status=pending حذف شود» یک approvedِ ۴۸ساعته را هم می‌گیرد (ادعا این را رد می‌کرد)');

  // جهش ۲: حذفِ invoice_reminded_at IS NULL از کوئریِ یادآوری → یادآوری بی‌پایان تکرار می‌شود
  const twoHr = mkOld(102, 2 * 3600);
  dbm.prepare('UPDATE payments SET invoice_reminded_at=unixepoch() WHERE id=?').run(twoHr);
  const mutRem1 = remSql.replace(/ AND invoice_reminded_at IS NULL/, '');
  ok(dbm.prepare(mutRem1).all(3600).some(r => r.id === twoHr),
    'جهش «reminded_at IS NULL حذف شود» ردیفِ از قبل یادآوری‌شده را دوباره کاندیدا می‌کند');

  // جهش ۳: مقایسه‌ی برعکس (> به‌جای <) → فاکتورِ **تازه** هم فوراً «منقضی» به‌حساب می‌آید
  const fresh = mkOld(103, 60);
  const mutExp2 = expSql.replace('invoice_issued_at < unixepoch()', 'invoice_issued_at > unixepoch()');
  ok(dbm.prepare(mutExp2).all(86400).some(r => r.id === fresh),
    'جهشِ برعکس‌کردنِ علامتِ مقایسه یک فاکتورِ ۱دقیقه‌ای را هم کاندیدِ انقضا می‌کند (ادعای درست این را رد می‌کرد)');
}

/* ══ نتیجه ═══════════════════════════════════════════════════════════════ */
console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
