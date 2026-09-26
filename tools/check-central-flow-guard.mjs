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
// تپِ تکراریِ قدمِ قبلی نباید گاردِ «ادامه یا انصراف» بسازد. خودِ هندلرها state-check
// دارند، پس فقط no-op/toast می‌شوند و هیچ فالِ پول‌داده‌ای را در معرض انصرافِ ناخواسته
// نمی‌گذارند (رگرسیون TRT-1957801074).
ok(readingAllows('picking', 'shuffle_stop'), 'تپِ تکراریِ توقف بُرزدن در انتخاب کارت بی‌خطر است');
ok(readingAllows('confirm_pay', 'pick:12'), 'تپِ دیررسِ کارت بعد از پایان انتخاب، گاردِ انصراف نمی‌سازد');
ok(readingAllows('revealing', 'shuffle_stop'), 'تپِ کهنه‌ی بُرزدن وسط تحویل، فقط بی‌اثر می‌شود');
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


/* 🔁 قانونِ «تپِ تکراری هرگز انصرافِ الماس‌سوز نمی‌سازد» (#TRT-1957801074 و خانواده‌اش).
 *
 * جدولِ زیر هر callbackِ «جلوبرنده»ی فال را با استیتی که بعد از اجرایش **ممکن است** در
 * آن باشیم جفت می‌کند. نسخه‌ی تکراریِ همان تپ پشتِ صفِ per کاربر دقیقاً در یکی از این
 * استیت‌ها می‌رسد، پس برای هر جفت باید گارد یا عبور بدهد یا فقط toast بزند. خودِ
 * گذارها هم از سورس سنجیده می‌شوند (ستونِ `from`/`to`)، تا جدول با کد کهنه نشود. */
const sameSpreadRetap = loadPure('sameSpreadRetap');
const LATER = ['shuffling', 'picking', 'confirm_pay', 'revealing'];
const STEPS = [
  { cb: 'spread:love3', handler: "bot.action(/^spread:(\\w+)$/", from: 'choose_spread', to: 'await_question', later: ['await_question'] },
  { cb: 'ready_breath', handler: "bot.action('ready_breath'", from: 'breathing', to: 'shuffling', later: LATER },
  { cb: 'shuffle_stop', handler: "bot.action('shuffle_stop'", from: 'shuffling', to: 'picking', later: LATER.slice(1) },
  { cb: 'pick:7', handler: 'bot.action(/^pick:(\\d+)$/', from: 'picking', to: 'picking', later: LATER.slice(1) },
];
function actionBody(head) {
  const at = src.indexOf(head);
  if (at < 0) return '';
  const next = src.indexOf('\nbot.action(', at + head.length);
  return src.slice(at, next < 0 ? at + 6000 : next);
}
for (const st of STEPS) {
  const body = actionBody(st.handler);
  ok(!!body, `هندلرِ ${st.cb} پیدا شد`);
  if (st.to !== st.from) {
    ok(body.includes(`'${st.to}'`) || (st.cb.startsWith('spread:') && body.includes("setState(uid, 'await_question')")),
      `${st.cb} استیت را به ${st.to} می‌برد (جدول با کد هم‌خوان است)`);
  }
  for (const state of st.later) {
    const passes = readingAllows(state, st.cb) || sameSpreadRetap(state, st.cb, 'love3');
    ok(passes, `تپِ تکراریِ ${st.cb} در ${state} گاردِ «ادامه یا انصراف» نمی‌گیرد`);
  }
}
// هر دکمه‌ی درون-قدمی که «ادامه» دوباره می‌سازد باید در جدولِ بالا باشد؛ وگرنه دکمه‌ی
// تازه‌ی فردا بی‌صدا همان باگ را برمی‌گرداند.
const resendBody = sourceFunction('resendCurrentStep');
const resendCbs = [...resendBody.matchAll(/button\.callback\([^,]+,\s*'([a-z_]+)'\)/g)].map((m) => m[1]);
ok(resendCbs.length >= 2, `دکمه‌های قدمِ فال از resendCurrentStep استخراج شد (${resendCbs.join(', ')})`);
for (const cb of resendCbs) {
  ok(STEPS.some((st) => st.cb === cb), `دکمه‌ی قدمِ «${cb}» در جدولِ تپِ تکراری پوشش دارد`);
}

