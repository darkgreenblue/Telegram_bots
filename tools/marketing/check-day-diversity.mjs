#!/usr/bin/env node
// گاردِ تنوعِ محتوای روزهای کانال (mode: daily1).
//
// 🐛 چرا هست: بافرِ ۱۸ تا ۲۹ شهریور با چکِ «تفسیرِ تکراری» **سبز** شد، در حالی که یک
// ممیزیِ انسانی ۱۷ جفت تفسیرِ تقریباً یکسان پیدا کرد. چکِ قبلی فقط برابریِ **دقیقِ**
// رشته را می‌سنجید و آن‌هم فقط برای «همان کارت در همان ماه»؛ پس دو چیز را ساختاراً
// نمی‌دید: بازنویسیِ مترادف («خودت هم می‌دونستی» / «ته دلت می‌دونستی»)، و تکرارِ همان
// کارت در **ماهِ دیگر**. یعنی همان الگوی آشنا: سبزِ گارد دو معنی داشت و ما معنیِ
// اشتباه را برداشتیم.
//
// این گارد چهار چیز را می‌سنجد و همه‌شان روی نمونه‌ی واقعیِ نقض قرمز شده‌اند:
//   ۱) شباهتِ متنِ دو تفسیرِ همان کارت (Jaccard روی کلماتِ محتوایی) در ۳۰ روزِ اخیر
//   ۲) یکنواختیِ ساختار: سهمِ کپشن‌هایی که با «<کارت> یعنی …» شروع می‌شوند
//   ۳) کفِ طولِ تفسیر (متنِ خیلی کوتاه یعنی تعریفِ لغت‌نامه‌ای، نه فالِ آن کارت)
//   ۴) پرسشِ اینگیجمنتی در هدر («ماهِ تولدت کدومه؟» هم‌معنیِ «مالِ کدوم ماهی؟» است)
//
//   node tools/marketing/check-day-diversity.mjs [--dir marketing/tarot/posts] [--since YYYY-MM-DD]

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
const DIR = arg('dir', 'marketing/tarot/posts');
// روزهای **منتشرشده** سندِ چیزی هستند که واقعاً فرستاده شده و بازنویسی نمی‌شوند؛ ضمناً
// روزهای پیش از قالبِ اسپویلر اصلاً بدنه‌ی قابلِ استخراج ندارند. پس گارد فقط از روزی به
// بعد قضاوت می‌کند که استانداردِ فعلی از آن‌جا شروع شده. آن‌ها همچنان **مبنای مقایسه**اند
// (تکرار نسبت به گذشته گرفته می‌شود)، فقط خودشان محکوم نمی‌شوند.
const STANDARD_FROM = '2026-09-06';
const SINCE = arg('since', STANDARD_FROM);

// آستانه روی دیتای واقعی کالیبره شد، نه با حدس: هفده جفتِ تکراری که ممیزیِ انسانی پیدا
// کرد، شباهتِ unigram شان ۰٫۱۴ تا ۰٫۵۸ است، در حالی که سقفِ شباهتِ دو کارتِ **متفاوتِ**
// همان روز ۰٫۱۵ است. پس ۰٫۲۸ دوازده جفت از آن هفده تا را می‌گیرد و به نویز نمی‌خورد.
// ⚠️ حدِ صداقتِ این گارد: «بازنویسیِ با مترادف» را می‌گیرد، «همان ایده با کلماتِ کاملاً
// دیگر» را نه (پنج جفتِ باقی‌مانده از همان نوع‌اند). آن یکی کارِ بازبینیِ انسانی/منتقد است
// و این گارد جایگزینش نیست.
const SIM_MAX = 0.28;
const YANI_MAX = 0.5;      // حداکثر نیمی از کپشن‌های یک روز با «یعنی» شروع شوند
const BODY_MIN = 240;      // کفِ طولِ تفسیر
const LOOKBACK = 30;

const files = readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(f)).sort();
const days = files.map((f) => ({ file: f, date: f.slice(0, 10), doc: JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

/** بدنه‌ی تفسیر: بینِ خطِ نامِ کارت و خطِ CTA */
function bodyOf(caption) {
  const m = caption.match(/\)\n\n([\s\S]*?)\n\n[^\n]*👇<\/tg-spoiler>$/);
  return m ? m[1].trim() : null;
}
const norm = (s) => s.replace(/[‌]/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
/** مجموعه‌ی کلماتِ محتوایی (سه‌حرف به بالا؛ حروفِ اضافه و ضمیر خودبه‌خود کنار می‌روند) */
function words(s) {
  return new Set(norm(s).split(' ').filter((w) => w.length > 2));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const problems = [];
const seen = []; // {date, file, month, key, cardFa, orientation, body, tri}

for (const d of days) {
  const posts = d.doc.posts || [];
  let yani = 0;
  for (const p of posts) {
    const body = bodyOf(p.caption);
    // فایل‌های قبل از قالبِ اسپویلر (پیش از ۱۸ مرداد ۱۴۰۵) بدنه‌ی قابلِ استخراج ندارند؛
    // آن‌ها فقط از مقایسه بیرون می‌مانند و خطا نیستند. ولی فایلِ **تازه** باید قالب داشته باشد.
    if (!body) {
      if (!SINCE || d.date >= SINCE) problems.push(`${d.file} ${p.month}: بدنه‌ی تفسیر استخراج نشد (قالبِ کپشن خراب است)`);
      continue;
    }
    if (body.startsWith(`${p.cardFa} یعنی`) || body.startsWith(`${p.cardFa}ِ`) && /^[^\n]{0,40}یعنی/.test(body)) yani++;
    else if (/^[^\n]{0,45}\bیعنی\b/.test(body)) yani++;
    const tri = words(body);
    if (!SINCE || d.date >= SINCE) {
      if (body.length < BODY_MIN) problems.push(`${d.file} ${p.month}: تفسیر فقط ${body.length} کاراکتر است (کف ${BODY_MIN})`);
      for (const s of seen) {
        if (s.key !== p.key) continue;
        const gap = (new Date(d.date) - new Date(s.date)) / 86400e3;
        if (gap > LOOKBACK) continue;
        const sim = jaccard(tri, s.tri);
        if (sim > SIM_MAX) {
          problems.push(`${d.file} ${p.month} «${p.cardFa}»: ${Math.round(sim * 100)}٪ شبیهِ ${s.file} ${s.month} است (سقف ${Math.round(SIM_MAX * 100)}٪)`);
        }
      }
    }
    seen.push({ date: d.date, file: d.file, month: p.month, key: p.key, cardFa: p.cardFa, orientation: p.orientation, body, tri });
  }
  if ((!SINCE || d.date >= SINCE) && posts.length) {
    const ratio = yani / posts.length;
    if (ratio > YANI_MAX) problems.push(`${d.file}: ${yani} از ${posts.length} تفسیر با «… یعنی» شروع می‌شود (سقف ${Math.round(YANI_MAX * 100)}٪) — ساختار یکنواخت شده`);
    const h = d.doc.header || '';
    if (/[؟?]/.test(h)) problems.push(`${d.file}: هدر سؤال می‌پرسد («${h.split('\n').pop()}») — CTAی اینگیجمنتی ممنوع است`);
  }
}

if (problems.length) {
  console.error(`❌ گاردِ تنوع: ${problems.length} مشکل\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✅ گاردِ تنوع: ${days.length} روز بررسی شد؛ نه تفسیرِ بازنویسی‌شده، نه ساختارِ یکنواخت، نه هدرِ سؤالی.`);
