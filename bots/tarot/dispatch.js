/* 🚦 تحویلِ آپدیت: یک صفِ مستقل per کاربر، به‌جای یک صفِ سراسری.
 *
 * ── مسئله ──────────────────────────────────────────────────────────────────
 * حلقه‌ی long polling تلگراف (`core/network/polling.js`) این است:
 *
 *     for await (const updates of this) await Promise.all(updates.map(handleUpdate))
 *
 * یعنی `getUpdates` بعدی تا وقتی **همه‌ی** هندلرهای بسته‌ی فعلی تمام نشوند صدا زده
 * نمی‌شود. هندلرِ فال داخلِ خودش منتظرِ جوابِ مدل می‌ماند (اندازه‌گیریِ زنده: میانگین
 * ۱۳ ثانیه، بیشینه ۴۷) و در تمامِ آن مدت هیچ آپدیتی از **هیچ کاربری** گرفته نمی‌شود.
 *
 * دیتای ۱۶ شهریور ۱۴۰۵ که این را ساخت: تپ‌های کاربران خوشه‌ای شده بودند. سهمِ تپ‌هایی
 * که در یک ثانیه با ≥۴ کاربرِ متمایز پردازش می‌شدند از ۰.۵٪ (۲۸ اوت، ۱.۷k تپ در روز)
 * به ۷۲.۶٪ رسید. یعنی ربات ساکت می‌ماند و بعد صف را یک‌جا خالی می‌کرد. و این CPU نبود:
 * تاروت در همان بازه ۱ ثانیه CPU در ۹۳ ثانیه مصرف می‌کرد، یعنی ۹۸.۸٪ عمرش پشتِ await.
 *
 * ── چرا صفِ per کاربر، نه جداسازیِ ساده ────────────────────────────────────
 * جداسازیِ ساده (هر آپدیت فوراً و مستقل) پولر را باز می‌کند ولی یک در را هم باز می‌کند:
 * دو هندلرِ **همان کاربر** می‌توانند هم‌زمان بدوند. ممیزیِ خصمانه‌ی کلِ فایل ۹ نقطه پیدا
 * کرد که آن‌وقت خراب می‌شوند و **هر ۹ تا درون-کاربری‌اند**. بدترینشان پولی است:
 * `processReceipt` ردیف را ۱۰ تا ۲۵ ثانیه `pending` نگه می‌دارد (دانلودِ عکس + ایجنت +
 * تأخیرِ عمدی) و `saveReceiptFile` عمداً وضعیت را عوض نمی‌کند؛ اگر کاربر در همان بازه
 * «انصراف» بزند ردیف `canceled` می‌شود و `approvePayment` که فقط
 * `['pending','waiting_review']` را می‌پذیرد بی‌صدا `null` برمی‌گرداند: پولِ واقعیِ
 * کاربر واریز شده، ایجنت رسید را تأیید کرده، و او هیچ اعتباری نمی‌گیرد و هیچ ردی
 * هم نمی‌ماند. امروز این اتفاق نمی‌افتد **فقط چون پولر قفل است** — یعنی قاعده‌ی
 * «رسیدِ ثبت‌شده هرگز لغو نمی‌شود» (بند ۹ب/۳ ریشه) را نه کد، که یک تصادفِ زمان‌بندی
 * نگه داشته.
 *
 * صفِ per کاربر آن در را اصلاً باز نمی‌کند، و یک قدم جلوتر می‌رود: امروز دو تپِ یک
 * کاربر که در **یک بسته** بیفتند از قبل هم‌زمان اجرا می‌شوند (`Promise.all`). بعد از
 * این تغییر آن هم غیرممکن می‌شود. پس این ماژول **یک کلاسِ ریسکِ موجود را حذف می‌کند**،
 * نه اینکه ریسکِ تازه اضافه کند. برای کاربرِ وسطِ فال رفتار دقیقاً مثل امروز می‌ماند
 * (تپش پشتِ کارِ خودش صبر می‌کند)، و برای بقیه قفل برداشته می‌شود.
 *
 * ── مرزها ──────────────────────────────────────────────────────────────────
 * • وبهوک هرگز جدا نمی‌شود: آن‌جا پاسخِ HTTP باید تا پایانِ هندلر باز بماند. این را
 *   امروز هیچ‌کس استفاده نمی‌کند ولی مسیرِ مهاجرتِ بعدی است، پس از حالا درست است.
 * • سقفِ `maxInflight`: بالای آن، به رفتارِ امروز برمی‌گردیم (منتظر می‌مانیم) نه اینکه
 *   آپدیت دور بریزیم. سرور ۹۶۱MB رم دارد و ۴۵۵MB در swap است، پس رشدِ بی‌سقف واقعاً
 *   خطرناک است. عددِ اندازه‌گیری‌شده: بیشینه‌ی فالِ هم‌زمان ۴ است، پس ۱۲۸ حاشیه‌ی زیاد
 *   دارد و در عملِ عادی هرگز فعال نمی‌شود.
 * • خطاها از قبل داخلِ خودِ `handleUpdate` به `bot.catch` می‌روند؛ `catch` این‌جا فقط
 *   برای این است که یک ردِ غیرمنتظره به `unhandledRejection` تبدیل نشود.
 * • رول‌بک: `SERIAL_DISPATCH = false` در index.js → این فایل اصلاً صدا زده نمی‌شود و
 *   رفتار بایت‌به‌بایت همان قبل است.
 */

