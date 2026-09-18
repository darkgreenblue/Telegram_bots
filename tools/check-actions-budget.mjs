#!/usr/bin/env node
// چکِ CI برای دو صرفه‌جوییِ سهمیه‌ی Actions (بند ۳ج ریشه).
//
// چرا این چک لازم است: هر دو صرفه‌جویی **بی‌صدا** می‌میرند. اگر تشخیصِ «مرجِ PR»
// خراب شود، CI فقط چند جابِ اضافه می‌زند و هیچ‌کس خبردار نمی‌شود تا روزی که سهمیه
// وسطِ کار ته بکشد — همان اتفاقی که ۲۹ اوت افتاد و همه‌ی جاب‌ها با `runner_id: 0`
// مردند. درسِ ثبت‌شده‌ی نسخه‌ی اولِ `ci-changed-bots.mjs` هم همین است: یک فیلترِ
// بی‌اثر که کسی اندازه‌اش نگیرد، بدتر از نبودنش است چون خیالِ راحت می‌دهد.
//
// ⚠️ هر دو ادعا **رفتاری**‌اند: خودِ تابعِ تشخیص از سورس import و اجرا می‌شود، و
// گروهِ concurrency روی رویدادهای واقعی ارزیابی می‌شود — نه یک رجکس روی YAML که
// فقط بگوید «کلمه‌اش هست».
import { readFileSync } from 'node:fs';
import { isPrMergePush } from './ci-changed-bots.mjs';

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.error(`  ❌ ${msg}`); } };

const CI = readFileSync('.github/workflows/ci.yml', 'utf8');

console.log('\n💰 سهمیه‌ی Actions — دو صرفه‌جویی که نباید بی‌صدا بمیرند\n');

/* ══ ۱) مرجِ PR ماتریس را دوباره اجرا نمی‌کند ═══════════════════════════ */
console.log('۱) تشخیصِ «این پوش مرجِ یک PR است» (رفتاری)');

// شکل‌های واقعیِ مرج در تاریخچه‌ی همین ریپو — هر دو باید رد شوند.
for (const m of [
  'fix(tarot) v3.78.0: حذفِ پیامِ خودکار (#305)',
  'feat(tarot) v3.75.0: افزایشِ قیمت + دو بسته‌ی تازه (#300)',
  'Merge pull request #230 from darkgreenblue/claude/tarot-bot-support-8c',
]) ok(isPrMergePush('push', m) === true, `مرجِ PR شناخته شد: «${m.slice(0, 44)}…»`);

// پوشِ مستقیم — این‌ها **باید** ماتریس را اجرا کنند. چهار قرمزِ واقعیِ ۲۱ روزِ
// اندازه‌گیری‌شده از همین گروه آمدند، پس این جهتِ ادعا از آن یکی مهم‌تر است.
for (const m of [
  'marketing(tarot): بافرِ ۱۴ روزه‌ی فال',
  'fix(deploy): تاروت بعد از مهاجرت متوقف می‌ماند',
  'ops: اکشنِ daypost برای دیدنِ سلامتِ کرونِ انتشارِ روزانه',
]) ok(isPrMergePush('push', m) === false, `پوشِ مستقیم ماتریس را اجرا می‌کند: «${m.slice(0, 44)}…»`);

// ⚠️ fail-open: هر ابهامی یعنی «مرج نیست» → ماتریسِ کامل.
ok(isPrMergePush('push', '') === false, 'پیامِ خالی → مرج حساب نمی‌شود (fail-open)');
ok(isPrMergePush('push', undefined) === false, 'پیامِ نبوده → مرج حساب نمی‌شود (fail-open)');
ok(isPrMergePush('pull_request', 'چیزی (#305)') === false, 'روی خودِ PR هرگز رد نمی‌شود');
ok(isPrMergePush('schedule', 'چیزی (#305)') === false, 'روی cron هرگز رد نمی‌شود');
ok(isPrMergePush('workflow_dispatch', 'چیزی (#305)') === false, 'روی اجرای دستی هرگز رد نمی‌شود');

// ⚠️ فقط خطِ اول — همان درسِ گیتِ پنجره‌ی دیپلوی: بدنه‌ی کامیت پر از نقلِ‌قول است و
// یک PR که همین مکانیزم را مستند می‌کند نباید خودش را خاموش کند.
ok(isPrMergePush('push', 'fix: یک چیز\n\nاین کار مثلِ مرجِ (#305) رفتار می‌کند') === false,
  'ذکرِ «(#305)» در **بدنه** تشخیص را فریب نمی‌دهد (فقط خطِ اول)');
