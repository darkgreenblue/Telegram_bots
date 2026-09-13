#!/usr/bin/env node
// مقایسه‌ی **جفت‌شده‌ی** دو دورِ آزمایشگاهِ گفتگو — شرطِ پذیرشِ هر گاردِ تازه.
//
//   node tools/chat-lab.mjs --out before.json          # قبل از تغییر
//   …تغییر را اعمال کن…
//   node tools/chat-lab.mjs --out after.json           # بعد از تغییر
//   node tools/chat-regress.mjs before.json after.json
//
// ⚠️ چرا این ابزار وجود دارد (تصمیمِ صریحِ مالک، ۱۴۰۵/۰۶/۲۲):
//   «استفاده‌ی خصمانه شاید ۱ در ۱۰۰۰ نباشه و سیستم باید برای نرمِ آدم‌ها بهترین جواب
//    رو بده و این مهم‌تره. هر تغییری می‌دی برای اینکه سیستم در استفاده‌های خصمانه هم
//    دچار مشکل نشه، باید چک کنی که اون تغییر کیفیت خروجی‌ها در استفاده‌های معمولی رو
//    به هیچ وجه کم نکرده باشه.»
// پس هر گاردِ ضدِ فابریکیشن/بحران/استخراج باید ثابت کند مسیرِ نرمال را خراب نکرده.
// این ابزار آن اثبات را **عدد** می‌کند، نه حس.
//
// ⚠️ و عمداً **جفت‌شده** است، نه مقایسه‌ی دو میانگین. درسِ ثبت‌شده‌ی همین ریپو: نویزِ یک
// دورِ کوچک ±۶ واحد است و دو اجرای مستقل با هم قابلِ مقایسه نیستند؛ فقط نوبتِ نظیربه‌نظیر
// (همان پرسونا، همان بازو، همان تکرار، همان شماره‌ی نوبت) معنی می‌دهد.
import fs from 'node:fs';

const [A, B, ...rest] = process.argv.slice(2);
const STRICT = rest.includes('--strict');
if (!A || !B) {
  console.error('استفاده: node tools/chat-regress.mjs <before.json> <after.json> [--strict]');
  process.exit(1);
}

const load = (p) => {
  if (!fs.existsSync(p)) { console.error(`❌ فایل نیست: ${p}`); process.exit(1); }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`❌ JSONِ خراب در ${p}: ${e.message}`); process.exit(1); }
};

/* کلیدِ جفت‌شدن. `arm` و `rep` حتماً داخلش‌اند: بدونشان دو بازوی متفاوت در یک سطل
 * می‌ریزند و تفکیکی که کلِ تصمیم روی آن است بی‌صدا گم می‌شود. */
const keyOf = (c, i) => `${c.persona}|${c.step}|${c.arm}|${c.rep}|${i}`;

function index(rows) {
  const m = new Map();
  for (const c of rows) (c.turns || []).forEach((t, i) => m.set(keyOf(c, i), t));
  return m;
}

/* سنجه‌ها. هر کدام یک تابعِ **بولی** روی `turn.check` است، پس «بدتر شدن» یعنی تعدادِ
 * true بیشتر شده. نوبتِ رد‌شده (بحران/تعارف) و نوبتِ شکست‌خورده شمرده نمی‌شوند: آن‌ها
 * اصلاً جوابِ مدل ندارند و واردکردنشان مخرج را دروغ می‌کند. */
const METRICS = [
  ['قلابِ خطِ آخر',        (c) => c.hook && !c.hook.ok && !c.hookExempt],
  ['قلابِ توخالی',         (c) => (c.chatbait || 0) > 0],
  ['لحنِ رسمی («شما»)',    (c) => (c.formal?.length || 0) > 0],
  ['لحنِ کتابی',           (c) => (c.bookish?.length || 0) >= 3],
  ['اکوی برچسبِ قلاب',     (c) => !!c.labelEcho],
  ['خطِ اول جواب نیست',    (c) => c.firstLine && !c.firstLine.ok],
  ['خط تیره',              (c) => (c.dashes || 0) > 0],
  ['بیش از یک علامتِ سؤال', (c) => (c.qmarks || 0) > 1],
  ['بیرونِ هدفِ ۲ تا ۶ خط', (c) => c.lines < 2 || c.lines > 6],
  // سنجه‌های تازه‌ی ۱۴۰۵/۰۶/۲۲
  ['شکلِ فهرست (فالِ جعلی)', (c) => (c.listMarks || 0) >= 3],
  ['نقشِ اورژانس',          (c) => !!c.emergency],
  ['نشتِ دستورها',          (c) => !!c.promptLeak],
  ['چپاندنِ کارت',          (c) => !!c.cardForce],
];

