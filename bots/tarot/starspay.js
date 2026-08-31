// ماژولِ ریلِ پرداختِ Telegram Stars (`XTR`) — برای زبان‌های غیرفارسی.
// دوقلوی ساختاریِ `cardpay.js`: کپیِ محلی در خودِ ربات می‌ماند تا دیپلوی ایزوله بماند.
//
// ⚠️ قاعده‌ی حاکم (بند ۹ ریشه، «پول مقدس‌ترین چیز ریپو»): **این ماژول هیچ منطقِ پولی
// جدیدی نمی‌سازد.** واریزِ اعتبار همچنان از `approvePayment` همیشگی رد می‌شود، یعنی
// همان تابعی که کارت‌به‌کارت سال‌هاست از آن استفاده می‌کند. این‌جا فقط «چطور پول رسید»
// عوض می‌شود، نه «بعدش چه اتفاقی می‌افتد».
//
// چرا مرحله‌ی فاکتور و رسید حذف شد: خودِ تلگرام قبل از کسرِ استارز یک صفحه‌ی تأییدِ
// بومی نشان می‌دهد، پس فاکتورِ دست‌ساز یک قدمِ اضافه‌ی بی‌ارزش بود. «رسید» هم در این
// ریل اصلاً معنا ندارد چون پرداخت را خودِ تلگرام تأیید می‌کند، نه یک عکسِ قابلِ جعل.

/* 💎 نردبانِ قیمتِ استارز.
 *
 * `control` تصمیمِ مالک (۱۴۰۵/۰۶/۰۹) بعد از تحقیقِ قیمت است: ۵۰/۱۰۰/۲۵۰ با همان
 * نسبتِ ۱×/۲×/۵× نسخه‌ی فارسی. سه دلیلِ عدد ۵۰ برای بسته‌ی پایه:
 *   ۱) حداقلِ خریدِ استارز در تلگرام ۵۰ تاست، پس بسته‌ی ۵۰ دقیقاً یک شارژِ حداقلی
 *      است و خریدِ اول بدونِ باقی‌مانده و بدونِ اصطکاک انجام می‌شود.
 *   ۲) لنگرِ بازار: ARPPU واقعیِ ربات‌های استارز ماهی ~$۲.۷ تا $۴.۵ است.
 *   ۳) قیمتِ فارسی به قدرتِ خریدِ ایران لنگر خورده و لنگرِ درستی برای این بازارها نیست.
 *
 * `low` شاخه‌ی آزمایش است. طبق بند ۲ج/۴ قیمت یک **فرضیه** است نه یک ثابت، پس از روزِ
 * اول پشتِ A/B می‌نشیند و رول‌بکش بدونِ deploy از داشبورد انجام می‌شود. */
export const STARS_EXPERIMENT = 'stars_price_v1';
export const STAR_LADDERS = {
  control: { basic: 50, gold: 100, magic: 250 },
  low:     { basic: 35, gold: 70,  magic: 175 },
};

/* نسبتِ نردبان یک قاعده‌ی محصولی است، نه سلیقه: بسته‌ی دوم ۲ برابر و سومی ۵ برابرِ
 * بسته‌ی پایه. اگر روزی کسی یک نردبانِ تازه اضافه کند و این نسبت را بشکند، چکِ CI
 * قرمز می‌شود و همان‌جا جلویش گرفته می‌شود. */
export const LADDER_RATIO = { basic: 1, gold: 2, magic: 5 };

export function ladderFor(variantName) {
  return STAR_LADDERS[variantName] || STAR_LADDERS.control;
}

/** تعدادِ استارزِ یک بسته در یک نردبانِ مشخص. `null` = بسته‌ی ناشناخته (هرگز فاکتور نساز). */
export function starsFor(packKey, ladder) {
  const n = ladder && ladder[packKey];
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* payload تنها ریسمانِ بینِ فاکتور و کالِ‌بکِ پرداخت است. عمداً کوتاه و ساختاریافته
 * است (سقفِ ۱۲۸ بایتِ تلگرام) و **شناسه‌ی کاربر را هم در خود دارد**، چون هنگام
 * successful_payment باید مالکیتِ رکورد را چک کنیم و نه فقط وجودش را (بند ۹). */
export function buildPayload(paymentId, userId) {
  return `tp:${paymentId}:${userId}`;
}
export function parsePayload(payload) {
  const m = /^tp:(\d+):(\d+)$/.exec(String(payload || ''));
  if (!m) return null;
  return { paymentId: Number(m[1]), userId: Number(m[2]) };
}

/* آرگومان‌های `sendInvoice`. خالص و بدونِ شبکه نگه داشته شده تا چکِ CI بتواند بدونِ
 * توکن و بدونِ اینترنت صحتش را بسنجد (همان الگوی `check-tarot-video.mjs`).
 *
 * سه نکته‌ی الزامیِ Bot API که اگر رعایت نشوند فاکتور در زمانِ اجرا رد می‌شود:
 *   • `currency` باید دقیقاً `XTR` باشد.
 *   • `provider_token` برای استارز **خالی** است (هیچ سکرتِ پرداختی لازم نیست).
 *   • `prices` باید **دقیقاً یک آیتم** داشته باشد و `amount` خودِ تعدادِ استارز است،
 *     نه سِنت و نه ضرب‌درِ صد. */
export function buildInvoice({ pack, stars, paymentId, userId, title, description }) {
  if (!Number.isInteger(stars) || stars <= 0) throw new Error('starspay: invalid stars');
  if (!pack || !pack.key) throw new Error('starspay: invalid pack');
  return {
    title,
    description,
    payload: buildPayload(paymentId, userId),
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: title, amount: stars }],
  };
}

