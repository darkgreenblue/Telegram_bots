// چکِ CI برای دو خطِ پولیِ فقط-مالک زیرِ پیامِ رسید (tarot، v3.140.0، خواسته‌ی مالک ۱۴۰۵/۰۷/۰۹):
//   «مجموعاً n تومان»             = پرداخت‌های تأییدشده‌ی دیگرِ کاربر + همین یکی
//   «💰 درآمد امروز تا این لحظه»   = همان تعریفِ درآمدِ داشبورد (تأییدشده، ساختِ ردیف از ۰۰:۰۰ تهران، بدونِ تستی‌ها)
//
// کدِ واقعیِ index.js بریده و روی SQLite اجرا می‌شود. سه خرابیِ بی‌صدا که این‌جا گرفته می‌شوند:
//   ۱) شکلِ پارامترِ کوئری با better-sqlite3 نخواند ⟵ catch ⟵ خطِ خالی، بدونِ هیچ خطای قابلِ‌دیدن
//      (نسخه‌ی اولِ همین کار دقیقاً این را داشت و فقط چکِ رفتاری گرفتش).
//   ۲) فهرستِ حساب‌های تستی از رجیستریِ داشبورد جدا شود ⟵ عددِ زیرِ رسید با داشبورد نخواند.
//   ۳) کوئریِ «امروز» از ایندکس بیفتد ⟵ هر رسید کلِ جدولِ پرداخت‌ها را روی سرورِ دیسک‌محدود بخواند.
import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const Database = createRequire(path.resolve('bots/tarot/package.json'))('better-sqlite3');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function region(from, to) {
  const a = SRC.indexOf(from), b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» پیدا نشد`); return ''; }
  return SRC.slice(a, b);
}
const body = region('/* 💰 دو خطِ **فقط-مالک**', '/* 📋 رسیدِ **متنی**');

console.log('\n💰 دو خطِ پولیِ فقط-مالک زیرِ رسید\n');

const DAY0 = 1_790_000_000;                       // «امروز از ۰۰:۰۰ تهران» در این فیکسچر
const fa = (n) => n.toLocaleString('fa-IR');
function boot({ flag = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER, approved_at INTEGER);
    CREATE INDEX idx_payments_status_approved ON payments(status, approved_at);`);
  const errs = [];
  const src = flag ? body : body.replace('const OWNER_MONEY_LINES_ENABLED = true;', 'const OWNER_MONEY_LINES_ENABLED = false;');
  const f = new Function('db', 'CA', 'logErr', `${src}\nreturn { ownerMoneyLines, REVENUE_TEST_USERS };`);
  const h = f(db, { cardDayStartSec: () => DAY0 }, (...a) => errs.push(a.join(' ')));
  const pay = (uid, amount, status, created, approved = null) => Number(db.prepare(
    'INSERT INTO payments (user_id, amount, status, created_at, approved_at) VALUES (?,?,?,?,?)')
    .run(uid, amount, status, created, approved).lastInsertRowid);
  const row = (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  return { ...h, db, errs, pay, row };
}

