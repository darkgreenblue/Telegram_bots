// چکِ CI برای کاهشِ پاداشِ دعوت (tarot v3.69.0): ۱۰ ⟵ ۵ الماس، **فقط فارسی**.
//
// چرا این چک لازم است، و چرا رفتاری است نه رجکسی:
//
// ۱) این یک استثنای **زبانی** است (بند ۲و ریشه). یک تغییرِ بی‌دقت می‌تواند بی‌صدا هر
//    چهار زبان را بزند، و چون هیچ خطایی نمی‌دهد فقط با اسکرین‌شاتِ یک کاربرِ روس معلوم
//    می‌شود — دقیقاً همان کلاسِ باگی که بند ۲و/۶ب ثبتش کرده.
// ۲) این یک تغییرِ **پولی** است با grandfathering: دعوتی که قبل از مرز ثبت شده باید
//    همان ۱۰ وعده‌داده‌شده را بگیرد. «کد درست است» را نمی‌شود از روی شکلِ کد فهمید؛
//    باید خودِ تابع با ردیف‌های واقعیِ دو طرفِ مرز اجرا شود.
// ۳) مرز روی `referrals.created_at` می‌نشیند و از جدولِ `migrations` خوانده می‌شود.
//    هر دو باید روی SQLite واقعی اجرا شوند، وگرنه یک `SELECT` باریک‌شده یا یک
//    `INSERT` بدونِ `OR IGNORE` مرز را در هر ری‌استارت جابه‌جا می‌کند و کلِ
//    grandfathering بی‌صدا از بین می‌رود.
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

console.log('\n💎 پاداشِ دعوت: ۱۰ ⟵ ۵ (فقط فارسی)\n');

/* ══ ۱) خودِ resolverها از سورس بریده و اجرا می‌شوند ══════════════════════ */
console.log('۱) رفتارِ resolverها');

const BLOCK = slice('const REFERRAL_BONUS_COINS = 3;', 'const WELCOME_BONUS_COINS_V2');
ok(!!BLOCK, 'بلوکِ ثابت‌ها و resolverهای دعوت از سورس بریده شد');

// بلوک را با یک EPOCHِ تزریقی و یک LOCALEِ تزریقی اجرا می‌کند. هیچ منطقی این‌جا
// بازنویسی نمی‌شود؛ فقط ورودی‌های محیطی پارامتر می‌شوند.
function build(locale, epoch, { localesLiteral = null } = {}) {
  if (!BLOCK) return null;
  let body = BLOCK.replace('let REFERRAL_5_EPOCH = 0;', 'let REFERRAL_5_EPOCH = __EPOCH;');
  if (localesLiteral !== null) {
    body = body.replace('const REFERRAL_5_LOCALES = [\'fa\'];',
      `const REFERRAL_5_LOCALES = ${localesLiteral};`);
  }
  if (body === BLOCK && localesLiteral === null) return null; // جایگزینیِ EPOCH نگرفت
  const fn = new Function('LOCALE', '__EPOCH', 'uxV2For', 'coinsOn', 'REFERRAL_BONUS', `
    ${body}
    return { referralBonusFor, referralPayoutFor, referralBonusLegacy, referral5On,
             REFERRAL_BONUS_COINS_V2, REFERRAL_BONUS_COINS_V3 };
  `);
  // دنیای امروزِ ربات: UX v2 برای همه باز است.
  return fn(locale, epoch, () => true, () => true, 10_000);
}

const EPOCH = 1_790_000_000;
const fa = build('fa', EPOCH);
ok(!!fa, 'بلوک با موفقیت اجرا شد (EPOCH تزریق شد)');

