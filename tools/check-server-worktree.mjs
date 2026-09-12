#!/usr/bin/env node
// 🛑 گاردِ «هیچ‌کس درختِ کارِ کلونِ سرور را کثیف نمی‌کند»
//
// ── باگِ واقعی که این چک از آن آمد (۹ شهریور ۱۴۰۵) ────────────────────────────
// ورک‌فلویِ `News probe` می‌خواست کدِ تازه‌ی `tools/news` را روی سرور اجرا کند و
// این یک خط را زد:
//
//     git fetch --quiet origin main && git checkout --quiet -f origin/main -- tools/news
//
// خودِ probe فقط می‌خواند و هیچ رباتی را لمس نمی‌کند، پس بی‌خطر به نظر می‌رسید.
// ولی `checkout <ref> -- <path>` فایل را هم در **درختِ کار** و هم در **index**
// می‌نشاند، در حالی که HEADِ سرور هنوز عقب بود. از آن ثانیه به بعد کلونِ سرور
// «تغییرِ محلی» داشت و **هر دیپلویِ بعدی** با این خطا می‌مرد:
//
//     error: Your local changes to the following files would be overwritten by merge:
//     	tools/news/sources.json
//
// خرابیِ ماندگار: نه خودش پاک می‌شد و نه مالک SSH دارد که دستی پاکش کند. یک
// ورک‌فلویِ فقط-خواندنی، مسیرِ استقرارِ ربات‌های زنده را قفل کرد.
//
// ── قاعده ─────────────────────────────────────────────────────────────────────
// کلونِ `~/voice2text` روی سرور یک آینه‌ی فقط-خواندنی از main است. تنها نوشتنِ مجاز
// روی آن، همگام‌سازیِ خودِ دیپلوی با origin/main است. هرچه لازم است از یک ref دیگر
// خوانده شود، باید در پوشه‌ی موقت باز شود (`git archive <ref> <path> | tar -x -C "$TMP"`).
//
// ── چرا denylist ──────────────────────────────────────────────────────────────
// مثلِ `check-deploy-onetime.mjs`: هر فعلِ گیتی که می‌تواند درختِ کار را عوض کند
// خطاست، مگر اینکه دقیقاً در فهرستِ استثناهای زیر باشد. اگر فردا کسی راهِ تازه‌ای
// برای کثیف‌کردنِ درخت پیدا کرد، چک باید **جلویش را بگیرد**، نه اینکه چون آن شکل
// را نمی‌شناسد بی‌صدا سبز بماند.

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const WF_DIR = '.github/workflows';
const VPS_HOST = '185.204.171.170';

// فایل‌هایی که روی خودِ سرور اجرا می‌شوند (خارج از ورک‌فلوها)
const SERVER_SCRIPTS = ['tools/marketing/vps-daily-post.sh', 'tools/manual-deploy.sh'];

// فعل‌هایی که می‌توانند درختِ کار یا index را عوض کنند
// `merge-base` فقط پرسش است و چیزی را عوض نمی‌کند، پس از `merge` جدا می‌شود.
const DIRTY_VERBS = /\bgit\s+(checkout|restore|switch|stash|apply|am|cherry-pick|revert|merge(?!-base)|rebase|clean|reset|add|commit)\b/;

// تنها استثنا؛ باید «یکی‌کردنِ درخت با main» باشد نه ساختنِ تغییرِ محلی. عمداً به
// خودِ deploy.yml محدود است: همگام‌سازی کارِ مسیرِ استقرار است، نه هر ورک‌فلویی.
const ALLOWED = [
  { file: '.github/workflows/deploy.yml', re: /^git\s+reset\s+--hard\s+--quiet\s+origin\/main$/ },
];

const offenders = [];

function scan(file, text) {
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;          // کامنت‌ها (مثل همین توضیحات) خطا نیستند
    if (!DIRTY_VERBS.test(line)) return;
    const cmd = line.replace(/^[-\s]*/, '').replace(/\s*(\|\||&&|;|\|)\s*$/, '').trim();
    if (ALLOWED.some((a) => file.endsWith(a.file) && a.re.test(cmd))) return;
    offenders.push(`${file}:${i + 1}\n      ${line}`);
  });
}

const workflows = readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
let scanned = 0;
for (const f of workflows) {
  const p = join(WF_DIR, f);
  const text = readFileSync(p, 'utf8');
  if (!text.includes(VPS_HOST)) continue;               // فقط ورک‌فلوهایی که به سرور SSH می‌زنند
  scanned++;
  scan(p, text);
}
for (const p of SERVER_SCRIPTS) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { continue; }
  scanned++;
  scan(p, text);
}

