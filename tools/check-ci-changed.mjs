#!/usr/bin/env node
// گاردِ فیلترِ مسیرِ CI: منطقِ «کدام جاب اجرا شود» واقعاً اجرا می‌شود.
//
// چرا چکِ رفتاری و نه چشمی: این فیلتر تصمیم می‌گیرد چه چیزی **اجرا نشود**. اشتباهش
// قرمز نمی‌شود، فقط ساکت یک محافظ را برمی‌دارد و رباتِ زنده بدونِ آن دیپلوی می‌شود.
// پس ادعای مرکزی «صرفه‌جویی» نیست، **fail-open** است: هر ابهامی باید همه را روشن کند.
//
// عمداً هیچ جفتِ «فلان چک → فلان ربات» را هاردکد نمی‌کنیم: آن نگاشت از خودِ ci.yml
// استخراج می‌شود و اگر فردا چکی بینِ جاب‌ها جابه‌جا شود باید خودبه‌خود درست بماند.
// به‌جایش **ناوردا** سنجیده می‌شود: هیچ فایلِ کدی نباید به «هیچ جاب» نگاشت شود.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, baselineOf } from './ci-changed-bots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const jobsOf = (d) => d.bots.length + (d.tabir ? 1 : 0);
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) { if (extra) console.log('   ' + extra); fail++; }
};

const ALL = decide(['shared/x.js']);
const N_ALL = jobsOf(ALL);
ok(N_ALL >= 4, `لیستِ کاملِ جاب‌ها منطقی است (${N_ALL} جاب)`, JSON.stringify(ALL));

// ── ۱) fail-open: هر ابهامی یعنی همه ──────────────────────────────────────
const failOpen = [
  ['shared/ (زیرساختِ مشترک)', ['shared/llm.js']],
  ['ecosystem.config.cjs', ['ecosystem.config.cjs']],
  ['خودِ ci.yml', ['.github/workflows/ci.yml']],
  ['مسیرِ کاملاً ناشناخته', ['some-new-thing.json']],
  ['رباتِ ناشناخته', ['bots/brand-new-bot/index.js']],
  ['ناشناخته کنارِ یک ربات', ['bots/tarot/index.js', 'weird-root-file.txt']],
];
for (const [name, files] of failOpen) {
  const d = decide(files);
  ok(jobsOf(d) === N_ALL, `fail-open: ${name} → همه`, `شد: ${JSON.stringify(d)}`);
}

// ── ۲) ناوردای اصلی: هیچ فایلِ کدی به «هیچ جاب» نگاشت نشود ─────────────────
// اگر روزی یک مسیرِ کد به لیستِ IGNORED اضافه شود، این‌جا قرمز می‌شود.
const codeFiles = [
  'bots/tarot/index.js', 'bots/tarot/cardpay.js', 'bots/voice2text/index.js',
  'bots/dashboard/index.js', 'bots/daily-brief/index.js', 'bots/resume-tailor/index.js',
  'bots/tabir-khab/bot.py', 'shared/support.js', 'video/tarot-reel/src/x.js',
];
for (const f of codeFiles) {
  ok(jobsOf(decide([f])) > 0, `فایلِ کد جاب دارد: ${f}`);
}

// ── ۳) هر اسکریپتی که ci.yml اجرا می‌کند باید به جابی نگاشت شود ───────────
// اگر چکی اضافه شود ولی نگاشت نگیرد، تغییرِ خودش هیچ جابی را روشن نمی‌کند، یعنی
// می‌شود آن را شکست و CI ساکت بماند.
const yml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const section = yml.slice(yml.indexOf('\n  check:'), yml.indexOf('\n  check-tabir-khab:'));
const referenced = [...new Set([...section.matchAll(/tools\/([\w.\-/]+)/g)].map((m) => 'tools/' + m[1]))];
ok(referenced.length > 10, `ci.yml به ${referenced.length} اسکریپتِ tools ارجاع می‌دهد`);
for (const t of referenced) {
  ok(jobsOf(decide([t])) > 0, `چکِ ci.yml نگاشت دارد: ${t}`);
}

