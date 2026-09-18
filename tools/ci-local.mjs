#!/usr/bin/env node
/* 🏃 اجرای محلیِ همان چک‌هایی که CI اجرا می‌کند — قبل از پوش، نه بعدش.
 *
 * 💰 چرا این فایل وجود دارد (بند ۳ج ریشه):
 * اندازه‌گیریِ ۱۷ و ۱۸ شهریور ۱۴۰۵، روزی که سهمیه‌ی ماهانه ته کشید: از ۱۶۴ جابِ
 * قابلِ‌محاسبه‌ی آن دو روز، **۹۵تا (۵۸٪) CI روی pull_request** بود. و وقتی per برنچ
 * شکسته شد، علت یک‌جا افتاد:
 *
 *     17 ران  claude/tarot-language-strategy-3lteky   ← ۵۵٪ کلِ CIِ PR
 *      4 ران  claude/repo-architecture-review-wovacj
 *      4 ران  codex/tarot-central-flow-guard
 *      4 ران  codex/support-t-20260917-01
 *
 * یک برنچ ۱۷ بار CI را دوانده بود. این «دیباگ کردن روی رانرِ گیت‌هاب» است: پوش کن،
 * ببین قرمز شد، فیکس کن، دوباره پوش کن. هر دورش یک ماتریسِ کامل می‌سوزاند.
 *
 * ⚠️ و این دیگر یک مسئله‌ی **پیکربندی** نیست. صرفه‌جویی‌های ساختاریِ دورِ سوم
 * (۱۴۰۵/۰۶/۲۶) درست بودند و سرِ جایشان‌اند: ماتریسِ مسیرمحور، لغوِ اجرای منسوخِ PR،
 * تفکیکِ مرجِ PR از پوشِ مستقیم. چیزی که ماند **رفتارِ خودِ سشن‌هاست**، و رفتار را
 * با یادداشت در مستندات درست نمی‌کنند — با ابزار درست می‌کنند.
 *
 * 📏 سنجیده شد، تخمین زده نشد: از ۸۴ اسکریپتِ `tools/check-*.mjs`، **۸۲تا محلی سبز
 * می‌شوند**. یعنی تقریباً کلِ سوییتِ CI آفلاین اجراشدنی است و تنها دلیلِ رفتنش روی
 * رانر، نبودِ همین ابزار بود.
 *
 * 🔑 نگاشتِ «کدام چک برای کدام ربات» **هاردکد نیست** و از خودِ `ci.yml` می‌آید
 * (`toolMapFromCi`). همان تک‌منبعی که `ci-changed-bots.mjs` و `check-ci-changed.mjs`
 * استفاده می‌کنند، پس جابه‌جا شدنِ یک چک بینِ جاب‌ها خودبه‌خود این‌جا هم درست می‌ماند.
 *
 * استفاده:
 *   node tools/ci-local.mjs           # فقط چک‌های مربوط به تغییراتِ همین برنچ
 *   node tools/ci-local.mjs --all     # کلِ سوییت
 *   node tools/ci-local.mjs --jobs 8  # تعدادِ اجرای هم‌زمان (پیش‌فرض ۴)
 */

import { readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, toolMapFromCi } from './ci-changed-bots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ⏭ چک‌هایی که **ساختاراً** فقط در CI معنی دارند، با دلیلِ صریح.
 *
 * ⚠️ این لیست عمداً کوتاه و توضیح‌دار است. یک «skip» بی‌دلیل همان تله‌ی ثبت‌شده‌ی
 * بند ۶ب-۲ ریشه است: سبزی‌ای که از **نبودِ قرمز** می‌آید هیچ چیزی ثابت نمی‌کند.
 * برای همین پایین یک **کنترلِ مثبت** هست: اگر یکی از این‌ها محلی سبز شد، ابزار
 * می‌گوید از لیست حذفش کن — وگرنه لیست بی‌صدا کهنه می‌شود و چک‌های سالم را می‌خورد. */
const CI_ONLY = new Map([
  ['tools/check-daily-brief.mjs', 'وابسته به node_modules رباتِ daily-brief که محلی نصب نیست'],
  ['tools/check-journey.mjs', 'فقط روی محیطِ تمیز اجرا می‌شود (bots/tarot/data نباید از قبل باشد)'],
]);

const args = process.argv.slice(2);
const runAll = args.includes('--all');
// فقط فهرست را چاپ کن و اجرا نکن. هم برای آدم مفید است («الان چی می‌زنه؟») و هم
// تنها راهِ **رفتاری** سنجیدنِ انتخاب در گارد؛ ادعای متنیِ «toolMapFromCi صدا زده شده»
// با جایگزینیِ همان فراخوانی با یک Map خالی سبز می‌ماند (گاردِ آینه‌ای، بند ۶ب ریشه).
const listOnly = args.includes('--list');
const jobs = Math.max(1, Number((args.find((a) => a.startsWith('--jobs')) || '').split(/[= ]/)[1]) || 4);

