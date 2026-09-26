// چکِ CI برای چرخشِ روزانه‌ی کارت و سقفِ روزانه (tarot، v3.124.0 — فازِ ۲ِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// تصمیم‌های مالک (۱۴۰۵/۰۷/۰۴) که این فایل قفل می‌کند:
//   • روزِ کارت نیمه‌شب نیست، ۰۶:۰۰ تهران است (کم‌کارترین ساعت).
//   • هر روز: اولین کاربر (لحظه‌ی **صدورِ فاکتور**) کارتِ عادیِ اول، دومی کارتِ بعدی، به نوبت؛
//     هر کاربر تا آخرِ همان روز روی کارتِ خودش می‌ماند؛ روزِ بعد از کارتِ اول.
//   • سقفِ روزانه = تعدادِ پرداخت‌های **تأییدشده** روی کارت، صفر در همان مرزِ ۰۶:۰۰.
//   • کارتِ پرشده ⟵ کارتِ عادیِ بعدی؛ همه‌ی عادی‌ها پر ⟵ کارتِ سفید.
// خرابی‌هایی که این‌جا گرفته می‌شوند همه بی‌صدا و پولی‌اند: کارتی که از سقف رد شود (حسابِ
// بانکی بسته می‌شود)، کاربری که وسطِ روز کارتش عوض شود، یا روزی که از کارتِ اول شروع نشود.
//
// کدِ واقعی از index.js بریده و روی SQLite اجرا می‌شود؛ منطقِ انتخاب همان `CA.pickDailyCard`.
import * as CA from '../bots/tarot/cards-admin.js';
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}

console.log('\n🔄 چرخشِ روزانه و سقفِ کارت\n');

/* ── ۱) مرزِ روز: ۰۶:۰۰ تهران = ۰۲:۳۰ UTC ──────────────────────────────────── */
console.log('مرزِ روز:');
const T = (iso) => Date.parse(iso);
ok(CA.CARD_DAY_BOUNDARY_H === 6 && CA.CARD_TZ === 'Asia/Tehran', 'مرز ۶ صبحِ تهران است');
ok(CA.cardDay(T('2026-09-26T02:29:59Z')) === '2026-09-25', '۰۵:۵۹:۵۹ تهران هنوز روزِ قبل است');
ok(CA.cardDay(T('2026-09-26T02:30:00Z')) === '2026-09-26', '۰۶:۰۰ تهران روزِ تازه است');
ok(CA.cardDay(T('2026-09-25T20:30:00Z')) === '2026-09-25', 'نیمه‌شبِ تهران مرز **نیست** (همان روزِ کارت)');
ok(CA.cardDay(T('2026-09-26T19:00:00Z')) === '2026-09-26', 'ساعتِ ۲۲:۳۰ تهران روزِ کارتِ همان روز است');

/* ── ۲) تابعِ خالصِ انتخاب ─────────────────────────────────────────────────── */
console.log('\nانتخاب (CA.pickDailyCard):');
const C = (id, kind, sort, extra = {}) => ({ id, kind, sort, active: 1, daily_cap: 0, ...extra });
const base = [C(1, 'regular', 1, { daily_cap: 2 }), C(2, 'white', 2), C(3, 'regular', 3, { daily_cap: 1 })];
const pick = (o) => CA.pickDailyCard({ cards: base, ...o });
ok([0, 1, 2, 3].map((n) => pick({ n }).card.id).join() === '1,3,1,3', 'نوبت فقط بینِ کارت‌های عادی، به ترتیبِ sort (سفید بیرون)');
ok(pick({ n: 0 }).via === 'rotation', 'کاربرِ تازه via=rotation');
ok(pick({ stickyId: 3, n: 0 }).card.id === 3 && pick({ stickyId: 3, n: 0 }).via === 'sticky', 'کاربرِ امروز روی کارتِ خودش می‌ماند');
ok(pick({ stickyId: 3, used: new Map([[3, 1]]) }).card.id === 1, 'کارتِ کاربر پر شد ⟵ کارتِ عادیِ دیگر');
ok(CA.pickDailyCard({ cards: base.map((c) => (c.id === 3 ? { ...c, active: 0 } : c)), stickyId: 3 }).card.id === 1,
  'کارتِ کاربر غیرفعال شد ⟵ کارتِ عادیِ دیگر');
