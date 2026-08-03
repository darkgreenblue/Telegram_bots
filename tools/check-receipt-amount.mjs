#!/usr/bin/env node
// چکِ «واحدِ پولِ رسید» — قفلِ باگی که یک‌بار پولِ واقعی خورد.
//
// باگِ واقعی (۱۴۰۵/۰۵/۱۲، ربات زنده‌ی tarot): رسیدِ بانکیِ ایرانی **ریال** چاپ می‌کند و
// فاکتورِ ما **تومان** است، ولی تبدیلِ این دو به عهده‌ی خودِ مدل گذاشته شده بود
// (`extracted.amount_toman`). کاربری هر سه پرداختش را یک صفر کمتر واریز کرد (۱۰۰k و ۵۰k
// و ۳۰k)، مدل عددِ چاپ‌شده را همان‌طور «تومان» گزارش کرد، paid == expected شد و ربات
// **هر سه را خودکار تأیید کرد**. یک‌دهمِ پول رسید و اعتبارِ کامل داده شد.
//
// این چک همان سناریو را روی هر سه کپیِ ایجنت اجرا می‌کند و انتظار دارد **هرگز** به
// تأییدِ خودکار نرسد. کپیِ پایتونیِ tabir هم با همان قرارداد چک می‌شود تا سه نسخه از هم
// دور نیفتند (درسِ `check-support-sync`/`check-analytics-sync`).
//
// اجرا: node tools/check-receipt-amount.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  fails++;
  console.error(`❌ ${msg}`);
}

// رسیدی که مدل دیده: عددِ چاپ‌شده + واحدِ چاپ‌شده + نظرِ خودِ مدل
const seen = (raw, currency, verdict = 'approve', reason_code = 'ok') => ({
  verdict, reason_code, reason_fa: '',
  extracted: { amount_raw: raw, amount_currency: currency },
  risk_flags: [],
});

