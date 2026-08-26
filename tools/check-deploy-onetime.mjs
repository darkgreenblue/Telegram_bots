#!/usr/bin/env node
// 🛑 گاردِ «بلوکِ یک‌باره نباید رباتِ زنده را در هر دیپلوی متوقف کند»
//
// ── باگِ واقعی که این چک از آن آمد (۵ شهریور ۱۴۰۵) ─────────────────────────────
// بلوکِ یک‌باره‌ی «مهاجرتِ الماسِ بومی» در `deploy.yml` این شکل بود:
//
//     if [ -f bots/tarot/.env ]; then
//       pm2 stop tarot
//       node tools/coins-native-tarot.mjs bots/tarot/data --apply   # خودش idempotent
//     fi
//
// خودِ مهاجرت idempotent بود و بعد از اولین اجرا بی‌صدا رد می‌شد. ولی **شرطِ بلوک**
// idempotent نبود: `[ -f bots/tarot/.env ]` در هر دیپلوی درست است، پس `pm2 stop tarot`
// در **هر مرج** اجرا می‌شد. و `deploy_bot` فقط وقتی ربات را برمی‌گرداند که کدِ خودش
// عوض شده باشد. نتیجه: یک مرجِ صرفاً مستنداتی هم رباتِ زنده‌ی درآمدزا را می‌خواباند.
//
// ── قاعده‌ای که این‌جا قفل می‌شود ──────────────────────────────────────────────
// هر `pm2 stop|delete` روی یک **رباتِ زنده** باید زیرِ شرطی باشد که **وضعیت را
// تشخیص می‌دهد**، یعنی بعد از انجامِ کار **false** شود. الگوی درست همان بلوکِ
// مهاجرتِ مونوریپوی voice2text است:
//
//     NEED_MIGRATE=0
//     if pm2 jlist | grep -q '/home/ubuntu/voice2text/index.js'; then NEED_MIGRATE=1; fi
//     if [ "$NEED_MIGRATE" = "1" ]; then pm2 stop voice2text || true; fi
//
// شرطِ «فایل هست» یا «دایرکتوری هست» تشخیصِ وضعیت **نیست** — همیشه درست است.
//
// اجرا: node tools/check-deploy-onetime.mjs
import { readFileSync } from 'fs';

const FILE = '.github/workflows/deploy.yml';

/** ربات‌هایی که خواباندنشان به کاربرِ واقعی آسیب می‌زند (بند ۲ج ریشه). */
export const LIVE_BOTS = ['voice2text', 'tarot'];

/**
 * شرطی که **بعد از انجامِ کار false می‌شود**، یعنی بلوکِ یک‌باره واقعاً یک‌باره است.
 * عمداً allowlist است نه blocklist: هر الگوی تازه‌ای باید آگاهانه اضافه شود.
 */
const DETECTS_STATE = [
  /pm2\s+jlist/,              // «آیا پروسه هنوز شکلِ قدیمی را دارد؟»
  /\bNEED_[A-Z_]+\b/,         // پرچمی که از یک تشخیص پر شده
  /\[\s*!\s*-[fd]\s/,         // مارکرِ «هنوز انجام نشده» (`[ ! -f .../.done ]`)
  /\bFORCE_ALL\b/,            // اجرای دستیِ صریحِ مالک
];

/** شرطی که در هر دیپلوی درست است، پس بلوک را یک‌باره نمی‌کند. */
const ALWAYS_TRUE = [
  /\[\s*-[fd]\s/,             // `[ -f ... ]` / `[ -d ... ]` بدونِ نفی
];

/** بدنه‌ی اسکریپتِ شل را از داخلِ YAML بیرون می‌کشد (بلوک‌های `script:` اکشنِ ssh). */
export function shellBody(yaml) {
  const out = [];
  const lines = yaml.split('\n');
  let inScript = false;
  let indent = 0;
  for (const raw of lines) {
    if (!inScript) {
      const m = raw.match(/^(\s*)script:\s*\|/);
      if (m) { inScript = true; indent = m[1].length; }
      continue;
    }
    if (raw.trim() === '') { out.push(''); continue; }
    const cur = raw.match(/^\s*/)[0].length;
    if (cur <= indent) { inScript = false; continue; }
    out.push(raw);
  }
  return out;
}

/**
 * برای یک خط، زنجیره‌ی شرط‌های `if` که آن را در بر گرفته‌اند برمی‌گرداند.
 * ردیابی با تورفتگی انجام می‌شود، چون اسکریپتِ این ریپو تورفتگیِ منظم دارد و
 * پارسرِ کاملِ شل برای یک چکِ CI هم گران است و هم خودش منبعِ باگ می‌شود.
 */
export function enclosingConditions(lines, idx) {
  const conds = [];
  const target = lines[idx].match(/^\s*/)[0].length;
  let depthAtOrBelow = target;
  for (let i = idx - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const ind = line.match(/^\s*/)[0].length;
    if (ind >= depthAtOrBelow) continue;
    const m = line.match(/^\s*(?:el)?if\s+(.*?)(?:;\s*then)?\s*$/);
    if (m) { conds.push(m[1]); depthAtOrBelow = ind; continue; }
    depthAtOrBelow = Math.min(depthAtOrBelow, ind);
  }
  // شرطِ تک‌خطی روی خودِ همان خط (`if ...; then pm2 stop x; fi`)
  const inline = lines[idx].match(/^\s*if\s+(.*?);\s*then\s+/);
  if (inline) conds.push(inline[1]);
  return conds;
}

/** آیا این مجموعه شرط، بلوک را واقعاً یک‌باره می‌کند؟ */
export function isOneTimeGuarded(conds) {
  if (!conds.length) return false;
  const detects = conds.some(c => DETECTS_STATE.some(re => re.test(c)));
  if (detects) return true;
  // فقط شرط‌های همیشه-درست → یک‌باره نیست
  return false;
}

/** همه‌ی خطوطی که یک رباتِ زنده را می‌خوابانند. */
export function stopSites(lines) {
  const hits = [];
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/pm2\s+(stop|delete)\s+([a-z0-9-]+)/);
    if (!m) return;
    if (!LIVE_BOTS.includes(m[2])) return;
    hits.push({ i, line: line.trim(), verb: m[1], bot: m[2] });
  });
  return hits;
}

