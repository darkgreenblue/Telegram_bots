// چکِ CI برای کاهشِ پاداشِ دعوت در tarot، **فقط فارسی**. حالا **سه پله**:
// ۱۰ (تا v3.68.0) ⟵ ۵ (v3.69.0) ⟵ **۳ (v3.82.0)**.
//
// چرا این چک لازم است، و چرا رفتاری است نه رجکسی:
//
// ۱) این یک استثنای **زبانی** است (بند ۲و ریشه). یک تغییرِ بی‌دقت می‌تواند بی‌صدا هر
//    چهار زبان را بزند، و چون هیچ خطایی نمی‌دهد فقط با اسکرین‌شاتِ یک کاربرِ روس معلوم
//    می‌شود — دقیقاً همان کلاسِ باگی که بند ۲و/۶ب ثبتش کرده.
// ۲) این یک تغییرِ **پولی** است با grandfathering: دعوتی که قبل از هر مرز ثبت شده باید
//    همان عددِ وعده‌داده‌شده‌ی **همان دوره** را بگیرد. «کد درست است» را نمی‌شود از روی
//    شکلِ کد فهمید؛ باید خودِ تابع با ردیف‌های واقعیِ هر سه دوره اجرا شود.
//    ⚠️ و با دو مرز، یک کلاسِ خطای تازه ممکن شد: پله‌ی نو می‌تواند پله‌ی میانی را
//    **ببلعد** و کاربری که ۵ وعده گرفته بود ۳ بگیرد. بخشِ ۱ب دقیقاً همین را می‌سنجد.
// ۳) مرزها روی `referrals.created_at` می‌نشینند و از جدولِ `migrations` خوانده می‌شوند.
//    هر دو باید روی SQLite واقعی اجرا شوند، وگرنه یک `SELECT` باریک‌شده یا یک
//    `INSERT` بدونِ `OR IGNORE` مرز را در هر ری‌استارت جابه‌جا می‌کند و کلِ
//    grandfathering بی‌صدا از بین می‌رود. و **دو کلیدِ جدا** لازم است: یک کلید نمی‌تواند
//    دو وعده‌ی متفاوت را از هم تفکیک کند.
// ۴) و آخرین لایه: عددی که **به کاربر می‌رسد**. رشته‌های locale واقعاً رندر می‌شوند،
//    چون «پارامتری بودن» با «عددِ درست روی صفحه» یکی نیست (بند ۲و/۶ج ریشه).
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
// کامنت‌ها قبل از هر ادعای ساختاری حذف می‌شوند — تله‌ی ثبت‌شده‌ی v3.30.0/v3.56.0:
// نامِ یک تابع داخلِ یک کامنتِ توضیحی، شمارش و ترتیب را بی‌صدا خراب می‌کند.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

function slice(from, to) {
  const a = SRC.indexOf(from);
  if (a < 0) return null;
  const b = SRC.indexOf(to, a);
  return b < 0 ? null : SRC.slice(a, b);
}
function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  return m[2];
}

console.log('\n💎 پاداشِ دعوت: ۱۰ ⟵ ۵ ⟵ ۳ (فقط فارسی)\n');

/* ══ ۱) خودِ resolverها از سورس بریده و اجرا می‌شوند ══════════════════════ */
console.log('۱) رفتارِ resolverها');

const BLOCK = slice('const REFERRAL_BONUS_COINS = 3;', 'const WELCOME_BONUS_COINS_V2');
ok(!!BLOCK, 'بلوکِ ثابت‌ها و resolverهای دعوت از سورس بریده شد');

