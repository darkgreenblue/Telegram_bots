#!/usr/bin/env node
// 👥 چکِ صفحه‌ی «کاربران» (`/users`) — رندرِ واقعی، نه فقط سینتکس.
//
// 🐛 باگِ واقعیِ همین چک (۱۴۰۵/۰۷/۰۴، گزارشِ مالک: «بخش کاربران باگ داره و هیچ کاربری
// رو نشون نمیده»): در `collectUsers` دو خط `testUserClause(b.key, 'p.user_id')` صدا
// می‌شد، ولی `b` در کلِ فایل **هیچ‌جا تعریف نشده بود** — کپی‌پیستِ یک نامِ متغیر از
// جای دیگر (بندِ ۹/۰ب ریشه: قبل از مقصردانستنِ دیتا، خودِ ابزار را بشکن). به‌جایش باید
// `inst.bot` باشد، دقیقاً همان چیزی که هر صدازننده‌ی دیگرِ `testUserClause` در کلِ
// داشبورد استفاده می‌کند (`overview.js`, `marketing.js`, خودِ `lib/bots.js`).
//
// ⚠️ چرا این بی‌صدا بود، نه یک صفحه‌ی خطا: `lib/bots.js: withDb` هر خطای داخلِ
// callbackش را می‌گیرد و فقط در stderr لاگ می‌کند (`logErr('dashboard withDb:', ...)`)
// تا خرابیِ یک دیتابیس صفحه‌ی کل را نشکند. ولی همین گارد یک `ReferenceError` را هم
// بی‌صدا می‌بلعد: برای **هر** ربات با جدولِ `payments` (یعنی عملاً همه — تاروت،
// voice2text)، `collectUsers` بدونِ هیچ throw ای خالی برمی‌گشت. صفحه رندر می‌شد،
// کدِ HTTP ۲۰۰ بود، فقط جدول خالی بود — دقیقاً همان چیزی که مالک دید.
//
// چرا هیچ چکی این را نگرفت: `node --check` فقط سینتکس است. `tools/check-undefined.mjs`
// فقط **فراخوانیِ تابع** (`NAME(`) را می‌سنجد؛ این‌جا نامِ فراخوانی‌شده (`testUserClause`)
// import شده بود و مشکل، آرگومانش (`b.key`) بود — یک شناسه‌ی برهنه، نه صدازدنِ تابع،
// پس آن چک اصلاً نمی‌دید. و boot smoke test فقط تا گاردِ ENV می‌رود، هیچ route ای اجرا
// نمی‌شود. یعنی این صفحه از روزِ merge شدنش (#271) تا امروز **هیچ پوششی نداشت**.
//
// روش: `usersBody`/`usersCsv` را روی یک دیتابیسِ **واقعیِ** SQLite (با جدولِ
// `payments`، دقیقاً شرطی که باگ را فعال می‌کرد) اجرا می‌کند و ثابت می‌کند کاربرانِ
// واقعی در خروجی هستند — نه فقط اینکه throw نمی‌شود، چون `withDb` خودش throw را قورت
// می‌دهد و یک ادعای «throw نکرد» به‌تنهایی هیچ چیز ثابت نمی‌کرد.
//
// اجرا: node tools/check-users-page.mjs   (بدون شبکه؛ فیکسچرِ SQLite در پوشه‌ی موقت)
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
const base = path.resolve('bots/dashboard');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

/* ── فیکسچر: تاروتِ فارسی، عمداً با جدولِ payments (شرطِ فعال‌شدنِ باگ: hasMoney=true) ──
   یک کاربرِ عادی با یک پرداختِ تأییدشده، به‌علاوه‌ی یک کاربرِ **تستی** (از فهرستِ
   testUsers خودِ tarot در lib/bots.js) با یک پرداختِ تأییدشده‌ی بزرگ‌تر — تا هم
   «کاربر اصلاً دیده می‌شود» سنجیده شود هم «testUserClause واقعاً همان رباتِ درست را
   گرفته»، نه فقط اینکه دیگر throw نمی‌کند. */
