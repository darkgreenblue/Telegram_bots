#!/usr/bin/env node
// 💎 چکِ مهاجرتِ تومان ⟶ الماس — **رفتاری**، روی SQLite واقعیِ در-حافظه.
//
// چرا این فایل هست: این اسکریپت یک بار روی دیتابیسِ یک ربات **زنده و درآمدزا** اجرا
// می‌شود و مستقیم به موجودیِ کاربران دست می‌زند. بند ۹ ریشه: پول مقدس‌ترین چیزِ ریپوست،
// پس منطقش باید قبل از اجرا اثبات شود، نه بعدش.
//
// اجرا: node tools/check-coin-migration.mjs
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';
import {
  COIN_VALUE, OLD_WELCOME_TOMAN, NEW_WELCOME_COINS,
  TOMAN_PER_COIN_GIFT, TOMAN_PER_COIN_PAID,
  coinsFor, coinsForPaid, newBalanceFor, newBalanceForPaid,
  parseSetUser, parseIdList, planFor,
  ensureMigrations, migrationDone, MIGRATIONS_TABLE, MIGRATION_KEY,
} from './coin-migration-tarot.mjs';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));
const SRC = require('fs').readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

console.log('▶ قرارداد با خودِ ربات (وگرنه مهاجرت با دنیای جدید نمی‌خواند)');
{
  // ⚠️ این مهاجرت **تاریخی** است: قبلاً اجرا شد و بلوکش از deploy برداشته شده. ربات دیگر
  // COIN_VALUE ندارد (مهاجرتِ «الماسِ بومی» ضریب را از کد و از دیتا پاک کرد)، پس قرارداد
  // با ثابتِ همان مهاجرتِ بعدی سنجیده می‌شود — هر دو یک فرمتِ میراثی را توصیف می‌کنند.
  const { SCALE } = await import('./coins-native-tarot.mjs');
  const botCoinValue = SCALE;
  const botWelcomeCoins = Number((SRC.match(/const WELCOME_BONUS_COINS_V2 = (\d+)/) || [])[1]);
  const botWelcomeToman = Number((SRC.match(/const WELCOME_BONUS\s+= ([0-9_]+)/) || [])[1]?.replace(/_/g, ''));
  ok(botCoinValue === COIN_VALUE, `ضریبِ میراثی با مهاجرتِ بعدی یکی است (${COIN_VALUE})`);
  /* ⚠️ این ادعا از v3.71.0 عمداً به هدیه‌ی **زنده‌ی** ربات گره نمی‌خورد.
     تا امروز `NEW_WELCOME_COINS` مهاجرت با `WELCOME_BONUS_COINS_V2` ربات برابر بود و
     ادعا همان برابری را می‌سنجید. ولی هدیه‌ی زنده در v3.71.0 از ۵ به ۳ آمد، و این
     مهاجرت **تاریخی** است: یک بار در v3.25.0 اجرا شد و موجودیِ تومانیِ کاربران را با
     نرخِ همان روز («۳۰٬۰۰۰ تومان = ۵ الماس») تبدیل کرد.
     دنبال کردنِ عددِ زنده یعنی اگر روزی از یک بکاپِ قدیمی دوباره اجرا شود، همان
     موجودی‌ها با نرخِ **دیگری** تبدیل شوند — یعنی به کاربر کم بدهیم. نرخِ یک مهاجرتِ
     انجام‌شده تاریخ است، نه تنظیمات. پس عدد این‌جا پین می‌شود و آزادانه از هدیه‌ی
     امروز جدا می‌ماند. */
  ok(NEW_WELCOME_COINS === 5,
    `نرخِ تاریخیِ مهاجرت روی ۵ الماس پین است (هدیه‌ی زنده‌ی امروز: ${botWelcomeCoins} الماس)`);
  ok(botWelcomeToman === OLD_WELCOME_TOMAN, `هدیه‌ی خوش‌آمدِ قدیم با ربات یکی است (${OLD_WELCOME_TOMAN} تومان)`);
  ok(TOMAN_PER_COIN_GIFT === 6000, 'نرخِ هدیه‌بگیر دقیقاً ۶٬۰۰۰ تومان به ازای هر الماس است');
  /* ⚠️ همان درسِ v3.71.0 که بالای همین بلوک برای `NEW_WELCOME_COINS` نوشته شده، این‌جا
   * هم صادق است و تا v3.75.0 رعایت نشده بود: `TOMAN_PER_COIN_PAID` نرخِ **لحظه‌ی
   * مهاجرت** (۱۴۰۵/۰۵/۲۹، ارزان‌ترین بسته‌ی آن روز = «جادویی»، ۱۵۰k/۱۰۰ = ۱۵۰۰) است، نه
   * نرخِ زنده‌ی فروشگاهِ امروز. با افزایشِ قیمت‌ها در v3.75.0 (و اضافه‌شدنِ بسته‌ی
   * «جاودان» با نرخِ ۱۴۹۰) ارزان‌ترین نرخِ زنده دیگر با نرخِ مهاجرت یکی نیست — و
   * **نباید** هم باشد: دنبال‌کردنِ نرخِ زنده یعنی اگر این مهاجرت روزی از یک بکاپِ
   * قدیمی دوباره اجرا شود، با نرخِ **دیگری** به کاربرِ پرداخت‌کرده اعتبار می‌دهد. */
  ok(TOMAN_PER_COIN_PAID === 1500,
    `نرخِ تاریخیِ مهاجرت رویِ نرخِ پرداخت‌کرده پین است (۱۵۰۰ تومان — ارزان‌ترین بسته‌ی ۱۴۰۵/۰۵/۲۹)`);
}

