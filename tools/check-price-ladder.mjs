#!/usr/bin/env node
// 💰 چکِ آزمایشِ نردبانِ قیمت (`price_ladder_p1` / `price_ladder_p2` / `price_ladder_p3`،
// v3.80.0 + v3.94.0).
//
// چرا این فایل هست: تا امروز قیمت یک **ثابت** بود و `COIN_PACKAGES` تنها منبعش. از این
// نسخه قیمت per کاربر است، و آن لحظه سه چیز می‌توانند بی‌صدا خراب شوند — هر سه روی
// مسیرِ پول:
//
//   ۱) **نردبان بشکند.** ناوردای «بسته‌ی بزرگ‌تر = هر الماس ارزان‌تر» تا امروز فقط روی
//      یک کاتالوگ سنجیده می‌شد (`check-coins`). حالا سه کاتالوگ هست و شکستنِ نردبان در
//      یکی از بازوها یعنی نیمی از کاربران یک بدمعامله می‌بینند.
//   ۲) **آزمایش دو متغیره شود.** اگر بینِ دو بازو هم تعدادِ الماس عوض شود هم قیمت،
//      نتیجه به هیچ‌کدام قابلِ نسبت‌دادن نیست و کلِ ۶ روز هدر می‌رود. این چک ثابت
//      می‌کند control⟶floor فقط **کفِ بلیت** را عوض می‌کند و floor⟶cheap فقط **سطحِ
//      قیمت** را.
//   ۳) **عددِ روی دکمه با عددِ فاکتور واگرا شود.** اگر `pkg:` از کاتالوگِ سراسری بخواند
//      و رندر از بازو، کاربر ۱۵k می‌بیند و ۳۰k فاکتور می‌گیرد — همان کلاسِ باگِ
//      «۶۰٬۰۰۰ ستاره» (بند ۲و/۶ج ریشه).
//
// و یک ادعای چهارم که **باگِ واقعیِ همین کار** را قفل می‌کند: `adminMoney` عددِ الماس
// را از کاتالوگ می‌خواند (`pack.coins`). تا وقتی یک کاتالوگ بود بی‌ضرر بود؛ با قیمتِ
// per بازو، پیامِ ادمین عددِ پیش‌فرض را چاپ می‌کرد نه چیزی که واقعاً فروخته شده.
//
// عمداً **رفتاری** است نه رجکسی: خودِ بلوکِ منطق از سورس بریده و روی SQLite واقعی با
// `shared/ab.js` واقعی اجرا می‌شود. یک اسکنِ متنی نمی‌تواند ثابت کند «آزمایشِ stopped
// همه را به control برمی‌گرداند».
//
// اجرا: node tools/check-price-ladder.mjs
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { ensureAb, peekVariant, expose } from '../shared/ab.js';
import { ensureAnalytics } from '../shared/analytics.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const bodyOf = (marker, end) => {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to + end.length);
};
/* ⚠️ کامنت‌ها قبل از هر ادعای **ساختاری** حذف می‌شوند. تله‌ی ثبت‌شده‌ی v3.56.0/v3.64.0،
 * و همین فایل دوباره گرفتارش شد: کامنتِ توضیحیِ خودِ `packMenuScreen` عبارتِ
 * «`shopPackages()`» را دارد و یک ادعای کاملاً سالم را قرمزِ کاذب کرد. */
const noComments = (t) => (t || '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const parsePacks = (block) => [...(block || '').matchAll(
  /key: '([a-z]+)',\s*emoji: '[^']+',\s*coins: ([\d_]+),\s*toman: ([\d_]+)(,\s*farsiOnly: true)?/g)]
  .map(m => ({
    key: m[1], emoji: '🥉', coins: Number(m[2].replace(/_/g, '')),
    toman: Number(m[3].replace(/_/g, '')), farsiOnly: !!m[4],
  }));

console.log('\n💰 آزمایشِ نردبانِ قیمت (price_ladder_p1 / price_ladder_p2 / price_ladder_p3)\n');

