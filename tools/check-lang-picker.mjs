#!/usr/bin/env node
// چکِ انتخابگرِ زبانِ رباتِ واحدِ چندزبانه (lang-picker.js + سیمِ اتصالش در index.js).
//
// چرا وجود دارد: این اولین پیامِ **هر** کاربرِ تازه‌ی رباتِ واحد است. سه خرابیِ بی‌صدا
// ممکن است و هیچ‌کدام خطا نمی‌دهند:
//   ۱) پروفایل (نام/بیو) از سقفِ Bot API رد شود ⟵ setMyName رد می‌شود و ربات با نامِ
//      قبلی (روسی) می‌ماند، فقط یک logErr.
//   ۲) انتخابگر بعد از گیت/هدیه بیاید ⟵ کاربر پیامِ گیت را به زبانِ پیش‌فرض می‌بیند.
//   ۳) آزمایشِ مدلِ فارسی (reading_model_ds) در دیتابیسِ زبان‌های دیگر هم سید شود ⟵
//      کاربرِ انگلیسی/پرتغالی بی‌خبر وارد یک آزمایشِ فقط-فارسی می‌شود.
// بخشِ اول رفتاری است (ماژولِ خالص واقعاً اجرا می‌شود)، بخشِ دوم ساختاری (ترتیب در سورس).
//
// اجرا: node tools/check-lang-picker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(pathToFileURL(join(root, 'bots/tarot/lang-picker.js')).href);
const idxRaw = readFileSync(join(root, 'bots/tarot/index.js'), 'utf8');
// کامنت‌ها قبل از هر ادعای متنی حذف می‌شوند (همان تله‌ی ثبت‌شده‌ی چندباره).
const idx = idxRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error(`❌ ${msg}`); } };

// ── ۱) فهرستِ زبان‌ها ─────────────────────────────────────────────────────────
const codes = P.PICKER_LANGS.map(l => l.code);
ok(P.PICKER_LANGS.length >= 10 && P.PICKER_LANGS.length <= 15, 'فهرست باید ۱۰ تا ۱۵ زبان داشته باشد (خواسته‌ی مالک)');
ok(codes[0] === 'en', 'انگلیسی اولین زبانِ فهرست است (پیش‌فرض)');
ok(new Set(codes).size === codes.length, 'کدِ تکراری در فهرست نیست');
for (const c of ['en', 'es', 'ru', 'pt']) ok(codes.includes(c), `زبانِ ساخته‌شده‌ی ${c} در فهرست هست`);
ok(P.PICKER_LANGS.every(l => l.flag && l.name && /^[a-z]{2,3}$/.test(l.code)), 'هر زبان پرچم، نامِ بومی و کدِ معتبر دارد');
ok(!codes.includes('fa'), 'فارسی در انتخابگرِ رباتِ واحد نیست (رباتِ فارسی جداست)');

// ── ۲) ردیف‌ها و ✅ ──────────────────────────────────────────────────────────
const full = P.pickerRows(P.fullCodes(), 'en');
const flat = full.flat();
ok(flat.length === P.PICKER_LANGS.length, 'لیستِ کامل همه‌ی زبان‌ها را نشان می‌دهد');
ok(full.every(r => r.length <= 2), 'ردیف‌ها حداکثر دو ستونی‌اند');
ok(flat.filter(b => b.text.includes('✅')).length === 1, 'دقیقاً یک ✅ در لیست');
ok(flat[0].text.includes('✅') && flat[0].text.includes('English'), '✅ پیش‌فرض کنارِ انگلیسی است');
ok(flat.every(b => Buffer.byteLength(b.callback_data) <= 64), 'callback_data زیرِ سقفِ ۶۴ بایت');
const moved = P.pickerRows(P.fullCodes(), 'es').flat();
ok(moved.find(b => b.text.includes('✅'))?.callback_data === 'lang:es' && moved.filter(b => b.text.includes('✅')).length === 1,
   '✅ به زبانِ انتخاب‌شده جابه‌جا می‌شود و فقط یکی می‌ماند');
