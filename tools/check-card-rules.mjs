import { TEST_PAYMENT_CARDS } from './fixtures/payment-config.mjs';
// چکِ CI برای قواعدِ صلاحیتِ کارت per کاربر (tarot، v3.133.0 — `bots/tarot/card-rules.js`).
//
// تصمیمِ مالک (۱۴۰۵/۰۷/۰۵) که این فایل قفل می‌کند:
//   • کاربری که حتی یک رسیدش تگِ دستیِ اپِ «آپ» خورده، کارتِ بلوبانک را **تحتِ هیچ شرایطی** نمی‌بیند:
//     نه در صدورِ فاکتور، نه با دکمه‌ی تعویض، نه در اقدامِ خودکارِ «نتوانستم واریز کنم»، نه در فالبکِ خطا،
//     نه وقتی چرخش رول‌بک شده. برای او بلوبانک مثلِ کارتِ غیرفعال است و بینِ بقیه می‌چرخد.
//   • کاربرِ بدونِ تگِ آپ دقیقاً رفتارِ قبلی را دارد (بلوبانک هم در رقابت است).
//   • افزودن/حذفِ قاعده بدونِ دست‌زدن به بقیه‌ی کد (یک ردیف در `CR.CARD_RULES`).
// خرابی‌هایی که این‌جا گرفته می‌شوند همه بی‌صدا‌اند: یک مسیرِ انتخابِ کارت که فهرست را از قاعده رد نکند،
// خطای خواندنِ تگ که قاعده را خاموش کند، یا فالبکی که به بلوبانک برگردد.
//
// کدِ واقعی از index.js بریده و روی SQLite اجرا می‌شود؛ هر ادعای منفی کنترلِ مثبتِ خودش را دارد.
import * as CA from '../bots/tarot/cards-admin.js';
import * as CR from '../bots/tarot/card-rules.js';
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const RULES_SRC = readFileSync('bots/tarot/card-rules.js', 'utf8');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}

console.log('\n🚫 قواعدِ کارت per کاربر\n');

