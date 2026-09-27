#!/usr/bin/env node
/* گاردِ «مبنای تشخیصِ تغییرِ دیپلوی = آخرین دیپلویِ موفق، نه HEADِ سرور».
 *
 * 🐛 باگی که این فایل را ساخت (۱۴۰۵/۰۷/۰۵): کرونِ ساعتیِ `vps-daily-post.sh` سرِ دقیقه‌ی ۳۰
 * `git pull` می‌زند و HEADِ کلونِ سرور را بدونِ هیچ ری‌استارتی جلو می‌برد. مرجِ #415 ساعتِ
 * 12:30:01 UTC خورد؛ کرون همان دقیقه pull کرد و دیپلوی ۳۰ ثانیه بعد دیفِ `OLD_HEAD..NEW_HEAD`
 * را **خالی** دید ⟵ «⏭ tarot بدون تغییر» ⟵ ربات کدِ قدیمی را اجرا می‌کرد، در حالی که جاب،
 * مرحله‌ی SSH و گاردِ ضربان همه سبز بودند. همین برای هر مرجِ به‌تعویق‌افتاده هم برقرار بود:
 * تا دیپلویِ صبح، کرون حتماً pull کرده است.
 *
 * چرا رفتاری: رجکسِ «DEPLOYED_FILE در فایل هست» آینه‌ی خودش است (بند ۶ب ریشه). پس همان
 * تکه‌ی شلِ بینِ نشانگرهای `deploy-baseline` و `deploy-mark` از خودِ ورک‌فلو بریده و روی یک
 * مخزنِ گیتِ واقعی اجرا می‌شود، با دقیقاً سناریوی پروداکشن.
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const WF = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

/** تکه‌ی بینِ `# >>> name` و `# <<< name`، با تورفتگیِ YAML برداشته. */
function region(src, name) {
  const lines = src.split('\n');
  const a = lines.findIndex((l) => l.trim() === `# >>> ${name}`);
  const b = lines.findIndex((l) => l.trim() === `# <<< ${name}`);
  if (a < 0 || b < a) return null;
  return lines.slice(a + 1, b).map((l) => l.replace(/^ {12}/, '')).join('\n');
}

console.log('— ساختار');
const BASE_SNIP = region(WF, 'deploy-baseline');
const MARK_SNIP = region(WF, 'deploy-mark');
ok(BASE_SNIP, 'نشانگرهای deploy-baseline در deploy.yml هست');
ok(MARK_SNIP, 'نشانگرهای deploy-mark در deploy.yml هست');
if (!BASE_SNIP || !MARK_SNIP) { console.error(`\n❌ ${errs.length} خطا`); process.exit(1); }