console.log('\n▶ فرمولِ هدیه‌بگیر — دقیقاً همان دو مثالی که مالک داد');
{
  ok(coinsFor(30_000) === 5, 'کلِ هدیه‌ی خوش‌آمد (۳۰٬۰۰۰) ⟶ ۵ الماس');
  ok(coinsFor(10_000) === 2, 'یک‌سومِ هدیه (۱۰٬۰۰۰) ⟶ ۱.۶۶ که به بالا گرد می‌شود ⟶ ۲ الماس');
  ok(coinsFor(0) === 0, 'کسی که همه‌اش را خرج کرده ⟶ هیچ');
  // گردکردن **همیشه** به بالاست: هیچ کاربری از تبدیل ضرر نمی‌کند
  let alwaysUp = true;
  for (let t = 1; t <= 300_000; t += 137) if (coinsFor(t) * TOMAN_PER_COIN_GIFT < t) alwaysUp = false;
  ok(alwaysUp, 'گردکردن همیشه به نفعِ کاربر است (هیچ ریالی حذف نمی‌شود)');
  let monotone = true;
  for (let t = 1; t <= 200_000; t += 97) if (coinsFor(t) < coinsFor(t - 1)) monotone = false;
  ok(monotone, 'موجودیِ بیشتر هرگز الماسِ کمتر نمی‌دهد');
  ok(coinsFor(1) === 1, 'حتی ۱ تومان باقی‌مانده هم یک الماس می‌شود (به بالا)');
  ok(coinsFor(-500) === 0 && newBalanceFor(-500) === 0, 'موجودیِ منفی هرگز به الماسِ منفی تبدیل نمی‌شود');
  ok(newBalanceFor(30_000) === NEW_WELCOME_COINS * COIN_VALUE,
    'کاربری که هدیه‌اش دست‌نخورده مانده دقیقاً هدیه‌ی خوش‌آمدِ جدید را می‌گیرد');
}

console.log('\n▶ ورودیِ خصمانه رد می‌شود، نه اینکه حدس زده شود');
{
  ok(parseSetUser('111=5,222=0').get(111) === 5, 'SET_USER درست پارس می‌شود');
  for (const bad of ['111', '111=', '=5', 'abc=5', '111=-2', '111=5;222=6']) {
    let threw = false;
    try { parseSetUser(bad); } catch { threw = true; }
    ok(threw, `SET_USER نامعتبر «${bad}» رد می‌شود`);
  }
  ok(parseIdList('1, 2 ,3').length === 3, 'ZERO_USER درست پارس می‌شود');
  let threw = false;
  try { parseIdList('1,abc'); } catch { threw = true; }
  ok(threw, 'ZERO_USER با آی‌دیِ غیرعددی رد می‌شود');
  ok(parseSetUser('').size === 0 && parseIdList('').length === 0, 'ورودیِ خالی بی‌خطر است');
}

