#!/usr/bin/env node
// گاردِ تنوعِ محتوای روزهای کانال (mode: daily1) — برای **هر چهار زبان**.
//
// 🐛 چرا هست: بافرِ ۱۸ تا ۲۹ شهریور با چکِ «تفسیرِ تکراری» **سبز** شد، در حالی که یک
// ممیزیِ انسانی ۱۷ جفت تفسیرِ تقریباً یکسان پیدا کرد. چکِ قبلی فقط برابریِ **دقیقِ**
// رشته را می‌سنجید و آن‌هم فقط برای «همان کارت در همان ماه»، پس دو چیز را ساختاراً
// نمی‌دید: بازنویسیِ مترادف، و تکرارِ همان کارت در **ماهِ دیگر**.
//
// چهار سنجه، همه روی نمونه‌ی واقعیِ نقض آزمایش شده‌اند:
//   ۱) شباهتِ متنیِ دو تفسیرِ همان کارت (Jaccard روی کلماتِ محتوایی) در ۳۰ روزِ اخیر
//   ۲) یکنواختیِ ساختار: چند تفسیر از دوازده‌تا با یک **تعریفِ لغت‌نامه‌ای** شروع می‌شوند
//      («<کارت> یعنی…»، «<Карта> означает…»، «<Carta> significa…»). ⚠️ نسخه‌ی اولِ این
//      سنجه «شروع با نامِ کارت» را می‌شمرد که غلط بود: شروعِ تصویرمحور («سه چوبدست،
//      مردیه که رو به دریا ایستاده») هم با نام شروع می‌شود ولی دقیقاً همان چیزیه که
//      می‌خواهیم. مسئله جای نام نیست، رابطه‌ی تعریفی است.
//   ۳) کفِ طولِ تفسیر (متنِ خیلی کوتاه یعنی تعریفِ لغت‌نامه‌ای، نه فالِ آن کارت)
//   ۴) پرسشِ اینگیجمنتی در هدر (استراتژی صراحتاً ممنوعش کرده)
//
// مقایسه **درونِ هر زبان** انجام می‌شود؛ شباهتِ بین‌زبانی بی‌معنی است.
//
//   node tools/marketing/check-day-diversity.mjs [--locale ru] [--since YYYY-MM-DD]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES, postsDir, offscheduleDir, cardNames } from './locales.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };

// آستانه روی دیتای واقعی کالیبره شد، نه با حدس: هفده جفتِ تکراری که ممیزیِ انسانی پیدا
// کرد، شباهتِ unigram شان ۰٫۱۴ تا ۰٫۵۸ است، در حالی که سقفِ شباهتِ دو کارتِ **متفاوتِ**
// همان روز ۰٫۱۵ است. پس ۰٫۲۸ دوازده جفت از آن هفده تا را می‌گیرد و به نویز نمی‌خورد.
// ⚠️ حدِ صداقتِ این گارد: «بازنویسیِ با مترادف» را می‌گیرد، «همان ایده با کلماتِ کاملاً
// دیگر» را نه. آن یکی کارِ بازبینیِ انسانی/منتقد است و این گارد جایگزینش نیست.
const SIM_MAX = 0.28;
const DEF_OPENER_MAX = 0.5;  // حداکثر نیمی از تفسیرهای یک روز تعریفِ لغت‌نامه‌ای باشند
/** نشانه‌های «تعریف کردن» per زبان. زبانِ تازه که اضافه شد، ردیفش هم اضافه شود، وگرنه
 *  این سنجه برای آن زبان بی‌صدا از کار می‌افتد (سبزِ بی‌معنی). */
const DEF_MARKERS = {
  fa: ['یعنی'],
  ru: ['означает', 'это карта', 'символизирует'],
  pt: ['significa', 'é a carta', 'simboliza'],
  es: ['significa', 'es la carta', 'simboliza'],
};
const BODY_MIN = 240;
const LOOKBACK = 30;

