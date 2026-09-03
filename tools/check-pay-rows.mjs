// چکِ CI برای عمرِ ردیفِ پرداخت در tarot (v3.51.0).
//
// دو تغییر را قفل می‌کند:
//   ۱) تپِ دوباره‌ی «خرید الماس» ردیفِ نو نمی‌سازد (openPaymentRow)
//   ۲) جاروی ردیف‌های مرده فقط چیزی را می‌بندد که هیچ مسیری به آن نمی‌رسد
//
// چرا این فایل روی SQLite **واقعی** کار می‌کند و نه با اسکنِ متنی: ادعای مرکزی این
// کار یک ادعای رفتاری است («جارو صفر ردیفِ قابلِ استفاده را نمی‌کشد»)، و تنها راهِ
// سنجیدنش اجرای هر دو کوئری روی همان دیتاست است. اسکنِ متن فقط می‌گفت رشته‌ها
// شبیه‌اند، نه اینکه مرزها بر هم منطبق‌اند.
//
// ⚠️ درسِ بندِ ۲و/۶ب ریشه: گاردِ آینه‌ای که خودش عددها را به کوئری می‌دهد فقط آینه‌ی
// خودش را می‌سنجد. برای همین بخشِ ۳ عددها را از **خودِ سورس** می‌خواند: اگر فردا کسی
// پنجره‌ی جارو را پهن کند و پنجره‌ی بازیابی را دست‌نخورده بگذارد، این فایل قرمز می‌شود.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(["'\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  return m[2];
}
function bodyOf(marker, end = '\n}') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n💳 عمرِ ردیفِ پرداخت\n');

const SQL = {
  reusable: sqlOf('reusablePending'),
  recovery: sqlOf('pendingReceiptPayment'),
  sweepAmount: sqlOf('sweepDeadAmountRows'),
  sweepReceipt: sqlOf('sweepDeadReceiptRows'),
};

/* ══ ۱) جارو هرگز به وضعیتِ غیرِ pending دست نمی‌زند ═══════════════════════
 * این سخت‌ترین قاعده‌ی بند ۹ب/۳ است: رسیدِ ثبت‌شده (waiting_review) حتی با تپِ
 * صریحِ کاربر لغو نمی‌شود، چه رسد به یک جاروی خودکار. */
for (const [name, sql] of [['sweepDeadAmountRows', SQL.sweepAmount], ['sweepDeadReceiptRows', SQL.sweepReceipt]]) {
  if (!sql) continue;
  ok(/WHERE[\s\S]*status='pending'/.test(sql), `${name}: فقط ردیفِ pending را می‌بندد`);
  for (const bad of ['waiting_review', 'approved', 'rejected', 'reversed']) {
    ok(!sql.includes(bad), `${name}: هیچ اشاره‌ای به «${bad}» ندارد`);
  }
  ok(/SET\s+status='canceled'/.test(sql), `${name}: فقط به canceled می‌برد (نه DELETE)`);
  ok(!/DELETE|DROP/i.test(sql), `${name}: هیچ حذفِ سختی ندارد (بند ۲ج/۱)`);
}
ok(SQL.sweepAmount ? /amount=0/.test(SQL.sweepAmount) : false,
  'sweepDeadAmountRows: شرطِ amount=0 دارد، پس ردیفِ پول‌دار انتخاب نمی‌شود');
ok(SQL.sweepReceipt ? /receipt_file_id IS NULL/.test(SQL.sweepReceipt) : false,
  'sweepDeadReceiptRows: ردیفی که کاربر رویش رسید فرستاده جارو نمی‌شود');

