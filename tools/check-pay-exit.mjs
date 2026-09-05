// چکِ CI برای «راهِ خروج از فلوی پرداخت» (tarot) — بند ۹ب/۱ و ۹ب/۲ ریشه.
//
// از یک تیکتِ واقعی آمد (#TRT-8976388520): کاربر هر دکمه‌ی منویی می‌زد پیامِ «یه فاکتور
// شارژ باز داری» می‌گرفت، انصراف می‌زد، و دوباره همان پیام. روی دیتای زنده شش ردیفِ
// پرداختِ **خالیِ لغوشده** پشتِ سرِ هم ثبت شده بود؛ اثرانگشتِ خودِ حلقه.
//
// ریشه: دکمه‌ی گارد به `pay_cancel` وصل بود، ولی آن اکشن از ۱۴۰۵/۰۶/۱۱ معنیِ دیگری
// گرفت («یک قدم عقب به صفحه‌ی بسته‌ها») و برای کاربرِ الماسی یک ردیفِ پرداختِ تازه باز
// می‌کند و در `pay_amount` می‌ماند — دقیقاً شرطی که گارد رویش فعال می‌شود.
//
// این فایل خودِ حلقه را **اجرا** می‌کند: اول ثابت می‌کند رفتارِ قدیمی قفل می‌ساخت، بعد
// ثابت می‌کند رفتارِ تازه قفل را می‌شکند.
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
function bodyOf(marker, end = '\n});') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n🚪 راهِ خروج از فلوی پرداخت\n');

