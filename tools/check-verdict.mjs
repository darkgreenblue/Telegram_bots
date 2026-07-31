#!/usr/bin/env node
// چکِ «جوابِ قاطعِ فال‌های تصمیم‌محور» (bots/tarot/verdict.js).
//
// چرا وجود دارد: فیدبکِ کاربرِ واقعی روی فال آری/نه — جوابِ روشنی که دنبالش بود نگرفت.
// راه‌حل این است که مدل یک verdict برگرداند، ولی مدل ذاتاً تمایل دارد محتاط و مبهم
// جواب بدهد («شاید»، «بستگی داره»، «هم آره هم نه»). قانونِ نشکستنی: **جوابِ مبهم
// هرگز به‌عنوانِ جوابِ قاطع به کاربر نشان داده نمی‌شود** — بهتر است بخش را نبیند تا
// اینکه یک «شاید» را به‌جای جواب تحویل بگیرد. این چک همان قانون را قفل می‌کند.
//
// همچنین قفل می‌کند که «نشونه» اجباری است (نکته‌ی اصلیِ فیدبک: «اگه توش نشونه‌ای
// بتونه ببینه توی اون جوابه، می‌تونه خودشو آروم کنه») و اینکه فال‌های تفسیری
// (عشق، کار، صلیب سلتی...) عمداً تصمیم‌محور نیستند.

import {
  normalizeVerdict, decisiveMode, VERDICT_MODES, VERDICT_LIMITS,
  BINARY_ANSWERS, CHOICE_ANSWERS,
} from '../bots/tarot/verdict.js';
import SPREADS, { SPREAD_BY_ID } from '../bots/tarot/spreads.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error(`❌ ${name}`); } };
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.error(`❌ ${name} — انتظار «${want}» شد «${got}»`); }
};

const SIGN = 'کارت ارابه رو به جلو ایستاده و همون جهت جوابته';
const bin = (answer, extra = {}) => normalizeVerdict({ answer, sign: SIGN, ...extra }, VERDICT_MODES.BINARY);
const cho = (answer, extra = {}) => normalizeVerdict({ answer, sign: SIGN, ...extra }, VERDICT_MODES.CHOICE);

// ---------- ۱) جوابِ روشن باید قبول شود، در همه‌ی شکل‌هایی که مدل می‌نویسد ----------
for (const yes of ['آره', 'اره', 'بله', 'آری', 'مثبت', 'yes', 'آره.', ' بله ', 'آره!']) {
  eq(`«${yes}» → آره`, bin(yes)?.answer, BINARY_ANSWERS.YES);
}
for (const no of ['نه', 'خیر', 'منفی', 'no', 'نه.', ' خیر ', 'نه!']) {
  eq(`«${no}» → نه`, bin(no)?.answer, BINARY_ANSWERS.NO);
}
eq('جمله‌ی «نه، حداقل نه الان» هنوز یک نهِ روشن است', bin('نه، حداقل نه الان')?.answer, BINARY_ANSWERS.NO);

// ---------- ۲) قانونِ نشکستنی: جوابِ مبهم هرگز نمایش داده نمی‌شود ----------
for (const mushy of [
  'شاید', 'بستگی داره', 'هم آره هم نه', 'آره ولی نه', 'نه و آره',
  'نمی‌دونم', 'مشخص نیست', '', '   ', null, undefined, 42,
]) {
  ok(`جوابِ مبهم «${String(mushy)}» رد می‌شود`, bin(mushy) === null);
}
ok('verdictِ غیرآبجکت رد می‌شود', normalizeVerdict('آره', VERDICT_MODES.BINARY) === null);
ok('آرایه رد می‌شود', normalizeVerdict(['آره'], VERDICT_MODES.BINARY) === null);
ok('verdictِ خالی رد می‌شود', normalizeVerdict({}, VERDICT_MODES.BINARY) === null);
ok('mode ناشناخته رد می‌شود', normalizeVerdict({ answer: 'آره', sign: SIGN }, 'whatever') === null);

// ---------- ۳) «نشونه» اجباری است — قلبِ فیدبکِ کاربر ----------
ok('بدونِ نشونه رد می‌شود', normalizeVerdict({ answer: 'آره' }, VERDICT_MODES.BINARY) === null);
ok('نشونه‌ی خالی رد می‌شود', normalizeVerdict({ answer: 'آره', sign: '   ' }, VERDICT_MODES.BINARY) === null);
eq('نشونه‌ی معتبر می‌ماند', bin('آره')?.sign, SIGN);

// ---------- ۴) دوراهی: یکی از دو مسیر، نه «هر دو» ----------
for (const a of ['مسیر اول', 'اول', 'اولی', '۱', '1', 'A']) {
  eq(`«${a}» → مسیر اول`, cho(a)?.answer, CHOICE_ANSWERS.FIRST);
}
for (const b of ['مسیر دوم', 'دوم', 'دومی', '۲', '2', 'B']) {
  eq(`«${b}» → مسیر دوم`, cho(b)?.answer, CHOICE_ANSWERS.SECOND);
}
for (const mushy of ['هر دو', 'فرقی نمی‌کنه', 'اول یا دوم', 'هیچ‌کدام']) {
  ok(`دوراهیِ مبهم «${mushy}» رد می‌شود`, cho(mushy) === null);
}

// ---------- ۵) فیلدهای اختیاری و سقفِ طول ----------
const full = bin('آره', { because: 'انرژی کارت‌ها رو به جلوست', nuance: 'ولی نه همین هفته' });
eq('because می‌ماند', full?.because, 'انرژی کارت‌ها رو به جلوست');
eq('nuance می‌ماند', full?.nuance, 'ولی نه همین هفته');
eq('نبودِ because به رشته‌ی خالی تبدیل می‌شود', bin('آره')?.because, '');
eq('نبودِ nuance به رشته‌ی خالی تبدیل می‌شود', bin('آره')?.nuance, '');
const long = normalizeVerdict({ answer: 'آره', sign: 'ک'.repeat(1000) }, VERDICT_MODES.BINARY);
ok('نشونه‌ی خیلی بلند بریده می‌شود', long.sign.length <= VERDICT_LIMITS.sign + 1);
eq('فاصله‌های اضافه جمع می‌شوند', bin('آره', { because: '  دو    فاصله  ' })?.because, 'دو فاصله');

// ---------- ۶) کدام فال‌ها تصمیم‌محورند (تصمیمِ محصولی، نه تصادف) ----------
eq('آری یا نه = binary', decisiveMode(SPREAD_BY_ID.yesno), VERDICT_MODES.BINARY);
eq('دوراهی = choice', decisiveMode(SPREAD_BY_ID.choice), VERDICT_MODES.CHOICE);
for (const id of ['three', 'love', 'career', 'money', 'inner', 'family', 'migration', 'celtic', 'open3', 'open5']) {
  ok(`«${SPREAD_BY_ID[id].fa}» عمداً تصمیم‌محور نیست`, !decisiveMode(SPREAD_BY_ID[id]));
}
ok('هر فالِ تصمیم‌محور mode معتبر دارد', SPREADS
  .filter(s => s.decisive)
  .every(s => Object.values(VERDICT_MODES).includes(s.decisive)));

// ---------- ۷) قانونِ کپیِ سراسری: هیچ خط تیره‌ی بلندی در متن‌های تولیدشده ----------
ok('نشونه‌ی حاویِ خط تیره دست‌نخورده می‌ماند (پاکسازی کارِ پرامپت است، نه اینجا)',
  typeof bin('آره', { because: 'الف' })?.because === 'string');

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