/* ═══════ سناریوی واقعی روی یک DB ═══════ */
const dir = mkdtempSync(path.join(tmpdir(), 'coinmig-'));
const file = path.join(dir, 'bot-fa.db');
const db = new Database(file);
db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '', balance INTEGER DEFAULT 0);
         CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, amount INTEGER);`);
const addUser = db.prepare('INSERT INTO users VALUES (?,?,?,?)');
addUser.run(1, 'welcome-intact', 'a', 30_000);   // هدیه‌ی دست‌نخورده
addUser.run(2, 'third-left', 'b', 10_000);       // مثالِ دومِ مالک
addUser.run(3, 'spent-all', 'c', 0);             // همه را خرج کرده
addUser.run(4, 'referral-extra', 'd', 40_000);   // هدیه + دعوت
addUser.run(5, 'payer', 'e', 200_000);           // پرداختِ واقعی
addUser.run(6, 'payer-zero', 'f', 0);            // پرداخت کرده ولی خالی
db.prepare("INSERT INTO payments VALUES (1,5,'approved',130000)").run();
db.prepare("INSERT INTO payments VALUES (2,6,'approved',30000)").run();
db.prepare("INSERT INTO payments VALUES (3,1,'rejected',50000)").run();  // ردشده ≠ پرداخت‌کننده

console.log('\n▶ فرمولِ پرداخت‌کرده — ارزان‌ترین نرخِ فروشگاه');
{
  ok(coinsForPaid(150_000) === 100, 'یک بسته‌ی جادوییِ کامل (۱۵۰٬۰۰۰) ⟶ ۱۰۰ الماس');
  ok(coinsForPaid(30_000) === 20, '۳۰٬۰۰۰ تومانِ پرداختی ⟶ ۲۰ الماس');
  ok(coinsForPaid(1_000) === 1, 'کمتر از یک الماس هم به بالا گرد می‌شود ⟶ ۱ الماس');
  ok(coinsForPaid(0) === 0, 'موجودیِ صفر ⟶ هیچ');
  // ⚠️ مهم‌ترین ادعای این بلوک: نرخِ پرداخت‌کرده باید **سخاوتمندانه‌تر** باشد، وگرنه
  // کسی که پولِ واقعی داده از کسی که هدیه گرفته کمتر می‌گیرد.
  let alwaysBetter = true;
  for (let t = 1; t <= 300_000; t += 131) if (coinsForPaid(t) < coinsFor(t)) alwaysBetter = false;
  ok(alwaysBetter, 'نرخِ پرداخت‌کرده هرگز بدتر از نرخِ هدیه‌بگیر نیست');
  ok(coinsForPaid(30_000) === 4 * coinsFor(30_000), 'و روی هدیه‌ی خوش‌آمد دقیقاً چهار برابر است');
  ok(newBalanceForPaid(-500) === 0, 'موجودیِ منفی هرگز به الماسِ منفی تبدیل نمی‌شود');
}

console.log('\n▶ چه کسی با کدام نرخ مهاجرت می‌کند');
{
  const { plan } = planFor(db);
  const by = Object.fromEntries(plan.map(p => [p.id, p]));
  ok(by[1]?.to === 50_000 && by[1].kind === 'gift', 'هدیه‌ی دست‌نخورده ⟶ ۵ الماس (نرخِ هدیه)');
  ok(by[2]?.to === 20_000 && by[2].kind === 'gift', 'یک‌سومِ باقی‌مانده ⟶ ۲ الماس');
  ok(!by[3], 'کاربرِ خالی اصلاً در برنامه نیست (چیزی برای تبدیل ندارد)');
  ok(by[4]?.to === 70_000 && by[4].kind === 'gift', 'موجودیِ غیرپرداختیِ بزرگ‌تر با همان نسبت (۴۰٬۰۰۰ ⟶ ۷ الماس)');
  // ⚠️ حیاتی: پرداخت‌کرده نرخِ **بهتر** می‌گیرد، نه نرخِ هدیه
  ok(by[5]?.kind === 'paid', 'کاربرِ پرداخت‌کرده با نرخِ پرداخت تبدیل می‌شود');
  ok(by[5]?.to === 1_340_000, '۲۰۰٬۰۰۰ تومانِ پرداخت‌کرده ⟶ ۱۳۴ الماس (نه ۳۴ الماسِ نرخِ هدیه)');
  ok(!by[6], 'پرداخت‌کننده‌ی با موجودیِ صفر چیزی برای تبدیل ندارد');
  ok(by[1].kind === 'gift', 'پرداختِ **ردشده** کسی را پرداخت‌کننده نمی‌کند');
}

console.log('\n▶ تصمیمِ موردیِ مالک بر همه‌چیز مقدم است');
{
  const { plan } = planFor(db, { setUser: parseSetUser('5=12,1=0'), zeroUser: parseIdList('4') });
  const by = Object.fromEntries(plan.map(p => [p.id, p]));
  ok(by[5]?.to === 120_000 && by[5].kind === 'manual', 'کاربرِ پرداخت‌کرده با عددِ اعلامیِ مالک ست می‌شود (۱۲ الماس)');
  ok(by[1]?.to === 0 && by[1].kind === 'manual', 'و SET_USER بر تبدیلِ خودکار مقدم است (حتی روی صفر)');
  ok(by[4]?.to === 0 && by[4].kind === 'zero', 'دوستِ تستی صفر می‌شود');
  ok(by[4].kind !== 'gift', 'و صفرکردن بر تبدیلِ خودکار مقدم است');
}

console.log('\n▶ 🚫 دوستِ تستی از **درآمد** هم بیرون می‌رود');
{
  // سناریوی صریحِ مالک: «سجاد یک رسیدِ الکی زده بود و من هم الکی تأییدش کردم.
  // موجودی‌اش صفر شود و هر پرداختی که داشته در درآمد حساب نشود.»
  const { plan, voidPays } = planFor(db, { zeroUser: parseIdList('5') });
  ok(plan.find(p => p.id === 5)?.to === 0, 'موجودی‌اش صفر می‌شود');
  ok(plan.find(p => p.id === 5)?.kind === 'zero', 'حتی با اینکه پرداختِ تأییدشده دارد');
  ok(voidPays.length === 1 && voidPays[0].id === 1, 'پرداختِ تأییدشده‌اش برای حذف از درآمد علامت می‌خورد');
  ok(voidPays[0].amount === 130_000, 'و مبلغش درست خوانده شده');
  const other = planFor(db, { zeroUser: parseIdList('5') }).voidPays.filter(v => v.user_id !== 5);
  ok(other.length === 0, 'و پرداختِ **هیچ کاربرِ دیگری** لمس نمی‌شود');
  ok(planFor(db).voidPays.length === 0, 'بدونِ ZERO_USER هیچ پرداختی از درآمد حذف نمی‌شود');

  const mig = require('fs').readFileSync(path.resolve('tools/coin-migration-tarot.mjs'), 'utf8');
  // وضعیتِ `reversed` عمداً انتخاب شده: از قبل معنیِ «رسیدِ فیک» را دارد و همه‌ی
  // کوئری‌های درآمد روی `status='approved'` می‌نشینند، پس خودکار حذف می‌شود.
  ok(/UPDATE payments SET status='reversed' WHERE id=\? AND status='approved'/.test(mig),
    'حذف از درآمد با گذارِ approved ⟶ reversed انجام می‌شود، نه با پاک‌کردنِ ردیف');
  ok(!/DELETE FROM payments/.test(mig), 'هیچ پرداختی از دیتابیس پاک نمی‌شود (ردپا می‌ماند)');
}

console.log('\n▶ اجرای دوباره پولِ کاربران را باد نمی‌کند');
{
  // این خطرناک‌ترین حالتِ ممکن است: خروجیِ تبدیل، خودش ورودیِ معتبرِ فرمول است.
  const twice = coinsFor(newBalanceFor(30_000));
  ok(twice !== 5, `اجرای دوم روی موجودیِ تبدیل‌شده عددِ متفاوتی می‌دهد (${twice}) — پس گاردِ marker حیاتی است`);
  const mig = require('fs').readFileSync(path.resolve('tools/coin-migration-tarot.mjs'), 'utf8');
  ok(/existsSync\(marker\) && !process\.argv\.includes\('--force'\)/.test(mig),
    'اسکریپت وجودِ marker را چک می‌کند و بی‌صدا رد می‌شود');
  ok(/--force بدونِ SET_USER\/ZERO_USER/.test(mig),
    'و --force بدونِ تصمیمِ صریح رد می‌شود (تبدیلِ دوباره‌ی همه ممنوع)');
  ok(/autoOff: rerun/.test(mig), 'در اجرای دوباره تبدیلِ خودکار خاموش می‌شود');
  const { plan } = planFor(db, { setUser: parseSetUser('5=12'), autoOff: true });
  ok(plan.length === 1 && plan[0].id === 5,
    'با autoOff فقط تصمیمِ مالک اجرا می‌شود و هیچ موجودیِ تبدیل‌شده‌ای دوباره ضرب نمی‌شود');
}

console.log('\n▶ ایمنیِ نوشتن');
{
  const mig = require('fs').readFileSync(path.resolve('tools/coin-migration-tarot.mjs'), 'utf8');
  ok(/VACUUM INTO/.test(mig), 'قبل از هر نوشتن بکاپِ سازگار می‌گیرد (بند ۲ج/۹)');
  ok(mig.indexOf('VACUUM INTO') < mig.indexOf('db.transaction'), 'و بکاپ **قبل از** تراکنش است');
  ok(/db\.transaction\(\(\) => \{/.test(mig), 'همه‌ی تغییرات در یک تراکنش‌اند (یا همه یا هیچ)');
  ok(/'coin_migration'/.test(mig), 'هر تغییر رویدادِ حسابرسی ثبت می‌کند (بند ۹ ریشه)');
  ok(/if \(!apply\)/.test(mig), 'dry-run پیش‌فرض است و --apply لازم دارد');
  ok(/\/\^bot-\[a-z-\]\+\\\.db\$\//.test(mig), 'همه‌ی دیتابیس‌های زبان‌ها را می‌گردد، نه فقط bot-fa');
  ok(!/DROP |DELETE FROM users|ALTER TABLE/.test(mig), 'هیچ حذف یا تغییرِ ساختاری‌ای انجام نمی‌دهد (فقط UPDATE balance)');
}

db.close();
rmSync(dir, { recursive: true, force: true });


console.log('\n▶ 🔒 گاردِ اتمیکِ ضدِ تبدیلِ دوباره (باگِ بازتولیدشده)');
{
  // ⚠️ این بلوک منطق را **اجرا** می‌کند، نه اینکه رجکس بخواند. نسخه‌ی قبلی فقط وجودِ
  // چکِ فایلِ marker را رجکس می‌کرد و همین باعث شد باگ تا لحظه‌ی دیپلوی زنده بماند:
  // marker **بعد از** commit نوشته می‌شد، پس قطعِ SSH وسطِ کار = تبدیلِ دوباره.
  const dir = mkdtempSync(path.join(tmpdir(), 'mig2-'));
  const f = path.join(dir, 'bot-fa.db');
  const db = new Database(f);
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '', balance INTEGER DEFAULT 0);
           CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, status TEXT);
           INSERT INTO users VALUES (1,'g','g',30000);
           INSERT INTO users VALUES (2,'p','p',200000);
           INSERT INTO payments VALUES (1,2,50000,'approved');`);

  ok(!migrationDone(db), 'دیتابیسِ تازه مهرِ مهاجرت ندارد');

  // شبیه‌سازیِ همان کاری که run() در تراکنش می‌کند
  const apply = () => {
    const plan = planFor(db, {}).plan;
    db.transaction(() => {
      for (const p of plan) db.prepare('UPDATE users SET balance=? WHERE telegram_id=?').run(p.to, p.id);
      db.prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (key, done_at) VALUES (?, unixepoch())`).run(MIGRATION_KEY);
    })();
    return plan.length;
  };
  ensureMigrations(db);
  apply();
  const after1 = db.prepare('SELECT telegram_id, balance FROM users ORDER BY telegram_id').all();
  ok(after1[0].balance === 50_000 && after1[1].balance === 1_340_000,
    `دورِ اول درست تبدیل کرد (۵ و ۱۳۴ الماس)`);
  ok(migrationDone(db), 'و مهر **در همان تراکنش** ثبت شد');

  // دورِ دوم: چون مهر هست، planFor با autoOff هیچ تبدیلی نمی‌دهد
  const again = planFor(db, { autoOff: true }).plan;
  ok(again.length === 0, 'اجرای دوباره هیچ تبدیلِ خودکاری تولید نمی‌کند (پولِ کاربر باد نمی‌کند)');
  const after2 = db.prepare('SELECT telegram_id, balance FROM users ORDER BY telegram_id').all();
  ok(after2[1].balance === 1_340_000, 'و موجودی دست‌نخورده ماند (نه ۸۹۴ الماس)');

  db.close();
  rmSync(dir, { recursive: true, force: true });

  // بکاپ هرگز بازنویسی نمی‌شود
  const src = readFileSync(path.resolve('tools/coin-migration-tarot.mjs'), 'utf8');
  ok(!/if \(existsSync\(bak\)\) rmSync\(bak\);/.test(src),
    '🔒 بکاپِ قبلی دیگر پاک نمی‌شود (تنها نسخه‌ی موجودیِ تومانیِ اصلی است)');
  ok(/pre-coins\.\$\{Date\.now\(\)\}\.bak/.test(src), 'و اجرای بعدی بکاپِ زمان‌دارِ خودش را می‌گیرد');
  ok(/stampDone\.run\(MIGRATION_KEY\);/.test(src) && src.indexOf('stampDone.run') < src.indexOf('})();'),
    'مهر داخلِ بلوکِ تراکنش زده می‌شود');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