/* ══ ۲) رفتار روی SQLite واقعی ════════════════════════════════════════════ */
const REUSE_SEC = 15 * 60;
const RECOVERY_SEC = 3 * 24 * 3600;
if (SQL.reusable && SQL.recovery && SQL.sweepAmount && SQL.sweepReceipt) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      step TEXT,
      receipt_file_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`);
  const ins = db.prepare(
    'INSERT INTO payments (user_id, amount, status, step, receipt_file_id, created_at)'
    + " VALUES (?,?,?,?,?, unixepoch()-?)");
  const U = 100257975, OTHER = 42;

  // چیدمانِ صحنه: هر ردیف یک وضعیتِ واقعیِ ممکن است.
  const fresh      = ins.run(U, 0, 'pending', 'amount', null, 60).lastInsertRowid;          // تازه، قابلِ ادامه
  const oldAmount  = ins.run(U, 0, 'pending', 'amount', null, 40 * 3600).lastInsertRowid;   // مرده
  const liveInv    = ins.run(U, 50_000, 'pending', 'receipt', null, 3600).lastInsertRowid;  // فاکتورِ زنده
  const oldInv     = ins.run(U, 50_000, 'pending', 'receipt', null, RECOVERY_SEC + 3600).lastInsertRowid; // خارج از پنجره
  const withPhoto  = ins.run(U, 50_000, 'pending', 'receipt', 'AgAC', RECOVERY_SEC + 3600).lastInsertRowid;
  const waiting    = ins.run(U, 50_000, 'waiting_review', 'receipt', 'AgAC', 40 * 3600).lastInsertRowid;
  const approved   = ins.run(U, 50_000, 'approved', 'receipt', 'AgAC', 40 * 3600).lastInsertRowid;
  const otherFresh = ins.run(OTHER, 0, 'pending', 'amount', null, 60).lastInsertRowid;

  const reusable = db.prepare(SQL.reusable);
  const recovery = db.prepare(SQL.recovery);

  ok(reusable.get(U, REUSE_SEC)?.id === fresh,
    'reusablePending: ردیفِ تازه‌ی همین کاربر برمی‌گردد (تپِ دوم ردیفِ نو نمی‌سازد)');
  ok(reusable.get(U, 30)?.id === undefined,
    'reusablePending: بیرونِ پنجره چیزی برنمی‌گرداند، پس تلاشِ تازه ردیفِ تازه می‌گیرد');
  ok(reusable.get(OTHER, REUSE_SEC)?.id === otherFresh,
    'reusablePending: ردیفِ کاربرِ دیگر را برنمی‌دارد (مالکیتِ رکورد، بند ۹)');

  const beforeIds = db.prepare(
    "SELECT id FROM payments WHERE status='pending' AND step='receipt'"
    + ' AND created_at > unixepoch()-?').all(RECOVERY_SEC).map(r => r.id);

  // 🔒 ادعای مرکزی: هرچه جارو می‌بندد، مسیرِ بازیابی از قبل نمی‌دیدش.
  const doomed = db.prepare(
    "SELECT id FROM payments WHERE status='pending' AND step='receipt'"
    + ' AND receipt_file_id IS NULL AND created_at < unixepoch()-?').all(RECOVERY_SEC).map(r => r.id);
  ok(doomed.length > 0, 'صحنه واقعاً ردیفِ کاندیدِ جارو دارد (ادعای پوچ نباشد)');
  ok(doomed.every(id => !beforeIds.includes(id)),
    'هیچ ردیفی که جارو می‌بندد در دسترسِ pendingReceiptPayment نبوده');

  const a = db.prepare(SQL.sweepAmount).run(24 * 3600).changes;
  const r = db.prepare(SQL.sweepReceipt).run(RECOVERY_SEC).changes;
  ok(a === 1, `جارو دقیقاً یک ردیفِ amount را بست (شد ${a})`);
  ok(r === 1, `جارو دقیقاً یک فاکتورِ بی‌رسید را بست (شد ${r})`);

  const st = (id) => db.prepare('SELECT status FROM payments WHERE id=?').get(id).status;
  ok(st(oldAmount) === 'canceled', 'ردیفِ amountِ کهنه بسته شد');
  ok(st(oldInv) === 'canceled', 'فاکتورِ خارج از پنجره‌ی بازیابی بسته شد');
  ok(st(fresh) === 'pending', 'ردیفِ تازه دست‌نخورده ماند');
  ok(st(liveInv) === 'pending', 'فاکتورِ زنده دست‌نخورده ماند');
  ok(st(withPhoto) === 'pending', 'فاکتوری که کاربر رویش رسید فرستاده دست‌نخورده ماند');
  ok(st(waiting) === 'waiting_review', 'رسیدِ منتظرِ تأیید دست‌نخورده ماند (مقدس‌ترین ردیف)');
  ok(st(approved) === 'approved', 'پرداختِ تأییدشده دست‌نخورده ماند');

  const after = db.prepare(
    "SELECT id FROM payments WHERE status='pending' AND step='receipt'"
    + ' AND created_at > unixepoch()-?').all(RECOVERY_SEC).map(r2 => r2.id);
  ok(JSON.stringify(after) === JSON.stringify(beforeIds),
    'مجموعه‌ی ردیف‌هایی که مسیرِ بازیابیِ رسید می‌بیند قبل و بعد از جارو **دقیقاً** یکی است');
}

/* ══ ۳) عددها از سورس، نه از این فایل ═════════════════════════════════════
 * تک‌منبع بودنِ پنجره همان چیزی است که جارو را بی‌خطر نگه می‌دارد. اگر کسی
 * `pendingReceiptPayment` را پهن کند و جارو را دست‌نخورده بگذارد، ردیف‌هایی که
 * هنوز قابلِ استفاده‌اند کشته می‌شوند و پولِ واریزشده گم می‌شود. */
const constRe = /const\s+RECEIPT_RECOVERY_SEC\s*=\s*([^;]+);/;
ok(constRe.test(SRC), 'ثابتِ RECEIPT_RECOVERY_SEC در سورس تعریف شده');
ok(!/unixepoch\(\)-\d{4,}/.test(SQL.recovery || '') && !/unixepoch\(\)-\d{4,}/.test(SQL.sweepReceipt || ''),
  'هیچ‌کدام از دو کوئری عددِ هاردکد ندارند (هر دو پارامتر می‌گیرند)');
const sweepBody = bodyOf('function sweepDeadPaymentRows()');
ok(!!sweepBody && sweepBody.includes('RECEIPT_RECOVERY_SEC'),
  'جارو همان ثابتِ پنجره‌ی بازیابی را پاس می‌دهد، نه یک عددِ جدا');
const recoveryCall = SRC.includes('pendingReceiptPayment.get(uid, RECEIPT_RECOVERY_SEC)');
ok(recoveryCall, 'مسیرِ بازیابیِ رسید هم از همان ثابت می‌خواند');

/* ══ ۴) ادعای ساختاری روی خودِ فراخوان‌ها ═════════════════════════════════
 * بندِ ۲و/۶ب: «ترجمه‌شده» با «وصل‌شده» یکی نیست. این‌جا هم: وجودِ openPaymentRow
 * کافی نیست، مسیرهای واقعی باید از آن عبور کنند وگرنه ردیفِ یتیم دوباره ساخته می‌شود. */
ok(/function openPaymentRow\(uid\)/.test(SRC), 'openPaymentRow تعریف شده');
const inserts = (SRC.match(/stmts\.insertPayment\.run\(/g) || []).length;
ok(inserts === 2, `insertPayment فقط از دو جا صدا می‌شود: openPaymentRow و مسیرِ فالِ رزروشده (شد ${inserts})`,
  'هر فراخوانِ سومی یعنی یک مسیرِ تازه که ردیفِ یتیم می‌سازد');
const rechargeBody = bodyOf("bot.action('recharge'", '\n});');
ok(!!rechargeBody && rechargeBody.includes('openPaymentRow(uid)'),
  'مسیرِ recharge از openPaymentRow می‌رود');
ok(!!rechargeBody && !rechargeBody.includes('insertPayment.run'),
  'مسیرِ recharge دیگر مستقیم INSERT نمی‌کند');
ok(!!rechargeBody && /if \(fresh\) track\(db, uid, EVENTS\.RECHARGE_STARTED/.test(rechargeBody),
  'recharge_started فقط برای تلاشِ واقعاً تازه ثبت می‌شود (قیف باد نمی‌کند)');
const cancelBody = bodyOf('bot.action(/^pay_cancel:', '\n});');
ok(!!cancelBody && cancelBody.includes('openPaymentRow(uid)'),
  'بازگشتِ انصراف به صفحه‌ی بسته‌ها هم از openPaymentRow می‌رود');

/* ══ ۵) تپِ کاربر روی صفحه‌ی کهنه بی‌صدا نمی‌میرد ══════════════════════════
 * بدونِ این، جارو خودش یک باگ می‌ساخت: کاربر روی بسته می‌زند و هیچ اتفاقی نمی‌افتد. */
const pkgBody = bodyOf('bot.action(/^pkg:', '\n});');
ok(!!pkgBody && /claimAmount\.run\(pack\.coins, payId\)\.changes === 0/.test(pkgBody),
  'مسیرِ pkg شکستِ claim را می‌گیرد');
ok(!!pkgBody && pkgBody.includes('payId = openPaymentRow(uid).id'),
  'مسیرِ pkg روی ردیفِ مرده یک ردیفِ زنده باز می‌کند به‌جای سکوت');
ok(!!pkgBody && !/\$\{s\.paymentId\}/.test(pkgBody),
  'هیچ دکمه‌ای در مسیرِ pkg به شناسه‌ی کهنه‌ی سشن اشاره نمی‌کند');

/* ══ ۶) رول‌بکِ یک‌خطی (بند ۲ج/۸) ═════════════════════════════════════════ */
ok(/const PAY_ROW_SWEEP = (true|false);/.test(SRC), 'پرچمِ PAY_ROW_SWEEP وجود دارد');
ok(!!sweepBody && /if \(!PAY_ROW_SWEEP\) return;/.test(sweepBody), 'پرچم واقعاً جارو را خاموش می‌کند');

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
