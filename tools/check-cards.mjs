// چکِ CI برای کارت‌های پرداخت (tarot، v3.122.0 — فازِ ۱ی bots/tarot/PAYMENT-V2-PLAN.md).
//
// چرا این فایل وجود دارد: از این نسخه شماره‌کارتِ هر فاکتور یک ستونِ دیتابیس است نه یک
// ثابت، و رسید فقط به ادمینِ **همان کارت** با دکمه می‌رود. سه خرابی اگر رخ دهند بی‌صدا و
// گران‌اند و هیچ‌کدام در تستِ دستی با دو کارتِ مالک دیده نمی‌شوند:
//   ۱) فاکتوری یک شماره نشان بدهد و دکمه‌ی کپی شماره‌ی دیگری کپی کند (پولِ کاربر به کارتِ
//      اشتباه).
//   ۲) رسیدِ یک کارت با دکمه‌ی اکشن به ادمینِ کارتِ دیگری برسد، یا ادمینِ کارتِ دیگر
//      بتواند رویش تأیید بزند.
//   ۳) سید دوباره اجرا شود و کارتی که مالک غیرفعال کرده برگردد.
//
// کدِ واقعی از خودِ index.js بریده و روی SQLite در-حافظه **اجرا** می‌شود، نه کپی.
import * as CA from '../bots/tarot/cards-admin.js';
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}

console.log('\n💳 کارت‌های پرداخت\n');

/* ── ۱) ساختاری: هیچ شماره‌ای جدا از کارتِ خودِ فاکتور ──────────────────────── */
console.log('ساختاری:');
ok(!/\bCARD_NUMBER\b|\bCARD_OWNER\b|\bCARD_RECIPIENT_NAME\b|\bCARD_DEST_LAST4\b/.test(CODE),
  'ثابت‌های سراسریِ کارت (CARD_NUMBER/CARD_OWNER/…) دیگر در کد نیستند');
const invoiceCalls = [...CODE.matchAll(/L\.wallet\.invoice\(([^\n]*)/g)].map((m) => m[1]);
ok(invoiceCalls.length >= 7, `همه‌ی نقاطِ رندرِ فاکتور پیدا شدند (${invoiceCalls.length})`);
ok(invoiceCalls.every((c) => /\.\.\.invoiceCardArgs\(([^)]+)\), invoicePurchaseFor\([^,]+, \1\)/.test(c)),
  'هر فاکتور کارتش را از **همان** پرداختی می‌گیرد که «بابت خرید»ش را');
ok(!/cardCopyRow\(\s*\)/.test(CODE), 'دکمه‌ی کپی هیچ‌جا بدونِ شناسه‌ی پرداخت ساخته نمی‌شود');
{
  // دکمه‌ی کپی و متنِ فاکتور باید از یک پرداخت بخوانند (خرابیِ ۱).
  const lines = CODE.split('\n');
  let pairs = 0, bad = 0;
  lines.forEach((l, i) => {
    const m = /cardCopyRow\(([^)]+)\)/.exec(l);
    if (!m || /const cardCopyRow/.test(l)) return;
    const near = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
    const inv = /invoiceCardArgs\(([^)]+)\)/.exec(near);
    pairs++; if (!inv || inv[1] !== m[1]) bad++;
  });
  ok(pairs >= 7 && bad === 0, `دکمه‌ی کپی و متنِ فاکتور از یک پرداخت‌اند (${pairs} جفت، ${bad} ناجور)`);
}
{
  const issues = [...CODE.matchAll(/issueInvoiceNo\(([^)]+)\);[^\n]*\n\s*issueInvoiceCard\(([^)]+)\);/g)];
  const allNo = [...CODE.matchAll(/^\s*issueInvoiceNo\(/gm)].length;
  ok(allNo >= 3 && issues.length === allNo && issues.every((m) => m[1] === m[2]),
    `هر صدورِ فاکتور همان لحظه کارت می‌گیرد (${issues.length}/${allNo})`);
}
ok(!/for \(const adminId of ADMIN_IDS\)/.test(CODE), 'هیچ پیامِ رسیدی دیگر کورکورانه به همه‌ی ADMIN_IDS نمی‌رود');
ok(/const cur = cardOfPayment\(p\);/.test(CODE) && /return \{ recipient: cur\.holder, dest_last4: cur\.number\.slice\(-4\) \};/.test(CODE)
  && /\.\.\.receiptExpectedCards\(p\)/.test(CODE),
  'ایجنتِ رسید گیرنده و چهار رقمِ آخر را از کارتِ همین فاکتور می‌گیرد');
