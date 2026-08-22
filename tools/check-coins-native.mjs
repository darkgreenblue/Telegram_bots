#!/usr/bin/env node
// 💎 چکِ مهاجرتِ «الماس واحدِ واقعی» — منطق روی یک SQLite واقعی **اجرا** می‌شود.
//
// چرا رفتاری و نه رجکسی: این اسکریپت به موجودیِ کاربرانِ یک رباتِ زنده و درآمدزا دست
// می‌زند. درسِ گران‌قیمتِ مهاجرتِ قبلی (۱۴۰۵/۰۵/۳۰) این بود که چکِ رجکسی باگِ
// «تبدیلِ دوباره» را **ندید**، چون کد را اجرا نمی‌کرد و فقط سورس را می‌خواند.
//
// اجرا: node tools/check-coins-native.mjs
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';
import { SCALE, MIGRATION_KEY, migrate, migrationDone, survey } from './coins-native-tarot.mjs';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

/** دیتابیسی با دقیقاً همان شکلِ ردیف‌های واقعیِ تولید. */
function makeDb(dir, name = 'bot-fa.db') {
  const db = new Database(path.join(dir, name));
  db.exec(`
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER DEFAULT 0);
    CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, price INTEGER, status TEXT);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER,
                           original_amount INTEGER, status TEXT, pkg TEXT DEFAULT '');
    CREATE TABLE admin_actions (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, done_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT, props TEXT);`);
  // SAMANTHA: ۱۹۷ الماس (همان ردیفِ واقعیِ لحظه‌ی نوشتنِ این چک)
  db.prepare('INSERT INTO users VALUES (?,?)').run(37578585, 1_970_000);
  db.prepare('INSERT INTO users VALUES (?,?)').run(2, 50_000);   // ۵ الماس
  db.prepare('INSERT INTO users VALUES (?,?)').run(3, 0);        // بی‌موجودی
  db.prepare('INSERT INTO readings VALUES (?,?,?,?)').run(1, 2, 30_000, 'delivered');       // ۳ کارتی
  db.prepare('INSERT INTO readings VALUES (?,?,?,?)').run(2, 2, 100_000, 'pending_payment'); // ۱۰ کارتیِ در جریان
  // پرداختِ بسته‌ی جادویی: ۱۵۰٬۰۰۰ تومانِ **واقعی** در برابرِ ۱٬۰۰۰٬۰۰۰ اعتبار
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(153, 37578585, 150_000, 1_000_000, 'approved', 'magic');
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(154, 2, 24_000, 30_000, 'waiting_review', '');
  db.prepare('INSERT INTO admin_actions VALUES (?,?,?,?)').run(1, 37578585, 1_000_000, null); // در صف
  db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(1, 2, 'credit_granted', JSON.stringify({ amount: 50_000, kind: 'welcome' }));
  db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(2, 2, 'credit_adjusted', JSON.stringify({ amount: -10_000, kind: 'support' }));
  db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(3, 2, 'product_delivered', JSON.stringify({ amount: 99_999 }));
  return db;
}

