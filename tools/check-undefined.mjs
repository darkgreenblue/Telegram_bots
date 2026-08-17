#!/usr/bin/env node
// چکِ «تابعِ صدا زده‌شده ولی تعریف/import نشده».
//
// چرا وجود دارد: در ۱۴۰۵/۰۵/۰۱ (۲۳ تیر) روی ربات زنده‌ی tarot خطِ
// `decideReceipt(verdict, amountToman)` اجرا شد در حالی که `decideReceipt` از
// `./cardpay.js` import نشده بود. نتیجه: ReferenceError داخل مسیرِ رسید و
// از کار افتادنِ **تأییدِ خودکارِ رسید** تا روز بعد که دستی فیکس شد.
// هیچ‌کدام از چک‌های CI آن را نگرفتند:
//   - `node --check` فقط سینتکس را می‌بیند، نه معنیِ شناسه‌ها
//   - boot smoke test فقط تا گاردِ ENV می‌رود، پس مسیرهای سرد اجرا نمی‌شوند
// یعنی هر مسیرِ کم‌رفت‌وآمد (رسید، ریفاند، ادمین، خطا) می‌تواند یک شناسه‌ی
// نبوده داشته باشد و تا لحظه‌ای که کاربرِ واقعی به آن برسد ساکت بماند.
//
// روش: محافظه‌کارانه. فقط **صداکردنِ تابع** (`NAME(`) را نگاه می‌کند و هر نامی
// را که در همان فایل به هر شکلی «تعریف‌گونه» ظاهر شده (import، function، const/let/var،
// class، پارامتر، دستراستِ destructuring، catch) بی‌خطر می‌شمارد. یعنی allowlist
// عمداً بزرگ‌تر از واقعیت است تا false positive ندهد؛ در عوض دقیقاً همان باگی را
// می‌گیرد که اتفاق افتاد: نامی که در کلِ فایل هیچ‌جا تعریف نشده.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// فایل‌هایی که چک می‌شوند: نقطه‌ی ورود و ماژول‌های محلیِ هر ربات Node.
const TARGETS = [
  'bots/tarot/index.js',
  'bots/tarot/reading-core.js',
  'bots/tarot/cardpay.js',
  'bots/tarot/reco.js',
  'bots/tarot/verdict.js',
  'bots/tarot/spreads.js',
  'bots/voice2text/index.js',
  'bots/dashboard/index.js',
  'bots/daily-brief/index.js',
  'bots/daily-brief/notion.js',
  'bots/daily-brief/script.js',
  'bots/daily-brief/tts.js',
  'bots/daily-brief/pipeline.js',
  'bots/_template/index.js',
  'shared/analytics.js',
  'shared/journey.js',
  'shared/ab.js',
  'shared/llm.js',
  'shared/reset.js',
  'shared/support.js',
  'shared/errors.js',
  'shared/logger.js',
  'tools/benchmark/tme.mjs',
  'tools/benchmark/collect.mjs',
  'tools/reading-lab.mjs',
  'tools/reading-lab/checks.mjs',
  'tools/marketing/perf.mjs',
  'tools/marketing/pick-cards.mjs',
  'tools/marketing/publish-day.mjs',
];

const GLOBALS = new Set([
  'console', 'JSON', 'Math', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'Promise', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Set', 'Map', 'WeakMap',
  'WeakSet', 'RegExp', 'Symbol', 'BigInt', 'Intl', 'Proxy', 'Reflect', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'eval',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate',
  'clearImmediate', 'queueMicrotask', 'structuredClone',
  'process', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape',
  'fetch', 'AbortController', 'AbortSignal', 'Headers', 'Request', 'Response',
  'FormData', 'Blob', 'File',
  'require', 'super', 'Function', 'Int8Array', 'Uint8Array', 'Float64Array',
]);

// کلیدواژه‌هایی که می‌توانند درست قبل از `(` بیایند و تابع نیستند
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new',
  'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'yield', 'case', 'throw', 'instanceof',
  'async', 'import', 'export', 'const', 'let', 'var', 'class', 'extends', 'this', 'with',
]);