// ——— دو سنجه‌ی «رجیستر»، از روی ۵۱۶ بدنه‌ی واقعیِ فارسی اندازه‌گیری شدند ———
//
// 🐛 چرا اضافه شدند: سه زبانِ تازه (ru/pt/es) دورِ اول متن را **درباره‌ی برج** نوشتند
// نه **با خواننده**: ۸۱ بدنه از ۸۴ روسی پاراگرافِ دوم را با «Овен разгоняется…»
// شروع می‌کرد و ۸۰ تا هیچ «ты» نداشت. متن دانشنامه‌ای می‌شد و خلافِ قاعده‌ی خودِ ربات
// بود («Всегда "ты"»). هیچ گاردِ موجودی این را نمی‌دید چون هر دو گاردِ قبلی درباره‌ی
// **بودنِ** ترجمه بودند نه **رجیسترِ** آن.
//
// معیار از خودِ فارسی آمد، نه از سلیقه: در ۵۱۶ بدنه‌ی منتشرشده فقط ۹ تا (۱٫۷٪) اصلاً
// نامِ ماه/برجِ خودشان را داخلِ بدنه دارند. خطِ هشتگِ بالای پست از قبل گفته این فال
// مالِ کیست؛ بدنه مستقیم با خواننده حرف می‌زند.
const SIGN_IN_BODY_MAX = 0.1;   // حداکثر ۱۰٪ از دوازده پستِ یک روز (فارسی: ۱٫۷٪)
/** نشانه‌های خطابِ دومشخصِ **مفرد** per زبان. زبانِ تازه ردیف نداشته باشد = قرمز، نه سبز
 *  (گاردی که برای یک زبان بی‌صدا از کار بیفتد بدتر از نبودنش است). */
// ⚠️ الگوی «همیشه درست» گارد نیست، تزیین است: دو کاندیدای اولِ فارسی (پی‌بستِ ـت و
// شناسه‌ی ـی) روی هر ۳۸۴ بدنه ۱۰۰٪ می‌خوردند چون داخلِ کلماتِ دیگر هم هستند. کنار
// گذاشته شدند و جایشان نشانه‌های واقعیِ دومشخص نشست.
//
// 🐛 و ⚠️ مرزِ واژه با `\b` برای الفبای غیرلاتین **کار نمی‌کند**: `\b` در جاوااسکریپت
// روی `[A-Za-z0-9_]` تعریف شده، پس `\bты\b` هرگز نمی‌خورد (هر دو طرفِ «т» غیرِواژه
// حساب می‌شوند و مرزی تشکیل نمی‌شود). نسخه‌ی اولِ همین فهرست این باگ را داشت و نتیجه‌اش
// عددِ **وارونه** بود: پرتغالی «۴ از ۱۲» گزارش شد در حالی که واقعاً ۱۲ از ۱۲ است.
// نزدیک بود ۸۴ بدنه‌ی سالمِ پرتغالی بی‌دلیل بازنویسی شوند. مرز باید صریح باشد:
const B = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');
const ADDRESS_MARKERS = {
  // فارسی خطاب را در **شناسه‌ی فعل و پی‌بست** حمل می‌کند نه فقط ضمیر، پس فهرست باید
  // امرِ دومشخص، فعلِ دومشخص و پی‌بستِ ملکیِ واقعی را با هم داشته باشد.
  fa: [
    /(^|[^؀-ۿ])تو([^؀-ۿ]|$)/u,
    /می‌[؀-ۿ]+ی(?=[^؀-ۿ]|$)/u,
    /(کن|بده|بگو|ببین|بنویس|بذار|بگیر|برو|بپرس|بفرست|بخواه|انتخاب|شروع|تموم|بمون|بیار|صدا)(?=[^؀-ۿ]|$)/u,
    /(داری|کنی|هستی|بودی|شدی|دیدی|خواستی|گرفتی|موندی|بلدی|می‌دونی)(?=[^؀-ۿ]|$)/u,
    /(دلت|حالت|سرت|کارت|جات|خودت|بهت|برات|ازت|باهات|کنارت)(?=[^؀-ۿ]|$)/u,
  ],
  ru: [B('ты|теб[еяё]|тобо[йю]|тво[йяеиё]\\p{L}*')],
  pt: [B('voc[êe]|teu|tua|teus|tuas|seu|sua|seus|suas|te|lhe|contigo')],
  // اسپانیایی pro-drop است: «Sostienes lo que empiezas» بدونِ هیچ ضمیری کاملاً
  // دومشخصِ مفرد است. پس شناسه‌ی فعل هم لازم است، وگرنه متنِ سالم قرمز می‌شود.
  es: [B('t[úu]|te|ti|tus|contigo'),
    B('\\p{L}{3,}(?:ás|és|ís)|\\p{L}{3,}ste|tienes|puedes|quieres|sabes|haces|dices|vas|eres|sientes|vives|vienes|sales|sigues|pones|das|ves|dejas|llevas|buscas|tomas|miras|hablas|piensas|esperas|cambias|vuelves|pasas|quedas|cargas|abres|cierras|eliges|entiendes|aprendes|cuentas|pides|muestras|mantienes|necesitas|reconoces|devuelves|prometes|terminas|empiezas|guardas|aguantas|sostienes|vales|notas|sueles')],
};
// آستانه per زبان، چون هر زبان مبنای کالیبراسیونِ خودش را دارد و یک عددِ مشترک یعنی
// حدس. اعداد روی دیتای واقعی سنجیده شدند، نه تخمین:
//   fa → ۳۸۴ بدنه‌ی منتشرشده، بدترین روزِ استاندارد ۱۱ از ۱۲ (۹۱٫۷٪)
//   pt → ۹۳۷ متنِ بومیِ ممیزی‌شده‌ی `daily-ganjineh.pt.json`، پوششِ ضمیری ۹۹٫۳٪
//   es → همان کورپوس، ۹۷٫۰٪ با ضمیر + شناسه‌ی فعل
//
// ⚠️ ru عمداً آستانه ندارد و این **یافته‌ی دیتاست، نه فراموشی**: در همان کورپوسِ
// بومیِ ممیزی‌شده‌ی روسی، فقط **۴٫۶٪** متن‌ها اصلاً ریشه‌ی «ты/теб/тво» دارند و
// ۷۵٪ نامِ برج را می‌آورند. یعنی رجیستری که اول «باگِ روسی» به نظر می‌رسید، دقیقاً
// همان چیزی است که محتوای درون‌رباتیِ روسی هم می‌کند. اجبارِ ۹۰٪ روی روسی یعنی
// اجبارِ **فرضِ من** نه یک قاعده‌ی زبانی (بند ۹/۰ب: نتیجه‌ی غافلگیرکننده اول سنجه را
// متهم کن). یک‌دستیِ سبکِ کانال با فارسی از راهِ سنجه‌ی «نامِ برج در بدنه» می‌آید که
// مکانیکی و بی‌ابهام است، نه از راهِ شمردنِ ضمیر.
const ADDRESS_MIN = { fa: 0.9, pt: 0.9, es: 0.9 };