/* ── ۱) ماژولِ خالص ─────────────────────────────────────────────────────── */
console.log('ماژولِ خالص (card-rules.js):');
const card = (id, bank, extra = {}) => ({ id, bank, kind: 'regular', active: 1, sort: id, daily_cap: 0, admin_id: 1, ...extra });
const DECK = [card(1, 'بلوبانک'), card(2, 'بانک پاسارگاد'), card(3, 'بانک خاورمیانه'), card(4, 'بانک شهر', { kind: 'white' })];
const facts = (rows) => CR.userCardFacts(rows);
const AP = facts([{ dim: 'app', value_key: 'ap' }]);
ok(CR.isBluCard({ bank: 'بلوبانک' }) && CR.isBluCard({ bank: 'Blu Bank' }) && CR.isBluCard({ bank: 'بلو' }), 'بلوبانک از نامِ بانک شناخته می‌شود (فارسی و لاتین)');
ok(!CR.isBluCard({ bank: 'بانک سامان' }) && !CR.isBluCard({ bank: '' }) && !CR.isBluCard(null) && !CR.isBluCard({}), 'کارتِ دیگر، بانکِ خالی و ورودیِ خراب بلو نیستند');
{
  const r = CR.eligibleCards(DECK, AP);
  ok(r.cards.map((c) => c.id).join() === '2,3,4', 'کاربرِ آپ: بلوبانک حذف و ترتیبِ بقیه دست‌نخورده');
  ok(r.blocked.length === 1 && r.blocked[0].id === 1 && r.blocked[0].rule === 'ap_no_blu' && r.rules.join() === 'ap_no_blu', 'حذف با کلیدِ قاعده گزارش می‌شود');
}
for (const [label, f] of [
  ['بدونِ تگ', facts([])],
  ['اپِ دیگر (موبایل‌بانک)', facts([{ dim: 'app', value_key: 'mobilebank' }])],
  ['«ap» در بُعدِ بانک، نه اپ', facts([{ dim: 'bank', value_key: 'ap' }])],
]) {
  const r = CR.eligibleCards(DECK, f);
  ok(r.cards.length === 4 && !r.blocked.length && !r.rules.length, `${label} ⟵ همه‌ی کارت‌ها، هیچ قاعده‌ای`);
}
ok(CR.eligibleCards(DECK, facts([{ dim: 'app', value_key: 'mobilebank' }, { dim: 'app', value_key: 'ap' }])).cards.every((c) => c.id !== 1),
  'آپ حتی اگر تگِ اپِ دیگری هم داشته باشد (هر رسیدِ آپ کافی است)');
{
  const r = CR.eligibleCards(DECK, null);
  ok(r.cards.every((c) => c.id !== 1) && r.rules.join() === 'ap_no_blu', 'دانسته‌ی خوانده‌نشده (null) ⟵ سخت‌ترین حالت: همه‌ی قاعده‌ها');
}
{
  const boomApplies = { key: 'x1', applies: () => { throw new Error('boom'); }, blocks: () => true };
  const boomBlocks = { key: 'x2', applies: () => true, blocks: () => { throw new Error('boom'); } };
  ok(CR.eligibleCards(DECK, AP, [boomApplies]).cards.length === 4, 'قاعده‌ای که `applies`ش خطا بدهد فعال نمی‌شود (صدورِ فاکتور نمی‌شکند)');
  ok(CR.eligibleCards(DECK, AP, [boomBlocks]).cards.length === 4, 'قاعده‌ای که `blocks`ش خطا بدهد هیچ کارتی را حذف نمی‌کند');
  const extra = { key: 'no_pasargad', applies: () => true, blocks: (c) => /پاسارگاد/.test(c.bank) };
  const r = CR.eligibleCards(DECK, AP, [...CR.CARD_RULES, extra]);
  ok(r.cards.map((c) => c.id).join() === '3,4' && r.rules.join() === 'ap_no_blu,no_pasargad', 'قاعده‌ی دوم = یک ردیف؛ هر دو با هم اعمال می‌شوند');
  ok(CR.eligibleCards(DECK, AP, []).cards.length === 4, 'حذفِ قاعده = حذفِ ردیف ⟵ همه‌ی کارت‌ها');
}
ok(Object.isFrozen(CR.CARD_RULES) && CR.CARD_RULES.every((r) => Object.isFrozen(r) && r.key && r.why && typeof r.applies === 'function' && typeof r.blocks === 'function'),
  'هر قاعده key و why و applies و blocks دارد و از بیرون دست‌کاری‌شدنی نیست');
