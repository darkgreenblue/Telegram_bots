#!/usr/bin/env node
/* 🔐 چکِ `Ops → db-query-sealed`: متنِ کاربر هرگز خام در لاگِ جاب نمی‌نشیند.
 *
 * چرا این اکشن وجود دارد: لاگِ Ops وقتی ریپو موقتاً public است (بند ۳ج ریشه) برای
 * همه خواناست. `db-query` خروجی را خام چاپ می‌کند، که برای عددِ تجمیعی بی‌خطر است و
 * برای متنِ خامِ کاربر (سؤالِ فال، خودِ فال) نه.
 *
 * چرا رفتاری است و نه متنی: شکستِ این گارد هیچ خطایی نمی‌دهد. اگر روزی کسی رمزنگاری
 * را «موقتاً» بردارد یا یک console.log اضافه کند، جاب سبز تمام می‌شود و دیتای کاربر
 * در یک لاگِ عمومی می‌نشیند. پس خودِ بلوکِ شل از `ops.yml` بریده می‌شود و با bash
 * واقعی روی یک دیتابیسِ آزمایشی اجرا می‌شود (همان نقلِ‌قول‌ها، همان guardها، همان
 * pick_db)، و یک متنِ نشان‌دار (canary) نباید در هیچ شکلی در خروجی دیده شود.
 *
 * اجرا: node tools/check-ops-sealed.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { keygen, extract, unseal, BEGIN, END } from './ops-unseal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const WF = fs.readFileSync(path.join(ROOT, '.github/workflows/ops.yml'), 'utf8');
const lines = WF.split('\n');

console.log('\n▶ سیم‌کشیِ ورک‌فلو');
ok(/options:\s*\[[^\]]*\bdb-query-sealed\b/.test(WF), 'اکشنِ db-query-sealed در لیستِ گزینه‌ها هست');
ok(/^\s{6}pubkey:\s*$/m.test(WF), 'ورودیِ pubkey تعریف شده');
ok(/^\s*OPS_PUBKEY:\s*\$\{\{\s*inputs\.pubkey\s*\}\}\s*$/m.test(WF), 'OPS_PUBKEY در env از ورودی پر می‌شود');
const envsLine = (WF.match(/^\s*envs:\s*(.+)$/m) || [])[1] || '';
ok(envsLine.split(',').map((x) => x.trim()).includes('OPS_PUBKEY'),
  'OPS_PUBKEY در envs هست (بدونش روی سرور خالی می‌رسد و هر اجرا بی‌صدا رد می‌شود)');

/* بریدنِ بلوکِ case: از سرخطِ `db-query-sealed)` تا اولین `;;` با همان تورفتگی. */
const bStart = lines.findIndex((l) => /^\s*db-query-sealed\)\s*$/.test(l));
ok(bStart >= 0, 'شاخه‌ی db-query-sealed در اسکریپت هست');
const indent = bStart >= 0 ? lines[bStart].match(/^\s*/)[0] + '  ' : '';
const bEnd = lines.findIndex((l, i) => i > bStart && l === `${indent};;`);
ok(bEnd > bStart, 'انتهای شاخه (;;) پیدا شد');
const body = lines.slice(bStart + 1, bEnd).map((l) => l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()).join('\n');

