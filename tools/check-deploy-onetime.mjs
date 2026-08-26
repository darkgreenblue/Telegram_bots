#!/usr/bin/env node
// 🛑 گاردِ «هیچ مسیرِ دیپلویی نباید رباتِ زنده را در هر اجرا بخواباند»
//
// ── باگِ واقعی که این چک از آن آمد (۴ شهریور ۱۴۰۵) ─────────────────────────────
// بلوکِ یک‌باره‌ی «مهاجرتِ الماسِ بومی» در `deploy.yml` این شکل بود:
//
//     if [ -f bots/tarot/.env ]; then
//       pm2 stop tarot
//       node tools/coins-native-tarot.mjs bots/tarot/data --apply   # خودش idempotent
//     fi
//
// خودِ مهاجرت idempotent بود و بعد از اولین اجرا بی‌صدا رد می‌شد. ولی **شرطِ بلوک**
// idempotent نبود: `[ -f bots/tarot/.env ]` در هر دیپلوی درست است، پس `pm2 stop tarot`
// در **هر مرج** اجرا می‌شد و `deploy_bot` فقط وقتی برش می‌گرداند که کدِ همان ربات عوض
// شده باشد. یعنی یک مرجِ صرفاً مستنداتی هم رباتِ زنده‌ی درآمدزا را می‌خواباند.
//
// ── چرا denylist و نه allowlist ───────────────────────────────────────────────
// نسخه‌ی اولِ همین چک allowlist بود: «سایت‌های توقف را پیدا کن، بعد ببین شرطشان قبول
// است یا نه». ریویوِ خصمانه سه راهِ **نامرئی شدن** پیدا کرد که همگی از خودِ باگ بدتر
// بودند، چون اصلاً به شمارش نمی‌آمدند و چک سبز می‌ماند:
//     pm2 stop all                       ← هدف در لیستِ ربات‌های زنده نبود، پس رد شد
//     for b in ...; do pm2 stop "$b"      ← `$` در الگوی هدف نبود
//     pm2 stop ecosystem.config.cjs --only tarot
// حالا قاعده برعکس است: **هر** `pm2 stop|delete|kill` دیده می‌شود و هدفی که یک نامِ
// ادبی و شناخته‌شده نباشد **خودش خطاست** («حدس نمی‌زنم»). فقط ربات‌های بازنشسته‌ی
// `SAFE_TARGETS` بدونِ بررسی رد می‌شوند.
//
// ── شرطِ قابلِ قبول برای خواباندنِ رباتِ زنده ──────────────────────────────────
// شرط باید **بعد از انجامِ کار false شود**. دو شکل پذیرفته است:
//   ۱) تستِ نبودنِ مارکر:  `[ ! -f <path> ]`
//   ۲) متغیری که از یک **کاوش** پر شده:  `NEED=0; if <cmd>; then NEED=1; fi`
// شرطی مثل `[ -f ... ]` یا `pm2 jlist | grep -q tarot` قبول **نیست**: هر دو در هر
// اجرا درست‌اند. (الگوی ۲ همان بلوکِ مونوریپوی voice2text است.)
//
// اجرا: node tools/check-deploy-onetime.mjs
import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';

/** هر مسیری که می‌تواند روی سرور اجرا شود و به pm2 دست بزند. */
export const SCANNED = [
  { file: '.github/workflows/deploy.yml', kind: 'yaml' },
  { file: 'tools/manual-deploy.sh', kind: 'shell' },
];

/** ربات‌هایی که خواباندنشان به کاربرِ واقعی آسیب می‌زند (بند ۲ج ریشه). */
export const LIVE_BOTS = ['voice2text', 'tarot'];

/** هدف‌هایی که خواباندنشان بی‌خطر است — بازنشسته یا ابزارِ داخلی. */
export const SAFE_TARGETS = ['resume-tailor'];

/** اسکریپت‌های یک‌باره‌ای که اجرا و مهر خورده‌اند و نباید از هیچ مسیرِ دیپلویی صدا شوند. */
export const RETIRED_ONETIME = [
  'tools/coins-native-tarat.mjs'.replace('tarat', 'tarot'),
  'tools/coin-migration-tarot.mjs',
  'tools/launch-wipe-tarot.mjs',
  'tools/goodwill-credit-tarot.mjs',
  'tools/welcome-bonus-backfill-tarot.mjs',
];

