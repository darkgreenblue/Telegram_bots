// چکِ CI برای «⏳ تأییدِ کُندِ بسته‌های معمولی + 🟡 رسیدِ دوباره وسطِ صبر ⟵ تگِ مشکوک» (tarot، v3.131.0).
//
// خواسته‌ی مالک (۱۴۰۵/۰۷/۰۴): تأییدِ خودکارِ بسته‌ی معمولی بعد از ۵ تا ۱۰ دقیقه‌ی تصادفی؛ هر رسیدِ دوباره در این
// فاصله ⟵ تگِ مشکوکِ همیشگی (رسیدها دستی تا ادمین «آمده» بزند)؛ و رسیدِ تکراریِ بی‌صبری الماسِ الکی نگیرد.
// خرابی‌های بی‌صدا که این‌جا گرفته می‌شوند:
//   • تصمیم با ری‌استارت گم شود (زمان‌بندی باید در DB باشد، نه `sleep`).
//   • در فاصله‌ی صبر کاربر فاکتور را لغو کند و پولِ رسیده بی‌اعتبار بماند (باید `waiting_review` شود).
//   • یک تصمیم دو بار اجرا شود (دو اعتبار)، یا بعد از تصمیمِ ادمین هم اجرا شود.
//   • رسیدِ دوباره مشکوک نکند (همان تگِ مشکوکِ همیشگی؛ هیچ برچسبِ ماندگارِ تازه‌ای نیست).
//   • تأییدِ دیرهنگام فلوی تازه‌ی کاربر (فاکتورِ دیگر، نوشتنِ سؤال) را یتیم کند.
// کدِ واقعیِ index.js بریده و روی SQLite اجرا می‌شود.
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const Database = createRequire(path.resolve('bots/tarot/package.json'))('better-sqlite3');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };
const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}
const sqlOf = (name) => {
  const m = SRC.match(new RegExp(`\\n\\s*${name}: db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\)`));
  return m ? m[2] : null;
};
const OWNER = 111, U = 9;

console.log('\n⏳ تأییدِ کُند و رسیدِ دوباره\n');
const body = region('/* 💰 تأیید یا اصلاحِ کم‌پرداختِ خودکار', '\nasync function processReceipt', { includeTo: false });
const helper = region('const isPriorityPack =', 'const slowApproveDelaySec = () => randomInt(300, 601);');
const SQL = { adjust: sqlOf('adjustPaymentAmount'), suspect: sqlOf('setSuspect'), clear: sqlOf('clearSuspect') };
ok(SQL.adjust && SQL.suspect && SQL.clear, 'SQLهای واقعی از سورس خوانده شدند');