// بلوک را با دو EPOCHِ تزریقی و یک LOCALEِ تزریقی اجرا می‌کند. هیچ منطقی این‌جا
// بازنویسی نمی‌شود؛ فقط ورودی‌های محیطی پارامتر می‌شوند.
function build(e5, e3, { locale = 'fa', l5 = null, l3 = null } = {}) {
  if (!BLOCK) return null;
  let body = BLOCK
    .replace('let REFERRAL_5_EPOCH = 0;', 'let REFERRAL_5_EPOCH = __E5;')
    .replace('let REFERRAL_3_EPOCH = 0;', 'let REFERRAL_3_EPOCH = __E3;');
  if (body === BLOCK) return null; // هیچ‌کدام از دو جایگزینی نگرفت
  if (!body.includes('__E5') || !body.includes('__E3')) return null; // یکی‌شان نگرفت
  if (l5 !== null) body = body.replace("const REFERRAL_5_LOCALES = ['fa'];", `const REFERRAL_5_LOCALES = ${l5};`);
  if (l3 !== null) body = body.replace("const REFERRAL_3_LOCALES = ['fa'];", `const REFERRAL_3_LOCALES = ${l3};`);
  const fn = new Function('LOCALE', '__E5', '__E3', 'uxV2For', 'coinsOn', 'REFERRAL_BONUS', `
    ${body}
    return { referralBonusFor, referralPayoutFor, referralBonusLegacy, referralBonusV3For,
             referral5On, referral3On,
             REFERRAL_BONUS_COINS_V2, REFERRAL_BONUS_COINS_V3, REFERRAL_BONUS_COINS_V4 };
  `);
  // دنیای امروزِ ربات: UX v2 برای همه باز است.
  return fn(locale, e5, e3, () => true, () => true, 10_000);
}

// دو مرزِ واقعیِ پروداکشن: `referral_5` چند روز زودتر مهر خورده و `referral_3` امروز.
const E5 = 1_790_000_000;
const E3 = E5 + 86_400 * 4;
const fa = build(E5, E3);
ok(!!fa, 'بلوک با موفقیت اجرا شد (هر دو EPOCH تزریق شدند)');

if (fa) {
  ok(fa.REFERRAL_BONUS_COINS_V4 === 3, 'پاداشِ تازه ۳ الماس است', `دیدم: ${fa.REFERRAL_BONUS_COINS_V4}`);
  ok(fa.REFERRAL_BONUS_COINS_V3 === 5, 'پاداشِ پله‌ی میانی هنوز ۵ است (لازمِ grandfathering)');
  ok(fa.REFERRAL_BONUS_COINS_V2 === 10, 'پاداشِ قدیمی هنوز ۱۰ است (لازمِ grandfathering)');
  ok(fa.referral3On() === true, 'فارسی مشمولِ پله‌ی سوم است');
  ok(fa.referral5On() === true, 'پله‌ی دوم هم هنوز برای فارسی روشن است');
  ok(fa.referralBonusFor(1) === 3, 'عددِ نمایشیِ فارسی ۳ است', `دیدم: ${fa.referralBonusFor(1)}`);
  ok(fa.referralBonusV3For(1) === 5, 'resolverِ پله‌ی دوم هنوز ۵ می‌دهد (منبعِ grandfathering)');

  // grandfathering — قلبِ این تغییر، حالا با سه دوره.
  ok(fa.referralPayoutFor(1, { created_at: E5 - 1 }) === 10,
    'دعوتِ یک ثانیه قبل از مرزِ اول ⟵ همان ۱۰ وعده‌داده‌شده');
  ok(fa.referralPayoutFor(1, { created_at: E5 - 86_400 * 30 }) === 10,
    'دعوتِ یک ماه پیش ⟵ ۱۰');
  ok(fa.referralPayoutFor(1, { created_at: E5 }) === 5,
    'دعوتِ دقیقاً روی مرزِ اول ⟵ ۵');
  ok(fa.referralPayoutFor(1, { created_at: E3 - 1 }) === 5,
    'دعوتِ یک ثانیه قبل از مرزِ دوم ⟵ همان ۵ وعده‌داده‌شده');
  ok(fa.referralPayoutFor(1, { created_at: E3 }) === 3,
    'دعوتِ دقیقاً روی مرزِ دوم ⟵ ۳');
  ok(fa.referralPayoutFor(1, { created_at: E3 + 1 }) === 3,
    'دعوتِ بعد از مرزِ دوم ⟵ ۳');

  // fail-safe: ابهام همیشه به نفعِ وعده‌ی قدیمی‌تر (سخاوتمندانه‌تر) تمام می‌شود.
  ok(fa.referralPayoutFor(1, { created_at: 0 }) === 10, 'ردیفِ بدونِ تاریخ ⟵ ۱۰ (fail-safe)');
  ok(fa.referralPayoutFor(1, {}) === 10, 'ردیفِ بی‌فیلد ⟵ ۱۰ (fail-safe)');
  ok(fa.referralPayoutFor(1, null) === 10, 'ردیفِ null ⟵ ۱۰ (fail-safe)');

  // fail-safe در **هر دو** مرز، جدا. مرزِ نو که خوانده نشده باشد نباید پله‌ی میانی را
  // هم با خودش ببرد؛ و مرزِ کهنه که خوانده نشده باشد همه را به سخاوتمندانه‌ترین می‌برد.
  const noE3 = build(E5, 0);
  ok(noE3 && noE3.referralPayoutFor(1, { created_at: E3 + 1 }) === 5,
    'مرزِ سومِ خوانده‌نشده (۰) ⟵ ۵ می‌دهد نه ۳ (fail-safe به نفعِ کاربر)');
  ok(noE3 && noE3.referralPayoutFor(1, { created_at: E5 - 1 }) === 10,
    'و پله‌ی اول همان‌جا دست‌نخورده می‌ماند');
  const noEpoch = build(0, 0);
  ok(noEpoch && noEpoch.referralPayoutFor(1, { created_at: E3 + 1 }) === 10,
    'هر دو مرزِ خوانده‌نشده ⟵ همه ۱۰ می‌گیرند (fail-safe به نفعِ کاربر)');

  // دیتابیسِ **تازه** (زبان یا سرورِ نو): هر دو مرز در یک ثانیه مهر می‌خورند.
  const fresh = build(E5, E5);
  ok(fresh && fresh.referralPayoutFor(1, { created_at: E5 + 10 }) === 3,
    'دیتابیسِ تازه (دو مرزِ هم‌زمان) ⟵ دعوتِ بعدش ۳ می‌گیرد');
}

