// چکِ CI برای لایه‌ی دومِ دفاعِ پرداخت: کاربرِ «مشکوک» (bots/tarot/CLAUDE.md، بخشِ
// «کاربرِ مشکوک»). از یک باگِ واقعی آمد: شبِ ۹ شهریور ۱۴۰۵ چند کاربر با سوءاستفاده از
// یک باگ رسیدِ فیک/تکراری فرستادند و تا صبح که ادمین بیدار شد چندین بار الماس گرفتند.
// این چک سه لایه را جدا می‌سنجد:
//   ۱) suspectTrigger — خودِ تابعِ تشخیص، از سورس بریده و روی دیتای ساختگی و روی
//      دیتای واقعیِ شبِ حادثه اجرا می‌شود.
//   ۲) SQLِ نگه‌داری/آزادسازیِ برچسب — از سورس خوانده و روی SQLite واقعی اجرا می‌شود.
//   ۳) گیتِ processReceipt — ساختاراً باید هر سه تصمیمِ خودکار (approve/underpaid/
//      reject) را برای کاربرِ مشکوک ببندد، نه فقط approve؛ وگرنه «هر رسیدی که
//      می‌فرسته باید دستی تصمیم گرفته بشه» نقض می‌شود.
import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/dashboard/node_modules/better-sqlite3'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» در index.js پیدا نشد`); return null; }
  return m[2];
}
// می‌برد تا اولین رخدادِ `end` **بعد از** marker — نه اولین `{`ِ همسایه (تله‌ی مستندشده:
// اولین `{`ِ عمقِ-صفر بعد از یک هدر می‌تواند بلوکِ **بعدی** باشد).
function bodyOf(marker, end) {
  const a = SRC.indexOf(marker);
  if (a < 0) return null;
  const b = SRC.indexOf(end, a + marker.length);
  return b < 0 ? null : SRC.slice(a, b + end.length);
}
function stripComments(s) {
  return (s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/* ═══ ۱) suspectTrigger — از سورس بریده و **اجرا** می‌شود ═══════════════════ */
console.log('\n▶ suspectTrigger — دو قاعده‌ی OR روی رسیدهای قبلی');
{
  const fnSrc = bodyOf('function suspectTrigger(uid, nowSec) {', '\n}');
  ok(!!fnSrc, 'suspectTrigger از سورس بریده شد');

  const gapConst = SRC.match(/const SUSPECT_GAP_SEC = (\d+);/)?.[1];
  const winMatch = SRC.match(/const SUSPECT_WINDOW_SEC = (\d+) \* (\d+);/);
  ok(gapConst === '60', 'قاعده‌ی الف: آستانه دقیقاً ۶۰ ثانیه (تصمیمِ صریحِ مالک: زیرِ ۱ دقیقه)');
  ok(!!winMatch && Number(winMatch[1]) * Number(winMatch[2]) === 7200, 'قاعده‌ی ب: آستانه دقیقاً ۲ ساعت');

  const build = (rows) => {
    const stmtsStub = { recentReceiptTimes: { all: () => rows } };
    return new Function('stmts', 'SUSPECT_GAP_SEC', 'SUSPECT_WINDOW_SEC', `
      ${fnSrc}
      return suspectTrigger;
    `)(stmtsStub, 60, 7200);
  };

  const NOW = 1_000_000;
  ok(build([])(1, NOW) === false, 'رسیدِ اول (بدونِ سابقه) هرگز مشکوک نیست');
  ok(build([{ created_at: NOW - 30 }])(1, NOW) === true,
    'قاعده‌ی الف: فاصله‌ی ۳۰ ثانیه‌ای با رسیدِ قبلی → مشکوک (از رسیدِ دوم)');
  ok(build([{ created_at: NOW - 59 }])(1, NOW) === true, 'مرزِ زیرِ ۶۰ ثانیه هم گرفته می‌شود');
  ok(build([{ created_at: NOW - 60 }])(1, NOW) === false, 'دقیقاً ۶۰ ثانیه دیگر مشکوک نیست');
  ok(build([{ created_at: NOW - 600 }])(1, NOW) === false,
    'یک رسیدِ ۱۰دقیقه‌ای به‌تنهایی (بدونِ رسیدِ سومی برای قاعده‌ی ب) مشکوک نیست');
  ok(build([{ created_at: NOW - 200 }, { created_at: NOW - 3000 }])(1, NOW) === true,
    'قاعده‌ی ب: فاصله‌ی رسیدِ دوتاقبل ۳۰۰۰ ثانیه (<۲ساعت) → مشکوک از رسیدِ سوم، حتی اگر قاعده‌ی الف رد کند');
  ok(build([{ created_at: NOW - 500 }, { created_at: NOW - 10000 }])(1, NOW) === false,
    'هر دو قاعده رد کنند → مشکوک نیست');
  // کنترلِ مثبتِ روی دیتای واقعی (بند ۶ب-۲ ریشه): بدترین (کندترین) رسیدِ کاربرانِ
  // چندرسیدیِ بی‌اعتمادِ شبِ ۹ شهریور با ~۲۷ ثانیه فاصله رسیده بود. این باید همچنان
  // گرفته شود، وگرنه همان کوهورت دوباره از زیرِ گارد رد می‌شود.
  ok(build([{ created_at: NOW - 27 }])(1, NOW) === true,
    'دیتای واقعی: بدترین موردِ بی‌اعتمادِ شبِ حادثه (~۲۷ ثانیه) گرفته می‌شود');
}

/* ═══ ۲) SQLِ برچسب — از سورس خوانده و روی SQLite واقعی اجرا می‌شود ═══════════ */
console.log('\n▶ SQLِ برچسبِ «مشکوک» روی SQLite واقعی');
{
  const S = {
    setSuspect: sqlOf('setSuspect'),
    clearSuspect: sqlOf('clearSuspect'),
    setSuspectHold: sqlOf('setSuspectHold'),
    hasSuspectPending: sqlOf('hasSuspectPending'),
    recentReceiptTimes: sqlOf('recentReceiptTimes'),
  };
  ok(Object.values(S).every(Boolean), 'همه‌ی statementها از سورس برداشته شدند');

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, pay_suspect INTEGER NOT NULL DEFAULT 0, pay_distrust INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', suspect_hold INTEGER NOT NULL DEFAULT 0,
      receipt_file_id TEXT, admin_message_id INTEGER, updated_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT NOT NULL,
      props TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  `);
  const UID = 42;
  db.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(UID);

  db.prepare(S.setSuspect).run(UID);
  ok(db.prepare('SELECT pay_suspect FROM users WHERE telegram_id=?').get(UID).pay_suspect === 1,
    'setSuspect برچسب را روشن می‌کند');
  db.prepare(S.clearSuspect).run(UID);
  ok(db.prepare('SELECT pay_suspect FROM users WHERE telegram_id=?').get(UID).pay_suspect === 0,
    'clearSuspect برچسب را خاموش می‌کند');

  // setSuspectHold: همان گاردِ setPaymentReceipt، فقط با suspect_hold=1 هم‌زمان
  const mk = (st) => Number(db.prepare('INSERT INTO payments (user_id, status) VALUES (?, ?)').run(UID, st).lastInsertRowid);
  const live = mk('pending');
  ok(db.prepare(S.setSuspectHold).run('f1', 11, live).changes === 1, 'روی پرداختِ pending می‌نشیند');
  let row = db.prepare('SELECT status, suspect_hold FROM payments WHERE id=?').get(live);
  ok(row.status === 'waiting_review' && row.suspect_hold === 1,
    'وضعیت به waiting_review می‌رود و suspect_hold=1 می‌شود');
  for (const dead of ['approved', 'rejected', 'canceled']) {
    const id = mk(dead);
    const ch = db.prepare(S.setSuspectHold).run('fx', 99, id).changes;
    ok(ch === 0, `پرداختِ «${dead}» با setSuspectHold دست‌نخورده می‌ماند (changes=${ch})`);
  }

  // hasSuspectPending: تا وقتی رسیدِ مشکوکِ معلقی هست true، بعد از تعیینِ‌تکلیف false
  ok(db.prepare(S.hasSuspectPending).get(UID) !== undefined, 'رسیدِ مشکوکِ معلقِ همین کاربر دیده می‌شود');
  db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(live);
  ok(db.prepare(S.hasSuspectPending).get(UID) === undefined,
    'بعد از تعیینِ‌تکلیف (susyes)، دیگر «معلق» حساب نمی‌شود');
  // ردیفِ waiting_review که suspect_hold **ندارد** (بازبینیِ دستیِ معمولی) نباید قاطی شود
  const normalReview = mk('waiting_review');
  ok(db.prepare(S.hasSuspectPending).get(UID) === undefined,
    'رسیدِ در صفِ بازبینیِ معمولی (suspect_hold=0) را «معلقِ مشکوک» حساب نمی‌کند');

  // recentReceiptTimes: DESC، سقفِ ۲
  const ins = db.prepare("INSERT INTO events (user_id, event, created_at) VALUES (?, 'receipt_submitted', ?)");
  ins.run(UID, 100); ins.run(UID, 300); ins.run(UID, 200);
  const rows = db.prepare(S.recentReceiptTimes).all(UID);
  ok(rows.length === 2, 'حداکثر دو ردیف برمی‌گردد');
  ok(rows[0].created_at === 300 && rows[1].created_at === 200, 'ترتیبِ نزولی: تازه‌ترین اول');

  db.close();
}

/* ═══ ۳) مهاجرت افزایشی است ═══════════════════════════════════════════════ */
console.log('\n▶ مهاجرت افزایشی است (بند ۲ج/۱ ریشه)');
{
  ok(/ALTER TABLE users ADD COLUMN pay_suspect INTEGER NOT NULL DEFAULT 0/.test(SRC),
    'ستونِ users.pay_suspect افزایشی است');
  ok(/ALTER TABLE payments ADD COLUMN suspect_hold INTEGER NOT NULL DEFAULT 0/.test(SRC),
    'ستونِ payments.suspect_hold افزایشی است');
}

/* ═══ ۴) گیتِ processReceipt — ساختاری ═══════════════════════════════════ */
console.log('\n▶ گیتِ processReceipt: هر سه تصمیمِ خودکار برای «مشکوک» بسته می‌شود');
{
  const proc = bodyOf('async function processReceipt(ctx, uid, paymentId, photoFileId, textBody, recovered) {', '\nasync function ');
  ok(!!proc, 'processReceipt از سورس بریده شد');
  const code = stripComments(proc || '');

  // تشخیص باید قبل از ثبتِ رویدادِ همین رسید باشد (وگرنه خودش را هم می‌شمرد)
  const trigAt = code.indexOf('suspectTrigger(uid');
  const trackAt = code.indexOf('EVENTS.RECEIPT_SUBMITTED');
  ok(trigAt >= 0 && trackAt > trigAt,
    'تشخیصِ الگو قبل از ثبتِ رویدادِ همین رسید اجرا می‌شود');
  ok(/!isDistrusted\(uid\) && !isSuspect\(uid\) && suspectTrigger/.test(code),
    'کاربرِ بی‌اعتماد یا از قبل مشکوک، دوباره trigger نمی‌شود');

  // گیتِ اصلی باید قبل از هر سه شاخه‌ی خودکار باشد
  const gateAt = code.indexOf('isSuspect(uid) && !isDistrusted(uid)');
  const approveAt = code.indexOf("decision.action === 'approve'", gateAt + 1);
  const underpaidAt = code.indexOf("decision.action === 'underpaid'");
  const rejectAt = code.indexOf("decision.action === 'reject'");
  ok(gateAt >= 0, 'گیتِ مشکوک در processReceipt هست');
  ok(approveAt > gateAt && underpaidAt > gateAt && rejectAt > gateAt,
    'گیت قبل از هر سه شاخه‌ی approve/underpaid/reject می‌نشیند، پس هیچ‌کدام خودکار اجرا نمی‌شوند');
  const gateBlock = code.slice(gateAt, gateAt + 500);
  ok(/sendSuspectApprovalToAdmin/.test(gateBlock), 'approve برای مشکوک به پیامِ دوگزینه‌ای می‌رود');
  ok(/sendReceiptToAdmin\(ctx, uid, paymentId, photoFileId, textBody\)/.test(gateBlock),
    'بقیه‌ی تصمیم‌ها (underpaid/reject/…) برای مشکوک به بازبینیِ دستیِ عادی می‌روند');
  ok(/return setState\(uid, nextState\);/.test(gateBlock),
    'و گیت همان‌جا return می‌کند — کریدیت به هیچ‌وجه از این شاخه داده نمی‌شود');
}

/* ═══ ۴ب) همان گیت، این‌بار **اجرا** می‌شود ═══════════════════════════════
 * بند ۶ب-۲ ریشه: گاردِ آینه‌ای فقط آینه‌ی خودش را می‌سنجد. ادعاهای بالا فقط ترتیبِ
 * زیررشته‌ها را می‌بینند، پس مثلاً `if (false && isSuspect(uid) && !isDistrusted(uid))`
 * همچنان همان زیررشته را دارد و سبز می‌ماند — یعنی گیتِ عملاً خاموش‌شده هم قبول می‌شد.
 * این بخش خودِ مسیرِ تصمیم‌گیری (از سورس، بدونِ کپی) را با isSuspect=true اجرا می‌کند و
 * ادعا می‌کند approvePayment **صدا زده نمی‌شود** — و با یک کنترلِ مثبت ثابت می‌کند همان
 * هارنس با isSuspect=false واقعاً approvePayment را صدا می‌زند (وگرنه ادعای منفی پوچ است). */
console.log('\n▶ گیتِ processReceipt — رفتاری: با isSuspect=true هرگز approvePayment صدا زده نمی‌شود');
{
  const startAt = SRC.indexOf("const reasonFa = decision.reason_fa || 'نامشخص';");
  const endMarker = '\n}\n\n// اطلاع به ادمین‌ها بعد از تأییدِ خودکار';
  const endAt = SRC.indexOf(endMarker, startAt);
  ok(startAt >= 0 && endAt > startAt, 'بدنه‌ی مسیرِ تصمیم‌گیری از سورس بریده شد');
  const routingBody = startAt >= 0 && endAt > startAt ? SRC.slice(startAt, endAt) : '';

  const DEP_NAMES = [
    'isSuspect', 'isDistrusted', 'decision', 'ctx', 'uid', 'paymentId', 'photoFileId', 'textBody',
    'sendSuspectApprovalToAdmin', 'sendReceiptToAdmin', 'setState', 'nextState', 'approvePayment',
    'approvedMsg', 'notifyAdminAutoApproved', 'stmts', 'getUser', 'afterApproval', 'p', 'MIN_RECHARGE',
    'amountToman', 'track', 'db', 'rejectPaymentAI', 'notifyAdminAuto', 'L', 'logErr', 'getBalance',
  ];

  const run = async (suspect) => {
    const log = { approveCalls: 0, suspectAdminCalls: 0, normalAdminCalls: 0, finalState: null };
    const fn = new Function('deps', `
      const { ${DEP_NAMES.join(', ')} } = deps;
      return (async () => {${routingBody}})();
    `);
    await fn({
      isSuspect: () => suspect,
      isDistrusted: () => false,
      decision: { action: 'approve' },
      ctx: { reply: () => Promise.resolve().then(() => ({ catch: () => {} })) },
      uid: 1, paymentId: 1, photoFileId: null, textBody: '',
      sendSuspectApprovalToAdmin: () => { log.suspectAdminCalls++; return Promise.resolve(); },
      sendReceiptToAdmin: () => { log.normalAdminCalls++; return Promise.resolve(); },
      setState: (_u, v) => { log.finalState = v; },
      nextState: 'idle',
      approvePayment: () => { log.approveCalls++; return { creditAmount: 1, bonus: 0 }; },
      approvedMsg: () => '',
      notifyAdminAutoApproved: () => Promise.resolve(),
      stmts: { getPayment: { get: () => ({}) } },
      getUser: () => ({}),
      afterApproval: () => Promise.resolve(),
      p: {}, MIN_RECHARGE: 10000, amountToman: 50000,
      track: () => {}, db: {}, rejectPaymentAI: () => {}, notifyAdminAuto: () => Promise.resolve(),
      L: { wallet: { underpaidApproved: () => '', rejected: '', adminAmountNote: () => '' } },
      logErr: () => {}, getBalance: () => 0,
    });
    return log;
  };

  if (routingBody) {
    const suspectRun = await run(true);
    ok(suspectRun.approveCalls === 0,
      `کاربرِ مشکوک با decision.action='approve' ⟵ approvePayment صدا زده نشد (شد: ${suspectRun.approveCalls})`);
    ok(suspectRun.suspectAdminCalls === 1,
      'و به‌جایش sendSuspectApprovalToAdmin دقیقاً یک بار صدا زده شد');
    ok(suspectRun.finalState === 'idle', 'و state به nextState برگشت (نه چیزِ دیگر)');

    // کنترلِ مثبت: همان هارنس، فقط isSuspect=false — approvePayment باید واقعاً اجرا شود
    const normalRun = await run(false);
    ok(normalRun.approveCalls === 1,
      `کنترلِ مثبت: کاربرِ سالم با decision.action='approve' ⟵ approvePayment صدا زده شد (شد: ${normalRun.approveCalls})`);
    ok(normalRun.suspectAdminCalls === 0, 'و مسیرِ «مشکوک» برای او اصلاً اجرا نشد');
  } else {
    fail += 2;
    console.error('  ❌ اجرای رفتاری ممکن نشد چون بدنه استخراج نشد');
  }
}

/* ═══ ۵) تگِ اعتماد روی هر پیامِ ادمین ═══════════════════════════════════ */
console.log('\n▶ تگِ اعتماد (🔴/🟡) روی پیام‌های ادمین');
{
  const send = bodyOf('async function sendReceiptToAdmin(ctx, uid, paymentId, photoFileId, textBody, note = \'\') {', '\n}');
  ok(!!send && /trustTagFor\(uid\)/.test(send), 'sendReceiptToAdmin تگ را اولِ caption می‌گذارد');
  const susSend = bodyOf('async function sendSuspectApprovalToAdmin(ctx, uid, paymentId, photoFileId, textBody) {', '\n}');
  ok(!!susSend && /trustTagFor\(uid\)/.test(susSend), 'sendSuspectApprovalToAdmin هم همان تگ را می‌گذارد');
  // کنترلِ معکوس: مسیری که فقط برای کاربرِ سالم اجرا می‌شود نباید این تگ را داشته باشد،
  // وگرنه ادعای بالا آینه‌ی خودش بود نه سنجه‌ی واقعی (بند ۶ب ریشه).
  const autoApproved = bodyOf('async function notifyAdminAutoApproved(p, user, reasonFa, overpaid = 0, expectedToman = 0) {', '\n}');
  ok(!!autoApproved && !/trustTagFor/.test(autoApproved),
    'notifyAdminAutoApproved تگ ندارد (کنترلِ معکوس: این مسیر فقط برای کاربرِ سالم اجرا می‌شود)');

  // trustTagFor خودش: بی‌اعتماد بر مشکوک اولویت دارد
  const tagFn = bodyOf('function trustTagFor(uid) {', '\n}');
  ok(!!tagFn, 'trustTagFor از سورس بریده شد');
  const runTag = (dist, susp) => new Function('isDistrusted', 'isSuspect', `
    ${tagFn}
    return trustTagFor;
  `)(() => dist, () => susp)(1);
  ok(runTag(true, true).includes('بی‌اعتماد'), 'کاربرِ هم‌بی‌اعتماد‌هم‌مشکوک ⟵ تگِ بی‌اعتماد (اولویت)');
  ok(runTag(false, true).includes('مشکوک'), 'کاربرِ فقط‌مشکوک ⟵ تگِ مشکوک');
  ok(runTag(false, false) === '', 'کاربرِ سالم ⟵ بدونِ تگ');
}

/* ═══ ۶) دو دکمه‌ی «آمده/نیومده» ═══════════════════════════════════════ */
console.log('\n▶ هندلرهای susyes/susno');
{
  const yes = bodyOf('bot.action(/^susyes:(\\d+)$/, async (ctx) => {', '\n});');
  const no = bodyOf('bot.action(/^susno:(\\d+)$/, async (ctx) => {', '\n});');
  ok(!!yes && !!no, 'هر دو هندلر از سورس بریده شدند');

  ok(/approvePayment\(pid\)/.test(yes), 'susyes از approvePayment همیشگی می‌خواند (کپیِ منطقِ پول نیست)');
  ok(/afterApproval\(p\.user_id\)/.test(yes), 'و فالِ رزروشده را مثل مسیرِ عادیِ approve ادامه می‌دهد');
  ok(/hasSuspectPending\.get\(p\.user_id\)/.test(yes) && /clearSuspect\.run\(p\.user_id\)/.test(yes),
    'susyes فقط وقتی هیچ رسیدِ مشکوکِ معلقِ دیگری نمانده برچسب را برمی‌دارد');
  ok(/isDistrusted\(p\.user_id\)/.test(yes),
    'و اگر در همین حین بی‌اعتماد شده (susno روی رسیدِ دیگر)، برچسبِ مشکوک برنمی‌گردد');

  ok(/setPaymentStatus\.run\('rejected', pid\)/.test(no), 'susno پرداخت را رد می‌کند');
  ok(!/approvePayment/.test(no) && !/clawback/.test(no),
    'و هیچ کریدیتی برنمی‌گرداند — چون از اول داده نشده بود (برخلافِ cardrev که برگشت می‌زند)');
  ok(/setDistrust\.run\(p\.user_id\)/.test(no), 'susno کاربر را دائماً بی‌اعتماد می‌کند');
  ok(/clearSuspect\.run\(p\.user_id\)/.test(no),
    'و برچسبِ موقتِ مشکوک را برمی‌دارد (جایش را برچسبِ دائمیِ بی‌اعتماد گرفته)');
}

/* ═══ ۷) گاردِ مرکزیِ callback: susyes/susno بی‌قید عبور کنند ═══════════════ */
console.log('\n▶ susyes/susno در allowlistِ گاردِ مرکزی هستند');
{
  ok(SRC.includes('susyes:\\d+|susno:\\d+'),
    'دو دکمه در allowlistِ pay_receipt (تا اگر خودِ ادمین هم‌زمان در pay_receipt باشد، گارد نگیردشان)');
}

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