/* ══ ۱) مدلِ گارد از خودِ سورس ════════════════════════════════════════════ */
// PAY_STATES از سورس خوانده می‌شود، و شکلِ خودِ گارد هم ادعا می‌شود تا این مدلِ دوخطی
// نتواند بی‌صدا از کدِ واقعی واگرا شود.
const PAY_STATES = JSON.parse(
  (SRC.match(/const PAY_STATES = (\[[^\]]+\])/)?.[1] || '[]').replace(/'/g, '"'));
const guard = bodyOf('async function blockDuringOpenPay(ctx, intent) {', '\n}');
ok(PAY_STATES.length > 0, `PAY_STATES از سورس خوانده شد (${PAY_STATES.join(', ')})`);
ok(guard ? /PAY_STATES\.includes\(getState\(uid\)\)/.test(guard) : false,
  'گارد روی PAY_STATES تصمیم می‌گیرد');
ok(guard ? /const pid = getSession\(uid\)\?\.paymentId/.test(guard) : false,
  'و روی paymentId سشن');
// مدلِ وفادار به همان دو شرط
const blocked = (st) => PAY_STATES.includes(st.state) && !!st.session.paymentId;

/* ══ ۲) خودِ حلقه، اجراشده روی SQLite واقعی ══════════════════════════════ */
console.log('\n  — 🔁 بازتولیدِ حلقه:');
const setStatus = sqlOf('setPaymentStatus');
if (setStatus) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0);`);
  const UID = 8976388520;
  const openRow = () => Number(db.prepare('INSERT INTO payments (user_id) VALUES (?)').run(UID).lastInsertRowid);
  const cancelPending = (pid) => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
    if (p && p.user_id === UID && p.status === 'pending') db.prepare(setStatus).run('canceled', p.id);
  };

  // کاربر سرِ صفحه‌ی بسته‌ها (همان چیزی که دیتای زنده نشان داد)
  let st = { state: 'pay_amount', session: { paymentId: openRow() } };
  ok(blocked(st), 'کاربرِ وسطِ فلو با تپِ منو بلاک می‌شود (رفتارِ درست و موردِ انتظار)');

  // رفتارِ قدیمِ دکمه‌ی گارد = شاخه‌ی الماسیِ pay_cancel
  const payCancelCoins = (s) => {
    cancelPending(s.session.paymentId);
    return { state: 'pay_amount', session: { ...s.session, paymentId: openRow() } };
  };
  for (let i = 0; i < 5; i++) st = payCancelCoins(st);
  ok(blocked(st), '🐛 با رفتارِ قدیم، بعد از پنج بار انصراف هنوز بلاک است (خودِ حلقه)');
  ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='canceled' AND amount=0").get().c === 5,
    'و پنج ردیفِ خالیِ لغوشده جا می‌گذارد — همان اثرانگشتی که در دیتای زنده دیده شد');

  // رفتارِ تازه = pay_exit
  const payExit = (s) => {
    cancelPending(s.session.paymentId);
    const sess = { ...s.session }; delete sess.paymentId;
    return { state: sess.readingId ? 'confirm_pay' : 'idle', session: sess };
  };
  const after = payExit(st);
  ok(!blocked(after), '✅ با pay_exit یک بار انصراف کافی است و قفل می‌شکند');
  ok(!PAY_STATES.includes(after.state), `استیت از PAY_STATES بیرون می‌رود (${after.state})`);
  ok(!after.session.paymentId, 'paymentId از سشن پاک می‌شود');
  ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='pending'").get().c === 0,
    'هیچ ردیفِ پرداختِ بازی جا نمی‌ماند');

  // فالِ رزروشده: استیت باید به confirm_pay برود نه idle
  const withReading = payExit({ state: 'pay_receipt', session: { paymentId: openRow(), readingId: 7 } });
  ok(withReading.state === 'confirm_pay', 'کاربری که فالِ رزروشده دارد به confirm_pay می‌رود، نه idle');
  ok(!blocked(withReading), 'و او هم دیگر بلاک نمی‌شود');

  console.log('\n  — 💰 چیزی که نباید لمس شود:');
  // رسیدِ ثبت‌شده و پرداختِ تأییدشده هرگز با یک تپِ کاربر لغو نمی‌شوند (بند ۹ب/۳)
  const wr = openRow(); db.prepare(setStatus).run('waiting_review', wr);
  const ap = openRow(); db.prepare(setStatus).run('approved', ap);
  cancelPending(wr); cancelPending(ap);
  ok(db.prepare('SELECT status FROM payments WHERE id=?').get(wr).status === 'waiting_review',
    'رسیدِ در انتظارِ بررسی لغو نمی‌شود');
  ok(db.prepare('SELECT status FROM payments WHERE id=?').get(ap).status === 'approved',
    'پرداختِ تأییدشده لغو نمی‌شود');
  // پرداختِ کاربرِ دیگر
  const other = Number(db.prepare('INSERT INTO payments (user_id) VALUES (999)').run().lastInsertRowid);
  cancelPending(other);
  ok(db.prepare('SELECT status FROM payments WHERE id=?').get(other).status === 'pending',
    'پرداختِ کاربرِ دیگر دست‌نخورده می‌ماند (چکِ مالکیت)');
  db.close();
}

/* ══ ۳) سیمِ اتصال: گارد باید به همین اکشن وصل باشد ═════════════════════ */
console.log('\n  — 🔌 اتصال:');
ok(guard ? /pay_exit:\$\{pid\}/.test(guard) : false, 'دکمه‌ی گارد به pay_exit وصل است');
ok(guard ? !/pay_cancel:/.test(guard) : false,
  'گارد دیگر از pay_cancel استفاده نمی‌کند (همان باگی که حلقه را می‌ساخت)');

const exitFn = bodyOf("bot.action(/^pay_exit:");
ok(!!exitFn, 'هندلرِ pay_exit ثبت شده');
ok(exitFn ? /replyCanceled\(ctx, uid\)/.test(exitFn) : false,
  'نیتِ ذخیره‌شده برمی‌گردد (replyCanceled → replayIntent)، پس کاربر به مقصدِ خودش می‌رسد');
ok(exitFn ? /offerPendingReading\(ctx, uid\)/.test(exitFn) : false,
  'فالِ رزروشده سرگردان نمی‌ماند');
ok(exitFn ? /p\.status === 'pending'/.test(exitFn) : false, 'فقط پرداختِ pending لغو می‌شود');
ok(exitFn ? /p\.user_id === uid/.test(exitFn) : false, 'مالکیتِ رکورد چک می‌شود');
// ⚠️ درسِ جهشِ M4: شبیه‌سازیِ بالا **طراحی** را اثبات می‌کند نه **کد** را. هر قدمی که
// مدل انجام می‌دهد باید یک ادعای متناظر داشته باشد که هندلرِ واقعی هم همان را می‌کند،
// وگرنه حذفِ آن قدم از کد بی‌صدا سبز می‌ماند. paymentId ماندگارِ یک پرداختِ لغوشده در
// سشن، هر مسیری را که بعداً `s.paymentId` را می‌خواند به یک ردیفِ مرده وصل می‌کند.
ok(exitFn ? /delete s\.paymentId/.test(exitFn) && /setSession\(uid, s\)/.test(exitFn) : false,
  'paymentId واقعاً از سشن پاک و ذخیره می‌شود (نه فقط در مدلِ این تست)');
ok(exitFn ? /setState\(uid, s\.readingId \? 'confirm_pay' : 'idle'\)/.test(exitFn) : false,
  'استیت واقعاً بیرونِ PAY_STATES نوشته می‌شود، و فالِ رزروشده به confirm_pay می‌رود');
// ⚠️ قلبِ فیکس: این اکشن هرگز نباید ردیفِ پرداختِ تازه باز کند.
ok(exitFn ? !/openPaymentRow/.test(exitFn) : false,
  'pay_exit هیچ ردیفِ پرداختِ تازه‌ای باز نمی‌کند (وگرنه دوباره همان حلقه)');
ok(exitFn ? !/'pay_amount'/.test(exitFn) : false, 'و کاربر را به pay_amount برنمی‌گرداند');

/* ══ ۴) دکمه‌های قدیمی نمی‌میرند (بند ۲ج/۶) ═════════════════════════════ */
console.log('\n  — 🕰 سازگاری با دکمه‌های کهنه:');
for (const a of ['pay_cancel', 'pay_back']) {
  ok(SRC.includes(`bot.action(/^${a}:`), `الگوی ${a} هنوز ثبت است (دکمه‌ی کهنه در چت خطا نمی‌دهد)`);
}

console.log(`\n${fail ? '❌' : '✅'} راهِ خروجِ پرداخت: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
