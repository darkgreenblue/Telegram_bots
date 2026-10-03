// 🕐 گاردِ قاعده‌ی ساعتِ پرداختِ رسید (tarot v3.147.0، خواسته‌ی مالک ۱۴۰۵/۰۷/۱۱).
//
// ایجنت فقط ساعتِ چاپ‌شده در رسید را **می‌خواند**؛ هر مقایسه‌ای در کدِ خالصِ `receipt-time.js` است.
// این چک عمداً رفتاری است: خودِ ماژول‌ها import و اجرا می‌شوند، و سیم‌کشیِ index.js جدا سنجیده می‌شود
// (گاردِ آینه‌ای به‌تنهایی کافی نیست، بند ۶ب ریشه). هر ادعای منفی کنارش یک کنترلِ مثبت دارد.
//
// قواعدِ مالک که این‌جا قفل‌اند:
//   ۱) تکراری: HH:MM دقیقاً برابرِ یکی از رسیدهای قبلیِ همان کاربر ⟵ مشکوک. بدونِ تبدیلِ ۱۲/۲۴.
//   ۲) بازه: لحظه‌ی ارسال در [ساعتِ رسید، +۳۰ دقیقه]، بدونِ ارفاق. فقط این‌جا خوانشِ ۱۲ساعته امتحان می‌شود.
//   ۳) ساعتِ نال/غایب ⟵ مشکوک (دستی). غایب‌بودنِ کلید در جوابِ مدل ⟵ دوباره پرسیده شود.
//   ۴) مشکوک فقط ترمز است: هیچ ردِ خودکاری از این قاعده نمی‌آید.
import { readFileSync } from 'fs';
import { parsePaidTime, validateVerdict, systemPrompt, analyzeReceipt } from '../bots/tarot/cardpay.js';
import { receiptTimeSuspicion, tehranMinuteOfDay, timeFlagLine, RECEIPT_TIME_WINDOW_MIN } from '../bots/tarot/receipt-time.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

// لحظه‌ی یونیکس برای یک ساعتِ تهران (UTC+3:30، بدونِ ساعتِ تابستانی از ۱۴۰۱).
const tehran = (hh, mm) => {
  let t = Date.UTC(2026, 9, 3, hh, mm) / 1000 - 3.5 * 3600;
  return t;
};

console.log('\n▶ parsePaidTime: فقط می‌خواند، تبدیل نمی‌کند');
{
  const P = (x) => parsePaidTime(x);
  ok(P('14:05').hhmm === '14:05', 'HH:MM ساده');
  ok(P('۱۴:۰۵').hhmm === '14:05', 'ارقامِ فارسی');
  ok(P('٢:٠٥').hhmm === '02:05', 'ارقامِ عربی + صفرِ پیشوند');
  ok(P('14:05:33').hhmm === '14:05', 'ثانیه دور ریخته می‌شود');
  ok(P('2:05 PM').hhmm === '02:05', 'PM دور ریخته می‌شود و +۱۲ **نمی‌شود** (تبدیل کارِ قاعده‌ی بازه است)');
  ok(P('2:05 ب.ظ').hhmm === '02:05', 'نشانگرِ فارسیِ عصر هم فقط دور ریخته می‌شود');
  ok(P(null).valid && P(null).hhmm === null, 'null معتبر است (رسید ساعت ندارد)');
  ok(P('null').valid && P('null').hhmm === null, 'رشته‌ی "null" هم همان');
  ok(!P('24:00').valid && !P('14:60').valid, 'ساعتِ ناممکن نامعتبر است');
  ok(!P('دیروز').valid && !P(1405).valid && !P({}).valid, 'متن/عدد/آبجکت نامعتبر است');
}

console.log('\n▶ validateVerdict: کلیدِ ساعت باید باشد (null مجاز، غایب نه)');
{
  const base = { verdict: 'approve', reason_code: 'ok', extracted: { amount_raw: 300000 } };
  ok(validateVerdict(base, { requireTime: true }) === 'missing_paid_time', 'کلیدِ غایب ⟵ دوباره پرسیده شود');
  ok(validateVerdict({ ...base, extracted: { ...base.extracted, paid_time: null } }, { requireTime: true }) === null, 'null پذیرفته می‌شود');
  ok(validateVerdict({ ...base, extracted: { ...base.extracted, paid_time: 'ظهر' } }, { requireTime: true }) === 'bad_paid_time', 'ساعتِ ناخوانا ⟵ دوباره پرسیده شود');
  ok(validateVerdict(base, { requireTime: false }) === null, 'کنترلِ مثبت: پرچمِ خاموش ⟵ رفتارِ قبلی');
  ok(validateVerdict({ verdict: 'reject', reason_code: 'not_a_receipt' }, { requireTime: true }) === null,
    'بدونِ extracted («اصلاً رسید نیست») ساعت نمی‌خواهد');
}

