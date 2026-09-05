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

  /* رفتارِ تازه = **خودِ هندلرِ pay_exit، بریده از سورس و اجراشده**.
     ⚠️ نسخه‌ی اولِ این چک این‌جا یک بازنویسیِ محلی داشت (`payExit` سه‌خطی) و با چند
     ادعای رجکسی جبرانش می‌کرد. همان تله‌ی ثبت‌شده‌ی `check-lucky`/`check-announce`:
     مدل «طراحی» را اثبات می‌کند نه «کد» را، و رجکس شکلِ خط را می‌بیند نه شرطی که آن خط
     زیرش نشسته. نتیجه: تپِ دکمه‌ی گاردِ **کهنه** (که استیت را بی‌قید عوض می‌کرد)
     کاملاً نامرئی بود. حالا هیچ کپی‌ای در کار نیست. */
  const exitBody = (() => {
    const i = SRC.indexOf('bot.action(/^pay_exit:(\\d+)$/');
    const s0 = SRC.indexOf('{', SRC.indexOf('=>', i));
    let d = 0;
    for (let j = s0; j < SRC.length; j++) {
      if (SRC[j] === '{') d++;
      else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s0 + 1, j); }
    }
    return null;
  })();
  ok(!!exitBody, 'هندلرِ pay_exit از سورس استخراج شد (بدونِ کپیِ محلی)');

  /** هندلرِ واقعی را روی همان SQLite اجرا می‌کند و استیت/سشنِ نهایی را برمی‌گرداند. */
  // ⚠️ async است چون خودِ هندلر از اولین خط `await` دارد؛ نسخه‌ی اولِ این wrapper
  // همگام بود و `log` را **قبل از** تمام‌شدنِ بدنه برمی‌گرداند، یعنی همه‌ی ادعاها روی
  // حالتِ دست‌نخورده می‌نشستند. دقیقاً همان کلاسِ «تستی که کدِ واقعی را اجرا نمی‌کند».
  const payExit = async (s, tapPid) => {
    const log = { state: s.state, session: { ...s.session } };
    const fn = new Function('ctx', 'deps', `
      const { getSession, setSession, setState, stmts, replyCanceled, offerPendingReading } = deps;
      return (async () => {${exitBody}})();`);
    const p = fn({ from: { id: UID }, match: [null, String(tapPid ?? s.session.paymentId ?? 0)],
         answerCbQuery: () => Promise.resolve(), editMessageReplyMarkup: () => Promise.resolve() },
       { getSession: () => log.session,
         setSession: (_u, v) => { log.session = v; },
         setState: (_u, v) => { log.state = v; },
         stmts: { getPayment: { get: (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id) },
                  setPaymentStatus: { run: (stt, id) => db.prepare(setStatus).run(stt, id) } },
         replyCanceled: () => Promise.resolve(), offerPendingReading: () => Promise.resolve() });
    await p;
    return log;
  };
  const after = await payExit(st);
  ok(!blocked(after), '✅ با pay_exit یک بار انصراف کافی است و قفل می‌شکند');
  ok(!PAY_STATES.includes(after.state), `استیت از PAY_STATES بیرون می‌رود (${after.state})`);
  ok(!after.session.paymentId, 'paymentId از سشن پاک می‌شود');
  ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='pending'").get().c === 0,
    'هیچ ردیفِ پرداختِ بازی جا نمی‌ماند');

  // فالِ رزروشده: استیت باید به confirm_pay برود نه idle
  const withReading = await payExit({ state: 'pay_receipt', session: { paymentId: openRow(), readingId: 7 } });
  ok(withReading.state === 'confirm_pay', 'کاربری که فالِ رزروشده دارد به confirm_pay می‌رود، نه idle');
  ok(!blocked(withReading), 'و او هم دیگر بلاک نمی‌شود');

  /* 🕰 تپِ دکمه‌ی گاردِ **کهنه** (v3.59.1).
     کاربرِ تیکت **چند** پیامِ گارد گرفته بود، و `editMessageReplyMarkup` فقط دکمه‌ی
     پیامی را که تپ شده برمی‌دارد؛ بقیه زنده می‌مانند. پس تپ روی یکی از آن‌ها بعد از
     خروج یک سناریوی واقعی است، نه فرضی. آن‌جا هیچ فلوی پرداختِ بازی وجود ندارد و این
     دکمه **هیچ کاری** نباید بکند. */
  console.log('\n  — 🕰 تپِ گاردِ کهنه بعد از خروج:');
  {
    const dead = openRow(); db.prepare(setStatus).run('canceled', dead);
    const mid = await payExit({ state: 'picking', session: { readingId: 5, picks: [1], need: 3 } }, dead);
    ok(mid.state === 'picking',
      'کاربرِ وسطِ انتخابِ کارت سرِ جایش می‌ماند (گریدش نمی‌میرد)', `شد: ${mid.state}`);
    // فالِ در حالِ تحویل: پول داده و محصولش دارد می‌رسد (گاردِ blockDuringDelivering، v3.17.0)
    const rev = await payExit({ state: 'revealing', session: { readingId: 9, revealIdx: 2 } }, dead);
    ok(rev.state === 'revealing',
      'کاربرِ وسطِ افشای فالِ پول‌داده از فلویش بیرون انداخته نمی‌شود', `شد: ${rev.state}`);
    ok(rev.session.readingId === 9, 'و سشنِ فالش دست‌نخورده می‌ماند');
    const idle = await payExit({ state: 'idle', session: {} }, dead);
    ok(idle.state === 'idle', 'کاربرِ idle هم دست‌نخورده می‌ماند');
    // ...ولی کسی که واقعاً گیر کرده باید همچنان آزاد شود، حتی با تپ روی پیامِ کهنه.
    const stuckPid = openRow();
    const stuck = await payExit({ state: 'pay_amount', session: { paymentId: stuckPid } }, dead);
    ok(!blocked(stuck) && stuck.state === 'idle',
      '⚠️ و کاربرِ واقعاً گیرکرده هنوز با همان دکمه آزاد می‌شود (قفل‌شکن نشکسته)');
    // 🔑 و **فاکتورِ سشن** بسته می‌شود نه هرچه روی دکمه نوشته. اگر دکمه برنده می‌شد،
    // ردیفِ زنده‌ی کاربر `pending` جا می‌ماند و بعداً مسیرِ بازیابیِ رسید دوباره پیدایش
    // می‌کرد — یک نشتِ خاموش، دقیقاً همان کلاسی که این تیکت از آن آمد.
    ok(db.prepare('SELECT status FROM payments WHERE id=?').get(stuckPid).status === 'canceled',
      'فاکتورِ فعلیِ سشن بسته می‌شود، نه ردیفی که روی دکمه‌ی کهنه نوشته شده');
    ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='pending'").get().c === 0,
      'و هیچ ردیفِ pending ای پشتِ سر نمی‌ماند');
  }

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
// ⚠️ و آن نوشتن باید **زیرِ شرطِ** «واقعاً یک پرداختِ باز بستیم» باشد، نه بی‌قید (v3.59.1).
// خودِ سناریو بالا اجرا می‌شود؛ این ادعا شکلِ ساختاری‌اش را هم قفل می‌کند تا اگر روزی
// خط از داخلِ if بیرون بیاید، پیامِ خطا بگوید چرا.
ok(exitFn ? /if \(s\.paymentId\) \{[\s\S]*?setState\(uid, s\.readingId/.test(exitFn) : false,
  'تغییرِ استیت زیرِ شرطِ داشتنِ paymentId است (تپِ گاردِ کهنه بی‌اثر می‌ماند)');
// ⚠️ قلبِ فیکس: این اکشن هرگز نباید ردیفِ پرداختِ تازه باز کند.
ok(exitFn ? !/openPaymentRow/.test(exitFn) : false,
  'pay_exit هیچ ردیفِ پرداختِ تازه‌ای باز نمی‌کند (وگرنه دوباره همان حلقه)');
ok(exitFn ? !/'pay_amount'/.test(exitFn) : false, 'و کاربر را به pay_amount برنمی‌گرداند');

/* ══ ۴) جاروی خودکار: کسی که از قبل گیر افتاده نباید کاری بکند ══════════ */
// فیکسِ دکمه یک تپ می‌خواهد؛ کسی که هفته‌ی پیش گیر افتاده و رفته، هرگز آن تپ را نمی‌زند.
// این بخش ثابت می‌کند جارو دقیقاً همان‌ها را آزاد می‌کند و به پول دست نمی‌زند.
console.log('\n  — 🧹 جاروی فلوی رهاشده:');
const sweepSql = sqlOf('stuckPayCandidates');
if (sweepSql) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, state TEXT, session_json TEXT,
      balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', updated_at INTEGER NOT NULL DEFAULT 0);`);
  const OLD = Math.floor(Date.now() / 1000) - 7200;   // دو ساعت پیش
  const NEW = Math.floor(Date.now() / 1000);          // همین حالا
  // uid, state, payment(status, amount, updated_at), آیا باید آزاد شود؟
  const cases = [
    [1, 'pay_amount',   'pending',        0,   OLD, true,  'ردیفِ خالیِ پارک‌شده'],
    [2, 'pay_amount',   'canceled',       0,   OLD, true,  'فاکتورِ مرده (همان ۱۹ نفرِ دیتای زنده)'],
    [3, 'pay_receipt',  'canceled',       50,  OLD, true,  'رسیدِ لغوشده‌ی کهنه'],
    [4, 'pay_discount', 'refunded',       0,   OLD, true,  'ریفاندشده'],
    [5, 'pay_receipt',  'waiting_review', 100, OLD, false, '💰 رسیدِ در انتظارِ بررسی'],
    [6, 'pay_receipt',  'approved',       100, OLD, false, '💰 پرداختِ تأییدشده'],
    [7, 'pay_receipt',  'pending',        100, OLD, false, '💰 فاکتورِ زنده‌ی مبلغ‌دار'],
    [8, 'pay_amount',   'pending',        0,   NEW, false, 'کاربرِ همین‌حالا وسطِ کار'],
    [9, 'idle',         'pending',        0,   OLD, false, 'کاربری که اصلاً در فلو نیست'],
  ];
  for (const [uid, st, pst, amt, ts] of cases) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(uid, st, JSON.stringify({ paymentId: uid * 10 }), 7);
    db.prepare('INSERT INTO payments VALUES (?,?,?,?,?)').run(uid * 10, uid, amt, pst, ts);
  }
  const PAY = PAY_STATES;
  const picked = new Set(db.prepare(sweepSql).all(1800)
    .filter(r => PAY.includes(r.state))     // همان فیلترِ جاوااسکریپتیِ خودِ جارو
    .map(r => r.uid));
  for (const [uid, , , , , want, label] of cases) {
    ok(picked.has(uid) === want, `${want ? 'آزاد می‌شود' : 'دست نمی‌خورد'}: ${label}`);
  }
  ok(!/balance/i.test(sweepSql), 'کوئریِ جارو اصلاً کلمه‌ی balance را ندارد');
  db.close();
}