// ── ۳.۵) جابِ changes باید تاریخچه‌ی کامل بگیرد ───────────────────────────
// باگِ واقعیِ ۱۴۰۵/۰۶/۰۸: پیش‌فرضِ checkout کلونِ shallow (عمقِ ۱) است، پس `merge-base`
// همیشه شکست می‌خورد و فیلتر هر بار به fail-open می‌افتاد — یعنی **صفر صرفه‌جویی، بی‌صدا**.
// در لاگِ اولین اجرای واقعی پیدا شد، نه در تستِ محلی (که کلونش کامل است).
// ⚠️ کامنت‌ها **قبل از سنجش** حذف می‌شوند. نسخه‌ی اولِ همین ادعا کلمه را داخلِ کامنتِ
// توضیحیِ بالای همان خط پیدا می‌کرد و با برداشتنِ خودِ `with:` هم سبز می‌ماند — یعنی
// یک گاردِ کاملاً بی‌اثر. (همان تله‌ای که در v3.30.0 هم یک بار افتاد.)
const changesJob = yml.slice(yml.indexOf('\n  changes:'), yml.indexOf('\n  check:'))
  .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
ok(/fetch-depth:\s*0/.test(changesJob),
  'جابِ changes با fetch-depth: 0 چک‌اوت می‌کند (وگرنه merge-base می‌شکند و فیلتر بی‌صدا می‌میرد)');

// ── ۴) صرفه‌جویی واقعاً اتفاق می‌افتد ──────────────────────────────────────
const oneBot = decide(['bots/tarot/index.js']);
ok(oneBot.bots.length === 1 && oneBot.bots[0] === 'tarot' && !oneBot.tabir,
  'تغییرِ یک ربات فقط همان ربات را اجرا می‌کند', JSON.stringify(oneBot));
ok(jobsOf(decide(['bots/tabir-khab/bot.py'])) === 1, 'تغییرِ tabir فقط جابِ پایتون را اجرا می‌کند');
const subset = referenced.filter((t) => jobsOf(decide([t])) < N_ALL);
ok(subset.length > 5, `${subset.length} چک دامنه‌ی محدود دارند (صرفه‌جویی برقرار است)`);

// ── ۵) مستندات و دیتای غیر-رباتی هیچ جابی لازم ندارند ────────────────────
for (const [name, files] of [
  ['فقط مستندات', ['CLAUDE.md', 'bots/tarot/CLAUDE.md']],
  ['فقط مارکتینگ', ['marketing/tarot/posts/x.json']],
  ['فقط دفترِ پشتیبانی', ['support/tickets.jsonl']],
  ['هیچ فایلی', []],
]) ok(jobsOf(decide(files)) === 0, `بدونِ جاب: ${name}`, JSON.stringify(decide(files)));

/* 💰 مبنای مقایسه per رویداد — رفتاری، با اجرای خودِ تابعِ محصول.
 *
 * چرا ادعا دارد: اجرای دستیِ CI ماهی ~۳۱۰ جاب می‌خورد (۱۰٪ سهمیه) چون روی
 * `workflow_dispatch` مبنا نداشت و fail-open هر هفت جاب را می‌زد. اگر روزی کسی این
 * شاخه را بردارد، صرفه‌جویی **بی‌صدا** می‌میرد — دقیقاً همان کلاسِ باگی که کلونِ
 * shallow یک بار ساخت. */
console.log('\n▶ مبنای مقایسه per رویداد');
const B = (env) => baselineOf(env);

ok(B({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' })?.kind === 'merge-base',
  'PR با merge-base سنجیده می‌شود');
ok(B({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: 'abc123' })?.kind === 'range',
  'push با بازه‌ی before..HEAD سنجیده می‌شود');
ok(B({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: '0000000000000000000000000000000000000000' }) === null,
  'اولین پوشِ یک برنچ مبنا ندارد ⟵ fail-open');

// شاخه‌ی گران‌قیمت: dispatch روی یک برنچ باید مبنا داشته باشد، نه fail-open.
ok(B({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'claude/x' })?.kind === 'merge-base',
  '💰 اجرای دستی روی یک برنچ با merge-base سنجیده می‌شود (نه هر هفت جاب)');
ok(B({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'claude/x' })?.ref === 'main',
  'و مبنایش برنچِ پیش‌فرض است');
ok(B({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'dev', GITHUB_DEFAULT_BRANCH: 'dev' }) === null,
  'ولی روی خودِ برنچِ پیش‌فرض مبنا ندارد ⟵ fail-open (حدس‌زدن یعنی ردکردنِ چکِ لازم)');
ok(B({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'main' }) === null,
  'و نامِ پیش‌فرض وقتی ست نشده «main» است');
ok(B({ GITHUB_EVENT_NAME: 'workflow_dispatch' }) === null,
  'برنچِ ناشناخته ⟵ fail-open، نه یک مبنای حدسی');
ok(B({ GITHUB_EVENT_NAME: 'pull_request' }) === null,
  'PR بدونِ base ref ⟵ fail-open');

console.log(fail ? `\n❌ ${fail} خطا` : '\n✅ همه‌ی ادعاهای فیلترِ CI پاس شدند');
process.exit(fail ? 1 : 0);