const full = new Map([[1, 2], [3, 1]]);
ok(pick({ used: full }).card.id === 2 && pick({ used: full }).via === 'white', 'همه‌ی عادی‌ها پر ⟵ کارتِ سفید');
const allFull = CA.pickDailyCard({ cards: base.map((c) => ({ ...c, daily_cap: 1 })), used: new Map([[1, 1], [2, 1], [3, 1]]) });
ok(allFull.card?.id === 1 && allFull.via === 'overflow', 'همه پر ⟵ overflow روی اولین عادیِ فعال (فاکتور هرگز بی‌کارت نمی‌ماند)');
ok(CA.pickDailyCard({ cards: base.map((c) => ({ ...c, active: 0 })) }).card === null, 'هیچ کارتِ فعالی ⟵ null (صداکننده فالبک دارد)');
ok(pick({ n: -5 }).card && pick({ n: NaN }).card && pick({ n: 1e9 }).card, 'nِ خراب هرگز کرش یا undefined نمی‌دهد');
{
  const card = { id: 1, active: 1, kind: 'regular', bank: 'b', number: '6219861904145405', holder: 'h', admin_id: 7, sort: 1, daily_cap: 2 };
  ok(CA.listText([card], 7) === CA.listText([card], 7, undefined) && !/امروز:/.test(CA.listText([card], 7)),
    'فهرستِ «💳 کارت‌ها» بدونِ مصرف بیت‌به‌بیت همان متنِ قبلی است');
  ok(/امروز: 2 پرداختِ تأییدشده · 🔴 سقف پر شد/.test(CA.viewText(card, 7, new Map([[1, 2]]))), 'صفحه‌ی کارت مصرفِ امروز و پر شدنِ سقف را نشان می‌دهد');
}
ok(!CA.capFull({ daily_cap: 0 }, 999) && CA.capFull({ daily_cap: 2 }, 2) && !CA.capFull({ daily_cap: 2 }, 1), 'سقفِ ۰ = بی‌سقف؛ پر یعنی مصرف ≥ سقف');

