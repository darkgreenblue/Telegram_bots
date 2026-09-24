#!/usr/bin/env node
/* گاردِ ضربانِ زنده بودن.
 *
 * چرا این گارد وجود دارد: هشت باگِ دیپلویِ ثبت‌شده در CLAUDE.md ریشه یک چیزِ مشترک
 * دارند — همه بی‌صدا بودند و **همه را یک انسان کشف کرد نه سیستم**. ریشه‌اش تعریفِ غلطِ
 * «سالم» بود (`pm2 status === 'online'`). ضربان آن تعریف را عوض می‌کند: سیگنالی که
 * خودِ حلقه‌ی رویدادِ ربات تولید می‌کند.
 *
 * و چون خودِ این مکانیزم هم می‌تواند بی‌صدا بشکند (ضربانی که هیچ‌وقت تیک نزند، یا
 * گاردی که ضربانِ کهنه را تازه بخواند)، این چک **رفتاری** است: ماژول را واقعاً
 * اجرا می‌کند، فایل می‌نویسد، زمان را جلو می‌برد، و هر دو جهت را می‌سنجد.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startHeartbeat, beat, heartbeatAgeSec, HEARTBEAT_INTERVAL_MS } from '../shared/heartbeat.js';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = mkdtempSync(join(tmpdir(), 'hb-'));
try {
  /* ---------- ۱) خودِ ماژول ---------- */
  console.log('\n▶ ۱) نوشتن و خواندنِ ضربان');
  const f = join(root, 'deep', 'heartbeat-fa.txt');
  ok(heartbeatAgeSec(f) === null, 'فایلِ نبود ⇒ null (یعنی «هرگز بالا نیامده»، نه «تازه»)');
  ok(beat(f) === true, 'beat پوشه‌ی نبود را می‌سازد و می‌نویسد');
  ok(existsSync(f), 'فایل ساخته شد');
  const age0 = heartbeatAgeSec(f);
  ok(age0 !== null && age0 >= 0 && age0 <= 2, `سنِ ضربانِ تازه ~۰ است (${age0})`);

  // مقدارِ خراب نباید «تازه» خوانده شود — وگرنه یک فایلِ نصفه‌نوشته سلامتِ جعلی می‌سازد.
  for (const bad of ['', '   ', 'abc', '0', '-5', 'NaN']) {
    writeFileSync(f, bad);
    ok(heartbeatAgeSec(f) === null, `مقدارِ نامعتبر ${JSON.stringify(bad)} ⇒ null، نه سلامتِ جعلی`);
  }

  console.log('\n▶ ۲) کهنگی واقعاً تشخیص داده می‌شود');
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(f, String(now - 600));
  const oldAge = heartbeatAgeSec(f);
  ok(oldAge >= 590 && oldAge <= 610, `ضربانِ ۱۰ دقیقه پیش سنِ ~۶۰۰ می‌دهد (${oldAge})`);
  ok(oldAge > 5 * 60, 'و از آستانه‌ی ۵ دقیقه‌ای health-watch رد می‌شود ⇒ هشدار');
  writeFileSync(f, String(now - 60));
  ok(heartbeatAgeSec(f) <= 5 * 60, 'ضربانِ ۱ دقیقه پیش زیرِ آستانه است ⇒ هشدارِ کاذب نمی‌دهد');

  /* ---------- ۳) ضربان واقعاً تیک می‌زند (کنترلِ مثبت) ---------- */
  console.log('\n▶ ۳) startHeartbeat واقعاً تکرار می‌شود');
  const g = join(root, 'tick.txt');
  const stop = startHeartbeat(g, { intervalMs: 60 });
  const first = readFileSync(g, 'utf8');
  ok(first.length > 0, 'اولین ضربان بلافاصله نوشته می‌شود (نه بعد از اولین بازه)');
  // مقدار را عقب می‌بریم؛ اگر interval واقعاً تیک بزند دوباره جلو می‌رود.
  writeFileSync(g, String(Math.floor(Date.now() / 1000) - 999));
  await sleep(250);
  const after = heartbeatAgeSec(g);
  ok(after !== null && after < 10, `ضربان خودش را تازه کرد (سن=${after}) ⇒ setInterval زنده است`);
  stop();
  writeFileSync(g, String(Math.floor(Date.now() / 1000) - 999));
  await sleep(250);
  ok(heartbeatAgeSec(g) > 900, 'بعد از stop دیگر تیک نمی‌زند (نشتِ interval نداریم)');

  /* ---------- ۴) گاردِ منفی: ضربان نباید پروسه را زنده نگه دارد ---------- */
  // رفتاری، نه ادعای متنی: یک پروسه‌ی واقعی فقط ضربان را روشن می‌کند و باید **خودش**
  // تمام شود. اگر `unref()` حذف شود این کودک تا ابد می‌ماند و همین ادعا قرمز می‌شود.
  console.log('\n▶ ۴) ضربان پروسه را گروگان نمی‌گیرد');
  {
    const hbUrl = new URL('../shared/heartbeat.js', import.meta.url).href;
    const src = `import(${JSON.stringify(hbUrl)}).then(m => m.startHeartbeat(${JSON.stringify(join(root, 'unref.txt'))}, { intervalMs: 50 }));`;
    const exited = await new Promise((resolve) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: 'ignore' });
      const timer = setTimeout(() => { c.kill('SIGKILL'); resolve(false); }, 6000);
      c.on('close', () => { clearTimeout(timer); resolve(true); });
    });
    ok(exited, 'پروسه‌ای که فقط ضربان دارد خودش خارج می‌شود (timer با unref ثبت شده)');
  }

  /* ---------- ۵) beat هرگز throw نمی‌کند ---------- */
  // مسیرِ غیرقابلِ‌نوشتن به شکلِ قطعی و قابلِ‌حمل: خودِ یک **پوشه** را به‌عنوان فایل
  // می‌دهیم ⇒ EISDIR. (نسخه‌ی اول `/proc/...` را می‌داد و در این محیط **بلاک شد** —
  // یعنی خودِ چک معلق می‌ماند، که از نبودنش بدتر است: CI بی‌صدا تایم‌اوت می‌خورد.)
  console.log('\n▶ ۵) پایش نباید بتواند ربات را بشکند');
  let threw = false, logged = false;
  try { beat(root, () => { logged = true; }); }
  catch { threw = true; }
  ok(!threw, 'مسیرِ غیرقابلِ‌نوشتن throw نمی‌کند');
  ok(logged, 'ولی ساکت هم نمی‌ماند — خطا لاگ می‌شود');
  ok(beat(root) === false, 'و false برمی‌گرداند (شکست را قورت نمی‌دهد)');
} finally {
  rmSync(root, { recursive: true, force: true });
}