/* pick_db همان تابعِ بالای اسکریپت است؛ عمداً کپی نمی‌شود تا واگرایی‌اش دیده شود. */
const pStart = lines.findIndex((l) => /^\s*pick_db\(\)\s*\{\s*$/.test(l));
const pIndent = pStart >= 0 ? lines[pStart].match(/^\s*/)[0] : '';
const pEnd = lines.findIndex((l, i) => i > pStart && l === `${pIndent}}`);
ok(pStart >= 0 && pEnd > pStart, 'تابعِ pick_db پیدا شد');
const pickDb = lines.slice(pStart, pEnd + 1).map((l) => l.slice(pIndent.length)).join('\n');

ok(/case "\$OPS_PUBKEY" in \(\*\[!A-Za-z0-9\+\/=\]\*\|''\)/.test(body),
  'کلیدِ عمومی فقط با نویسه‌های base64 پذیرفته می‌شود (ضدِ تزریقِ شل)');
ok(/readonly:\s*true/.test(body), 'اتصالِ دیتابیس readonly است');
/* کدِ node داخلِ رشته‌ی دابل‌کوتِ شل می‌نشیند؛ هر یک از این نویسه‌ها یعنی شل قبل از
 * node دست به کد می‌زند (همان تله‌ای که نسخه‌ی درون‌خطیِ exp را شکست). */
const js = (body.match(/node -e "\n([\s\S]*?)\n"/) || [])[1] || '';
ok(js.length > 200, 'کدِ node از بلوک بیرون کشیده شد');
ok(!/["$`\\]/.test(js), 'کدِ node هیچ دابل‌کوت، دلار، بک‌تیک یا بک‌اسلشی ندارد');

/* ─────────────── اجرای واقعی ─────────────── */
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-sealed-'));
fs.mkdirSync(path.join(T, 'bots/tarot/data'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'bots/tarot/node_modules'), path.join(T, 'bots/tarot/node_modules'));
const DBP = path.join(T, 'bots/tarot/data/bot-fa.db');
const CANARY = 'کانارینا-سؤالِ-خصوصی-QX7Z9';
{
  const db = new Database(DBP);
  db.exec('CREATE TABLE r (id INTEGER PRIMARY KEY, q TEXT, j TEXT)');
  const ins = db.prepare('INSERT INTO r (q, j) VALUES (?, ?)');
  ins.run(`آیا برمی‌گرده؟ ${CANARY}`, JSON.stringify({ headline: `جواب ${CANARY}`, n: 1 }));
  for (let i = 0; i < 1500; i++) ins.run(`سؤال ${i} ${'متن '.repeat(40)}`, JSON.stringify({ i, t: 'x'.repeat(200) }));
  db.close();
}
const { pub, priv } = keygen(3072);
const other = keygen(3072);

function run({ query, pubkey, app = 'tarot' }) {
  const script = `set -e\ncd ${JSON.stringify(T)}\n${pickDb}\n${body}\n`;
  const r = spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, OPS_APP: app, OPS_QUERY: query, OPS_PUBKEY: pubkey, OPS_ONLY: '' },
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}
/* نشانی از متنِ کاربر در هر شکلِ رایج: خام، JSON-escape‌شده، base64 و hex. */
const leaks = (s) => {
  const ascii = 'QX7Z9';
  const fa = 'کانارینا';
  const forms = [ascii, fa, JSON.stringify(fa).slice(1, -1), Buffer.from(fa).toString('base64').slice(0, 12), Buffer.from(fa).toString('hex').slice(0, 16)];
  return forms.some((f) => s.includes(f));
};

console.log('\n▶ مسیرِ سالم');
const direct = new Database(DBP, { readonly: true }).prepare('SELECT id, q, j FROM r ORDER BY id').all();
const h = run({ query: 'SELECT id, q, j FROM r ORDER BY id', pubkey: pub });
ok(h.code === 0, `اجرا موفق است (کد ${h.code}${h.code ? ': ' + h.all.slice(-300) : ''})`);
ok(h.out.includes(BEGIN) && h.out.includes(END), 'بلوکِ مهروموم‌شده با هر دو نشانگر چاپ شد');
ok(/--- rows: 1501 \|/.test(h.out), 'تعدادِ ردیف (غیرحساس) چاپ می‌شود');
ok(!leaks(h.all), '⭐ هیچ نشانی از متنِ کاربر در خروجی نیست (خام/escape/base64/hex)');
let blob = '';
try { blob = extract(h.out); } catch { /* ادعای بعدی قرمز می‌شود */ }
ok(blob.length > 1000, 'بلوب از خروجی بیرون کشیده شد');
ok(!leaks(Buffer.from(blob, 'base64').toString('latin1')) && !leaks(Buffer.from(blob, 'base64').toString('utf8')),
  'خودِ بایت‌های بلوب هم متن را لو نمی‌دهند (یعنی واقعاً رمز شده، نه فقط base64)');
let gunzipOk = false; try { zlib.gunzipSync(Buffer.from(blob, 'base64').subarray(5)); gunzipOk = true; } catch { /* درست */ }
ok(!gunzipOk, 'بلوب بدونِ کلید قابلِ gunzip نیست');
let rt = null; try { rt = unseal(blob, priv); } catch (e) { console.log('    ' + e.message); }
ok(Array.isArray(rt) && rt.length === direct.length && JSON.stringify(rt) === JSON.stringify(direct),
  '⭐ بازکردن با کلیدِ درست دقیقاً همان ردیف‌ها را پس می‌دهد (۱۵۰۱ ردیف، چندخطیِ ۳۰۰۰ نویسه‌ای)');
/* لاگِ واقعیِ گیت‌هاب اولِ هر خط مهرِ زمان دارد. */
const ghLog = h.out.split('\n').map((l, i) => `2026-09-24T21:30:${String(i % 60).padStart(2, '0')}.1234567Z ${l}`).join('\n');
let rt2 = null; try { rt2 = unseal(extract(ghLog), priv); } catch { /* ادعای بعدی */ }
ok(JSON.stringify(rt2) === JSON.stringify(direct), 'از لاگِ خامِ گیت‌هاب (با مهرِ زمان اولِ هر خط) هم باز می‌شود');

/* رمز باید واقعاً تصادفی باشد: کلید یا ivِ ثابت یعنی «رمز» فقط اسمش رمز است. */
const h2 = run({ query: 'SELECT id, q, j FROM r ORDER BY id', pubkey: pub });
let blob2 = ''; try { blob2 = extract(h2.out); } catch { /* ادعای بعدی */ }
ok(blob2 && blob2 !== blob && blob2.slice(-200) !== blob.slice(-200), 'دو اجرای یک کوئری دو بلوبِ متفاوت می‌دهند (کلید و ivِ تصادفی)');
{
  const b = Buffer.from(blob, 'base64'); const n = b.readUInt16BE(3);
  const iv = b.subarray(5 + n, 17 + n), tag = b.subarray(17 + n, 33 + n), ct = b.subarray(33 + n);
  let zeroOk = false;
  try { const d = crypto.createDecipheriv('aes-256-gcm', Buffer.alloc(32), iv); d.setAuthTag(tag); d.update(ct); d.final(); zeroOk = true; } catch { /* درست */ }
  ok(!zeroOk, 'کلیدِ صفر (کلیدِ ثابت/حدس‌زدنی) بلوب را باز نمی‌کند');
}

console.log('\n▶ بدونِ کلیدِ درست باز نمی‌شود');
let wrong = false; try { unseal(blob, other.priv); wrong = true; } catch { /* درست */ }
ok(!wrong, 'کلیدِ خصوصیِ دیگر رد می‌شود');
const bad = Buffer.from(blob, 'base64'); bad[bad.length - 5] ^= 0xff;
let tampered = false; try { unseal(bad.toString('base64'), priv); tampered = true; } catch { /* درست */ }
ok(!tampered, 'بلوبِ دستکاری‌شده رد می‌شود (برچسبِ GCM)');

console.log('\n▶ ورودیِ خصمانه یا اشتباه — هیچ‌کدام دیتا را خام چاپ نمی‌کند');
for (const [name, pk] of [['خالی', ''], ['تزریقِ شل', 'AAAA$(id)'], ['فاصله', 'AAAA BBBB'], ['نقطه‌ویرگول', 'AAAA;ls']]) {
  const r = run({ query: 'SELECT q FROM r', pubkey: pk });
  ok(r.code !== 0 && /pubkey لازم است/.test(r.all) && !leaks(r.all), `کلیدِ ${name} رد می‌شود، قبل از هر دسترسی به دیتابیس`);
}
const junk = run({ query: 'SELECT q FROM r', pubkey: Buffer.from('not a key at all').toString('base64') });
ok(junk.code !== 0 && !leaks(junk.all) && !junk.out.includes(BEGIN), 'base64ِ معتبر که کلید نیست: شکست، بدونِ نشت');
const small = keygen(2048);
const weak = run({ query: 'SELECT q FROM r', pubkey: small.pub });
ok(weak.code !== 0 && /۳۰۷۲/.test(weak.all) && !leaks(weak.all), 'کلیدِ RSA ضعیف‌تر از ۳۰۷۲ بیت رد می‌شود');
const w1 = run({ query: "UPDATE r SET q='x' WHERE id=1", pubkey: pub });
const w2 = run({ query: 'DELETE FROM r', pubkey: pub });
const after = new Database(DBP, { readonly: true }).prepare('SELECT COUNT(*) n, MAX(q) m FROM r WHERE id=1').get();
ok(w1.code !== 0 && w2.code !== 0, 'کوئریِ نوشتنی رد می‌شود');
ok(after.n === 1 && after.m.includes(CANARY) && new Database(DBP, { readonly: true }).prepare('SELECT COUNT(*) n FROM r').get().n === 1501,
  'دیتابیس بعد از تلاشِ نوشتن دست‌نخورده است');
const syn = run({ query: 'SELEC q FORM r', pubkey: pub });
ok(syn.code !== 0 && !leaks(syn.all), 'خطای SQL چیزی از دیتا لو نمی‌دهد');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${errs.length ? '❌' : '✅'} check-ops-sealed: ${pass} ادعا پاس${errs.length ? `، ${errs.length} خطا` : ''}`);
if (errs.length) process.exit(1);