/* ══ ۱ب) پله‌ی نو، پله‌ی میانی را نمی‌بلعد ═══════════════════════════════ */
// کلاسِ خطایی که با افزودنِ مرزِ دوم ممکن شد: اگر شرطِ پله‌ی سوم مرزِ خودش را چک نکند
// (یا با مرزِ اول اشتباه گرفته شود)، **همه‌ی** دعوت‌های بعد از v3.69.0 به ۳ می‌افتند و
// کاربری که ۵ وعده گرفته بود بی‌صدا ۳ می‌گیرد.
console.log('\n۱ب) پله‌ی میانی زنده است');
if (fa) {
  const mid = [E5, E5 + 1, E5 + 3600, E3 - 3600, E3 - 1];
  const allFive = mid.every(t => fa.referralPayoutFor(1, { created_at: t }) === 5);
  ok(allFive, 'کلِ بازه‌ی بینِ دو مرز ۵ می‌گیرد، نه ۳',
    mid.map(t => `${t - E5}s→${fa.referralPayoutFor(1, { created_at: t })}`).join(' '));
  // و کنترلِ مثبت: همان تابع با مرزِ سومِ عقب‌رفته واقعاً ۳ می‌دهد. بدونِ این، ادعای
  // بالا می‌توانست صرفاً یعنی «این تابع هیچ‌وقت ۳ نمی‌دهد».
  const early = build(E5, E5 + 1);
  ok(early && early.referralPayoutFor(1, { created_at: E5 + 3600 }) === 3,
    'کنترلِ مثبت: با مرزِ سومِ زودتر، همان تاریخ ۳ می‌گیرد');
}

/* ══ ۲) سه زبانِ دیگر باید کاملاً دست‌نخورده بمانند ═══════════════════════ */
console.log('\n۲) استثنای زبانی — فقط فارسی');
for (const loc of ['ru', 'pt', 'es']) {
  const m = build(E5, E3, { locale: loc });
  if (!m) { ok(false, `بلوک برای ${loc} اجرا نشد`); continue; }
  ok(m.referral5On() === false, `${loc}: مشمولِ پله‌ی دوم نیست`);
  ok(m.referral3On() === false, `${loc}: مشمولِ پله‌ی سوم هم نیست`);
  ok(m.referralBonusFor(1) === 10, `${loc}: عددِ نمایشی همچنان ۱۰ است`, `دیدم: ${m.referralBonusFor(1)}`);
  ok(m.referralPayoutFor(1, { created_at: E3 + 999 }) === 10,
    `${loc}: دعوتِ بعد از هر دو مرز هم ۱۰ می‌گیرد (مرزها اصلاً اعمال نمی‌شوند)`);
  ok(m.referralPayoutFor(1, { created_at: E5 - 999 }) === 10,
    `${loc}: دعوتِ قبل از مرزها هم ۱۰ می‌گیرد`);
}