ok(isPrMergePush('push', 'refactor: شماره‌ی (#12) را جابه‌جا کن، بعد تست') === false,
  'شماره‌ی PR وسطِ جمله مرج حساب نمی‌شود (باید انتهای خط باشد)');

// و ورک‌فلو واقعاً پیام را پاس می‌دهد — وگرنه تابع همیشه خالی می‌گیرد و بی‌اثر است
// (دقیقاً همان «گاردِ آینه‌ای» که در بند ۶ب ریشه هشدار داده شده).
ok(/HEAD_COMMIT_MSG:\s*\$\{\{\s*github\.event\.head_commit\.message\s*\}\}/.test(CI),
  'ci.yml پیامِ کامیت را به اسکریپت پاس می‌دهد');
// و هیچ‌جای `run:` پیامِ کامیت را مستقیم interpolate نمی‌کند — پیامِ کامیت ورودیِ
// کاربر است و درجا گذاشتنش در shell همان تزریقی است که بند ۹ ریشه ممنوع کرده.
const msgLines = CI.split('\n').filter((l) => /github\.event\.head_commit\.message/.test(l));
ok(msgLines.length > 0 && msgLines.every((l) => /^\s+[A-Z_]+:\s*\$\{\{/.test(l)),
  'و فقط به‌عنوانِ مقدارِ یک متغیرِ env می‌آید، نه داخلِ `run:` (ضدِ تزریق، بند ۹ ریشه)');

/* ══ ۲) اجرای منسوخ‌شده‌ی PR لغو می‌شود ═════════════════════════════════ */
console.log('\n۲) concurrency — فقط روی PR لغو می‌کند، هرگز روی main');
const blk = /\nconcurrency:\n((?:[ \t]+.*\n)+)/.exec(CI);
ok(!!blk, 'بلوکِ concurrency در ci.yml هست');
const group = /group:\s*(.+)/.exec(blk?.[1] || '')?.[1] || '';
const cancel = /cancel-in-progress:\s*(.+)/.exec(blk?.[1] || '')?.[1] || '';

// ارزیابیِ واقعیِ عبارتِ گیت‌هاب روی هر دو رویداد (نه فقط «رشته‌اش هست»).
const evalExpr = (expr, ctx) => {
  const body = expr.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) =>
    '" + (' + e.replace(/'/g, '"').replace(/\bgithub\./g, 'github.') + ') + "');
  // eslint-disable-next-line no-new-func
  return new Function('github', `return "${body}";`)(ctx);
};
const pr   = { event_name: 'pull_request', ref: 'refs/pull/305/merge', run_id: '1' };
const push = { event_name: 'push',         ref: 'refs/heads/main',     run_id: '999' };
const pr2  = { event_name: 'pull_request', ref: 'refs/pull/306/merge', run_id: '2' };

ok(String(evalExpr(cancel, pr)).includes('true'), 'روی PR لغوِ اجرای قبلی روشن است');
ok(String(evalExpr(cancel, push)).includes('false'), '🔒 روی push به main لغو **خاموش** است');
ok(evalExpr(group, pr) !== evalExpr(group, pr2), 'دو PR هم‌زمان گروهِ جدا دارند (هم‌دیگر را نمی‌کشند)');
ok(evalExpr(group, push) !== evalExpr(group, { ...push, run_id: '1000' }),
  '🔒 هر پوشِ main گروهِ یکتای خودش را دارد (هیچ کامیتی بی‌چک نمی‌ماند)');

/* ⚠️ چرا لغو روی main ممنوع است و این ادعا جدی است: دو مرجِ نزدیک‌به‌هم عادی است
 * (۲۰ ثانیه فاصله، باگِ ثبت‌شده‌ی ۱۶ شهریور). با لغوِ روشن، چکِ کامیتِ اول نصفه
 * کشته می‌شد و آن کامیت **بدونِ هیچ CI ای** روی main می‌ماند. */

/* ۳) بودجه‌ی **کرون‌ها** — تنها مصرفی که بدونِ هیچ اقدامِ انسانی هر روز می‌سوزد.
 *
 * ۱۴۰۵/۰۶/۲۶: ایمیلِ گیت‌هاب اعلام کرد ۹۰٪ سهمیه (۱۸۰۰ از ۲۰۰۰ دقیقه) مصرف شده و
 * ۱۴ روز تا ریست مانده. اندازه‌گیریِ ساختاریِ همان روز نشان داد **فقط کرون‌ها** ۹
 * جاب در روز می‌خوردند — ۱۲۶ جاب در آن ۱۴ روز، پیش از اینکه حتی یک مرج بخورد:
 *   Health هر ۶ ساعت × ۱ جاب = ۴/روز   ·   Deploy ۲ کرون × ۲ جاب = ۴/روز   ·   Backup ۱/روز
 * حالا: Health هر ۱۲ ساعت = ۲/روز · Deploy ۱ کرون × ۱ جاب = ۱/روز · Backup ۱/روز ⟵ ۴/روز.
 *
 * این ادعاها عمداً **عددِ سقف** دارند نه «برابرِ فلان»: بالا بردنِ تعدادِ کرون یا
 * برگرداندنِ جابِ دوم باید یک تصمیمِ صریح با دیدنِ همین عدد باشد، نه یک تغییرِ
 * بی‌صدا که ماهِ بعد سهمیه را دوباره ته می‌کشد. */
console.log('\n۳) بودجه‌ی کرون‌ها (جابِ تضمینیِ روزانه)');
const wf = (n) => readFileSync(`.github/workflows/${n}`, 'utf8');
const jobsOf = (src) => (src.slice(src.indexOf('\njobs:\n')).match(/^  [a-zA-Z0-9_-]+:$/gm) || []).length;
const cronsOf = (src) => (src.match(/- cron: '([^']+)'/g) || []).map((s) => s.slice(9, -1));

const HEALTH = wf('health.yml');
const DEPLOY = wf('deploy.yml');
const BACKUP = wf('backup.yml');

// «هر N ساعت» را به تعداد اجرا در روز تبدیل می‌کند. فقط شکلِ گامی (ستاره اسلش N) و
// فهرستِ ساعتِ ثابت را می‌فهمد؛ شکلِ ناشناخته عمداً **بدبینانه** ۲۴ حساب می‌شود تا
// یک کرونِ عجیب بی‌صدا از سقف رد نشود.
// ⚠️ کامنتِ خطی است نه بلوکی، و این عمدی است: نوشتنِ الگوی گامیِ کرون داخلِ کامنتِ
// بلوکی خودِ کامنت را می‌بندد و فایل با یک SyntaxError مبهم می‌ترکد (همین‌جا رخ داد).
const perDay = (cron) => {
  const h = cron.split(/\s+/)[1] ?? '*';
  if (h === '*') return 24;
  const m = /^\*\/(\d+)$/.exec(h);
  if (m) return Math.floor(24 / Number(m[1]));
  if (/^\d+(,\d+)*$/.test(h)) return h.split(',').length;
  return 24;
};
const dailyJobs = (src) => cronsOf(src).reduce((s, c) => s + perDay(c) * jobsOf(src), 0);

const hJ = dailyJobs(HEALTH), dJ = dailyJobs(DEPLOY), bJ = dailyJobs(BACKUP);
ok(jobsOf(DEPLOY) === 1, `Deploy یک جاب دارد نه دو تا (tabir استپ است، نه رانرِ جدا) — دیده شد ${jobsOf(DEPLOY)}`);
ok(cronsOf(DEPLOY).length === 1, `Deploy یک کرون دارد — دیده شد ${cronsOf(DEPLOY).length}`);
ok(hJ <= 2, `Health حداکثر ۲ جابِ کرونی در روز — دیده شد ${hJ}`);
ok(dJ <= 1, `Deploy حداکثر ۱ جابِ کرونی در روز — دیده شد ${dJ}`);
ok(bJ <= 1, `Backup حداکثر ۱ جابِ کرونی در روز — دیده شد ${bJ}`);
ok(hJ + dJ + bJ <= 4,
  `کلِ بارِ کرونیِ ریپو ≤۴ جاب در روز (~۱۲۰ در ماه، ۶٪ سهمیه) — دیده شد ${hJ + dJ + bJ}`);

/* کنترلِ مثبت (بند ۶ب-۲): اگر `perDay`/`jobsOf` خراب شوند و همیشه عددِ کوچک بدهند،
 * همه‌ی ادعاهای بالا بی‌صدا سبز می‌مانند. پس ثابت می‌کنیم روی نقضِ **شناخته‌شده**
 * (دقیقاً پیکربندیِ دیروز) واقعاً عددِ بزرگ درمی‌آید. */
const YESTERDAY_HEALTH = HEALTH.replace("17 */12 * * *", "17 */6 * * *");
ok(dailyJobs(YESTERDAY_HEALTH) === 4, 'کنترل: با کرونِ ۶ساعتیِ دیروز، شمارنده ۴ می‌دهد نه ۲');
ok(perDay('35 4 * * *') === 1 && perDay('17 */12 * * *') === 2 && perDay('0 * * * *') === 24,
  'کنترل: شمارنده‌ی «چند بار در روز» روی هر سه شکل درست است');

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