for (const bot of ['tarot', 'voice2text']) {
  const mod = await import(join(root, 'bots', bot, 'cardpay.js'));
  const { decideReceipt, resolvePaidToman } = mod;
  const t = (msg) => `${bot}: ${msg}`;

  // ── ۱) خودِ باگ: عددِ فاکتور روی رسیدِ ریالی ────────────────────────────────
  // فاکتور ۱۰۰٬۰۰۰ تومان، رسید «۱۰۰,۰۰۰ ریال» = ۱۰٬۰۰۰ تومان. مدل هم تأیید کرده.
  const bug = decideReceipt(seen(100000, 'rial'), 100000);
  ok(bug.action !== 'approve', t('باگِ اصلی: رسیدِ ۱۰۰٬۰۰۰ ریالی برای فاکتورِ ۱۰۰٬۰۰۰ تومانی نباید تأیید شود'));
  ok(bug.action === 'review', t('باگِ اصلی باید به تصمیمِ انسانی برود (امضای اشتباهِ واحد)'));

  // همان سناریو با واحدِ ناخوانا (مدل واحد را نمی‌بیند) — باز هم نباید تأیید شود
  const bugNoUnit = decideReceipt(seen(100000, null), 100000);
  ok(bugNoUnit.action === 'review', t('عددِ برابرِ فاکتور با واحدِ ناخوانا = مبهم → بازبینیِ انسانی'));

  // و با پاسخِ **قدیمیِ** مدل (فقط amount_toman، بدونِ فیلدهای جدید): همان‌قدر امن
  const legacy = decideReceipt({
    verdict: 'approve', reason_code: 'ok', reason_fa: '',
    extracted: { amount_toman: 100000 }, risk_flags: [],
  }, 100000);
  ok(legacy.action === 'review', t('پاسخِ قدیمیِ مدل (amount_toman تنها) هم نباید خودکار تأیید شود'));

  // ── ۲) مسیرِ درست نباید بشکند ──────────────────────────────────────────────
  // پرداختِ صحیح: فاکتور ۱۰۰٬۰۰۰ تومان → رسید ۱٬۰۰۰٬۰۰۰ ریال
  ok(decideReceipt(seen(1000000, 'rial'), 100000).action === 'approve',
     t('پرداختِ درستِ ریالی (ده‌برابرِ فاکتور) باید تأیید شود'));
  // همان بدونِ واحدِ چاپ‌شده: چون در هر دو خوانش کافی است، بی‌خطر و قابلِ تأیید
  ok(decideReceipt(seen(1000000, null), 100000).action === 'approve',
     t('عددِ ≥ ده‌برابرِ فاکتور بدونِ واحد هم بی‌خطر است و تأیید می‌شود'));
  // رسیدی که واقعاً تومانی است و واحدش چاپ شده
  ok(decideReceipt(seen(100000, 'toman'), 100000).action === 'approve',
     t('رسیدِ صریحاً تومانی با مبلغِ برابرِ فاکتور باید تأیید شود'));

  // ── ۳) مبلغِ تومانِ محاسبه‌شده باید درست باشد (نه فقط تصمیم) ────────────────
  const okPay = decideReceipt(seen(1000000, 'rial'), 100000);
  ok(okPay.paid === 100000, t(`مبلغِ محاسبه‌شده باید ۱۰۰٬۰۰۰ تومان باشد (شد: ${okPay.paid})`));
  ok(okPay.basis === 'rial', t('مبنای تبدیل باید «ریالِ صریح» باشد'));

  // ── ۴) پرداختِ کمتر: هر ربات قرارداد خودش را دارد ──────────────────────────
  // فاکتور ۳۰٬۰۰۰ تومان، کاربر ۲۰۰٬۰۰۰ ریال (=۲۰٬۰۰۰ تومان) زده: واقعاً کمتر پرداخت کرده.
  // tarot مسیرِ اصلاحِ فاکتور دارد (v2.3.0 → action=underpaid)؛ voice2text عمداً ندارد و
  // مثل قبل رد می‌کند. این تفاوت **عمدی** است و همین‌جا قفل می‌شود تا سهواً یکی‌شان نشوند.
  const lowAction = bot === 'tarot' ? 'underpaid' : 'reject';
  const under = decideReceipt(seen(200000, 'rial', 'reject', 'amount_too_low'), 30000);
  ok(under.action === lowAction, t(`پرداختِ واقعاً کمتر باید «${lowAction}» بماند (شد: ${under.action})`));
  ok(under.paid === 20000, t(`مبلغِ پرداختِ کمتر باید ۲۰٬۰۰۰ تومان باشد (شد: ${under.paid})`));
  // و اگر مدل اشتباهاً تأییدش کرده بود، کد باید خودش پایین بکشدش (در هر دو ربات)
  const underMislabeled = decideReceipt(seen(200000, 'rial'), 30000);
  ok(underMislabeled.action === lowAction,
     t(`تأییدِ اشتباهِ مدل روی پرداختِ کمتر باید توسط کد اصلاح شود (شد: ${underMislabeled.action})`));

  // ── ۵) پرداختِ بیشتر همچنان تأیید و علامت‌گذاری می‌شود ──────────────────────
  const over = decideReceipt(seen(2000000, 'rial', 'reject', 'amount_too_low'), 100000);
  ok(over.action === 'approve', t('ردِ اشتباهِ مدل روی پرداختِ بیشتر باید به تأیید برگردد'));
  ok(over.overpaid === 200000, t(`overpaid باید ۲۰۰٬۰۰۰ باشد (شد: ${over.overpaid})`));

  // ── ۶) «اصلاً رسید نیست» ربطی به مبلغ ندارد ────────────────────────────────
  ok(decideReceipt(seen(null, null, 'reject', 'not_a_receipt'), 100000).action === 'not_a_receipt',
     t('not_a_receipt نباید با منطقِ مبلغ قاطی شود'));

  // ── ۷) resolvePaidToman خالص و مستقیم ──────────────────────────────────────
  ok(resolvePaidToman({ amount_raw: 500000, amount_currency: 'ریال' }, 50000).toman === 50000,
     t('واحدِ فارسیِ «ریال» باید شناخته شود'));
  ok(resolvePaidToman({ amount_raw: 50000, amount_currency: 'تومان' }, 50000).toman === 50000,
     t('واحدِ فارسیِ «تومان» باید شناخته شود'));
  ok(resolvePaidToman({ amount_raw: 50000, amount_currency: null }, 50000).basis === 'ambiguous',
     t('واحدِ نامعلوم با عددِ کمتر از ده‌برابر باید مبهم بماند'));
  ok(resolvePaidToman({}, 50000).basis === 'none', t('رسیدِ بدونِ مبلغ باید basis=none بدهد'));
}

// ── ۸) هم‌قراردادیِ سه کپی (JS×۲ و پایتون) ───────────────────────────────────
// اگر کسی یکی را عوض کند و بقیه را نه، همان‌جا دوباره واگرا می‌شویم.
const MARKERS = ['amount_raw', 'amount_currency', 'rial', 'toman'];
const sources = {
  'bots/tarot/cardpay.js': readFileSync(join(root, 'bots/tarot/cardpay.js'), 'utf8'),
  'bots/voice2text/cardpay.js': readFileSync(join(root, 'bots/voice2text/cardpay.js'), 'utf8'),
  'bots/tabir-khab/cardpay/agent.py': readFileSync(join(root, 'bots/tabir-khab/cardpay/agent.py'), 'utf8'),
};
for (const [file, src] of Object.entries(sources)) {
  for (const m of MARKERS) {
    ok(src.includes(m), `${file}: قرارداد «${m}» غایب است (سه کپیِ ایجنت باید هم‌قرارداد بمانند)`);
  }
  ok(!/amount_toman.*the paid amount you read/i.test(src),
     `${file}: دستورِ قدیمیِ «تبدیل را خودت انجام بده» هنوز در پرامپت است`);
}

if (fails) {
  console.error(`\n${fails} ادعا شکست خورد. تبدیلِ ریال↔تومان باید در کد بماند، نه در مدل.`);
  process.exit(1);
}
console.log(`✅ چکِ واحدِ مبلغِ رسید: ${passes} ادعا، همه سبز.`);