const h = boot();
if (h.ownerMoneyLines) {
  const U = 9, T = h.REVENUE_TEST_USERS[0];
  // سوابقِ کاربر: دو تأییدشده‌ی قبلی (یکی دیروز) + ردشده/لغوشده/کاربرِ دیگر که نباید بیایند.
  h.pay(U, 60000, 'approved', DAY0 - 90000, DAY0 - 89000);
  h.pay(U, 120000, 'approved', DAY0 + 100, DAY0 + 200);
  h.pay(U, 30000, 'rejected', DAY0 + 300);
  h.pay(U, 30000, 'canceled', DAY0 + 400);
  // درآمدِ امروز: کاربرانِ دیگر.
  h.pay(21, 45000, 'approved', DAY0 + 500, DAY0 + 600);          // ✅ امروز
  h.pay(22, 90000, 'approved', DAY0 - 120, DAY0 + 30);          // ❌ ساختِ ردیف دیروز (تعریفِ داشبورد)
  h.pay(T, 150000, 'approved', DAY0 + 700, DAY0 + 800);         // ❌ حسابِ تستی
  h.pay(23, 15000, 'waiting_review', DAY0 + 900);               // ❌ هنوز تأیید نشده
  const cur = h.pay(U, 60000, 'waiting_review', DAY0 + 1000);   // رسیدِ همین پیام
  const lines = h.ownerMoneyLines(h.row(cur)).split('\n');
  const TODAY = 120000 + 45000;
  ok(lines[0] === `مجموعاً ${fa(60000 + 120000 + 60000)} تومان`,
    `مجموعاً = تأییدشده‌های قبلیِ کاربر + همین رسید؛ ردشده/لغوشده/کاربرِ دیگر نه (${lines[0]})`);
  ok(lines[1] === `💰 درآمد امروز تا این لحظه: ${fa(TODAY)} تومان`,
    `درآمدِ امروز: فقط تأییدشده‌های ساخته‌شده از ۰۰:۰۰، بدونِ حسابِ تستی و بدونِ رسیدِ هنوز-نه (${lines[1]})`);
  ok(lines.length === 2 && !h.errs.length, 'دقیقاً دو خط، بدونِ هیچ خطا');
  // پیامِ «تأیید شد»: خودِ پرداخت از قبل approved است و نباید دو بار شمرده شود.
  h.db.prepare("UPDATE payments SET status='approved', approved_at=? WHERE id=?").run(DAY0 + 1100, cur);
  const after = h.ownerMoneyLines(h.row(cur)).split('\n');
  ok(after[0] === `مجموعاً ${fa(240000)} تومان` && after[1] === `💰 درآمد امروز تا این لحظه: ${fa(TODAY + 60000)} تومان`,
    'بعد از تأیید: مجموع خودش را دو بار نمی‌شمارد، و درآمدِ امروز همین پرداخت را هم دارد');
  // نیمه‌شب: روزِ تازه ⟵ درآمدِ امروز صفر.
  const h2 = boot();
  h2.pay(21, 45000, 'approved', DAY0 - 500, DAY0 - 400);
  const c2 = h2.pay(9, 60000, 'waiting_review', DAY0 + 10);
  ok(h2.ownerMoneyLines(h2.row(c2)).endsWith(`درآمد امروز تا این لحظه: ۰ تومان`), 'روزِ تازه: درآمدِ دیروز در «امروز» نمی‌آید');
  // خطای خواندن هرگز پیامِ رسید را نمی‌شکند.
  h2.db.exec('DROP TABLE payments');
  ok(h2.ownerMoneyLines({ id: 1, user_id: 9, amount: 1 }) === '' && h2.errs.some((e) => /ownerMoneyLines/.test(e)),
    'خطای دیتابیس ⟵ رشته‌ی خالی + لاگ، هرگز پرتاب');
  // رول‌بک.
  const off = boot({ flag: false });
  const c3 = off.pay(9, 60000, 'waiting_review', DAY0 + 10);
  ok(off.ownerMoneyLines(off.row(c3)) === '', 'رول‌بک (OWNER_MONEY_LINES_ENABLED=false) ⟵ هیچ خطی');
  // کوئریِ امروز روی ایندکس، نه اسکنِ کلِ جدول.
  const todaySql = ((body.match(/today: db\.prepare\(`([\s\S]*?)`\)/) || [])[1] || '')
    .replace("${REVENUE_TEST_USERS.join(',')}", h.REVENUE_TEST_USERS.join(','));
  const plan = todaySql ? h.db.prepare(`EXPLAIN QUERY PLAN ${todaySql}`).all(DAY0, DAY0).map((r) => r.detail).join(' | ') : '';
  ok(/USING INDEX idx_payments_status_approved \(status=\? AND approved_at>\?\)/.test(plan), `کوئریِ «امروز» روی ایندکس و بازه‌ی امروز (${plan})`);
}

// تک‌منبعِ حساب‌های تستی: همان فهرستِ رجیستریِ داشبورد.
{
  const reg = readFileSync('bots/dashboard/lib/bots.js', 'utf8');
  const tarotRow = reg.slice(reg.indexOf("key: 'tarot'"), reg.indexOf("key: 'tarot'") + 20000);
  const dash = ((tarotRow.match(/testUsers:\s*\[([^\]]*)\]/) || [])[1] || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
  const bot = h.REVENUE_TEST_USERS || [];
  ok(dash.length > 0 && JSON.stringify([...dash].sort()) === JSON.stringify([...bot].sort()),
    `REVENUE_TEST_USERS دقیقاً همان testUsersِ رجیستریِ داشبورد است (ربات: ${bot.join(',')} · داشبورد: ${dash.join(',')})`);
}

// ساختاری: فقط پیامِ مالک.
ok(/const sline = \[info, ownerMoneyLines\(p\), ownerShadowLine\(p\)\]/.test(CODE)
  && /withShadowLine\(base, r\.id === OWNER_ID \? sline : info, limit\)/.test(CODE),
  'دو خط فقط در دُمِ پیامِ OWNER_ID (ادمین‌های دیگرِ کارت فقط کارت و سوابق را می‌بینند)');
ok((CODE.match(/ownerMoneyLines\(/g) || []).length === 2, 'تک‌نقطه: تعریف + یک مصرف‌کننده');

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
