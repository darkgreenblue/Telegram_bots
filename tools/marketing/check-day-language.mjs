#!/usr/bin/env node
// گاردِ زبانیِ کپشن‌های کانال، با **همان الگوهایی که خودِ ربات برای خروجیِ مدل دارد**.
//
// چرا: `langdata.<loc>.json` یک فهرستِ `defects` دارد (خطابِ رسمی، نشتِ جنسیت، واژه‌ی
// انگلیسی، پرتغالیِ اروپا…) که روی خروجیِ زنده‌ی مدل اجرا می‌شود و با ممیزیِ بومی
// کالیبره شده. متنِ کانال هم دقیقاً همان زبان و همان مخاطب را دارد، پس دوباره‌نوشتنِ
// این الگوها هم اتلاف است هم دیر یا زود واگرا می‌شود. این‌جا همان‌ها **مصرف** می‌شوند.
//
// به‌علاوه دو چیزِ مخصوصِ کانال:
//   • هشتگ باید عیناً یکی از دوازده رشته‌ی مجازِ همان زبان باشد (allowlist). یک بار
//     `#Geminis` نوشتن به‌جای `#Géminis` آرشیوِ آن برج را برای همیشه دو تکه می‌کند.
//   • هشتگ هرگز برهنه نمی‌ایستد؛ باید داخلِ جمله‌ی توضیحیِ خطِ اول باشد.
//
//   node tools/marketing/check-day-language.mjs [--locale es]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, postsDir, offscheduleDir, signs, hashtag } from './locales.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--locale'); return i === -1 ? '' : argv[i + 1]; })();

// روزهای منتشرشده سندِ چیزی هستند که واقعاً فرستاده شده و بازنویسی نمی‌شوند. قالبِ
// «هشتگ داخلِ جمله‌ی توضیحی» از ۱۸ مرداد آمد؛ پیش از آن هشتگ عمداً خطِ اولِ برهنه بود.
// همان قاعده‌ی گاردِ تنوع: از تاریخِ شروعِ استانداردِ فعلی به بعد قضاوت می‌شود.
const STANDARD_FROM = { fa: '2026-09-06', ru: '2026-09-07', pt: '2026-09-07', es: '2026-09-07' };

// ⚠️ قرمزِ کاذبِ شناخته‌شده. الگوهای `genero` هم فعل را می‌گیرند هم صفت را، چون در این
// زبان‌ها یک شکل هر دو کار را می‌کند. سه شکلِ زیر روی جمله‌ی واقعی خوانده و **تأیید**
// شدند که نشتِ جنسیت نیستند:
//   • `você segura <مفعول>` → فعلِ segurar است («نگه می‌داری»)، نه صفتِ «امن»
//   • `sente rápido` → `rápido` این‌جا قید است، نه صفت
//   • `entrada bem preparada` → صفت با اسمِ **مؤنثِ** قبلش می‌خواند، نه با خواننده
// قاعده‌ی افزودن به این فهرست: اول جمله را بخوان. گاردی که مدام دروغ می‌گوید همان‌قدر
// بی‌فایده است که گاردی که هیچ نمی‌گوید (بند ۲و/۶ب-۲ ریشه).
// 📌 همین قرمزِ کاذب در گاردِ **خودِ ربات** هم هست و آن‌جا یک تعمیرِ بی‌دلیلِ مدل
//    می‌سازد؛ عمداً این‌جا دست نخورد چون تغییرِ رفتارِ رباتِ زنده تصمیمِ جداست.
const FALSE_POSITIVE = {
  pt: [
    // `segura` وقتی **مفعول** می‌گیرد فعلِ segurar است. صفتِ «امن» مفعول نمی‌گیرد؛
    // شکلِ صفتی‌اش («está segura demais») با lookahead بیرون گذاشته شده تا اگر روزی
    // نشتِ واقعی آمد، همچنان قرمز بدهد.
    /\bsegura\s+(?!demais\b|muito\b|bem\b|o\s+suficiente)\p{L}/iu,
    /\bsente\s+r[áa]pido\b/i,
    /\b(?:entrada|sa[íi]da|conversa|resposta|decis[ãa]o|frase)\s+(?:bem\s+|j[áa]\s+)?preparada\b/i,
  ],
  es: [],
  ru: [],
};

const problems = [];
let captions = 0;

for (const loc of LOCALES) {
  if (only && loc !== only) continue;
  const ld = join(ROOT, 'bots/tarot', `langdata.${loc}.json`);
  // فارسی langdata ندارد (زبانِ canonical است) — الگوهای زبانی برایش موضوعیت ندارد.
  const defects = existsSync(ld) ? (JSON.parse(readFileSync(ld, 'utf8')).defects || []) : [];
  const allow = new Set((await signs(loc)).map((s) => hashtag(loc, s)));

  for (const dir of [postsDir(loc), offscheduleDir(loc)]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(x)).sort()) {
      if (f.slice(0, 10) < (STANDARD_FROM[loc] || '0000-00-00')) continue;
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const p of doc.posts || []) {
        const cap = p.caption || '';
        captions++;
        // ۱) هشتگ در فهرستِ مجاز
        const tags = cap.match(/#[^\s#]+/g) || [];
        if (!tags.length) problems.push(`[${loc}] ${f} ${p.month}: هیچ هشتگی ندارد`);
        for (const t of tags) {
          if (!allow.has(t)) problems.push(`[${loc}] ${f} ${p.month}: هشتگِ «${t}» در فهرستِ مجاز نیست`);
        }
        // ۲) هشتگ برهنه نایستد: خطِ اول باید متنِ دیگری هم داشته باشد
        const first = cap.split('\n')[0].trim();
        if (tags.some((t) => first === t)) problems.push(`[${loc}] ${f} ${p.month}: هشتگ برهنه در خطِ اول ایستاده`);
        // ۳) الگوهای زبانیِ خودِ ربات، فقط روی بدنه‌ی تفسیر (نه روی نامِ کارت و قالب)
        const m = cap.match(/\)\n\n([\s\S]*?)\n\n[^\n]*👇<\/tg-spoiler>$/);
        const body = m ? m[1] : cap;
        for (const d of defects) {
          let re;
          try { re = new RegExp(d.pattern, d.flags || ''); } catch { continue; }
          const hit = body.match(re);
          if (!hit) continue;
          if (d.except) { try { if (new RegExp(d.except, d.flags || '').test(hit[0])) continue; } catch {} }
          // متنِ اطراف را هم بده، چون تشخیصِ فعل از صفت به مفعولِ بعدش وابسته است
          const around = body.slice(Math.max(0, hit.index - 20), hit.index + hit[0].length + 40);
          if ((FALSE_POSITIVE[loc] || []).some((re) => re.test(around))) continue;
          problems.push(`[${loc}] ${f} ${p.month}: نقضِ «${d.id}» → «${hit[0].trim()}»  (${d.hint || ''})`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`❌ گاردِ زبانیِ کپشن: ${problems.length} مشکل\n`);
  for (const p of problems.slice(0, 60)) console.error('  ' + p);
  if (problems.length > 60) console.error(`  … و ${problems.length - 60} مورد دیگر`);
  process.exit(1);
}
console.log(`✅ گاردِ زبانیِ کپشن: ${captions} کپشن بررسی شد؛ هشتگ‌ها در فهرستِ مجاز و هیچ نقضِ الگوی زبانی.`);
