#!/usr/bin/env node
/* گاردِ پنجره‌ی امنِ دیپلوی.
 *
 * قاعده‌ای که این گارد نگه می‌دارد: مرجِ روزانه‌ی مالک نباید رباتِ زنده را وسطِ اوج
 * ری‌استارت کند، ولی **هیچ‌وقت** نباید مسیرِ رساندنِ یک فیکسِ فوری را ببندد.
 *
 * این دو خواسته در تنش‌اند و هر دو جهتِ خطا گران است:
 *   • گاردِ شل ⟵ دیپلوی ساعت ۲۲ و فلوی نیمه‌کاره‌ی کاربرِ واقعی.
 *   • گاردِ سفت ⟵ رباتِ خوابیده که تا فردا صبح فیکسش نمی‌رسد. امروز (۱۶ شهریور)
 *     دقیقاً همین اتفاق نزدیک بود بیفتد: بازیابیِ اضطراری ساعتِ ۱۱ تهران اجرا شد.
 * پس هر دو جهت این‌جا ادعای صریح دارند، نه فقط جهتِ «نگذار برود».
 *
 * چکِ CI **همان تابعی** را صدا می‌زند که ورک‌فلو صدا می‌زند، نه بازنویسیِ منطق (بند ۶ب).
 */
import { readFileSync } from 'node:fs';
import { decide, tehranHour, SAFE_HOURS, PREFERRED_HOURS, BYPASS_MARKER } from './deploy-window.mjs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

console.log('\n▶ ۱) هر ۲۴ ساعت، تصمیمِ درست');
const BLOCKED = [20, 21, 22, 23, 0, 1, 2, 3, 10, 13, 14, 15, 16, 19];
for (let h = 0; h < 24; h++) {
  const d = decide({ hour: h });
  const expect = SAFE_HOURS.includes(h);
  ok(d.go === expect, `ساعت ${String(h).padStart(2, '0')} ⟵ ${d.go ? 'برو' : 'صبر کن'}${expect === d.go ? '' : ' (اشتباه!)'}`);
}
ok(BLOCKED.every((h) => !decide({ hour: h }).go), 'هیچ‌کدام از ساعت‌های ممنوع/پرهیز باز نیست');
ok(SAFE_HOURS.length + BLOCKED.length === 24, 'دو مجموعه با هم دقیقاً ۲۴ ساعت را می‌پوشانند (هیچ ساعتی جا نیفتاده)');
ok(PREFERRED_HOURS.every((h) => SAFE_HOURS.includes(h)), 'پنجره‌ی هدف زیرمجموعه‌ی ساعت‌های امن است');

console.log('\n▶ ۲) ساعتِ ۲۲ و ساعتِ ۱۰ — دو موردی که دیتا صریح ردشان کرد');
ok(!decide({ hour: 22 }).go, 'ساعتِ ۲۲ (۵۶ برابرِ ساعتِ ۰۶ اکشن) هرگز باز نیست');
ok(!decide({ hour: 10 }).go, 'ساعتِ ۱۰ باز نیست (جهشِ ورودِ پستِ کانال، سه برابرِ ۰۹)');
ok(decide({ hour: 8 }).go && decide({ hour: 9 }).go, 'پنجره‌ی هدف ۰۸ و ۰۹ باز است');

console.log('\n▶ ۳) پروتکلِ فوری — مسیرِ فیکس هرگز بسته نمی‌شود');
for (const h of BLOCKED) {
  const d = decide({ hour: h, urgent: true, reason: 'ربات خوابیده' });
  if (!d.go) { ok(false, `پروتکلِ فوری در ساعتِ ${h} کار نکرد`); break; }
}
ok(BLOCKED.every((h) => decide({ hour: h, urgent: true, reason: 'x' }).go),
  'urgent در **همه‌ی** ساعت‌های ممنوع عبور می‌کند (وگرنه رباتِ خوابیده تا فردا می‌ماند)');
ok(BLOCKED.every((h) => decide({ hour: h, commitMsg: `fix ${BYPASS_MARKER}` }).go),
  `نشانگرِ ${BYPASS_MARKER} هم در همه‌ی ساعت‌های ممنوع عبور می‌کند`);

// دلیل اجباری است: استثنایی که ردّ مکتوب نداشته باشد، فردا قاعده می‌شود.
const noReason = decide({ hour: 22, urgent: true, reason: '' });
ok(noReason.error === true && noReason.go === false, 'urgent بدونِ دلیل رد می‌شود، نه اینکه بی‌صدا عبور کند');
ok(decide({ hour: 22, urgent: true, reason: '   ' }).error === true, 'دلیلِ فقط-فاصله هم قبول نیست');
ok(decide({ hour: 22, urgent: true, reason: 'ربات خوابیده' }).why.includes('ربات خوابیده'),
  'دلیل در پیامِ خروجی می‌آید (همان چیزی که به تلگرامِ مالک می‌رود)');

console.log('\n▶ ۴) هر عبور باید برچسبِ bypass بخورد تا اطلاع‌رسانی شود');
ok(decide({ hour: 22, urgent: true, reason: 'x' }).bypass === 'urgent', 'عبورِ urgent برچسب دارد');
ok(decide({ hour: 22, commitMsg: BYPASS_MARKER }).bypass === 'deploy-now', 'عبورِ نشانگر برچسب دارد');
ok(decide({ hour: 8 }).bypass === '', 'دیپلویِ عادیِ داخلِ پنجره برچسبِ عبور ندارد ⇒ پیامِ بی‌مورد نمی‌رود');