/* ══ ۳) هر دو رول‌بکِ یک‌خطی واقعاً کار می‌کنند ═══════════════════════════ */
console.log('\n۳) رول‌بک');
const rolled3 = build(E5, E3, { l3: '[]' });
if (!rolled3) ok(false, 'ساختِ نسخه‌ی رول‌بکِ پله‌ی سوم شکست خورد');
else {
  ok(rolled3.referralBonusFor(1) === 5,
    'با `REFERRAL_3_LOCALES = []` عددِ نمایشیِ فارسی به ۵ برمی‌گردد، نه ۱۰');
  ok(rolled3.referralPayoutFor(1, { created_at: E3 + 999 }) === 5,
    'و پرداختش هم بیت‌به‌بیت به v3.69.0 برمی‌گردد');
  ok(rolled3.referralPayoutFor(1, { created_at: E5 - 999 }) === 10,
    'و grandfatheringِ پله‌ی اول هنوز سرِ جایش است');
}
const rolledAll = build(E5, E3, { l5: '[]', l3: '[]' });
if (!rolledAll) ok(false, 'ساختِ نسخه‌ی رول‌بکِ کامل شکست خورد');
else {
  ok(rolledAll.referralBonusFor(1) === 10, 'با خالی‌کردنِ هر دو آرایه، فارسی به ۱۰ برمی‌گردد');
  ok(rolledAll.referralPayoutFor(1, { created_at: E3 + 999 }) === 10,
    'و پرداختش هم بیت‌به‌بیت همان v3.68.0 است');
}