/* ══ ۰) بریدنِ بلوکِ منطق از سورس ═══════════════════════════════════════════
 * یک ناحیه‌ی پیوسته: از تعریفِ نردبان‌ها تا آخرین helper. هرچه این ناحیه کوچک‌تر
 * باشد ادعاها بی‌معناتر می‌شوند، پس عمداً **کلِ** زنجیره بریده می‌شود. */
const REGION_START = 'const PRICE_LADDERS = {';
const REGION_END = 'shopPackages(uid).find(p => p.key === key) || PACKAGE_BY_KEY[key] || null;';
const rs = SRC.indexOf(REGION_START), re = SRC.indexOf(REGION_END);
ok(rs > 0 && re > rs, 'بلوکِ منطقِ قیمت در سورس پیدا شد');
const REGION = SRC.slice(rs, re + REGION_END.length);

const LIVE = parsePacks(bodyOf('const COIN_PACKAGES = [', '\n];'));
const EXTRA = parsePacks(bodyOf('const EXTRA_PACKAGES = [', '\n];'));
const BY_KEY = Object.fromEntries([...LIVE, ...EXTRA].map(p => [p.key, p]));

/* هر سناریو یک **نمونه‌ی تازه** می‌سازد، چون `activePriceExperiment` کشِ ۶۰ثانیه‌ای
 * دارد و بدونِ نمونه‌ی تازه، سناریوی دوم جوابِ کهنه‌ی اولی را می‌گرفت. */
function build({ src = REGION, starsRail = false, db = null, extraOn = false } = {}) {
  const fn = new Function(
    'COIN_PACKAGES', 'EXTRA_PACKAGES', 'PACKAGE_BY_KEY', 'EXTRA_PACKS_ENABLED',
    'starsRail', 'db', 'logErr', 'peekVariant', 'expose',
    `${src}\nreturn { PRICE_LADDERS, PRICE_EXPERIMENTS, activePriceExperiment, priceArm, exposePrice, shopPackages, packForUser };`,
  );
  return fn(LIVE, EXTRA, BY_KEY, extraOn, starsRail, db, () => {}, peekVariant, expose);
}
const M = build();

/* ══ ۱) سه نردبان، و control یک **ارجاع** است نه یک کپی ═══════════════════ */
console.log('\n۱) چهار نردبان');
const arms = Object.keys(M.PRICE_LADDERS);
ok(arms.join(',') === 'control,floor,cheap,bulk', `چهار بازو تعریف شده: ${arms.join(', ')}`);
// ⚠️ اگر control یک **کپیِ دستی** از قیمت‌ها باشد، اولین تغییرِ قیمتِ آینده فقط یکی از
// آن دو را عوض می‌کند و بازوی کنترل بی‌صدا از محصول جدا می‌شود (بند ۲ج/۴: کنترل =
// رفتارِ قبلی، نه «چیزی که روزی رفتارِ قبلی بود»).
ok(/control: COIN_PACKAGES,/.test(REGION),
  'بازوی control خودِ COIN_PACKAGES است، نه یک کپی که بتواند واگرا شود');

const KEYS = LIVE.map(p => p.key).join(',');
for (const [name, ladder] of Object.entries(M.PRICE_LADDERS)) {
  ok(ladder.map(p => p.key).join(',') === KEYS,
    `بازوی «${name}» همان ${LIVE.length} کلیدِ فروشگاه را به همان ترتیب دارد`);
  const unit = ladder.map(p => p.toman / p.coins);
  const mono = unit.every((u, i) => i === 0 || u < unit[i - 1]);
  ok(mono, `نردبانِ «${name}» سالم است (${unit.map(u => u.toLocaleString('en-US')).join(' > ')} تومان per الماس)`);
}

/* ══ ۲) هر پله دقیقاً **یک** متغیر عوض می‌کند ════════════════════════════ */
console.log('\n۲) تک‌متغیره بودنِ هر پله (وگرنه نتیجه تفسیرپذیر نیست)');
const { control, floor, cheap } = M.PRICE_LADDERS;
const unitOf = (l) => l.map(p => p.toman / p.coins);
ok(JSON.stringify(unitOf(floor)) === JSON.stringify(unitOf(control)),
  'control ⟶ floor: قیمتِ هر الماس در هر سه بسته **دست‌نخورده** است (فقط کفِ بلیت عوض می‌شود)');
