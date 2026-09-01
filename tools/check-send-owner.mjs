#!/usr/bin/env node
/* چکِ ابزارِ «ارسال به مالک».
 *
 * 🐛 باگی که این فایل را ساخت: نسخه‌ی اولِ ابزار یک حلقه‌ی شل بود که آیتم‌ها را با
 * **خطِ جدید** جدا می‌کرد، در حالی که خودِ کپشن‌ها چندخطی بودند. نتیجه: خطِ دومِ هر
 * کپشن «مسیرِ فایل» خوانده شد و جاب **بعد از** فرستادنِ اولین عکس مرد. یعنی شکستِ
 * نیمه‌کاره: بخشی رفت، بخشی نه.
 *
 * پس دو خاصیت این‌جا قفل می‌شوند: کپشنِ چندخطی باید سالم بماند، و اعتبارسنجیِ
 * مسیرها باید **قبل از** اولین ارسال کامل شود.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseItems, safePath } from './send-owner.mjs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const throws = (fn, re, m) => {
  try { fn(); ok(false, `${m} (هیچ خطایی نداد)`); }
  catch (e) { ok(re.test(e.message), `${m} (${e.message.slice(0, 60)})`); }
};

console.log('\n▶ کپشنِ چندخطی سالم می‌ماند (باگِ اصلی)');
{
  const cap = 'خطِ اول\n\nخطِ سوم\nmarketing/tarot/avatars/es-strength.jpg';
  const items = parseItems(JSON.stringify([{ path: 'marketing/tarot/avatars/pt-the-sun.jpg', caption: cap }]));
  ok(items.length === 1, `کپشنِ چندخطی یک آیتم می‌ماند، نه چند تا (شد ${items.length})`);
  ok(items[0].caption === cap, 'متنِ کپشن بیت‌به‌بیت حفظ می‌شود');
  // ⚠️ حتی وقتی کپشن **عیناً شبیهِ یک مسیرِ معتبر** است، نباید آیتمِ تازه بسازد.
  ok(items[0].path === 'marketing/tarot/avatars/pt-the-sun.jpg', 'مسیر با کپشن قاطی نمی‌شود');
}

console.log('\n▶ ورودیِ خراب صریح رد می‌شود');
throws(() => parseItems('نه JSON'), /JSON معتبر/, 'JSON نامعتبر');
throws(() => parseItems('{"path":"a"}'), /آرایه/, 'آبجکتِ تنها (نه آرایه)');
throws(() => parseItems('[{"caption":"x"}]'), /path خالی/, 'آیتمِ بدونِ مسیر');
throws(() => parseItems(JSON.stringify([{ path: 'a.jpg', caption: 'x'.repeat(1025) }])),
  /سقف 1024/, 'کپشنِ بلندتر از سقفِ Bot API');
ok(parseItems('').length === 0, 'ورودیِ خالی یعنی صفر آیتم، نه خطا');

console.log('\n▶ گاردِ مسیر');
throws(() => safePath('/etc/passwd'), /نسبی و داخلِ ریپو/, 'مسیرِ مطلق رد می‌شود');
throws(() => safePath('../../etc/passwd'), /نسبی و داخلِ ریپو/, 'خروج از ریپو رد می‌شود');
throws(() => safePath('marketing/nope.jpg'), /فایل نیست/, 'فایلِ ناموجود رد می‌شود');
throws(() => safePath('marketing'), /فایل نیست/, 'پوشه به‌جای فایل رد می‌شود');
ok(!!safePath('marketing/tarot/avatars/pt-the-sun.jpg'), 'فایلِ واقعی پذیرفته می‌شود');

/* ⚠️ ترتیب: اگر اعتبارسنجی وسطِ حلقه‌ی ارسال باشد، یک مسیرِ غلط بعد از فرستادنِ
 * چند عکس می‌ترکد و همان شکستِ نیمه‌کاره تکرار می‌شود. */
console.log('\n▶ اعتبارسنجی قبل از اولین ارسال تمام می‌شود');
{
  const SRC = readFileSync(new URL('./send-owner.mjs', import.meta.url), 'utf8');
  const mapIdx = SRC.indexOf('items.map((it) => ({ ...it, abs: safePath');
  const sendIdx = SRC.search(/sendMessage|sendPhoto/);
  ok(mapIdx !== -1, 'همه‌ی مسیرها یک‌جا اعتبارسنجی می‌شوند');
  ok(mapIdx !== -1 && sendIdx !== -1 && mapIdx < sendIdx,
    'اعتبارسنجی **قبل از** اولین ارسال است');
}

console.log('\n▶ ورک‌فلو همین اسکریپت را صدا می‌زند (نه یک کپیِ شلی)');
{
  const wf = readFileSync(new URL('../.github/workflows/send-owner.yml', import.meta.url), 'utf8');
  ok(/node tools\/send-owner\.mjs/.test(wf), 'ورک‌فلو اسکریپت را اجرا می‌کند');
  ok(!/while IFS= read/.test(wf), 'حلقه‌ی شلیِ خط‌به‌خط برنگشته است');
  ok(/VOICE2TEXT_BOT_TOKEN/.test(wf) && /OWNER_TELEGRAM_ID/.test(wf),
    'از توکنِ موجود استفاده می‌کند، نه سکرتِ تازه');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
for (const e of errs) console.log(`   - ${e}`);
assert.equal(errs.length, 0, `${errs.length} خطای ارسال به مالک`);
