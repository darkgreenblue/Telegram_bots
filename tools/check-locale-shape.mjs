#!/usr/bin/env node
// چکِ CI شکلِ locale — قراردادِ بند ۲و: «یک کدبیس، N ربات».
//
// ⚠️ چرا این چک لازم است: `locales/fa.js` حدودِ ۳۵۰ کلید دارد که ۱۲۴ تایشان **تابع**اند.
// یک کلیدِ جاافتاده در یک زبانِ تازه، `undefined` می‌شود و یک تابعِ جاافتاده در زمانِ
// اجرا `L.x.y is not a function` می‌دهد — هر دو روی یک **مسیرِ سرد** (پی‌وال، خطا،
// ادمین) ممکن است هفته‌ها ساکت بمانند تا کاربرِ واقعی به آن‌جا برسد. دقیقاً همان
// خانواده‌ی باگی که بند ۸ ریشه توصیفش می‌کند (`decideReceipt`).
//
// این چک هیچ ادعایی درباره‌ی **کیفیتِ ترجمه** ندارد؛ فقط شکل را قفل می‌کند.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SPREAD_BY_ID, DAILY } from '../bots/tarot/spreads.js';

const DIR = 'bots/tarot/locales';
const REF = 'fa';

// درختِ «مسیر → نوع». آرایه یک برگ است (ترتیبش معنا دارد، محتوایش ترجمه‌شدنی است).
function shape(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...shape(v, p));
    else out.push([p, Array.isArray(v) ? 'array' : typeof v]);
  }
  return out;
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
const ref = (await import(`../${DIR}/${REF}.js`)).default;
const refShape = new Map(shape(ref));
console.log(`locale مرجع «${REF}»: ${refShape.size} کلید\n`);

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ❌ ${msg}`); };

for (const file of files) {
  const code = path.basename(file, '.js');
  if (code === REF) continue;
  console.log(`locale «${code}»:`);
  const mod = (await import(`../${DIR}/${file}`)).default;
  const got = new Map(shape(mod));

  for (const [key, type] of refShape) {
    if (!got.has(key)) { fail(`کلیدِ جاافتاده: ${key}`); continue; }
    if (got.get(key) !== type) fail(`نوعِ متفاوت در ${key}: مرجع ${type} است ولی این‌جا ${got.get(key)}`);
  }
  for (const key of got.keys()) if (!refShape.has(key)) fail(`کلیدِ اضافه که در مرجع نیست: ${key}`);

  // `code` باید با نامِ فایل بخواند، وگرنه تحلیل و لاگ به زبانِ اشتباه نسبت داده می‌شود
  if (mod.code !== code) fail(`code باید «${code}» باشد ولی «${mod.code}» است`);

  /* قانونِ کپیِ بند ۱۰: خط‌تیره‌ی بلند امضای متنِ ماشینی است.
   *
   * ⚠️ دامنه عمداً باریک است و بخشِ `prompts` را **کنار می‌گذارد**. آن بخش دستورالعملِ
   * مدل است نه متنِ رو-به-کاربر، و اتفاقاً خودش همان کاراکترها را نقل می‌کند تا مدل را
   * از استفاده‌شان منع کند. اگر این استثنا نبود، چک روی خودِ locale فارسی قرمز می‌شد.
   * روی مقدارهای **بارگذاری‌شده** کار می‌کند نه متنِ خام، پس کامنت‌های کد هم طبیعتاً
   * بیرون می‌مانند و لازم نیست با regex از کامنت‌ها فرار کنیم. */
  const userFacing = Object.entries(mod).filter(([k]) => k !== 'prompts');
  const texts = [];
  const collect = (v) => {
    if (typeof v === 'string') texts.push(v);
    else if (typeof v === 'function') { try { texts.push(v.toString()); } catch {} }
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  userFacing.forEach(([, v]) => collect(v));
  for (const bad of ['—', '--']) {
    const hit = texts.find(t => t.includes(bad));
    if (hit) fail(`«${bad}» در متنِ رو-به-کاربر پیدا شد (بند ۱۰ ریشه): ${hit.slice(0, 60)}`);
  }

  /* 🚨 هر تابعِ locale واقعاً **اجرا** می‌شود.
   *
   * 🐛 باگی که این را لازم کرد (پیدا شده حینِ ساختِ پرتغالی، روی locale روسی): سه ثابتِ
   * `INTRO_EXPERIENCE`، `INTRO_EXPERIENCE_V2` و `INTRO_STAT` در پورتِ روسی جا افتاده
   * بودند ولی هر دو مصرف‌کننده‌شان زنده مانده بود. یعنی `gateIntro` و `welcome` در
   * زمانِ اجرا `ReferenceError` می‌دادند — **اولین پیامی که هر کاربرِ روسِ تازه می‌بیند**
   * و پیامِ بلافاصله بعد از گرفتنِ نامش. این چک تا امروز فقط `toString()` می‌گرفت، پس
   * متنِ تابع را می‌دید ولی هرگز صدایش نمی‌زد و باگ کاملاً نامرئی بود.
   * دقیقاً همان کلاسِ باگِ `decideReceipt` (بند ۸ ریشه)، این‌بار در لایه‌ی locale.
   *
   * ⚠️ فقط `ReferenceError` خطا حساب می‌شود، نه هر استثنایی: شناسه‌ی تعریف‌نشده مستقل
   * از آرگومان‌ها می‌ترکد، ولی `TypeError` معمولاً یعنی آرگومانِ ساختگیِ ما شکلِ درستی
   * نداشته که ایرادِ خودِ locale نیست. این تفکیک عمدی است تا چک نویزِ کاذب ندهد.
   *
   * 🐛 **دورِ دومِ همین باگ، و دو نقطه‌کورِ خودِ این چک** (۱۴۰۵/۰۶/۰۹، باز هم حینِ
   * ساختِ پرتغالی): `decisiveBlock` و `decisiveField` هم در پورتِ روسی جا افتاده بودند
   * و `readerSystem`/`readerSystemV2` هر دو صدایشان می‌زدند. این چک با اینکه توابع را
   * واقعاً اجرا می‌کرد، ندیدشان. دو دلیلِ مستقل داشت و هر دو اصلاح شد:
   *   ۱) **خطا پشتِ خطا پنهان می‌شد.** در همان template literal، `spread.positions.map(...)`
   *      قبل از `decisiveBlock(...)` ارزیابی می‌شود و با آرگومانِ ساختگی `TypeError`
   *      می‌داد، که عمداً نادیده گرفته می‌شود؛ پس اجرا هرگز به شناسه‌ی تعریف‌نشده
   *      نمی‌رسید. درمان: آرگومانِ **واقعی** از خودِ `spreads.js` (نه ساختگی)، که هر
   *      سه حالتِ `decisive` را هم پوشش می‌دهد. از منبع استخراج می‌شود نه لیستِ دستی،
   *      پس چیدمانِ تازه خودبه‌خود پوشش می‌گیرد.
   *   ۲) **حلقه سرِ اولین موفقیت می‌شکست.** اگر یک آرگومانِ ساده تابع را بی‌خطا رد
   *      می‌کرد، بقیه‌ی آرگومان‌ها امتحان نمی‌شدند و شاخه‌ی عمیق‌تر هرگز اجرا نمی‌شد.
   *      حالا **همه‌ی** آرگومان‌ها امتحان می‌شوند و هر `ReferenceError`ی گزارش می‌شود.
   *      این ایمن است چون شناسه‌ی تعریف‌نشده به مقدارِ آرگومان ربطی ندارد: اگر با یک
   *      آرگومان `ReferenceError` بدهد، آن شناسه واقعاً در scope نیست. */
  {
    /* چیدمان‌های واقعی از `spreads.js`، یکی per حالتِ `decisive` (+ یکی بدونِ آن).
     * بدونِ این، شاخه‌های تصمیم‌محورِ پرامپت اصلاً اجرا نمی‌شوند. */
    const real = Object.values(SPREAD_BY_ID);
    const byMode = new Map();
    for (const sp of real) if (!byMode.has(sp.decisive || '')) byMode.set(sp.decisive || '', sp);
    const SPREADS = [...byMode.values(), ...(DAILY ? [DAILY] : [])];

    const ARGS = [
      [], ['x'], ['x', 1], ['x', true], ['x', 1, true], ['x', 'y', 'z'],
      [1], [1, 2], [true], [[]], [{}], [{ on: true, name: 'x', emoji: '💎' }],
      // آرگومان‌های دامنه‌ای: چیدمانِ واقعی در جایگاهِ اول، با دنباله‌های محتمل.
      ...SPREADS.flatMap((sp) => [
        [sp], [sp, 'x'], [sp, {}], [sp, 'x', 'y'], [sp, [], 'x'], [sp, 'x', {}, 'y'],
      ]),
    ];
    const broken = [];
    const walk = (v, pathStr) => {
      if (typeof v === 'function') {
        let refErr = null;
        // ⚠️ عمداً `break` ندارد: موفق شدن با یک آرگومان ثابت نمی‌کند شاخه‌های دیگر سالم‌اند.
        for (const a of ARGS) {
          try { v(...a); }
          catch (e) { if (e instanceof ReferenceError && !refErr) refErr = e; }
        }
        if (refErr) broken.push(`${pathStr}: ${refErr.message}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${pathStr}[${i}]`));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${pathStr}.${k}`));
    };
    Object.entries(mod).forEach(([k, v]) => walk(v, k));

    /* گامِ دوم: «نترکید» کافی نیست. تابعی که به‌جای متن `undefined` یا رشته‌ی خالی
     * برگرداند هم پیامِ خالی به کاربر می‌دهد و هیچ خطایی نمی‌سازد. سنجه **مقایسه‌ای**
     * است تا نویزِ کاذب ندهد: با **همان آرگومان‌هایی** که مرجعِ فارسی متنِ ناخالی
     * می‌دهد، این زبان هم باید متنِ ناخالی بدهد. */
    const empty = [];
    const pick = (fn) => {
      for (const a of ARGS) {
        try { const r = fn(...a); if (typeof r === 'string' && r.trim()) return a; } catch {}
      }
      return null;
    };
    const walk2 = (refV, v, pathStr) => {
      if (typeof refV === 'function' && typeof v === 'function') {
        const a = pick(refV);
        if (!a) return;                       // مرجع با این آرگومان‌ها متن نمی‌دهد: قضاوت نکن
        let r; try { r = v(...a); } catch { return; }   // ترکیدن را گامِ اول گزارش کرده
        if (typeof r !== 'string' || !r.trim()) empty.push(pathStr);
      } else if (refV && typeof refV === 'object' && v && typeof v === 'object' && !Array.isArray(refV)) {
        Object.entries(refV).forEach(([k, rv]) => walk2(rv, v[k], `${pathStr}.${k}`));
      }
    };
    if (mod !== ref) Object.entries(ref).forEach(([k, rv]) => walk2(rv, mod[k], k));
    if (empty.length) {
      failures++;
      console.log(`  ❌ ${empty.length} تابع با همان آرگومانِ مرجع، متنِ خالی می‌دهد:`);
      empty.slice(0, 8).forEach(b => console.log(`     - ${b}`));
    }

    if (broken.length) {
      failures++;
      console.log(`  ❌ ${broken.length} تابع در زمانِ اجرا ReferenceError می‌دهد (شناسه‌ی تعریف‌نشده):`);
      broken.slice(0, 8).forEach(b => console.log(`     - ${b}`));
    } else {
      console.log('  ✓ همه‌ی توابع اجرا می‌شوند (هیچ شناسه‌ی تعریف‌نشده‌ای نمانده)');
    }
  }

  if (!failures) console.log('  ✓ شکل، نوع‌ها، code و قواعدِ کپی سالم‌اند');
}

if (files.length === 1) console.log('(فعلاً فقط locale مرجع هست؛ چک وقتی زبانِ دوم بیاید معنا پیدا می‌کند)');
assert.equal(failures, 0, `${failures} خطای شکلِ locale`);
console.log(`\n✅ شکلِ locale: ${files.length} فایل سالم`);
