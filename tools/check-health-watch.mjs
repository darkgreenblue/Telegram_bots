#!/usr/bin/env node
/* چکِ ناظرِ سلامت (`tools/health-watch.mjs`) — بخشِ «اپِ گم‌شده».
 *
 * چرا لازم است: این تنها جایی است که «ربات اصلاً بالا نیامده» را می‌گیرد، و هر دو
 * جهتِ خطایش گران است. منفیِ کاذب یعنی رباتِ زنده‌ی درآمدزا خوابیده و کسی خبر ندارد.
 * مثبتِ کاذب یعنی هشدار هر ۵ دقیقه شلیک می‌کند و **بی‌معنا** می‌شود، پس خرابیِ واقعی
 * لای نویزش گم می‌شود (همان درسِ پینگ‌پنگِ chmod در بندِ ۳ ریشه).
 *
 * 🐛 باگی که این فایل را ساخت (۱۴۰۵/۰۶/۱۱): سه اپِ زبانیِ تاروت `cwd` مشترکِ
 * `bots/tarot` دارند و فقط `ENV_FILE` فرقشان است. گارد `.env` **فارسی** را می‌دید که
 * همیشه وجود دارد، پس هر سه «ست‌شده» حساب می‌شدند و چون سکرتشان نبود و دیپلوی
 * ردشان می‌کرد، سه هشدارِ کاذب per چرخه می‌رفت.
 *
 * چک **رفتاری** است: خودِ حلقه از سورس بریده و اجرا می‌شود، نه یک کپیِ محلی.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const SRC = readFileSync(new URL('./health-watch.mjs', import.meta.url), 'utf8');

/* ═══ بریدنِ حلقه‌ی «اپِ گم‌شده» از خودِ سورس ═══ */
const m = SRC.match(/const up = new Set\(list\.map[\s\S]*?\n {4}\}\n/);
if (!m) {
  console.log('  ❌ حلقه‌ی «اپِ گم‌شده» در سورس پیدا نشد (ساختار عوض شده؟)');
  process.exit(1);
}
const body = m[0];

/** حلقه را با ecosystem و فایل‌سیستمِ ساختگی اجرا می‌کند و هشدارها را برمی‌گرداند. */
const runLoop = (apps, onDisk, running) => {
  const out = [];
  const fn = new Function('eco', 'list', 'out', 'existsSync', 'join', 'ROOT', `
    ${body}
    return out;
  `);
  return fn(
    { apps },
    running.map((name) => ({ name })),
    out,
    (p) => onDisk.includes(p),
    (...parts) => parts.filter(Boolean).join('/'),
    '',
  );
};

const ECO = [
  { name: 'voice2text', cwd: 'bots/voice2text', script: 'index.js' },
  { name: 'tarot', cwd: 'bots/tarot', script: 'index.js' },
  { name: 'tarot-ru', cwd: 'bots/tarot', script: 'index.js', env: { ENV_FILE: '.env.ru' } },
  { name: 'tarot-es', cwd: 'bots/tarot', script: 'index.js', env: { ENV_FILE: '.env.es' } },
  { name: 'health-watch', cwd: '.', script: 'tools/health-watch.mjs' },
];
const alerts = (r) => r.map((x) => x.key);

console.log('\n▶ اپی که هنوز سکرت ندارد هشدار نمی‌دهد');
{
  // فقط `.env` فارسی روی دیسک است — دقیقاً وضعیتِ لحظه‌ی مرجِ چندزبانگی.
  const r = runLoop(ECO, ['bots/voice2text/.env', 'bots/tarot/.env'], ['voice2text', 'tarot', 'health-watch']);
  ok(!alerts(r).includes('pm2:missing:tarot-ru'), 'زبانِ بدونِ `.env.ru` هشدار نمی‌دهد');
  ok(!alerts(r).includes('pm2:missing:tarot-es'), 'زبانِ بدونِ `.env.es` هشدار نمی‌دهد');
  ok(r.length === 0, `هیچ هشدارِ کاذبی نیست (شد ${r.length}: ${alerts(r).join(', ') || '—'})`);
}

console.log('\n▶ ولی اپی که env دارد و بالا نیست، حتماً هشدار می‌دهد');
{
  const disk = ['bots/voice2text/.env', 'bots/tarot/.env', 'bots/tarot/.env.ru'];
  const r = runLoop(ECO, disk, ['voice2text', 'tarot', 'health-watch']);
  ok(alerts(r).includes('pm2:missing:tarot-ru'), 'زبانِ ست‌شده‌ی خوابیده گرفته می‌شود');
  ok(!alerts(r).includes('pm2:missing:tarot-es'), 'و زبانِ ست‌نشده همچنان ساکت است');
}

console.log('\n▶ رباتِ زنده هرگز از قلم نمی‌افتد');
{
  const disk = ['bots/voice2text/.env', 'bots/tarot/.env'];
  const r = runLoop(ECO, disk, ['voice2text', 'health-watch']);
  ok(alerts(r).includes('pm2:missing:tarot'), 'خوابیدنِ تاروتِ فارسی هشدار می‌دهد');
  const r2 = runLoop(ECO, disk, ['tarot', 'health-watch']);
  ok(alerts(r2).includes('pm2:missing:voice2text'), 'خوابیدنِ voice2text هشدار می‌دهد');
  const r3 = runLoop(ECO, disk, []);
  ok(alerts(r3).includes('pm2:missing:health-watch'),
    'اپِ بدونِ cwdِ `bots/` (خودِ ناظر) هم پوشش دارد — env لازم ندارد');
}

/* ⚠️ ادعای معکوس، و دلیلِ وجودِ این فایل: `.env`ِ همسایه نباید اپِ دیگری را معاف کند.
 * بدونِ این، همان باگِ اصلی دوباره سبز رد می‌شد. */
console.log('\n▶ ادعای معکوس: `.env` همسایه معافیت نمی‌سازد');
{
  const r = runLoop(ECO, ['bots/tarot/.env'], ['tarot', 'health-watch', 'voice2text']);
  ok(!alerts(r).includes('pm2:missing:tarot-ru'),
    '`.env` فارسی، زبانِ روسی را «ست‌شده» نشان نمی‌دهد');
  ok(alerts(r).length === 0, 'و هیچ هشدارِ دیگری هم ساخته نمی‌شود');
}

/* اگر روزی ecosystem دیگر اپِ هم‌cwd با ENV_FILE نداشته باشد، این تست بی‌موضوع
 * می‌شود و باید بداند. */
console.log('\n▶ فرضِ تست هنوز با ecosystem واقعی می‌خواند');
{
  const eco = readFileSync(new URL('../ecosystem.config.cjs', import.meta.url), 'utf8');
  ok(/ENV_FILE:\s*'\.env\.[a-z-]+'/.test(eco), 'ecosystem واقعاً اپِ ENV_FILE-دار دارد');
  ok(/const envName = app\.env\?\.ENV_FILE \|\| '\.env';/.test(SRC),
    'گارد نامِ فایل را از ENV_FILE می‌گیرد، نه `.env` ثابت');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
for (const e of errs) console.log(`   - ${e}`);
assert.equal(errs.length, 0, `${errs.length} خطای ناظرِ سلامت`);