/* ---------- ۶) سیم‌کشی: هر سه طرفِ قرارداد ---------- */
console.log('\n▶ ۶) سیم‌کشی در ربات، دیپلوی و health-watch');
const TAROT = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const DEPLOY = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const HW = readFileSync(new URL('../tools/health-watch.mjs', import.meta.url), 'utf8');

ok(/import \{[^}]*startHeartbeat[^}]*\} from '\.\.\/\.\.\/shared\/heartbeat\.js'/.test(TAROT),
  'tarot ماژولِ ضربان را import می‌کند');

/* ⚠️ مهم‌ترین ادعای این فایل. بند ۹ب/۷: برای long polling، promiseِ `launch()` تا
 * **توقفِ** ربات resolve نمی‌شود. اگر ضربان روی `.then()` بنشیند هیچ‌وقت تیک نمی‌زند و
 * دقیقاً برعکسِ هدفش عمل می‌کند: یک ضربانِ همیشه-کهنه که هر ۵ دقیقه هشدارِ کاذب می‌دهد
 * تا وقتی مالک خاموشش کند — و آن‌وقت خرابیِ واقعی هم دیگر دیده نمی‌شود. */
const onLaunched = TAROT.slice(TAROT.indexOf('function onLaunched()'), TAROT.indexOf('function launch()'));
ok(onLaunched.includes('startHeartbeat('), 'ضربان داخلِ قلابِ onLaunch شروع می‌شود، نه `.then()`');
ok(!/\.then\([^)]*startHeartbeat/.test(TAROT), 'و هیچ‌جا روی `.then()`ِ launch آویزان نیست');

