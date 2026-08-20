#!/usr/bin/env node
// 💎 چکِ مهاجرتِ تومان ⟶ الماس — **رفتاری**، روی SQLite واقعیِ در-حافظه.
//
// چرا این فایل هست: این اسکریپت یک بار روی دیتابیسِ یک ربات **زنده و درآمدزا** اجرا
// می‌شود و مستقیم به موجودیِ کاربران دست می‌زند. بند ۹ ریشه: پول مقدس‌ترین چیزِ ریپوست،
// پس منطقش باید قبل از اجرا اثبات شود، نه بعدش.
//
// اجرا: node tools/check-coin-migration.mjs
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';
import {
  COIN_VALUE, OLD_WELCOME_TOMAN, NEW_WELCOME_COINS, TOMAN_PER_COIN,
  coinsFor, newBalanceFor, parseSetUser, parseIdList, planFor,
} from './coin-migration-tarot.mjs';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));
const SRC = require('fs').readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

console.log('▶ قرارداد با خودِ ربات (وگرنه مهاجرت با دنیای جدید نمی‌خواند)');
{
  const botCoinValue = Number((SRC.match(/const COIN_VALUE = ([0-9_]+)/) || [])[1]?.replace(/_/g, ''));
  const botWelcomeCoins = Number((SRC.match(/const WELCOME_BONUS_COINS_V2 = (\d+)/) || [])[1]);
  const botWelcomeToman = Number((SRC.match(/const WELCOME_BONUS\s+= ([0-9_]+)/) || [])[1]?.replace(/_/g, ''));
  ok(botCoinValue === COIN_VALUE, `ارزشِ الماس با ربات یکی است (${COIN_VALUE})`);
  ok(botWelcomeCoins === NEW_WELCOME_COINS, `هدیه‌ی خوش‌آمدِ جدید با ربات یکی است (${NEW_WELCOME_COINS} الماس)`);
  ok(botWelcomeToman === OLD_WELCOME_TOMAN, `هدیه‌ی خوش‌آمدِ قدیم با ربات یکی است (${OLD_WELCOME_TOMAN} تومان)`);
  ok(TOMAN_PER_COIN === 6000, 'نرخ دقیقاً ۶٬۰۰۰ تومان به ازای هر الماس است');
}

console.log('\n▶ فرمول — دقیقاً همان دو مثالی که مالک داد');
{
  ok(coinsFor(30_000) === 5, 'کلِ هدیه‌ی خوش‌آمد (۳۰٬۰۰۰) ⟶ ۵ الماس');
  ok(coinsFor(10_000) === 2, 'یک‌سومِ هدیه (۱۰٬۰۰۰) ⟶ ۱.۶۶ که به بالا گرد می‌شود ⟶ ۲ الماس');
  ok(coinsFor(0) === 0, 'کسی که همه‌اش را خرج کرده ⟶ هیچ');
  // گردکردن **همیشه** به بالاست: هیچ کاربری از تبدیل ضرر نمی‌کند
  let alwaysUp = true;
  for (let t = 1; t <= 300_000; t += 137) if (coinsFor(t) * TOMAN_PER_COIN < t) alwaysUp = false;
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

console.log('\n▶ چه کسی مهاجرت می‌کند و چه کسی نه');
{
  const { plan } = planFor(db);
  const by = Object.fromEntries(plan.map(p => [p.id, p]));
  ok(!!by[1] && by[1].to === 50_000, 'هدیه‌ی دست‌نخورده ⟶ ۵ الماس');
  ok(!!by[2] && by[2].to === 20_000, 'یک‌سومِ باقی‌مانده ⟶ ۲ الماس');
  ok(!by[3], 'کاربرِ خالی اصلاً در برنامه نیست (چیزی برای تبدیل ندارد)');
  ok(!!by[4] && by[4].to === 70_000, 'موجودیِ غیرپرداختیِ بزرگ‌تر با همان نسبت (۴۰٬۰۰۰ ⟶ ۷ الماس)');
  // ⚠️ حیاتی: پولِ واقعیِ کاربر با فرمولِ کلی جابه‌جا نمی‌شود
  ok(!by[5], 'کاربرِ پرداخت‌کرده **دست نمی‌خورد** (تصمیمِ موردیِ مالک)');
  ok(!by[6], 'پرداخت‌کننده‌ی با موجودیِ صفر هم دست نمی‌خورد');
  ok(!!by[1], 'پرداختِ **ردشده** کسی را پرداخت‌کننده نمی‌کند');
  ok(plan.every(p => p.kind === 'auto'), 'بدونِ ورودیِ مالک، فقط تبدیلِ خودکار');
}

console.log('\n▶ تصمیمِ موردیِ مالک بر همه‌چیز مقدم است');
{
  const { plan } = planFor(db, { setUser: parseSetUser('5=12,1=0'), zeroUser: parseIdList('4') });
  const by = Object.fromEntries(plan.map(p => [p.id, p]));
  ok(by[5]?.to === 120_000 && by[5].kind === 'manual', 'کاربرِ پرداخت‌کرده با عددِ اعلامیِ مالک ست می‌شود (۱۲ الماس)');
  ok(by[1]?.to === 0 && by[1].kind === 'manual', 'و SET_USER بر تبدیلِ خودکار مقدم است (حتی روی صفر)');
  ok(by[4]?.to === 0 && by[4].kind === 'zero', 'دوستِ تستی صفر می‌شود');
  ok(by[4].kind !== 'auto', 'و صفرکردن بر تبدیلِ خودکار مقدم است');
}

console.log('\n▶ اجرای دوباره پولِ کاربران را باد نمی‌کند');
{
  // این خطرناک‌ترین حالتِ ممکن است: خروجیِ تبدیل، خودش ورودیِ معتبرِ فرمول است.
  const twice = coinsFor(newBalanceFor(30_000) / 1);
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

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
