// چکِ CI برای دو بسته‌ی گران («افسانه‌ای»/«جاودان») و آزمایشِ نمایششان (pack_reveal_v1).
//
// تاریخچه: v3.75.0 این دو را اضافه کرد و پشتِ یک آزمایشِ ۵۰/۵۰ گذاشت («۵ بسته یک‌جا»
// در برابرِ «۳ بسته + دکمه‌ی کشف»). v3.78.0 هر دو را **خاموش** کرد، نه حذف: تعریفشان
// در `EXTRA_PACKAGES` مانده و راهِ برگشت یک خط است (`EXTRA_PACKS_ENABLED = true`).
//
// پس این چک دو کار می‌کند و هر دو لازم‌اند:
//   الف) حالتِ **امروز** (خاموش) واقعاً خاموش است: نه در فروشگاه دیده می‌شوند، نه
//        دکمه‌ی کشف ساخته می‌شود، نه exposureای ثبت می‌شود، و تپ روی دکمه‌ی کهنه
//        بی‌صدا نمی‌میرد.
//   ب) حالتِ **فردا** (روشن) از قبل سالم است: قراردادِ control معکوس نشده، گاردِ ریلِ
//      استارز سرِ جایش است، و مهم‌تر از همه نردبانِ قیمت نمی‌شکند.
//
// ⚠️ خطرناک‌ترین جهت در حالتِ روشن **معکوس‌شدنِ قراردادِ control** است: طبقِ shared/ab.js
// تا آزمایش از داشبورد running نشود، peekVariant همیشه literal 'control' برمی‌گرداند. اگر
// کد به‌جای «شاخه‌ی full استثناست» به «شاخه‌ی staged استثناست» نوشته شود، همه‌ی کاربران
// پیش از راه‌اندازیِ آزمایش بی‌قید هر پنج بسته را می‌بینند — دقیقاً برعکسِ «کنترل =
// رفتارِ قبلی» (بند ۲ج/۴ ریشه). این چک همین را با اجرای واقعیِ منطقِ فیلتر روی SQLite
// واقعی اثبات می‌کند، نه فقط با خواندنِ رجکس.
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
const parsePacks = (block) => [...(block || '').matchAll(
  /key: '([a-z]+)',\s*emoji: '[^']+',\s*coins: ([\d_]+),\s*toman: ([\d_]+)(,\s*farsiOnly: true)?/g)]
  .map(m => ({
    key: m[1], coins: Number(m[2].replace(/_/g, '')),
    toman: Number(m[3].replace(/_/g, '')), farsiOnly: !!m[4],
  }));

console.log('\n🎁 دو بسته‌ی گران و آزمایشِ نمایششان (pack_reveal_v1)\n');

/* ══ ۱) پرچمِ واحد ═══════════════════════════════════════════════════════ */
console.log('۱) پرچمِ روشن/خاموش');
const flagMatch = SRC.match(/const EXTRA_PACKS_ENABLED = (true|false);/);
ok(!!flagMatch, 'پرچمِ EXTRA_PACKS_ENABLED یک ثابتِ بولینِ صریح است');
const EXTRA_ON = flagMatch?.[1] === 'true';
console.log(`     ⟶ وضعیتِ فعلی: ${EXTRA_ON ? 'روشن' : 'خاموش'}`);
// v3.80.0: امضا `(uid)` گرفت چون قیمت per بازوی آزمایشِ `price_ladder_*` است. خودِ
// ادعا عوض نشد: هنوز **یک** helper تصمیم می‌گیرد چه چیزی در فروشگاه دیده می‌شود، و
// `EXTRA_PACKS_ENABLED` هنوز تنها چیزی است که دو بسته‌ی گران را وارد/خارج می‌کند.
ok(/const shopPackages = \(uid\) => \[[\s\S]{0,200}?EXTRA_PACKS_ENABLED \? EXTRA_PACKAGES : \[\]/.test(SRC),
  'تک‌منبعِ «چه چیزی در فروشگاه دیده می‌شود» یک helper است، نه شرطِ پخش‌شده');

/* ══ ۲) داده: کاتالوگِ زنده و کاتالوگِ خاموش ═════════════════════════════ */
console.log('\n۲) کاتالوگ');
const live = parsePacks(bodyOf('const COIN_PACKAGES = [', '\n];'));
const extra = parsePacks(bodyOf('const EXTRA_PACKAGES = [', '\n];'));
ok(live.map(p => p.key).join(',') === 'basic,gold,magic',
  `فروشگاه سه بسته دارد (${live.map(p => p.key).join(', ')})`);
ok(extra.map(p => p.key).join(',') === 'legend,eternal',
  `دو بسته‌ی گران هنوز در سورس تعریف‌شده‌اند و پاک نشده‌اند (${extra.map(p => p.key).join(', ')})`);
ok(extra.every(p => p.farsiOnly), 'و هر دو علامتِ farsiOnly دارند (ریلِ استارز نمی‌شناسدشان)');
ok(live.every(p => !p.farsiOnly), 'سه بسته‌ی فروشگاه عمومی‌اند');

/* ⚠️ نردبانِ قیمت — همان تله‌ای که v3.78.0 را وادار به خاموش‌کردن (نه فقط قیمت‌گذاریِ
 * دوباره) کرد: با قیمت‌های برگشته‌ی ۳۰k/۶۰k/۱۵۰k، بسته‌ی ۴۹۰k هر الماس را ۱٬۶۳۳ تومان
 * می‌فروشد در حالی که بسته‌ی ۱۵۰k همان را ۱٬۵۰۰ می‌دهد. یعنی «بسته‌ی بزرگ‌تر گران‌تر
 * است» — یک بدمعامله، نه یک گزینه‌ی لوکس. اگر کسی روزی پرچم را بدونِ بازچینیِ قیمت
 * روشن کند، همین ادعا قرمز می‌شود. */
console.log('\n۳) نردبانِ قیمت (هر بسته‌ی بزرگ‌تر باید هر الماس را ارزان‌تر کند)');
{
  const shown = EXTRA_ON ? [...live, ...extra] : live;
  const per = shown.map(p => p.toman / p.coins);
  const monotone = per.every((v, i) => i === 0 || v < per[i - 1]);
  ok(monotone, `نردبانِ بسته‌های **دیده‌شده** نمی‌شکند (${per.map(v => Math.round(v)).join(' > ')})`);
  const withExtra = [...live, ...extra].map(p => p.toman / p.coins);
  const wouldBreak = !withExtra.every((v, i) => i === 0 || v < withExtra[i - 1]);
  if (!EXTRA_ON) {
    ok(wouldBreak, 'و اثباتِ اینکه چرا خاموش‌اند: با قیمتِ فعلی روشن‌کردنشان نردبان را می‌شکند '
      + `(${withExtra.map(v => Math.round(v)).join(' > ')})`);
  }
}

/* ══ ۴) گاردِ ریلِ استارز ═══════════════════════════════════════════════ */
console.log('\n۴) دفاع در برابرِ ریلِ استارز');
ok(/const railPacks = starsRail\s*\?\s*shopPackages\(uid\)\.filter\(p => !p\.farsiOnly\)\s*:\s*shopPackages\(uid\);/.test(SRC),
  'ریلِ استارز بسته‌های farsiOnly را از رندر حذف می‌کند');
const pkgHandler = bodyOf("bot.action(/^pkg:([a-z]+)$/, async (ctx) => {", '\n});') || '';
ok(/if \(pack\.farsiOnly && starsRail\)/.test(pkgHandler),
  'اکشنِ pkg: هم لایه‌ی دومِ دفاع دارد (دکمه‌ی inline نمی‌میرد، بند ۲ج/۶)');
ok(/return ctx\.reply\(L\.errors\.generic\)/.test(pkgHandler.slice(pkgHandler.indexOf('farsiOnly && starsRail'))),
  'و اگر رخ داد، کاربر پیامِ صریح می‌گیرد نه سکوتِ محض (مسیرِ پول)');

/* رنگِ مسیرِ پول حالا یک A/B لایه‌بندی‌شده است، نه نتیجه‌گیری از یک گزارش پشتیبانی.
 * control باید استاندارد بماند و treatment فقط ظاهرِ رنگیِ تاریخی را برگرداند. */
// بدنه nested block دارد؛ مرزِ پایدارش helper بعدی است، نه اولین `}`.
const screenFn = bodyOf('function packMenuScreen(uid, paymentId) {', '\nconst exposePackScreen') || '';
const packageRows = screenFn.slice(screenFn.indexOf('const rows = shown.map'), screenFn.indexOf('// دکمه‌ی کشف'));
ok(packageRows.includes('Markup.button.callback') && /`pkg:\$\{p\.key\}`/.test(packageRows),
  'هر بسته‌ی فروشگاه callback استاندارد دارد');
ok(/const colored = moneyCtaIsColored\(uid\);/.test(packageRows),
  'رنگِ بسته فقط از assignment پایدارِ همان کاربر می‌آید');
ok(/colored \? PACK_STYLE\[p\.key\] : undefined/.test(packageRows),
  'control دکمه‌ی استاندارد و treatment فقط رنگ‌های تاریخی می‌گیرد');

/* ══ ۵) دکمه‌ی کهنه‌ی یک بسته‌ی خاموش، بی‌صدا نمی‌میرد ═══════════════════ */
console.log('\n۵) تپ روی بسته‌ی خاموش (بند ۲ج/۶ + ۹ب/۱)');
ok(/const isRetiredPack = \(key\) => !EXTRA_PACKS_ENABLED && EXTRA_PACK_KEYS\.has\(key\);/.test(SRC),
  '«بازنشسته» از خودِ پرچم مشتق می‌شود، نه از یک لیستِ دومِ دستی');
ok(/const PACKAGE_BY_KEY = Object\.fromEntries\(\s*\[\.\.\.COIN_PACKAGES, \.\.\.EXTRA_PACKAGES\]/.test(SRC),
  'کلیدِ بسته‌ی خاموش هنوز resolve می‌شود (ردیفِ پرداختِ باز نامش را از دست نمی‌دهد — بند ۲ج/۵)');
ok(/if \(isRetiredPack\(pack\.key\)\) \{/.test(pkgHandler), 'اکشنِ pkg: حالتِ بسته‌ی خاموش را می‌شناسد');
ok(/L\.errors\.packRetired/.test(pkgHandler), 'و پیامِ مودبانه‌ی اختصاصی می‌دهد، نه سکوت و نه خطای عمومی');
{
  // گاردِ ترتیب: بلوکِ خاموش باید **بعد از** ترمیمِ استیت بیاید، وگرنه `s.paymentId`
  // نامعتبر است و دکمه‌ی «بازگشت»ِ کیبوردِ ضمیمه به یک شناسه‌ی مرده اشاره می‌کند.
  const iRepair = pkgHandler.indexOf('patchSession(uid, { paymentId: revived })');
  const iRetired = pkgHandler.indexOf('if (isRetiredPack(pack.key))');
  ok(iRepair > -1 && iRetired > iRepair, 'و بعد از بلوکِ ترمیمِ استیت است (شناسه‌ی فاکتورِ معتبر برای دکمه‌ی بازگشت)');
  ok(/packMenuScreen\(uid, s\.paymentId\)/.test(pkgHandler.slice(iRetired)),
    'پیام با خودِ کیبوردِ فروشگاه می‌رود، پس کاربر همان‌جا بسته‌ی زنده انتخاب می‌کند (بن‌بست نیست)');
}
for (const loc of ['fa', 'ru', 'es', 'pt']) {
  const t = readFileSync(`bots/tarot/locales/${loc}.js`, 'utf8');
  ok(/\n\s*packRetired: '[^']+',/.test(t), `locale ${loc} رشته‌ی packRetired را دارد`);
}

/* ══ ۶) قراردادِ control و گاردِ خاموشی در همان شرط ═════════════════════ */
console.log('\n۶) شرطِ staged');
ok(/staged = EXTRA_PACKS_ENABLED && !starsRail/.test(screenFn),
  'وقتی دو بسته خاموش‌اند اصلاً staged نمی‌شود (دکمه‌ی کشفی که چیزی برای کشف ندارد ساخته نمی‌شود)');
ok(/peekVariant\(db, uid, PACK_REVEAL_EXPERIMENT\) !== 'full'/.test(screenFn),
  'و شرطِ آزمایش رویِ استثنا-بودنِ شاخه‌ی «full» است، نه شاخه‌ی «staged» — طبقِ قراردادِ control');
ok(!/=== 'staged'/.test(screenFn), 'هیچ‌جا منتظرِ literal رشته‌ی «staged» از peekVariant نیست');

/* ══ ۷) رفتار روی SQLite واقعی — با موتورِ واقعیِ shared/ab.js ═══════════ */
console.log('\n۷) رفتارِ واقعیِ آزمایش (برای روزی که پرچم روشن شود)');
{
  const db = new Database(':memory:');
  ensureAb(db);
  const UID_A = 111;
  const EXP = 'pack_reveal_v1';

  // پیش از ساختِ آزمایش در داشبورد: باید literal 'control' برگردد (خودِ ab.js، نه مدل)
  ok(peekVariant(db, UID_A, EXP) === 'control', 'قبل از ساختن/اجرا: peekVariant literal «control» می‌دهد');

  // شبیه‌سازیِ شرطِ کدِ واقعی، **با همان پرچم** — یعنی امروز جوابش باید false باشد.
  const stagedNow = (uid) => EXTRA_ON && peekVariant(db, uid, EXP) !== 'full';
  ok(stagedNow(UID_A) === EXTRA_ON,
    EXTRA_ON ? '⇒ با پرچمِ روشن، پیش از راه‌اندازیِ آزمایش همه شاخه‌ی امن (سه‌بسته‌ای) می‌بینند'
      : '⇒ با پرچمِ خاموش، هیچ کاربری وارد شاخه‌ی staged نمی‌شود');

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
  // هش قطعی است: همان uid همیشه یک جواب می‌دهد. برای پوششِ هر دو شاخه، چند آی‌دی
  // امتحان می‌شود تا هم یک نمونه‌ی control و هم یک نمونه‌ی full واقعاً دیده شود.
  const sample = Array.from({ length: 40 }, (_, i) => 1000 + i);
  const seenControl = sample.find(uid => peekVariant(db2, uid, EXP) === 'control');
  const seenFull = sample.find(uid => peekVariant(db2, uid, EXP) === 'full');
  ok(seenControl !== undefined, 'بعد از running: حداقل یک کاربر شاخه‌ی control می‌گیرد');
  ok(seenFull !== undefined, 'و حداقل یک کاربر شاخه‌ی full می‌گیرد (تقسیمِ واقعی، نه فقط تعریف)');
  // شرطِ کاملِ کد، شاملِ پرچم — همان چیزی که واقعاً اجرا می‌شود.
  const stagedFull = (uid) => EXTRA_ON && peekVariant(db2, uid, EXP) !== 'full';
  ok(stagedFull(seenControl) === EXTRA_ON, 'کاربرِ شاخه‌ی control فقط وقتی سه‌بسته‌ای می‌بیند که پرچم روشن باشد');
  ok(stagedFull(seenFull) === false, 'کاربرِ شاخه‌ی full در هر حالت staged نیست');
}

/* ══ ۸) نشانه‌ی «دیده شد» (packsRevealed) ═════════════════════════════════ */
console.log('\n۸) دکمه‌ی کشف و نشانه‌ی سشن (کدش عمداً حفظ شده)');
const revealFn = bodyOf('bot.action(/^pack_reveal:(\\d+)$/, async (ctx) => {', '\n});') || '';
ok(/if \(starsRail \|\| !coinsOn\(uid\)\) return;/.test(revealFn), 'هندلر برای ریلِ استارز/دنیای تومانی هیچ کاری نمی‌کند');
ok(/if \(s\.paymentId !== pid\) return;/.test(revealFn), 'مالکیتِ فاکتور چک می‌شود (دکمه‌ی کهنه‌ی زیرِ فاکتورِ دیگر بی‌اثر است)');
ok(/patchSession\(uid, \{ packsRevealed: 1 \}\)/.test(revealFn), 'نشانه در سشن می‌نشیند (نه ستونِ DB — بند ۹/۰: چیزی که لازم نیست ساخته نشود)');
ok(/packMenuScreen\(uid, pid\)/.test(revealFn),
  'و صفحه را دوباره می‌سازد — پس دکمه‌ی کهنه‌ی کشف در حالتِ خاموش هم خودترمیم است (منو بدونِ آن دکمه بازرندر می‌شود)');
const packsRevealedFn = bodyOf('const packsRevealed = (uid) => {', '\n};') || '';
ok(/getSession\(uid\)\?\.packsRevealed/.test(packsRevealedFn), 'و همان کلید در packsRevealed() خوانده می‌شود');

/* ══ ۹) exposure فقط وقتی چیزی برای دیدن هست ═════════════════════════════ */
console.log('\n۹) exposure (بند ۲الف/۶د ریشه: peek قبل، expose بعد از رسیدنِ پیام)');
const rechargeFn = bodyOf("bot.action('recharge', async (ctx) => {", '\n});') || '';
const payCancelFn = bodyOf("bot.action(/^pay_cancel:(\\d+)$/, async (ctx) => {", '\n});') || '';
/* 🆕 v3.80.0: بدنه‌ی exposure از هر دو هندلر به تک‌منبعِ `exposePackScreen` رفت، چون با
 * اضافه‌شدنِ آزمایشِ سومِ همین صفحه (`price_ladder_*`) دو کپیِ دستی دیر یا زود از هم
 * واگرا می‌شدند. ادعا عوض نشده، فقط آدرسش: **هر دو نقطه‌ی رندر** باید همان یک helper را
 * صدا بزنند، و خودِ helper باید هنوز pack_reveal را پشتِ پرچم و استارز را جدا نگه دارد. */
for (const [name, fn] of [['recharge', rechargeFn], ['pay_back به کیف', payCancelFn]]) {
  ok(/exposePackScreen\(uid\)/.test(fn),
    `«${name}» exposure را از تک‌منبعِ exposePackScreen می‌گیرد، نه کپیِ محلی`);
  ok(!/expose\(db, uid, (STARS_EXPERIMENT|PACK_REVEAL_EXPERIMENT)\)/.test(fn),
    `و «${name}» هیچ کپیِ دستی‌ای از فراخوانیِ expose ندارد`);
}
const exposeScreenFn = bodyOf('const exposePackScreen = (uid) => {', '\n};') || '';
ok(/if \(EXTRA_PACKS_ENABLED\) \{ try \{ expose\(db, uid, PACK_REVEAL_EXPERIMENT\); \} catch \{\} \}/.test(exposeScreenFn),
  'فقط وقتی پرچم روشن است exposureِ pack_reveal ثبت می‌شود (وگرنه آزمایشِ آینده با کاربرانی که هیچ‌وقت چیزی ندیدند رقیق می‌شود)');
ok(/expose\(db, uid, STARS_EXPERIMENT\)/.test(exposeScreenFn), 'و آزمایشِ استارز دست‌نخورده ماند');
ok(/if \(starsRail\)[\s\S]{0,90}expose\(db, uid, STARS_EXPERIMENT[\s\S]{0,40}return;/.test(exposeScreenFn),
  'دو آزمایش دوقلوی هم‌ساختارند: استارز فقط رویِ starsRail (و همان‌جا return می‌کند)، pack_reveal فقط رویِ !starsRail');

/* ══ ۱۰) جهش‌ها ══════════════════════════════════════════════════════════ */
console.log('\n۱۰) جهش‌های تأییدکننده');
{
  // جهش ۱: شرط را برعکس بنویس (=== 'staged' به‌جای !== 'full') — دقیقاً باگی که این چک
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

  // جهش ۲: اگر کسی `shopPackages()` را با `COIN_PACKAGES` خام عوض کند، روشن‌کردنِ پرچم
  // دیگر هیچ اثری ندارد — یک رول‌بکِ **بی‌صدا شکسته**. ادعای بند ۴ باید بگیردش.
  ok(!/starsRail \? COIN_PACKAGES\.filter/.test(SRC),
    'جهشِ «برگشت به COIN_PACKAGES خام در رندر» وجود ندارد (وگرنه پرچم بی‌اثر می‌شد)');

  // جهش ۳: حذفِ گاردِ پرچم از شرطِ staged ⇒ دکمه‌ی کشفِ بی‌اثر برمی‌گردد.
  const noFlag = screenFn.replace('staged = EXTRA_PACKS_ENABLED && !starsRail', 'staged = !starsRail');
  ok(noFlag !== screenFn && !/staged = EXTRA_PACKS_ENABLED && !starsRail/.test(noFlag),
    'جهشِ «حذفِ پرچم از شرطِ staged» قابلِ ساخت است و ادعای بند ۶ آن را قرمز می‌کند');
}

/* ══ نتیجه ═══════════════════════════════════════════════════════════════ */
console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
