// چکِ CI برای انتخابِ کارتِ فاکتور بر اساسِ مبلغ (tarot، v3.132.0 — جایگزینِ چرخشِ per کاربرِ v3.124.0).
//
// تصمیم‌های مالک (۱۴۰۵/۰۷/۰۵) که این فایل قفل می‌کند:
//   • کارت per **فاکتور** انتخاب می‌شود و کاربر هیچ نقشی ندارد (نه کارتِ ثابتِ روزانه، نه کارتِ ترجیحی).
//   • هر مبلغ فقط با خودش رقابت می‌کند. بینِ کارت‌های عادیِ فعالِ زیرِ سقف: کمترین تأییدشده‌ی امروز با
//     همین مبلغ ⟵ کمترین فاکتورِ بازِ امروز با همین مبلغ ⟵ ترتیبِ فهرست.
//   • روز از ۰۰:۰۰ تهران. سقفِ روزانه اختیاری (۰ = بی‌سقف، پیش‌فرض).
//   • محاسبه باید «در کسری از ثانیه» تمام شود و هیچ‌وقت منتظرِ دیتای بیرونی نماند؛ بیش از ۳ ثانیه یا خطا
//     ⟵ هشدار به مالک، و خطا ⟵ فالبک به آخرین کارتِ برنده.
// خرابی‌هایی که این‌جا گرفته می‌شوند همه بی‌صدا و پولی‌اند: کارتی که یک مبلغِ ثابت را پشتِ‌سرِهم بگیرد
// (بانک می‌بندد)، شمارشی که مبلغ‌ها را قاطی کند، یا محاسبه‌ای که با بزرگ‌شدنِ جدول کند شود.
//
// کدِ واقعی از index.js بریده و روی SQLite اجرا می‌شود؛ منطقِ انتخاب همان `CA.pickAmountCard`.
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

console.log('\n🔁 انتخابِ کارت بر اساسِ مبلغ\n');

/* ── ۱) مرزِ روز: ۰۰:۰۰ تهران = ۲۰:۳۰ UTCِ روزِ قبل ─────────────────────────── */
console.log('مرزِ روز:');
const T = (iso) => Date.parse(iso);
ok(CA.CARD_DAY_BOUNDARY_H === 0 && CA.CARD_TZ === 'Asia/Tehran', 'مرز نیمه‌شبِ تهران است');
ok(CA.cardDay(T('2026-09-26T20:29:59Z')) === '2026-09-26', '۲۳:۵۹:۵۹ تهران هنوز همان روز است');
ok(CA.cardDay(T('2026-09-26T20:30:00Z')) === '2026-09-27', '۰۰:۰۰ تهران روزِ تازه است');
ok(CA.cardDay(T('2026-09-27T02:29:00Z')) === '2026-09-27', '۰۵:۵۹ تهران دیگر روزِ قبل نیست (مرزِ کهنه‌ی ۰۶:۰۰ رفت)');
ok(CA.cardDayStartSec(T('2026-09-27T10:00:00Z')) === T('2026-09-26T20:30:00Z') / 1000, 'شروعِ روز = نیمه‌شبِ تهران به ثانیه');
ok(CA.cardDayStartSec(T('2026-09-26T20:30:00Z')) === T('2026-09-26T20:30:00Z') / 1000
  && CA.cardDayStartSec(T('2026-09-26T20:29:59Z')) === T('2026-09-25T20:30:00Z') / 1000, 'شروعِ روز دقیقاً روی لبه‌ی مرز');