const TEST_USER = 409581917; // از bots/dashboard/lib/bots.js: testUsers جدولِ tarot
const root = mkdtempSync(path.join(tmpdir(), 'userscheck-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const now = Math.floor(Date.now() / 1000);
const D = 86400;
{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
      balance INTEGER DEFAULT 0, state TEXT DEFAULT '', last_seen INTEGER, created_at INTEGER);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending', step TEXT, original_amount INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT, created_at INTEGER);
  `);
  const u = db.prepare('INSERT INTO users(telegram_id,name,username,balance,last_seen,created_at) VALUES(?,?,?,?,?,?)');
  u.run(1, 'کاربرِ عادی', 'realbuyer', 5, now - D, now - 5 * D);
  u.run(TEST_USER, 'ادمین/تستر', 'ownertest', 12, now - 2 * D, now - 30 * D);
  const p = db.prepare("INSERT INTO payments(user_id,amount,status,created_at,updated_at) VALUES(?,?,'approved',?,?)");
  p.run(1, 30_000, now - 5 * D, now - 5 * D);          // پرداختِ **واقعیِ** کاربرِ عادی
  p.run(TEST_USER, 100_000, now - 30 * D, now - 30 * D); // پرداختِ **الکیِ** تسترِ خودِ مالک
  const e = db.prepare("INSERT INTO events(user_id,event,created_at) VALUES(?,?,?)");
  for (let i = 0; i < 4; i++) e.run(1, 'start', now - (i + 1) * D);
  db.close();
}
process.env.TAROT_DB_DIR = dataDir;
process.chdir(root); mkdirSync(path.join(root, 'data'), { recursive: true });

const { usersBody, usersCsv } = await import(`file://${base}/routes/users.js`);
const { fmt } = await import(`file://${base}/lib/util.js`);

console.log('\n👥 صفحه‌ی «کاربران» — رندرِ واقعی روی دیتابیسِ رباتی که جدولِ payments دارد\n');

console.log('▶ ۱) صفحه واقعاً کاربران را نشان می‌دهد، نه یک جدولِ خالی');
let html;
{
  html = usersBody(new URL('http://x/users?bot=tarot'));
  ok(typeof html === 'string' && html.length > 0, 'usersBody بدون throw برگشت');
  ok(!/کاربری با این فیلتر پیدا نشد/.test(html),
    'پیامِ «کاربری پیدا نشد» دیده نمی‌شود (دقیقاً همان علامتِ باگِ اصلی)');
  ok(html.includes(`${fmt(2)} کاربر با این فیلتر`),
    `شمارشِ بالای صفحه درست است: ۲ کاربر (fmt(2)=${fmt(2)})`);
  ok(html.includes('کاربرِ عادی') && html.includes('@realbuyer'),
    'کاربرِ عادی با نام و یوزرنیمش در جدول هست');
  ok(html.includes(`id=${TEST_USER}`), 'ردیفِ کاربرِ تستر هم در جدول هست (حذف نمی‌شود، فقط درآمدش فیلتر می‌شود)');
}

console.log('\n▶ ۲) testUserClause واقعاً رباتِ درست را گرفته (نه یک رشته‌ی خالی/اشتباه)');
{
  // ردیفِ کاربرِ عادی: پرداختش واقعی است، پس باید «۱ × ۳۰٬۰۰۰ ت» دیده شود.
  const rowOf = (uid) => {
    const at = html.indexOf(`id=${uid}`);
    const trStart = html.lastIndexOf('<tr>', at);
    const trEnd = html.indexOf('</tr>', at);
    return html.slice(trStart, trEnd);
  };
  const normalRow = rowOf(1);
  ok(new RegExp(`${fmt(1)}\\s*×.*${fmt(30000)}`).test(normalRow),
    `ردیفِ کاربرِ عادی مبلغِ پرداختِ واقعی‌اش را نشان می‌دهد (۱ × ۳۰٬۰۰۰ ت)`);

  /* ⚠️ نکته‌ی محوریِ این بخش: اگر `inst.bot` به‌جای `b.key` با یک مقدارِ **نادرست**
     جایگزین شده بود (مثلاً رشته‌ی خالی، یا کلیدِ یک رباتِ دیگر که testUsers ندارد)،
     برنامه دیگر throw نمی‌کرد ولی `testUserClause` هم هیچ فیلتری اعمال نمی‌کرد —
     یعنی پرداختِ الکیِ تستر مثلِ پرداختِ واقعی نشان داده می‌شد. پس صرفِ «رندر شد
     بدونِ throw» کافی نیست؛ باید ثابت شود که فیلترِ تسترها هنوز **واقعاً** کار
     می‌کند. ردیفِ تستر باید «-» نشان بدهد، نه «۱ × ۱۰۰٬۰۰۰ ت». */
  const testerRow = rowOf(TEST_USER);
  ok(/<span class="muted">-<\/span>/.test(testerRow),
    'ردیفِ تستر «-» نشان می‌دهد (پرداختِ الکی‌اش از پرداخت‌های نمایش‌داده‌شده فیلتر شده)');
  ok(!testerRow.includes(fmt(100000)),
    'و مبلغِ ۱۰۰٬۰۰۰ی تستر هیچ‌جای همان ردیف چاپ نشده');
}

console.log('\n▶ ۳) فیلترِ «فقط خریدارها» هم همان مسیرِ باگ‌دار را رد می‌کند، پس باید سالم بماند');
{
  const payersHtml = usersBody(new URL('http://x/users?bot=tarot&payers=1'));
  ok(payersHtml.includes('کاربرِ عادی'), 'کاربرِ عادی (واقعاً خریدار) با فیلترِ خریدارها هنوز دیده می‌شود');
  /* تسترِ ما هم فنیاً یک ردیفِ approved دارد، ولی چون paidCnt همان کوئریِ فیلترشده
     است که تسترها را کنار می‌گذارد، شرطِ payers هم باید او را از این نتیجه بیندازد —
     همان مسیرِ کدی که خط ۶۴ی users.js را اجرا می‌کند (paidCnt > 0). */
  ok(!payersHtml.includes(`id=${TEST_USER}`),
    'ولی تستر با فیلترِ خریدارها دیده نمی‌شود (پرداختش برای این فیلتر هم صفر حساب می‌شود)');
}

console.log('\n▶ ۴) مرتب‌سازیِ «بیشترین پرداخت» هم همان کوئری را می‌سازد، پس باید throw نکند');
{
  const paidSortHtml = usersBody(new URL('http://x/users?bot=tarot&sort=paid'));
  ok(paidSortHtml.includes('کاربرِ عادی'), 'مرتب‌سازیِ paid هم صفحه را می‌شکند نمی‌شکند');
}

console.log('\n▶ ۵) خروجیِ CSV هم از همان collectUsers می‌آید و باید ردیفِ واقعی داشته باشد');
{
  const csv = usersCsv(new URL('http://x/users.csv?bot=tarot'));
  const lines = csv.split('\n');
  ok(lines.length === 3, `هدر + ۲ ردیف = ۳ خط (شد ${lines.length})`);
  ok(csv.includes('کاربرِ عادی') && csv.includes('realbuyer'), 'ردیفِ CSVِ کاربرِ عادی هست');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