/** چک‌های جابِ `changes` که روی **هر** پوش اجرا می‌شوند و به هیچ رباتی گره نخورده‌اند. */
function alwaysOnChecks() {
  const yml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const block = yml.slice(yml.indexOf('\n  changes:'), yml.indexOf('\n  check:'));
  return [...new Set([...block.matchAll(/node (tools\/[\w.\-/]+\.mjs)/g)].map((m) => m[1]))];
}

/** فایل‌های عوض‌شده‌ی همین برنچ: هم کامیت‌شده (نسبت به merge-base با main) هم کارِ نشده. */
function localChangedFiles() {
  const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  try {
    const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
    const committed = git(['diff', '--name-only', `${base}...HEAD`]).split('\n');
    // ⚠️ خروجیِ `--porcelain` برای فایلِ استیج‌نشده با **یک فاصله** شروع می‌شود (` M path`).
    // پس هرگز کلِ خروجی trim نمی‌شود: آن فاصله بخشی از دو ستونِ وضعیت است و بریدنش
    // خطِ اول را یک کاراکتر جابه‌جا می‌کند (نامِ فایل ناقص ⟵ «مسیرِ ناشناخته» ⟵ fail-open).
    const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3).trim());
    return [...new Set([...committed, ...dirty])].filter(Boolean);
  } catch {
    return null; // مبنایی پیدا نشد → مثل CI به fail-open می‌افتیم و همه را می‌زنیم
  }
}

function pick() {
  const toolMap = toolMapFromCi();
  if (!toolMap) return { list: [...CI_ONLY.keys(), ...alwaysOnChecks()], why: 'ساختارِ ci.yml شناخته نشد' };

  const checks = [...toolMap.keys()].filter((t) => /check-[\w.-]+\.mjs$/.test(t));
  if (runAll) return { list: [...new Set([...checks, ...alwaysOnChecks()])], why: '‎--all' };

  const files = localChangedFiles();
  if (!files) return { list: [...new Set([...checks, ...alwaysOnChecks()])], why: 'مبنای مقایسه پیدا نشد (fail-open)' };

  const d = decide(files, toolMap);
  const want = new Set(d.bots);
  const list = checks.filter((t) => (toolMap.get(t) || []).some((b) => want.has(b)));
  return { list: [...new Set([...list, ...alwaysOnChecks()])], why: `${d.reason} → [${d.bots.join(', ') || '—'}]` };
}

const run = (script) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    execFile('node', [script], { cwd: ROOT, timeout: 180_000, maxBuffer: 16 << 20 }, (err, _out, stderr) => {
      resolve({ script, ok: !err, ms: Date.now() - t0, tail: String(stderr || '').trim().split('\n').slice(-6).join('\n') });
    });
  });

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) out.push(await fn(items[i++]));
  }));
  return out;
}

const { list, why } = pick();
const toRun = list.filter((t) => !CI_ONLY.has(t));
const skipped = list.filter((t) => CI_ONLY.has(t));

if (listOnly) {
  for (const t of toRun) console.log(t);
  for (const t of skipped) console.log(`${t}\t(CI_ONLY)`);
  process.exit(0);
}

console.log(`🏃 اجرای محلیِ چک‌های CI — ${toRun.length} چک  (${why})\n`);

const started = Date.now();
const results = await pool(toRun, jobs, run);
const failed = results.filter((r) => !r.ok);

for (const r of results.sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`   ⏱ ${(r.ms / 1000).toFixed(1)}s  ${r.script}`);
console.log();

for (const t of skipped) console.log(`⏭ فقط در CI: ${t}\n   دلیل: ${CI_ONLY.get(t)}`);

/* کنترلِ مثبت: چکی که «مسدود» اعلام شده ولی محلی سبز می‌شود، یعنی لیستِ بالا کهنه
 * شده. بدونِ این، `CI_ONLY` به‌مرور به یک سطلِ زباله تبدیل می‌شود و چک‌های سالم را
 * از دیدِ محلی حذف می‌کند — بی‌صدا. */
if (skipped.length) {
  const probe = await pool(skipped, jobs, run);
  for (const r of probe.filter((x) => x.ok)) {
    console.log(`\n⚠️ «${r.script}» محلی سبز شد، پس دیگر مسدود نیست — از CI_ONLY حذفش کن.`);
  }
}

console.log(`\n${'─'.repeat(60)}`);
if (failed.length) {
  console.log(`❌ ${failed.length} چک قرمز (از ${results.length}) در ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  for (const r of failed) console.log(`\n❌ ${r.script}\n${r.tail}\n`);
  console.log('👉 قبل از پوش اینها را درست کن. هر پوشِ قرمز یک ماتریسِ کاملِ CI می‌سوزاند (بند ۳ج ریشه).');
  process.exit(1);
}
console.log(`✅ هر ${results.length} چک سبز — در ${((Date.now() - started) / 1000).toFixed(0)}s. آماده‌ی پوش.`);