/* ⚠️ از v3.91.0 این بخش معنایش عوض شد — عمداً، نه رگرسیون. فازِ ۱ (`price_ladder_p1`)
 * با پیروزیِ قاطعِ `floor` بسته شد و نتیجه‌اش مستقیم در `COIN_PACKAGES` نشست (بخشِ
 * توضیح بالای `PRICE_LADDERS` در index.js)، پس control و floor از این نسخه **بیت‌به‌بیت
 * یکی‌اند**. ادعای «فقط یک بسته عوض شد و ارزان‌تر شد» دیگر معنی ندارد؛ اگر دوباره
 * برقرار شود یعنی کسی به‌اشتباه control را از نتیجه‌ی اثبات‌شده جدا کرده — یعنی
 * برگرداندنِ بازنده‌ی آزمایش. `floor` عمداً کدش می‌ماند (مادّه‌ی آماده‌ی فازِ ۲). */
// ⚠️ مقایسه روی {key,coins,toman} است نه کلِ آبجکت: `parsePacks` (بالای همین فایل)
// همیشه `emoji: '🥉'` می‌گذارد (محدودیتِ خودِ regex)، پس مقایسه‌ی خام حتی با تساویِ
// واقعیِ منبع هم قرمز می‌داد — قرمزِ کاذبِ ابزار، نه اختلافِ قیمت.
const bare = (l) => l.map(({ key, coins, toman }) => ({ key, coins, toman }));
ok(JSON.stringify(bare(floor)) === JSON.stringify(bare(control)),
  'control ⟶ floor از v3.91.0 بیت‌به‌بیت یکی‌اند (نتیجه‌ی فاز ۱ در COIN_PACKAGES نشسته، نه یک تفاوتِ زنده)');

ok(JSON.stringify(cheap.map(p => p.coins)) === JSON.stringify(floor.map(p => p.coins)),
  'floor ⟶ cheap: تعدادِ الماسِ هر سه بسته **یکی** است (فقط سطحِ قیمت عوض می‌شود)');
ok(cheap.every((p, i) => p.toman < floor[i].toman),
  'و قیمتِ هر سه بسته اکیداً پایین‌تر است');

/* 🆕 `bulk` (price_ladder_p3): فرضیه‌اش «حجمِ الماسِ بیشتر در بسته‌های میانی/بالا»
 * است، نه تومانِ کمتر. تنها متغیرِ کنترل‌شده‌اش این است که بسته‌ی اول (basic) عمداً
 * دست‌نخورده بماند؛ گارد را همین‌جا بگیر، نه با فرضِ تک‌متغیره بودنِ کلِ نردبان. */
const { bulk } = M.PRICE_LADDERS;
ok(JSON.stringify(bare([bulk[0]])) === JSON.stringify(bare([control[0]])),
  'bulk ⟶ basic دست‌نخورده است (تنها متغیرِ این فرضیه دو بسته‌ی بالاتر است)');
ok(bulk[1].coins > control[1].coins && bulk[2].coins > control[2].coins,
  'و بسته‌ی ویژه/جادوییِ bulk حجمِ الماسِ بیشتری از control دارند (خودِ فرضیه)');

/* ⚠️ کفِ قیمت نباید زیرِ گاردِ اشتباهِ تایپیِ مسیرِ تومانیِ کهنه برود. امروز پرداختِ
 * بسته‌ای اصلاً از آن مسیر رد نمی‌شود، ولی گاردی که به بسته‌بودنِ یک مسیرِ دیگر تکیه
 * کند یک تله‌ی خفته است (درسِ ثبت‌شده‌ی v3.70.0). */