if (scanned === 0) {
  console.error('❌ هیچ فایلی برای بررسی پیدا نشد — مسیرِ ورک‌فلوها عوض شده؟');
  process.exit(1);
}

if (offenders.length) {
  console.error('❌ دستوری پیدا شد که درختِ کارِ کلونِ سرور را کثیف می‌کند:\n');
  for (const o of offenders) console.error(`   • ${o}\n`);
  console.error('   کلونِ سرور آینه‌ی فقط-خواندنیِ main است؛ تنها نوشتنِ مجاز، همگام‌سازیِ خودِ deploy.yml با origin/main است.');
  console.error('   برای خواندنِ کدِ یک ref دیگر از پوشه‌ی موقت استفاده کن:');
  console.error('       TMP=$(mktemp -d); trap \'rm -rf "$TMP"\' EXIT');
  console.error('       git archive origin/main <path> | tar -x -C "$TMP"');
  console.error('   وگرنه هر دیپلویِ بعدی با «local changes would be overwritten by merge» می‌شکند.');
  process.exit(1);
}

// ── بخشِ دوم: `chmod +x`ِ دیپلوی نباید خودش درخت را کثیف کند ──────────────────
// باگِ واقعیِ ۸ شهریور ۱۴۰۵: `tools/marketing/vps-daily-post.sh` در گیت با مودِ
// 100644 کامیت شده بود و deploy.yml روی سرور `chmod +x`ش می‌کرد. یعنی بعد از هر
// دیپلوی، گیتِ سرور یک «تغییرِ محلی» داشت (فقط تغییرِ مود)؛ دیپلویِ بعدی دورش
// می‌انداخت، همان هشدار را چاپ می‌کرد، و دوباره chmod می‌زد. پینگ‌پنگِ ابدی.
//
// خرابی‌اش سکوتِ خودِ هشدار است: سیگنالی که قرار بود بگوید «یک چیزی درخت را کثیف
// می‌کند» در **هر** دیپلوی شلیک می‌شد، پس یک فایلِ کثیفِ واقعی لای نویز گم می‌شد.
// (هم‌خانواده‌ی پینگ‌پنگِ `ADMIN_IDS` در بند ۳ ریشه: چیزی بیرون از تک‌منبعِ حقیقت
// روی همان چیزی می‌نویسد که دیپلوی با آن مقایسه می‌کند.)
//
// قاعده: هر فایلی که دیپلوی روی سرور اجراییِ‌اش می‌کند، باید **در گیت** اجرایی
// باشد. آن‌وقت `chmod +x` واقعاً no-op است. عمداً لیست هاردکد نیست: مسیرها از خودِ
// ورک‌فلو استخراج می‌شوند تا `chmod +x`ِ فردا هم خودکار پوشش بگیرد.
const CHMOD_X = /\bchmod\s+(?:-\S+\s+)*\+x\s+(\S+)/g;
const chmodTargets = new Set();
for (const f of workflows) {
  const p = join(WF_DIR, f);
  const text = readFileSync(p, 'utf8');
  if (!text.includes(VPS_HOST)) continue;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    for (const m of t.matchAll(CHMOD_X)) {
      const target = m[1].replace(/^["']|["']$/g, '');
      if (target.startsWith('$') || target.includes('*')) continue;   // مسیرِ پویا: قابلِ سنجش نیست
      chmodTargets.add(target);
    }
  }
}

const modeOffenders = [];
for (const target of chmodTargets) {
  let row;
  try {
    row = execFileSync('git', ['ls-files', '-s', '--', target], { encoding: 'utf8' }).trim();
  } catch {
    modeOffenders.push(`${target} — «git ls-files» اجرا نشد`);
    continue;
  }
  if (!row) continue;                                   // در گیت نیست (مثلاً فایلِ ساخته‌شده روی سرور)
  const mode = row.split(/\s+/)[0];
  if (mode !== '100755') modeOffenders.push(`${target} — مودِ گیت ${mode} است، نه 100755`);
}

if (modeOffenders.length) {
  console.error('❌ دیپلوی روی سرور `chmod +x` می‌زند ولی فایل در گیت اجرایی نیست:\n');
  for (const o of modeOffenders) console.error(`   • ${o}`);
  console.error('\n   نتیجه: بعد از هر دیپلوی، درختِ کارِ سرور فقط به‌خاطرِ تغییرِ مود «کثیف» می‌شود و');
  console.error('   هشدارِ خودترمیمی در هر دیپلوی بی‌دلیل شلیک می‌کند، پس کثیفیِ واقعی لای نویز گم می‌شود.');
  console.error('   درمان (یک دستور، بدونِ تغییرِ محتوای فایل):');
  console.error('       git update-index --chmod=+x <path>');
  process.exit(1);
}

// ── بخشِ سوم: `git fetch`ِ سرور باید اعتبارنامه‌ی خودش را همراه ببرد ───────────
// باگِ واقعیِ ۱۴۰۵/۰۶/۲۱: کلونِ سرور ریموتِ HTTPS دارد و مخزن private است، پس گیت
// پسورد می‌خواهد. تا آن روز هیچ اعتبارنامه‌ای از ران همراه نمی‌رفت و fetch به هرچه
// روی **خودِ سرور** بود تکیه می‌کرد؛ لحظه‌ای که آن از کار افتاد، هر دیپلوی روی
// `fatal: could not read Password` مرد و دو نسخه‌ی مرج‌شده‌ی رباتِ زنده ۲۴ ساعت
// روی سرور ننشستند.
//
// ⚠️ چرا این بخش لازم است با اینکه فیکس مرج شده: خرابی‌اش **از سمتِ ریپو کاملاً
// بی‌صداست**. CI سبز بود، مرج سبز بود، و حتی جابِ Deploy سبز بود — چون بیرونِ
// پنجره‌ی امن مرحله‌ی SSH را `skip` می‌کند و جاب همچنان `success` می‌شود. یعنی
// سبزیِ جابِ Deploy هیچ چیزی درباره‌ی سرور ثابت نمی‌کند. تنها جایی که معلوم
// می‌شود، لاگِ یک رانِ واقعی است که کسی باید بازش کند.
//
// ادعاها عمداً روی **هر حلقه‌ی زنجیره** می‌نشینند، چون شکستنِ هرکدام همان خرابیِ
// بی‌صدا را برمی‌گرداند: توکن در `env:` باشد ولی در `envs:` نه (باگِ ثبت‌شده‌ی
// ۱۱ شهریور)، یا askpass ساخته شود ولی export نشود، یا مجوزِ جاب محدود باشد.
const AUTH_FAILS = [];
const wf = readFileSync('.github/workflows/deploy.yml', 'utf8');

if (!/GH_FETCH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/.test(wf)) {
  AUTH_FAILS.push('`GH_FETCH_TOKEN` در بلوکِ `env:` تعریف نشده');
}
const envsRow = wf.match(/^\s*envs:\s*(.+)$/m)?.[1] || '';
if (!envsRow.split(',').map((x) => x.trim()).includes('GH_FETCH_TOKEN')) {
  AUTH_FAILS.push('`GH_FETCH_TOKEN` در `envs:` نیست — پس روی سرور **خالی** می‌رسد (باگِ ۱۱ شهریور)');
}
if (!/export\s+GIT_ASKPASS="\$GIT_ASKPASS_FILE"/.test(wf)) {
  AUTH_FAILS.push('`GIT_ASKPASS` export نمی‌شود — helperِ ساخته‌شده‌ی بدونِ export یعنی هیچ');
}
if (!/chmod\s+700\s+"\$GIT_ASKPASS_FILE"/.test(wf)) {
  AUTH_FAILS.push('فایلِ askpass اجرایی نمی‌شود — گیت helperِ غیرِاجرایی را **بی‌صدا** نادیده می‌گیرد');
}
if (!/export GIT_TERMINAL_PROMPT=0/.test(wf)) {
  AUTH_FAILS.push('`GIT_TERMINAL_PROMPT=0` نیست — نبودِ اعتبارنامه به‌جای «احراز هویت نشد» می‌شود «No such device or address»');
}
if (!/trap\s+'rm -f "\$GIT_ASKPASS_FILE"'\s+EXIT/.test(wf)) {
  AUTH_FAILS.push('فایلِ askpass پاک نمی‌شود — توکن روی دیسکِ سرور جا می‌ماند');
}

// مجوزِ صریح: توکنِ بی‌مجوز یک رشته‌ی بی‌اثر است، و مجوزِ پیش‌فرض یک تنظیمِ سطحِ
// ریپوست که بیرونِ گیت عوض می‌شود — پس محدودشدنش هیچ دیفی نشان نمی‌دهد.
const deployJob = wf.slice(wf.indexOf('\n  deploy:'), wf.indexOf('\n  deploy-tabir-khab:'));
if (!/^\s{4}permissions:\s*$/m.test(deployJob) || !/^\s{6}contents:\s*read\s*$/m.test(deployJob)) {
  AUTH_FAILS.push('جابِ `deploy` مجوزِ صریحِ `permissions: { contents: read }` ندارد — توکنِ بی‌مجوز بی‌صدا بی‌اثر است');
}

// ⚠️ دو ادعای **معکوس**: توکن نباید ماندگار شود. کلِ ارزشِ این طراحی این است که
// اعتبارنامه با پایانِ جاب باطل شود؛ `remote set-url` با توکن یا
// `credential.helper store` دقیقاً همان وابستگیِ ماندگاری را برمی‌گرداند که این
// فیکس برای حذفش نوشته شد (چیزی که وجود ندارد نمی‌تواند منقضی شود).
if (/git\s+remote\s+set-url[^\n]*GH_FETCH_TOKEN/.test(wf) || /credential\.helper[^\n]*store/.test(wf)) {
  AUTH_FAILS.push('توکن روی دیسکِ سرور ماندگار می‌شود (remote set-url یا credential.helper store)');
}
// و نباید در آرگومانِ گیت بنشیند: آن‌جا در `ps` هر کاربرِ سرور دیده می‌شود.
if (/https:\/\/[^\s"']*\$GH_FETCH_TOKEN@/.test(wf) || /extraheader[^\n]*GH_FETCH_TOKEN/.test(wf)) {
  AUTH_FAILS.push('توکن در URL یا آرگومانِ گیت می‌نشیند — در `ps` سرور دیده می‌شود (askpass دقیقاً برای همین انتخاب شد)');
}

// ── ادعای رفتاری: خودِ helper اجرا می‌شود ────────────────────────────────────
// رجکس فقط می‌گوید «خطی شبیهِ این هست». چیزی که واقعاً اهمیت دارد این است که
// helper با ورودیِ واقعیِ گیت **جوابِ درست** بدهد. یک نقلِ‌قولِ جابه‌جا در آن
// printf کافی است که رشته‌ی خالی برگردد و fetch دوباره بمیرد — بی‌صدا.
const printfLine = wf.split('\n').find((l) => l.includes('GIT_ASKPASS_FILE') && l.includes('printf'));
if (!printfLine) {
  AUTH_FAILS.push('خطِ ساختِ helperِ askpass پیدا نشد');
} else {
  try {
    const script = printfLine.trim().replace(/^printf\s+/, '').replace(/\s*>\s*"\$GIT_ASKPASS_FILE"\s*$/, '');
    // helper را با یک توکنِ ساختگی می‌سازیم و همان دو سؤالی را می‌پرسیم که گیت می‌پرسد.
    const out = execFileSync('sh', ['-c',
      `set -e; f=$(mktemp); printf ${script} > "$f"; chmod 700 "$f"; ` +
      `GH_FETCH_TOKEN=SENTINEL_TOK "$f" "Username for 'https://github.com': "; ` +
      `GH_FETCH_TOKEN=SENTINEL_TOK "$f" "Password for 'https://x@github.com': "; rm -f "$f"`,
    ], { encoding: 'utf8' }).trim().split('\n').map((s) => s.trim());
    if (out[0] !== 'x-access-token') {
      AUTH_FAILS.push(`helperِ askpass برای Username باید «x-access-token» بدهد، داد: «${out[0]}»`);
    }
    if (out[1] !== 'SENTINEL_TOK') {
      AUTH_FAILS.push(`helperِ askpass برای Password باید خودِ توکن را بدهد، داد: «${out[1]}»`);
    }
  } catch (e) {
    AUTH_FAILS.push(`اجرای helperِ askpass شکست خورد: ${e.message.split('\n')[0]}`);
  }
}

if (AUTH_FAILS.length) {
  console.error('❌ زنجیره‌ی احرازِ هویتِ `git fetch`ِ سرور شکسته است:\n');
  for (const f of AUTH_FAILS) console.error(`   • ${f}`);
  console.error('\n   نتیجه: دیپلوی دوباره به اعتبارنامه‌ی سمتِ سرور وابسته می‌شود و روزی که آن از کار');
  console.error('   بیفتد **هر** دیپلوی می‌میرد — بی‌صدا، چون جابِ Deploy در ساعتِ غیرِامن هم سبز است.');
  process.exit(1);
}

console.log(`✅ درختِ کارِ سرور امن است (${scanned} فایلِ سرورمحور + ${chmodTargets.size} هدفِ chmod بررسی شد؛ نه دستورِ کثیف‌کننده‌ای هست نه مودِ ناهم‌خوان) و زنجیره‌ی احرازِ هویتِ fetch سالم است (helper واقعاً اجرا شد).`);
