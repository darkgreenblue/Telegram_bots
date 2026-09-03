// چکِ CI: زیرساختِ کمپینِ مارکتینگ باید برای **هر زبانِ تاروت** همان‌قدر کامل باشد که
// برای فارسی هست.
//
// خواسته‌ی صریحِ مالک (۱۴۰۵/۰۶/۱۲): «هر وقت بخواهم مارکتینگ کنم، می‌روم در داشبورد،
// ربات هر زبان را انتخاب می‌کنم، UTM و کمپین می‌سازم. زیرساختش را مثل فارسی موجود کن.»
//
// ⚠️ چرا این یک چکِ جدا لازم داشت: ردیفِ `tarot-intl` در `lib/bots.js` برای **تحلیل**
// ساخته شده (یک نمای تجمیعی روی سه دیتابیس)، ولی یک کمپین به یک **لینک** ختم می‌شود و
// هر زبان رباتِ جدا با @username جداست. تا قبل از این، دو خرابیِ بی‌صدا داشت:
//   ۱) ساختِ کمپین برای یک زبانِ مشخص با «ربات نامعتبر» رد می‌شد.
//   ۲) یک فیلدِ یوزرنیم برای هر سه زبان بود، پس لینکِ کمپینِ اسپانیایی می‌توانست به
//      رباتِ روسی برود. اتریبیوشن درست جمع می‌شد ولی کاربر به رباتِ اشتباه می‌رفت؛
//      همان خانواده‌ی «عددِ درست، واحدِ دروغ» (بند ۶ج ریشه).
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