console.log('\n▶ ۵) fail-open روی ورودیِ خراب');
// یک گاردِ خرابِ **بسته** یعنی هیچ فیکسی به رباتِ زنده نمی‌رسد؛ آن از دیپلویِ
// بدموقع خطرناک‌تر است. پس ساعتِ نامعتبر باز می‌کند، ولی صریح می‌گوید چرا.
for (const bad of [undefined, null, NaN, -1, 24, 99, '8', 8.5]) {
  const d = decide({ hour: bad });
  ok(d.go === true && /نامعتبر/.test(d.why), `ساعتِ نامعتبر ${JSON.stringify(bad)} ⟵ باز، با توضیح`);
}

console.log('\n▶ ۶) ساعتِ تهران درست حساب می‌شود');
// ۰۰:۰۰ UTC = ۰۳:۳۰ تهران (ایران از ۲۰۲۲ ساعتِ تابستانی ندارد)
ok(tehranHour(new Date('2026-09-07T00:00:00Z')) === 3, 'نیمه‌شبِ UTC ⟵ ساعتِ ۳ تهران');
ok(tehranHour(new Date('2026-09-07T04:35:00Z')) === 8, 'کرونِ ۰۴:۳۵ UTC ⟵ ساعتِ ۸ تهران (وسطِ پنجره‌ی هدف)');
ok(tehranHour(new Date('2026-09-07T05:35:00Z')) === 9, 'کرونِ ۰۵:۳۵ UTC ⟵ ساعتِ ۹ تهران');
ok(tehranHour(new Date('2026-01-15T04:35:00Z')) === 8, 'در زمستان هم همان است (بدونِ DST)');
/* ⚠️ ادعای واقعیِ **دو** کرون، نه یکی. نسخه‌ی اولِ این ادعا می‌گفت «کرونِ اول با هر
 * تأخیری امن می‌افتد» و قرمز شد — و درست قرمز شد: با دقیقاً ۲ ساعت تأخیر، کرونِ اول
 * روی ساعتِ ۱۰ می‌نشیند که ممنوع است. این باگِ چک نبود، خودِ دلیلِ وجودِ کرونِ دوم بود.
 * خاصیتی که واقعاً لازم است این است: برای هر تأخیرِ ۰ تا ۴ ساعت (بازه‌ی دیده‌شده روی
 * همین ریپو، بند ۳ج)، **حداقل یکی** از دو کرون در ساعتِ امن بیفتد. */
const lateOk = (d) => {
  const h1 = tehranHour(new Date(Date.UTC(2026, 8, 7, 4 + d, 35)));
  const h2 = tehranHour(new Date(Date.UTC(2026, 8, 7, 5 + d, 35)));
  return SAFE_HOURS.includes(h1) || SAFE_HOURS.includes(h2);
};
for (const d of [0, 1, 2, 3, 4]) {
  const h1 = tehranHour(new Date(Date.UTC(2026, 8, 7, 4 + d, 35)));
  const h2 = tehranHour(new Date(Date.UTC(2026, 8, 7, 5 + d, 35)));
  ok(lateOk(d), `با ${d} ساعت تأخیر: کرون‌ها روی ${h1} و ${h2} ⟵ حداقل یکی امن`);
}
// و اگر یک کرون بود، این خاصیت برقرار نبود ⇒ کرونِ دوم تزئینی نیست.
ok(![0, 1, 2, 3, 4].every((d) => SAFE_HOURS.includes(tehranHour(new Date(Date.UTC(2026, 8, 7, 4 + d, 35))))),
  'یک کرونِ تنها این تضمین را نمی‌داد ⇒ کرونِ دوم لازم است، نه اضافی');

console.log('\n▶ ۷) سیم‌کشی در ورک‌فلو');
const WF = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
ok(/run: node tools\/deploy-window\.mjs/.test(WF), 'ورک‌فلو همین ماژول را صدا می‌زند');
ok((WF.match(/run: node tools\/deploy-window\.mjs/g) || []).length === 2,
  'هر دو جابِ دیپلوی (pm2 و tabir) گیت دارند — نه اینکه نیمی از دیپلوی گیت‌نخورده برود');
ok(/if: steps\.gate\.outputs\.go == 'true'/.test(WF), 'استپِ دیپلوی به خروجیِ گیت مشروط است');
ok(/steps\.changed\.outputs\.deploy == '1' && steps\.gate\.outputs\.go == 'true'/.test(WF),
  'tabir هم به گیت مشروط است، در کنارِ شرطِ تغییر');
ok(/COMMIT_MSG: \$\{\{ github\.event\.head_commit\.message \}\}/.test(WF),
  'پیامِ کامیت از راهِ env می‌آید (ضدِ تزریقِ shell)');
ok(!/\$\{\{ *github\.event\.head_commit\.message *\}\}/.test(WF.replace(/COMMIT_MSG: \$\{\{ github\.event\.head_commit\.message \}\}/g, '')),
  'و هیچ‌جای دیگری مستقیم داخلِ اسکریپت درج نشده');
ok(/cron: '35 4 \* \* \*'/.test(WF) && /cron: '35 5 \* \* \*'/.test(WF),
  'دو کرونِ جبرانی در پنجره‌ی هدف ثبت شده‌اند');
ok(/steps\.gate\.outputs\.bypass != ''/.test(WF), 'عبور از پنجره به تلگرامِ مالک اطلاع داده می‌شود');
ok(/uses: actions\/checkout@v4/.test(WF.slice(0, WF.indexOf('- name: Deploy to VPS'))),
  'جابِ دیپلوی قبل از گیت چک‌اوت می‌کند (وگرنه اسکریپت روی رانر نیست)');

console.log(`\n${errs.length ? '❌' : '✅'} ${pass} ادعا سبز، ${errs.length} قرمز`);
if (errs.length) { for (const e of errs) console.log(`   • ${e}`); process.exit(1); }
