// چکِ CI برای «💙 کاربرِ بلو ⟵ کارتِ بلو» و سیدِ دومِ کارت‌ها (tarot، v3.130.0؛ تصمیم‌های مالک ۱۴۰۵/۰۷/۰۴).
//
// تصمیم‌هایی که قفل می‌شوند:
//   • کارت‌ها: سه عادی (بلو، پاسارگاد، خاورمیانه) + یک سفید (شهر)، همه با ادمینِ مالک.
//   • «کاربرِ بلو» = بانکِ مؤثرِ **آخرین** رسیدِ تگ‌دار و ردنشده‌اش بلو باشد.
//   • فاکتورِ کاربرِ بلو بیرون از نوبت روی کارتِ عادیِ بلو (فعال و زیرِ سقف؛ وگرنه چرخشِ معمول)؛
//     شمارنده‌ی چرخش جلو نمی‌رود؛ کارتِ بلو برای بقیه در چرخش می‌ماند؛ چسبندگیِ امروز مقدم است.
//   • اپِ بلو + پیش‌شماره‌ی مبهم یا خوانده‌نشده ⟵ بانکِ بلو؛ پیش‌شماره‌ی صریحِ بانکِ دیگر مقدم.
// کدِ واقعیِ index.js بریده و روی SQLite اجرا می‌شود.
import * as CA from '../bots/tarot/cards-admin.js';
import * as RT from '../bots/tarot/receipt-tags.js';
import { readFileSync } from 'fs';
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
const OWNER = 111, BLU = 50;

console.log('\n💙 کاربرِ بلو و کارت‌های تازه\n');

/* ── ۱) خالص ───────────────────────────────────────────────────────────────── */
console.log('خالص:');
{
  const C = (id, kind, sort, extra = {}) => ({ id, kind, sort, active: 1, daily_cap: 0, admin_id: OWNER, ...extra });
  const cards = [C(1, 'regular', 1), C(2, 'regular', 2), C(3, 'regular', 3), C(4, 'white', 4)];
  const P = (o) => CA.pickDailyCard({ cards, ...o });
  ok(P({ n: 1, preferIds: [1], preferVia: 'blu_user' }).card.id === 1 && P({ n: 1, preferIds: [1], preferVia: 'blu_user' }).via === 'blu_user',
    'کارتِ ترجیحی بیرون از نوبت (نوبت ۱ کارتِ ۲ بود)');
  ok(P({ n: 1 }).card.id === 2 && P({ n: 1, preferIds: [] }).via === 'rotation', 'بدونِ ترجیح ⟵ رفتارِ قبلی بیت‌به‌بیت');
  ok(CA.pickDailyCard({ cards: cards.map((c) => (c.id === 1 ? { ...c, daily_cap: 3 } : c)), used: new Map([[1, 3]]), n: 1, preferIds: [1] }).via === 'rotation',
    'کارتِ بلو پر ⟵ چرخشِ معمول');
  ok(CA.pickDailyCard({ cards: cards.map((c) => (c.id === 1 ? { ...c, active: 0 } : c)), n: 0, preferIds: [1] }).card.id === 2, 'کارتِ بلو غیرفعال ⟵ چرخشِ معمول');
  ok(P({ stickyId: 3, preferIds: [1] }).card.id === 3, 'چسبندگیِ امروز (مثلاً بعد از تعویض) بر ترجیح مقدم است');

  const T = (pid, key, source = 'auto') => ({ payment_id: pid, dim: 'bank', value_key: key, source });
  ok(RT.lastBank([T(1, 'blu'), T(2, 'melli')]) === 'melli' && RT.lastBank([T(5, 'blu'), T(2, 'melli')]) === 'blu', 'آخرین رسیدِ تگ‌دار ملاک است، نه اکثریت');
  ok(RT.lastBank([T(3, 'saman'), T(3, 'blu', 'admin')]) === 'blu', 'تگِ دستیِ مالک بر خودکار مقدم');
  ok(RT.lastBank([{ payment_id: 9, dim: 'app', value_key: 'blu', source: 'auto' }]) === null && RT.lastBank([]) === null, 'بدونِ تگِ بانک ⟵ null');
  const A = (o) => JSON.stringify(RT.autoTagsFrom(o).filter((t) => t.dim === 'bank'));
  ok(A({ app: 'blu', src_prefix: '621986' }) === '[{"dim":"bank","key":"blu"}]' && A({ app: 'blu', src_prefix: null }) === '[{"dim":"bank","key":"blu"}]',
    'اپِ بلو + پیش‌شماره‌ی مبهم/خوانده‌نشده ⟵ بانکِ بلو');
  ok(A({ app: 'blu', src_prefix: '603799' }) === '[{"dim":"bank","key":"melli"}]' && A({ app: 'ap', src_prefix: '621986' }) === '[]',
    'پیش‌شماره‌ی صریح مقدم؛ اپِ دیگر روی مبهم هیچ');
  ok(RT.bankFromPrefix('6219861904145405') === 'blu' && RT.bankFromPrefix('5022291612282234') === 'pasargad'
    && RT.bankFromPrefix('5859471120915172') === 'khavarmianeh' && RT.bankFromPrefix('5047061675180547') === 'shahr',
    'کارتِ بلوی خودمان از پیش‌شماره‌اش بلو شناخته می‌شود؛ بقیه هم درست');
}