for (const n of ['approve', 'reject', 'duplicate', 'dupyes', 'dupno', 'cardsms', 'cardrev', 'cardrevno', 'susyes', 'susno']) {
  const head = `bot.action(/^${n}:(\\d+)$/, async (ctx) => {\n  if (!canActOnPayment(ctx.from.id, parseInt(ctx.match[1], 10)))`;
  ok(CODE.includes(head), `«${n}:» اجازه را per پرداخت می‌سنجد (canActOnPayment)`);
}
ok((CODE.match(/notifyOwnerAction\(ctx\.from\.id/g) || []).length === 7,
  'هر هفت اکشنِ تغییردهنده به مالک خبر می‌دهد');

/* ── ۲) رفتاری: همان کدِ index.js روی SQLite ────────────────────────────────── */
console.log('\nرفتاری:');
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const readers = region('const LEGACY_CARD = Object.freeze', 'const invoiceCardArgs =', { includeTo: false });
const routing = region('const LEGACY_ADMINS_FULL', '\n// note: هشدارِ اختیاری', { includeTo: false });
const copyRow = /const cardCopyRow = [^\n]+/.exec(SRC)?.[0] || '';

const OWNER = 111, SECOND = 222, OTHER = 333;
const errs = [];
function boot({ legacy = false, failTo = null } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    status TEXT DEFAULT 'pending', receipt_file_id TEXT, invoice_no INTEGER DEFAULT 0)`);
  const sent = [];
  const bot = { telegram: {
    sendMessage: async (to, text, extra = {}) => { if (to === failTo) throw new Error('403'); sent.push({ to, text, extra }); return { message_id: sent.length }; },
    sendPhoto: async (to, file, extra = {}) => { if (to === failTo) throw new Error('403'); sent.push({ to, file, text: extra.caption, extra }); return { message_id: sent.length }; },
  } };
  const ADMIN_IDS = [OWNER, SECOND];
  const env = { CA, db, OWNER_ID: OWNER, ADMIN_IDS, isAdmin: (u) => ADMIN_IDS.includes(u), bot,
    logErr: (...a) => errs.push(a.join(' ')), invoiceNoOf: (p) => p.invoice_no || p.id,
    // 🔄 فازِ ۲: چرخش واقعاً اجرا می‌شود (نه اینکه با ReferenceError بی‌صدا به فالبک بیفتد).
    CARD_ROTATION_ENABLED: true, starsRail: false, log: () => {}, track: () => {} };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `${readers}\n${copyRow}\n${schema}\n${(legacy ? routing.replace('const LEGACY_ADMINS_FULL = false', 'const LEGACY_ADMINS_FULL = true') : routing)}
    const invoiceCardArgs = (pid) => { const c = cardOfPid(pid); return [c.number, cardOwnerLine(c)]; };
    return { LEGACY_CARD, defaultInvoiceCard, cardOfPayment, cardOfPid, issueInvoiceCard, cardOwnerLine,
      invoiceCardArgs, cardCopyRow, receiptRecipients, sendToReceiptRecipients, canActOnPayment, notifyOwnerAction };`;
  const f = new Function(...Object.keys(env), body);
  return { ...f(...Object.values(env)), db, sent, env };
}

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ کارت‌ها شکست خورد:', e.message); }
if (h) {
  const { db } = h;
  const cards = db.prepare('SELECT * FROM cards ORDER BY id').all();
  ok(cards.length === 2, 'سید دقیقاً دو کارت می‌سازد');
  ok(cards[0].number === '6219861904145405' && cards[0].kind === 'regular' && cards[0].admin_id === OWNER,
    'کارتِ ۱ = همان کارتِ عادیِ قبلی، ادمین = مالک');
  ok(cards[1].number === '5022291612282234' && cards[1].kind === 'white' && cards[1].holder === 'علیرضا اولیاء'
    && cards[1].bank === 'بانک پاسارگاد' && cards[1].admin_id === OWNER, 'کارتِ ۲ = کارتِ سفیدِ پاسارگاد، ادمین = مالک');
  ok(h.cardOwnerLine(cards[0]) === 'علیرضا اولیا — بلوبانک', 'خطِ زیرِ شماره‌ی کارتِ ۱ بیت‌به‌بیت همان CARD_OWNERِ قبلی است');

  // سید یک‌باره است: کارتِ غیرفعال‌شده برنمی‌گردد و کارت تکرار نمی‌شود (خرابیِ ۳).
  db.prepare("UPDATE cards SET active=0 WHERE id=1").run();
  new Function('db', 'OWNER_ID', 'SEED_CARDS_UNUSED', schema.replace(/^[\s\S]*?(const LEGACY_CARD_NUMBER)/, '$1')
    .replace('const LEGACY_CARD_NUMBER = LEGACY_CARD.number;', "const LEGACY_CARD_NUMBER = '6219861904145405';"))(db, OWNER, 0);
  ok(db.prepare('SELECT COUNT(*) n FROM cards').get().n === 2, 'اجرای دوباره‌ی سید کارتِ تازه نمی‌سازد');
  ok(db.prepare('SELECT active FROM cards WHERE id=1').get().active === 0, 'کارتی که مالک غیرفعال کرده بعد از ری‌استارت غیرفعال می‌ماند');
  db.prepare("UPDATE cards SET active=1 WHERE id=1").run();

  // فاکتورِ قبل از این نسخه (card_id=0) همان شماره‌ی قدیمی را نشان می‌دهد.
  const legacyPid = Number(db.prepare('INSERT INTO payments (user_id, amount) VALUES (7, 50000)').run().lastInsertRowid);
  ok(h.cardOfPid(legacyPid).number === '6219861904145405', 'فاکتورِ قدیمیِ بی‌کارت ⟵ همان کارتِ ۱');
  ok(h.cardCopyRow(legacyPid)[0].copy_text.text === '6219861904145405', 'دکمه‌ی کپیِ فاکتورِ قدیمی همان شماره را کپی می‌کند');

  // صدور: کارت یک‌بار و اتمیک.
  const pid = Number(db.prepare('INSERT INTO payments (user_id, amount) VALUES (8, 60000)').run().lastInsertRowid);
  h.issueInvoiceCard(pid);
  ok(db.prepare('SELECT card_id FROM payments WHERE id=?').get(pid).card_id === 1, 'فاکتورِ تازه کارتِ عادیِ پیش‌فرض را می‌گیرد (نه سفید)');
  ok(!errs.some((e) => /issueInvoiceCard/.test(e)) && db.prepare('SELECT via FROM card_assign WHERE user_id=8').get()?.via === 'rotation',
    'کارت از مسیرِ چرخشِ فازِ ۲ آمد، نه از فالبکِ خطا');
  db.prepare("UPDATE cards SET sort=0 WHERE id=2").run();
  db.prepare("UPDATE cards SET kind='regular' WHERE id=2").run();
  h.issueInvoiceCard(pid);
  ok(db.prepare('SELECT card_id FROM payments WHERE id=?').get(pid).card_id === 1, 'صدورِ دوباره کارتِ فاکتور را عوض نمی‌کند');
  db.prepare("UPDATE cards SET sort=2, kind='white' WHERE id=2").run();

  // کارتِ فاکتور حتی بعد از غیرفعال‌شدن همان می‌ماند.
  const pidW = Number(db.prepare('INSERT INTO payments (user_id, amount, card_id) VALUES (9, 30000, 2)').run().lastInsertRowid);
  db.prepare("UPDATE cards SET active=0 WHERE id=2").run();
  const [num, owner] = h.invoiceCardArgs(pidW);
  ok(num === '5022291612282234' && owner === 'علیرضا اولیاء — بانک پاسارگاد', 'کارتِ غیرفعال‌شده روی فاکتوری که با آن صادر شده می‌ماند');
  ok(h.cardCopyRow(pidW)[0].copy_text.text === num, 'دکمه‌ی کپی دقیقاً شماره‌ی روی همان فاکتور را کپی می‌کند');
  db.prepare("UPDATE cards SET active=1 WHERE id=2").run();

  // مسیریابی (v3.123.0، تصمیمِ مالک): کارتِ مالک ⟵ فقط مالک یک پیامِ کامل؛ ادمینِ بی‌کارت هیچ.
  ok(/const LEGACY_ADMINS_FULL = false;/.test(CODE), 'پرچمِ ادمین‌های بی‌کارت خاموش است (تصمیمِ مالک)');
  const r1 = h.receiptRecipients(db.prepare('SELECT * FROM payments WHERE id=?').get(pid));
  ok(JSON.stringify(r1) === JSON.stringify([{ id: OWNER, full: true }]),
    'کارتِ مالک: مالک یک پیامِ کامل (نه دو پیام) و ادمینِ بی‌کارت هیچ پیامی نمی‌گیرد');

  // کارتی با ادمینِ دیگر.
  db.prepare("UPDATE cards SET admin_id=? WHERE id=2").run(SECOND);
  const pSecond = db.prepare('SELECT * FROM payments WHERE id=?').get(pidW);
  const r2 = h.receiptRecipients(pSecond);
  ok(JSON.stringify(r2) === JSON.stringify([{ id: SECOND, full: true }, { id: OWNER, full: false }]),
    'کارتِ ادمینِ دیگر: او پیامِ کامل، مالک کپیِ اطلاعاتی، و بس');
  const r3 = h.receiptRecipients(db.prepare('SELECT * FROM payments WHERE id=?').get(pid));
  ok(JSON.stringify(r3) === JSON.stringify([{ id: OWNER, full: true }]),
    'ادمینی که ادمینِ یک کارت شد دیگر رسیدِ کارت‌های دیگر را با دکمه نمی‌گیرد');

  // ارسال: کپیِ مالک بی‌دکمه و با سرتیتر (خرابیِ ۲).
  h.sent.length = 0;
  const kb = { inline_keyboard: [[{ text: 'ok', callback_data: `approve:${pidW}` }]] };
  const first = await h.sendToReceiptRecipients(pSecond, { caption: 'CAP', photoFileId: 'F', kb });
  const toSecond = h.sent.find((m) => m.to === SECOND), toOwner = h.sent.find((m) => m.to === OWNER);
  ok(h.sent.length === 2, 'دقیقاً دو پیام رفت');
  ok(toSecond?.extra?.reply_markup === kb && toSecond.text === 'CAP', 'ادمینِ کارت پیامِ کامل با دکمه‌ها گرفت');
  ok(toOwner && !toOwner.extra.reply_markup && toOwner.text.startsWith('ℹ️ کپیِ اطلاعاتی') && toOwner.text.endsWith('CAP'),
    'مالک کپیِ اطلاعاتیِ **بی‌دکمه** با سرتیتر گرفت');
  ok(first?.message_id === 1, 'شناسه‌ی پیامِ ادمینِ کارت (نه کپی) برگردانده می‌شود');
  h.sent.length = 0;
  await h.sendToReceiptRecipients(pSecond, { caption: 'X'.repeat(1100), photoFileId: 'F', kb });
  ok(h.sent.find((m) => m.to === OWNER)?.text.length <= 1024, 'کپیِ مالک از سقفِ ۱۰۲۴ نویسه‌ی کپشن رد نمی‌شود');

  // اجازه‌ی اکشن.
  ok(h.canActOnPayment(SECOND, pidW) && h.canActOnPayment(OWNER, pidW), 'ادمینِ کارت و ادمینِ ربات روی رسیدِ این کارت اجازه دارند');
  ok(!h.canActOnPayment(OTHER, pidW), 'کاربرِ عادی اجازه ندارد');
  db.prepare("UPDATE cards SET admin_id=? WHERE id=2").run(OTHER);
  ok(h.canActOnPayment(OTHER, pidW) && !h.canActOnPayment(OTHER, pid), 'ادمینِ کارتِ غیرِربات فقط روی رسیدِ کارتِ خودش اجازه دارد');

  // خبر به مالک.
  h.sent.length = 0;
  h.notifyOwnerAction(OTHER, pidW, '✅ تأیید'); h.notifyOwnerAction(OWNER, pidW, '✅ تأیید');
  await new Promise((r) => setImmediate(r));
  ok(h.sent.length === 1 && h.sent[0].to === OWNER && h.sent[0].text.includes('✅ تأیید'), 'اکشنِ غیرِمالک به مالک خبر داده می‌شود، اکشنِ خودِ مالک نه');

  // رول‌بکِ پرچم: روشن ⟵ ادمینِ بی‌کارت دوباره همان پیامِ کاملِ v3.121.0 را می‌گیرد.
  const h2 = boot({ legacy: true });
  const p2 = Number(h2.db.prepare('INSERT INTO payments (user_id, amount) VALUES (1, 1)').run().lastInsertRowid);
  h2.issueInvoiceCard(p2);
  ok(JSON.stringify(h2.receiptRecipients(h2.db.prepare('SELECT * FROM payments WHERE id=?').get(p2))) === JSON.stringify([{ id: OWNER, full: true }, { id: SECOND, full: true }]),
    'رول‌بک: LEGACY_ADMINS_FULL=true ⟵ ادمینِ بی‌کارت دوباره پیامِ کامل می‌گیرد');

  // تورِ ایمنی: پیامِ کامل به ادمینِ کارت نرسید ⟵ نسخه‌ی کامل با دکمه‌ها به مالک.
  const h3 = boot({ failTo: SECOND });
  const p3 = Number(h3.db.prepare('INSERT INTO payments (user_id, amount, card_id) VALUES (1, 1, 2)').run().lastInsertRowid);
  h3.db.prepare('UPDATE cards SET admin_id=? WHERE id=2').run(SECOND);
  const kb3 = { inline_keyboard: [[{ text: 'ok', callback_data: `approve:${p3}` }]] };
  const f3 = await h3.sendToReceiptRecipients(h3.db.prepare('SELECT * FROM payments WHERE id=?').get(p3), { caption: 'CAP', photoFileId: 'F', kb: kb3 });
  const ownerFull = h3.sent.filter((m) => m.to === OWNER && m.extra.reply_markup === kb3);
  ok(ownerFull.length === 1 && ownerFull[0].text.includes('⚠️') && ownerFull[0].text.endsWith('CAP'),
    'ادمینِ کارت پیام را نگرفت ⟵ مالک نسخه‌ی **کامل با دکمه‌ها** گرفت (رسید هرگز بی‌تصمیم‌گیرنده نمی‌ماند)');
  ok(!!f3 && f3.message_id === h3.sent.indexOf(ownerFull[0]) + 1, 'شناسه‌ی همان پیامِ کاملِ مالک برگردانده می‌شود');
  // کنترلِ مثبت: وقتی ادمینِ کارت پیام را گرفت، مالک نسخه‌ی دکمه‌دار نمی‌گیرد.
  h3.sent.length = 0;
  const h4 = boot();
  const p4 = Number(h4.db.prepare('INSERT INTO payments (user_id, amount, card_id) VALUES (1, 1, 2)').run().lastInsertRowid);
  h4.db.prepare('UPDATE cards SET admin_id=? WHERE id=2').run(SECOND);
  await h4.sendToReceiptRecipients(h4.db.prepare('SELECT * FROM payments WHERE id=?').get(p4), { caption: 'CAP', photoFileId: 'F', kb: kb3 });
  ok(!h4.sent.some((m) => m.to === OWNER && m.extra.reply_markup), 'ادمینِ کارت پیام را گرفت ⟵ مالک فقط کپیِ بی‌دکمه (نه نسخه‌ی دوم)');
}

console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