/* ── ۲) تابعِ خالصِ انتخاب ─────────────────────────────────────────────────── */
console.log('\nانتخاب (CA.pickAmountCard):');
const C = (id, kind = 'regular', sort = id, extra = {}) => ({ id, kind, sort, active: 1, daily_cap: 0, admin_id: 1, ...extra });
const M = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
const three = [C(1), C(2), C(3), C(9, 'white', 9)];
const P = (o) => CA.pickAmountCard({ cards: three, ...o });
ok(P({}).card.id === 1 && P({}).via === 'amount', 'همه مساوی ⟵ اولین کارت به ترتیب');
ok(P({ wins: M({ 1: 2, 2: 1, 3: 2 }) }).card.id === 2, 'قاعده‌ی ۱: کمترین تأییدشده با همین مبلغ');
ok(P({ wins: M({ 1: 1, 2: 1, 3: 1 }), open: M({ 1: 1, 2: 0, 3: 2 }) }).card.id === 2, 'قاعده‌ی ۲: تساویِ تأییدشده ⟵ کمترین فاکتورِ باز');
ok(P({ wins: M({ 1: 1, 2: 1, 3: 1 }), open: M({ 1: 1, 2: 1, 3: 1 }) }).card.id === 1, 'قاعده‌ی ۳: تساویِ هر دو ⟵ ترتیبِ فهرست');
ok(P({ wins: M({ 1: 0, 2: 1, 3: 1 }), open: M({ 1: 9, 2: 0, 3: 0 }) }).card.id === 1, 'فاکتورِ باز فقط تساوی را می‌شکند، بر تأییدشده غلبه نمی‌کند');
ok(CA.pickAmountCard({ cards: [C(1, 'regular', 5), C(2, 'regular', 1)] }).card.id === 2, 'ترتیب از `sort` است نه `id`');
{
  // مثالِ خودِ مالک ۱: اولِ روز، سه کارت، پنج فاکتورِ ۱۵ هزاری، هیچ‌کدام پرداخت نشده.
  const open = new Map();
  const got = [];
  for (let i = 0; i < 5; i++) { const c = P({ open }).card.id; got.push(c); open.set(c, (open.get(c) || 0) + 1); }
  ok(got.join() === '1,2,3,1,2', `مثالِ مالک: فاکتورِ بعدی تا وقتی قبلی باز است کارتِ بعدی را می‌گیرد (${got.join()})`);
  // مثالِ خودِ مالک ۲: کارتِ ۳ کمترین تأییدشده را دارد ⟵ هر پنج فاکتور روی کارتِ ۳.
  const wins = M({ 1: 2, 2: 2, 3: 1 });
  const o2 = new Map(), g2 = [];
  for (let i = 0; i < 5; i++) { const c = P({ wins, open: o2 }).card.id; g2.push(c); o2.set(c, (o2.get(c) || 0) + 1); }
  ok(g2.every((c) => c === 3), 'مثالِ مالک: کارتی که کمترین تأییدشده را دارد همه را می‌گیرد تا وقتی تأییدها برسند');
  wins.set(3, 3);
  ok(P({ wins, open: o2 }).card.id === 1, 'سه تا از آن‌ها تأیید شدند ⟵ کارتِ ۳ از رقابت عقب می‌افتد');
}
ok(P({ used: new Map([[1, 5]]) }).card.id === 1, 'سقفِ ۰ = بی‌سقف (پیش‌فرض): مصرفِ زیاد کارت را کنار نمی‌گذارد');
{
  const capped = [C(1, 'regular', 1, { daily_cap: 2 }), C(2), C(9, 'white', 9)];
  ok(CA.pickAmountCard({ cards: capped, used: new Map([[1, 2]]) }).card.id === 2, 'کارتِ پرشده از رقابت بیرون است (حتی با تأییدشده‌ی کمتر)');
  const r = CA.pickAmountCard({ cards: capped.map((c) => (c.id === 2 ? { ...c, active: 0 } : c)), used: new Map([[1, 2]]) });
  ok(r.card.id === 9 && r.via === 'white', 'همه‌ی عادی‌ها پر یا خاموش ⟵ کارتِ سفید');
  const all = CA.pickAmountCard({ cards: capped.map((c) => ({ ...c, daily_cap: 1 })), used: new Map([[1, 1], [2, 1], [9, 1]]) });
  ok(all.card.id === 1 && all.via === 'overflow', 'همه پر ⟵ overflow روی اولین عادیِ فعال (فاکتور هرگز بی‌کارت نمی‌ماند)');
}
ok(CA.pickAmountCard({ cards: three.map((c) => ({ ...c, active: 0 })) }).card === null, 'هیچ کارتِ فعالی ⟵ null');
ok(P({ wins: M({ 1: 0 }), open: 'x', used: null }).card.id === 1, 'ورودیِ خراب هرگز کرش نمی‌دهد');
// تعویض: هرگز کارتِ فعلی، با همان قاعده.
ok(P({ excludeId: 1 }).card.id === 2, 'تعویض: کارتِ فعلی کنار می‌رود و بقیه با همان قاعده');
ok(P({ excludeId: 2, wins: M({ 1: 3, 3: 1 }) }).card.id === 3, 'تعویض: کمترین تأییدشده بینِ بقیه');
{
  const two = [C(1, 'regular', 1, { admin_id: 5 }), C(8, 'white', 8, { admin_id: 6 }), C(9, 'white', 9, { admin_id: 5 })];
  const r = CA.pickAmountCard({ cards: two, excludeId: 1 });
  ok(r.card.id === 9 && r.via === 'white', 'تعویض بدونِ عادیِ دیگر ⟵ سفیدِ همان ادمین');
  ok(CA.pickAmountCard({ cards: [C(1)], excludeId: 1 }).card === null, 'تعویض بدونِ هیچ کارتِ دیگر ⟵ null (دکمه ساخته نمی‌شود)');
}