/* ═══════ اجرا ═══════ */
let pass = 0;
const fails = [];
const ok = (name, cond) => { if (cond) pass++; else fails.push(name); };

const yaml = readFileSync(FILE, 'utf8');
const lines = shellBody(yaml);

ok('بدنه‌ی اسکریپتِ شل از YAML استخراج شد', lines.length > 50);

// ۱) هیچ رباتِ زنده‌ای بدونِ گاردِ تشخیصِ وضعیت خوابانده نمی‌شود.
const sites = stopSites(lines);
for (const s of sites) {
  const conds = enclosingConditions(lines, s.i);
  const guarded = isOneTimeGuarded(conds);
  ok(`«${s.line}» زیرِ گاردِ تشخیصِ وضعیت است (شرط‌ها: ${conds.join(' | ') || 'هیچ'})`, guarded);
}

// ۲) گاردِ «تاروت حتماً بالا باشد» سرِ جایش هست (تورِ ایمنیِ رباتِ درآمدزا).
const body = lines.join('\n');
ok('گاردِ «tarot باید online باشد» هنوز در دیپلوی هست', /TRT_STATUS/.test(body) && /!=\s*"online"/.test(body));
ok('گارد در صورتِ بالا نیامدنِ tarot جاب را قرمز می‌کند', /process\.exit\(1\)/.test(body));

// ۳) بلوکِ یک‌باره‌ی مهاجرتِ الماس واقعاً برداشته شده (اجرا و مهر خورده).
ok('بلوکِ یک‌باره‌ی coins-native از دیپلوی حذف شده', !/tools\/coins-native-tarot\.mjs/.test(body));
ok('بلوکِ یک‌باره‌ی مهاجرتِ قبلی هم برنگشته', !/tools\/coin-migration-tarot\.mjs/.test(body));

// ۴) اثباتِ اینکه خودِ چک کار می‌کند: بلوکِ حذف‌شده را برمی‌گردانیم و انتظارِ قرمزی داریم.
const REGRESSION = [
  '            if [ -f bots/tarot/.env ]; then',
  '              pm2 stop tarot 2>/dev/null || true',
  '              node tools/coins-native-tarot.mjs bots/tarot/data --apply',
  '            fi',
];
const mutated = [...lines.slice(0, 40), ...REGRESSION, ...lines.slice(40)];
const mutSites = stopSites(mutated);
const reintroduced = mutSites.find(s => s.line.startsWith('pm2 stop tarot'));
ok('چک، بلوکِ بازگشته را می‌بیند', !!reintroduced);
ok('چک، بلوکِ بازگشته را رد می‌کند (شرطِ همیشه-درست کافی نیست)',
   !!reintroduced && !isOneTimeGuarded(enclosingConditions(mutated, reintroduced.i)));

// ۵) و اثباتِ اینکه بیش از حد سخت‌گیر نیست: الگوی درستِ voice2text باید سبز بماند.
const GOOD = [
  '            NEED_MIGRATE=0',
  "            if pm2 jlist | grep -q '/home/ubuntu/voice2text/index.js'; then NEED_MIGRATE=1; fi",
  '            if [ "$NEED_MIGRATE" = "1" ]; then pm2 stop voice2text || true; fi',
];
const goodSites = stopSites(GOOD);
ok('الگوی درستِ NEED_MIGRATE پذیرفته می‌شود',
   goodSites.length === 1 && isOneTimeGuarded(enclosingConditions(GOOD, goodSites[0].i)));

if (fails.length) {
  console.error(`❌ گاردِ بلوکِ یک‌باره‌ی دیپلوی: ${fails.length} ادعا شکست خورد`);
  for (const f of fails) console.error(`   • ${f}`);
  console.error('\nقاعده: هر `pm2 stop|delete` روی رباتِ زنده باید زیرِ شرطی باشد که بعد از');
  console.error('انجامِ کار false شود (تشخیصِ وضعیت)، نه شرطی مثل `[ -f ... ]` که همیشه درست است.');
  console.error('و بلوکِ یک‌باره بعد از تأییدِ اجرا از deploy.yml برداشته می‌شود.');
  process.exit(1);
}
console.log(`✅ گاردِ بلوکِ یک‌باره‌ی دیپلوی: ${pass} ادعا سبز (${sites.length} نقطه‌ی توقفِ رباتِ زنده بررسی شد)`);