const MIN_RECHARGE = Number((SRC.match(/const MIN_RECHARGE\s*=\s*([\d_]+);/) || [])[1]?.replace(/_/g, ''));
const lowest = Math.min(...Object.values(M.PRICE_LADDERS).flat().map(p => p.toman));
ok(Number.isFinite(MIN_RECHARGE) && lowest >= MIN_RECHARGE,
  `ارزان‌ترین بسته‌ی همه‌ی بازوها (${lowest.toLocaleString('en-US')}) زیرِ MIN_RECHARGE (${MIN_RECHARGE.toLocaleString('en-US')}) نمی‌رود`);

/* ══ ۳) رفتار: بازو روی SQLite واقعی ═════════════════════════════════════ */
console.log('\n۳) رفتارِ priceArm (روی shared/ab.js واقعی)');
const P1 = 'price_ladder_p1', P2 = 'price_ladder_p2', P3 = 'price_ladder_p3';
ok(JSON.stringify(M.PRICE_EXPERIMENTS) === JSON.stringify([P3, P2, P1]),
  'فازِ جدیدتر اولِ فهرست است (اولویت با p3)');

function freshDb() {
  const db = new Database(':memory:');
  // `track()` روی جدولِ users هم می‌نویسد؛ بدونش هر exposure یک لاگِ خطا چاپ می‌کند و
  // خروجیِ چک را غیرقابلِ خواندن می‌کند (خودِ ثبت fail-safe است و نمی‌شکند).
  db.exec('CREATE TABLE IF NOT EXISTS users (telegram_id INTEGER PRIMARY KEY)');
  ensureAnalytics(db);
  ensureAb(db);
  return db;
}
const startExp = (db, key, status, variants) => db.prepare(
  'INSERT OR REPLACE INTO experiments (key, status, variants_json, started_at) VALUES (?,?,?,?)',
).run(key, status, JSON.stringify(variants), Math.floor(Date.now() / 1000));

const UIDS = Array.from({ length: 400 }, (_, i) => 5_000_000 + i * 37);
const W5050 = [{ key: 'control', weight: 50 }, { key: 'floor', weight: 50 }];

{ // بدونِ هیچ آزمایشی → همه control (بند ۲ج/۴: بدونِ running هیچ‌کس بیرون نمی‌رود)
  const db = freshDb(); const m = build({ db });
  ok(UIDS.every(u => m.priceArm(u) === 'control'), 'بدونِ آزمایشِ running، همه‌ی کاربران control‌اند');
  ok(UIDS.every(u => m.shopPackages(u)[0].toman === control[0].toman), 'و فروشگاه دقیقاً قیمت‌های امروز را می‌دهد');
  db.close();
}

let splitP1 = null;
{ // p1 running → دو بازو
  const db = freshDb(); startExp(db, P1, 'running', W5050); const m = build({ db });
  const got = UIDS.map(u => m.priceArm(u));
  const uniq = [...new Set(got)].sort();
  ok(uniq.join(',') === 'control,floor', `p1 running → فقط دو بازوی تعریف‌شده دیده می‌شود (${uniq.join(', ')})`);
  splitP1 = got.filter(v => v === 'floor').length;
  ok(splitP1 > UIDS.length * 0.35 && splitP1 < UIDS.length * 0.65,
    `و تقسیم تقریباً نصف-نصف است (${splitP1}/${UIDS.length} در floor)`);
  ok(UIDS.every(u => (m.priceArm(u) === 'floor'
    ? m.shopPackages(u)[0].toman === floor[0].toman
    : m.shopPackages(u)[0].toman === control[0].toman)),
    'و فروشگاهِ هر کاربر دقیقاً نردبانِ بازوی خودش را می‌دهد');
  // تعیین‌پذیری: همان کاربر، همان جواب — وگرنه کاربر بینِ منو و تپ قیمتش عوض می‌شود
  ok(UIDS.every(u => m.priceArm(u) === m.priceArm(u)), 'بازو قطعی است (دو خواندنِ پیاپی یک جواب)');
  db.close();
}