/* ── فیکسچر: همان چیدمانِ سرور، چهار دیتابیسِ زبانی کنارِ هم ── */
const root = mkdtempSync(path.join(tmpdir(), 'mktscope-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
for (const lang of ['fa', 'ru', 'pt', 'es']) {
  const db = new Database(path.join(dataDir, `bot-${lang}.db`));
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '',
    first_source TEXT DEFAULT '', created_at INTEGER DEFAULT 0);`);
  db.close();
}
process.env.TAROT_DB_DIR = dataDir;

/* ⚠️ `lib/platform.js` هنگامِ import یک `./data/platform.db` **نسبت به cwd** باز می‌کند،
 * پس قبل از import باید داخلِ ریشه‌ی موقت باشیم، وگرنه چک روی دیتای واقعیِ داشبورد
 * می‌نویسد. مسیرِ ماژول‌ها عمداً مطلق است چون cwd عوض می‌شود. */
const REPO = path.resolve('.');
mkdirSync(path.join(root, 'data'), { recursive: true });
process.chdir(root);

const M = await import(path.join(REPO, 'bots/dashboard/routes/marketing.js'));
const { baseKey, langOfKey } = await import(path.join(REPO, 'bots/dashboard/lib/bots.js'));
const { listCampaigns } = await import(path.join(REPO, 'bots/dashboard/lib/platform.js'));
const SRC = readFileSync(path.join(REPO, 'bots/dashboard/routes/marketing.js'), 'utf8');

console.log('\n📣 اسکوپِ کمپین per زبان\n');

const scopes = M.campaignScopes();
const keys = scopes.map(s => s.key);

/* ══ ۱) هر زبان اسکوپِ خودش را دارد ══════════════════════════════════════ */
for (const lang of ['ru', 'pt', 'es']) {
  ok(keys.includes(`tarot-intl@${lang}`), `اسکوپِ «tarot-intl@${lang}» وجود دارد`);
}
ok(keys.includes('tarot'), 'فارسی اسکوپِ خودش را دارد (بدونِ پسوند)');
ok(keys.includes('tarot-intl'), 'نمای تجمیعی هم می‌ماند');

// ربات تک‌زبانه نباید پسوند بگیرد، وگرنه فرمِ یوزرنیم بی‌دلیل شلوغ می‌شود
ok(!keys.some(k => k.startsWith('voice2text@')), 'ربات تک‌زبانه اسکوپِ زبان‌دار نمی‌گیرد');

/* ══ ۲) ساختِ کمپین برای یک زبانِ مشخص پذیرفته می‌شود ═════════════════════
 * این همان چیزی است که قبلاً «ربات نامعتبر» می‌داد. */
for (const lang of ['ru', 'pt', 'es']) {
  ok(M.validScope(`tarot-intl@${lang}`) === `tarot-intl@${lang}`,
    `کمپینِ «${lang}» ساخته می‌شود`);
}
ok(M.validScope('tarot') === 'tarot', 'کمپینِ فارسی مثل قبل ساخته می‌شود');
ok(M.validScope('tarot-intl') === 'tarot-intl', 'کمپینِ تجمیعی هم مجاز است');

/* ══ ۳) ورودیِ نامعتبر رد می‌شود (این مسیر از فرمِ وب می‌آید) ═══════════════ */
for (const bad of ['tarot-intl@de', 'bogus', 'bogus@ru', 'a@b@c', '../etc', 'tarot-intl@', '', null,
                   'TAROT-INTL@RU', 'tarot intl']) {
  ok(M.validScope(bad) === '', `ورودیِ نامعتبر رد می‌شود: ${JSON.stringify(bad)}`);
}
// زبانی که دیتابیس ندارد نباید اسکوپ بسازد، وگرنه لینکی ساخته می‌شود که هیچ رباتی ندارد
ok(M.validScope('tarot-intl@ar') === '', 'زبانِ بدونِ دیتابیس اسکوپِ معتبر نیست');

/* ══ ۴) یوزرنیمِ جدا per زبان ═════════════════════════════════════════════
 * ادعای مرکزی: هر اسکوپی که کمپین می‌گیرد باید کلیدِ یوزرنیمِ **خودش** را داشته باشد،
 * وگرنه لینکِ یک زبان به رباتِ زبانِ دیگر می‌رود. */
const linkable = scopes.filter(s => !s.aggregate).map(s => s.key);
for (const lang of ['ru', 'pt', 'es']) {
  ok(linkable.includes(`tarot-intl@${lang}`), `«${lang}» فیلدِ یوزرنیمِ خودش را دارد`);
}
ok(!linkable.includes('tarot-intl'),
  'ردیفِ تجمیعی یوزرنیم نمی‌گیرد (ربات نیست، سه ربات است)');
ok(new Set(linkable).size === linkable.length, 'هیچ اسکوپی دوبار در فرم نمی‌آید');

/* ══ ۴ب) خودِ `marketingCreate` ══════════════════════════════════════════
 * ⚠️ این بخش از یک جهشِ **زنده‌مانده** آمد: نسخه‌ی اولِ همین فایل فقط `validScope` را
 * می‌سنجید، پس برگرداندنِ `marketingCreate` به اعتبارسنجیِ قدیمی (خودِ باگِ اصلی) هیچ
 * ادعایی را قرمز نمی‌کرد. چک آینه‌ی helper بود، نه سنجشِ مسیرِ واقعی (بند ۲و/۶ب ریشه). */
const form = (o) => ({ get: (k) => (k in o ? o[k] : null) });
for (const lang of ['ru', 'pt', 'es']) {
  let msg = '', threw = '';
  try { msg = M.marketingCreate(form({ bot: `tarot-intl@${lang}`, source: 'کانال تست', medium: 'paid', name: `لانچ ${lang}` })); }
  catch (e) { threw = e.message; }
  ok(!threw, `marketingCreate کمپینِ «${lang}» را می‌سازد`, threw);
  const mine = listCampaigns().filter(c => c.bot === `tarot-intl@${lang}`);
  ok(mine.length === 1, `کمپینِ ساخته‌شده به اسکوپِ «${lang}» گره خورد`,
    `شد ${mine.length} ردیف با bot=tarot-intl@${lang}`);
}
{
  let threw = '';
  try { M.marketingCreate(form({ bot: 'tarot-intl@de', source: 'x', medium: 'paid' })); }
  catch (e) { threw = e.message; }
  ok(!!threw, 'marketingCreate زبانِ ناموجود را رد می‌کند');
}
/* و همین‌طور خودِ **HTMLِ رندرشده**: یک جهشِ دیگر زنده ماند چون فرمِ یوزرنیم را
 * می‌شد به `BOTS` برگرداند بدونِ اینکه هیچ ادعایی قرمز شود. داشتنِ اسکوپ در دیتا
 * کافی نیست، باید در فرمی که مالک می‌بیند هم فیلد داشته باشد. */
let html = '';
try { html = M.marketingBody(new URL('http://x/marketing?bot=tarot-intl')); }
catch (e) { ok(false, 'صفحه‌ی مارکتینگ رندر می‌شود', e.message); }
if (html) {
  for (const lang of ['ru', 'pt', 'es']) {
    ok(html.includes(`name="u_tarot-intl@${lang}"`),
      `فرمِ یوزرنیم فیلدِ «${lang}» را دارد`);
    ok(html.includes(`value="tarot-intl@${lang}"`),
      `سلکتِ ساختِ کمپین گزینه‌ی «${lang}» را دارد`);
  }
  ok(!html.includes('name="u_tarot-intl"'),
    'ردیفِ تجمیعی فیلدِ یوزرنیم ندارد');
  // کمپینِ زبانی که بالا ساختیم باید در نمای تجمیعی هم دیده شود
  ok(html.includes('لانچ ru'), 'کمپینِ یک زبان در نمای تجمیعی هم دیده می‌شود');
}

// ادعای ساختاری: مسیرِ ساخت واقعاً از validScope رد می‌شود، نه از فهرستِ خامِ BOTS
ok(/const bot = validScope\(body\.get\('bot'\)\)/.test(SRC),
  'marketingCreate از validScope استفاده می‌کند');
ok(!/BOTS\.find\(b => b\.key === body\.get\('bot'\)\)/.test(SRC),
  'اعتبارسنجیِ قدیمیِ کلیدِ خام دیگر در سورس نیست');

/* ══ ۵) کلیدها با پروفایلِ ربات سازگار می‌مانند ═══════════════════════════ */
for (const k of keys) {
  ok(baseKey(k).length > 0 && !baseKey(k).includes('@'), `baseKey(«${k}») تمیز است`);
}
ok(scopes.filter(s => langOfKey(s.key)).every(s => s.title.includes('—')),
  'عنوانِ اسکوپِ زبان‌دار زبانش را نشان می‌دهد');

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