const before = index(load(A));
const after = index(load(B));

// فقط نوبت‌هایی که در **هر دو** فایل هستند. اختلافِ مجموعه یعنی دو دور قابلِ
// مقایسه نیستند و باید بلند گفته شود، نه اینکه بی‌صدا روی اشتراک حساب شود.
const shared = [...before.keys()].filter((k) => after.has(k));
const onlyA = before.size - shared.length;
const onlyB = after.size - shared.length;

const scored = shared.filter((k) => {
  const x = before.get(k), y = after.get(k);
  return x?.check && y?.check && !x.skipped && !y.skipped && !x.failed && !y.failed;
});

console.log(`\n📊 مقایسه‌ی جفت‌شده: ${A} ⟵⟶ ${B}`);
console.log(`   نوبتِ مشترک: ${shared.length} | قابلِ امتیازدهی: ${scored.length}`);
if (onlyA || onlyB) {
  console.log(`   ⚠️ ${onlyA} نوبت فقط در اولی و ${onlyB} نوبت فقط در دومی — سناریوها یکی نیستند.`);
}
if (!scored.length) { console.error('❌ هیچ نوبتِ قابلِ مقایسه‌ای نیست.'); process.exit(1); }

const pct = (n) => `${((n / scored.length) * 100).toFixed(1).padStart(5)}٪`;
const rows = [];
let worse = 0, better = 0;

for (const [label, fn] of METRICS) {
  let a = 0, b = 0;
  for (const k of scored) {
    if (fn(before.get(k).check)) a++;
    if (fn(after.get(k).check)) b++;
  }
  const d = b - a;
  if (d > 0) worse++; else if (d < 0) better++;
  rows.push([label, a, b, d]);
}

const w = Math.max(...rows.map(([l]) => l.length));
console.log(`\n   ${'سنجه'.padEnd(w)}  قبل         بعد          تغییر`);
console.log(`   ${'─'.repeat(w + 34)}`);
for (const [label, a, b, d] of rows) {
  const mark = d > 0 ? '❌' : d < 0 ? '✅' : '  ';
  const dt = d === 0 ? '   —' : `${d > 0 ? '+' : ''}${d}`;
  console.log(`   ${label.padEnd(w)}  ${String(a).padStart(3)} ${pct(a)}  ${String(b).padStart(3)} ${pct(b)}  ${mark} ${dt}`);
}

/* ⚠️ «هیچ سنجه‌ای بدتر نشد» با «تغییر بی‌ضرر بود» یکی نیست. با این حجمِ نمونه فقط
 * حرکتِ **هم‌جهت و تکرارشده** قابلِ استناد است؛ یک واحد جابه‌جایی نویز است. این
 * جدول جای قضاوت را نمی‌گیرد، فقط جلوی افتِ **ندیده** را می‌گیرد. */
console.log('');
if (worse) {
  console.log(`❌ ${worse} سنجه بدتر شد. طبقِ شرطِ پذیرش، گاردی که مسیرِ نرمال را خراب کند نمی‌رود.`);
  console.log('   قبل از هر توجیهی، متنِ خامِ همان نوبت‌ها را بخوان — شاید ابزار مقصر باشد نه تغییر (بند ۹/۰ب).');
} else {
  console.log(`✅ هیچ سنجه‌ای بدتر نشد${better ? ` (${better} سنجه بهتر شد)` : ''}.`);
}
if (STRICT && worse) process.exit(1);