{ // p1 stopped → kill switch: همه فوراً control
  const db = freshDb(); startExp(db, P1, 'running', W5050);
  const m1 = build({ db });
  UIDS.forEach(u => m1.exposePrice(u));            // همه expose شده‌اند
  db.prepare("UPDATE experiments SET status='stopped' WHERE key=?").run(P1);
  const m2 = build({ db });                        // نمونه‌ی تازه = کشِ خالی
  ok(UIDS.every(u => m2.priceArm(u) === 'control'),
    'با stopped شدن، حتی کاربرانِ expose‌شده هم فوراً به control برمی‌گردند (kill switch)');
  db.close();
}

{ // draining هنوز فعال است (exposure جدید ممنوع، ولی expose‌شده‌ها فلوشان را تمام می‌کنند)
  const db = freshDb(); startExp(db, P1, 'running', W5050);
  const m1 = build({ db });
  const before = UIDS.map(u => m1.exposePrice(u) || m1.priceArm(u));
  db.prepare("UPDATE experiments SET status='draining' WHERE key=?").run(P1);
  const m2 = build({ db });
  ok(UIDS.every((u, i) => m2.priceArm(u) === before[i]),
    'در draining کاربرِ expose‌شده همان بازو را نگه می‌دارد (فلوی باز وسطِ راه قیمتش عوض نمی‌شود)');
  db.close();
}

{ // p2 بر p1 مقدم است
  const db = freshDb();
  startExp(db, P1, 'running', W5050);
  startExp(db, P2, 'running', [{ key: 'floor', weight: 50 }, { key: 'cheap', weight: 50 }]);
  const m = build({ db });
  const uniq = [...new Set(UIDS.map(u => m.priceArm(u)))].sort();
  ok(uniq.join(',') === 'cheap,floor', `فازِ دوم بر فازِ اول مقدم است (${uniq.join(', ')})`);
  db.close();
}

{ // p3 بر هر دوی p1 و p2 مقدم است (تازه‌ترین آزمایش همیشه اولویتِ اول است)
  const db = freshDb();
  startExp(db, P1, 'running', W5050);
  startExp(db, P2, 'running', [{ key: 'floor', weight: 50 }, { key: 'cheap', weight: 50 }]);
  startExp(db, P3, 'running', [{ key: 'control', weight: 50 }, { key: 'bulk', weight: 50 }]);
  const m = build({ db });
  const uniq = [...new Set(UIDS.map(u => m.priceArm(u)))].sort();
  ok(uniq.join(',') === 'bulk,control', `فازِ سوم بر هر دوی فازِ اول و دوم مقدم است (${uniq.join(', ')})`);
  db.close();
}

{ // نامِ بازوی ناشناس در داشبورد → control، نه کرش و نه قیمتِ undefined
  const db = freshDb();
  startExp(db, P1, 'running', [{ key: 'control', weight: 50 }, { key: 'typo_arm', weight: 50 }]);
  const m = build({ db });
  ok(UIDS.every(u => m.priceArm(u) === 'control'),
    'بازویی که در PRICE_LADDERS نیست (تایپوی داشبورد) بی‌صدا به control می‌افتد، نه قیمتِ خالی');
  db.close();
}

{ // ریلِ استارز هرگز وارد این آزمایش نمی‌شود
  const db = freshDb(); startExp(db, P1, 'running', W5050);
  const m = build({ db, starsRail: true });
  ok(UIDS.every(u => m.priceArm(u) === 'control'),
    'starsRail (ru/pt/es) حتی با آزمایشِ running همیشه control است');
  UIDS.forEach(u => m.exposePrice(u));
  ok(db.prepare('SELECT COUNT(*) n FROM ab_exposures').get().n === 0,
    'و هیچ exposureای برای ریلِ استارز ثبت نمی‌شود (آزمایش با کاربرانی که هرگز چیزی ندیدند رقیق نمی‌شود)');
  db.close();
}

