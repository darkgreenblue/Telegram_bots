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
const norm = (s) => s.replace(/‌/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
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
    const markers = DEF_MARKERS[loc] || [];

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
