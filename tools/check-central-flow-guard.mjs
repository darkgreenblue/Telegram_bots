#!/usr/bin/env node
/*
 * قراردادِ گارد مرکزیِ تاروت.
 *
 * این تست عمداً خودِ دو تابعِ pure را از سورس استخراج و اجرا می‌کند؛ کپیِ محلی از
 * allowlist ندارد که همراهِ سورس کهنه شود. هدفش همان رگرسیونِ گزارش‌شده است: هیچ
 * callback نامربوطی، مخصوصاً `pkg:`، نباید `await_question` را از مسیر خارج کند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'bots/tarot/index.js'), 'utf8');
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`✅ ${message}`);
  else { console.error(`❌ ${message}`); failures++; }
};

function sourceFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}

function loadPure(name) {
  const body = sourceFunction(name);
  ok(!!body, `${name} از سورس استخراج شد`);
  return body ? Function(`return (${body});`)() : () => false;
}

const readingAllows = loadPure('readingFlowAllowsCallback');
const paymentAllows = loadPure('paymentFlowAllowsCallback');
const awaitingQuestion = loadPure('isAwaitingQuestionReading');

// فال: تنها CTA همان قدم می‌گذرد؛ دکمه‌ی فروشگاه کهنه دیگر هرگز سؤال را رسید نمی‌کند.
ok(!readingAllows('await_question', 'pkg:basic'), 'await_question دکمه‌ی بسته را مسدود می‌کند');
ok(!readingAllows('await_question', 'wallet_go'), 'await_question دکمه‌ی کیف را مسدود می‌کند');
ok(readingAllows('await_question', 'reading:cancel'), 'انصراف صریح از فال باز می‌ماند');
ok(readingAllows('picking', 'pick:12'), 'انتخاب کارت در همان فال مجاز می‌ماند');
ok(!readingAllows('picking', 'daily_go'), 'وسط انتخاب کارت، فال دیگر شروع نمی‌شود');
ok(readingAllows('confirm_pay', 'recharge'), 'شارژ از paywall شاخه‌ی فرزندِ همان فال است');
ok(!readingAllows('confirm_pay', 'pkg:gold'), 'confirm_pay بسته‌ی کهنه را مستقیم اجرا نمی‌کند');
ok(!readingAllows('confirm_pay', 'reading:resume'), 'reading:resume کهنه، paywall را با کاتالوگ جایگزین نمی‌کند');
ok(readingAllows('revealing', 'next:42:1'), 'قدم بعدِ افشا مجاز است');
ok(!readingAllows('revealing', 'reading:cancel'), 'فالِ در حال تحویل با انصراف کهنه حذف نمی‌شود');

// پرداخت: فقط قدم‌های همان پرداخت می‌گذرند؛ بازگشت از فروشگاه خروجِ خاموش نیست.
ok(paymentAllows('pay_amount', 'pkg:magic'), 'انتخاب بسته در پرداخت مجاز است');
ok(!paymentAllows('pay_amount', 'pay_back:9'), 'pay_back خروج خاموش از پرداخت نیست');
ok(!paymentAllows('pay_amount', 'daily_go'), 'وسط انتخاب بسته، فلوی دیگر شروع نمی‌شود');
ok(paymentAllows('pay_receipt', 'disc:9'), 'ورود به تخفیف در همان پرداخت مجاز است');
ok(paymentAllows('pay_receipt', 'pay_resume:9'), 'تکمیل پرداختِ یادآوری به فاکتورِ اصلی می‌رسد');
ok(paymentAllows('pay_receipt', 'pay_exit:9'), 'انصراف صریح از پرداخت مجاز است');
ok(!paymentAllows('pay_receipt', 'spread:love3'), 'وسط فاکتور، فال جدید شروع نمی‌شود');

// `/start` callback نیست. این همان شکاف واقعیِ تیکت TRT-6934733736 بود: کاربر پس از
// کسر الماس، پیش از نوشتن سؤال /start زد و بازیابیِ قبلی فقط فالِ «started» را می‌شناخت.
ok(awaitingQuestion({ status: 'paid', question: '', cards_json: '', question_audio: '' }),
  'فالِ پرداخت‌شده‌ی دقیقاً منتظر سؤال، قابل بازیابی است');
ok(!awaitingQuestion({ status: 'paid', question: '', cards_json: '', question_audio: 'voice-id' }),
  'سؤالِ صوتی به اشتباه به مرحله‌ی نوشتن سؤال برنمی‌گردد');
ok(!awaitingQuestion({ status: 'paid', question: 'سؤال', cards_json: '', question_audio: '' }),
  'فالِ بعد از ثبت سؤال به اشتباه به عقب برنمی‌گردد');
ok(!awaitingQuestion({ status: 'started', question: '', cards_json: '', question_audio: '' }),
  'فالِ در حال ساخت/تحویل با بازیابیِ سؤال قاطی نمی‌شود');

const centralAt = src.indexOf("/* 🔒 دروازه‌ی واحدِ همه‌ی دکمه‌ها");
const firstAction = src.indexOf('bot.action(');
ok(centralAt >= 0 && centralAt < firstAction, 'middleware مرکزی پیش از اولین action ثبت شده');
ok(src.includes('if (data && await blockCrossFlowCallback(ctx)) return;'), 'هر callback پیش از هندلر از گارد مرکزی عبور می‌کند');
ok(src.includes('await blockDuringActivePayment(ctx, wanted?.key, wanted?.arg)'), 'پرداختِ بی‌فاکتور هم گارد مرکزی دارد');
ok(src.includes("const text = p.step === 'receipt' ? L.errors.openInvoice : L.errors.openPaymentFlow;"), 'برای خریدِ نیمه‌کاره پیامِ درست می‌رود، نه پیامِ فاکتور');
const startBody = sourceFunction('handleStart');
const resumeQuestionAt = startBody.indexOf('resumeAwaitingQuestionFromDb(uid)');
const resetAt = startBody.indexOf("setState(uid, 'idle');");
ok(resumeQuestionAt >= 0 && resetAt >= 0 && resumeQuestionAt < resetAt,
  '/start پیش از پاک‌کردنِ سشن، فالِ پرداخت‌شده‌ی منتظر سؤال را بازیابی می‌کند');
ok(src.includes("awaitingQuestionReading: db.prepare("), 'کوئریِ اختصاصیِ فالِ منتظر سؤال وجود دارد');

if (failures) process.exit(1);
console.log('🎯 گارد مرکزیِ تغییر فلو سالم است.');