/* ══ ۴) exposure: peek چیزی نمی‌نویسد، expose بعد از نمایش می‌نویسد ══════ */
console.log('\n۴) exposure (بند ۲و/۶د: نمایشِ قیمت یعنی exposure)');
{
  const db = freshDb(); startExp(db, P1, 'running', W5050); const m = build({ db });
  UIDS.forEach(u => m.priceArm(u));
  ok(db.prepare('SELECT COUNT(*) n FROM ab_exposures').get().n === 0,
    'خواندنِ بازو (peek) هیچ exposureای ثبت نمی‌کند — پس رندرِ ناموفق کسی را وارد آزمایش نمی‌کند');
  UIDS.forEach(u => m.exposePrice(u));
  const n = db.prepare('SELECT COUNT(*) n FROM ab_exposures WHERE experiment_key=?').get(P1).n;
  ok(n === UIDS.length, `و exposePrice بعد از نمایش همه را ثبت می‌کند (${n}/${UIDS.length})`);
  const stuck = db.prepare('SELECT COUNT(*) n FROM ab_exposures WHERE variant=?').get('floor').n;
  ok(stuck === splitP1, 'شاخه‌ی ثبت‌شده همان شاخه‌ی نمایش‌داده‌شده است');
  db.close();
}
{
  const db = freshDb(); const m = build({ db });
  UIDS.forEach(u => m.exposePrice(u));
  ok(db.prepare('SELECT COUNT(*) n FROM ab_exposures').get().n === 0,
    'بدونِ آزمایشِ running هیچ exposureای نوشته نمی‌شود');
  db.close();
}

/* ══ ۵) سیم‌کشی: نقطه‌ی نمایش و نقطه‌ی تپ باید یک بازو ببینند ════════════ */
console.log('\n۵) سیم‌کشی در index.js');
const packMenu = noComments(bodyOf('function packMenuScreen(uid) {', '\n}'));
ok(/shopPackages\(uid\)/.test(packMenu) && !/shopPackages\(\)/.test(packMenu),
  'packMenuScreen از shopPackages(uid) می‌خواند، نه کاتالوگِ سراسری');
const pkgFn = noComments(bodyOf('bot.action(/^pkg:([a-z]+)$/, async (ctx) => {', '\n});'));
ok(/const pack = packForUser\(uid, ctx\.match\[1\]\);/.test(pkgFn),
  'اکشنِ pkg: بسته را از بازوی همان کاربر می‌گیرد (وگرنه دکمه ۱۵k می‌گوید و فاکتور ۳۰k می‌شود)');
ok(!/PACKAGE_BY_KEY\[ctx\.match\[1\]\]/.test(pkgFn),
  'و دیگر مستقیم از PACKAGE_BY_KEY نمی‌خواند');
// ⚠️ `variant()` در مسیرِ رندر یعنی exposure سرِ **محاسبه**، نه سرِ **دیدن**.
const REGION_CODE = noComments(REGION);
ok(/peekVariant\(db, uid, key\)/.test(REGION_CODE) && !/\bvariant\(db, uid, key\)/.test(REGION_CODE),
  'priceArm از peekVariant استفاده می‌کند نه variant (exposure سرِ محاسبه ممنوع است)');
const exposeScreen = noComments(bodyOf('const exposePackScreen = (uid) => {', '\n};'));
ok(/exposePrice\(uid\)/.test(exposeScreen), 'exposePrice از تک‌نقطه‌ی exposePackScreen صدا زده می‌شود');
const exposeCalls = (noComments(SRC).match(/exposePrice\(uid\)/g) || []).length;
ok(exposeCalls === 1, `و فقط از همان یک نقطه (${exposeCalls} فراخوانی) — کپیِ دوم دیر یا زود عقب می‌افتد`);

