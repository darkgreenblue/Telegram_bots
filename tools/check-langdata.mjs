#!/usr/bin/env node
// گاردِ دادهٔ زبانیِ ساختاری (`bots/tarot/langdata.<locale>.json`) — قراردادِ بند ۲و.
//
// چرا این چک وجود دارد: تا قبل از این، نامِ کارت و جایگاه و چیدمان **فارسیِ هاردکد**
// بودند و مستقیم وارد پرامپت و کپشنِ رو-به-کاربر می‌شدند. یک زبانِ تازه که این فایل را
// ناقص بیاورد، هیچ خطایی نمی‌دهد: فقط بی‌صدا به فارسی fallback می‌کند. دو ضرر:
//   ۱) کاربرِ آن زبان وسطِ فالِ پولی‌اش نامِ فارسی می‌بیند.
//   ۲) سنجه‌ی «لنگر» آزمایشگاه (مرکزی‌ترین متریکِ کیفیت) روی آن زبان بی‌معنی می‌شود،
//      چون خروجی را با نامی مقایسه می‌کند که مدل هرگز نمی‌نویسد.
// هیچ‌کدام سر و صدا نمی‌کنند، پس فقط یک چک می‌تواند بگیردشان.
//
// این چک درباره‌ی **کیفیتِ ترجمه** ادعایی ندارد؛ فقط پوشش و تک‌زبانه بودن را قفل می‌کند.
import { readFileSync, readdirSync, existsSync } from 'fs';
import CARDS from '../bots/tarot/cards.js';
import { SPREAD_BY_ID, DAILY } from '../bots/tarot/spreads.js';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const DIR = new URL('../bots/tarot/', import.meta.url);
const FILES = readdirSync(DIR).filter(f => /^langdata\.[a-z-]+\.json$/.test(f)).sort();
if (!FILES.length) {
  console.log('⏭ هیچ فایلِ زبانی نیست (فقط فارسی) — fail-safe است، رد می‌شویم.');
  process.exit(0);
}

/* مجموعه‌ی کاملِ رشته‌های فارسیِ canonical که **باید** ترجمه داشته باشند.
 * از خودِ ماژول‌ها استخراج می‌شود نه از یک لیستِ دستی، وگرنه افزودنِ یک چیدمانِ تازه
 * بی‌صدا از پوشش جا می‌ماند — دقیقاً همان چیزی که این چک برای گرفتنش هست. */
const spreadNames = new Set();
const positionNames = new Set();
for (const sp of Object.values(SPREAD_BY_ID)) {
  for (const f of ['fa', 'faV2', 'faV3']) if (sp[f]) spreadNames.add(sp[f]);
  for (const p of (sp.positions || [])) if (p.fa) positionNames.add(p.fa);
  // ⚠️ برچسبِ تقابلی هم جایگاه نیست هم چیدمان، ولی `verdict.js` عیناً به‌عنوانِ
  // **جوابِ نهایی** چاپش می‌کند. بدونِ ترجمه کاربر «Ответ: موندن» می‌گیرد.
  for (const l of (sp.choiceLabels || [])) positionNames.add(l);
}
if (DAILY?.fa) spreadNames.add(DAILY.fa);

const ALIEN = [
  [/[؀-ۿ]/, 'نویسه‌ی فارسی/عربی'],
  [/[　-鿿＀-￯]/, 'نویسه‌ی CJK'],
];

