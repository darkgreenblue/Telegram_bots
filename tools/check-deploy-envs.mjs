#!/usr/bin/env node
/* گاردِ «سکرتی که تعریف شده ولی به سرور نمی‌رسد».
 *
 * 🐛 باگی که این فایل را ساخت (۱۴۰۵/۰۶/۱۱): شش سکرتِ زبان‌های تاروت در بلوکِ `env:`
 * تعریف شده بودند ولی به لیستِ `envs:` اضافه نشده بودند. `appleboy/ssh-action` فقط
 * متغیرهای **نام‌برده در `envs:`** را به اسکریپتِ روی سرور می‌فرستد، پس آن شش تا روی
 * سرور **خالی** می‌رسیدند.
 *
 * و خرابی کاملاً بی‌صداست: `write_env` شرطِ `[ -n "$tok" ]` دارد، پس فایلِ env ساخته
 * نمی‌شد، `deploy_bot` یک پیامِ دوستانه‌ی «ℹ️ .env.ru نبود — رد شد» چاپ می‌کرد و
 * دیپلوی با کدِ **صفر** تمام می‌شد. مالک سکرت‌ها را درست ست کرده بود و ربات‌ها بالا
 * نمی‌آمدند، بدونِ هیچ خطایی که بگوید چرا.
 *
 * قاعده: هر کلیدی که در `env:` از `secrets.*` پر می‌شود باید در `envs:` هم باشد،
 * وگرنه صرفاً یک تزئین است. این همان قدمِ چک‌لیستِ بند ۵ ریشه است که فراموش شد —
 * و مستندات فراموش می‌شود، چکِ CI نه.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const WF = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

console.log('\n▶ هر سکرتِ تعریف‌شده واقعاً به سرور پاس داده می‌شود');
const envsLine = WF.match(/^\s*envs:\s*(.+)$/m);
ok(!!envsLine, 'لیستِ `envs:` در ورک‌فلو هست');

if (envsLine) {
  const forwarded = new Set(envsLine[1].trim().split(',').map((x) => x.trim()).filter(Boolean));
  /* بلوکِ `env:` همان استپِ ssh-action، تا خودِ `envs:`.
   *
   * ⚠️ `lastIndexOf` نه `indexOf`. استپ‌های **قبلِ** ssh-action هم می‌توانند `env:`
   * داشته باشند (گیتِ پنجره‌ی امن دارد: COMMIT_MSG/URGENT/REASON). با `indexOf` برش
   * از آن‌جا شروع می‌شد و متغیرهای آن استپ‌ها به‌عنوان «سکرتِ forward نشده» گزارش
   * می‌شدند — یک قرمزِ کاذب که هیچ ربطی به قرارداد ندارد. و قرمزِ کاذب دقیقاً همان
   * چیزی است که گارد را بی‌معنا می‌کند (بند ۶ب-۲ ریشه). `lastIndexOf` اکیداً
   * دقیق‌تر است: آخرین `env:` قبل از `envs:` حتماً مالِ خودِ همان استپ است. */
  const envsAt = WF.indexOf('          envs:');
  const envBlock = WF.slice(WF.lastIndexOf('        env:', envsAt), envsAt);
  const declared = [...envBlock.matchAll(/^\s{10}([A-Z0-9_]+):\s*\$\{\{/gm)].map((m) => m[1]);

  ok(declared.length > 0, `بلوکِ env: پارس شد (${declared.length} کلید)`);
  const missing = declared.filter((k) => !forwarded.has(k));
  ok(missing.length === 0,
    missing.length
      ? `این سکرت‌ها تعریف شده‌اند ولی به سرور نمی‌رسند: ${missing.join(', ')}`
      : `هر ${declared.length} سکرتِ تعریف‌شده در envs: هم هست`);

  /* ⚠️ ادعای دوم و مهم‌تر: چیزی که **اسکریپت واقعاً می‌خواند** باید forward شده باشد.
   * ادعای اول فقط `env:` را با `envs:` می‌سنجد؛ اگر کسی سکرتی را در هیچ‌کدام ننویسد
   * ولی در اسکریپت صدایش بزند، باز هم خالی می‌رسد و باز هم بی‌صداست. */
  /* ⚠️ برش باید به **همان استپ** محدود بماند. نسخه‌ی اول تا انتهای فایل می‌رفت و
   * `SSH_KEY`/`MSG_TOKEN` استپ‌های بعدی را هم «اسکریپتِ سرور» می‌دید — مثبتِ کاذب. */
  const scriptStart = WF.indexOf('          script: |');
  const nextStep = WF.indexOf('\n      - name:', scriptStart);
  const script = WF.slice(scriptStart, nextStep === -1 ? undefined : nextStep);
  const used = new Set();
  for (const m of script.matchAll(/\$\{?([A-Z][A-Z0-9_]{3,})\b/g)) used.add(m[1]);
  /* متغیری که خودِ اسکریپت مقداردهی‌اش می‌کند محلی است، نه سکرت. این قاعده‌ی
   * **ساختاری** عمداً جای یک لیستِ هاردکد را گرفت: لیست کهنه می‌شود و اولین متغیرِ
   * محلیِ تازه یک قرمزِ کاذب می‌دهد (`MSG_TOKEN` همین را نشان داد). */
  const assigned = new Set([...script.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const SHELL = new Set(['PATH', 'HOME', 'PM2_HOME', 'NVM_DIR', 'GITHUB_ENV', 'GITHUB_OUTPUT']);
  const secretish = [...used].filter((v) =>
    /_(TOKEN|KEY|ID|IDS)$/.test(v) && !assigned.has(v) && !SHELL.has(v));
  const notForwarded = secretish.filter((v) => !forwarded.has(v));
  ok(notForwarded.length === 0,
    notForwarded.length
      ? `اسکریپت این‌ها را می‌خواند ولی forward نشده‌اند: ${notForwarded.join(', ')}`
      : `هر ${secretish.length} متغیرِ رمزمانندی که اسکریپت می‌خواند forward شده است`);

  console.log('\n▶ زبان‌های تاروت مشخصاً پوشش دارند (باگِ ۱۱ شهریور)');
  for (const lang of ['RU', 'PT', 'ES']) {
    for (const suffix of ['BOT_TOKEN', 'OPENROUTER_KEY']) {
      const name = `TAROT_${lang}_${suffix}`;
      ok(forwarded.has(name), `${name} به سرور پاس داده می‌شود`);
    }
  }
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
for (const e of errs) console.log(`   - ${e}`);
assert.equal(errs.length, 0, `${errs.length} خطای forwardِ سکرت`);