const dir = mkdtempSync(path.join(tmpdir(), 'coins-'));
try {
  console.log('▶ مهاجرت: هر عددِ اعتباری ÷۱۰٬۰۰۰ می‌شود، پولِ واقعی دست‌نخورده');
  {
    const db = makeDb(dir);
    ok(!migrationDone(db), 'قبل از اجرا مهر نخورده');
    migrate(db);

    const bal = (id) => db.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(id).b;
    ok(bal(37578585) === 197, 'موجودیِ ۱٬۹۷۰٬۰۰۰ به ۱۹۷ الماس تبدیل شد');
    ok(bal(2) === 5, 'موجودیِ ۵۰٬۰۰۰ به ۵ الماس');
    ok(bal(3) === 0, 'موجودیِ صفر صفر ماند');

    const pr = (id) => db.prepare('SELECT price p FROM readings WHERE id=?').get(id).p;
    ok(pr(1) === 3, 'قیمتِ فالِ سه‌کارتی ۳ الماس شد');
    ok(pr(2) === 10, 'و فالِ در جریان (۱۰ کارتی) هم تبدیل شد — وگرنه وسطِ کار می‌شکست');

    const p153 = db.prepare('SELECT * FROM payments WHERE id=153').get();
    // ⚠️ مهم‌ترین ادعای این فایل: `amount` پولِ واقعی است و **هرگز** نباید تبدیل شود.
    ok(p153.amount === 150_000, 'مبلغِ پرداختیِ واقعی (۱۵۰٬۰۰۰ تومان) دست‌نخورده ماند');
    ok(p153.original_amount === 100, 'ولی اعتبارش ۱۰۰ الماس شد');
    const p154 = db.prepare('SELECT * FROM payments WHERE id=154').get();
    ok(p154.amount === 24_000, 'پرداختِ در انتظارِ تأیید هم تومانش دست‌نخورده');
    ok(p154.original_amount === 3, 'و اعتبارش تبدیل شد (وگرنه بعد از تأیید ۳۰٬۰۰۰ الماس می‌داد)');

    ok(db.prepare('SELECT amount a FROM admin_actions WHERE id=1').get().a === 100,
      'اقدامِ در صفِ ادمین تبدیل شد (وگرنه sweep ۱٬۰۰۰٬۰۰۰ الماس می‌داد)');

    const ev = (id) => JSON.parse(db.prepare('SELECT props p FROM events WHERE id=?').get(id).p);
    ok(ev(1).amount === 5, 'رویدادِ credit_granted تبدیل شد');
    ok(ev(1).kind === 'welcome', 'و بقیه‌ی propهایش دست‌نخورده ماند');
    ok(ev(2).amount === -1, 'رویدادِ credit_adjusted (منفی) هم درست تبدیل شد');
    ok(ev(3).amount === 99_999, 'ولی رویدادِ غیراعتباری اصلاً دست نخورد');

    ok(migrationDone(db), 'مهر داخلِ همان تراکنش خورد');
    db.close();
  }

  console.log('\n▶ 🔁 اجرای دوباره هیچ‌چیز را دوباره تقسیم نمی‌کند');
  {
    const d2 = mkdtempSync(path.join(tmpdir(), 'coins2-'));
    const db = makeDb(d2);
    migrate(db);
    const after1 = db.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(37578585).b;
    // در تولید، گاردِ `migrationDone` جلوی اجرای دوم را می‌گیرد. این‌جا خودِ آن گارد
    // آزموده می‌شود: اگر روزی برداشته شود، این ادعا قرمز می‌کند.
    ok(migrationDone(db), 'گاردِ اجرای دوباره فعال است');
    if (!migrationDone(db)) migrate(db);
    ok(db.prepare('SELECT balance b FROM users WHERE telegram_id=?').get(37578585).b === after1,
      'موجودی بعد از تلاشِ دوم عوض نشد');
    db.close(); rmSync(d2, { recursive: true, force: true });
  }

  console.log('\n▶ ⚠️ عددِ غیرمضرب گرد می‌شود، نه اینکه بسوزد');
  {
    const d3 = mkdtempSync(path.join(tmpdir(), 'coins3-'));
    const db = makeDb(d3, 'bot-fa.db');
    db.prepare('INSERT INTO users VALUES (?,?)').run(9, 5_000);   // نصفِ یک الماس
    const s = survey(db);
    ok(s.odd.users >= 1, 'گزارشِ dry-run ردیفِ غیرمضرب را هشدار می‌دهد');
    migrate(db);
    ok(db.prepare('SELECT balance b FROM users WHERE telegram_id=9').get().b === 1,
      '۵٬۰۰۰ به ۱ الماس گرد شد (نه صفر — اعتبارِ کاربر نمی‌سوزد)');
    db.close(); rmSync(d3, { recursive: true, force: true });
  }

  console.log('\n▶ 🔒 قرارداد با کدِ ربات');
  {
    const SRC = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
    const SPREADS = readFileSync(path.resolve('bots/tarot/spreads.js'), 'utf8');
    // بعد از مهاجرت، ضریب باید از کد **حذف** شده باشد وگرنه دوباره ضرب می‌شود.
    ok(!/\bCOIN_VALUE\b/.test(SRC), 'COIN_VALUE از کدِ ربات کاملاً حذف شده');
    ok(/const PER_CARD = 1;/.test(SPREADS), 'هر کارت = ۱ الماس (قیمت دیگر ضرب نمی‌شود)');
    ok(SCALE === 10_000, 'ضریبِ مهاجرت همان چیزی است که در تولید بود');
    /* 🛑 مسیرهای تومانیِ کهنه باید بسته باشند، وگرنه یک دکمه‌ی کش‌شده‌ی `ramt:50000` در
       چتِ یک کاربرِ قدیمی فاکتورِ ۵۰٬۰۰۰ **الماس** می‌سازد.
       ⚠️ ادعا عمداً **اجرا** می‌شود نه رجکس: نسخه‌ی اولش فقط وجودِ نامِ helper را می‌دید و
       در تستِ جهش، خاموش‌کردنش (`=> false`) را **اصلاً نگرفت**. */
    const guardSrc = (SRC.match(/const legacyTomanPay = ([^;]+);/) || [])[1];
    ok(!!guardSrc, 'گاردِ مسیرهای پرداختِ کهنه تعریف شده');
    const guard = new Function('coinsOn', `return ${guardSrc}`);
    ok(guard(() => true)(1) === true, 'برای کاربرِ الماسی مسیرِ کهنه بسته است');
    ok(guard(() => false)(1) === false, 'و برای کاربرِ تومانی (اگر روزی برگردد) باز می‌ماند');

    // و باید **اولین** کارِ هر دو تابع باشد، قبل از هر خواندن/نوشتنی.
    for (const fn of ['setRechargeAmount', 'invoiceForReading']) {
      const body = SRC.slice(SRC.indexOf(`async function ${fn}(`), SRC.indexOf(`async function ${fn}(`) + 400);
      const gi = body.indexOf('legacyTomanPay');
      const ci = body.indexOf('claimAmount');
      ok(gi > 0 && (ci === -1 || gi < ci), `${fn} قبل از هر ادعای مبلغ گارد می‌شود`);
    }
  }

  console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
  if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