/* ── ۳) رفتاری: همان کدِ index.js روی SQLite ──────────────────────────────── */
console.log('\nرفتاری:');
const readers = region('let _cardSt = null;', '\nfunction cardOfPayment', { includeTo: false });
const issue = region('function issueInvoiceCard(paymentId)', '\n// خطِ زیرِ شماره روی فاکتور', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const OWNER = 111;

function boot({ rotation = true, stars = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    status TEXT NOT NULL DEFAULT 'pending')`);
  const clock = { day: '2026-09-26' };
  const CAx = { ...CA, cardDay: () => clock.day };
  const errs = [], events = [];
  const env = { CA: CAx, db, OWNER_ID: OWNER, CARD_ROTATION_ENABLED: rotation, starsRail: stars,
    log: () => {}, logErr: (...a) => errs.push(a.join(' ')), track: (_d, u, e, p) => events.push({ u, e, p }) };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `const LEGACY_CARD = { id: 0, number: '6219861904145405', holder: 'x', bank: '', kind: 'regular', active: 1, admin_id: OWNER_ID };
    ${readers}\n${schema}\n${issue}
    return { issueInvoiceCard, markApprovedDay, cardsUsedToday, cardSt };`;
  const f = new Function(...Object.keys(env), body);
  const h = { ...f(...Object.values(env)), db, clock, errs, events };
  // کارت‌ها: ۱ عادی (سید)، ۲ سفید (سید)، ۳ عادیِ تازه با ادمینِ دیگر.
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('6037997599199013','ب','-',222,'regular',3)").run();
  h.invoice = (uid) => { const id = Number(db.prepare('INSERT INTO payments (user_id, amount) VALUES (?, 60000)').run(uid).lastInsertRowid); h.issueInvoiceCard(id); return id; };
  h.cardOf = (pid) => db.prepare('SELECT card_id FROM payments WHERE id=?').get(pid).card_id;
  h.approve = (pid) => { db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(pid); h.markApprovedDay(pid); };
  return h;
}

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ چرخش شکست خورد:', e.message); }
if (h) {
  const { db } = h;
  ok(db.prepare("SELECT 1 FROM pragma_table_info('payments') WHERE name='approved_day'").get(), 'ستونِ افزایشیِ approved_day ساخته شد');
  const a1 = h.invoice(1), b1 = h.invoice(2), c1 = h.invoice(3);
  ok([a1, b1, c1].map(h.cardOf).join() === '1,3,1', 'سه کاربرِ اولِ روز: کارت ۱، ۳، ۱ (سفید در نوبت نیست)');
  const a2 = h.invoice(1);
  ok(h.cardOf(a2) === 1, 'فاکتورِ دومِ همان کاربر همان روز ⟵ همان کارت');
  ok(db.prepare("SELECT n FROM card_rotation WHERE day='2026-09-26'").get().n === 3, 'نوبت فقط با کاربرِ تازه جلو می‌رود (۳، نه ۴)');
  ok(!h.errs.length, 'هیچ خطایی در مسیرِ چرخش نیفتاد');
  ok(h.events.filter((e) => e.e === 'card_assigned').length === 4
    && h.events.every((e) => e.p.day === '2026-09-26'), 'رویدادِ افزایشیِ card_assigned برای هر صدور، با روزِ کارت');

  // صدورِ دوباره کارتِ فاکتور را عوض نمی‌کند و نوبت را هم نمی‌خورد.
  h.issueInvoiceCard(b1);
  ok(h.cardOf(b1) === 3 && db.prepare("SELECT n FROM card_rotation WHERE day='2026-09-26'").get().n === 3,
    'صدورِ دوباره‌ی همان فاکتور: کارت ثابت، نوبت دست‌نخورده');

  // سقف: کارت ۱ سقفِ ۲ دارد.
  db.prepare('UPDATE cards SET daily_cap=2 WHERE id=1').run();
  h.approve(a1);
  const old = Number(db.prepare("INSERT INTO payments (user_id, amount, status, card_id) VALUES (9, 1, 'approved', 1)").run().lastInsertRowid);
  ok(h.cardsUsedToday().get(1) === 1, 'پرداختِ تأییدشده‌ی قبل از این نسخه (approved_day خالی) در سقفِ امروز شمرده نمی‌شود');
  ok(h.cardOf(h.invoice(4)) === 3, 'کاربرِ تازه‌ی بعدی به نوبت کارت ۳ (سقفِ کارت ۱ هنوز باز)');
  ok(h.cardOf(h.invoice(5)) === 1, 'و بعدی دوباره کارت ۱');
  h.approve(c1);
  ok(h.cardsUsedToday().get(1) === 2, 'دو پرداختِ تأییدشده‌ی امروز روی کارت ۱ شمرده شد');
  ok(h.cardOf(h.invoice(6)) === 3, 'کارت ۱ پر شد ⟵ کاربرِ تازه کارت ۳ می‌گیرد');
  ok(h.cardOf(h.invoice(1)) === 3, 'کاربری که امروز روی کارت ۱ بود، بعد از پر شدنش به کارت ۳ می‌رود');
  ok(db.prepare("SELECT card_id FROM card_assign WHERE user_id=1 AND day='2026-09-26'").get().card_id === 3,
    'چسبندگیِ آن کاربر هم به کارتِ تازه منتقل شد (فاکتورِ بعدی‌اش دوباره نمی‌چرخد)');

  // همه‌ی عادی‌ها پر ⟵ سفید.
  db.prepare('UPDATE cards SET daily_cap=1 WHERE id=3').run();
  h.approve(b1);
  const w = h.invoice(7);
  ok(h.cardOf(w) === 2 && db.prepare('SELECT via FROM card_assign WHERE user_id=7').get().via === 'white', 'همه‌ی کارت‌های عادی پر ⟵ کارتِ سفید');

  // markApprovedDay یک‌بار است.
  h.clock.day = '2026-09-27';
  h.markApprovedDay(a1);
  ok(db.prepare('SELECT approved_day FROM payments WHERE id=?').get(a1).approved_day === '2026-09-26', 'روزِ تأیید یک‌بار می‌نشیند (بازنویسی نمی‌شود)');

  // روزِ تازه: از کارتِ اول، مصرف صفر، چسبندگی تازه.
  ok(!h.cardsUsedToday().size, 'روزِ تازه: مصرفِ همه‌ی کارت‌ها صفر');
  ok(h.cardOf(h.invoice(50)) === 1, 'اولین کاربرِ روزِ تازه ⟵ کارتِ ۱');
  ok(h.cardOf(h.invoice(7)) === 3, 'کاربرِ دیروزِ کارتِ سفید امروز از نو در نوبت است (دومی ⟵ کارت ۳)');
  void old;
}

// رول‌بک و ربات‌های استارز: رفتارِ v3.123.0.
for (const [label, opts] of [['CARD_ROTATION_ENABLED=false', { rotation: false }], ['رباتِ استارز', { stars: true }]]) {
  let r; try { r = boot(opts); } catch (e) { fail++; console.error(`  ❌ ${label}:`, e.message); continue; }
  const ids = [r.invoice(1), r.invoice(2), r.invoice(3)].map(r.cardOf);
  ok(ids.join() === '1,1,1' && !r.db.prepare('SELECT COUNT(*) n FROM card_assign').get().n
    && !r.db.prepare('SELECT COUNT(*) n FROM card_rotation').get().n, `${label} ⟵ همه کارتِ پیش‌فرض، بدونِ هیچ ردیفِ چرخش`);
}

/* ── ۴) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
const approvals = [...CODE.matchAll(/setPaymentStatus\.run\('approved', ([^)]+)\);\n\s*markApprovedDay\(([^)]+)\);/g)];
const allApprovals = (CODE.match(/setPaymentStatus\.run\('approved'/g) || []).length;
ok(allApprovals >= 2 && approvals.length === allApprovals && approvals.every((m) => m[1] === m[2]),
  `هر تأییدِ پرداخت بلافاصله روزِ کارت را مهر می‌زند (${approvals.length}/${allApprovals})`);
ok((CODE.match(/\bCARD_ROTATION_ENABLED\b/g) || []).length === 2, 'پرچمِ چرخش فقط تعریف + یک گارد (رول‌بکِ یک‌خطی)');
ok(/CARD_ROTATION_ENABLED && !starsRail/.test(CODE), 'ربات‌های استارز هرگز وارد چرخش نمی‌شوند');
ok(/ALTER TABLE payments ADD COLUMN approved_day TEXT NOT NULL DEFAULT ''/.test(CODE), 'مهاجرت افزایشی است (بند ۲ج/۱)');
ok(/CA\.pickDailyCard\(/.test(CODE) && !/function pickDailyCard/.test(CODE), 'انتخاب فقط از تک‌منبعِ خالص (cards-admin.js)');
{
  const botSql = /usedOn:\s*db\.prepare\("([^"]+)"\)/.exec(SRC)?.[1];
  const dash = readFileSync('bots/dashboard/routes/cards.js', 'utf8');
  ok(botSql && dash.includes(`"${botSql}"`), 'داشبورد مصرفِ امروز را با **همان** SQLِ سقفِ ربات می‌شمارد');
  ok(/CA\.cardDay\(\)/.test(dash) && !/هنوز اعمال نمی‌شود/.test(dash), 'داشبورد روزِ کارت را از همان تابع می‌گیرد و دیگر «هنوز اعمال نمی‌شود» نمی‌گوید');
}

console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