// اندازه‌ی **همین** فال فقط toast است؛ اندازه‌ی دیگر یعنی تغییرِ نظر و همان گارد را می‌گیرد.
ok(sameSpreadRetap('await_question', 'spread:love3', 'love3'), 'تپِ دوباره روی اندازه‌ی همین فال فقط toast می‌گیرد');
ok(!sameSpreadRetap('await_question', 'spread:love5', 'love3'), 'اندازه‌ی دیگر همچنان گاردِ «ادامه یا انصراف» را می‌گیرد');
ok(!sameSpreadRetap('await_question', 'spread:love3', ''), 'بدونِ سشنِ معتبر هیچ تپی بلعیده نمی‌شود');
ok(!sameSpreadRetap('picking', 'spread:love3', 'love3'), 'بعد از ثبتِ سؤال، دکمه‌ی اندازه دوباره یعنی فالِ تازه (گارد)');
ok(!readingAllows('await_question', 'spread:love3'), 'کنترلِ مثبت: بدونِ sameSpreadRetap همین تپ گارد می‌گرفت');
// ⚙️ رفتاری، نه متنی: خودِ `blockCrossFlowCallback` از سورس اجرا می‌شود با وابستگی‌های
// ساختگی. نسخه‌ی اولِ این بخش رجکسی بود و جهشِ `if (false && sameSpreadRetap(...))` را
// سبز رد می‌کرد، چون متنِ فراخوانی سرِ جایش بود (بند ۶ب ریشه: گاردِ آینه‌ای).
const crossSrc = sourceFunction('blockCrossFlowCallback');
ok(!!crossSrc, 'blockCrossFlowCallback از سورس استخراج شد');
async function runCross({ state, data, spreadId = 'love3' }) {
  const calls = [];
  const deps = {
    NAV_GUARD_ENABLED: true,
    READING_FLOW_STATES: new Set(['confirm_focus', 'await_question', 'breathing', 'shuffling', 'picking', 'confirm_pay', 'revealing']),
    PAY_STATES: ['pay_amount', 'pay_receipt', 'pay_discount'],
    L: { reading: { sameSpreadRetap: 'TOAST' } },
    getState: () => state,
    getSession: () => ({ spreadId, readingId: 1 }),
    flowIntentFor: () => null,
    setIntent: () => {},
    resolveUnreadyReveal: async () => false,
    sameSpreadRetap,
    readingFlowAllowsCallback: readingAllows,
    paymentFlowAllowsCallback: paymentAllows,
    blockDuringOpenReading: async () => { calls.push('openReading'); return true; },
    blockDuringPendingReading: async () => { calls.push('pendingReading'); return true; },
    blockDuringDelivering: async () => { calls.push('delivering'); return true; },
    blockDuringActivePayment: async () => { calls.push('payment'); return true; },
  };
  const toasts = [];
  const ctx = { from: { id: 1 }, callbackQuery: { data }, answerCbQuery: async (t) => { toasts.push(t); } };
  const fn = crossSrc ? Function(...Object.keys(deps), `return (async ${crossSrc});`)(...Object.values(deps)) : async () => false;
  const swallowed = await fn(ctx);
  return { swallowed, calls, toasts };
}
{
  const r = await runCross({ state: 'await_question', data: 'spread:love3' });
  ok(r.swallowed === true && r.calls.length === 0 && r.toasts.includes('TOAST'),
    'اجرا: تپِ تکراریِ اندازه‌ی همین فال فقط toast می‌گیرد و به هیچ گاردی نمی‌رسد');
  const other = await runCross({ state: 'await_question', data: 'spread:love5' });
  ok(other.calls.includes('openReading'), 'اجرا: اندازه‌ی دیگر همان گاردِ «ادامه یا انصراف» را می‌گیرد');
  const nav = await runCross({ state: 'picking', data: 'wallet_go' });
  ok(nav.calls.includes('openReading'), 'کنترلِ مثبت: ناوبریِ واقعی وسطِ فال هنوز گارد می‌گیرد');
  for (const st of STEPS) {
    for (const state of st.later) {
      const x = await runCross({ state, data: st.cb });
      ok(x.calls.length === 0, `اجرا: تپِ تکراریِ ${st.cb} در ${state} به هیچ گاردی نمی‌رسد`);
    }
  }
}

// ✍️ متن/ویس بعد از ثبتِ سؤال: ادامه‌ی همان سؤال است، نه ترکِ فلو.
const inprog = /const READING_INPROGRESS = \[([^\]]+)\]/.exec(src);
const inprogStates = inprog ? [...inprog[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
const postQ = /const POST_QUESTION_STATES = new Set\(\[([^\]]+)\]\)/.exec(src);
const postQStates = postQ ? [...postQ[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
const expected = inprogStates.filter((s) => !['confirm_focus', 'await_question'].includes(s));
ok(expected.length >= 3 && JSON.stringify([...postQStates].sort()) === JSON.stringify([...expected].sort()),
  `هر استیتِ بعد از سؤال در POST_QUESTION_STATES است (${postQStates.join(', ')})`);
const textAt = src.indexOf("bot.on('text', async (ctx) => {");
const textBody = src.slice(textAt, src.indexOf('\n});', textAt));
const postTextAt = textBody.indexOf('if (POST_QUESTION_STATES.has(state)) {');
const openGuardAt = textBody.indexOf('if (await blockDuringOpenReading(ctx)) return;');
ok(postTextAt >= 0 && openGuardAt >= 0 && postTextAt < openGuardAt,
  'متنِ آزاد بعد از ثبتِ سؤال پیش از گاردِ انصراف گرفته می‌شود');
ok(/POST_QUESTION_STATES\.has\(state\)\) \{\s*await ctx\.reply\(L\.reading\.questionAlreadyTaken\);\s*return resendCurrentStep\(ctx, uid\);/.test(textBody),
  'متنِ بعد از سؤال: یک خطِ صادقانه + همان قدمِ جاری');
const voiceAt = src.indexOf("bot.on(['voice', 'audio'], async (ctx) => {");
const voiceBody = src.slice(voiceAt, src.indexOf('\n});', voiceAt));
const postVoiceAt = voiceBody.indexOf('POST_QUESTION_STATES.has(getState(uid))');
const silentAt = voiceBody.indexOf("if (getState(uid) !== 'await_question') return;");
ok(postVoiceAt >= 0 && silentAt >= 0 && postVoiceAt < silentAt, 'ویسِ بعد از سؤال دیگر بی‌صدا دور ریخته نمی‌شود');

if (failures) process.exit(1);
console.log('🎯 گارد مرکزیِ تغییر فلو سالم است.');
