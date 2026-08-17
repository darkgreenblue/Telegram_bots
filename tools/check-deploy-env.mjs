#!/usr/bin/env node
// چکِ «دیپلوی نباید ربات را بی‌دلیل ری‌استارت کند».
//
// چرا وجود دارد: بندِ ۳ قول می‌دهد merge ای که به یک ربات ربطی ندارد بقیه را
// ری‌استارت نکند، و بندِ ۲ج (قانون ۲) می‌گوید هر ری‌استارت یعنی مرگِ فلوهای
// in-memory وسط کار. ولی در عمل **هر** دیپلوی هر دو رباتِ زنده را ری‌استارت
// می‌کرد (لاگ: «✅ tarot دیپلوی شد (دلیل: env)» روی PRی که فقط مستندات داشت).
// علت: پینگ‌پنگ بینِ دو بلوکِ deploy.yml —
//   ۱) write_env فایلِ .env را از Secrets می‌سازد **بدونِ** ADMIN_IDS
//      → با فایلِ روی دیسک (که دارد) فرق می‌کند → ENV_CHANGED
//   ۲) بلوکِ upsert دوباره ADMIN_IDS را می‌گذارد → ENV_CHANGED
// یعنی دو منبعِ حقیقت برای محتوای .env که هرگز به هم نمی‌رسند.
//
// روش: قطعه‌ی واقعیِ shell را **از خودِ deploy.yml** بیرون می‌کشد (نه کپی، تا
// drift نکند)، با مقادیرِ ساختگی دو دیپلویِ پشت‌سرهم را شبیه‌سازی می‌کند و
// انتظار دارد دورِ دوم هیچ ENV_CHANGED ای نداشته باشد. اگر کسی دوباره منبعِ
// دوم بسازد، این چک قرمز می‌شود.

import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const yml = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');

// قطعه‌ی «ساخت .env + ادمین یکپارچه» را از deploy.yml بیرون بکش
const START = 'ENV_CHANGED=""';
const END = '# ---------- دیپلوی انتخابی';
const a = yml.indexOf(START);
const b = yml.indexOf(END, a);
if (a === -1 || b === -1) {
  console.error('❌ قطعه‌ی .env در deploy.yml پیدا نشد — اگر ساختار عوض شده، این چک را هم به‌روز کن.');
  process.exit(1);
}
const indent = yml.slice(yml.lastIndexOf('\n', a) + 1, a);
const fragment = yml.slice(a, b)
  .split('\n')
  .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
  .join('\n');