function boot({ file = ':memory:', flag = true, stars = false, delay = 420, state = 'idle', session = {} } = {}) {
  const db = new Database(file);
  db.exec(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, original_amount INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', pkg TEXT, discount_code_id INTEGER, receipt_file_id TEXT, adjust_note TEXT,
      auto_decide_at INTEGER, auto_decision TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS users (telegram_id INTEGER PRIMARY KEY, pay_suspect INTEGER NOT NULL DEFAULT 0,
      pay_distrust INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO users (telegram_id) VALUES (${U});`);
  const log = { approve: 0, sent: [], pushed: [], toAdmin: 0, suspectAdmin: 0, notify: 0, after: 0, timers: [], errs: [], events: [] };
  const user = (u) => db.prepare('SELECT * FROM users WHERE telegram_id=?').get(u) || {};
  const env = {
    db, SLOW_APPROVE_ENABLED: flag, starsRail: stars, MIN_RECHARGE: 10000,
    randomInt: () => delay, isDistrusted: (u) => !!user(u).pay_distrust, isSuspect: (u) => !!user(u).pay_suspect,
    stmts: {
      getPayment: db.prepare('SELECT * FROM payments WHERE id=?'),
      adjustPaymentAmount: db.prepare(SQL.adjust), setSuspect: db.prepare(SQL.suspect),
    },
    approvePayment: (pid) => {
      const r = db.prepare("UPDATE payments SET status='approved' WHERE id=? AND status IN ('pending','waiting_review')").run(pid);
      if (!r.changes) return null;
      log.approve++;
      return { creditAmount: 10, bonus: 0 };
    },
    approvedMsg: () => 'APPROVED', getUser: () => ({}), getBalance: () => 5, isAdmin: () => false,
    notifyAdminAutoApproved: async (...a) => { log.notify++; log.notifyArgs = a; }, notifyAdminAuto: async () => { log.notify++; },
    creditedReceiptKb: () => ({}), L: { wallet: { underpaidApproved: () => 'UNDERPAID_OK' } },
    sendReceiptToAdmin: async () => { log.toAdmin++; }, sendSuspectApprovalToAdmin: async () => { log.suspectAdmin++; },
    track: (_d, u, e, p) => log.events.push({ e, p }), log: () => {}, logErr: (...a) => log.errs.push(a.join(' ')),
    logPush: (_d, u, t) => log.pushed.push(t),
    bot: { telegram: { sendMessage: async (u, t) => { log.sent.push({ u, t }); } } },
    withLang: (_l, fn) => fn(), langOf: () => 'fa',
    getState: () => state, getSession: () => session, afterApproval: async () => { log.after++; },
    setTimeout: (fn, ms) => { log.timers.push(ms); },
  };
  // پرچم از env تزریق می‌شود تا هر دو حالت سنجیده شود؛ مقدارِ منتشرشده جدا در «ساختاری» پین شده.
  const fn = new Function(...Object.keys(env), `${helper.replace('const SLOW_APPROVE_ENABLED = true;', '')}\n${body}
    return { applyAutoCredit, slowApproveOn, scheduleAutoDecision, runDueAutoDecisions, executeScheduledDecision,
      afterDelayedApproval, flagResendDuringWait, isPriorityPack, slowApproveDelaySec };`);
  const h = { ...fn(...Object.values(env)), db, log };
  h.pay = (o = {}) => Number(db.prepare('INSERT INTO payments (user_id, amount, original_amount, status, pkg, discount_code_id, receipt_file_id) VALUES (?,?,?,?,?,?,?)')
    .run(o.uid || U, o.amount || 20000, o.amount || 20000, o.status || 'pending', o.pkg || null, o.disc || null, 'F').lastInsertRowid);
  h.row = (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  h.due = (id) => db.prepare('UPDATE payments SET auto_decide_at=unixepoch()-1 WHERE id=?').run(id);
  return h;
}
const A = { action: 'approve', overpaid: 0, reason_fa: 'ok' };

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کد شکست خورد:', e.stack); }
if (h) {
  console.log('کدام رسید کُند می‌شود:');
  const p0 = h.row(h.pay());
  ok(h.slowApproveOn(p0, U, A) && h.slowApproveOn(p0, U, { action: 'underpaid' }), 'بسته‌ی معمولی/مبلغِ دلخواه: تأیید و کم‌پرداخت کُند');
  ok(!h.slowApproveOn({ ...p0, pkg: 'gold' }, U, A) && !h.slowApproveOn({ ...p0, pkg: 'magic' }, U, A), 'ویژه و جادویی همان مسیرِ سریع');
  ok(!h.slowApproveOn(p0, U, { action: 'reject' }) && !h.slowApproveOn(p0, U, { action: 'review' }), 'رد و ارجاع به ادمین کُند نمی‌شوند');
  ok(!boot({ flag: false }).slowApproveOn(p0, U, A) && !boot({ stars: true }).slowApproveOn(p0, U, A), 'پرچمِ خاموش و ریلِ استارز ⟵ هیچ');
  ok(h.slowApproveDelaySec() === 420 && /randomInt\(300, 601\)/.test(helper), 'بازه‌ی ۵ تا ۱۰ دقیقه (۳۰۰ تا ۶۰۰ ثانیه، سقف شامل)');

  console.log('\nزمان‌بندی و اجرا:');
  const a = h.pay();
  ok(h.scheduleAutoDecision(h.row(a), A, 20000, null) === true, 'زمان‌بندی شد');
  const ra = h.row(a);
  const now = Math.floor(Date.now() / 1000);
  ok(ra.status === 'waiting_review' && Math.abs(ra.auto_decide_at - (now + 420)) <= 2, 'پرداخت waiting_review شد (کاربر دیگر لغوش نمی‌کند) و زمانش ۴۲۰ث بعد');
  ok(JSON.parse(ra.auto_decision).action === 'approve' && h.log.timers[0] === 421_500, 'تصمیم در DB و یک تایمرِ دقیق');
  ok(h.log.events.some((e) => e.e === 'receipt_decision_scheduled' && e.p.delay_s === 420), 'رویدادِ receipt_decision_scheduled');
  await h.runDueAutoDecisions();
  ok(h.log.approve === 0 && h.row(a).status === 'waiting_review', 'قبل از موعد هیچ کاری نمی‌کند');
  h.due(a);
  await Promise.all([h.runDueAutoDecisions(), h.runDueAutoDecisions()]);
  await h.runDueAutoDecisions();
  ok(h.log.approve === 1 && h.row(a).status === 'approved' && h.row(a).auto_decide_at === null, 'سرِ موعد دقیقاً یک بار تأیید شد (هم‌زمان هم)');
  ok(h.log.sent.length === 1 && h.log.sent[0].u === U && h.log.pushed.length === 1 && h.log.notify === 1 && h.log.after === 1,
    'پیامِ تأیید به کاربر + logPush (تایم‌لاین) + خبرِ ادمین + ادامه‌ی فال');
  ok(h.scheduleAutoDecision(h.row(a), A, 20000, null) === false, 'پرداختِ نهایی‌شده دوباره زمان‌بندی نمی‌شود');

  // 📋 رسیدِ متنی (فاکتور #۱۴۲۹): متنی که ایجنت خوانده باید به پیامِ ادمین برسد، وگرنه ادمین پیامی بی‌رسید می‌بیند.
  const t = h.pay();
  h.db.prepare('UPDATE payments SET receipt_file_id=NULL WHERE id=?').run(t);
  h.scheduleAutoDecision(h.row(t), A, 20000, 'متنِ رسیدِ کپی‌شده');
  h.due(t);
  await h.runDueAutoDecisions();
  ok(h.log.notifyArgs?.[5] === 'متنِ رسیدِ کپی‌شده', 'تأییدِ زمان‌بندی‌شده‌ی رسیدِ متنی ⟵ متنِ رسید به پیامِ ادمین می‌رسد');
  const tailSrc = /const receiptTextTail = [^\n]+/.exec(SRC)?.[0] || '';
  const tail = new Function(`${tailSrc}\nreturn receiptTextTail;`)();
  ok(/📋 رسیدِ متنی/.test(tail('abc', null)) && tail('abc', 'F') === '' && tail(null, null) === '', 'دُمِ متن فقط برای رسیدِ بی‌عکس');
  ok(/caption \+= receiptTextTail\(textBody, p\.receipt_file_id\)/.test(SRC) && /\+ receiptTextTail\(textBody, photoFileId\)/.test(SRC)
    && /applyAutoCredit\(\{ uid, paymentId, decision, amountToman, photoFileId, textBody,/.test(SRC),
    'هر سه پیامِ خودکار (تأیید، اصلاحِ کم‌پرداخت، رد) و مسیرِ فوری متن را می‌گیرند');

  const b = h.pay();
  h.scheduleAutoDecision(h.row(b), A, 20000, null);
  h.db.prepare("UPDATE payments SET status='rejected' WHERE id=?").run(b);   // ادمین زودتر رد کرد
  h.due(b);
  const before = h.log.sent.length;
  await h.runDueAutoDecisions();
  ok(h.log.sent.length === before && h.log.approve === 2, 'ادمین زودتر تصمیم گرفت ⟵ هیچ پیام و هیچ اعتباری');

  console.log('\nرسیدِ دوباره وسطِ صبر:');
  const hs = boot();
  const c = hs.pay();
  hs.scheduleAutoDecision(hs.row(c), A, 20000, null);
  ok(hs.flagResendDuringWait(U) === true, 'رسیدِ دوباره شناخته شد');
  ok(hs.db.prepare('SELECT pay_suspect FROM users WHERE telegram_id=?').get(U).pay_suspect === 1, 'کاربر همان تگِ مشکوکِ همیشگی را گرفت');
  ok(!/suspect_sticky|setSuspectSticky/.test(SRC), 'هیچ برچسبِ «مشکوکِ ماندگارِ» تازه‌ای نیست (چرخه‌ی مشکوک ⟵ بی‌اعتماد همان قبلی)');
  hs.due(c);
  await hs.runDueAutoDecisions();
  ok(hs.log.approve === 0 && hs.log.suspectAdmin === 1 && hs.log.sent.length === 0, 'زمان‌بندیِ قبلی هم دیگر خودکار تأیید نمی‌شود ⟵ ادمین («آمده/نیومده»)، بدونِ الماس');
  ok(!boot().flagResendDuringWait(U), 'بدونِ تأییدِ در راه، رسید مشکوک نمی‌کند');
  ok(hs.log.events.some((e) => e.e === 'receipt_resent_during_wait'), 'رویدادِ receipt_resent_during_wait');

  console.log('\nمسیرهای دیگر:');
  const hu = boot();
  const d = hu.pay({ amount: 20000 });
  hu.scheduleAutoDecision(hu.row(d), { action: 'underpaid', paid: 15000 }, 20000, null);
  hu.due(d);
  await hu.runDueAutoDecisions();
  ok(hu.row(d).amount === 15000 && hu.row(d).status === 'approved' && hu.log.sent[0]?.t === 'UNDERPAID_OK', 'کم‌پرداختِ امن ⟵ اصلاحِ فاکتور و تأیید (همان applyAutoCredit)');
  const e2 = hu.pay({ pkg: 'basic' });
  hu.scheduleAutoDecision(hu.row(e2), { action: 'underpaid', paid: 15000 }, 20000, null);
  hu.due(e2);
  await hu.runDueAutoDecisions();
  ok(hu.row(e2).status === 'waiting_review' && hu.log.toAdmin === 1, 'کم‌پرداختِ بسته ⟵ ادمین');
  const f = hu.pay();
  hu.scheduleAutoDecision(hu.row(f), A, 20000, null);
  hu.db.prepare("UPDATE payments SET auto_decision='{bad' WHERE id=?").run(f);
  hu.due(f);
  await hu.runDueAutoDecisions();
  ok(hu.row(f).status === 'waiting_review' && hu.log.toAdmin === 2, 'تصمیمِ ناخوانا ⟵ ادمین (پول رسیده، حدس نه)');
  hu.db.prepare('UPDATE users SET pay_distrust=1 WHERE telegram_id=?').run(U);
  const g = hu.pay();
  hu.scheduleAutoDecision(hu.row(g), A, 20000, null);
  hu.due(g);
  await hu.runDueAutoDecisions();
  ok(hu.row(g).status === 'waiting_review' && hu.log.toAdmin === 3, 'در این فاصله بی‌اعتماد شد ⟵ ادمین');

  const hx = boot({ state: 'ask_question' });
  await hx.afterDelayedApproval(U, 1);
  const hy = boot({ state: 'pay_receipt', session: { paymentId: 77 } });
  await hy.afterDelayedApproval(U, 1);
  const hz = boot({ state: 'confirm_pay', session: {} });
  await hz.afterDelayedApproval(U, 1);
  ok(hx.log.after === 0 && hy.log.after === 0 && hz.log.after === 1, 'ادامه‌ی خودکار فقط وقتی کاربر وسطِ کارِ دیگری نیست (سؤال‌نویسی یا فاکتورِ دیگر یتیم نمی‌شود)');

  // ادمین زودتر تصمیم گرفت، و کاربر هم مشکوک است ⟵ نباید پیامِ «آمده/نیومده»ی بی‌جا برای پرداختِ بسته‌شده برود.
  const hq = boot();
  const q1 = hq.pay();
  hq.scheduleAutoDecision(hq.row(q1), A, 20000, null);
  hq.flagResendDuringWait(U);
  hq.db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(q1);
  hq.due(q1);
  await hq.runDueAutoDecisions();
  ok(hq.log.suspectAdmin === 0 && hq.log.toAdmin === 0, 'پرداختِ از قبل بسته‌شده ⟵ هیچ پیامی به ادمین (حتی برای مشکوک)');

  console.log('\nری‌استارت:');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slow-approve-'));
  const file = path.join(dir, 'b.db');
  const h1 = boot({ file });
  const k = h1.pay();
  h1.scheduleAutoDecision(h1.row(k), A, 20000, null);
  h1.due(k);
  h1.db.close();
  const h2 = boot({ file });   // پروسه‌ی تازه، هیچ تایمری در حافظه نیست
  await h2.runDueAutoDecisions();
  ok(h2.row(k).status === 'approved' && h2.log.approve === 1, 'تصمیمِ زمان‌بندی‌شده بعد از ری‌استارت اجرا شد (از DB، نه حافظه)');
  // دو پروسه روی یک فایل (مثلاً دیپلویِ هم‌پوشان): هر تصمیم دقیقاً یک بار، حتی در مسیرِ ادمین.
  h2.db.prepare('UPDATE users SET pay_suspect=1 WHERE telegram_id=?').run(U);
  const m1 = h2.pay(), m2 = h2.pay();
  h2.scheduleAutoDecision(h2.row(m1), A, 20000, null);
  h2.scheduleAutoDecision(h2.row(m2), A, 20000, null);
  h2.due(m1); h2.due(m2);
  const h3 = boot({ file });
  const first = h2.runDueAutoDecisions();   // تا اولین await جلو می‌رود و هر دو ردیف را برداشته
  await h3.runDueAutoDecisions();            // پروسه‌ی دوم وسطِ کار
  await first;
  ok(h2.log.suspectAdmin + h3.log.suspectAdmin === 2, `دو پروسه‌ی هم‌زمان ⟵ هر پرداخت دقیقاً یک پیام به ادمین (شد ${h2.log.suspectAdmin + h3.log.suspectAdmin})`);
  h2.db.close(); h3.db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nساختاری:');
{
  const pr = region('async function processReceipt(', '\n}\n');
  ok(pr.indexOf('flagResendDuringWait(uid)') > 0 && pr.indexOf('flagResendDuringWait(uid)') < pr.indexOf('suspectTrigger(uid'), 'processReceipt: رسیدِ دوباره قبل از هر تصمیمی تشخیص داده می‌شود');
  ok(pr.indexOf('scheduleAutoDecision(') > 0 && pr.indexOf('scheduleAutoDecision(') < pr.indexOf('await sleep(receiptDecisionDelayMs(p))'),
    'زمان‌بندی قبل از sleepِ کوتاهِ قبلی (مسیرِ کُند هرگز داخلِ هندلر نمی‌خوابد)');
  ok(/if \(flagResendDuringWait\(uid\)\) return ctx\.reply\(L\.wallet\.receiptSent\)/.test(SRC), 'عکسِ بی‌فاکتور وسطِ صبر ⟵ مشکوک + «رسیدت رسید» (نه «فاکتوری نداری»)');
  ok(/setInterval\(\(\) => \{ runDueAutoDecisions\(\)/.test(SRC) && /runDueAutoDecisions\(\)\.catch\(\(e\) => logErr\('slow approve boot:'/.test(SRC), 'اجرای بوت + جاروی ۳۰ثانیه‌ای از onLaunch');
  ok(/\['pending'\]\.includes\(p\.status\)\) stmts\.setPaymentStatus\.run\('canceled'/.test(SRC), 'انصرافِ کاربر فقط روی pending (پرداختِ در صف لغوشدنی نیست)');
  ok(/const SLOW_APPROVE_ENABLED = true;/.test(SRC), 'پرچمِ رول‌بک روشن منتشر شده');
  ok(/ALTER TABLE payments ADD COLUMN auto_decide_at INTEGER/.test(SRC), 'ستون‌ها افزایشی‌اند');
}

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
