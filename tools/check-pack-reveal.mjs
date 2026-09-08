// چکِ CI برای آزمایشِ نمایشِ بسته‌ها (tarot، pack_reveal_v1، v3.75.0): «۵ بسته یک‌جا»
// در برابرِ «۳ بسته + دکمه‌ی کشف»، ۵۰/۵۰، معیارِ موفقیت = درآمدِ مجموع.
//
// ⚠️ خطرناک‌ترین جهت این‌جا **معکوس‌شدنِ قراردادِ control** است: طبقِ shared/ab.js تا
// آزمایش از داشبورد running نشود، peekVariant همیشه literal 'control' برمی‌گرداند. اگر
// کد به‌جای «شاخه‌ی full استثناست» به «شاخه‌ی staged استثناست» نوشته شود، همه‌ی کاربران
// پیش از راه‌اندازیِ آزمایش بی‌قید هر پنج بسته (شاملِ دو بسته‌ی گرانِ تازه) را می‌بینند —
// دقیقاً برعکسِ «کنترل = رفتارِ قبلی» (بند ۲ج/۴ ریشه). این چک همین را با اجرای واقعیِ
// منطقِ فیلتر روی SQLite واقعی اثبات می‌کند، نه فقط با خواندنِ رجکس.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { ensureAb, peekVariant } from '../shared/ab.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function bodyOf(marker, end) {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n🎁 آزمایشِ نمایشِ بسته‌ها (pack_reveal_v1)\n');

/* ══ ۱) داده: COIN_PACKAGES ═════════════════════════════════════════════ */
console.log('۱) کاتالوگِ بسته‌ها');
const packsBlock = bodyOf('const COIN_PACKAGES = [', '\n];') || '';
const packs = [...packsBlock.matchAll(/key: '([a-z]+)',[^}]*coins: ([\d_]+),\s*toman: ([\d_]+)(,\s*farsiOnly: true)?/g)]
  .map(m => ({ key: m[1], coins: Number(m[2].replace(/_/g, '')), toman: Number(m[3].replace(/_/g, '')), farsiOnly: !!m[4] }));
ok(packs.length === 5, `پنج بسته خوانده شد (${packs.map(p => p.key).join(', ')})`);
const farsiOnlyKeys = packs.filter(p => p.farsiOnly).map(p => p.key);
ok(farsiOnlyKeys.join(',') === 'legend,eternal', `فقط legend و eternal علامتِ farsiOnly دارند (${farsiOnlyKeys.join(', ')})`);
ok(packs.slice(0, 3).every(p => !p.farsiOnly), 'سه بسته‌ی اول (basic/gold/magic) عمومی‌اند');

/* ══ ۲) گاردِ ریلِ استارز ═══════════════════════════════════════════════ */
console.log('\n۲) دفاع در برابرِ ریلِ استارز');
ok(/const railPacks = starsRail \? COIN_PACKAGES\.filter\(p => !p\.farsiOnly\) : COIN_PACKAGES;/.test(SRC),
  'ریلِ استارز بسته‌های farsiOnly را از رندر حذف می‌کند');
const pkgHandler = bodyOf("bot.action(/^pkg:([a-z]+)$/, async (ctx) => {", '\n});') || '';
ok(/if \(pack\.farsiOnly && starsRail\)/.test(pkgHandler),
  'اکشنِ pkg: هم لایه‌ی دومِ دفاع دارد (دکمه‌ی inline نمی‌میرد، بند ۲ج/۶)');
ok(/return ctx\.reply\(L\.errors\.generic\)/.test(pkgHandler.slice(pkgHandler.indexOf('farsiOnly && starsRail'))),
  'و اگر رخ داد، کاربر پیامِ صریح می‌گیرد نه سکوتِ محض (مسیرِ پول)');