/* ── ۳) رفتاری: همان کدِ index.js روی SQLite ──────────────────────────────── */
console.log('\nرفتاری:');
const readers = region('let _cardSt = null;', '\nfunction cardOfPayment', { includeTo: false });
const issue = region('/* ⏱ انتخابِ کارت روی مسیرِ صدورِ فاکتور', '\n// خطِ زیرِ شماره روی فاکتور', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const OWNER = 111;
const DAY0 = T('2026-09-27T08:00:00Z') / 1000;       // ۱۱:۳۰ تهران

function boot({ rotation = true, stars = false, CAo = {}, DateO = Date } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, invoice_issued_at INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  const clock = { now: DAY0 };
  const CAx = { ...CA, cardDay: () => CA.cardDay(clock.now * 1000), cardDayStartSec: () => CA.cardDayStartSec(clock.now * 1000), ...CAo };
  const errs = [], events = [], sent = [];
  const env = { CA: CAx, db, OWNER_ID: OWNER, CARD_ROTATION_ENABLED: rotation, starsRail: stars, Date: DateO,
    bot: { telegram: { sendMessage: async (to, t) => { sent.push({ to, t }); } } },
    log: () => {}, logErr: (...a) => errs.push(a.join(' ')), track: (_d, u, e, p) => events.push({ u, e, p }) };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `const LEGACY_CARD = { id: 0, number: '6219861904145405', holder: 'x', bank: '', kind: 'regular', active: 1, admin_id: OWNER_ID };
    ${readers}\n${schema}\n${issue}
    return { issueInvoiceCard, markApprovedDay, cardsUsedToday, cardSt, cardCounts };`;
  const f = new Function(...Object.keys(env), body);
  const h = { ...f(...Object.values(env)), db, clock, errs, events, sent };
  // کارت‌ها: ۱ عادی (سید)، ۲ سفید (سید)، ۳ و ۴ عادیِ تازه.
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('6037997599199013','ب','-',111,'regular',3)").run();
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('5859471120915172','ج','-',111,'regular',4)").run();
  h.invoice = (uid, amount = 15000) => {
    const id = Number(db.prepare('INSERT INTO payments (user_id, amount, created_at, invoice_issued_at) VALUES (?, ?, ?, ?)').run(uid, amount, h.clock.now, h.clock.now).lastInsertRowid);
    h.issueInvoiceCard(id); return id;
  };
  h.cardOf = (pid) => db.prepare('SELECT card_id FROM payments WHERE id=?').get(pid).card_id;
  h.approve = (pid) => { db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(pid); h.markApprovedDay(pid); };
  h.markApprovedDay = (pid) => db.prepare('UPDATE payments SET approved_at=? WHERE id=? AND approved_at IS NULL').run(h.clock.now, pid);
  return h;
}

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ انتخاب شکست خورد:', e.message); }
if (h) {
  const { db } = h;
  ok(db.prepare("SELECT 1 FROM pragma_table_info('payments') WHERE name='approved_at'").get(), 'ستونِ افزایشیِ approved_at ساخته شد');
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='payments'").all().map((r) => r.name);
  ok(idx.includes('idx_payments_status_approved') && idx.includes('idx_payments_status_issued') && !idx.includes('idx_payments_status_created'),
    'هر دو ایندکسِ شمارشِ امروز ساخته شدند (و ایندکسِ بی‌مصرفِ نسخه‌ی اول برداشته شد)');
  // کارت‌های عادی به ترتیب: ۱، ۳، ۴ (کارتِ ۲ سفید است).
  const a = [h.invoice(1), h.invoice(1), h.invoice(2), h.invoice(3)];
  ok(a.map(h.cardOf).join() === '1,3,4,1', `یک کاربر هم کارت‌های مختلف می‌گیرد؛ فاکتورِ باز کارتِ بعدی را جلو می‌اندازد (${a.map(h.cardOf).join()})`);
  const b = h.invoice(4, 60000);
  ok(h.cardOf(b) === 1, 'مبلغِ دیگر رقابتِ جدا دارد (۶۰ هزاری از کارتِ اول شروع می‌کند)');
  h.approve(a[0]);
  ok(h.cardOf(h.invoice(5)) === 3, 'کارتِ ۱ یک ۱۵ هزاریِ تأییدشده دارد ⟵ از رقابتِ ۱۵ هزاری عقب رفت');
  ok(h.cardOf(h.invoice(6, 60000)) === 3, 'تأییدِ ۱۵ هزاری روی رقابتِ ۶۰ هزاری اثر ندارد (فقط فاکتورِ بازِ کارتِ ۱)');
  db.prepare("UPDATE payments SET status='canceled' WHERE id IN (?, ?)").run(a[1], a[2]);
  ok(h.cardOf(h.invoice(7)) === 4, 'فاکتورِ لغوشده دیگر «باز» نیست (کارتِ ۴ از ۳ جلو افتاد)');
  db.prepare("UPDATE payments SET status='waiting_review' WHERE id=?").run(a[3]);
  const openNow = h.cardCounts(15000).open;
  ok(openNow.get(1) === 1, 'رسیدِ منتظرِ تصمیم (waiting_review) هنوز فاکتورِ باز است');
  {
    // ردیفِ بسته‌ها که دیروز (۲۳:۵۸) ساخته شد و امروز فاکتور شد ⟵ امروز «باز» است (ملاک صدور است نه ساختِ ردیف).
    const rid = Number(db.prepare("INSERT INTO payments (user_id, amount, status, card_id, created_at, invoice_issued_at) VALUES (77, 45000, 'pending', 4, ?, ?)")
      .run(h.clock.now - 86400, h.clock.now).lastInsertRowid);
    ok(h.cardCounts(45000).open.get(4) === 1, 'ردیفِ دیروز که امروز فاکتور شد در «فاکتورِ بازِ امروز» شمرده می‌شود');
    db.prepare("UPDATE payments SET status='canceled' WHERE id=?").run(rid);
  }
  ok(!h.errs.length && !h.sent.length, 'هیچ خطا و هیچ هشداری در مسیرِ عادی');
  ok(h.events.filter((e) => e.e === 'card_assigned').every((e) => e.p.via === 'amount' && e.p.amount > 0),
    'رویدادِ card_assigned با via=amount و مبلغ ثبت می‌شود');
  // صدورِ دوباره کارت را عوض نمی‌کند.
  h.issueInvoiceCard(b);
  ok(h.cardOf(b) === 1, 'صدورِ دوباره‌ی همان فاکتور: کارت ثابت');
  // روزِ تازه: تأییدشده‌ها و فاکتورهای بازِ دیروز صفر می‌شوند.
  h.clock.now = T('2026-09-27T20:30:00Z') / 1000;
  ok(!h.cardsUsedToday().size, 'نیمه‌شب: مصرفِ امروز صفر');
  ok(h.cardOf(h.invoice(8)) === 1, 'روزِ تازه ⟵ از کارتِ اول (فاکتورِ بازِ دیروز حساب نمی‌شود)');
  // سقف: پیش‌فرض بی‌سقف، ولی اگر تعریف شد کارتِ پر کنار می‌رود.
  ok(db.prepare('SELECT COUNT(*) n FROM cards WHERE daily_cap != 0').get().n === 0, 'کارت‌ها به‌طورِ پیش‌فرض بی‌سقف‌اند');
}

// رول‌بک و ربات‌های استارز: اولین کارتِ عادیِ فعال.
for (const [label, opts] of [['CARD_ROTATION_ENABLED=false', { rotation: false }], ['رباتِ استارز', { stars: true }]]) {
  let r; try { r = boot(opts); } catch (e) { fail++; console.error(`  ❌ ${label}:`, e.message); continue; }
  const ids = [r.invoice(1), r.invoice(2), r.invoice(3)].map(r.cardOf);
  ok(ids.join() === '1,1,1' && !r.sent.length, `${label} ⟵ همه کارتِ پیش‌فرض، بدونِ هشدار`);
}

/* ── ۴) فالبک و هشدار (خطا و کندی) ─────────────────────────────────────────── */
console.log('\nفالبک و هشدار:');
{
  let boom = false;
  const r = boot({ CAo: { pickAmountCard: (o) => { if (boom) throw new Error('disk'); return CA.pickAmountCard(o); } } });
  r.invoice(1); r.invoice(2);                                    // کارتِ ۳ آخرین برنده است
  boom = true;
  const f = r.invoice(3);
  ok(r.cardOf(f) === 3, 'خطا در محاسبه ⟵ فالبک به آخرین کارتِ برنده (کارتِ ۳)');
  ok(r.sent.length === 1 && r.sent[0].to === OWNER && /خطا/.test(r.sent[0].t) && r.errs.some((e) => /CARD_PICK_ALERT/.test(e)),
    'خطا ⟵ هشدارِ تلگرام به مالک + مارکرِ CARD_PICK_ALERT در لاگ');
  ok(r.events.some((e) => e.e === 'card_assigned' && e.p.via === 'fallback' && e.p.card_id === 3), 'فالبک هم رویدادِ card_assigned با via=fallback دارد');
  r.invoice(4);
  ok(r.sent.length === 1, 'هشدار حداکثر هر ۱۰ دقیقه یک بار (سیلِ پیام نه)');
  r.db.prepare('UPDATE cards SET active=0 WHERE id=3').run();
  ok(r.cardOf(r.invoice(5)) === 1, 'آخرین برنده غیرفعال شده ⟵ فالبک به اولین عادیِ فعال');
}
{
  // ساعتی که هر بار ۴ ثانیه جلو می‌رود ⟵ «محاسبه بیش از ۳ ثانیه طول کشید».
  let t = 1_700_000_000_000;
  const SlowDate = { now: () => (t += 4000) };
  const r = boot({ DateO: SlowDate });
  const pid = r.invoice(1);
  ok(r.cardOf(pid) === 1 && r.sent.length === 1 && /طول کشید/.test(r.sent[0].t), 'بیش از ۳ ثانیه ⟵ هشدار به مالک (جوابِ درستِ آماده استفاده می‌شود)');
}

/* ── ۵) سرعت در بدترین حالت: جدولِ بزرگ + روزِ شلوغ ─────────────────────────── */
console.log('\nسرعت (بدترین حالت):');
{
  const r = boot();
  const { db } = r;
  // ۲۰ کارتِ عادی، ۴۰۰ هزار پرداختِ تاریخی (۲ سال) + ۲۰ هزار ردیفِ امروز با ۸ مبلغ و همه‌ی وضعیت‌ها.
  const insC = db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES (?, 'x', '-', 111, 'regular', ?)");
  for (let i = 0; i < 17; i++) insC.run(String(6037000000000000 + i), 10 + i);
  const cardIds = db.prepare('SELECT id FROM cards').all().map((c) => c.id);
  const AMTS = [15000, 20000, 25000, 30000, 50000, 60000, 90000, 150000];
  const ST = ['approved', 'approved', 'pending', 'waiting_review', 'rejected', 'canceled'];
  const ins = db.prepare('INSERT INTO payments (user_id, amount, status, created_at, invoice_issued_at, card_id, approved_at) VALUES (?,?,?,?,?,?,?)');
  const start = r.clock.now - 3600;
  db.transaction(() => {
    for (let i = 0; i < 400_000; i++) {
      const at = start - 86400 - (i % (730 * 86400));
      const st = ST[i % ST.length];
      ins.run(i % 9000, AMTS[i % 8], st, at, at, cardIds[i % cardIds.length], st === 'approved' ? at : null);
    }
    for (let i = 0; i < 20_000; i++) {
      const at = start + (i % 3600);
      const st = ST[i % ST.length];
      ins.run(i % 5000, AMTS[i % 8], st, at, at, cardIds[i % cardIds.length], st === 'approved' ? at : null);
    }
  })();
  const st = r.cardSt();
  const plans = ['usedOn', 'winsOn', 'openOn'].map((k) => [k, db.prepare(`EXPLAIN QUERY PLAN ${st[k].source}`).all(...(k === 'usedOn' ? [1] : [1, 15000])).map((x) => x.detail).join(' | ')]);
  for (const [k, plan] of plans) ok(/USING (COVERING )?INDEX idx_payments_(status_approved \(status=\? AND approved_at>\?\)|status_issued \(status=\? AND invoice_issued_at>\?\))/.test(plan) && !/SCAN payments(?! USING)/.test(plan), `${k} روی ایندکس می‌نشیند، نه اسکنِ کلِ جدول (${plan})`);
  const times = [];
  for (let i = 0; i < 300; i++) {
    const t0 = process.hrtime.bigint();
    r.invoice(90000 + i, AMTS[i % 8]);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((x, y) => x - y);
  const p50 = times[150], max = times[times.length - 1];
  console.log(`  ℹ️ ۴۲۰ هزار پرداخت (۲۰ هزار امروز)، ۲۰ کارت، ۳۰۰ فاکتور: میانه ${p50.toFixed(2)}ms، بدترین ${max.toFixed(2)}ms`);
  ok(max < 250, `بدترین صدور زیرِ ۲۵۰ میلی‌ثانیه (بودجه‌ی مالک ۳۰۰۰): ${max.toFixed(1)}ms`);
  ok(!r.sent.length && !r.errs.length, 'هیچ هشدار و هیچ خطایی زیرِ بار');
}

/* ── ۶) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
const approvals = [...CODE.matchAll(/setPaymentStatus\.run\('approved', ([^)]+)\);\n\s*markApprovedDay\(([^)]+)\);/g)];
const allApprovals = (CODE.match(/setPaymentStatus\.run\('approved'/g) || []).length;
ok(allApprovals >= 2 && approvals.length === allApprovals && approvals.every((m) => m[1] === m[2]),
  `هر تأییدِ پرداخت بلافاصله لحظه‌ی تأیید را مهر می‌زند (${approvals.length}/${allApprovals})`);
ok(/markDay:\s*db\.prepare\('UPDATE payments SET approved_at=unixepoch\(\) WHERE id=\? AND approved_at IS NULL'\)/.test(SRC), 'مهرِ تأیید یک‌بار است و از ساعتِ خودِ دیتابیس');
ok((CODE.match(/\bCARD_ROTATION_ENABLED\b/g) || []).length === 2, 'پرچم فقط تعریف + یک گارد (رول‌بکِ یک‌خطی)');
ok(/CARD_ROTATION_ENABLED && !starsRail/.test(CODE), 'ربات‌های استارز هرگز وارد نمی‌شوند');
ok(/ALTER TABLE payments ADD COLUMN approved_at INTEGER/.test(CODE), 'مهاجرت افزایشی است (بند ۲ج/۱)');
ok((CODE.match(/CA\.pickAmountCard\(/g) || []).length === 2 && !/function pickAmountCard/.test(CODE),
  'صدورِ فاکتور و دکمه‌ی تعویض هر دو از همان تک‌منبعِ خالص می‌خوانند');
ok(!/pickDailyCard|pickSwitchCard|assignSet|assignGet|rotInc|isBluUser|BLU_USER_CARD_ENABLED/.test(CODE)
  && !/export function (pickDailyCard|pickSwitchCard)/.test(readFileSync('bots/tarot/cards-admin.js', 'utf8')),
  'هیچ اثری از کارتِ per کاربر، نوبتِ روزانه یا کاربرِ بلو نمانده');
ok(!/await|fetch\(|telegram\./.test(region('const pickInvoiceCardTx', '}));')), 'انتخاب هیچ انتظار یا فراخوانیِ بیرونی ندارد (فقط SQLiteِ محلی)');
{
  /* 🐛 v3.132.0 (روی دیتای زنده دیده شد): در مسیرِ بسته `issueInvoiceCard` قبل از `setPaymentPackage` بود، پس
     `amount` هنوز تعدادِ الماس بود و همه‌ی فاکتورها روی کارتِ اول می‌نشستند. هر صدا باید **بعد از** آخرین
     نوشتنِ مبلغِ همان تابع باشد. */
  const AMOUNT_WRITES = /stmts\.(claimAmount|setPaymentPackage|setPaymentDiscount|adjustPaymentAmount)\.run\(/g;
  const calls = [...CODE.matchAll(/issueInvoiceCard\((\w+(?:\.\w+)?)\);/g)].filter((m) => !/function issueInvoiceCard/.test(CODE.slice(m.index - 9, m.index)));
  const bad = [];
  for (const m of calls) {
    const fnStart = CODE.lastIndexOf('\nasync function ', m.index) > CODE.lastIndexOf('\nfunction ', m.index)
      ? CODE.lastIndexOf('\nasync function ', m.index) : CODE.lastIndexOf('\nfunction ', m.index);
    const actStart = CODE.lastIndexOf('\nbot.action(', m.index);
    const start = Math.max(fnStart, actStart);
    const end = CODE.indexOf('\n}', m.index);
    const body = CODE.slice(start, end);
    const at = m.index - start;
    const later = [...body.matchAll(AMOUNT_WRITES)].filter((w) => w.index > at);
    if (later.length) bad.push(`${m[0]} ⟵ بعدش ${later.map((w) => w[1]).join('، ')}`);
  }
  ok(calls.length >= 3 && !bad.length, `کارتِ فاکتور همیشه بعد از نشستنِ مبلغِ نهایی انتخاب می‌شود (${calls.length} صدا${bad.length ? '؛ ' + bad.join(' | ') : ''})`);
}
{
  const botSql = /usedOn:\s*db\.prepare\("([^"]+)"\)/.exec(SRC)?.[1];
  const dash = readFileSync('bots/dashboard/routes/cards.js', 'utf8');
  ok(botSql && dash.includes(`"${botSql}"`), 'داشبورد مصرفِ امروز را با **همان** SQLِ سقفِ ربات می‌شمارد');
  ok(/CA\.cardDayStartSec\(\)/.test(dash) && /CA\.cardDay\(Number\(r\.approved_at\) \* 1000\)/.test(dash), 'داشبورد روز را از همان تابع و از approved_at می‌سازد');
}

console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