const sweep = bodyOf('function sweepStuckPayFlows() {', '\n}');
ok(!!sweep, 'تابعِ جارو پیدا شد');
ok(sweep ? /PAY_STATES\.includes\(getState\(r\.uid\)\)/.test(sweep) : false,
  'فیلترِ استیت از خودِ PAY_STATES می‌آید و وضعیتِ **الانِ** کاربر را می‌خواند نه عکسِ لحظه‌ای');
// درسِ v3.59.1، این‌بار روی جارو: ربات حین اجرای جارو زنده است، پس کاربری که در همین
// فاصله فلوی تازه‌ای باز کرده نباید کوبیده شود.
ok(sweep ? /Number\(s\.paymentId\) !== r\.pid/.test(sweep) : false,
  'اگر کاربر در این فاصله سراغِ فاکتورِ دیگری رفته باشد، رد می‌شود');
ok(sweep ? /r\.pstatus === 'pending'/.test(sweep) : false,
  'فقط ردیفِ pending لغو می‌شود (ردیفِ مرده دوباره دست نمی‌خورد)');
ok(sweep ? /delete s\.paymentId/.test(sweep) && /setSession\(r\.uid, s\)/.test(sweep) : false,
  'paymentId از سشن پاک و ذخیره می‌شود');
ok(sweep ? /setState\(r\.uid, s\.readingId \? 'confirm_pay' : 'idle'\)/.test(sweep) : false,
  'استیت بیرونِ PAY_STATES می‌رود و فالِ رزروشده حفظ می‌شود');
ok(sweep ? /catch \(e\)/.test(sweep) : false, 'خطای یک کاربر بقیه‌ی جارو را نمی‌شکند');
ok(sweep ? !/credit|deduct|balance/.test(sweep) : false, 'جارو به موجودی دست نمی‌زند');
ok(/sweepStuckPayFlows\(\);/.test(SRC), 'در بوت صدا زده می‌شود');
ok(/setInterval\(sweepStuckPayFlows,/.test(SRC),
  'و دوره‌ای هم اجرا می‌شود (کسی که ظهر برمی‌گردد تا ری‌استارتِ بعدی منتظر نمی‌ماند)');

/* ══ ۴) دکمه‌های قدیمی نمی‌میرند (بند ۲ج/۶) ═════════════════════════════ */
console.log('\n  — 🕰 سازگاری با دکمه‌های کهنه:');
for (const a of ['pay_cancel', 'pay_back']) {
  ok(SRC.includes(`bot.action(/^${a}:`), `الگوی ${a} هنوز ثبت است (دکمه‌ی کهنه در چت خطا نمی‌دهد)`);
}

console.log(`\n${fail ? '❌' : '✅'} راهِ خروجِ پرداخت: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