console.log('\n▶ پرامپت: خاموش = بیت‌به‌بیت قبلی');
{
  const off = systemPrompt({ amount_toman: 30000 }, false, false);
  const on = systemPrompt({ amount_toman: 30000 }, false, true);
  ok(!/paid_time/.test(off), 'پرچمِ خاموش ⟵ هیچ اثری از paid_time در پرامپت');
  ok(/paid_time/.test(on) && /status bar/i.test(on) && /Do NOT convert/i.test(on),
    'پرچمِ روشن ⟵ کلید + نادیده‌گرفتنِ ساعتِ گوشی + ممنوعیتِ تبدیل');
  ok(on.startsWith(off.slice(0, 200)), 'سرِ پرامپت دست‌نخورده است (فقط اضافه می‌شود)');
}

console.log('\n▶ analyzeReceipt: کلیدِ غایب ⟵ تلاشِ بعدیِ زنجیره');
{
  const replies = [
    JSON.stringify({ verdict: 'approve', reason_code: 'ok', reason_fa: 'x', extracted: { amount_raw: 300000 }, risk_flags: [] }),
    JSON.stringify({ verdict: 'approve', reason_code: 'ok', reason_fa: 'x', extracted: { amount_raw: 300000, paid_time: '14:05' }, risk_flags: [] }),
  ];
  let i = 0;
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: replies[i++] } }] }) });
  const v = await analyzeReceipt({ apiKey: 'k', models: ['a', 'b'], text: 'رسید', fetchImpl, paidTime: true });
  ok(v.agent.ok && v.agent.model === 'b' && v.agent.attempts[0].error === 'missing_paid_time',
    'جوابِ اول بی‌ساعت رد و مدلِ دوم پرسیده شد');
  ok(v.extracted.paid_time === '14:05', 'ساعتِ مدلِ دوم در خروجی می‌ماند');
  i = 0;
  const v0 = await analyzeReceipt({ apiKey: 'k', models: ['a', 'b'], text: 'رسید', fetchImpl, paidTime: false });
  ok(v0.agent.model === 'a', 'کنترلِ مثبت: پرچمِ خاموش ⟵ همان جوابِ اول پذیرفته می‌شود');
  const dead = async () => ({ ok: false, status: 500 });
  const vf = await analyzeReceipt({ apiKey: 'k', models: ['a'], text: 'x', fetchImpl: dead, paidTime: true });
  ok(!vf.agent.ok && vf.verdict === 'review', 'همه‌ی تلاش‌ها شکست ⟵ review (هرگز تأییدِ خودکار)');
}

console.log('\n▶ receiptTimeSuspicion');
{
  const S = (paidTime, h, m, prevTimes = []) => receiptTimeSuspicion({ paidTime, uploadSec: tehran(h, m), prevTimes });
  ok(RECEIPT_TIME_WINDOW_MIN === 30, 'بازه دقیقاً ۳۰ دقیقه');
  ok(tehranMinuteOfDay(tehran(14, 10)) === 14 * 60 + 10, 'ساعتِ ارسال به وقتِ تهران');
  ok(S('14:05', 14, 10) === null, 'ارسال ۵ دقیقه بعد ⟵ سالم');
  ok(S('14:10', 14, 10) === null, 'همان دقیقه ⟵ سالم');
  ok(S('13:40', 14, 10) === null, 'دقیقاً ۳۰ دقیقه ⟵ سالم (مرز داخل)');
  ok(S('13:39', 14, 10)?.code === 'window', '۳۱ دقیقه ⟵ مشکوک (بدونِ ارفاق)');
  ok(S('14:11', 14, 10)?.code === 'window', 'ساعتِ رسید یک دقیقه **بعد** از ارسال ⟵ مشکوک (بدونِ ارفاق)');
  ok(S('23:50', 0, 10) === null, 'عبور از نیمه‌شب درست حساب می‌شود');
  ok(S('02:05', 14, 10) === null, 'خوانشِ ۱۲ساعته فقط در قاعده‌ی بازه: ۰۲:۰۵ ≈ ۱۴:۰۵');
  ok(S('12:05', 0, 10) === null, '۱۲:۰۵ ⟵ ۰۰:۰۵');
  ok(S('02:05', 9, 0)?.code === 'window', 'کنترلِ مثبت: هیچ‌کدام از دو خوانش نمی‌نشیند ⟵ مشکوک');
  ok(S('14:05', 14, 10, ['14:05'])?.code === 'repeat', 'همان HH:MMِ رسیدِ قبلی ⟵ تکراری');
  ok(S('14:05', 14, 10, ['02:05']) === null, 'تکراری بدونِ تبدیلِ ۱۲/۲۴ (۰۲:۰۵ ≠ ۱۴:۰۵)');
  ok(S('14:05', 9, 0, ['14:05'])?.code === 'repeat', 'تکراری بر بازه مقدم است');
  ok(S(null, 14, 10)?.code === 'no_time' && S('', 14, 10)?.code === 'no_time', 'بدونِ ساعت ⟵ مشکوک (دستی)');
  ok(S('14:05', 14, 10, [null, '', 'xx']) === null, 'ردیف‌های خالی/خراب در سابقه تکراری نمی‌سازند');
}

