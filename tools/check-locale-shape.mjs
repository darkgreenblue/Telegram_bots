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

  if (!failures) console.log('  ✓ شکل، نوع‌ها، code و قواعدِ کپی سالم‌اند');
}

if (files.length === 1) console.log('(فعلاً فقط locale مرجع هست؛ چک وقتی زبانِ دوم بیاید معنا پیدا می‌کند)');
assert.equal(failures, 0, `${failures} خطای شکلِ locale`);
console.log(`\n✅ شکلِ locale: ${files.length} فایل سالم`);