for (const file of FILES) {
  const lang = file.replace(/^langdata\.|\.json$/g, '');
  console.log(`\n${'━'.repeat(60)}\n🌍 زبان: ${lang}  (${file})\n${'━'.repeat(60)}`);
  const d = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));

  console.log('\n▶ پوششِ کامل');
  {
    const missCards = CARDS.filter(c => !d.cardNames?.[c.key]).map(c => c.key);
    ok(missCards.length === 0, `هر ۷۸ کارت نام دارد${missCards.length ? ` (جامانده: ${missCards.slice(0, 8).join(',')})` : ''}`);
    const missKw = CARDS.filter(c => !d.cardKeywords?.[c.key]?.up?.length || !d.cardKeywords?.[c.key]?.down?.length).map(c => c.key);
    ok(missKw.length === 0, `هر ۷۸ کارت کلیدواژه‌ی مستقیم و معکوس دارد${missKw.length ? ` (جامانده: ${missKw.slice(0, 8).join(',')})` : ''}`);
    // تعدادِ کلیدواژه‌ها باید با فارسی بخواند: کم‌شدنشان یعنی معنیِ کارت لاغرتر رفته
    const wrong = CARDS.filter(c => {
      const k = d.cardKeywords?.[c.key]; if (!k) return false;
      return k.up.length !== c.up.length || k.down.length !== c.down.length;
    }).map(c => c.key);
    ok(wrong.length === 0, `تعدادِ کلیدواژه‌ها با فارسی یکی است${wrong.length ? ` (ناهم‌خوان: ${wrong.slice(0, 8).join(',')})` : ''}`);
    const missS = [...spreadNames].filter(n => !d.spreadNames?.[n]);
    ok(missS.length === 0, `هر ${spreadNames.size} نامِ چیدمان ترجمه دارد${missS.length ? ` (جامانده: ${missS.slice(0, 4).join(' | ')})` : ''}`);
    const missP = [...positionNames].filter(n => !d.positionNames?.[n]);
    ok(missP.length === 0, `هر ${positionNames.size} نامِ جایگاه و برچسبِ تقابلی ترجمه دارد${missP.length ? ` (جامانده: ${missP.slice(0, 4).join(' | ')})` : ''}`);
    ok(typeof d.positionFallback === 'string' && d.positionFallback.includes('%n'),
      'برچسبِ کارتِ بی‌جایگاه قالبِ %n دارد');
    ok(!!d.repair?.system && !!d.repair?.hints?.evasion && !!d.repair?.hints?.pastTime && String(d.repair?.item || '').includes('%text'),
      'پرامپتِ تعمیر کامل است (system + دو hint + قالبِ item)');
  }

  console.log('\n▶ تک‌زبانه بودن (مقدارها، نه کلیدها)');
  {
    // ⚠️ فقط **مقدارها** سنجیده می‌شوند: کلیدها عمداً رشته‌ی فارسیِ canonical اند.
    const vals = [];
    const walk = (o) => {
      if (typeof o === 'string') { vals.push(o); return; }
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === 'object') { Object.values(o).forEach(walk); }
    };
    for (const [k, v] of Object.entries(d)) if (k !== '_note') walk(v);
    for (const [re, label] of ALIEN) {
      const hits = vals.filter(v => re.test(v));
      ok(hits.length === 0, `هیچ ${label}ی در مقدارها نیست${hits.length ? ` (${hits.slice(0, 3).join(' | ')})` : ''}`);
    }
    // بند ۱۰ ریشه: «—» امضای متنِ ماشینی است. در روسی این را خودِ خواننده تشخیص می‌دهد.
    const dash = vals.filter(v => /[—–]|--/.test(v));
    ok(dash.length === 0, `هیچ خط تیره‌ی بلندی نیست${dash.length ? ` (${dash.slice(0, 3).join(' | ')})` : ''}`);
    const dup = Object.values(d.cardNames || {});
    ok(new Set(dup).size === dup.length, `نامِ هر ۷۸ کارت یکتاست${new Set(dup).size !== dup.length ? ' (نامِ تکراری یعنی مدل دو کارت را یکی می‌بیند)' : ''}`);
  }

  console.log('\n▶ هم‌خوانی با جدولِ دانش');
  {
    // دو فایلِ per زبان هر دو نامِ کارت دارند. واگراییشان یعنی مدل در یک جای پرامپت
    // یک نام می‌بیند و در جای دیگر نامِ دیگری — همان کارت، دو هویت.
    const kbFile = new URL(`card-knowledge.${lang}.json`, DIR);
    if (!existsSync(kbFile)) { console.log('  ⏭ جدولِ دانشِ این زبان هنوز نیست'); }
    else {
      const kb = JSON.parse(readFileSync(kbFile, 'utf8'));
      const diff = Object.keys(kb).filter(k => kb[k].name && d.cardNames?.[k] && kb[k].name !== d.cardNames[k]);
      ok(diff.length === 0, `نامِ کارت در هر دو فایل یکی است${diff.length ? ` (ناهم‌خوان: ${diff.slice(0, 5).join(',')})` : ''}`);
    }
  }
}

console.log('\n▶ سیم‌کشیِ runtime');
{
  const SRC = readFileSync(new URL('reading-core.js', DIR), 'utf8');
  ok(/langdata\.\$\{LOCALE\}\.json/.test(SRC), 'فایلِ زبان per locale بار می‌شود');
  ok(/catch\(\(\) => \(\{\}\)\)/.test(SRC), 'نبودنِ فایل چیزی را نمی‌شکند (fail-safe برای فارسی)');
  ok(/configureCardData\(LANG_DATA\)/.test(SRC), 'خودِ ماژول پیکربندی می‌شود، پس مصرف‌کننده نمی‌تواند جا بیندازد');
  const BOT = readFileSync(new URL('index.js', DIR), 'utf8');
  // ⚠️ اگر این دو جا برچسبِ خام را پاس بدهند، جوابِ قاطع به فارسی چاپ می‌شود
  ok(!/choiceLabels: spread\?\.choiceLabels/.test(BOT), 'برچسبِ تقابلی از مسیرِ ترجمه می‌رود، نه خام');
  ok((BOT.match(/choiceLabelsFor\(spread\)/g) || []).length === 2, 'هر دو نقطه‌ی verdict برچسبِ ترجمه‌شده می‌گیرند');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ دادهٔ زبانی: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