/** بدنه‌ی شل را از YAML بیرون می‌کشد — هم `script: |` و هم `run: |`. */
export function shellBody(text, kind) {
  if (kind === 'shell') return text.split('\n');
  const out = [];
  const lines = text.split('\n');
  let inBlock = false;
  let indent = 0;
  for (const raw of lines) {
    if (!inBlock) {
      const m = raw.match(/^(\s*)(?:-\s+)?(?:script|run):\s*\|/);
      if (m) { inBlock = true; indent = m[1].length; }
      continue;
    }
    if (raw.trim() === '') { out.push(''); continue; }
    const cur = raw.match(/^\s*/)[0].length;
    if (cur <= indent) { inBlock = false; continue; }
    out.push(raw);
  }
  return out;
}

const stripComment = (s) => s.replace(/\s+#.*$/, '').trim();

/**
 * زنجیره‌ی شرط‌های `if` که یک خط را در بر گرفته‌اند، با ردیابیِ تورفتگی.
 * `else`/`elif` عمداً «بدونِ شرط» گزارش می‌شود: بلوکِ یک‌باره در شاخه‌ی else یعنی
 * «کار قبلاً انجام شده»، که دقیقاً جایی است که **نباید** ربات را بخوابانیم.
 */
export function enclosingConditions(lines, idx) {
  const conds = [];
  let floor = lines[idx].match(/^\s*/)[0].length;
  for (let i = idx - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const ind = line.match(/^\s*/)[0].length;
    if (ind >= floor) continue;
    if (/^\s*(else|elif)\b/.test(line)) { conds.push('__ELSE__'); floor = ind; continue; }
    const m = line.match(/^\s*if\s+(.*?)(?:;\s*then)?\s*$/);
    if (m) { conds.push(stripComment(m[1])); floor = ind; continue; }
    floor = Math.min(floor, ind);
  }
  const inline = lines[idx].match(/^\s*if\s+(.*?);\s*then\s+/);
  if (inline) conds.push(stripComment(inline[1]));
  return conds;
}

/** متغیرهایی که از یک کاوشِ واقعی پر شده‌اند (`VAR=0` … `if <cmd>; then VAR=1`). */
export function probeVars(lines) {
  const found = new Set();
  for (const line of lines) {
    const m = line.match(/^\s*if\s+.*;\s*then\s+([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m) found.add(m[1]);
  }
  return found;
}

/** آیا این شرط بعد از انجامِ کار false می‌شود؟ */
export function isOneTimeGuarded(conds, probes) {
  if (!conds.length) return false;
  if (conds.includes('__ELSE__')) return false;
  return conds.some(c => {
    if (/\[\s*!\s+-[fd]\s/.test(c)) return true;                 // تستِ نبودنِ مارکر
    const vars = [...c.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)].map(m => m[1]);
    return vars.some(v => probes.has(v));                         // متغیرِ کاوش‌شده
  });
}

/**
 * هدفِ یک فرمانِ pm2 را طبقه‌بندی می‌کند.
 * خروجی: {kind:'live'|'safe'|'unknown', target}
 */
export function classifyTarget(rest) {
  // ترتیب مهم است: اول کامنت، بعد پایانِ فرمان (`;` یا `||`/`&&`)، بعد ریدایرکت.
  // بدونِ بریدنِ `;` هدفِ `pm2 stop tarot; fi` می‌شد «tarot;» و به‌عنوان نامِ ناشناخته
  // رد می‌شد — یعنی یک false red روی الگوی کاملاً درست (خودِ فیکسچرها گرفتندش).
  const cleaned = stripComment(rest)
    .split(';')[0]
    .replace(/\s*(\|\||&&).*$/, '')
    .replace(/\s+\d?[<>]+\S*/g, '')
    .trim();
  const only = cleaned.match(/--only\s+(\S+)/);
  const word = only ? only[1] : cleaned.split(/\s+/)[0] || '';
  const bare = word.replace(/^["']|["']$/g, '');
  if (LIVE_BOTS.includes(bare)) return { kind: 'live', target: bare };
  if (SAFE_TARGETS.includes(bare)) return { kind: 'safe', target: bare };
  return { kind: 'unknown', target: bare || '(هیچ)' };
}

/** هر فرمانی که یک پروسه‌ی pm2 را می‌خواباند. */
export function stopSites(lines) {
  const hits = [];
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/pm2\s+(stop|delete|kill)\b(.*)$/);
    if (!m) return;
    hits.push({ i, line: line.trim(), verb: m[1], ...classifyTarget(m[2]) });
  });
  return hits;
}

/** یک فایل را می‌سنجد و لیستِ ایرادها را برمی‌گرداند. */
export function auditText(text, kind) {
  const lines = shellBody(text, kind);
  const probes = probeVars(lines);
  const problems = [];
  for (const s of stopSites(lines)) {
    if (s.kind === 'safe') continue;
    if (s.kind === 'unknown') {
      problems.push(`هدفِ «${s.target}» در «${s.line}» یک نامِ ادبیِ شناخته‌شده نیست — حدس زده نمی‌شود`);
      continue;
    }
    const conds = enclosingConditions(lines, s.i);
    if (!isOneTimeGuarded(conds, probes)) {
      problems.push(`«${s.line}» رباتِ زنده را بدونِ شرطِ یک‌باره می‌خواباند (شرط‌ها: ${conds.join(' | ') || 'هیچ'})`);
    }
  }
  for (const script of RETIRED_ONETIME) {
    if (lines.some(l => !/^\s*#/.test(l) && l.includes(script))) {
      problems.push(`اسکریپتِ یک‌باره‌ی اجراشده «${script}» هنوز صدا زده می‌شود`);
    }
  }
  return { lines, problems, sites: stopSites(lines) };
}

/* ═══════ فیکسچرهای خصمانه ═══════ */
// هر ردیف یک تلاشِ واقعی برای دور زدنِ چک است که ریویوِ خصمانه پیشنهاد داد.
// `bad: true` یعنی باید قرمز شود. اگر روزی پارسر پس‌رفت کند، همین‌جا لو می‌رود.
export const FIXTURES = [
  { name: 'بلوکِ اصلیِ باگ (شرطِ همیشه-درست)', bad: true, sh: [
    'if [ -f bots/tarot/.env ]; then', '  pm2 stop tarot 2>/dev/null || true', 'fi'] },
  { name: 'pm2 stop all', bad: true, sh: [
    'if [ -f bots/tarot/.env ]; then', '  pm2 stop all', 'fi'] },
  { name: 'حلقه با متغیر', bad: true, sh: [
    'for b in tarot voice2text; do', '  pm2 stop "$b"', 'done'] },
  { name: 'ecosystem --only', bad: true, sh: [
    'if [ -f bots/tarot/.env ]; then', '  pm2 stop ecosystem.config.cjs --only tarot', 'fi'] },
  { name: 'کامنتِ فریبنده روی شرط', bad: true, sh: [
    'if [ -f bots/tarot/.env ]; then   # TODO: NEED_MIGRATE flag', '  pm2 stop tarot', 'fi'] },
  { name: 'شرطِ pm2 jlist که همیشه درست است', bad: true, sh: [
    'if pm2 jlist | grep -q tarot; then', '  pm2 stop tarot', 'fi'] },
  { name: 'OR با شرطِ همیشه-درست', bad: true, sh: [
    'if [ "$FORCE_ALL" = "true" ] || [ -f bots/tarot/.env ]; then', '  pm2 stop tarot', 'fi'] },
  { name: 'شاخه‌ی else یعنی «قبلاً انجام شده»', bad: true, sh: [
    'if [ ! -f data/.done ]; then', '  echo x', 'else', '  pm2 stop tarot', 'fi'] },
  { name: 'بدونِ هیچ شرطی', bad: true, sh: ['pm2 stop tarot || true'] },
  { name: 'الگوی درستِ کاوش (voice2text)', bad: false, sh: [
    'NEED_MIGRATE=0',
    "if pm2 jlist | grep -q '/home/ubuntu/voice2text/index.js'; then NEED_MIGRATE=1; fi",
    'if [ "$NEED_MIGRATE" = "1" ]; then pm2 stop voice2text || true; fi'] },
  { name: 'الگوی درستِ مارکر', bad: false, sh: [
    'if [ ! -f bots/tarot/data/.x-done ]; then', '  pm2 stop tarot', 'fi'] },
  { name: 'متغیرِ کاوش‌شده با نامِ دلخواه', bad: false, sh: [
    'MIGRATED=0', 'if node tools/is-migrated.mjs; then MIGRATED=1; fi',
    'if [ "$MIGRATED" = "0" ]; then pm2 stop tarot; fi'] },
  { name: 'رباتِ بازنشسته آزاد است', bad: false, sh: ['pm2 delete resume-tailor 2>/dev/null || true'] },
];

/* ═══════ اجرا ═══════ */
export function main() {
  let pass = 0;
  const fails = [];
  const ok = (name, cond) => { if (cond) pass++; else fails.push(name); };

  let totalSites = 0;
  for (const { file, kind } of SCANNED) {
    if (!existsSync(file)) { fails.push(`فایلِ «${file}» پیدا نشد`); continue; }
    const { problems, sites } = auditText(readFileSync(file, 'utf8'), kind);
    totalSites += sites.length;
    ok(`«${file}» هیچ توقفِ بی‌گاردِ رباتِ زنده ندارد` + (problems.length ? ` → ${problems.join(' ؛ ')}` : ''),
       problems.length === 0);
  }

  // کفِ پوشش: اگر روزی پارسر چیزی پیدا نکند، چک بی‌صدا به no-op تبدیل نشود.
  ok(`دستِ‌کم دو نقطه‌ی توقف پیدا شد (پیدا شد: ${totalSites})`, totalSites >= 2);

  // گاردِ «تاروت حتماً بالا باشد» سرِ جایش هست (تورِ ایمنیِ رباتِ درآمدزا).
  const dep = readFileSync('.github/workflows/deploy.yml', 'utf8');
  ok('گاردِ «tarot باید online باشد» هنوز در دیپلوی هست', /TRT_STATUS/.test(dep) && /!=\s*"online"/.test(dep));
  ok('گارد در صورتِ بالا نیامدنِ tarot جاب را قرمز می‌کند', /process\.exit\(1\)/.test(dep));

  // فیکسچرهای خصمانه: پارسر باید هر دور زدن را بگیرد و هر الگوی درست را بپذیرد.
  for (const f of FIXTURES) {
    const { problems } = auditText(f.sh.join('\n'), 'shell');
    ok(`فیکسچر «${f.name}» ${f.bad ? 'قرمز' : 'سبز'} است` +
       (f.bad === (problems.length > 0) ? '' : ` → ${problems.join(' ؛ ') || 'هیچ ایرادی ندید'}`),
       f.bad === (problems.length > 0));
  }

  if (fails.length) {
    console.error(`❌ گاردِ بلوکِ یک‌باره‌ی دیپلوی: ${fails.length} ادعا شکست خورد`);
    for (const f of fails) console.error(`   • ${f}`);
    console.error('\nقاعده: هر `pm2 stop|delete|kill` روی رباتِ زنده باید زیرِ شرطی باشد که بعد از');
    console.error('انجامِ کار false شود — یا `[ ! -f <marker> ]` یا متغیری که از یک کاوش پر شده.');
    console.error('هدفی که نامِ ادبیِ شناخته‌شده نباشد (all, "$var", ecosystem…) خودش خطاست.');
    console.error('و بلوکِ یک‌باره بعد از تأییدِ اجرا از هر دو مسیرِ دیپلوی برداشته می‌شود.');
    process.exit(1);
  }
  console.log(`✅ گاردِ بلوکِ یک‌باره‌ی دیپلوی: ${pass} ادعا سبز (${totalSites} نقطه‌ی توقف در ${SCANNED.length} مسیرِ دیپلوی)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