/* ══ ۶) عددِ ادمین از ردیف می‌آید نه از کاتالوگ ═════════════════════════ */
console.log('\n۶) packSoldIn (باگی که همین کار لو داد)');
{
  const creditSrc = bodyOf('const creditForPayment = (p) => {', '\n};') || '';
  const soldSrc = bodyOf('const packSoldIn = (p) => {', '\n};') || '';
  ok(!!creditSrc && !!soldSrc, 'هر دو helper در سورس هستند');
  const { packSoldIn, packOf } = new Function('PACKAGE_BY_KEY', 'bonusFor', 'logErr',
    `const packOf = (p) => (p && p.pkg ? PACKAGE_BY_KEY[p.pkg] || null : null);
     ${creditSrc}\n${soldSrc}\nreturn { packSoldIn, packOf };`)(BY_KEY, () => 0, () => {});

  // ردیفِ کاربری که در بازوی floor خرید: کاتالوگ می‌گوید ۱۰ الماس، ردیف می‌گوید ۵.
  const row = { id: 1, user_id: 7, amount: 15_000, original_amount: 5, pkg: 'basic' };
  ok(packOf(row).coins === control[0].coins,
    `packOf هنوز عددِ کاتالوگ را می‌دهد (${packOf(row).coins}) — یعنی این دو واقعاً واگرا می‌شوند`);
  ok(packSoldIn(row).coins === 5,
    'packSoldIn تعدادِ الماسِ خودِ ردیف را می‌دهد (۵)، نه پیش‌فرضِ کاتالوگ');
  ok(packSoldIn(row).key === 'basic' && packSoldIn(row).emoji === BY_KEY.basic.emoji,
    'و بقیه‌ی بسته (کلید و ایموجی، یعنی نامِ نمایشی) دست‌نخورده می‌ماند');
  ok(packSoldIn({ id: 2, user_id: 7, amount: 50_000, original_amount: null, pkg: '' }) === null,
    'پرداختِ غیربسته‌ای همچنان null می‌گیرد (هیچ عددِ الماسی چاپ نمی‌شود)');
  /* ⚠️ صادقانه: `original_amount` برای ردیفِ بسته‌ای **همیشه** پر است، چون
   * `setPaymentPackage` آن را با `COALESCE(original_amount, amount)` از عددی که
   * `claimAmount` گذاشته (یعنی `pack.coins`) قفل می‌کند. پس حالتِ «ردیفِ بسته با
   * original_amount خالی» ساختاراً نشدنی است و این چک ادعایی درباره‌اش نمی‌کند.
   * چیزی که **می‌تواند** ادعا شود و مهم هم هست: هیچ مسیری عددِ صفر یا غیرعددی به
   * پیامِ ادمین نمی‌دهد. */
  for (const row of [
    { id: 3, user_id: 7, amount: 30_000, original_amount: 10, pkg: 'basic' },
    { id: 4, user_id: 7, amount: 15_000, original_amount: 5, pkg: 'basic' },
    { id: 5, user_id: 7, amount: 100_000, original_amount: 100, pkg: 'magic' },
  ]) {
    const c = packSoldIn(row)?.coins;
    ok(Number.isFinite(c) && c > 0 && c === row.original_amount,
      `ردیفِ #${row.id}: عددِ الماسِ پیامِ ادمین دقیقاً ${row.original_amount} است (همان چیزی که واریز می‌شود)`);
  }
}

/* ══ ۷) جهش‌ها ═══════════════════════════════════════════════════════════ */
console.log('\n۷) جهش‌های تأییدکننده');
const ladderMono = (m) => Object.values(m.PRICE_LADDERS)
  .every(l => l.map(p => p.toman / p.coins).every((u, i, a) => i === 0 || u < a[i - 1]));