if (fa) {
  ok(fa.REFERRAL_BONUS_COINS_V3 === 5, 'پاداشِ تازه ۵ الماس است', `دیدم: ${fa.REFERRAL_BONUS_COINS_V3}`);
  ok(fa.REFERRAL_BONUS_COINS_V2 === 10, 'پاداشِ قدیمی هنوز ۱۰ است (لازمِ grandfathering)');
  ok(fa.referral5On() === true, 'فارسی مشمولِ کاهش است');
  ok(fa.referralBonusFor(1) === 5, 'عددِ نمایشیِ فارسی ۵ است', `دیدم: ${fa.referralBonusFor(1)}`);

  // grandfathering — قلبِ این تغییر.
  ok(fa.referralPayoutFor(1, { created_at: EPOCH - 1 }) === 10,
    'دعوتِ یک ثانیه قبل از مرز ⟵ همان ۱۰ وعده‌داده‌شده');
  ok(fa.referralPayoutFor(1, { created_at: EPOCH - 86_400 * 30 }) === 10,
    'دعوتِ یک ماه پیش ⟵ ۱۰');
  ok(fa.referralPayoutFor(1, { created_at: EPOCH }) === 5,
    'دعوتِ دقیقاً روی مرز ⟵ ۵');
  ok(fa.referralPayoutFor(1, { created_at: EPOCH + 1 }) === 5,
    'دعوتِ بعد از مرز ⟵ ۵');

  // fail-safe: ابهام همیشه به نفعِ وعده‌ی قدیمی تمام می‌شود.
  ok(fa.referralPayoutFor(1, { created_at: 0 }) === 10, 'ردیفِ بدونِ تاریخ ⟵ ۱۰ (fail-safe)');
  ok(fa.referralPayoutFor(1, {}) === 10, 'ردیفِ بی‌فیلد ⟵ ۱۰ (fail-safe)');
  ok(fa.referralPayoutFor(1, null) === 10, 'ردیفِ null ⟵ ۱۰ (fail-safe)');

  const noEpoch = build('fa', 0);
  ok(noEpoch && noEpoch.referralPayoutFor(1, { created_at: EPOCH + 1 }) === 10,
    'مرزِ خوانده‌نشده (۰) ⟵ همه ۱۰ می‌گیرند، نه ۵ (fail-safe به نفعِ کاربر)');
}

/* ══ ۲) سه زبانِ دیگر باید کاملاً دست‌نخورده بمانند ═══════════════════════ */
console.log('\n۲) استثنای زبانی — فقط فارسی');
for (const loc of ['ru', 'pt', 'es']) {
  const m = build(loc, EPOCH);
  if (!m) { ok(false, `بلوک برای ${loc} اجرا نشد`); continue; }
  ok(m.referral5On() === false, `${loc}: مشمولِ کاهش نیست`);
  ok(m.referralBonusFor(1) === 10, `${loc}: عددِ نمایشی همچنان ۱۰ است`, `دیدم: ${m.referralBonusFor(1)}`);
  ok(m.referralPayoutFor(1, { created_at: EPOCH + 999 }) === 10,
    `${loc}: دعوتِ بعد از مرز هم ۱۰ می‌گیرد (مرز اصلاً اعمال نمی‌شود)`);
  ok(m.referralPayoutFor(1, { created_at: EPOCH - 999 }) === 10,
    `${loc}: دعوتِ قبل از مرز هم ۱۰ می‌گیرد`);
}

/* ══ ۳) رول‌بکِ یک‌خطی واقعاً کار می‌کند ══════════════════════════════════ */
console.log('\n۳) رول‌بک');
const rolled = build('fa', EPOCH, { localesLiteral: '[]' });
if (!rolled) ok(false, 'ساختِ نسخه‌ی رول‌بک‌شده شکست خورد');
else {
  ok(rolled.referralBonusFor(1) === 10, 'با `REFERRAL_5_LOCALES = []` عددِ نمایشیِ فارسی به ۱۰ برمی‌گردد');
  ok(rolled.referralPayoutFor(1, { created_at: EPOCH + 999 }) === 10,
    'و پرداختش هم بیت‌به‌بیت همان قبل است');
}

