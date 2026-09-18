#!/usr/bin/env node
/* گاردِ `tools/ci-local.mjs` — اجراکننده‌ی محلیِ چک‌های CI (بند ۳ج ریشه).
 *
 * چرا این چک لازم است: کلِ ارزشِ آن ابزار این است که **همان** چک‌هایی را بزند که CI
 * می‌زند. لحظه‌ای که نگاشتش از `ci.yml` جدا شود یا بی‌صدا به fail-open بیفتد، سشن فکر
 * می‌کند سبز است و پوش می‌کند — یعنی دقیقاً همان حلقه‌ی گرانی که ابزار برای بستنش
 * ساخته شد، این‌بار با یک لایه‌ی اطمینانِ کاذب رویش. */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolMapFromCi } from './ci-changed-bots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'tools/ci-local.mjs'), 'utf8');
const nocom = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fails++; };

// ── ۱) تک‌منبع: نگاشت از ci.yml می‌آید، نه از یک لیستِ دستی ─────────────────
const map = toolMapFromCi();
ok(map && map.size > 50, `toolMapFromCi از ci.yml ${map ? map.size : 0} اسکریپت می‌دهد`);
ok(/toolMapFromCi/.test(nocom), 'ci-local از همان toolMapFromCi استفاده می‌کند');
ok(/\bdecide\b/.test(nocom), 'دامنه‌ی ربات‌ها از همان decide می‌آید');

/* ⚠️ ادعای بالا **متنی** است و به‌تنهایی پوچ: جایگزینیِ خودِ فراخوانیِ `toolMapFromCi()`
 * با یک `new Map()` سبز از آن رد می‌شود (import سرِ جایش می‌ماند) در حالی که ابزار
 * دیگر هیچ چکی پیدا نمی‌کند. این دقیقاً جهشی بود که در دورِ اول **زنده ماند**.
 * پس انتخاب باید واقعاً **اجرا** شود (بند ۶ب ریشه: گاردِ آینه‌ای فقط آینه‌ی خودش را
 * می‌سنجد). `--list` برای همین هست: انتخاب را چاپ می‌کند بدونِ اجرای چک‌ها. */
const listed = execFileSync('node', ['tools/ci-local.mjs', '--all', '--list'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
ok(listed.length > 50, `‎--all واقعاً ${listed.length} چک انتخاب می‌کند`);
for (const must of ['tools/check-coins.mjs', 'tools/check-gate.mjs', 'tools/check-payments.mjs']) {
  ok(listed.includes(must), `انتخابِ ‎--all شاملِ ${must} است`);
}
// و انتخابِ دامنه‌دار باید واقعاً کوچک‌تر از --all باشد، وگرنه فیلتر تزئینی است.
const scoped = execFileSync('node', ['tools/ci-local.mjs', '--list'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
ok(scoped.length <= listed.length, `انتخابِ دامنه‌دار (${scoped.length}) بزرگ‌تر از ‎--all (${listed.length}) نیست`);

// ⚠️ کنترلِ منفی: هیچ فهرستِ هاردکدی از نامِ چک‌ها در سورس نباشد. اگر روزی کسی برای
// «سریع‌تر شدن» لیست را درجا بنویسد، نگاشت از ci.yml جدا می‌شود و چکِ تازه‌ی فردا
// محلی اجرا نمی‌شود — بی‌صدا، چون خروجی همچنان سبز است.
const hard = [...nocom.matchAll(/check-[\w.-]+\.mjs/g)].map((m) => m[0]);
const allowed = new Set(['check-daily-brief.mjs', 'check-journey.mjs']); // فقط ردیف‌های CI_ONLY
ok(hard.every((h) => allowed.has(h)), `هیچ لیستِ هاردکدِ چک در سورس نیست (${hard.length} ارجاع، همه CI_ONLY)`);

// ── ۲) ردیف‌های CI_ONLY نباید کهنه شوند ────────────────────────────────────
const only = [...nocom.matchAll(/\['(tools\/check-[\w.-]+\.mjs)',\s*'([^']+)'\]/g)];
ok(only.length >= 1, `CI_ONLY ${only.length} ردیف دارد`);
for (const [, file, reason] of only) {
  let exists = true;
  try { readFileSync(join(ROOT, file)); } catch { exists = false; }
  ok(exists, `ردیفِ CI_ONLY به فایلِ موجود اشاره می‌کند: ${file}`);
  ok(reason.trim().length > 10, `ردیفِ CI_ONLY دلیلِ نوشته دارد: ${file}`);
}
// کنترلِ مثبتِ خودِ ابزار: باید کدی داشته باشد که مسدودها را هم اجرا کند و اگر سبز
// شدند اعلام کند. بدونش CI_ONLY به سطلِ زباله تبدیل می‌شود (بند ۶ب-۲ ریشه).
ok(/دیگر مسدود نیست/.test(SRC), 'کنترلِ مثبت برای کهنه‌شدنِ CI_ONLY وجود دارد');

// ── ۳) 🐛 رگرسیونِ واقعی: خروجیِ porcelain نباید trim شود ───────────────────
// باگی که حینِ ساخت گرفته شد: `git status --porcelain` برای فایلِ استیج‌نشده با یک
// **فاصله** شروع می‌شود (` M path`). trim کردنِ کلِ خروجی آن فاصله را از خطِ اول
// می‌بَرد، پس `slice(3)` یک کاراکترِ نامِ فایل را می‌خورد ⟵ «مسیرِ ناشناخته» ⟵
// fail-open ⟵ هر ۸۳ چک به‌جای ۲۷ تا. سبز بود ولی دامنه‌اش دروغ بود.
const statusLine = /git\(\['status', '--porcelain'\]\)([^\n]*)/.exec(nocom);
ok(statusLine && !/\.trim\(\)\s*\.split/.test(statusLine[1]), 'خروجیِ porcelain قبل از split، trim نمی‌شود');
ok(statusLine && /\.split\('\\n'\)/.test(statusLine[1]), 'خروجیِ porcelain خط‌به‌خط پردازش می‌شود');

// و ادعای **رفتاری** روی همان منطق، با شکل‌های واقعیِ porcelain:
const parse = (out) => out.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const sample = ' M tools/ci-changed-bots.mjs\n?? tools/ci-local.mjs\nM  bots/tarot/index.js\n';
const got = parse(sample);
ok(got[0] === 'tools/ci-changed-bots.mjs', `فایلِ استیج‌نشده کامل خوانده می‌شود (${got[0]})`);
ok(got[1] === 'tools/ci-local.mjs', `فایلِ تازه کامل خوانده می‌شود (${got[1]})`);
ok(got[2] === 'bots/tarot/index.js', `فایلِ استیج‌شده کامل خوانده می‌شود (${got[2]})`);
// کنترلِ منفی: همان نمونه با trimِ سراسری باید **خراب** شود، وگرنه ادعای بالا پوچ است.
const broken = sample.trim().split('\n').filter(Boolean).map((l) => l.slice(3).trim());
ok(broken[0] !== 'tools/ci-changed-bots.mjs', 'کنترلِ منفی: trimِ سراسری واقعاً نام را می‌شکند');

// ── ۴) خروج با کدِ غیرصفر روی شکست ─────────────────────────────────────────
ok(/process\.exit\(1\)/.test(nocom), 'چکِ قرمز باعثِ exit(1) می‌شود');

console.log(fails ? `\n❌ ${fails} ادعا شکست` : '\n✅ همه‌ی ادعاها سبز');
process.exit(fails ? 1 : 0);
