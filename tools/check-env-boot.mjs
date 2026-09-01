#!/usr/bin/env node
/**
 * چکِ «`.env` قبل از هر ماژولی که از env می‌خواند بار شده باشد».
 *
 * 🐛 باگی که این چک از آن ساخته شد (بازتولیدشده، نه فرضی): در ESM importهای ایستا
 * قبل از بدنه‌ی ماژول evaluate می‌شوند، پس `dotenv.config()` در بدنه‌ی `index.js`
 * **بعد از** بارگذاریِ `reading-core.js` اجرا می‌شد. pm2 فقط `ENV_FILE` را در محیطِ
 * واقعی می‌گذارد و `LOCALE` تازه از خودِ فایل می‌آید، پس هسته `LOCALE` را خالی
 * می‌دید و به `fa` برمی‌گشت: جدولِ دانشِ فارسی داخلِ پرامپتِ روسی، `langdata` خالی
 * (یعنی **هیچ گاردِ ضعفِ زبانی‌ای وجود نداشت**) و گنجینه‌ی فارسی برای کاربرِ روس.
 * هیچ خطایی هم نمی‌داد چون هر سه مسیر fail-safe اند.
 *
 * ⚠️ این چک عمداً **رفتاری** است: یک پروسه‌ی واقعیِ node با همان شکلِ محیطِ سرور
 * (فقط `ENV_FILE`، بدونِ `LOCALE`) اجرا می‌شود. یک ادعای رجکسی روی ترتیبِ import
 * کافی نبود، چون خودِ «چرا این ترتیب مهم است» یک رفتارِ رانتایمِ ESM است.
 * و یک **کنترلِ منفی** هم دارد: همان پروسه بدونِ `env-boot` باید فارسی بدهد،
 * وگرنه تست چیزی را ثابت نمی‌کند (درسِ `check-lucky`/`check-announce`).
 */
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const BOT  = join(ROOT, 'bots/tarot');
const SRC  = readFileSync(join(BOT, 'index.js'), 'utf8');
const BOOT = readFileSync(join(BOT, 'env-boot.js'), 'utf8');

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) pass++; else errs.push(msg); };
const eq = (a, b, msg) => ok(a === b, `${msg} — انتظار «${b}»، دیده شد «${a}»`);

/* ═══ ۱) فیکسچرِ .env و اجرای واقعیِ پروسه ═══ */
const TMP = mkdtempSync(join(tmpdir(), 'envboot-'));
const envFileFor = (locale) => {
  const p = join(TMP, `.env.${locale}`);
  writeFileSync(p, `LOCALE=${locale}\nBOT_TOKEN=x\nOPENROUTER_API_KEY=x\n`);
  return p;
};

// محیط عیناً همان چیزی است که pm2 می‌سازد: `ENV_FILE` هست، `LOCALE` نیست.
const probe = (locale, { withBoot = true } = {}) => {
  const code = `
    ${withBoot ? "import './env-boot.js';" : ''}
    const { cardName, LANG_DATA, CARD_KB, READING_MODEL } = await import('./reading-core.js');
    console.log(JSON.stringify({
      card: cardName('m00'),
      langdata: Object.keys(LANG_DATA).length > 0,
      kb: String(CARD_KB?.m00?.image || '').slice(0, 24),
      model: READING_MODEL,
    }));`;
  const env = { ...process.env, ENV_FILE: envFileFor(locale) };
  delete env.LOCALE;            // ← دقیقاً مثل سرور
  delete env.READING_MODEL;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code],
    { cwd: BOT, env, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
};

const ru = probe('ru');
eq(ru.card, 'Шут', 'با env-boot، نامِ کارتِ روسی از langdata.ru می‌آید');
ok(ru.langdata, 'با env-boot، LANG_DATA روسی بار می‌شود (یعنی گاردهای ضعفِ زبانی زنده‌اند)');
ok(/^[Ѐ-ӿ]/.test(ru.kb), `جدولِ دانشِ روسی بار می‌شود (دیده شد: «${ru.kb}»)`);

/* کنترلِ منفی — بدونِ env-boot باید همان باگ برگردد، وگرنه این تست هیچ نمی‌سنجد. */
const ruNoBoot = probe('ru', { withBoot: false });
eq(ruNoBoot.card, 'دیوانه', 'کنترلِ منفی: بدونِ env-boot هسته به فارسی برمی‌گردد (خودِ باگ)');
ok(!ruNoBoot.langdata, 'کنترلِ منفی: بدونِ env-boot، LANG_DATA خالی است');

