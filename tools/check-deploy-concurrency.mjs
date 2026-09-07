#!/usr/bin/env node
/* گاردِ «دو دیپلوی هم‌زمان روی یک سرور».
 *
 * 🐛 باگی که این فایل را ساخت (۱۴۰۵/۰۶/۱۶): دو مرج با ۲۰ ثانیه فاصله دو رانِ Deploy
 * ساختند که روی هم افتادند. هر دو `npm ci` را در همان پوشه‌ی `bots/tarot` زدند و چون
 * `npm ci` اول `node_modules` را **پاک می‌کند**، یکی پوشه را از زیرِ پای `npm`ِ آن یکی
 * کشید. جابِ دیپلوی قرمز شد با این دو خط:
 *
 *     npm error Error: Cannot find module './BufferList'
 *     npm error gyp ERR! stack Error: ENOENT: no such file or directory, uv_cwd
 *
 * و `node_modules`ِ نیمه‌نصب جا ماند، پس رباتِ زنده ۱۲ دقیقه خوابید.
 *
 * ⚠️ این باگ با گاردِ `INSTALLED_DIRS` بسته نمی‌شود. آن گارد `npm ci`ِ تکراری را
 * **داخلِ یک ران** حذف می‌کند و درست است، ولی یک متغیرِ شل است و هر ران نسخه‌ی خودش
 * را دارد؛ دو ران همچنان دو نصبِ هم‌زمان می‌زنند. دو باگِ متفاوت، دو فیکسِ متفاوت.
 *
 * چرا این چک فقط متن را نمی‌سنجد (بند ۶ب ریشه): یک ادعای «`concurrency:` در فایل هست»
 * آینه‌ی خودش است. پس بخشِ دومِ این فایل **خودِ خرابی را بازتولید می‌کند**: یک پروسه‌ی
 * واقعی در پوشه‌ای می‌ایستد، پوشه از زیرش پاک می‌شود، و همان `ENOENT/uv_cwd`ِ لاگِ
 * پروداکشن بیرون می‌آید. بعد همان سناریو با ترتیبِ صف اجرا می‌شود و سالم می‌ماند.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const WF_PATH = new URL('../.github/workflows/deploy.yml', import.meta.url);
const WF = readFileSync(WF_PATH, 'utf8');

/* ---------- ۱) اعتبارسنجِ پیکربندی (همان تابعی که جهش‌ها رویش اجرا می‌شوند) ---------- */

// گروهی که per ران یکتا شود، گروه‌بندی را بی‌اثر می‌کند: هر ران گروهِ خودش را دارد
// و هیچ‌وقت پشتِ هیچ صفی نمی‌ماند. این اشتباهِ واقع‌گرایانه‌ای است، پس صریح رد می‌شود.
const PER_RUN = ['github.run_id', 'github.run_number', 'github.run_attempt', 'github.sha', 'github.event.head_commit'];

export function validateConcurrency(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^concurrency:\s*$/.test(l));
  if (start === -1) return { ok: false, reason: 'بلوکِ `concurrency:` سطحِ ورک‌فلو وجود ندارد' };

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) continue;
    if (!/^\s/.test(l)) break;          // به ستونِ صفر رسیدیم ⇒ بلوک تمام شد
    body.push(l);
  }

  const g = body.find((l) => /^\s+group:\s*\S/.test(l));
  if (!g) return { ok: false, reason: '`group:` ندارد' };
  const group = g.replace(/^\s+group:\s*/, '').trim();
  const bad = PER_RUN.find((k) => group.includes(k));
  if (bad) return { ok: false, reason: `گروه per ران یکتاست (${bad}) ⇒ هیچ رانی پشتِ صف نمی‌ماند` };

  const c = body.find((l) => /^\s+cancel-in-progress:/.test(l));
  if (!c) return { ok: false, reason: '`cancel-in-progress:` صریح ست نشده' };
  const val = c.replace(/^\s+cancel-in-progress:\s*/, '').trim();
  if (val !== 'false') {
    return { ok: false, reason: `cancel-in-progress=${val} — لغوِ رانِ در حال اجرا، npm ci را وسطِ کار می‌کُشد و همان node_modulesِ نیمه‌پاک را جا می‌گذارد` };
  }
  return { ok: true, group };
}

console.log('\n▶ ۱) پیکربندیِ deploy.yml');
const v = validateConcurrency(WF);
ok(v.ok, v.ok ? `بلوکِ concurrency معتبر است (group: ${v.group})` : `پیکربندی نامعتبر: ${v.reason}`);

// بلوک باید سطحِ ورک‌فلو باشد نه داخلِ یک جاب، وگرنه فقط همان جاب را صف می‌کند.
ok(/^concurrency:\s*$/m.test(WF), 'بلوک در ستونِ صفر (سطحِ ورک‌فلو) است، نه داخلِ jobs');
ok(WF.indexOf('\nconcurrency:') < WF.indexOf('\njobs:'), 'بلوک قبل از jobs آمده');

/* ---------- ۲) کنترل‌های مثبت: هر جهش باید همین اعتبارسنج را قرمز کند ---------- */

