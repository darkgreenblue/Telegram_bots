#!/usr/bin/env node
// گاردِ جدولِ دانشِ کارت (bots/tarot/card-knowledge.fa.json).
//
// سه خطرِ واقعی که این چک جلویشان را می‌گیرد:
//   ۱) **نشتِ انگلیسی به خروجیِ فارسی.** این متن مستقیم وارد پرامپت می‌شود؛ اگر انگلیسی
//      باشد، مدل زیر فشار به زبانِ کانتکست می‌لغزد و کاربرِ فارسی جوابِ انگلیسی می‌گیرد.
//   ۲) **تورمِ پرامپت.** هر فال سه ردیف از این جدول را اضافه می‌کند، پس یک ردیفِ چاق در
//      **هر فال** هزینه دارد و کیفیتِ Flash را پایین می‌آورد.
//   ۳) **کارتِ جاافتاده.** کارتی که ردیف نداشته باشد بی‌صدا بی‌دانش می‌ماند.
//
// اگر فایل هنوز ساخته نشده باشد چک **سبز** رد می‌شود (فیچر fail-safe است و نبودنِ فایل
// یعنی رفتارِ دقیقاً قبلی)، ولی فایلِ نصفه‌کاره قرمز می‌شود.
import { readFileSync, existsSync, readdirSync } from 'fs';
import CARDS from '../bots/tarot/cards.js';

const P = new URL('../bots/tarot/card-knowledge.fa.json', import.meta.url);
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

if (!existsSync(P)) {
  console.log('⏭ card-knowledge.fa.json هنوز ساخته نشده — فیچر fail-safe است، رد می‌شویم.');
  process.exit(0);
}

const kb = JSON.parse(readFileSync(P, 'utf8'));
const keys = Object.keys(kb);
const LIMITS = { image: 160, up: 120, down: 120, love: 100, work: 100 };

console.log('▶ پوششِ کارت‌ها');
{
  const missing = CARDS.filter(c => !kb[c.key]).map(c => c.key);
  ok(missing.length === 0, `هر ۷۸ کارت ردیف دارد (${keys.length} ردیف${missing.length ? `، جامانده: ${missing.slice(0, 8).join(',')}` : ''})`);
  const extra = keys.filter(k => !CARDS.some(c => c.key === k));
  ok(extra.length === 0, `هیچ ردیفِ اضافه‌ای نیست${extra.length ? ` (${extra.join(',')})` : ''}`);
}

console.log('\n▶ کامل بودنِ هر ردیف');
{
  const bad = keys.filter(k => !kb[k].image || !kb[k].up || !kb[k].down);
  ok(bad.length === 0, `هر ردیف تصویر و معنیِ مستقیم و معکوس دارد${bad.length ? ` (ناقص: ${bad.slice(0, 8).join(',')})` : ''}`);
}

console.log('\n▶ فارسیِ خالص (هیچ انگلیسی‌ای وارد پرامپت نمی‌شود)');
{
  const latin = [];
  for (const [k, v] of Object.entries(kb)) {
    for (const [f, val] of Object.entries(v)) {
      if (typeof val === 'string' && /[A-Za-z]{3,}/.test(val)) latin.push(`${k}.${f}`);
    }
  }
  ok(latin.length === 0, `هیچ کلمه‌ی لاتینی در متن‌ها نیست${latin.length ? ` (${latin.slice(0, 6).join(', ')})` : ''}`);
  // قاعده‌ی سراسریِ بند ۱۰ ریشه
  const dash = keys.filter(k => /[—–]|--/.test(JSON.stringify(kb[k])));
  ok(dash.length === 0, `هیچ خط تیره‌ی بلندی نیست${dash.length ? ` (${dash.slice(0, 6).join(',')})` : ''}`);
}

console.log('\n▶ سقفِ اندازه (ضدِ تورمِ پرامپت)');
{
  const over = [];
  for (const [k, v] of Object.entries(kb)) {
    for (const [f, max] of Object.entries(LIMITS)) {
      if (typeof v[f] === 'string' && v[f].length > max) over.push(`${k}.${f}=${v[f].length}>${max}`);
    }
  }
  ok(over.length === 0, `هیچ فیلدی از سقفش رد نشده${over.length ? ` (${over.slice(0, 5).join(', ')})` : ''}`);
  const sizes = keys.map(k => JSON.stringify(kb[k]).length);
  const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / Math.max(sizes.length, 1));
  const max = Math.max(...sizes, 0);
  // سه کارت per فال؛ با میانگینِ ۵۰۰ کاراکتر یعنی ~۱۵۰۰ کاراکتر ≈ ۷۰۰ توکن اضافه (زیر ۵٪ هزینه)
  ok(avg <= 600, `میانگینِ هر ردیف ${avg} کاراکتر (سقف ۶۰۰ → حدود ${Math.round(avg * 3 / 2.2)} توکن per فالِ سه‌کارتی)`);
  ok(max <= 800, `چاق‌ترین ردیف ${max} کاراکتر (سقف ۸۰۰)`);
}

console.log('\n▶ ترجمه دستی است، نه ماشینی');
{
  // قاعده‌ی صریحِ مالک (۱۴۰۵/۰۵/۲۴): کلیدِ OpenRouter **فقط** برای خودِ محصول است و
  // کارِ توسعه با آن انجام نمی‌شود. این ادعا جلوی برگشتنِ آن الگو را می‌گیرد.
  const files = readdirSync(new URL('../tools/', import.meta.url));
  const bad = files.filter(f => /card-knowledge/.test(f) && /build|generate/.test(f));
  ok(bad.length === 0, `هیچ اسکریپتِ تولیدِ خودکارِ جدولِ دانش وجود ندارد${bad.length ? ` (${bad.join(',')})` : ''}`);
  const wf = readdirSync(new URL('../.github/workflows/', import.meta.url));
  ok(!wf.includes('card-knowledge.yml'), 'هیچ workflowی جدولِ دانش را با LLM نمی‌سازد');
}

console.log('\n▶ سیم‌کشیِ runtime');
{
  // از v3.6.0 تزریقِ دانش در هسته‌ی خالصِ خوانش است (تا آزمایشگاهِ آفلاین هم همان را ببیند)
  const SRC = readFileSync(new URL('../bots/tarot/reading-core.js', import.meta.url), 'utf8');
  const LOC = readFileSync(new URL('../bots/tarot/locales/fa.js', import.meta.url), 'utf8');
  ok(/CARD_KB\[c\.key\]/.test(SRC), 'فقط ردیفِ کارتِ کشیده‌شده خوانده می‌شود (نه کلِ جدول)');
  ok(/kbOn && CARD_KB/.test(SRC), 'دانش فقط در لحنِ جدید تزریق می‌شود');
  const BOT = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
  ok(/kbOn: toneV2For\(user\.telegram_id\)/.test(BOT), 'پرچمِ لحن از خودِ ربات می‌آید، نه از هسته');
  ok(/catch\(\(\) => \(\{\}\)\)/.test(SRC), 'نبودنِ فایل خوانش را نمی‌شکند (fail-safe)');
  ok(/تصویرِ روی کارت/.test(LOC), 'تصویرِ کارت به کانتکست می‌رود (ماده‌ی خامِ دلیل‌آوریِ لنگرخورده)');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