// چیزهایی که قطعه باید داشته باشد، وگرنه داریم چیزِ اشتباهی را تست می‌کنیم
for (const must of ['write_env()', 'ADMIN_IDS', 'cmp -s']) {
  if (!fragment.includes(must)) {
    console.error(`❌ قطعه‌ی استخراج‌شده «${must}» ندارد — مرزهای استخراج را چک کن.`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'deploy-env-'));
let fails = 0;
const chk = (name, got, want) => {
  if (got === want) console.log(`  ✅ ${name}`);
  else { console.error(`  ❌ ${name} — انتظار «${want}» شد «${got}»`); fails++; }
};

// یک «دیپلوی» را در پوشه‌ی داده‌شده اجرا می‌کند و ENV_CHANGED را برمی‌گرداند
function round(cwd, env) {
  const script = `
set -e
cd "${cwd}"
${fragment}
printf 'ENV_CHANGED=[%s]\\n' "\${ENV_CHANGED# }"
`;
  const f = join(dir, 'round.sh');
  writeFileSync(f, script);
  const out = execFileSync('bash', [f], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
  return (out.match(/ENV_CHANGED=\[(.*)\]/) || [, '?'])[1];
}

const SECRETS = {
  OWNER_TELEGRAM_ID: '111,222',
  VOICE2TEXT_BOT_TOKEN: 'vtok', VOICE2TEXT_OPENROUTER_KEY: 'vkey', VOICE2TEXT_NOTION_TOKEN: '',
  TAROT_BOT_TOKEN: 'tok', TAROT_OPENROUTER_KEY: 'key',
  // daily-brief عمداً با کلیدهای اختیاریِ **ست‌شده** تست می‌شود: بلوکِ .envِ آن دو خطِ شرطی
  // (Notion و ElevenLabs) دارد و دقیقاً همین شکل است که اگر بیرونِ write_env نوشته شود،
  // هر دیپلوی را به پینگ‌پنگِ ری‌استارت تبدیل می‌کند.
  DAILY_BRIEF_BOT_TOKEN: 'dtok2', DAILY_BRIEF_OPENROUTER_KEY: 'dkey2',
  DAILY_BRIEF_NOTION_TOKEN: 'ntok',
  DASHBOARD_TOKEN: 'dtok',
  RESUME_TAILOR_BOT_TOKEN: '', RESUME_TAILOR_OPENROUTER_KEY: '',
};

function fresh(name) {
  const d = join(dir, name);
  mkdirSync(join(d, 'bots'), { recursive: true });
  return d;
}

console.log('چکِ «دیپلوی بی‌دلیل ری‌استارت نکند»:');

// ۱) سرور تازه: دورِ اول .env می‌سازد، دورِ دوم باید کاملاً ساکت باشد
{
  const d = fresh('newserver');
  const first = round(d, SECRETS);
  chk('سرور تازه: دورِ اول .env ها را می‌سازد', first !== '', true);
  chk('سرور تازه: دورِ دوم هیچ ری‌استارتی نمی‌دهد', round(d, SECRETS), '');
  chk('سرور تازه: دورِ سوم هم نه', round(d, SECRETS), '');
  const tarotEnv = readFileSync(join(d, 'bots/tarot/.env'), 'utf8');
  chk('ADMIN_IDS در .envِ tarot نوشته شده', /^ADMIN_IDS=111,222$/m.test(tarotEnv), true);
  const dashEnv = readFileSync(join(d, 'bots/dashboard/.env'), 'utf8');
  chk('dashboard ADMIN_IDS نمی‌گیرد', /ADMIN_IDS/.test(dashEnv), false);
  const dlbEnv = readFileSync(join(d, 'bots/daily-brief/.env'), 'utf8');
  chk('daily-brief کلیدِ اختیاریِ Notion را می‌گیرد', /^NOTION_TOKEN=ntok$/m.test(dlbEnv), true);
  chk('daily-brief ADMIN_IDS می‌گیرد (وگرنه مالک پشتِ گیتِ خودش می‌ماند)',
    /^ADMIN_IDS=111,222$/m.test(dlbEnv), true);
}

// ۱ب) کلیدِ اختیاریِ ست‌نشده هم نباید پینگ‌پنگ بسازد (بلوکِ شرطی درست جای خودش است)
{
  const d = fresh('optionalkeys');
  const noOpt = { ...SECRETS, DAILY_BRIEF_NOTION_TOKEN: '' };
  round(d, noOpt);
  chk('daily-brief بدونِ کلیدِ اختیاری هم در دورِ دوم ساکت است', round(d, noOpt), '');
  const env = readFileSync(join(d, 'bots/daily-brief/.env'), 'utf8');
  chk('کلیدِ اختیاریِ ست‌نشده اصلاً در .env نمی‌آید', /NOTION_TOKEN/.test(env), false);
  // و اضافه‌شدنِ بعدیِ همان کلید باید ری‌استارت بدهد (وگرنه Secret تازه بی‌اثر می‌ماند)
  chk('اضافه‌شدنِ کلیدِ Notion ری‌استارت می‌دهد',
    round(d, { ...noOpt, DAILY_BRIEF_NOTION_TOKEN: 'ntok' }).includes('daily-brief'), true);
}

// ۲) تغییرِ واقعیِ Secret باید ری‌استارت بدهد (وگرنه ویرایشِ Secret بی‌اثر می‌ماند)
{
  const d = fresh('secretchange');
  round(d, SECRETS);
  round(d, SECRETS);
  const changed = round(d, { ...SECRETS, OWNER_TELEGRAM_ID: '111,222,333' });
  chk('تغییرِ OWNER_TELEGRAM_ID ری‌استارت می‌دهد', changed.includes('tarot'), true);
  chk('و بعدش دوباره ساکت می‌شود', round(d, { ...SECRETS, OWNER_TELEGRAM_ID: '111,222,333' }), '');
  const changed2 = round(d, { ...SECRETS, OWNER_TELEGRAM_ID: '111,222,333', TAROT_BOT_TOKEN: 'newtok' });
  chk('تغییرِ توکنِ ربات هم ری‌استارت می‌دهد', changed2.includes('tarot'), true);
}

// ۳) .envِ دستیِ سرور بدونِ Secret — قانونِ «voice2text نشکند»
{
  const d = fresh('manualenv');
  mkdirSync(join(d, 'bots/voice2text'), { recursive: true });
  writeFileSync(join(d, 'bots/voice2text/.env'), 'BOT_TOKEN=manual\nOPENROUTER_API_KEY=manual\nGAPGPT_API_KEY=extra\n');
  const noV2T = { ...SECRETS, VOICE2TEXT_BOT_TOKEN: '', VOICE2TEXT_OPENROUTER_KEY: '' };
  round(d, noV2T);
  const env = readFileSync(join(d, 'bots/voice2text/.env'), 'utf8');
  chk('.envِ دستی: ADMIN_IDS اضافه شد', /^ADMIN_IDS=111,222$/m.test(env), true);
  chk('.envِ دستی: کلیدِ اضافیِ سرور دست نخورد', /^GAPGPT_API_KEY=extra$/m.test(env), true);
  chk('.envِ دستی: توکنِ دستی بازنویسی نشد', /^BOT_TOKEN=manual$/m.test(env), true);
  chk('.envِ دستی: دیپلویِ بعدی ری‌استارت نمی‌دهد', round(d, noV2T), '');
}

rmSync(dir, { recursive: true, force: true });

if (fails) {
  console.error(`\n❌ ${fails} خطا. اگر «دورِ دوم ری‌استارت می‌دهد» قرمز است، یعنی دوباره دو منبعِ حقیقت برای محتوای .env ساخته شده.`);
  process.exit(1);
}
console.log('\n✅ دیپلوی idempotent است — بدون تغییرِ واقعی، هیچ رباتی ری‌استارت نمی‌شود.');
