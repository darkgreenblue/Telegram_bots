#!/usr/bin/env node
// گاردِ «دیتای per زبان واقعاً per زبان import شود» — قراردادِ بند ۲و/۳ ریشه.
//
// 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۰۹ که این چک از دلش درآمد:
//   `bots/tarot/CLAUDE.md` در جدولِ **استثناهای زبانی** ردیف داشت که «فالِ حافظ فقط `fa`
//   است»، و کامنتِ بالای import هم ادعا می‌کرد «زبان‌های دیگر بدون فایل = فیچر خودکار
//   غیرفعال». ولی خطِ کد این بود:
//       const HAFEZ = await import(`./hafez.js`)...
//   هیچ `${LOCALE}`ی در مسیر نبود، پس **هر** زبانی همان غزل‌های فارسی را می‌گرفت. یعنی
//   استثنایی که مستند شده بود اصلاً پیاده نشده بود. همین برای `quiz.js` هم صادق بود.
//   چون `FREE_MENU_ENABLED` خاموش بود هیچ کاربری ندیدش: یک **تله‌ی خفته** که روزِ روشن
//   شدنِ آن فلگ، به رباتِ روسی شعرِ فارسی سرو می‌کرد.
//
// درسِ کلاس: «مستند شده» با «پیاده شده» یکی نیست. جدولِ استثناها فقط وقتی ارزش دارد که
// یک چک ردیف‌هایش را با کدِ واقعی بسنجد. این چک همان کار را می‌کند و هر دو جهت را می‌بیند:
//   ← هر فایلِ دیتای زبان‌دار (`<name>.<locale>.<ext>`) باید با `${LOCALE}` import شود.
//   → هر importِ زبان‌دار باید fallbackِ بی‌صدا داشته باشد، وگرنه زبانِ بدونِ فایل می‌ترکد.
import { readFileSync, readdirSync } from 'fs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const DIR = new URL('../bots/tarot/', import.meta.url);
const SRC = readFileSync(new URL('index.js', DIR), 'utf8');
const files = readdirSync(DIR);

/* فایل‌های دیتای زبان‌دار را از **خودِ دیسک** کشف می‌کنیم، نه از یک لیستِ دستی.
 * الگو: `<name>.<locale>.<js|json>` که `<locale>` یک کدِ زبانِ دو-سه حرفی است.
 * `card-knowledge` و `langdata` و `daily-ganjineh` چکِ اختصاصیِ خودشان را دارند؛
 * اینجا فقط **سیم‌کشیِ import** سنجیده می‌شود، نه محتوا. */
const LOCALE_RE = /^([a-zA-Z][\w-]*)\.([a-z]{2}(?:-[a-z]{2})?)\.(js|json)$/;
const bases = new Map(); // base -> Set(locales)
for (const f of files) {
  const m = LOCALE_RE.exec(f);
  if (!m) continue;
  if (!bases.has(m[1])) bases.set(m[1], new Set());
  bases.get(m[1]).add(m[2]);
}

console.log('▶ کشفِ فایل‌های دیتای زبان‌دار');
ok(bases.size > 0, `دستِ‌کم یک خانواده‌ی فایلِ زبان‌دار پیدا شد (${[...bases.keys()].sort().join(', ')})`);

/* هر خانواده‌ای که `index.js` مستقیم import می‌کند باید `${LOCALE}` در مسیرش باشد.
 * فایلی که فقط از یک ماژولِ دیگر (مثل `ganjineh.js`) خوانده می‌شود اینجا شرطِ import
 * ندارد؛ آن ماژول خودش مسیر را می‌سازد و چکِ خودش را دارد. */
console.log('\n▶ هیچ دیتای زبان‌داری بی‌قید import نمی‌شود');
for (const base of [...bases.keys()].sort()) {
  // آیا index.js اصلاً این خانواده را import می‌کند؟
  const bad = new RegExp(String.raw`import\(\s*\x60\./${base}\.(js|json)\x60`);
  const good = new RegExp(String.raw`import\(\s*\x60\./${base}\.\$\{LOCALE\}\.(js|json)\x60`);
  const importsIt = bad.test(SRC) || good.test(SRC);
  if (!importsIt) continue;
  ok(!bad.test(SRC),
    `\`${base}\` با مسیرِ ثابت import نشده (وگرنه هر زبانی دیتای فارسی می‌گیرد)`);
  ok(good.test(SRC), `\`${base}\` با \`\${LOCALE}\` در مسیر import می‌شود`);
}

/* هر importِ داینامیکِ زبان‌دار باید fallbackِ بی‌صدا داشته باشد. بدونِ `.catch`،
 * زبانی که هنوز فایلش را ندارد سرِ بوت می‌ترکد و کلِ ربات بالا نمی‌آید. */
console.log('\n▶ نبودنِ فایل ربات را نمی‌شکند (fail-safe)');
const dyn = [...SRC.matchAll(/await import\(\s*`\.\/([\w.-]*)\$\{LOCALE\}([\w.-]*)`\s*\)([\s\S]{0,160}?);/g)];
ok(dyn.length > 0, `دستِ‌کم یک importِ زبان‌دار در index.js هست (${dyn.length} تا)`);
for (const m of dyn) {
  const spec = `${m[1]}\${LOCALE}${m[2]}`;
  // `locales/${LOCALE}.js` عمداً fallback ندارد: زبانی بدونِ فایلِ متن اصلاً نباید
  // بالا بیاید (کاربر به‌جای فال، رشته‌ی خالی می‌گیرد). بقیه باید graceful باشند.
  if (spec.startsWith('locales/')) {
    ok(!/\.catch\(/.test(m[3]),
      `\`${spec}\` عمداً fallback ندارد (زبانِ بی‌متن نباید بوت شود)`);
  } else {
    ok(/\.catch\(/.test(m[3]), `\`${spec}\` با نبودنِ فایل ساکت خاموش می‌شود`);
  }
}

/* جدولِ استثناهای زبانی باید هر خانواده‌ی **فقط-فارسی** را ردیف داشته باشد.
 * این همان درزی است که باگ از آن آمد: کد و مستند از هم جدا افتاده بودند. */
console.log('\n▶ جدولِ استثناهای زبانی با واقعیتِ دیسک می‌خواند');
const DOC = readFileSync(new URL('CLAUDE.md', DIR), 'utf8');
const table = DOC.split('### 📋 جدولِ استثناهای زبانی')[1]?.split('\n###')[0] || '';
ok(table.length > 0, 'جدولِ استثناهای زبانی در CLAUDE.md پیدا شد');
for (const [base, locs] of [...bases].sort()) {
  if (!(locs.size === 1 && locs.has('fa'))) continue;
  const bad = new RegExp(String.raw`import\(\s*\x60\./${base}\.(js|json)\x60`);
  const good = new RegExp(String.raw`import\(\s*\x60\./${base}\.\$\{LOCALE\}\.(js|json)\x60`);
  if (!bad.test(SRC) && !good.test(SRC)) continue; // فقط چیزی که ربات مستقیم می‌خواند
  ok(table.includes(base), `\`${base}\` فقط فارسی دارد و در جدولِ استثناها ردیف دارد`);
}

console.log(errs.length ? `\n❌ ${errs.length} خطا` : `\n✅ سیم‌کشیِ دیتای زبان‌دار: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