/* فارسی: دادهٔ زبانی باید همان فارسیِ هاردکد بماند (این تنها زبانِ زنده است). */
const fa = probe('fa');
eq(fa.card, 'دیوانه', 'فارسی دست‌نخورده: نامِ کارت همان فارسیِ هاردکد');

/* ═══ ۲) مدلِ خوانش per زبان واقعاً شلیک می‌کند ═══
 * ⚠️ فارسی از ۱۴۰۵/۰۶/۱۰ به این فهرست اضافه شد (تصمیمِ صریحِ مالک، بعد از دو دورِ
 * ۹۰فالیِ جفت‌شده). تا آن روز این ادعا برعکس بود و می‌گفت «فارسی باید Flash بماند»؛
 * نگه‌داشتنِ ادعای قدیمی یعنی چک بعد از یک تصمیمِ آگاهانه قرمز بماند، و پاک‌کردنش
 * بدونِ جایگزین یعنی سوییچِ سهویِ زبانِ زنده دیگر گارد نداشته باشد. پس **جابه‌جا** شد. */
for (const l of ['fa', 'ru', 'pt', 'es'])
  eq(probe(l).model, 'openai/gpt-5.6-luna', `مدلِ خوانشِ «${l}» همان حکمِ آزمایشگاه است`);

/* override محیطی باید برنده بماند (راهِ آزمایشِ موردی بدونِ تغییرِ کد) */
{
  const env = { ...process.env, ENV_FILE: envFileFor('ru'), READING_MODEL: 'x/y' };
  delete env.LOCALE;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import './env-boot.js';const m=await import('./reading-core.js');console.log(m.READING_MODEL);"],
    { cwd: BOT, env, encoding: 'utf8' }).trim().split('\n').pop();
  eq(out, 'x/y', 'READING_MODEL محیطی بر جدولِ per زبان مقدم است');
}

/* ═══ ۳) ساختار: env-boot باید اولین import بماند ═══ */
const imports = [...SRC.matchAll(/^import\s.*?from\s+'([^']+)'|^import\s+'([^']+)'/gm)]
  .map(m => m[1] || m[2]);
eq(imports[0], './env-boot.js', 'اولین importِ index.js همان env-boot است');
ok(!/^\s*dotenv\.config\(/m.test(SRC),
  'index.js دیگر خودش dotenv.config صدا نمی‌زند (تک‌منبع؛ دو نقطه یعنی دوباره واگرا می‌شود)');
ok(/dotenv\.config\(\{\s*path:\s*process\.env\.ENV_FILE\s*\|\|\s*'\.env'\s*\}\)/.test(BOOT),
  'env-boot همان مسیرِ ENV_FILE قبلی را حفظ کرده');

/* ═══ ۴) پوشش از خودِ فایل‌ها استخراج می‌شود، نه از یک لیستِ دستی ═══
 * هر ماژولِ محلیِ tarot که سرِ بارگذاری از process.env می‌خواند باید **بعد از**
 * env-boot وارد شود. ماژولِ تازه‌ای که فردا اضافه شود خودبه‌خود پوشش می‌گیرد. */
const envReaders = readdirSync(BOT)
  .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'env-boot.js')
  .filter(f => {
    const body = readFileSync(join(BOT, f), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // فقط خواندنِ سطحِ ماژول مهم است؛ داخلِ تابع دیرتر اجرا می‌شود و امن است.
    return /^(?:const|let|var)\s+[^=]+=\s*[^;]*process\.env\./m.test(body);
  });
ok(envReaders.length > 0, 'حداقل یک ماژول سرِ بارگذاری از env می‌خواند (وگرنه این چک بی‌معنی شده)');
for (const f of envReaders) {
  const i = imports.indexOf(`./${f}`);
  ok(i === -1 || i > 0, `«${f}» سرِ بارگذاری از env می‌خواند و باید بعد از env-boot import شود`);
}
console.log(`ℹ️ ماژول‌های env-خوانِ سطحِ بارگذاری: ${envReaders.join(', ')}`);

/* ═══ گزارش ═══ */
if (errs.length) {
  console.error(`\n❌ check-env-boot: ${errs.length} خطا از ${pass + errs.length} ادعا`);
  for (const e of errs) console.error('   •', e);
  process.exit(1);
}
console.log(`✅ check-env-boot: ${pass} ادعا سبز`);