/* ══ ۴) هر دو مرز روی SQLite واقعی: ساخته می‌شوند و **جابه‌جا نمی‌شوند** ══ */
console.log('\n۴) مرزهای migrations روی SQLite واقعی');
const lineOf = (needle) => CODE.split('\n').find(l => l.includes(needle));
const sqlIn = (line) => line?.match(/db\.prepare\((["'`])([\s\S]*?)\1\)/)?.[2];
const boundarySql = {};
for (const key of ['referral_5', 'referral_3']) {
  const insLine = lineOf(`VALUES ('${key}'`);
  const selLine = lineOf(`WHERE key='${key}'`);
  ok(!!insLine, `خطِ ثبتِ مرزِ \`${key}\` در سورس هست`);
  ok(!!selLine, `خطِ خواندنِ مرزِ \`${key}\` در سورس هست`);
  ok(!!insLine && /INSERT\s+OR\s+IGNORE/i.test(insLine),
    `ثبتِ \`${key}\` با \`INSERT OR IGNORE\` است (وگرنه هر ری‌استارت مرز را جلو می‌برد)`);
  boundarySql[key] = { ins: sqlIn(insLine), sel: sqlIn(selLine) };
}
// ⚠️ دو کلیدِ **جدا**. یک کلیدِ مشترک یعنی مرزِ دوم اصلاً وجود ندارد و کاربری که ۵
// وعده گرفته بود ۳ می‌گیرد (یا برعکس، بسته به اینکه کدام زودتر مهر خورده باشد).
ok(boundarySql.referral_5.ins && boundarySql.referral_3.ins
   && boundarySql.referral_5.ins !== boundarySql.referral_3.ins,
  'دو مرز دو کلیدِ متفاوت در `migrations` دارند');

if (boundarySql.referral_5.ins && boundarySql.referral_3.ins) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE migrations (key TEXT PRIMARY KEY, done_at INTEGER NOT NULL DEFAULT 0)');
  // بوتِ اول: هر دو مرز مهر می‌خورند.
  for (const k of ['referral_5', 'referral_3']) db.prepare(boundarySql[k].ins).run();
  const first = {};
  for (const k of ['referral_5', 'referral_3']) first[k] = db.prepare(boundarySql[k].sel).get()?.done_at || 0;
  ok(first.referral_5 > 1_700_000_000 && first.referral_3 > 1_700_000_000,
    'اولین بوت هر دو مرز را با زمانِ واقعی مهر می‌زند', JSON.stringify(first));
  ok(db.prepare('SELECT COUNT(*) c FROM migrations').get().c === 2,
    'دو ردیفِ مستقل ساخته شد، نه یکی');
  // بوتِ دوم (شبیه‌سازیِ ری‌استارت). هیچ‌کدام نباید تکان بخورند.
  for (const k of ['referral_5', 'referral_3']) db.prepare(boundarySql[k].ins).run();
  for (const k of ['referral_5', 'referral_3']) {
    const now = db.prepare(boundarySql[k].sel).get()?.done_at || 0;
    ok(now === first[k], `ری‌استارت مرزِ \`${k}\` را جابه‌جا نمی‌کند`, `${first[k]} ⟵ ${now}`);
  }
  // و سناریوی واقعیِ ارتقا: دیتابیسی که از قبل `referral_5` دارد نباید مرزِ کهنه‌اش
  // بازنویسی شود، وگرنه کاربرانِ ۱۰ الماسی بی‌صدا به ۵ می‌افتند.
  const up = new Database(':memory:');
  up.exec('CREATE TABLE migrations (key TEXT PRIMARY KEY, done_at INTEGER NOT NULL DEFAULT 0)');
  up.prepare("INSERT INTO migrations (key, done_at) VALUES ('referral_5', 1789000000)").run();
  for (const k of ['referral_5', 'referral_3']) up.prepare(boundarySql[k].ins).run();
  ok(up.prepare(boundarySql.referral_5.sel).get()?.done_at === 1789000000,
    'ارتقا: مرزِ `referral_5`ِ موجود دست‌نخورده می‌ماند');
  ok((up.prepare(boundarySql.referral_3.sel).get()?.done_at || 0) > 1789000000,
    'ارتقا: مرزِ `referral_3` تازه و بعد از آن مهر می‌خورد');
  up.close();
  db.close();
}

/* ══ ۵) ردیفِ دعوت واقعاً `created_at` دارد ═══════════════════════════════ */
// `referralPayoutFor` روی این فیلد تصمیم می‌گیرد. اگر روزی `SELECT *` به یک لیستِ
// ستونیِ باریک تبدیل شود، `created_at` غایب می‌شود و **همه** ۱۰ می‌گیرند — بی‌صدا.
console.log('\n۵) ردیفِ دعوت و ستونِ تاریخ');
const createRef = slice('CREATE TABLE IF NOT EXISTS referrals', ');');
const getRef = sqlOf('getReferralByReferee');
if (createRef && getRef) {
  const db = new Database(':memory:');
  db.exec(`${createRef});`);
  db.prepare('INSERT INTO referrals (referrer_id, referee_id) VALUES (?,?)').run(7, 8);
  const row = db.prepare(getRef).get(8);
  ok(!!row, 'ردیفِ دعوت با SQLِ واقعیِ ربات خوانده شد');
  ok(row && Number(row.created_at) > 1_700_000_000,
    '`created_at` در همان ردیف هست و پر است', `دیدم: ${row && row.created_at}`);
  // و اثباتِ اینکه این ستون واقعاً تصمیم را عوض می‌کند، نه اینکه فقط وجود داشته باشد:
  // **همان ردیف** با دو مرزِ متفاوت دو نتیجه‌ی متفاوت می‌دهد.
  if (row) {
    const born = Number(row.created_at);
    // **همان ردیف** با سه چیدمانِ مرز، سه نتیجه‌ی متفاوت می‌دهد.
    const tier3 = build(born - 2, born);     // هر دو مرز گذشته‌اند
    const tier2 = build(born - 1, born + 1); // فقط مرزِ اول گذشته
    const tier1 = build(born + 1, born + 2); // هیچ مرزی هنوز نرسیده
    ok(tier3 && tier3.referralPayoutFor(1, row) === 3, 'همان ردیف با هر دو مرزِ گذشته ⟵ ۳');
    ok(tier2 && tier2.referralPayoutFor(1, row) === 5, 'همان ردیف با فقط مرزِ اولِ گذشته ⟵ ۵');
    ok(tier1 && tier1.referralPayoutFor(1, row) === 10,
      'همان ردیف با مرزهای آینده ⟵ ۱۰ (ستون واقعاً تصمیم‌ساز است)');
  }
  db.close();
}

/* ══ ۶) نقطه‌ی پرداخت باید payout را صدا بزند، نه عددِ نمایشی ═════════════ */
console.log('\n۶) سیم‌کشیِ نقطه‌ی پرداخت');
const payBlock = slice('const ref = stmts.getReferralByReferee.get(uid);', 'referral reward:');
const payCode = (payBlock || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
ok(!!payBlock, 'بلوکِ پرداختِ پاداشِ دعوت پیدا شد');
ok(/referralPayoutFor\(\s*ref\.referrer_id\s*,\s*ref\s*\)/.test(payCode),
  'پرداخت از `referralPayoutFor(ref.referrer_id, ref)` می‌آید (با خودِ ردیف)');
ok(!/referralBonusFor\(/.test(payCode),
  'نقطه‌ی پرداخت عددِ **نمایشی** را صدا نمی‌زند (وگرنه grandfathering از بین می‌رود)');
ok(/stmts\.credit\.run\(\s*refAmt\s*,/.test(payCode),
  'همان عددِ محاسبه‌شده واریز می‌شود');

// و جهتِ معکوس: دکمه‌ها باید عددِ **رو-به-جلو** را نشان بدهند، نه payout را.
const inviteRowSrc = slice('const inviteRow = (uid) =>', ');\n');
const inviteScreenSrc = slice('const inviteScreen = (uid) => {', '\n};');
ok(!!inviteRowSrc && /referralBonusFor\(uid\)/.test(inviteRowSrc),
  'دکمه‌ی دعوت عددِ نمایشیِ رو-به-جلو را نشان می‌دهد');
ok(!!inviteScreenSrc && /referralBonusFor\(uid\)/.test(inviteScreenSrc),
  'صفحه‌ی دعوت هم همان عدد را نشان می‌دهد');
ok(!!inviteRowSrc && !/referralPayoutFor/.test(inviteRowSrc),
  'دکمه‌ی دعوت به payout کاری ندارد (ردیفی در کار نیست)');

/* ══ ۷) عددی که واقعاً به کاربر می‌رسد ════════════════════════════════════ */
// «پارامتری بودن» تضمین نمی‌کند عددِ درست روی صفحه بنشیند (بند ۲و/۶ج ریشه).
console.log('\n۷) رندرِ واقعیِ متنِ فارسی');
const L = (await import('../bots/tarot/locales/fa.js')).default;
const cur = { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji };
const THREE = '۳', FIVE = '۵', TEN = '۱۰';
const show = fa ? fa.referralBonusFor(1) : 0;
ok(show === 3, 'عددی که به رندر می‌رود همان خروجیِ resolver است', `دیدم: ${show}`);
const rendered = {
  'دکمه‌ی دعوتِ اینلاین': L.buttons.inviteWithBonus(show, cur),
  'دکمه‌ی اشتراک‌گذاری': L.buttons.share(show, cur),
  'متنِ صفحه‌ی دعوت': L.share.invitePrompt('tg_bot', 42, show, cur),
  'خبرِ پاداش': L.share.referralReward('سارا', show, cur, 12),
};
for (const [name, text] of Object.entries(rendered)) {
  ok(text.includes(THREE), `${name}: عددِ ۳ در متن هست`, text);
  ok(!text.includes(FIVE), `${name}: هیچ ۵ ای در متن نمانده`, text);
  ok(!text.includes(TEN), `${name}: هیچ ۱۰ ای در متن نمانده`, text);
}
// کنترلِ معکوس: اگر عدد دیگری پاس داده شود باید همان چاپ شود. بدونِ این، ادعای بالا
// می‌توانست صرفاً یعنی «این رشته اصلاً عددی چاپ نمی‌کند».
ok(L.buttons.inviteWithBonus(10, cur).includes(TEN),
  'کنترلِ معکوس: همان رشته با ورودیِ ۱۰ عددِ ۱۰ را چاپ می‌کند');
ok(L.buttons.inviteWithBonus(5, cur).includes(FIVE),
  'کنترلِ معکوس: و با ورودیِ ۵ عددِ ۵ را');

/* ══ ۸) نسخه بامپ شده (بند ۲ج/۴ ریشه) ════════════════════════════════════ */
console.log('\n۸) نسخه');
// ⚠️ کف، نه عددِ دقیق — و مقایسه‌ی **عددی** نه رشته‌ای. درسِ همین PR: نسخه‌ی پین‌شده‌ی
// `check-recover-readings` با اولین بامپِ بعدی قرمز شد، یعنی چکی که قرار بود رعایتِ
// بند ۲ج/۴ را تضمین کند خودش جلوی همان قاعده را می‌گرفت. مقایسه‌ی رشته‌ای هم روزی
// '3.100.0' را کوچک‌تر از '3.69.0' می‌خواند.
const ver = SRC.match(/const PRODUCT_VERSION = '([\d.]+)'/)?.[1] || '0';
const cmpVer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};
ok(cmpVer(ver, '3.82.0') >= 0, `PRODUCT_VERSION برای این تغییرِ رفتاری بامپ شده (${ver})`);

console.log(`\n${fail ? '❌' : '✅'} ${pass} پاس، ${fail} خطا\n`);
if (fail) process.exit(1);