// روزهای **منتشرشده** سندِ چیزی هستند که واقعاً فرستاده شده و بازنویسی نمی‌شوند؛ ضمناً
// روزهای پیش از قالبِ اسپویلر اصلاً بدنه‌ی قابلِ استخراج ندارند. پس گارد فقط از روزی به
// بعد قضاوت می‌کند که استانداردِ فعلی از آن‌جا شروع شده. آن‌ها همچنان **مبنای مقایسه**اند.
const STANDARD_FROM = { fa: '2026-09-06', ru: '2026-09-07', pt: '2026-09-07', es: '2026-09-07' };
const ONLY_LOCALE = arg('locale', '');
const SINCE_OVERRIDE = arg('since', '');

/** بدنه‌ی تفسیر: بینِ خطِ نامِ کارت و خطِ CTA */
function bodyOf(caption) {
  const m = caption.match(/\)\n\n([\s\S]*?)\n\n[^\n]*👇<\/tg-spoiler>$/);
  return m ? m[1].trim() : null;
}
// ⚠️ `toLowerCase` لازم است و فارسی آن را پنهان می‌کرد: فارسی حرفِ بزرگ ندارد، پس
// نسخه‌ی اولِ این گارد حساس به حروفِ بزرگ بود و کسی متوجه نشد. در پرتغالی همان جمله‌ای
// که یک بار ابتدای پاراگراف و یک بار وسطِ جمله می‌آید («Sete taças» / «sete taças»)
// دو توکنِ متفاوت می‌ساخت و شباهت را پایین می‌آورد. جفتِ واقعیِ Sete de Copas
// (۷ و ۱۳ سپتامبر) با حساسیت ۲۷٪ می‌شد و رد می‌شد، بدونِ حساسیت ۳۰٪ و قرمز.
const norm = (s) => s.toLowerCase().replace(/‌/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
/** مجموعه‌ی کلماتِ محتوایی (سه‌حرف به بالا؛ حروفِ اضافه و ضمیر خودبه‌خود کنار می‌روند) */
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const problems = [];
let daysChecked = 0;

for (const loc of LOCALES) {
  if (ONLY_LOCALE && loc !== ONLY_LOCALE) continue;
  // هر دو مسیر: روزهای زمان‌بندی‌شده و روزهایی که دستی منتشر شده‌اند. محتوا محتواست و
  // تکرارش برای خواننده فرقی نمی‌کند که کدام مسیر فرستاده باشدش.
  const dirs = [postsDir(loc), offscheduleDir(loc)].filter((d) => existsSync(d));
  if (!dirs.length) continue;
  const since = SINCE_OVERRIDE || STANDARD_FROM[loc] || '0000-00-00';
  const names = await cardNames(loc);

  const files = dirs.flatMap((d) => readdirSync(d)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(f))
    .map((f) => ({ dir: d, file: f })))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const seen = []; // {date, file, month, key, body, w}

  for (const { dir, file } of files) {
    const date = file.slice(0, 10);
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const posts = doc.posts || [];
    const judged = date >= since;
    if (judged) daysChecked++;
    let defOpeners = 0;
    let signInBody = 0;
    let addressed = 0;
    const markers = DEF_MARKERS[loc] || [];
    const addr = ADDRESS_MARKERS[loc];

    for (const p of posts) {
      const body = bodyOf(p.caption || '');
      if (!body) {
        if (judged) problems.push(`[${loc}] ${file} ${p.month}: بدنه‌ی تفسیر استخراج نشد (قالبِ کپشن خراب است)`);
        continue;
      }
      const cname = names[p.key] || p.cardFa || '';
      // آیا جمله‌ی اول یک تعریف است؟ (نشانه‌ی تعریف در ابتدای بدنه)
      const head = body.slice(0, 60).toLowerCase();
      if (markers.some((m) => head.includes(m.toLowerCase()))) defOpeners++;
      // نامِ برجِ خودِ پست داخلِ بدنه (مرزِ واژه لازم است: «دی» و «تیر» داخلِ کلماتِ
      // دیگر هم پیدا می‌شوند و بدونِ مرز، فارسی عددِ کاملاً جعلی می‌دهد)
      if (p.month && new RegExp(`(^|[^\\p{L}])${p.month.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(body)) signInBody++;
      if (addr && addr.some((r) => r.test(body))) addressed++;
      const w = words(body);
      if (judged) {
        if (body.length < BODY_MIN) problems.push(`[${loc}] ${file} ${p.month}: تفسیر فقط ${body.length} کاراکتر است (کف ${BODY_MIN})`);
        for (const s of seen) {
          if (s.key !== p.key) continue;
          if ((new Date(date) - new Date(s.date)) / 86400e3 > LOOKBACK) continue;
          const sim = jaccard(w, s.w);
          if (sim > SIM_MAX) {
            problems.push(`[${loc}] ${file} ${p.month} «${cname || p.key}»: ${Math.round(sim * 100)}٪ شبیهِ ${s.file} ${s.month} است (سقف ${Math.round(SIM_MAX * 100)}٪)`);
          }
        }
      }
      seen.push({ date, file, month: p.month, key: p.key, w });
    }

    if (judged && posts.length) {
      if (!markers.length) {
        problems.push(`[${loc}] ${file}: نشانه‌های تعریف برای زبانِ «${loc}» تعریف نشده (DEF_MARKERS) — سنجه‌ی یکنواختی بی‌صدا از کار می‌افتاد`);
      } else if (defOpeners / posts.length > DEF_OPENER_MAX) {
        problems.push(`[${loc}] ${file}: ${defOpeners} از ${posts.length} تفسیر با تعریفِ لغت‌نامه‌ای شروع می‌شود (سقف ${Math.round(DEF_OPENER_MAX * 100)}٪) — ساختار یکنواخت شده`);
      }
      if (signInBody / posts.length > SIGN_IN_BODY_MAX) {
        problems.push(`[${loc}] ${file}: ${signInBody} از ${posts.length} تفسیر نامِ برجِ خودش را داخلِ متن آورده (سقف ${Math.round(SIGN_IN_BODY_MAX * 100)}٪) — متن دارد درباره‌ی برج حرف می‌زند نه با خواننده؛ خطِ هشتگ از قبل گفته این فال مالِ کیست`);
      }
      const floor = ADDRESS_MIN[loc];
      if (floor === undefined) {
        // زبانی که عمداً آستانه ندارد (بالا مستند شده) باید **نشانه** داشته باشد،
        // وگرنه نه اندازه‌گیری می‌شود نه معلوم است که عمدی بوده.
        if (!addr) problems.push(`[${loc}] ${file}: نه آستانه‌ی خطاب دارد نه نشانه‌های آن — یکی از این دو باید تعریف شود`);
      } else if (!addr) {
        problems.push(`[${loc}] ${file}: نشانه‌های خطابِ دومشخص برای زبانِ «${loc}» تعریف نشده (ADDRESS_MARKERS) — سنجه‌ی رجیستر بی‌صدا از کار می‌افتاد`);
      } else if (addressed / posts.length < floor) {
        problems.push(`[${loc}] ${file}: فقط ${addressed} از ${posts.length} تفسیر خطابِ مستقیمِ دومشخص دارد (کف ${Math.round(floor * 100)}٪) — متن دانشنامه‌ای شده`);
      }
      const h = doc.header || '';
      if (/[؟?]/.test(h)) problems.push(`[${loc}] ${file}: هدر سؤال می‌پرسد («${h.split('\n').pop()}») — CTAی اینگیجمنتی ممنوع است`);
    }
  }
}

if (problems.length) {
  console.error(`❌ گاردِ تنوع: ${problems.length} مشکل\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✅ گاردِ تنوع: ${daysChecked} روز بررسی شد؛ نه تفسیرِ بازنویسی‌شده، نه ساختارِ یکنواخت، نه هدرِ سؤالی.`);