/* سیم‌کشیِ دو آپدیتِ پرداخت.
 *
 * `deps` عمداً تنگ است تا این ماژول به بدنه‌ی ربات گره نخورد:
 *   getPayment(paymentId)  → ردیفِ پرداخت یا undefined
 *   approve(paymentId)     → همان `approvePayment` ربات (تک‌منبعِ واریز)
 *   saveCharge(chargeId, paymentId)
 *   onCredited(uid, res)   → پیامِ موفقیت + ادامه‌ی فالِ رزروشده
 *   log / logErr
 */
export function registerStarsPay(bot, deps) {
  const { getPayment, approve, saveCharge, onCredited, log, logErr } = deps;

  /* ⏱ ددلاینِ ۱۰ ثانیه‌ایِ تلگرام. اگر جواب ندهیم پرداختِ کاربر شکست می‌خورد، پس
   * این‌جا هیچ کارِ کند و هیچ فراخوانیِ شبکه‌ای انجام نمی‌شود: فقط یک خواندنِ
   * سینکرونِ SQLite و جواب. این آخرین گاردِ ماست، نه یک تشریفات. */
  bot.on('pre_checkout_query', async (ctx) => {
    const q = ctx.update.pre_checkout_query;
    try {
      const parsed = parsePayload(q.invoice_payload);
      const p = parsed && getPayment(parsed.paymentId);
      const ok = Boolean(
        parsed
        && p
        && parsed.userId === q.from.id      // مالکیتِ رکورد (بند ۹)
        && p.user_id === q.from.id
        && p.status === 'pending',          // فاکتورِ کهنه یا قبلاً تأییدشده رد می‌شود
      );
      await ctx.answerPreCheckoutQuery(ok, ok ? undefined : 'این فاکتور دیگر معتبر نیست.');
      if (!ok) log?.('stars pre_checkout rejected:', q.invoice_payload);
    } catch (e) {
      logErr?.('stars pre_checkout:', e.message);
      // در خطا هم باید جواب برود، وگرنه کاربر پشتِ یک اسپینرِ ابدی می‌ماند
      await ctx.answerPreCheckoutQuery(false, 'خطای موقت. دوباره تلاش کن.').catch(() => {});
    }
  });

  /* پول نشست. `approve` همان مسیرِ همیشگی است و **خودش idempotent است** (فقط
   * وضعیت‌های pending/waiting_review را قبول می‌کند)، پس اگر تلگرام این آپدیت را
   * دوبار بفرستد اعتبار دوبار واریز نمی‌شود. */
  bot.on('successful_payment', async (ctx) => {
    const sp = ctx.message.successful_payment;
    const uid = ctx.from.id;
    try {
      const parsed = parsePayload(sp.invoice_payload);
      if (!parsed || parsed.userId !== uid) {
        logErr?.('stars payment with foreign payload:', sp.invoice_payload, uid);
        return;
      }
      // شناسه‌ی شارژ تنها کلیدِ `refundStarPayment` است؛ **قبل** از واریز ذخیره می‌شود
      // تا حتی اگر واریز به هر دلیلی بشکند، ردِ پول در دیتابیس مانده باشد.
      try { saveCharge(sp.telegram_payment_charge_id || '', parsed.paymentId); } catch (e) { logErr?.('stars saveCharge:', e.message); }
      const res = approve(parsed.paymentId);
      if (!res) { logErr?.('stars approve no-op for payment', parsed.paymentId); return; }
      await onCredited(uid, res);
    } catch (e) {
      logErr?.('stars successful_payment:', e.message);
    }
  });
}
