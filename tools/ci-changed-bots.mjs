#!/usr/bin/env node
// کدام ربات‌ها واقعاً باید در این اجرا چک شوند؟ (صرفه‌جویی سهمیه‌ی Actions — بند ۳ج ریشه)
//
// چرا: CI بزرگ‌ترین مصرف‌کننده‌ی سهمیه است (اندازه‌گیریِ شهریور ۱۴۰۵: ۱۲۶۴ جاب از ۲۳۰۷،
// یعنی ۵۳٪) و دلیلش ماتریسِ ثابت است: یک تغییرِ تک‌خطی در `bots/tarot/` شش جاب می‌سازد
// که پنج‌تایشان هیچ فایلی از آن تغییر را نمی‌بینند. گیت‌هاب per **جاب** و رند به بالا
// حساب می‌کند، پس آن پنج جاب پنج دقیقه‌ی کامل‌اند.
//
// ⚠️ نسخه‌ی اولِ این فایل روی تاریخچه‌ی واقعی **صفر درصد** صرفه‌جویی کرد و همان اندازه‌گیری
// نجاتش داد: قاعده‌ی سرانگشتیِ «هر چیزی در tools/ یعنی همه» در ۳۶ کامیت از ۴۹ آتش می‌گرفت،
// چون تقریباً هر PR این ریپو یک چکِ جدید هم می‌آورد. ولی هر `tools/check-*.mjs` در عمل
// **فقط در یک جاب** اجرا می‌شود. پس نگاشت از روی خودِ `ci.yml` استخراج می‌شود، نه حدس:
// اگر فردا یک چک از جابِ tarot به جابِ dashboard منتقل شود، این فایل خودبه‌خود درست می‌ماند.
//
// ⚠️ اصلِ طراحی: **fail-open**. هر ابهامی یعنی همه را اجرا کن. یک اجرای اضافه یک دقیقه
// هزینه دارد؛ یک چکِ جاافتاده می‌تواند رباتِ زنده را بشکند.
//
// خروجی (به $GITHUB_OUTPUT):  bots=["tarot",...]   tabir=true|false
import { readdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABIR = 'tabir-khab';

// ربات‌های Node = هر پوشه‌ی bots/* با package.json، منهای قالب. خودنگه‌دار: ربات جدید
// بدونِ ویرایشِ این فایل پوشش می‌گیرد (اگر هاردکد بود، بی‌صدا از CI جا می‌ماند).
const NODE_BOTS = readdirSync(join(ROOT, 'bots'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_template' && existsSync(join(ROOT, 'bots', d.name, 'package.json')))
  .map((d) => d.name)
  .sort();

const ALL = { bots: NODE_BOTS, tabir: true };

// مسیرهایی که **هیچ** جابی را لازم ندارند: مستندات و دیتای غیر-رباتی.
const IGNORED = [
  /^marketing\//, /^benchmark\//, /^analytics\//, /^support\//,
  /^\.github\/ISSUE_TEMPLATE\//, /^\.claude\//, /\.md$/,
];

/** نگاشتِ «فایلِ ابزار → کدام جاب‌ها آن را اجرا می‌کنند»، مستقیم از ci.yml.
 *  هر استپِ جابِ `check` یا `if: matrix.bot == 'X'` دارد (یعنی فقط همان ربات) یا ندارد
 *  (یعنی همه‌ی ربات‌های ماتریس). هر `tools/…` که در `run:` همان استپ بیاید همان دامنه را
 *  به ارث می‌برد. */
function toolMapFromCi() {
  const yml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const start = yml.indexOf('\n  check:');
  const end = yml.indexOf('\n  check-tabir-khab:');
  if (start < 0 || end < 0) return null;                    // شکلِ فایل عوض شده → fail-open
  const blocks = yml.slice(start, end).split(/\n      - /).slice(1);
  const map = new Map();
  for (const b of blocks) {
    const m = /if:\s*matrix\.bot\s*==\s*'([^']+)'/.exec(b);
    const scope = m ? [m[1]] : NODE_BOTS;                   // بدونِ if یعنی کلِ ماتریس
    for (const t of b.matchAll(/tools\/([\w.\-/]+)/g)) {
      const k = 'tools/' + t[1];
      map.set(k, [...new Set([...(map.get(k) || []), ...scope])]);
    }
  }
  return map;
}

/** فایلی که خودش در ci.yml نیست ولی یک اسکریپتِ چک **می‌خواندش** (مثل deploy.yml که
 *  check-deploy-env می‌خواند، یا manual-deploy.sh). دامنه‌اش را از همان چک به ارث می‌برد. */
function readersOf(file, toolMap) {
  const base = basename(file);
  const bots = new Set();
  for (const [tool, scope] of toolMap) {
    let src;
    try { src = readFileSync(join(ROOT, tool), 'utf8'); } catch { continue; }
    if (src.includes(base)) scope.forEach((b) => bots.add(b));
  }
  return [...bots];
}

export function decide(files, toolMap = toolMapFromCi()) {
  if (!toolMap) return { ...ALL, reason: 'ساختارِ ci.yml شناخته نشد (fail-open)' };
  if (!files.length) return { bots: [], tabir: false, reason: 'هیچ فایلی عوض نشده' };
  const relevant = files.filter((f) => !IGNORED.some((re) => re.test(f)));
  if (!relevant.length) return { bots: [], tabir: false, reason: 'فقط مستندات/دیتای غیر-رباتی' };

  const bots = new Set();
  let tabir = false;
  const add = (list) => list.forEach((b) => (b === TABIR ? (tabir = true) : bots.add(b)));

  for (const f of relevant) {
    // زیرساختِ مشترکِ واقعی: هر ربات آن را import می‌کند
    if (/^shared\//.test(f) || /^ecosystem\.config\.cjs$/.test(f)) return { ...ALL, reason: `زیرساختِ مشترک: ${f}` };
    // خودِ تعریفِ جاب‌ها عوض شده → دیگر نمی‌شود به نگاشت اعتماد کرد
    if (f === '.github/workflows/ci.yml') return { ...ALL, reason: 'خودِ ci.yml عوض شده' };

    if (f.startsWith('tools/')) {
      const scope = toolMap.get(f);
      if (scope) { add(scope); continue; }                  // اسکریپتی که ci.yml اجرایش می‌کند
      const rd = readersOf(f, toolMap);
      if (rd.length) { add(rd); continue; }                 // فایلی که یک چک می‌خواندش
      continue;                                             // ابزارِ دِو/آپس؛ هیچ رباتی import نمی‌کند
    }
    if (f.startsWith('.github/workflows/')) {
      const rd = readersOf(f, toolMap);
      if (rd.length) { add(rd); continue; }                 // مثل deploy.yml → چک‌های دیپلوی
      continue;                                             // ورک‌فلویی که هیچ چکی نمی‌خواندش
    }
    if (f.startsWith('video/')) { add(readersOf('check-tarot-video.mjs', toolMap).length ? ['tarot'] : NODE_BOTS); continue; }

    const m = /^bots\/([^/]+)\//.exec(f);
    if (!m) return { ...ALL, reason: `مسیرِ ناشناخته: ${f}` };   // fail-open
    if (m[1] === '_template') continue;                     // قالب هیچ جابی ندارد
    if (m[1] === TABIR) { tabir = true; continue; }
    if (!NODE_BOTS.includes(m[1])) return { ...ALL, reason: `رباتِ ناشناخته: ${m[1]}` };
    bots.add(m[1]);
  }
  return { bots: [...bots].sort(), tabir, reason: 'تغییرِ محدود به همین جاب‌ها' };
}

function changedFiles() {
  const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  try {
    if ((process.env.GITHUB_EVENT_NAME || '') === 'pull_request') {
      const base = process.env.GITHUB_BASE_REF;
      run(['fetch', '--no-tags', '--depth=50', 'origin', base]);
      const mb = run(['merge-base', 'FETCH_HEAD', 'HEAD']).trim();
      return run(['diff', '--name-only', `${mb}..HEAD`]).split('\n').filter(Boolean);
    }
    const before = process.env.GITHUB_EVENT_BEFORE || '';
    if (!before || /^0+$/.test(before)) return null;        // اولین پوش → مبنایی برای مقایسه نیست
    return run(['diff', '--name-only', `${before}..HEAD`]).split('\n').filter(Boolean);
  } catch (e) {
    // ⚠️ این حالت **باید دیده شود**. fail-open امن است (هیچ چکی رد نمی‌شود) ولی اگر
    // همیشه بیفتد یعنی صرفه‌جویی بی‌صدا مرده. دقیقاً همین رخ داد: کلونِ shallowِ
    // پیش‌فرضِ checkout باعث می‌شد merge-base همیشه شکست بخورد و هیچ‌کس خبردار نشود.
    // `::warning::` در خلاصه‌ی رانِ گیت‌هاب دیده می‌شود، پس تکرارش قابلِ تشخیص است.
    const msg = e.message.split('\n')[0];
    console.log(`⚠️ محاسبه‌ی diff نشد (${msg})`);
    console.log(`::warning title=فیلترِ CI کار نکرد::${msg} — همه‌ی جاب‌ها اجرا شدند (fail-open). اگر تکرار شد یعنی صرفه‌جویی مرده است.`);
    return null;
  }
}

/* 🔁 پوشی که **مرجِ یک PR** است، ماتریسِ ربات‌ها را دوباره اجرا نمی‌کند.
 *
 * چکِ PR روی نتیجه‌ی merge اجرا می‌شود، پس اجرای دومِ روی main تقریباً همان درخت را
 * دوباره تست می‌کند. این از قبل در بند ۳ج ریشه به‌عنوان اتلاف ثبت شده بود؛ حالا
 * اندازه‌گیری هم پشتش هست (۲۱ روزِ واقعی، ۲۲ شهریور تا ۱۱ مهر):
 *   • ۱۳۶ اجرای CI روی push، که **۱۰۰تایش** مرجِ PR بود → ۹۹ سبز، ۱ قرمز.
 *   • و آن یک قرمز در **جابِ `changes`** بود (گاردِ تنوعِ محتوای کانال)، نه در
 *     ماتریسِ ربات‌ها. یعنی ماتریس در ۱۰۰ مرج **هیچ‌وقت** چیزی نگرفت.
 *   • ۳۶ پوشِ مستقیم (بدونِ PR) ولی **۴ قرمز** داشتند — یعنی CI آن‌جا واقعاً کار
 *     می‌کند و حذفِ بی‌قیدِ `push` یک تورِ ایمنیِ زنده را می‌بُرد.
 * پس تفکیک لازم است، نه حذف: مرجِ PR ماتریس را رد می‌کند، پوشِ مستقیم نه.
 *
 * ⚠️ جابِ `changes` عمداً همچنان اجرا می‌شود: دو گاردِ مارکتینگش آن‌جا هستند و همان
 * تنها چیزی است که در این ۱۰۰ مرج یک باگ گرفت. صرفه‌جویی از ماتریس می‌آید نه از این.
 *
 * ⚠️ و تشخیص عمداً fail-**open** است (هم‌راستا با کلِ این فایل): هر شکلِ ناشناخته‌ی
 * پیامِ کامیت یعنی «مرج نیست» و ماتریس کامل اجرا می‌شود.
 * فقط **خطِ اولِ** پیام سنجیده می‌شود، به همان دلیلِ ثبت‌شده‌ی گیتِ پنجره‌ی دیپلوی:
 * بدنه پر از نقلِ‌قول است و یک PR که این مکانیزم را مستند کند نباید خودش را خاموش کند.
 */
export function isPrMergePush(eventName, headMsg) {
  if (eventName !== 'push') return false;
  const first = String(headMsg || '').split('\n')[0].trim();
  if (!first) return false;
  return /\(#\d+\)$/.test(first)              // squash merge: «… (#305)»
      || /^Merge pull request #\d+\b/.test(first);  // merge commit
}

function main() {
  if (isPrMergePush(process.env.GITHUB_EVENT_NAME, process.env.HEAD_COMMIT_MSG)) {
    console.log('↩︎ این پوش مرجِ یک PR است — ماتریسِ ربات‌ها روی همان درخت قبلاً سبز شده.');
    console.log(`   💾 حدودِ ${NODE_BOTS.length + 1} جاب اجرا نمی‌شود (گاردهای همین جاب سرِ جایشان‌اند).`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'bots=[]\ntabir=false\n');
    return;
  }
  const files = changedFiles();
  const out = files === null ? { ...ALL, reason: 'diff قابلِ محاسبه نبود (fail-open)' } : decide(files);
  if (files) console.log(`فایل‌های عوض‌شده (${files.length}):\n` + files.slice(0, 50).map((f) => '  ' + f).join('\n'));
  console.log(`\n➡️  ${out.reason}`);
  console.log(`   ربات‌های Node: ${out.bots.length ? out.bots.join(', ') : '(هیچ)'}`);
  console.log(`   tabir-khab: ${out.tabir ? 'بله' : 'خیر'}`);
  const skipped = NODE_BOTS.length + 1 - out.bots.length - (out.tabir ? 1 : 0);
  if (skipped > 0) console.log(`   💾 ${skipped} جاب اجرا نشد (≈${skipped} دقیقه‌ی سهمیه)`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `bots=${JSON.stringify(out.bots)}\ntabir=${out.tabir}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('ci-changed-bots.mjs')) main();