// حذفِ کامنت‌ها و رشته‌ها تا `foo(` داخلِ متن یا کامنت اشتباهاً شمرده نشود.
// جای هر رشته/کامنت به تعدادِ خطوطش «\n» می‌گذاریم تا شماره‌ی خط درست بماند.
function strip(src) {
  let out = '';
  let i = 0;
  const keepLines = (s) => '\n'.repeat((s.match(/\n/g) || []).length);
  // آیا این `/` شروعِ یک literalِ regex است یا عملگرِ تقسیم؟ اگر آخرین نویسه‌ی
  // معنادارِ قبلش شناسه/عدد/`)`/`]` باشد تقسیم است، وگرنه regex.
  const regexAllowedHere = () => {
    let j = out.length - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    if (j < 0) return true;
    return !/[\w$)\]]/.test(out[j]);
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n !== '/' && n !== '*' && regexAllowedHere()) {
      // literalِ regex — تا `/`ِ بسته (با احترام به \ و کلاسِ [...]) دور ریخته می‌شود
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;            // regex نمی‌تواند چندخطی باشد → پس تقسیم بوده
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; continue; }
      out += c; i++;
    } else if (c === '/' && n === '/') {
      const j = src.indexOf('\n', i);
      i = j === -1 ? src.length : j;
    } else if (c === '/' && n === '*') {
      const j = src.indexOf('*/', i + 2);
      const chunk = src.slice(i, j === -1 ? src.length : j + 2);
      out += keepLines(chunk);
      i = j === -1 ? src.length : j + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      const chunk = src.slice(i, Math.min(j + 1, src.length));
      // داخلِ template literal، بخش‌های ${...} کدِ واقعی‌اند — نگه‌شان می‌داریم
      if (c === '`') {
        for (const m of chunk.matchAll(/\$\{([^{}]*)\}/g)) out += ' ' + m[1] + ' ';
      }
      out += keepLines(chunk);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// همه‌ی نام‌هایی که در فایل به هر شکلی «تعریف» شده‌اند (allowlistِ عمداً سخاوتمند)
function declaredNames(code) {
  const names = new Set();
  const add = (s) => { for (const m of (s || '').matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]); };

  // import { a, b as c } from '...'  /  import x from '...'  /  import * as ns from '...'
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s/g)) add(m[1]);
  // function NAME / class NAME
  for (const m of code.matchAll(/\b(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // const/let/var NAME  یا  const { a, b } = ...  یا  const [a, b] = ...
  for (const m of code.matchAll(/\b(?:const|let|var)\s+(\{[\s\S]*?\}|\[[\s\S]*?\]|[A-Za-z_$][\w$]*)/g)) add(m[1]);
  // پارامترهای تابع: هر چیزی داخلِ پرانتزِ بعد از function/=> را سخاوتمندانه اضافه کن
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) add(m[1]);
  // arrow با یک پارامترِ بدون پرانتز:  x => ...
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  // catch (e)
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // متدهای شیء/کلاس:  name(...) {  — این‌ها روی `this`/آبجکت صدا زده می‌شوند
  for (const m of code.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) names.add(m[1]);

  return names;
}

let failures = 0;
let checked = 0;

for (const rel of TARGETS) {
  let src;
  try {
    src = readFileSync(join(root, rel), 'utf8');
  } catch {
    continue; // فایل اختیاری (مثلاً رباتی که هنوز نیست)
  }
  checked++;
  const code = strip(src);
  const declared = declaredNames(code);
  const lines = code.split('\n');

  const seen = new Set();
  lines.forEach((line, idx) => {
    // `NAME(` که قبلش نقطه یا ?. نباشد (یعنی متدِ یک آبجکت نباشد)
    for (const m of line.matchAll(/(^|[^.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (KEYWORDS.has(name) || GLOBALS.has(name) || declared.has(name)) continue;
      const key = `${rel}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.error(`❌ ${rel}:${idx + 1} — «${name}(...)» صدا زده شده ولی در این فایل تعریف/import نشده`);
      failures++;
    }
  });
}

if (failures) {
  console.error(`\n${failures} شناسه‌ی تعریف‌نشده. اگر واقعاً از ماژولِ دیگری می‌آید، import اش کن.`);
  process.exit(1);
}
console.log(`✅ چکِ شناسه‌ها: ${checked} فایل، هیچ تابعِ صدا زده‌شده‌ی تعریف‌نشده‌ای نیست.`);