ok(new Set(CR.CARD_RULES.map((r) => r.key)).size === CR.CARD_RULES.length, 'کلیدِ قاعده‌ها یکتاست (لاگ و رویداد با آن ثبت می‌شوند)');
ok(!/^\s*import\b/m.test(RULES_SRC) && !/\bdb\b|telegram|fetch\(/.test(RULES_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  'card-rules.js خالص است (بدونِ import، DB یا شبکه)');
ok(CR.eligibleCards('x', AP).cards.length === 0 && CR.userCardFacts('x').tags.app.size === 0, 'ورودیِ خراب هرگز کرش نمی‌دهد');

/* ── ۲) رفتاری: همان کدِ index.js روی SQLite ──────────────────────────────── */
console.log('\nرفتاری:');
const readers = region('let _cardSt = null;', '\n// ایجنتِ رسیدِ کارت‌به‌کارت', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const switchRg = region('const cardSwitchOn', '\nconst cardSwitchRow', { includeTo: false });
const whiteRg = region('/** کارتِ سفیدِ مقصد برای پرداختِ `p`، یا null. */', '\n/* ادعای اتمیک', { includeTo: false });
const OWNER = 111;
const AP_USER = 500, PLAIN_USER = 600, MB_USER = 700;

function boot({ rules = true, rotation = true, CAo = {}, noTags = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, invoice_issued_at INTEGER DEFAULT (unixepoch()),
    status TEXT NOT NULL DEFAULT 'pending', stars_toggle_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  if (!noTags) db.exec(`CREATE TABLE receipt_tags (payment_id INTEGER NOT NULL, user_id INTEGER NOT NULL, dim TEXT NOT NULL, value_key TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'admin', by_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (payment_id, dim, source))`);
  const errs = [], events = [], sent = [], logs = [];
  const env = { PAYMENT_CARDS: TEST_PAYMENT_CARDS, CA: { ...CA, ...CAo }, CR, db, OWNER_ID: OWNER, CARD_ROTATION_ENABLED: rotation, CARD_RULES_ENABLED: rules,
    CARD_SWITCH_ENABLED: true, starsRail: false,
    bot: { telegram: { sendMessage: async (to, t) => { sent.push({ to, t }); } } },
    log: (...a) => logs.push(a.join(' ')), logErr: (...a) => errs.push(a.join(' ')), track: (_d, u, e, p) => events.push({ u, e, p }) };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `const LEGACY_CARD = { id: 0, number: '0000000000425405', holder: 'x', bank: 'بلوبانک', kind: 'regular', active: 1, admin_id: OWNER_ID };
    ${readers}\n${schema}\n${switchRg}\n${whiteRg}
    return { issueInvoiceCard, switchTargetFor, whiteTargetFor, cardsForUser, cardSt };`;
  const h = { ...new Function(...Object.keys(env), body)(...Object.values(env)), db, errs, events, sent, logs };
  // کارت‌ها مثلِ پروداکشن: ۱ بلو (عادی)، ۲ پاسارگاد (عادی)، ۳ خاورمیانه (عادی)، ۴ شهر (سفید).
  db.prepare("UPDATE cards SET kind='regular' WHERE id=2").run();
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('0000000000355172','x','بانک خاورمیانه',111,'regular',3)").run();
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('0000000000260547','x','بانک شهر',111,'white',4)").run();
  if (!noTags) {
    // سوابق: کاربرِ آپ یک رسیدِ قدیمیِ تگ‌خورده دارد؛ کاربرِ موبایل‌بانک هم تگ دارد ولی نه آپ.
    const tag = db.prepare('INSERT INTO receipt_tags (payment_id, user_id, dim, value_key, source) VALUES (?,?,?,?,?)');
    tag.run(9001, AP_USER, 'app', 'ap', 'admin');
    tag.run(9002, MB_USER, 'app', 'mobilebank', 'admin');
    tag.run(9003, PLAIN_USER, 'app', 'ap', 'auto');   // تگِ خودکار (حذف‌شده‌ی v3.132.0) هرگز ملاک نیست
  }
  h.invoice = (uid, amount = 15000) => {
    const id = Number(db.prepare('INSERT INTO payments (user_id, amount) VALUES (?, ?)').run(uid, amount).lastInsertRowid);
    h.issueInvoiceCard(id); return id;
  };
  h.cardOf = (pid) => db.prepare('SELECT card_id FROM payments WHERE id=?').get(pid).card_id;
  h.pay = (pid) => db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
  return h;
}

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کد شکست خورد:', e.message); }
if (h) {
  // کنترلِ مثبت: کاربرِ بدونِ آپ، اولین فاکتور روی بلوبانک (کارتِ اولِ فهرست).
  ok(h.cardOf(h.invoice(PLAIN_USER)) === 1, 'کنترلِ مثبت: کاربرِ بدونِ آپ فاکتورِ اول را روی بلوبانک می‌گیرد');
  ok(h.cardOf(h.invoice(MB_USER)) !== 0, 'کاربرِ موبایل‌بانک هم عادی کارت می‌گیرد');
  // کاربرِ آپ: ده فاکتور در مبلغ‌های مختلف (هر مبلغ رقابتِ جدا، پس بلو در هر کدام برنده‌ی طبیعی است).
  const apCards = [];
  for (const amt of [15000, 20000, 25000, 30000, 60000, 90000, 150000, 15000, 15000, 15000]) apCards.push(h.cardOf(h.invoice(AP_USER, amt)));
  ok(apCards.every((c) => c !== 1 && c > 0), `کاربرِ آپ: هیچ فاکتوری روی بلوبانک نیست (${apCards.join()})`);
  ok(apCards.includes(2) && apCards.includes(3), 'کاربرِ آپ بینِ بقیه‌ی کارت‌ها می‌چرخد (بلو مثلِ غیرفعال)');
  {
    // همان مبلغ، همان وضعیت: بلو برای کاربرِ عادی هنوز در رقابت است.
    const r = boot();
    const a = r.cardOf(r.invoice(AP_USER, 45000));
    const b = r.cardOf(r.invoice(PLAIN_USER, 45000));
    ok(a === 2 && b === 1, `رقابتِ یکسان: کاربرِ آپ ⟵ پاسارگاد، کاربرِ عادی ⟵ بلوبانک (${a},${b})`);
  }
  const ev = h.events.filter((e) => e.e === 'card_assigned');
  ok(ev.filter((e) => e.u === AP_USER).every((e) => e.p.rules === 'ap_no_blu'), 'رویدادِ card_assigned کاربرِ آپ قاعده را با خودش دارد');
  ok(ev.filter((e) => e.u === PLAIN_USER).every((e) => !('rules' in e.p)), 'کاربرِ عادی هیچ propِ قاعده‌ای نمی‌گیرد (رویدادِ قبلی بیت‌به‌بیت)');
  ok(h.logs.some((l) => /CARD_PICK .* rules=ap_no_blu blocked=1/.test(l)), 'لاگِ CARD_PICK قاعده و کارتِ حذف‌شده را نشان می‌دهد');
  ok(!h.errs.length && !h.sent.length, 'هیچ خطا و هیچ هشداری در مسیرِ عادی');

  // دکمه‌ی تعویض: کارتِ ۳ پر از تأییدشده، پس برنده‌ی طبیعیِ تعویض از پاسارگاد، بلوبانک است.
  const approve = (uid, card, n) => { for (let i = 0; i < n; i++) h.db.prepare("INSERT INTO payments (user_id, amount, status, card_id, approved_at) VALUES (?, 70000, 'approved', ?, unixepoch())").run(uid, card); };
  approve(1, 3, 5);
  const mk = (uid) => Number(h.db.prepare("INSERT INTO payments (user_id, amount, card_id) VALUES (?, 70000, 2)").run(uid).lastInsertRowid);
  const plainSw = h.switchTargetFor(h.pay(mk(PLAIN_USER)));
  const apSw = h.switchTargetFor(h.pay(mk(AP_USER)));
  ok(plainSw?.card?.id === 1, 'کنترلِ مثبت: تعویضِ کاربرِ عادی به بلوبانک می‌رود');
  ok(apSw?.card?.id === 3, `تعویضِ کاربرِ آپ هرگز بلوبانک نیست (⟵ ${apSw?.card?.id})`);
  // فقط بلو مانده به‌جز کارتِ فعلی ⟵ برای کاربرِ آپ تعویض به سفید می‌رود، نه بلو.
  h.db.prepare('UPDATE cards SET active=0 WHERE id=3').run();
  ok(h.switchTargetFor(h.pay(mk(AP_USER)))?.card?.id === 4, 'فقط بلو مانده ⟵ تعویضِ کاربرِ آپ به کارتِ سفید');
  h.db.prepare('UPDATE cards SET active=1 WHERE id=3').run();

  // «نتوانستم واریز کنم»: بلو را سفید کن و سفیدِ دیگر را خاموش ⟵ تنها سفیدِ مقصد بلوست.
  h.db.prepare("UPDATE cards SET kind='white' WHERE id=1").run();
  h.db.prepare('UPDATE cards SET active=0 WHERE id=4').run();
  ok(h.whiteTargetFor(h.pay(mk(PLAIN_USER)))?.id === 1, 'کنترلِ مثبت: خطای انتقالِ کاربرِ عادی ⟵ سفیدِ بلو');
  ok(h.whiteTargetFor(h.pay(mk(AP_USER))) === null, 'خطای انتقالِ کاربرِ آپ هرگز به بلو نمی‌رود (⟵ مستقیم به ادمین)');
}

// فالبکِ خطا: آخرین برنده بلوبانک است.
{
  let boom = false;
  const r = boot({ CAo: { pickAmountCard: (o) => { if (boom) throw new Error('disk'); return CA.pickAmountCard(o); } } });
  r.invoice(PLAIN_USER);                          // بلو آخرین برنده
  boom = true;
  ok(r.cardOf(r.invoice(PLAIN_USER)) === 1, 'کنترلِ مثبت: فالبکِ خطا برای کاربرِ عادی به آخرین برنده (بلو)');
  const c = r.cardOf(r.invoice(AP_USER));
  ok(c !== 1 && c > 0, `فالبکِ خطا برای کاربرِ آپ به بلو برنمی‌گردد (⟵ ${c})`);
}
// رول‌بکِ چرخش: کارتِ پیش‌فرض بلوست، ولی قاعده خاموش نمی‌شود.
{
  const r = boot({ rotation: false });
  ok(r.cardOf(r.invoice(PLAIN_USER)) === 1, 'کنترلِ مثبت: چرخشِ خاموش ⟵ کاربرِ عادی روی کارتِ پیش‌فرض (بلو)');
  ok(r.cardOf(r.invoice(AP_USER)) === 2, 'چرخشِ خاموش ⟵ کاربرِ آپ همچنان بدونِ بلو (اولین عادیِ مجاز)');
}
// هیچ کارتِ مجازِ دیگری نیست ⟵ فاکتور بی‌کارت نمی‌ماند و مالک خبردار می‌شود.
{
  const r = boot();
  r.db.prepare('UPDATE cards SET active=0 WHERE id != 1').run();
  const c = r.cardOf(r.invoice(AP_USER));
  ok(c === 1 && r.sent.length === 1 && r.sent[0].to === OWNER && /قاعده/.test(r.sent[0].t),
    'فقط بلو فعال مانده ⟵ فاکتور بی‌کارت نمی‌ماند + هشدارِ صریح به مالک');
}
// خواندنِ تگ شکست بخورد ⟵ سخت‌ترین حالت، نه بی‌قاعده.
{
  const r = boot({ noTags: true });
  const c = r.cardOf(r.invoice(AP_USER));
  ok(c !== 1 && c > 0 && r.errs.some((e) => /cardsForUser/.test(e)), 'خطای خواندنِ تگ ⟵ بلو برداشته می‌شود و خطا لاگ می‌شود (fail-closed)');
}
// رول‌بکِ قاعده.
{
  const r = boot({ rules: false });
  ok(r.cardOf(r.invoice(AP_USER)) === 1 && !r.events.some((e) => e.p?.rules), 'CARD_RULES_ENABLED=false ⟵ کاربرِ آپ دوباره بلو می‌گیرد (رفتارِ v3.132.0)');
}

/* ── ۳) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
ok((CODE.match(/\bCARD_RULES_ENABLED\b/g) || []).length === 2, 'پرچم فقط تعریف + یک گارد داخلِ cardsForUser (رول‌بکِ یک‌خطی)');
ok((CODE.match(/\bcardsForUser\(/g) || []).length === 4, 'cardsForUser: تعریف + سه مسیر (صدور، فالبک، تعویض/سفید)');
ok((CODE.match(/\{ cards: cardsForSwitch\(p, cur\),/g) || []).length === 2, 'دکمه‌ی تعویض و «نتوانستم واریز کنم» هر دو فهرست را از قاعده می‌گیرند');
ok(!/(pickAmountCard|pickWhiteCard)\(\{ cards: (cardSt\(\)|st)\.all\.all\(\)/.test(CODE), 'هیچ انتخاب‌گرِ کارتی کلِ فهرست را بی‌قاعده نمی‌گیرد');
ok(/const \{ cards, blocked, rules \} = cardsForUser\(p\.user_id, st\.all\.all\(\)\);\s*const \{ card, via \} = CA\.pickAmountCard\(\{ cards, /.test(CODE),
  'صدورِ فاکتور از فهرستِ مجازِ همان کاربر انتخاب می‌کند');
ok(/allowedFallback\(p\?\.user_id, /.test(CODE), 'فالبکِ صدورِ فاکتور هم از قاعده رد می‌شود');
ok(/WHERE user_id=\? AND source='admin'/.test(region('function cardsForUser', '\n}')), 'فقط تگِ دستیِ ادمین/پشتیبانی ملاک است، نه تگِ خودکار');
ok(/import \* as CR from '\.\/card-rules\.js';/.test(SRC), 'index.js ماژولِ قواعد را import می‌کند');
{
  const v = (SRC.match(/const PRODUCT_VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
  ok(v.length === 3 && (v[0] > 3 || (v[0] === 3 && v[1] >= 133)), 'PRODUCT_VERSION بامپ شد (بند ۲ج/۴)');
}

console.log(`\n${fail ? '❌' : '✅'} check-card-rules: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