console.log('\n▶ timeFlagLine (فقط رو-به-ادمین)');
{
  ok(timeFlagLine(null) === '', 'سالم ⟵ هیچ خطی');
  ok(/پیدا نشد/.test(timeFlagLine({ code: 'no_time' })), 'no_time');
  ok(/۱۴:۰۵/.test(timeFlagLine({ code: 'repeat', hhmm: '14:05' })), 'repeat با ارقامِ فارسی');
  const w = timeFlagLine({ code: 'window', hhmm: '13:00', upload: '14:10' });
  ok(/۱۳:۰۰/.test(w) && /۱۴:۱۰/.test(w) && /۳۰/.test(w), 'window: ساعتِ رسید، ساعتِ ارسال و بازه');
  ok(!/[—]|--/.test(['no_time', 'repeat', 'window'].map((c) => timeFlagLine({ code: c, hhmm: '1', upload: '1' })).join('')),
    'بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)');
}

console.log('\n▶ سیم‌کشیِ index.js');
{
  const SRC = readFileSync('bots/tarot/index.js', 'utf8');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const a = CODE.indexOf('async function processReceipt(');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  ok(/const RECEIPT_TIME_CHECK_ENABLED = true;/.test(CODE), 'پرچمِ رول‌بک RECEIPT_TIME_CHECK_ENABLED');
  ok(/timeCheckOn = \(\) => RECEIPT_TIME_CHECK_ENABLED && !starsRail/.test(CODE), 'فقط ریلِ کارت (استارز رسید ندارد)');
  ok(/paidTime: timeCheckOn\(\)/.test(body), 'ایجنت با پرچمِ ساعت صدا زده می‌شود');
  const iSus = body.indexOf('receiptTimeSuspicion('), iRec = body.indexOf('recordReceiptAnalysis(');
  ok(iSus > 0 && iRec > iSus, 'ساعت‌های قبلی **قبل از** ثبتِ همین ردیف خوانده می‌شوند (رسید با خودش تکراری نمی‌شود)');
  ok(/ctx\?\.message\?\.date/.test(body), 'لحظه‌ی ارسال از خودِ پیامِ تلگرام');
  ok(/prevTimes: receiptTimesOf\(uid\)/.test(body), 'سابقه‌ی ساعت‌ها از رسیدهای قبلیِ **همین کاربر** خوانده می‌شود');
  const sql = CODE.match(/_raTimes \|\|= db\.prepare\("([^"]+)"\)/)?.[1];
  ok(!!sql, 'SQLِ سابقه از سورس برداشته شد');
  if (sql) {
    const { default: Database } = await import('../bots/tarot/node_modules/better-sqlite3/lib/index.js');
    const db = new Database(':memory:');
    db.exec("CREATE TABLE receipt_analyses (user_id INTEGER, paid_time TEXT NOT NULL DEFAULT '')");
    db.prepare('INSERT INTO receipt_analyses VALUES (1,?),(1,?),(2,?)').run('14:05', '', '09:00');
    const got = db.prepare(sql).all(1).map((r) => r.paid_time);
    ok(got.length === 1 && got[0] === '14:05', 'فقط ساعت‌های ناخالیِ همان کاربر (نه کاربرِ دیگر، نه خالی)');
  }
  ok(/timeSus = \{ code: 'no_time'/.test(body), 'خطای کد ⟵ fail-closed (دستی)، نه سکوت');
  const iSet = body.indexOf('if (timeSus) {'), iSlow = body.indexOf('slowApproveOn(p, uid, decision)');
  ok(iSet > 0 && iSlow > iSet && /stmts\.setSuspect\.run\(uid\)/.test(body.slice(iSet, iSlow)),
    'تگِ مشکوک **قبل از** تصمیمِ خودکار زده می‌شود (پس تأییدِ خودکار بسته است)');
  ok(/!isDistrusted\(uid\) && !isSuspect\(uid\)\s*\n?\s*;?/.test(CODE.slice(CODE.indexOf('const slowApproveOn'), CODE.indexOf('const slowApproveOn') + 400)),
    'slowApproveOn مشکوک را مستثنا می‌کند');
  ok(!/rejectPayment\w*\([^)]*\)[^\n]*timeSus/.test(body), 'قاعده‌ی ساعت هیچ ردِ خودکاری نمی‌سازد');
  ok(/ADD COLUMN paid_time TEXT NOT NULL DEFAULT ''/.test(CODE) && /ADD COLUMN time_flag TEXT NOT NULL DEFAULT ''/.test(CODE),
    'دو ستونِ افزایشی با DEFAULT (بند ۲ج/۱)');
  for (const fn of ['async function sendReceiptToAdmin(', 'async function sendSuspectApprovalToAdmin(']) {
    const s = CODE.indexOf(fn);
    ok(s > 0 && /receiptTimeLine\(paymentId\)/.test(CODE.slice(s, CODE.indexOf('\n}\n', s))), `${fn.split(' ')[2].replace('(', '')} خطِ ساعت را نشان می‌دهد`);
  }
  ok(/receipt-time\.js/.test(readFileSync('tools/check-undefined.mjs', 'utf8')), 'check-undefined ماژولِ تازه را می‌بیند');
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
