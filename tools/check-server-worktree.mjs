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

console.log(`✅ درختِ کارِ سرور امن است (${scanned} فایلِ سرورمحور + ${chmodTargets.size} هدفِ chmod بررسی شد؛ نه دستورِ کثیف‌کننده‌ای هست نه مودِ ناهم‌خوان).`);