// آپدیت‌هایی که «بازیگر» دارند. کلید از آی‌دیِ کاربر ساخته می‌شود چون صف per کاربر است.
const ACTOR_FIELDS = [
  'message', 'edited_message', 'channel_post', 'edited_channel_post',
  'business_message', 'edited_business_message', 'business_connection',
  'callback_query', 'inline_query', 'chosen_inline_result',
  'shipping_query', 'pre_checkout_query', 'poll_answer',
  'my_chat_member', 'chat_member', 'chat_join_request',
  'message_reaction', 'purchased_paid_media',
];

/** کلیدِ صف. کاربر → `u<id>`، وگرنه چت → `c<id>`، وگرنه یک صفِ محافظه‌کارانه‌ی مشترک. */
export function actorKey(update) {
  if (!update || typeof update !== 'object') return 'g';
  for (const f of ACTOR_FIELDS) {
    const v = update[f];
    if (!v || typeof v !== 'object') continue;
    // `poll_answer` به‌جای `from` فیلدِ `user` دارد.
    const uid = v.from?.id ?? v.user?.id;
    if (uid) return 'u' + uid;
    const cid = v.chat?.id ?? v.sender_chat?.id;
    if (cid) return 'c' + cid;
  }
  return 'g';
}

/**
 * `bot.handleUpdate` را می‌پیچد: فوراً برمی‌گردد (پولر آزاد می‌شود) ولی آپدیت‌های
 * **یک کاربر** پشتِ هم و به ترتیب اجرا می‌شوند.
 * خروجی: آبجکتِ آمار برای لاگ/تست.
 */
export function installSerialDispatch(bot, opts = {}) {
  const maxInflight = Number(opts.maxInflight) > 0 ? Number(opts.maxInflight) : 128;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const logErr = typeof opts.logErr === 'function' ? opts.logErr : () => {};

  const orig = bot.handleUpdate.bind(bot);
  const tails = new Map();          // key → { p: Promise, depth: number }
  // `queues` عمداً یک getter است: نشتیِ Map باید **رفتاری** سنجیده شود، نه با دیدنِ
  // یک خطِ `tails.delete` در سورس (جهشِ M5 دقیقاً از کنارِ آن ادعای آینه‌ای رد شد).
  const stats = { inflight: 0, peak: 0, queued: 0, backpressure: 0, done: 0, get queues() { return tails.size; } };

  bot.handleUpdate = function serialHandleUpdate(update, webhookResponse) {
    // وبهوک: پاسخ باید تا پایانِ کار باز بماند → عیناً رفتارِ اصلی.
    if (webhookResponse) return orig(update, webhookResponse);

    // فشارِ برگشتی: به رفتارِ امروز برمی‌گردیم (منتظر می‌مانیم)، هیچ آپدیتی دور نمی‌رود.
    if (stats.inflight >= maxInflight) {
      stats.backpressure++;
      if (stats.backpressure === 1 || stats.backpressure % 100 === 0)
        logErr(`⚠️ صفِ تحویل پر شد (inflight=${stats.inflight}) — موقتاً به حالتِ مسدود برگشتیم (بار #${stats.backpressure})`);
      return orig(update);
    }

    const key = actorKey(update);
    const entry = tails.get(key) || { p: Promise.resolve(), depth: 0 };
    entry.depth++;
    stats.inflight++;
    stats.queued++;
    if (stats.inflight > stats.peak) stats.peak = stats.inflight;

    const run = () => orig(update).catch((e) => logErr('dispatch:', e?.message || String(e)));
    // `then(run, run)`: شکستِ حلقه‌ی قبلی نباید صفِ این کاربر را برای همیشه بخواباند.
    entry.p = entry.p.then(run, run).then(() => {
      entry.depth--;
      stats.inflight--;
      stats.done++;
      // نشتیِ Map: وقتی صفِ یک کاربر خالی شد ردیفش برداشته می‌شود.
      if (entry.depth === 0 && tails.get(key) === entry) tails.delete(key);
    });
    tails.set(key, entry);
    return Promise.resolve();
  };

  log(`🚦 تحویلِ per-کاربر فعال شد (سقفِ هم‌زمانی: ${maxInflight})`);
  return stats;
}