const mutate = (from, to) => {
  const src = REGION.replace(from, to);
  if (src === REGION) return null;
  try { return build({ src }); } catch { return null; }
};
{
  const m = mutate('coins: 30,  toman: 45_000 }', 'coins: 30,  toman: 70_000 }');
  ok(m && !ladderMono(m), 'جهشِ «گران‌کردنِ بسته‌ی وسطِ cheap» نردبان را می‌شکند و ادعای بند ۱ قرمز می‌دهد');
}
{
  const m = mutate('coins: 5,   toman: 15_000 }', 'coins: 5,   toman: 20_000 }');
  const same = m && JSON.stringify(unitOf(m.PRICE_LADDERS.floor)) === JSON.stringify(unitOf(control));
  ok(m && !same, 'جهشِ «گران‌کردنِ کفِ floor» تک‌متغیره بودنِ پله‌ی اول را می‌شکند (ادعای بند ۲)');
}
{
  const m = mutate('coins: 5,   toman: 10_000 }', 'coins: 20,  toman: 10_000 }');
  const same = m && JSON.stringify(m.PRICE_LADDERS.cheap.map(p => p.coins))
    === JSON.stringify(m.PRICE_LADDERS.floor.map(p => p.coins));
  ok(m && !same, 'جهشِ «عوض‌کردنِ تعدادِ الماسِ cheap» پله‌ی دوم را دومتغیره می‌کند (ادعای بند ۲)');
}
{
  const db = freshDb(); startExp(db, P1, 'running', W5050);
  const src = REGION.replace("  if (starsRail) return 'control';\n  try {\n    const key = activePriceExperiment();", '  try {\n    const key = activePriceExperiment();');
  const m = src === REGION ? null : build({ src, db, starsRail: true });
  ok(m && UIDS.some(u => m.priceArm(u) !== 'control'),
    'جهشِ «برداشتنِ گاردِ starsRail از priceArm» ریلِ استارز را واردِ آزمایش می‌کند و ادعای بند ۳ آن را می‌گیرد');
  db.close();
}
{
  const db = freshDb(); startExp(db, P1, 'running', W5050);
  const src = REGION.replace('const v = peekVariant(db, uid, key);', 'const v = expose(db, uid, key);');
  const m = src === REGION ? null : build({ src, db });
  if (m) UIDS.forEach(u => m.priceArm(u));
  ok(m && db.prepare('SELECT COUNT(*) n FROM ab_exposures').get().n > 0,
    'جهشِ «peekVariant ⟵ expose» سرِ محاسبه exposure می‌نویسد و ادعای بند ۴ آن را قرمز می‌کند');
  db.close();
}
{
  const src = SRC.replace('const pack = packForUser(uid, ctx.match[1]);', 'const pack = PACKAGE_BY_KEY[ctx.match[1]];');
  ok(src !== SRC && /const pack = PACKAGE_BY_KEY\[ctx\.match\[1\]\];/.test(src),
    'جهشِ «برگشتِ pkg: به کاتالوگِ سراسری» قابلِ ساخت است و ادعای بند ۵ آن را می‌گیرد');
}
{
  const m = mutate('coins: 5,    toman: 15_000 },    // ۳۰۰۰ — همان control',
    'coins: 5,    toman: 12_000 },    // جهش');
  const same = m && JSON.stringify(bare([m.PRICE_LADDERS.bulk[0]])) === JSON.stringify(bare([control[0]]));
  ok(m && !same, 'جهشِ «دستکاریِ basicِ bulk» تنها-متغیربودنِ فرضیه‌ی bulk را می‌شکند (ادعای بند ۲)');
}
{
  const m = mutate('coins: 2000, toman: 1_500_000 }, // ۷۵۰', 'coins: 2000, toman: 4_000_000 }, // جهش');
  ok(m && !ladderMono(m), 'جهشِ «گران‌کردنِ magicِ bulk» نردبان را می‌شکند و ادعای بند ۱ قرمز می‌دهد');
}
{
  const db = freshDb();
  startExp(db, P3, 'running', [{ key: 'control', weight: 50 }, { key: 'bulk', weight: 50 }]);
  startExp(db, P1, 'running', W5050);
  const src = REGION.replace(
    "const PRICE_EXPERIMENTS = ['price_ladder_p3', 'price_ladder_p2', 'price_ladder_p1'];",
    "const PRICE_EXPERIMENTS = ['price_ladder_p2', 'price_ladder_p1', 'price_ladder_p3'];",
  );
  const m = src === REGION ? null : build({ src, db });
  ok(m && [...new Set(UIDS.map(u => m.priceArm(u)))].sort().join(',') === 'control,floor',
    'جهشِ «بردنِ p3 به آخرِ فهرست» اولویتش را می‌شکند و ادعای بند ۳ آن را می‌گیرد');
  db.close();
}

console.log(fail ? `\n❌ نتیجه: ${pass} پاس، ${fail} خطا\n` : `\n✅ نتیجه: ${pass} پاس، ۰ خطا\n`);
process.exit(fail ? 1 : 0);