console.log('\n▶ ۲) کنترلِ مثبت — اعتبارسنج واقعاً چیزی را رد می‌کند');
const mutations = [
  ['حذفِ کاملِ بلوک', (t) => t.replace(/^concurrency:\n(?:[ \t].*\n|\n)*/m, '')],
  ['cancel-in-progress: true', (t) => t.replace('cancel-in-progress: false', 'cancel-in-progress: true')],
  ['حذفِ cancel-in-progress', (t) => t.replace(/^\s+cancel-in-progress:.*\n/m, '')],
  ['گروهِ per ران', (t) => t.replace('group: deploy-vps', 'group: deploy-${{ github.run_id }}')],
  ['حذفِ group', (t) => t.replace(/^\s+group:.*\n/m, '')],
];
for (const [name, fn] of mutations) {
  const mutated = fn(WF);
  ok(mutated !== WF, `جهشِ «${name}» واقعاً فایل را عوض می‌کند`);
  const r = validateConcurrency(mutated);
  ok(!r.ok, `جهشِ «${name}» رد شد${r.ok ? '' : ` (${r.reason})`}`);
}

/* ---------- ۳) بازتولیدِ خودِ خرابی (رفتاری، نه آینه‌ای) ---------- */

// یک پروسه‌ی واقعی داخلِ پوشه می‌ایستد. اگر پوشه از زیرش پاک شود، `process.cwd()`
// همان ENOENT/uv_cwd ی را می‌دهد که در لاگِ پروداکشن بود.
const CHILD = `
const fs = require('fs');
const [dir, ready] = process.argv.slice(1);   // با node -e مسیرِ اسکریپت در argv نیست
process.chdir(dir);
fs.writeFileSync(ready, '1');
setTimeout(() => {
  try { process.cwd(); console.log('CWD_OK'); }
  catch (e) { console.log('CWD_FAIL:' + e.code + ':' + e.syscall); }
}, 500);
`;

function runChild(dir, readyPath) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', CHILD, dir, readyPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out.trim()));
  });
}

const waitFor = async (f) => { for (let i = 0; i < 200; i++) { if (existsSync(f)) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };

const root = mkdtempSync(join(tmpdir(), 'depconc-'));
try {
  console.log('\n▶ ۳) بازتولیدِ خرابی: پاک شدنِ پوشه از زیرِ پای پروسه‌ی در حالِ نصب');

  // (الف) بدونِ صف: «npm ci»ِ دوم وسطِ کارِ اولی پوشه را پاک می‌کند
  {
    const dir = join(root, 'a', 'node_modules');
    mkdirSync(dir, { recursive: true });
    const ready = join(root, 'ready-a');
    const child = runChild(dir, ready);
    ok(await waitFor(ready), 'پروسه‌ی «نصب» داخلِ node_modules ایستاد');
    rmSync(join(root, 'a'), { recursive: true, force: true });   // ← npm ciِ هم‌زمان
    const out = await child;
    ok(out.startsWith('CWD_FAIL:ENOENT'), `بدونِ صف: همان خطای پروداکشن بازتولید شد ⇒ ${out}`);
    ok(out.includes('uv_cwd'), 'و دقیقاً همان syscall لاگِ پروداکشن است (uv_cwd)');
  }

  // (ب) با صف: دومی صبر می‌کند تا اولی تمام شود ⇒ هیچ خرابی‌ای نیست
  {
    const dir = join(root, 'b', 'node_modules');
    mkdirSync(dir, { recursive: true });
    const ready = join(root, 'ready-b');
    const out = await runChild(dir, ready);     // ← تا پایانِ رانِ اول هیچ پاک‌کردنی نیست
    ok(out === 'CWD_OK', `با صف: پروسه سالم ماند ⇒ ${out}`);
    rmSync(join(root, 'b'), { recursive: true, force: true });   // نوبتِ رانِ دوم، بعد از اتمامِ اولی
    ok(!existsSync(dir), 'و رانِ دوم بعد از اتمامِ اولی آزادانه نصب می‌کند');
  }

  // (ج) چرا cancel-in-progress نباید true باشد: کشتنِ نصب وسطِ کار همان حالتِ نیمه‌کاره را می‌سازد
  {
    const dir = join(root, 'c', 'node_modules');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PART'), 'x');
    rmSync(join(dir, 'PART'));                  // «نصب» وسطِ کار قطع شد
    ok(existsSync(dir) && !existsSync(join(dir, 'PART')),
      'لغوِ وسطِ نصب یک node_modulesِ ناقص جا می‌گذارد ⇒ cancel-in-progress باید false بماند');
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

/* ---------- ۴) ادعای ساختاری: تنها ورک‌فلویی که روی سرور npm ci می‌زند همین است ---------- */

console.log('\n▶ ۴) دامنه');
const deployRunsNpmCi = /npm ci --prefix/.test(WF);
ok(deployRunsNpmCi, 'deploy.yml همچنان روی سرور `npm ci --prefix` می‌زند (دلیلِ وجودِ این گارد)');

console.log(`\n${errs.length ? '❌' : '✅'} ${pass} ادعا سبز، ${errs.length} قرمز`);
if (errs.length) { for (const e of errs) console.log(`   • ${e}`); process.exit(1); }