const sup = P.supportedCodes(['en', 'es', 'ru', 'pt']);
ok(JSON.stringify(sup) === JSON.stringify(['en', 'es', 'ru', 'pt']), 'supportedCodes ترتیبِ نمایش را نگه می‌دارد');
ok(JSON.stringify(P.supportedCodes(['pt', 'xx', 'en'])) === JSON.stringify(['en', 'pt']), 'supportedCodes زبانِ ناشناخته را حذف می‌کند');
const sRows = P.pickerRows(sup, 'en', 's').flat();
ok(sRows.length === 4 && sRows.every(b => b.callback_data.endsWith(':s')), 'لیستِ «فقط ساخته‌شده‌ها» پسوندِ s دارد');
ok(P.pickerRows(sup, 'ru', 't').flat().every(b => b.callback_data.endsWith(':t')), 'لیستِ تنظیمات پسوندِ t دارد');

// ── ۳) رجکسِ callback، هر دو جهت ──────────────────────────────────────────────
for (const d of ['lang:en', 'lang:fr', 'lang:es:s', 'lang:ru:t']) ok(P.LANG_CB.test(d), `LANG_CB باید «${d}» را بپذیرد`);
for (const d of ['lang:', 'lang:EN', 'lang:en:x', 'lang:en:s:t', 'xlang:en', 'lang:english']) ok(!P.LANG_CB.test(d), `LANG_CB نباید «${d}» را بپذیرد`);
ok(flat.every(b => P.LANG_CB.test(b.callback_data)), 'همه‌ی دکمه‌های ساخته‌شده با LANG_CB جور درمی‌آیند');

// ── ۴) متن‌ها: انگلیسی، بدونِ «—» ─────────────────────────────────────────────
const texts = [P.PICKER_TEXT.ask, P.PICKER_TEXT.unsupported, ...Object.values(P.LANG_UI).flatMap(Object.values),
  P.UNIFIED_PROFILE.name, P.UNIFIED_PROFILE.short, P.UNIFIED_PROFILE.description];
ok(texts.every(t => typeof t === 'string' && t.length > 0), 'همه‌ی متن‌ها رشته‌ی ناخالی‌اند');
ok(texts.every(t => !t.includes('—') && !t.includes('--')), 'هیچ «—» یا «--» در متن‌ها نیست (بند ۱۰ ریشه)');
ok(![P.PICKER_TEXT.ask, P.PICKER_TEXT.unsupported].some(t => /[؀-ۿ]/.test(t)), 'پیامِ انتخابگر فارسی ندارد (انگلیسیِ پیش‌فرض)');
ok(/available/i.test(P.PICKER_TEXT.unsupported) && /soon/i.test(P.PICKER_TEXT.unsupported), 'پیامِ زبانِ ناموجود «به‌زودی» را می‌گوید');
for (const c of ['en', 'es', 'ru', 'pt']) ok(P.LANG_UI[c]?.button && P.LANG_UI[c]?.ask && P.LANG_UI[c]?.saved, `LANG_UI برای ${c} کامل است`);
ok(P.langUi('xx') === P.LANG_UI.en, 'langUi برای زبانِ ناشناخته به انگلیسی برمی‌گردد');

// ── ۵) سقف‌های Bot API برای پروفایل ──────────────────────────────────────────
ok(P.UNIFIED_PROFILE.name.length <= 64, `نام ≤۶۴ نویسه (الان ${P.UNIFIED_PROFILE.name.length})`);
ok(P.UNIFIED_PROFILE.short.length <= 120, `بیو ≤۱۲۰ نویسه (الان ${P.UNIFIED_PROFILE.short.length})`);
ok(P.UNIFIED_PROFILE.description.length <= 512, `توضیح ≤۵۱۲ نویسه (الان ${P.UNIFIED_PROFILE.description.length})`);
ok(!/[؀-ۿЀ-ӿ]/.test(P.UNIFIED_PROFILE.name + P.UNIFIED_PROFILE.short),
   'نام و بیو انگلیسی‌اند (نه فارسی/روسی)');