/* ── ۲) رفتاری: سیدها + انتخابِ کارتِ فاکتور ───────────────────────────────── */
console.log('\nرفتاری:');
const readers = region('let _cardSt = null;', '\nfunction cardOfPayment', { includeTo: false });
const issue = region('function issueInvoiceCard(paymentId)', '\n// خطِ زیرِ شماره روی فاکتور', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const seed2 = region('/* 💳 سیدِ دوم', "VALUES ('cards_seed_2', unixepoch())\").run();\n})();");

function boot({ flag = true, bluUsers = [BLU], prep = null } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, status TEXT NOT NULL DEFAULT 'pending')`);
  const errs = [];
  const env = { CA: { ...CA, cardDay: () => '2026-09-26' }, RT, db, OWNER_ID: OWNER, CARD_ROTATION_ENABLED: true, starsRail: false,
    BLU_USER_CARD_ENABLED: flag, isBluUser: (u) => bluUsers.includes(u),
    log: () => {}, logErr: (...a) => errs.push(a.join(' ')), track: () => {} };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `const LEGACY_CARD = { id: 0, number: '6219861904145405', holder: 'x', bank: '', kind: 'regular', active: 1, admin_id: OWNER_ID };
    ${readers}\n${schema}\n${prep || ''}\n${seed2}\n${issue}
    return { issueInvoiceCard, markApprovedDay };`;
  const h = { ...new Function(...Object.keys(env), body)(...Object.values(env)), db, errs };
  h.seed2 = () => new Function('db', 'OWNER_ID', seed2)(db, OWNER);
  h.invoice = (uid) => { const id = Number(db.prepare('INSERT INTO payments (user_id, amount) VALUES (?, 60000)').run(uid).lastInsertRowid); h.issueInvoiceCard(id); return id; };
  h.cardOf = (pid) => db.prepare('SELECT card_id FROM payments WHERE id=?').get(pid).card_id;
  h.via = (uid) => db.prepare("SELECT via FROM card_assign WHERE user_id=? AND day='2026-09-26'").get(uid)?.via;
  h.rot = () => db.prepare("SELECT n FROM card_rotation WHERE day='2026-09-26'").get()?.n || 0;
  return h;
}

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کد شکست خورد:', e.stack); }
if (h) {
  const { db } = h;
  const cards = db.prepare('SELECT id, number, bank, kind, admin_id, active FROM cards ORDER BY sort, id').all();
  ok(JSON.stringify(cards.map((c) => [c.number, c.kind])) === JSON.stringify([
    ['6219861904145405', 'regular'], ['5022291612282234', 'regular'], ['5859471120915172', 'regular'], ['5047061675180547', 'white']]),
  'سید: بلو، پاسارگاد (حالا عادی)، خاورمیانه عادی، شهر سفید');
  ok(cards.every((c) => c.admin_id === OWNER && c.active === 1) && cards.every((c) => CA.luhnOk(c.number)), 'همه فعال با ادمینِ مالک و شماره‌ی معتبر (Luhn)');
  ok(/خاورمیانه/.test(cards[2].bank) && /شهر/.test(cards[3].bank), 'برچسبِ بانک‌ها');
  db.prepare("UPDATE cards SET kind='white' WHERE number='5022291612282234'").run();
  h.seed2();
  ok(db.prepare('SELECT COUNT(*) n FROM cards').get().n === 4 && db.prepare("SELECT kind FROM cards WHERE number='5022291612282234'").get().kind === 'white',
    'سیدِ دوم یک‌باره است: کارت تکرار نمی‌شود و تغییرِ بعدیِ مالک برنمی‌گردد');
  db.prepare("UPDATE cards SET kind='regular' WHERE number='5022291612282234'").run();

  const u1 = h.invoice(1);
  const b1 = h.invoice(BLU);
  const u2 = h.invoice(2), u3 = h.invoice(3);
  ok(h.cardOf(u1) === 1 && h.cardOf(u2) === 2 && h.cardOf(u3) === 3, 'کاربرانِ دیگر بینِ سه عادی (بلو هم) به نوبت می‌چرخند');
  ok(h.cardOf(b1) === 1 && h.via(BLU) === 'blu_user' && h.rot() === 3, 'کاربرِ بلو ⟵ کارتِ بلو، و نوبتِ کسی را نخورد');
  ok(h.cardOf(h.invoice(BLU)) === 1, 'فاکتورِ دومِ کاربرِ بلو هم بلو');
  ok(!h.errs.length, 'هیچ خطایی');

  // سقفِ بلو پر ⟵ کاربرِ بلوِ تازه به چرخش.
  const hc = boot({ bluUsers: [BLU, 51] });
  hc.db.prepare('UPDATE cards SET daily_cap=1 WHERE id=1').run();
  const x = hc.invoice(BLU);
  hc.db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(x);
  hc.markApprovedDay(x);
  const y = hc.invoice(51);
  ok(hc.cardOf(x) === 1 && hc.cardOf(y) === 2 && hc.via(51) === 'rotation', 'کارتِ بلو پر شد ⟵ کاربرِ بلوِ بعدی به چرخشِ معمول');

  const hf = boot({ flag: false });
  hf.invoice(1);
  ok(hf.cardOf(hf.invoice(BLU)) === 2 && hf.via(BLU) === 'rotation', 'رول‌بک (BLU_USER_CARD_ENABLED=false) ⟵ کاربرِ بلو هم به نوبت');
}

/* ── ۳) isBluUserِ واقعی روی جدولِ تگ‌ها ─────────────────────────────────────── */
console.log('\nتشخیصِ کاربرِ بلو:');
{
  const tagSchema = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ اپ/بانکِ مبدأ per رسید.', "} catch (e) { logErr('tag_values seed:', e.message); }");
  const tagHelpers = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ دستیِ اپ/بانک، فقط روی پیام‌های رسیدِ **مالک**.', '\n/** ارسالِ یک پیامِ رسید به گیرنده‌هایش.', { includeTo: false });
  const db = new Database(':memory:');
  db.exec("CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT)");
  const errs = [];
  const env = { db, RT, OWNER_ID: OWNER, RECEIPT_TAGS_ENABLED: true, starsRail: false, log: () => {}, logErr: (...a) => errs.push(a.join(' ')),
    stmts: {}, bot: { use: () => {}, telegram: {} } };
  try {
    const f = new Function(...Object.keys(env), `${tagSchema}\n${tagHelpers}\nreturn { isBluUser };`);
    const { isBluUser } = f(...Object.values(env));
    const tag = (pid, uid, status, key, source = 'auto') => {
      db.prepare('INSERT OR IGNORE INTO payments (id, user_id, status) VALUES (?,?,?)').run(pid, uid, status);
      db.prepare('INSERT INTO receipt_tags (payment_id, user_id, dim, value_key, source) VALUES (?,?,?,?,?)').run(pid, uid, 'bank', key, source);
    };
    tag(1, 7, 'approved', 'melli'); tag(2, 7, 'approved', 'blu');
    tag(3, 8, 'approved', 'blu'); tag(4, 8, 'approved', 'saman');
    tag(5, 9, 'approved', 'blu'); tag(6, 9, 'rejected', 'melli');
    tag(7, 10, 'approved', 'saman'); tag(7, 10, 'approved', 'blu', 'admin');
    ok(isBluUser(7) && !isBluUser(8), 'آخرین رسید بلو ⟵ بلو؛ آخرین رسید سامان ⟵ نه (حتی با بلوِ قبلی)');
    ok(isBluUser(9), 'رسیدِ ردشده‌ی بعدی نادیده گرفته می‌شود');
    ok(isBluUser(10), 'اصلاحِ دستیِ مالک به بلو ⟵ بلو');
    ok(!isBluUser(99) && !isBluUser(0) && !errs.length, 'کاربرِ بی‌تگ ⟵ نه، بی‌خطا');
  } catch (e) { fail++; console.error('  ❌', e.stack); }
}

/* ── ۴) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
ok(/const BLU_USER_CARD_ENABLED = true;/.test(SRC), 'پرچمِ رول‌بک روشن منتشر شده');
ok(/BLU_USER_CARD_ENABLED && isBluUser\(p\.user_id\)/.test(SRC) && /c\.kind === 'regular' && RT\.bankFromPrefix\(c\.number\) === 'blu'/.test(SRC),
  'فقط کارتِ **عادیِ** بلو (سفید هرگز) و فقط پشتِ پرچم');

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