/* ══ ۴) مرز روی SQLite واقعی: ساخته می‌شود و **جابه‌جا نمی‌شود** ══════════ */
console.log('\n۴) مرزِ migrations روی SQLite واقعی');
const insLine = CODE.split('\n').find(l => l.includes("VALUES ('referral_5'"));
const selLine = CODE.split('\n').find(l => l.includes("WHERE key='referral_5'"));
ok(!!insLine, 'خطِ ثبتِ مرزِ `referral_5` در سورس هست');
ok(!!selLine, 'خطِ خواندنِ مرزِ `referral_5` در سورس هست');
ok(!!insLine && /INSERT\s+OR\s+IGNORE/i.test(insLine),
  'ثبتِ مرز `INSERT OR IGNORE` است (وگرنه هر ری‌استارت مرز را جلو می‌برد)');

if (insLine && selLine) {
  const insSql = insLine.match(/db\.prepare\((["'`])([\s\S]*?)\1\)/)?.[2];
  const selSql = selLine.match(/db\.prepare\((["'`])([\s\S]*?)\1\)/)?.[2];
  const db = new Database(':memory:');
  db.exec('CREATE TABLE migrations (key TEXT PRIMARY KEY, done_at INTEGER NOT NULL DEFAULT 0)');
  db.prepare(insSql).run();
  const first = db.prepare(selSql).get()?.done_at || 0;
  ok(first > 1_700_000_000, 'اولین بوت مرز را با زمانِ واقعی مهر می‌زند', `دیدم: ${first}`);
  // بوتِ دوم (شبیه‌سازیِ ری‌استارت). مرز نباید تکان بخورد.
  db.prepare(insSql).run();
  const second = db.prepare(selSql).get()?.done_at || 0;
  ok(second === first, 'ری‌استارت مرز را جابه‌جا نمی‌کند', `${first} ⟵ ${second}`);
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
    const atBoundary = build('fa', born);        // مرز = لحظه‌ی ثبتِ همین ردیف
    const afterBoundary = build('fa', born + 1); // مرز یک ثانیه بعدتر
    ok(atBoundary && atBoundary.referralPayoutFor(1, row) === 5,
      'همان ردیف با مرزِ ≤ تاریخِ خودش ⟵ ۵');
    ok(afterBoundary && afterBoundary.referralPayoutFor(1, row) === 10,
      'همان ردیف با مرزِ بعد از تاریخِ خودش ⟵ ۱۰ (ستون واقعاً تصمیم‌ساز است)');
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
const FIVE = '۵', TEN = '۱۰';
const rendered = {
  'دکمه‌ی دعوتِ اینلاین': L.buttons.inviteWithBonus(5, cur),
  'دکمه‌ی اشتراک‌گذاری': L.buttons.share(5, cur),
  'متنِ صفحه‌ی دعوت': L.share.invitePrompt('tg_bot', 42, 5, cur),
  'خبرِ پاداش': L.share.referralReward('سارا', 5, cur, 12),
};
for (const [name, text] of Object.entries(rendered)) {
  ok(text.includes(FIVE), `${name}: عددِ ۵ در متن هست`, text);
  ok(!text.includes(TEN), `${name}: هیچ ۱۰ ای در متن نمانده`, text);
}
// کنترلِ معکوس: اگر عدد ۱۰ پاس داده شود باید ۱۰ چاپ شود. بدونِ این، ادعای بالا
// می‌توانست صرفاً یعنی «این رشته اصلاً عددی چاپ نمی‌کند».
ok(L.buttons.inviteWithBonus(10, cur).includes(TEN),
  'کنترلِ معکوس: همان رشته با ورودیِ ۱۰ عددِ ۱۰ را چاپ می‌کند');

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
ok(cmpVer(ver, '3.69.0') >= 0, `PRODUCT_VERSION برای این تغییرِ رفتاری بامپ شده (${ver})`);

console.log(`\n${fail ? '❌' : '✅'} ${pass} پاس، ${fail} خطا\n`);
if (fail) process.exit(1);