/* ══ ۳) قراردادِ control ═══════════════════════════════════════════════ */
console.log('\n۳) قراردادِ control = شاخه‌ی امن (staged)');
const screenFn = bodyOf('function packMenuScreen(uid, paymentId) {', '\n}') || '';
ok(/staged = !starsRail && peekVariant\(db, uid, PACK_REVEAL_EXPERIMENT\) !== 'full'/.test(screenFn),
  'شرط رویِ استثنا-بودنِ شاخه‌ی «full» است، نه شاخه‌ی «staged» — طبقِ قراردادِ control');
ok(!/=== 'staged'/.test(screenFn), 'و هیچ‌جا منتظرِ literal رشته‌ی «staged» از peekVariant نیست');

/* ══ ۴) رفتار روی SQLite واقعی — با موتورِ واقعیِ shared/ab.js ═══════════ */
console.log('\n۴) رفتارِ واقعی (قبل/بعد از راه‌اندازیِ آزمایش)');
{
  const db = new Database(':memory:');
  ensureAb(db);
  const UID_A = 111, UID_B = 222;
  const EXP = 'pack_reveal_v1';

  // پیش از ساختِ آزمایش در داشبورد: باید literal 'control' برگردد (خودِ ab.js، نه مدل)
  ok(peekVariant(db, UID_A, EXP) === 'control', 'قبل از ساختن/اجرا: peekVariant literal «control» می‌دهد');

  // شبیه‌سازیِ شرطِ کدِ واقعی برای این حالت
  const stagedNow = (uid) => peekVariant(db, uid, EXP) !== 'full';
  ok(stagedNow(UID_A) === true, '⇒ پیش از راه‌اندازیِ آزمایش، همه‌ی کاربران شاخه‌ی امن (سه‌بسته‌ای) می‌بینند');

  // حالا آزمایش را از داشبورد «running» می‌کنیم، با دو شاخه‌ی درست‌نام‌گذاری‌شده.
  // ⚠️ روی یک دیتابیسِ **تازه**: shared/ab.js کشِ ۶۰ثانیه‌ای config دارد (`expCache`)
  // کلیدشده با خودِ آبجکتِ db — اگر همان db بالا را ادامه بدهیم، اولین peekVariant
  // (قبل از insert) نبودِ آزمایش را برای همان db کش می‌کند و نتیجه‌ی زیر همیشه
  // «control» می‌ماند، حتی بعد از insert.
  const db2 = new Database(':memory:');
  ensureAb(db2);
  db2.prepare(`INSERT INTO experiments (key, status, variants_json, started_at)
    VALUES (?, 'running', ?, unixepoch())`).run(EXP, JSON.stringify([
      { key: 'control', weight: 1 }, { key: 'full', weight: 1 },
    ]));
  const stagedOn2 = (uid) => peekVariant(db2, uid, EXP) !== 'full';
  // هش قطعی است: همان uid همیشه یک جواب می‌دهد. برای پوششِ هر دو شاخه، چند آی‌دی
  // امتحان می‌شود تا هم یک نمونه‌ی control و هم یک نمونه‌ی full واقعاً دیده شود.
  const sample = Array.from({ length: 40 }, (_, i) => 1000 + i);
  const seenControl = sample.find(uid => peekVariant(db2, uid, EXP) === 'control');
  const seenFull = sample.find(uid => peekVariant(db2, uid, EXP) === 'full');
  ok(seenControl !== undefined, 'بعد از running: حداقل یک کاربر شاخه‌ی control می‌گیرد');
  ok(seenFull !== undefined, 'و حداقل یک کاربر شاخه‌ی full می‌گیرد (تقسیمِ واقعی، نه فقط تعریف)');
  ok(stagedOn2(seenControl) === true, 'کاربرِ شاخه‌ی control همچنان سه‌بسته‌ای می‌بیند');
  ok(stagedOn2(seenFull) === false, 'کاربرِ شاخه‌ی full همان لحظه هر پنج بسته را می‌بیند');
}