const lines = WF.split('\n');
const idx = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
const baseAt = idx(/# >>> deploy-baseline/);
const markAt = idx(/# >>> deploy-mark/);
const firstUse = idx(/\$CHANGED_FILES|"\$CHANGED_FILES"/, baseAt + 1);
ok(!/CHANGED_FILES=/.test(lines.slice(0, baseAt).join('\n')), 'CHANGED_FILES قبل از بلوکِ مبنا تعریف نمی‌شود');
ok((lines.slice(markAt + 1).join('\n').match(/CHANGED_FILES=/g) || []).length === 0, 'CHANGED_FILES بعد از بلوکِ مبنا دوباره تعریف نمی‌شود');
ok(firstUse > baseAt, 'اولین استفاده‌ی CHANGED_FILES بعد از بلوکِ مبناست');
// مهر باید بعد از **همه‌ی** گاردهای شکست‌دهنده‌ی اسکریپتِ SSH بنشیند.
const sshEnd = idx(/^\s+pm2 ls\s*$/, markAt);
const lastExit1 = lines.slice(0, sshEnd).reduce((m, l, i) => (/exit 1/.test(l) ? i : m), -1);
const lastDeployBot = lines.slice(0, sshEnd).reduce((m, l, i) => (/^\s+deploy_bot \S/.test(l) ? i : m), -1);
ok(markAt > lastExit1, 'مهر بعد از آخرین `exit 1` نوشته می‌شود (دیپلویِ شکست‌خورده مهر را جلو نمی‌برد)');
ok(markAt > lastDeployBot, 'مهر بعد از آخرین deploy_bot نوشته می‌شود');
ok((WF.match(/> "\$DEPLOYED_FILE"/g) || []).length === 1, 'فقط یک نقطه روی فایلِ مهر می‌نویسد');
ok(!/\$HOME\/voice2text|~\/voice2text/.test(BASE_SNIP) && /\$HOME\//.test(BASE_SNIP),
  'فایلِ مهر بیرونِ کلونِ ریپوست (درختِ سرور کثیف نمی‌شود)');

console.log('— رفتار (مخزنِ گیتِ واقعی)');
const T = mkdtempSync(join(tmpdir(), 'deploy-base-'));
const repo = join(T, 'repo'); const home = join(T, 'home');
mkdirSync(repo); mkdirSync(home);
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
mkdirSync(join(repo, 'bots/tarot'), { recursive: true });
writeFileSync(join(repo, 'README.md'), 'a\n'); git('add', '.'); git('commit', '-qm', 'A');
const A = git('rev-parse', 'HEAD');
writeFileSync(join(repo, 'bots/tarot/index.js'), 'b\n'); git('add', '.'); git('commit', '-qm', 'B');
const B = git('rev-parse', 'HEAD');

function run(snip, env) {
  const raw = execFileSync('bash', ['-e', '-c', `${snip}\nprintf '@@CF@@%s' "$CHANGED_FILES"`], {
    cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, ...env },
  });
  return raw.slice(raw.indexOf('@@CF@@') + 6);   // فقط خودِ CHANGED_FILES، نه پیام‌های echo
}
const markFile = join(home, '.deploy-last-sha');

// ۱) سناریوی پروداکشن: آخرین دیپلو A بود، کرون HEAD را تا B جلو برد، دیپلو HEAD=B را می‌بیند.
writeFileSync(markFile, `${A}\n`);
let out = run(BASE_SNIP, { OLD_HEAD: B, NEW_HEAD: B });
ok(out.split('\n').includes('bots/tarot/index.js'), 'HEADِ جلورفته با کرون: تغییرِ tarot دیده می‌شود (باگِ #415)');
// کنترلِ مثبت: منطقِ قدیمی (مبنا = HEADِ سرور) در همین سناریو کور است.
out = run('CHANGED_FILES=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD" || echo "")', { OLD_HEAD: B, NEW_HEAD: B });
ok(out === '', 'کنترلِ مثبت: منطقِ قدیمی همین سناریو را خالی می‌بیند (سناریو واقعاً باگ را بازتولید می‌کند)');

// ۲) بدونِ مهر (اولین اجرا) ⟵ رفتارِ قبلی.
rmSync(markFile);
out = run(BASE_SNIP, { OLD_HEAD: A, NEW_HEAD: B });
ok(out.split('\n').includes('bots/tarot/index.js'), 'بدونِ مهر: مبنا HEADِ سرور (رفتارِ قبلی)');
out = run(BASE_SNIP, { OLD_HEAD: B, NEW_HEAD: B });
ok(out === '', 'بدونِ مهر و بدونِ تغییر: خالی (ری‌استارتِ بی‌دلیل نمی‌سازد)');

// ۳) مهرِ خراب یا کامیتِ ناموجود ⟵ رفتارِ قبلی، نه خطا.
writeFileSync(markFile, 'garbage');
out = run(BASE_SNIP, { OLD_HEAD: A, NEW_HEAD: B });
ok(out.split('\n').includes('bots/tarot/index.js'), 'مهرِ خراب: به HEADِ سرور برمی‌گردد و نمی‌میرد');
writeFileSync(markFile, 'f'.repeat(40));
out = run(BASE_SNIP, { OLD_HEAD: A, NEW_HEAD: B });
ok(out.split('\n').includes('bots/tarot/index.js'), 'مهرِ کامیتِ ناموجود: به HEADِ سرور برمی‌گردد');

// ۴) مهرِ به‌روز ⟵ دیفِ خالی (دیپلویِ دوباره‌ی همان کامیت چیزی را ری‌استارت نمی‌کند).
writeFileSync(markFile, B);
out = run(BASE_SNIP, { OLD_HEAD: B, NEW_HEAD: B });
ok(out === '', 'مهر = HEAD: هیچ تغییری (دیپلوی‌های پشت‌سرهم ساکت‌اند)');

// ۵) نوشتنِ مهر.
rmSync(markFile);
execFileSync('bash', ['-e', '-c', `DEPLOYED_FILE="$HOME/.deploy-last-sha"\n${MARK_SNIP}`], {
  cwd: repo, env: { PATH: process.env.PATH, HOME: home, NEW_HEAD: B },
});
ok(existsSync(markFile) && readFileSync(markFile, 'utf8').trim() === B, 'بلوکِ مهر دقیقاً NEW_HEAD را می‌نویسد');

rmSync(T, { recursive: true, force: true });

if (errs.length) { console.error(`\n❌ ${errs.length} خطا:\n - ${errs.join('\n - ')}`); process.exit(1); }
console.log(`\n✅ check-deploy-baseline: ${pass} ادعا سبز`);