// فایلِ ضربان باید per اپ باشد. یک مسیرِ ثابت یعنی یک اپِ سالم مرگِ سه‌تای دیگر را می‌پوشاند.
const hbConst = TAROT.match(/const HEARTBEAT_FILE = `([^`]+)`/);
ok(!!hbConst, 'ثابتِ HEARTBEAT_FILE تعریف شده');
ok(!!hbConst && hbConst[1].includes('${LOCALE}'), 'مسیرِ ضربان per locale است، نه یک فایلِ مشترک');
ok(!!hbConst && hbConst[1].startsWith('./data/'), 'در data/ می‌نشیند که gitignore است ⇒ درختِ سرور کثیف نمی‌شود');

ok(/DEPLOY_STARTED_AT=\$\(date \+%s\)/.test(DEPLOY), 'دیپلوی لحظه‌ی شروع را مهر می‌زند');
/* ترتیب حیاتی است: اگر مهر بعد از reload گرفته شود، ضربانِ کهنه‌ی پروسه‌ی قبلی
 * به‌عنوان سلامتِ پروسه‌ی جدید خوانده می‌شود ⇒ همان سبزِ دروغینی که حذفش کردیم.
 *
 * ⚠️ لنگر عمداً **تعریفِ** `deploy_bot()` است نه اولین فراخوانی‌اش. نسخه‌ی اول با
 * `deploy_bot tarot` می‌سنجید و یک جهشِ واقعی از زیرش رد شد: مهر را درست یک خط
 * بالاتر از همان فراخوانی گذاشتم و ادعا همچنان سبز ماند، در حالی که تا آن لحظه
 * `deploy_bot`های قبلی reload کرده بودند. در شل، تعریفِ تابع حتماً قبل از هر
 * فراخوانی می‌آید، پس «قبل از تعریف» شرطِ اکیداً قوی‌تر و پایدارتری است. */
ok(DEPLOY.indexOf('DEPLOY_STARTED_AT=$(date +%s)') < DEPLOY.indexOf('deploy_bot() {'),
  'و این مهر **قبل از تعریفِ deploy_bot** گرفته می‌شود (یعنی قبل از هر reload)');
ok(/heartbeat-\$hbloc\.txt/.test(DEPLOY), 'گاردِ دیپلوی فایلِ ضربانِ هر زبان را می‌خواند');
// اپِ `tarot-ru` رباتِ واحدِ انگلیسی است؛ نامِ ضربان باید از LOCALE داخلِ فایلِ env بیاید.
ok(/hbloc=\$\(sed -n 's\/\^LOCALE=\/\/p' "bots\/tarot\/\$envf"/.test(DEPLOY),
  'نامِ ضربان از LOCALEِ خودِ فایلِ env می‌آید، نه از نامِ اپ (tarot-ru = LOCALE=en)');
ok(/\$beat" -ge "\$DEPLOY_STARTED_AT/.test(DEPLOY), 'و ضربان را با لحظه‌ی شروعِ دیپلوی می‌سنجد، نه صرفاً با وجودِ فایل');
ok(/HB_BAD/.test(DEPLOY) && /exit 1/.test(DEPLOY), 'نبودِ ضربان جابِ دیپلوی را قرمز می‌کند');
// اپی که سکرت ندارد عمداً دیپلوی نمی‌شود؛ گارد باید معافش کند وگرنه هر دیپلوی قرمز است.
ok(/\[ -f "bots\/tarot\/\$envf" \]/.test(DEPLOY), 'اپِ بدونِ سکرت از گارد معاف است (درسِ ۱۱ شهریور)');

/* ⚠️ این بخش عمداً بلوکِ واقعیِ health-watch را از سورس می‌بُرد و **اجرا** می‌کند
 * (همان الگوی check-health-watch). نسخه‌ی اول فقط `/heartbeatAgeSec/.test(HW)`
 * بود و یک جهشِ واقعی از زیرش رد شد: فراخوانی با `(() => null)` جایگزین شد و
 * ادعا همچنان سبز ماند، چون رشته در خطِ **import** هم هست. آینه‌ی خودش بود. */
const m = HW.match(/const online = new Map[\s\S]*?\n {4}\}\n/);
ok(!!m, 'بلوکِ ضربان در health-watch پیدا شد');
if (m) {
  const runBlock = (list, ages, uptimeSec = 3600) => {
    const out = [];
    const fn = new Function('list', 'out', 'HEARTBEAT_APPS', 'HEARTBEAT_STALE_SEC',
      'heartbeatAgeSec', 'join', 'ROOT', 'Date', `${m[0]}\nreturn out;`);
    return fn(list, out,
      [['tarot', 'fa'], ['tarot-ru', 'ru']], 300,
      (path) => (path in ages ? ages[path] : null),
      (...p) => p.filter(Boolean).join('/'), '',   // ROOT خالی نباید اسلشِ ابتدایی بسازد
      class extends Date { static now() { return uptimeSec * 1000; } });
  };
  const online = (name) => ({ name, pm2_env: { status: 'online', pm_uptime: 0 } });
  const keys = (r) => r.map((x) => x.key);

  const fresh = runBlock([online('tarot')], { 'bots/tarot/data/heartbeat-fa.txt': 10 });
  ok(keys(fresh).length === 0, 'ضربانِ تازه ⇒ هیچ هشداری');

  const stale = runBlock([online('tarot')], { 'bots/tarot/data/heartbeat-fa.txt': 900 });
  ok(keys(stale).includes('hb:stale:tarot'), 'ضربانِ ۱۵ دقیقه‌ای ⇒ هشدارِ کهنگی');

  const none = runBlock([online('tarot')], {});
  ok(keys(none).includes('hb:none:tarot'), 'اپِ online بدونِ هیچ ضربانی ⇒ هشدار');

  // اپِ آفلاین از قبل هشدارِ خودش را دارد؛ هشدارِ دوم فقط نویز است و نویز همان
  // چیزی است که هشدارِ واقعی را بی‌معنا می‌کند (درسِ پینگ‌پنگِ chmod).
  const off = runBlock([{ name: 'tarot', pm2_env: { status: 'stopped', pm_uptime: 0 } }], {});
  ok(keys(off).length === 0, 'اپِ آفلاین هشدارِ ضربانِ تکراری نمی‌گیرد');

  // تازه‌بوت‌شده هنوز فرصت دارد؛ وگرنه هر دیپلوی یک موجِ هشدارِ کاذب می‌سازد.
  const booting = runBlock([online('tarot')], {}, 30);
  ok(keys(booting).length === 0, 'اپی که ۳۰ ثانیه است بالا آمده هنوز سنجیده نمی‌شود');

  // فقط اپِ موجود در pm2 سنجیده می‌شود، نه هر ردیفِ نگاشت.
  const onlyOne = runBlock([online('tarot')], { 'bots/tarot/data/heartbeat-fa.txt': 10 });
  ok(!keys(onlyOne).some((k) => k.endsWith('tarot-ru')), 'اپی که در pm2 نیست هشدار نمی‌سازد');
}
ok(/HEARTBEAT_STALE_SEC/.test(HW), 'آستانه‌ی کهنگی ثابتِ نام‌دار دارد');

console.log(`\n${errs.length ? '❌' : '✅'} ${pass} ادعا سبز، ${errs.length} قرمز`);
if (errs.length) { for (const e of errs) console.log(`   • ${e}`); process.exit(1); }