/* ══ ۵) نشانه‌ی «دیده شد» (packsRevealed) ═════════════════════════════════ */
console.log('\n۵) دکمه‌ی کشف و نشانه‌ی سشن');
const revealFn = bodyOf('bot.action(/^pack_reveal:(\\d+)$/, async (ctx) => {', '\n});') || '';
ok(/if \(starsRail \|\| !coinsOn\(uid\)\) return;/.test(revealFn), 'هندلر برای ریلِ استارز/دنیای تومانی هیچ کاری نمی‌کند');
ok(/if \(s\.paymentId !== pid\) return;/.test(revealFn), 'مالکیتِ فاکتور چک می‌شود (دکمه‌ی کهنه‌ی زیرِ فاکتورِ دیگر بی‌اثر است)');
ok(/patchSession\(uid, \{ packsRevealed: 1 \}\)/.test(revealFn), 'نشانه در سشن می‌نشیند (نه ستونِ DB — بند ۹/۰: چیزی که لازم نیست ساخته نشود)');
const packsRevealedFn = bodyOf('const packsRevealed = (uid) => {', '\n};') || '';
ok(/getSession\(uid\)\?\.packsRevealed/.test(packsRevealedFn), 'و همان کلید در packsRevealed() خوانده می‌شود');

/* ══ ۶) exposure دقیقاً هم‌زمان با رندرِ واقعی ═════════════════════════════ */
console.log('\n۶) exposure (بند ۲الف/۶د ریشه: peek قبل، expose بعد از رسیدنِ پیام)');
const rechargeFn = bodyOf("bot.action('recharge', async (ctx) => {", '\n});') || '';
ok(/expose\(db, uid, PACK_REVEAL_EXPERIMENT\)/.test(rechargeFn), '«recharge» بعد از رسیدنِ واقعیِ پیام expose می‌کند');
const payCancelFn = bodyOf("bot.action(/^pay_cancel:(\\d+)$/, async (ctx) => {", '\n});') || '';
ok(/expose\(db, uid, PACK_REVEAL_EXPERIMENT\)/.test(payCancelFn), 'و «pay_back به کیف» هم همان‌طور (مسیرِ دومِ رندر)');
ok(/if \(starsRail\)[\s\S]{0,60}expose\(db, uid, STARS_EXPERIMENT[\s\S]{0,60}else[\s\S]{0,60}expose\(db, uid, PACK_REVEAL_EXPERIMENT/.test(rechargeFn),
  'دو آزمایش دوقلوی هم‌ساختارند: استارز فقط رویِ starsRail، pack_reveal فقط رویِ !starsRail');

/* ══ ۷) جهش‌ها ═══════════════════════════════════════════════════════════ */
console.log('\n۷) جهش‌های تأییدکننده');
{
  // جهش: شرط را برعکس بنویس (=== 'staged' به‌جای !== 'full') — دقیقاً باگی که این چک
  // برای جلوگیری‌اش ساخته شد.
  const mutated = screenFn.replace(
    "peekVariant(db, uid, PACK_REVEAL_EXPERIMENT) !== 'full'",
    "peekVariant(db, uid, PACK_REVEAL_EXPERIMENT) === 'staged'");
  const dbm = new Database(':memory:');
  ensureAb(dbm);
  const stagedMutated = (uid) => peekVariant(dbm, uid, 'pack_reveal_v1') === 'staged';
  ok(stagedMutated(999) === false,
    'جهشِ «=== staged» پیش از راه‌اندازیِ آزمایش staged را false می‌دهد (یعنی همه هر ۵ بسته می‌بینند — دقیقاً باگی که این چک می‌گیرد)');
  ok(mutated !== screenFn, 'و متنِ جهش‌یافته واقعاً با سورسِ اصلی فرق دارد (ادعا چیزی را بی‌معنا تست نمی‌کند)');
}

/* ══ نتیجه ═══════════════════════════════════════════════════════════════ */
console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