// ── ۶) سیمِ اتصال در index.js (ساختاری) ───────────────────────────────────────
const start = idx.match(/if \(!user\.welcomed\) \{[\s\S]*?return startOnboarding\(ctx, uid\);/)?.[0] || '';
ok(start, 'شاخه‌ی کاربرِ آنبوردنشده‌ی handleStart پیدا شد');
const iPick = start.indexOf('showLangPicker(ctx, uid)'), iGate = start.indexOf('needsGate(user)');
ok(iPick >= 0 && iGate >= 0 && iPick < iGate, 'انتخابگرِ زبان قبل از گیت/هدیه می‌آید');
ok(/if \(MULTI_LANG && !user\.lang\) return showLangPicker/.test(start), 'انتخابگر فقط برای پروسه‌ی چندزبانه و کاربرِ بدونِ زبان');

const act = idx.match(/bot\.action\(LANG_CB,[\s\S]*?\n\}\);/)?.[0] || '';
ok(act, 'هندلرِ bot.action(LANG_CB) پیدا شد');
ok(/if \(!MULTI_LANG\)/.test(act), 'هندلر در پروسه‌ی تک‌زبانه کاری نمی‌کند');
ok(/if \(!PICKER_BY_CODE\[code\]\)/.test(act), 'کدِ ناشناخته رد می‌شود');
const iTrack = act.indexOf("'lang_picked'"), iSup = act.indexOf('if (!supported)');
ok(iTrack >= 0 && iSup >= 0 && iTrack < iSup, 'lang_picked قبل از شاخه‌ی «ناموجود» ثبت می‌شود (تحقیقِ بازار)');
ok(/stmts\.setLang\.run\(code, uid\)/.test(act), 'زبان در DB نوشته می‌شود');
ok(/return withLang\(code, \(\) => afterLangPicked\(/.test(act), 'ادامه‌ی سفر داخلِ زمینه‌ی زبانِ تازه اجرا می‌شود');
const iSet = act.indexOf('stmts.setLang.run'), iSupRet = act.indexOf('if (!supported)');
ok(iSupRet < iSet, 'زبانِ ناموجود هرگز در users.lang نوشته نمی‌شود');

ok(/if \(LOCALE === 'fa'\) db\.prepare\(`\s*INSERT OR IGNORE INTO experiments/.test(idx),
   'سیدِ آزمایشِ مدلِ خوانش فقط برای فارسی است');
ok(/if \(LOCALE !== 'fa'\) db\.prepare\(`\s*UPDATE experiments SET status='stopped'/.test(idx),
   'آزمایشِ مدلِ خوانش در دیتابیسِ زبان‌های دیگر متوقف می‌شود');
ok(/async function installUnifiedProfile\(\) \{\s*if \(!MULTI_LANG\) return;/.test(idx),
   'پروفایلِ انگلیسی فقط روی پروسه‌ی چندزبانه نصب می‌شود');
ok(/cur\?\.\[field\] === UNIFIED_PROFILE\[key\]\) continue/.test(idx), 'پروفایل فقط وقتی فرق دارد نوشته می‌شود (سقفِ نرخ)');
ok(/GATE_FREE_CMD = new Set\(\[[^\]]*'\/language'/.test(idx), '/language پشتِ گیت نمی‌ماند');
ok(/data\.startsWith\('lang:'\)/.test(idx), 'دکمه‌های lang: از گیتِ عضویت عبور می‌کنند');

// ── ۷) کنترلِ مثبت: ادعای ترتیب پوچ نیست ─────────────────────────────────────
const swapped = start.replace('if (MULTI_LANG && !user.lang) return showLangPicker(ctx, uid);', '')
  .replace('return startOnboarding(ctx, uid);', 'if (MULTI_LANG && !user.lang) return showLangPicker(ctx, uid);\nreturn startOnboarding(ctx, uid);');
const sPick = swapped.indexOf('showLangPicker(ctx, uid)'), sGate = swapped.indexOf('needsGate(user)');
ok(!(sPick < sGate), 'کنترلِ مثبت: جابه‌جاییِ انتخابگر به بعد از گیت واقعاً ادعا را می‌شکند');

console.log(`${fails ? '❌' : '✅'} check-lang-picker: ${passes} پاس، ${fails} خطا`);
if (fails) process.exit(1);
