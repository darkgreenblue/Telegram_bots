#!/usr/bin/env node
// 🗣 آزمایشگاهِ «گفتگوی پس از فال» — شبیه‌سازیِ کاملِ چند نوبت گفتگو، بدونِ تلگرام و
// بدونِ دیتابیس.
//
// چرا هست: کیفیتِ گفتگو را نمی‌شود با یک نوبت سنجید. مسئله‌های واقعیِ این فیچر
// (تکرارِ شکلِ خطِ آخر، قالبی‌شدنِ طول، از دست دادنِ نخِ گفتگو، chatbait) فقط وقتی
// دیده می‌شوند که **چند نوبتِ پشتِ سرِ هم روی یک فال** کنارِ هم گذاشته شوند. طی‌کردنِ
// دستیِ این مسیر در تلگرام یعنی هر بار یک فالِ کامل گرفتن و بعد ده‌ها پیام دادن؛
// عملاً بیشتر از دو سه نوبت تست نمی‌شد.
//
// ⚠️ این کپیِ ربات نیست: کانتکست، بسته‌بندیِ تاریخچه، ساختِ پیام‌ها، گاردهای بحران و
// تعارف، سنجه‌ی قلاب، پاکسازیِ خروجی و شرطِ پذیرش **همه** از `bots/tarot/chat-core.js`
// می‌آیند؛ پرامپت از `locales/<locale>.js` و کلاینتِ OpenRouter از `reading-core.js`.
// یعنی هر چیزی که این‌جا می‌بینی دقیقاً همان چیزی است که کاربر می‌گیرد.
//
// 💰 اقتصاد (مهم‌ترین خاصیتِ این ابزار): کلِ بودجه‌ی آزمایش‌ها **۲ دلار** است. پس
// **فالِ پایه روی دیسک کش می‌شود** و هر دورِ بعدی فقط بهای نوبت‌های گفتگو را می‌دهد.
// یک دورِ سه‌پرسونایی با ۵ نوبت ≈ ۱۵ فراخوانیِ کوتاه.
//
// اجرا:
//   node tools/chat-lab.mjs --fake                 # کلِ خطِ لوله، صفر شبکه، ~۲ ثانیه
//   node tools/chat-lab.mjs --fake --only P1
//   node tools/chat-lab.mjs                        # دورِ واقعی (فالِ پایه از کش)
//   node tools/chat-lab.mjs --refresh-base         # فالِ پایه را از نو بساز (گران)
//   node tools/chat-lab.mjs --arms modelA,modelB --reps 2 --out out.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ ترتیبِ این بلوک عمدی و شکننده است، دقیقاً مثل `reading-lab.mjs`:
 * `reading-core.js` و `checks.mjs` مسیرِ دادهٔ زبانی را **لحظه‌ی بارگذاریِ ماژول** از
 * `process.env.LOCALE` می‌خوانند. پس `--locale` باید قبل از هر importِ وابسته‌به‌زبان
 * خوانده شود و آن import ها پویا بمانند. */
const argvEarly = process.argv.slice(2);
const earlyVal = (n, d) => { const i = argvEarly.indexOf(`--${n}`); return i >= 0 ? argvEarly[i + 1] : d; };
const LOCALE = earlyVal('locale', process.env.LOCALE?.trim() || 'fa');
process.env.LOCALE = LOCALE;

const { SPREAD_BY_ID } = await import('../bots/tarot/spreads.js');
const { headlineOk } = await import('../bots/tarot/verdict.js');
const {
  drawCards, buildReadingCtx, renderV4, checkV4Shape, parseJsonLoose,
  orChatResilient, cardName, spreadName,
  READING_MODEL, FALLBACK_MODEL, FLASH, CHAT_MODEL, CHAT_PLAN,
  locSpread,
} = await import('../bots/tarot/reading-core.js');
const {
  buildChatCtx, packHistory, toMessages, messagesChars,
  cleanChatReply, chatOutOk, parseChatOut, hookOk, questionWordsOf,
  crisisIn, smallTalkIn, chatLang, CHAT_BUDGET, CHAT_RECENT_TURNS,
} = await import('../bots/tarot/chat-core.js');
// سنجه‌ها در ماژولِ خالصِ جدا هستند تا بدونِ اجرای پولی تست شوند (درسِ checks.mjs).
const { chatMetrics, repeatedNgrams, LINE_MIN, LINE_MAX } = await import('./reading-lab/chat-checks.mjs');
const { CHAT_FU_PROMPT_MAX } = await import('../bots/tarot/chat-core.js');
// 🎯 فهرستِ نوشته‌شده‌ی معیارهای کیفیت. **داور خودِ سشن است، نه یک مدلِ سوم** (تصمیمِ
// صریحِ مالک)؛ این فقط تضمین می‌کند ارزیابی روی یک فهرستِ ثابت بنشیند نه حافظه.
const { CHAT_RUBRIC, MAX: RUBRIC_MAX } = await import('./reading-lab/chat-rubric.mjs');
const LANG_MOD = await import(`./reading-lab/lang/${LOCALE}.mjs`);
const LANG = LANG_MOD.default;
const { configureLocale } = await import('../bots/tarot/locale-boot.js');

const L = (await import(`../bots/tarot/locales/${LOCALE}.js`)).default;
/* 🌍 **همان** تابعی که ربات سرِ boot صدا می‌زند. جا انداختنش یک دورِ کاملِ پولی را
 * می‌سوزاند بدونِ اینکه خطایی بدهد: `headlineOk` هر سرخطِ غیرفارسی را رد می‌کند (پس
 * ساختِ فالِ پایه شکست می‌خورد) و `configureChatLang` اجرا نمی‌شود، یعنی گاردِ بحران
 * و لیستِ chatbait برای زبان‌های غیرفارسی خالی می‌مانند و سنجه‌ی قلاب دروغ می‌گوید. */
configureLocale(L);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

/* حالتِ fake: کلِ خطِ لوله **واقعاً** اجرا می‌شود (کانتکست، بسته‌بندیِ تاریخچه، ساختِ
 * پیام‌ها، callbackِ validate، پاکسازی، همه‌ی سنجه‌ها، گزارش) و فقط پاسخ از یک استابِ
 * محلی می‌آید. استاب عمداً **نقصِ شناخته‌شده تزریق می‌کند** (خطِ آخرِ chatbait و جمله‌ی
 * بی‌لنگر) تا مسیرِ سنجش واقعاً اجرا شود، نه اینکه فقط از رویش رد شویم — همان درسی که
 * `--dry` در آزمایشگاهِ خوانش داد و یک دورِ ۹ فالی را سوزاند. */
const FAKE = flag('fake');
const ONLY = (val('only', '') || '').split(',').filter(Boolean);
const OUT = val('out', '');
const REPS = Math.max(1, parseInt(val('reps', '1'), 10));
const MAX_TURNS = parseInt(val('turns', '0'), 10) || 0;      // ۰ = همه‌ی follow_upها
const REFRESH_BASE = flag('refresh-base');
/* 👆 **حالتِ تپ** — بازتولیدِ قطعیِ همان کاری که مالک کرد: «یه بارم مکالمه رو همین‌جوری
 * تند تند فقط با دکمه‌ها بردم جلو… افتاد تو یه لوپ با جواب‌های به‌دردنخور و خیلی کوتاه».
 *
 * در این حالت، پیامِ نوبتِ بعد **خودِ برچسبی است که مدل در نوبتِ قبل ساخت**، دقیقاً مثل
 * تپ روی دکمه. سؤال‌های اسکریپت‌شده فقط وقتی استفاده می‌شوند که مدل برچسبی نداده باشد.
 * چرا این لازم بود: با سؤال‌های اسکریپت‌شده هر نوبت یک سؤالِ **تازه و پرمحتوا** به مدل
 * می‌رسد، پس حلقه ساختاراً ناممکن است و آزمایشگاه هرگز باگی را که مالک دید نمی‌بیند —
 * یعنی داشتیم مسیری را می‌سنجیدیم که خرابی در آن رخ نمی‌دهد. */
const TAP = flag('tap');
const BASE_FILE = path.resolve(HERE, val('base', 'reading-lab/.chat-base.json'));
/* کدام قدمِ هر پرسونا فالِ پایه شود. پیش‌فرض **آخرین** قدم: غنی‌ترین کانتکست (حافظه‌ی
 * انباشته و فال‌های قبلی) و ارزان‌ترین دور. `--steps all` هر سه را می‌گیرد. */
const STEPS = (val('steps', 'last') || 'last').trim();

/* 🤖 مدلِ تحتِ آزمایش. پیش‌فرض دقیقاً همان چیزی است که محصول اجرا می‌کند
 * (`CHAT_MODEL`)، پس یک اجرا بدونِ پرچم عیناً پروداکشن را می‌سنجد. برنامه‌ی retry هم
 * همان شکلِ `CHAT_PLAN` را نگه می‌دارد (دو تلاشِ مدلِ اصلی، بعد جمنای، بعد دیپ‌سیک) تا
 * مقایسه‌ی بین بازوها منصفانه بماند: اگر یکی چهار شانس بگیرد و دیگری دو تا، داریم
 * برنامه‌ی retry را می‌سنجیم نه مدل را. */
const ARMS = (val('arms', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const ARM_LIST = ARMS.length ? ARMS : [val('model', CHAT_MODEL)];
const planFor = (m) => [m, m, FLASH, FALLBACK_MODEL];

/* 🧪 واریانتِ **پرامپت** به‌عنوان بُعدِ دومِ بازو — عیناً همان الگوی `reading-lab.mjs`
 * و به همان دلیل: فرضیه‌ی پرامپت باید **جفت‌شده** سنجیده شود (همان فالِ پایه، همان
 * سؤال‌های پیگیری، همان مدل)، وگرنه با نویزِ نمونه‌برداری قاطی می‌شود. و چون واریانت
 * این‌جا زندگی می‌کند نه در `locales/fa.js`، یک فرضیه‌ی ردشده هیچ ردی در کدِ محصول
 * نمی‌گذارد. برنده که معلوم شد، در یک PR جدا به locale می‌رود.
 *
 * شکلِ بازو: `model` یا `model@variant`.
 *
 * ⚠️ دو گاردِ مکمل، چون هیچ‌کدام به‌تنهایی کافی نیست: `rep` (پایین) هر **لنگر** را
 * اجباری می‌کند، و `systemFor` بررسی می‌کند واریانت **در مجموع** چیزی عوض کرده. */
/* ⚠️ هر جایگزینی **باید** لنگرش را پیدا کند. `String.replace` وقتی چیزی پیدا نکند
 * بی‌صدا رشته‌ی دست‌نخورده را برمی‌گرداند، و گاردِ «واریانت چیزی را عوض نکرد» این را
 * برای واریانت‌های مرکب (`v3`/`v4` که اول `v2` را صدا می‌زنند) **نمی‌گیرد**: یک
 * جایگزینیِ خطاخورده وسطِ زنجیره، بازو را بی‌صدا به `v2` تبدیل می‌کند و ما یک دورِ
 * پولی خرج می‌کنیم تا «تفاوتی نبود» گزارش کنیم. پس هر لنگر همین‌جا اجباری است. */
const rep = (s, from, to) => {
  if (!s.includes(from)) {
    console.error(`❌ لنگرِ جایگزینیِ واریانت در پرامپت نیست: «${from.slice(0, 60)}…»`);
    console.error('   احتمالاً locale ویرایش شده. واریانت را با متنِ تازه هم‌تراز کن.');
    process.exit(1);
  }
  return s.split(from).join(to);
};

const PROMPT_VARIANTS = {
  /* 📭 `v5` هم برد و از v3.100.0 خودش پرامپتِ محصول است، پس طبقِ بند ۹/۰ ریشه **پاک شد
   * نه خاموش**: واریانتی که لنگرهایش دیگر در locale وجود ندارد، فقط بلد است دورِ بعد را
   * با خطای «لنگر پیدا نشد» بکُشد (همان سرنوشتِ `v2`).
   *
   * فرضیه‌اش یک ریشه‌ی مشترک برای چهار یافته بود: **خطِ آخر یک درخواستِ اجازه بود**
   * («می‌خوای … کنیم؟»). و چون `follow_up` «همان دعوتِ خطِ آخر از زبانِ کاربر» تعریف شده
   * بود، تنها چیزی که می‌شد ساخت جوابِ کاربر به آن درخواست بود: یا تأیید یا یک تودوی
   * اول‌شخص («معیارها رو مشخص کنم») — هیچ‌کدام سؤال نبودند، و همین بود که مالک گرفت.
   *
   * نتیجه‌ی دورِ جفت‌شده‌ی ۱۴۰۵/۰۶/۲۷ (۵۶ نوبت، `--set chat`):
   *   • C1 با `--tap`: قلابِ سالم **۲۵٪ ⟵ ۱۰۰٪**، برچسبِ سؤالِ واقعی **۲/۸ ⟵ ۸/۸**،
   *     تفاضلِ per سناریو −۷۵ واحد و یک‌دست.
   *   • C3 (فکتِ محصولی): دو جوابِ **غلطِ** خطِ پایه درست شدند.
   *   • C2 (اعتماد/قطعیت): هر دو بازو خوب، ولی v5 در نوبتِ **اول** هم صریح می‌گوید
   *     «هیچ‌چیز صددرصد قطعی نیست» — همان چیزی که جانشینِ پیامِ نادج شد.
   *
   * ⚠️ و یک رگرسیونِ ثبت‌شده که پنهان نمی‌شود: زیرِ کفِ محتوا **۲/۲۰ ⟵ ۴/۲۰** و طولِ
   * داخلِ هدف ۱۷/۲۰ ⟵ ۱۴/۲۰. دو قاعده‌ی «خبری بنویس» و «زاویه را نام ببر» جواب‌ها را
   * کمی کوتاه‌تر می‌کنند. آگاهانه پذیرفته شد چون مکانیزمِ `CHAT_FLOOR` (تعمیرِ آگاه +
   * ریفاندِ بی‌صدا) دقیقاً همین را می‌گیرد و رویدادِ `chat_thin` اندازه‌اش را در
   * پروداکشن گزارش می‌کند. اگر آن عدد بالا رفت، فرضیه‌ی دورِ بعد همین دو قاعده‌اند. */

  /* 🎁 `v5` — **بازوی مقایسه‌ی v3.104.0**، و عمداً برعکسِ همه‌ی واریانت‌های قبلی:
   * این‌بار پرامپتِ **محصول** v6 است و بازو همان v5ِ قبلی را برمی‌گرداند. پس `control`
   * (بدونِ واریانت) چیزی است که قرار است منتشر شود و `v5` وضعِ موجود است.
   *
   * چرا این شکل: تصمیمِ مالک روی خطِ آخر گرفته شده و کدِ محصول باید همان را حمل کند؛
   * بازو فقط برای **اندازه‌گیریِ اثر** لازم است، نه برای تصمیم. اگر برعکس بود، یک دورِ
   * نگرفته می‌توانست پرامپتِ ردشده را زنده نگه دارد.
   *
   * ⚠️ این بازو **دو چیز** را با هم برمی‌گرداند (خطِ آخر و مشخصاتِ `follow_up`)، پس
   * تک‌متغیره نیست. عمدی است: در v6 این دو یک تغییرِ به‌هم‌گره‌خورده‌اند (شکلِ برچسب
   * فقط در نسبت با شکلِ خطِ آخر معنی دارد) و تصمیمِ واقعی هم «v6 در برابرِ v5» است نه
   * «کدام نیمه». تفکیکِ اثر از خودِ سنجه‌ها می‌آید نه از بازو: `noOffer` فقط خطِ آخر را
   * می‌سنجد و `fuNoAsk`/`fuLong` فقط برچسب را. */
  v5: (p) => p
    .replace(
      `═══ خطِ آخر: پیشنهاد ═══
هر جواب، بدونِ استثنا، با یک **پیشنهاد** تمام می‌شود: کاری که **تو** برایش می‌کنی و اجازه‌اش را می‌گیری.
- فقط دو شکل: «می‌خوای …؟» یا «اگه بخوای می‌تونم … برات …». همیشه از زبانِ **تو**.
- ممنوع چون پیشنهاد نیست: خبرِ کارِ خودت («می‌نویسم»، «آماده می‌کنم»، «می‌تونیم … کنیم»، «می‌رسیم به…»)، سؤالِ خالیِ بی‌پیشنهاد، و زبانِ او («می‌خوام بدونم…»).`,
      `═══ خطِ آخر: دعوتِ ادامه ═══
هر جواب، بدونِ استثنا، با یک **دعوتِ مشخص برای ادامه** تمام می‌شود. مهم‌ترین خطِ جواب همین است.
- یک زاویه‌ی تازه‌ی مشخص را **نام ببر**، یا چیزی را که خودش نیم‌بند گفت بردار و بگو همان‌جا چه چیزی هنوز باز مانده. **خبری بنویس، نه درخواستِ اجازه**: «می‌خوای…؟»، «بریم سراغش؟» و «بررسی کنیم؟» ننویس.`)
    .replace('پیشنهادی که زیرِ جوابِ هر کسِ دیگری', 'جمله‌ای که زیرِ جوابِ هر کسِ دیگری')
    .replace('جمله باید همان پیشنهاد **باشد**', 'جمله باید همان دعوت **باشد**')
    .replace(
      'دربارهٔ همان چیزی که پیشنهاد دادی، همان‌طور که خودش تایپش می‌کرد: اول‌شخص، سؤالِ کامل که به «؟» تمام شود. **جوابِ پیشنهادِ تو نیست، سؤالِ خودش است.**',
      'دربارهٔ همان زاویه‌ی خطِ آخر، دقیقاً همان‌طور که خودش تایپش می‌کرد: اول‌شخص، و حتماً یک سؤالِ کامل که به «؟» تمام شود.')
    .replace('**حداکثر ۳۶ نویسه**، کوتاه‌تر بهتر، یک خط', 'حداکثر ۶۰ نویسه، یک خط'),

  /* 🎁 `v6` — بازوی **دورِ دومِ** همین PR، و برخلافِ `v5` این یکی واقعاً تک‌متغیره است:
   * فقط همان یک خطِ تازه را برمی‌دارد و باقیِ پرامپت بیت‌به‌بیت همان چیزی می‌ماند که
   * دورِ ۱۴۰۵/۰۶/۲۸ سنجید. پس تفاضلِ دو بازو دقیقاً اثرِ همان خط است.
   *
   * فرضیه از دیتا آمد نه از شهود: در آن دور ۶ نقض از ۱۹ ماند و **۵تایشان یک کلاس
   * بودند** — جوابِ فکتِ محصولی، ارجاع به پشتیبانی، و اشاره به یک دکمه. مدل آن‌جا را
   * استثنا می‌فهمید، چون «مرزها» و «فالِ تازه» می‌گویند «همین را بگو و تمام». نقضِ
   * ششم یک جوابِ زیرِ کفِ محتوا بود که مکانیزمِ `CHAT_FLOOR` خودش می‌گیردش.
   *
   * ⚠️ استثنای `wants_end` هم با همین بازو برداشته می‌شود، چون آن دو یک جمله‌اند. اثرش
   * روی عدد یک نوبت از ۱۹ است و جهتش معلوم: بازوی v6 آن‌جا هم «پیشنهاد نداد» می‌گیرد،
   * ولی سنجه از این نسخه معافش می‌کند، پس مقایسه به نفعِ هیچ بازویی کج نمی‌شود. */
  v6: (p) => p
    .replace(
      '\n- جوابِ فکتِ محصولی، ارجاع به پشتیبانی و اشاره به یک دکمه هم استثنا نیست؛ پیشنهادت آن‌جا به همین فال یا گفتگو برمی‌گردد. تنها استثنا: خودش دارد تمام می‌کند (wants_end).',
      ''),

  /* 📭 سه واریانتِ دورهای ۲ تا ۴ (`v2`, `v3`, `v4`) این‌جا بودند و هر سه
   * تکلیفشان روشن شد، پس طبقِ بند ۹/۰ ریشه پاک شدند نه خاموش:
   *
   * - **`v2` برنده شد و از v3.85.0 خودش پرامپتِ محصول است** (قفلِ لحنِ گفتاری +
   *   «اسمِ قلاب را نبر»؛ ۱۱/۱۵ ⟵ ۰/۱۵ و ۷/۱۵ ⟵ ۰/۱۵). نگه‌داشتنش این‌جا یعنی
   *   وصله‌ای که لنگرش دیگر در locale وجود ندارد، پس `rep` هر دورِ آینده را با خطا
   *   می‌کُشت — کدِ مرده‌ای که فقط بلد است خراب شود.
   * - **`v3` و `v4` رد شدند** و دلیلشان باید بماند چون یک **خانواده‌ی مداخله** را
   *   می‌بندد: هر دو صریح به مدل می‌گفتند «خط جدا کن»، و هر دو ۰/۳ گفتگو داخلِ هدف
   *   دادند در برابرِ ۱۱/۱۸ برای بازوهای بدونِ آن دستور. یعنی خواستنِ صریحِ
   *   خط‌بندی طولِ جواب را باد می‌کند. **دوباره امتحان نمی‌شود**؛ همان نیاز در
   *   `splitChatLines` به‌شکلِ قطعی و رایگان حل شد.
   *
   * خودِ مکانیزم (`rep`، `systemFor`، نحوِ `model@variant`) سرِ جایش است و واریانتِ
   * بعدی فقط یک ردیف این‌جاست. */
};
const armModel = (a) => String(a).split('@')[0];
const armVariant = (a) => String(a).split('@')[1] || '';
{
  const bad = ARM_LIST.map(armVariant).filter((v) => v && !PROMPT_VARIANTS[v]);
  if (bad.length) {
    console.error(`❌ واریانتِ پرامپتِ ناشناخته: ${[...new Set(bad)].join('، ')}`);
    console.error(`   موجود: ${Object.keys(PROMPT_VARIANTS).join('، ') || '(هیچ)'}`);
    process.exit(1);
  }
}
/* گاردِ «وصله واقعاً خورد». بدونِ این، یک ویرایشِ بی‌ربط در `locales/fa.js` که لنگرِ
 * `replace` را جابه‌جا کند، بازوی آزمایشی را بی‌صدا به بازوی پایه تبدیل می‌کند. */
function systemFor(variant) {
  const base = L.prompts.chatSystem;
  if (!variant) return base;
  const out = PROMPT_VARIANTS[variant](base);
  if (out === base) {
    console.error(`❌ واریانتِ «${variant}» هیچ تغییری در پرامپت نداد (لنگرِ replace عوض شده؟)`);
    process.exit(1);
  }
  return out;
}
/* فالِ پایه با **یک** مدل ساخته می‌شود و همه‌ی بازوها همان را می‌گیرند؛ وگرنه تفاوتِ
 * خروجیِ گفتگو می‌تواند از متنِ فالِ متفاوت بیاید نه از مدلِ گفتگو. */
const BASE_MODEL = val('base-model', READING_MODEL);

/* دو ثابتِ فراخوانی از **خودِ `index.js`** خوانده می‌شوند، نه کپیِ دستی: اگر فردا سقفِ
 * توکن یا قیمت عوض شود، این آزمایشگاه بی‌صدا چیزی را نمی‌سنجد که محصول اجرا نمی‌کند. */
const IDX = fs.readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const constOf = (name, dflt) => {
  const m = IDX.match(new RegExp(`const ${name}\\s*=\\s*(-?\\d+)`));
  return m ? Number(m[1]) : dflt;
};
const CHAT_MAX_TOKENS = constOf('CHAT_MAX_TOKENS', 500);
const CHAT_PRICE = constOf('CHAT_PRICE', 1);

/* 🌍 سناریوها per زبان، عیناً همان فایلِ آزمایشگاهِ خوانش (پرسوناها و فال‌هایشان یکی
 * است؛ فقط `follow_ups` اضافه شده). عمداً به فارسی fallback نمی‌کند: یک دورِ روسی با
 * سؤال‌های فارسی سبز تمام می‌شد و ما فکر می‌کردیم روسی را سنجیده‌ایم. */
/* `--scenarios <name>` مجموعه‌ی دیگری را بار می‌کند (بدونِ پسوند). تنها مصرفش امروز
 * `--scenarios adv` است: پرسونای بلندِ خصمانه عمداً **بیرونِ** مجموعه‌ی پیش‌فرض است تا
 * دورِ نرمال هزینه‌ی ۲۶ نوبتش را ندهد، و مهم‌تر، تا مقایسه‌ی عدم‌رگرسیون همیشه روی
 * همان پرسوناهای نرمال بنشیند (خواسته‌ی صریحِ مالک: تنظیم روی موردِ خصمانه، مسیرِ
 * ۹۹۹تای دیگر را خراب می‌کند). */
/* ⚠️ `--set` مترادفِ پذیرفته‌شده است، نه یک پرچمِ دوم: ورک‌فلوی `Reading lab` ورودیِ
 * `set` را برای **هر دو** ابزار به همان شکل پاس می‌دهد، و بدونِ این مترادف یک دورِ
 * `set: meta` بی‌صدا روی سناریوی **پیش‌فرض** اجرا می‌شد — یعنی گزارشِ سبز از چیزی که
 * اصلاً سنجیده نشده (همان کلاسِ `--dry`). نام‌گذاری هم عیناً همان قراردادِ
 * `reading-lab.mjs` است: `--set meta` ⟵ `scenarios.meta.json`. */
const SCEN_NAME = (val('scenarios', '') || val('set', '') || '').trim().toLowerCase();
const SCEN_FILE = path.join(HERE, 'reading-lab', SCEN_NAME
  ? `scenarios.${SCEN_NAME}.json`
  : (LOCALE === 'fa' ? 'scenarios.json' : `scenarios.${LOCALE}.json`));
if (!fs.existsSync(SCEN_FILE)) {
  console.error(`❌ سناریویی برای زبانِ «${LOCALE}» نیست: ${SCEN_FILE}`);
  process.exit(1);
}
const SCEN = JSON.parse(fs.readFileSync(SCEN_FILE, 'utf8'));
const personas = SCEN.personas.filter((p) => !ONLY.length || ONLY.includes(p.id));

/* ═══════════════ 🚦 پیش‌پرواز (قبل از خرجِ پول) ═══════════════ */
{
  const errs = [];
  if (!personas.length) errs.push(`هیچ پرسونایی با --only «${ONLY.join(',')}» پیدا نشد`);
  for (const p of personas) {
    if (!Array.isArray(p.follow_ups) || !p.follow_ups.length) {
      errs.push(`پرسونای ${p.id} هیچ follow_ups ندارد (سناریوی گفتگو بدونِ سؤالِ پیگیری بی‌معنی است)`);
    }
    for (const s of p.steps) if (!SPREAD_BY_ID[s.spread]) errs.push(`چیدمانِ ناشناخته: ${s.spread}`);
    if (p.focus && !L?.focusFa?.[p.focus]) {
      // ⚠️ این خطا نمی‌دهد، بی‌صدا همان کلمه را داخلِ پرامپت می‌گذارد (باگِ ثبت‌شده‌ی پرتغالی).
      errs.push(`focus ناشناخته: ${p.focus}`);
    }
  }
  if (!L?.prompts?.chatSystem) errs.push('این locale پرامپتِ گفتگو (`prompts.chatSystem`) ندارد');
  /* گاردِ زبان باید **رفتاری** باشد نه متنی (بند ۲و/۶ب ریشه): خالی بودنِ لیستِ
   * chatbait یعنی سنجه‌ی قلاب هیچ‌وقت قرمز نمی‌دهد و گزارش سبزِ دروغین می‌شود. */
  const lang = chatLang();
  if (!lang.chatbait?.length || !lang.crisis?.length) {
    errs.push(`گاردهای گفتگو برای «${LOCALE}» پیکربندی نشده‌اند (configureChatLang خالی ماند)`);
  }
  /* همین قاعده برای دادهٔ **سنجه‌ها** هم برقرار است و به همان دلیل: `chatMetrics` اگر
   * `bookish`/`hookLabel` را در `lang/<locale>.mjs` پیدا نکند بی‌صدا از رویشان رد
   * می‌شود و گزارش سبز می‌آید. دقیقاً همین اتفاق در دورِ ۱ افتاد (`bookish` وجود داشت
   * و صدا زده نمی‌شد) و ۷ جوابِ کتابی را بی‌صدا سبز کرد. نبودن باید بلند شکست بخورد. */
  for (const k of ['bookish', 'hookLabel']) {
    if (!LANG[k]) errs.push(`سنجه‌ی «${k}» در tools/reading-lab/lang/${LOCALE}.mjs نیست`);
  }
  if (errs.length) { for (const e of errs) console.error(`❌ ${e}`); process.exit(1); }
}

/* ═══════════════ 💾 کشِ فالِ پایه ═══════════════
 *
 * کلید: `<persona>:<step>:<baseModel>`. یک دور فقط وقتی فال می‌سازد که کش ردیفِ
 * متناظر را نداشته باشد؛ بقیه‌ی دورها فقط بهای نوبت‌های گفتگو را می‌دهند.
 *
 * ⚠️ حالتِ `--fake` **اصلاً به این فایل دست نمی‌زند** (نه می‌خواند نه می‌نویسد). اگر
 * می‌نوشت، یک اجرای بی‌ضررِ CI می‌توانست کش را با فالِ ساختگی پر کند و دورِ واقعیِ
 * بعدی روی متنِ قلابی اجرا شود — خرابیِ کاملاً بی‌صدا، دقیقاً همان کلاسی که این ریپو
 * بارها ثبت کرده. */
let baseCache = {};
if (!FAKE && fs.existsSync(BASE_FILE)) {
  try { baseCache = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) || {}; }
  catch (e) { console.error(`⚠️ کشِ پایه خوانده نشد (${e.message})؛ از صفر ساخته می‌شود.`); baseCache = {}; }
}
const cacheStat = { hit: 0, miss: 0 };
function saveCache() {
  if (FAKE) return;
  // بعد از **هر** فالِ تازه نوشته می‌شود، نه در انتها: یک کرشِ وسطِ دور نباید فال‌هایی
  // را که پولشان داده شده دور بریزد.
  try { fs.writeFileSync(BASE_FILE, JSON.stringify(baseCache, null, 2)); }
  catch (e) { console.error(`⚠️ کشِ پایه ذخیره نشد: ${e.message}`); }
}

/* ═══════════════ استابِ حالتِ fake ═══════════════ */
// فالِ پایه‌ی ساختگی ولی **معتبر**: باید از `checkV4Shape` و `headlineOk` رد شود تا
// مسیرِ پذیرش و رندر واقعاً اجرا شوند. متن از `lang/<locale>.mjs` می‌آید تا روی رباتِ
// غیرفارسی متنِ فارسی تولید نشود (همان دامِ ثبت‌شده‌ی reading-lab).
function fakeReading(cards, ctx) {
  const names = cards.map((c) => cardName(c.key));
  const F = LANG.fake;
  const q = String(ctx.question || '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
  return JSON.stringify({
    cards: names.map((n) => ({ teaser: F.teaser(n) })),
    headline: F.headline,
    pattern: F.pattern(names[0], names[names.length - 1], q),
    reads: names.map((n) => ({ text: F.read(n, q) })),
    callback: '',
    closing: F.closing(names[0], q),
    summary: F.summary, memory: F.memory,
  });
}

/* جوابِ ساختگیِ گفتگو. عمداً **سه شکل** دارد و دو تایش نقصِ شناخته‌شده‌اند، وگرنه
 * `--fake` سبز رد می‌شد بدونِ اینکه مسیرِ سنجه‌ها واقعاً چیزی پیدا کند:
 *   • نوبتِ ۱ در هر ۳: خطِ آخرِ **chatbait** (باید `hookOk` را قرمز کند)
 *   • نوبتِ ۲ در هر ۳: خطِ آخرِ **بی‌لنگر** (جمله‌ای که زیرِ فالِ هر کسِ دیگری هم می‌نشیند)
 *   • بقیه: خطِ آخرِ سالم — لنگرخورده به نامِ کارت **و** در شکلِ پیشنهادِ v6
 *     («می‌خوای … کنم؟»)، وگرنه سنجه‌ی تازه‌ی `noOffer` در `--fake` همیشه ۱۰۰٪ نقض
 *     گزارش می‌کرد و جهتِ سالمش هرگز در CI لمس نمی‌شد.
 * هر سه باید از `chatOutOk` رد شوند، وگرنه استاب به‌جای سنجیدنِ سنجه‌ها، مسیرِ شکستِ
 * مدل را می‌سنجد.
 * ⚠️ از ۱۴۰۵/۰۶/۲۲ استاب هم **پاکتِ JSON** می‌دهد، دقیقاً مثل مدلِ واقعی. اگر متنِ خام
 * می‌داد، `--fake` یک قراردادِ دیگر را تست می‌کرد و دورِ سبزش هیچ چیزی دربارهٔ
 * پروداکشن ثابت نمی‌کرد (همان درسِ `--dry`). */
function fakeChatReply(turnIdx, cardNames, question) {
  const card = cardNames[turnIdx % cardNames.length] || 'کارت';
  /* ⚠️ «؟» از نقلِ سؤال پاک می‌شود: استاب سه کلمه‌ی اولِ سؤالِ کاربر را عیناً داخلِ متن
   * می‌گذارد و سؤال‌های فارسیِ کوتاه علامتشان همان‌جاست، پس سنجه‌ی «حداکثر یک علامتِ
   * سؤال» یک ایرادِ **ساختگی** می‌دید که هیچ ربطی به رفتارِ مدل نداشت. تا v3.104.0
   * پنهان بود چون خطِ آخرِ سالمِ استاب علامتِ سؤال نداشت؛ با شکلِ پیشنهادیِ v6 دارد. */
  const q = String(question || '').replace(/[؟?]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
  const head = `جوابت این سمته، ولی به بهای صبر: ${card} همین را می‌گه.`;
  const mid = `حرفِ اصلی درباره‌ی «${q}» همینه و توی همین دست دیده می‌شه.`;
  const mode = turnIdx % 3;
  // پاکت، با همان کلیدهای پروداکشن. پرچم‌ها در استاب همیشه false اند: این‌جا نیتِ
  // مدل سنجیده نمی‌شود، فقط مسیرِ سنجه‌ها.
  /* ⚠️ برچسبِ دکمه هم عمداً **نقصِ شناخته‌شده** تزریق می‌کند (یکی meta، یکی assent، یکی
   * سالم)، وگرنه `--fake` سبز رد می‌شد در حالی که سنجه‌ی تازه‌ی برچسب هرگز لمس نشده —
   * دقیقاً همان کلاسی که این فایل برای `hookOk` بسته بود (بند ۶ب-۲ ریشه). */
  const FU = ['چرا این کارت این‌جا افتاد؟', 'سؤالمو می‌پرسم', 'آره بریم سراغش'];
  const env = (t) => JSON.stringify({
    answer: t, wants_new_reading: false, needs_support: false,
    follow_up: FU[turnIdx % FU.length], wants_end: false,
  });
  if (mode === 1) return env(`${head}\n${mid}\nسؤال دیگه‌ای داری؟`);
  /* ⚠️ این جمله عمداً با **هیچ‌کدام** از سؤال‌های سناریو و هیچ نامِ کارتی کلمه‌ی مشترک
   * ندارد، وگرنه `hookOk` لنگرش را پیدا می‌کند و نقصِ تزریقی بی‌صدا خنثی می‌شود —
   * یعنی `--fake` سبز رد می‌شود در حالی که مسیرِ `noanchor` هرگز لمس نشده. اگر
   * `follow_ups` عوض شد، کنترلِ مثبتِ پایینِ همین فایل قرمز می‌دهد. */
  if (mode === 2) return env(`${head}\n${mid}\nهمه چیز به مرور سرِ جای خودش می‌نشیند و آرامش برمی‌گردد.`);
  return env(`${head}\n${mid}\nمی‌خوای یه زاویه‌ی دیگه از ${card} رو برات باز کنم؟`);
}

/* ═══════════════ ساختِ فالِ پایه ═══════════════ */
async function buildBase(persona, step, i) {
  const key = `${persona.id}:${i}:${FAKE ? 'fake' : BASE_MODEL}`;
  if (!FAKE && !REFRESH_BASE && baseCache[key]) { cacheStat.hit++; return baseCache[key]; }
  cacheStat.miss++;

  const spread = SPREAD_BY_ID[step.spread];
  // seed ثابت per قدم، عیناً مثل آزمایشگاهِ خوانش: کشِ پایه و ساختِ تازه **همان
  // کارت‌ها** را می‌دهند، پس مقایسه‌ی بین دورها سالم می‌ماند.
  const cards = drawCards(`lab:${persona.id}:${i}`, step.picks || [0, 1, 2], spread.size);
  const ctx = buildReadingCtx({
    user: { telegram_id: 900000 + i, memory_json: '', focus_area: persona.focus },
    spread, question: step.question, cards, focusKey: persona.focus, L,
    name: persona.name, hideName: true, kbOn: true, prev: [],
  });
  const labels = L.prompts.cardLabels(cards.length);
  const system = L.prompts.readerSystemV4(locSpread(spread), labels);
  const userMsg = L.prompts.readingContext(ctx);

  let parsed = null, fallback = null;
  const call = FAKE
    ? (sys, usr, opts) => {
        const out = fakeReading(cards, ctx);
        return opts.validate(out) ? { out, model: 'fake', attempts: 1, usages: [] } : null;
      }
    : orChatResilient;
  const res = await call(system, userMsg, {
    maxTokens: spread.maxTokens,
    validate: (out) => {
      const obj = parseJsonLoose(out);
      if (!obj || !checkV4Shape(obj, cards.length)) return false;
      if (!headlineOk(obj.headline)) { fallback = obj; return false; }
      parsed = obj;
      return true;
    },
  }, [BASE_MODEL, BASE_MODEL, BASE_MODEL, FLASH, FALLBACK_MODEL]);
  if (!parsed && fallback) parsed = fallback;
  if (!parsed) throw new Error(`ساختِ فالِ پایه شکست خورد (${persona.id}.${i + 1})`);

  /* ⚠️ عمداً `repairDefects` اجرا **نمی‌شود** (برخلافِ آزمایشگاهِ خوانش). سه دلیل:
   * تعمیر روی ~۴٪ فال‌ها شلیک می‌کند، فقط همان فیلدِ معیوب را عوض می‌کند، و این‌جا
   * فالِ پایه صرفاً **کانتکست** است نه چیزی که سنجیده شود. اجرایش یک فراخوانیِ
   * اضافه به کشِ پایه می‌چسباند و یک متغیرِ دوم واردِ چیزی می‌کند که باید در همه‌ی
   * دورها بیت‌به‌بیت ثابت بماند. کیفیتِ خودِ فال کارِ `reading-lab.mjs` است. */

  const rendered = renderV4(parsed, cards, labels, { name: persona.name });
  const base = {
    persona: persona.id, step: i, spread: spread.id, question: step.question,
    model: res?.model || BASE_MODEL,
    cards: cards.map((c) => ({ key: c.key, reversed: !!c.reversed })),
    llm: parsed, rendered,
  };
  if (!FAKE) { baseCache[key] = base; saveCache(); }
  return base;
}

/* ═══════════════ یک گفتگوی کامل روی یک فال ═══════════════ */
async function runConversation(persona, base, arm, rep) {
  const spread = SPREAD_BY_ID[base.spread];
  const cards = base.cards;
  const labels = L.prompts.cardLabels(cards.length);
  const cardNames = cards.map((c) => cardName(c.key));

  /* پیشوندِ ثابت: **یک بار** ساخته می‌شود و در طولِ کلِ گفتگو بیت‌به‌بیت یکسان می‌ماند.
   * این شرطِ اقتصادیِ فیچر است نه یک بهینه‌سازی (کشِ پرامپت)، پس آزمایشگاه هم باید
   * دقیقاً همان‌طور بسازدش که ربات می‌سازد و هم باید ثابت ماندنش را **بسنجد**. */
  const system = `${systemFor(armVariant(arm))}\n\n${buildChatCtx({
    reading: { question: base.question }, llm: base.llm, cards, spread, labels,
    memory: '', prev: [], L,
  })}`;

  const history = [];
  const turns = [];
  let prefixStable = true;
  const ups = MAX_TURNS ? persona.follow_ups.slice(0, MAX_TURNS) : persona.follow_ups;

  /* یک follow-up یا رشته است یا `{ q, off: true }`. شکلِ دوم فقط می‌گوید این سؤال
   * **بیرونِ دامنه‌ی فال** است، و دو سنجه را برعکس می‌کند: قاعده‌ی قلاب معاف می‌شود
   * (جوابِ درستِ «پایتخت انگلیس» کوتاه و بی‌لنگر است) و در عوض نام‌بردنِ کارت ایراد
   * می‌شود. هر ۱۵ فایلِ سناریوی موجود رشته‌اند و دست‌نخورده کار می‌کنند. */
  let lastFollowUp = '';   // برچسبِ دکمه‌ی نوبتِ قبل (فقط در حالتِ --tap مصرف می‌شود)
  let tapped = 0;

  for (let t = 0; t < ups.length; t++) {
    const up = ups[t];
    const scripted = String(typeof up === 'string' ? up : up?.q ?? '');
    const viaTap = TAP && !!lastFollowUp;
    const q = viaTap ? lastFollowUp : scripted;
    if (viaTap) tapped++;
    // سؤالِ بیرونِ دامنه فقط وقتی معنی دارد که واقعاً همان سؤالِ اسکریپت‌شده رفته باشد؛
    // برچسبِ خودِ مدل هرگز بیرونِ دامنه نیست.
    const offDomain = !viaTap && typeof up === 'object' && !!up?.off;
    // گاردهای رایگانِ خودِ ربات، با همان توابع. سؤالی که در محصول به مدل نمی‌رسد،
    // این‌جا هم نباید برسد — وگرنه آزمایشگاه چیزی را می‌سنجد که رخ نمی‌دهد.
    if (crisisIn(q)) { turns.push({ q, skipped: 'crisis' }); continue; }
    if (smallTalkIn(q)) { turns.push({ q, skipped: 'smalltalk' }); continue; }

    const packed = packHistory(history);
    const messages = toMessages(system, packed, q, L);
    if (messages[0].content !== system) prefixStable = false;

    const usage = { in: 0, out: 0, usd: 0, cached: 0 };
    const t0 = Date.now();
    const call = FAKE
      ? (sys, usr, opts) => {
          const out = fakeChatReply(t, cardNames, q);
          opts.onUsage?.({ prompt_tokens: 0, completion_tokens: 0 });
          return opts.validate(out) ? { out, model: 'fake', attempts: 1 } : null;
        }
      : orChatResilient;
    const res = await call('', '', {
      messages, maxTokens: CHAT_MAX_TOKENS, temperature: 0.9,
      validate: chatOutOk,
      /* 💵 هزینه‌ی **واقعی** از خودِ پاسخِ OpenRouter. هرگز از روی توکن با یک جدولِ
       * قیمتِ هاردکد حساب نمی‌شود: همان اشتباه یک بار DeepSeek را «گران‌ترین» گزارش
       * کرد در حالی که ارزان‌ترین بود (بند ثبت‌شده‌ی دورِ ۹). */
      onUsage: (u) => {
        usage.in += Number(u?.prompt_tokens) || 0;
        usage.out += Number(u?.completion_tokens) || 0;
        usage.usd += Number(u?.cost) || 0;
        usage.cached += Number(u?.prompt_tokens_details?.cached_tokens) || 0;
      },
    }, planFor(armModel(arm)));
    const ms = Date.now() - t0;

    if (!res?.out) { turns.push({ q, failed: true, ms, usage }); continue; }

    // پاکت را باز می‌کنیم، عیناً مثل `runChatTurn`ِ پروداکشن.
    const outObj = parseChatOut(res.out) || { text: res.out, newReading: false, support: false };
    const reply = cleanChatReply(outObj.text, { name: persona.name });
    let check;
    try {
      check = chatMetrics({
        reply, raw: res.out, cardNames,
        questionWords: questionWordsOf(q, base.question), question: q, offDomain,
        // سنجه برچسبِ **خام** را می‌بیند (قبل از گاردِ کد)، وگرنه همیشه صفر می‌گفت.
        flags: outObj, followUp: outObj.followUpRaw || '',
      });
    } catch (e) {
      // اگر خودِ سنجه بترکد، نوبت‌های قبلی که پولشان داده شده نباید از بین بروند.
      check = { lines: 0, chars: 0, hook: { ok: false, why: 'toolerror' }, chatbait: 0,
        formal: [], dashes: 0, dashesRaw: 0, qmarks: 0, firstLine: { ok: false, why: 'toolerror' },
        issues: [`خطای خودِ سنجه: ${e.message}`], notes: [] };
    }

    turns.push({ q, viaTap, reply, raw: res.out, model: res.model, attempts: res.attempts,
      flags: { newReading: outObj.newReading, support: outObj.support, end: outObj.end },
      followUp: outObj.followUpRaw || '', fuKept: outObj.followUp || '',
      ms, usage, check, inputChars: messagesChars(messages) });
    // تپ روی چیزی انجام می‌شود که **واقعاً دکمه شده**؛ برچسبی که گارد حذفش کرده هیچ
    // دکمه‌ای در چت ندارد، پس نوبتِ بعد به سؤالِ اسکریپت‌شده برمی‌گردد.
    lastFollowUp = outObj.followUp || '';

    // تاریخچه دقیقاً مثل ربات به نوبتِ بعد منتقل می‌شود — **با پرچم‌ها**، وگرنه
    // `packHistory` پاکتِ بازپخش را همیشه خاموش می‌ساخت و آزمایشگاه چیزی را می‌سنجید
    // که پروداکشن اجرا نمی‌کند (همان تله‌ی «گاردِ آینه‌ای»، بند ۶ب ریشه).
    history.push({ role: 'user', text: q }, {
      role: 'assistant', text: reply,
      want_reading: outObj.newReading ? 1 : 0, want_support: outObj.support ? 1 : 0,
      follow_up: outObj.followUp || '', want_end: outObj.end ? 1 : 0,
    });
  }

  /* 🔁 **حلقه = جوابِ زیرِ کف، پشتِ سرِ هم.** عمداً «پیاپی» است نه «تعداد در کلِ گفتگو»
   * — همان درسِ ثبت‌شده‌ی `stuck-detect` (بند ۹ب-۴ ریشه): یک جوابِ کوتاهِ تکی توضیحِ
   * محتمل دارد (سؤالِ پرچم‌دار، سؤالِ واقعاً ساده)، ولی سه‌تای پشتِ سرِ هم یعنی گفتگو
   * دیگر جایی نمی‌رود. بیشینه‌ی طولِ زنجیره چاپ می‌شود، نه جمع. */
  let thinRun = 0, thinMax = 0;
  for (const t of turns) {
    if (!t.reply) continue;
    if (t.check?.thin) { thinRun++; thinMax = Math.max(thinMax, thinRun); } else thinRun = 0;
  }

  return { persona: persona.id, name: persona.name, base, arm, rep, turns, prefixStable, tapped, thinMax };
}

/* ═══════════════ اجرا ═══════════════ */
const stepsOf = (p) => {
  if (STEPS === 'all') return p.steps.map((s, i) => [s, i]);
  if (STEPS === 'first') return [[p.steps[0], 0]];
  if (/^\d+$/.test(STEPS)) { const i = Math.min(Number(STEPS), p.steps.length - 1); return [[p.steps[i], i]]; }
  return [[p.steps[p.steps.length - 1], p.steps.length - 1]];
};

const all = [];
for (const arm of ARM_LIST) {
  if (ARM_LIST.length > 1) {
    console.log(`\n${'▓'.repeat(72)}`);
    console.log(`🅰️ بازو: ${arm}  (همان فالِ پایه و همان سؤال‌های بازوهای دیگر)`);
    console.log('▓'.repeat(72));
  }
  for (let rep = 0; rep < REPS; rep++) {
    if (REPS > 1) {
      console.log(`\n${'█'.repeat(72)}`);
      console.log(`🔁 پاسِ ${rep + 1} از ${REPS} (همان فالِ پایه، همان سؤال‌ها)`);
      console.log('█'.repeat(72));
    }
    for (const persona of personas) {
      for (const [step, i] of stepsOf(persona)) {
        console.log(`\n${'═'.repeat(72)}`);
        console.log(`👤 ${persona.id} — ${persona.name}  (تمرکز: ${persona.focus})`);
        console.log(`   فالِ پایه: ${spreadName(SPREAD_BY_ID[step.spread].fa)} | «${step.question.slice(0, 60)}…»`);
        console.log('═'.repeat(72));

        const base = await buildBase(persona, step, i);
        const conv = await runConversation(persona, base, arm, rep);
        all.push(conv);

        console.log(`   🃏 ${base.cards.map((c) => cardName(c.key) + (c.reversed ? '↕' : '')).join('، ')}`);
        console.log(`   سرخطِ فال: ${String(base.llm.headline || '').slice(0, 100)}`);
        if (!conv.prefixStable) console.log('   ❌ پیشوندِ ثابت بینِ نوبت‌ها عوض شد (کشِ پرامپت از بین می‌رود)');
        if (TAP) console.log(`   👆 حالتِ تپ: ${conv.tapped} از ${conv.turns.length} نوبت از روی برچسبِ خودِ مدل آمد`);
        for (const [k, t] of conv.turns.entries()) {
          console.log(`\n   ── نوبتِ ${k + 1}${t.viaTap ? ' 👆' : ''}: «${t.q}»`);
          if (t.skipped) { console.log(`      ⏭ رایگان، بدونِ فراخوانیِ مدل (${t.skipped})`); continue; }
          if (t.failed) { console.log('      ❌ همه‌ی تلاش‌ها شکست خورد (مسیرِ ریفاند)'); continue; }
          console.log(`      ${t.reply.split('\n').join('\n      ')}`);
          const c = t.check;
          /* ⚠️ مدل و تعدادِ تلاش عمداً چاپ می‌شوند: در دورِ ۱۴۰۵/۰۶/۲۲ جوابِ بیشترِ
           * نوبت‌ها از **پله‌ی فالبک** می‌آمد (چون مدلِ اصلی پاکت را رعایت نمی‌کرد) و
           * چون گزارش فقط متن را نشان می‌داد، افتِ طول و لحن به‌جای «مدلِ اشتباه»
           * به «پرامپت» نسبت داده می‌شد. پرچم‌ها هم چاپ می‌شوند چون تنها مصرفشان
           * (دکمه‌ی CTA) بیرونِ آزمایشگاه است و بدونِ چاپ، خاموش‌ماندنشان نامرئی بود. */
          /* ⚠️ پرچمِ `end` هم چاپ می‌شود، و این یک جزئیاتِ تزئینی نیست: نبودش یک بار
           * باعث شد یک نوبتِ **معافِ درست** (جوابِ «پایانِ مکالمه»، که ذاتاً کوتاه است)
           * به‌عنوان قرمزِ کاذبِ کفِ محتوا خوانده شود، چون معافیت در دیتا بود و در
           * گزارش نبود. هر پرچمی که رفتارِ سنجه را عوض می‌کند باید دیده شود. */
          const fl = [t.flags?.newReading ? 'فالِ تازه' : '', t.flags?.support ? 'پشتیبانی' : '',
            t.flags?.end ? 'پایانِ مکالمه' : ''].filter(Boolean).join(' + ') || 'ــ';
          console.log(`      📏 ${c.lines} خط / ${c.chars} نویسه${c.thin ? ' 🪫' : ''} | قلاب: ${c.hook.ok ? '✅' : `❌ ${c.hook.why}`}`
            + ` | 🚩 ${fl} | 🤖 ${t.model || '?'}${t.attempts > 1 ? ` (تلاشِ ${t.attempts})` : ''}`
            + ` | ورودی ${t.inputChars} نویسه | ${t.ms}ms`);
          // برچسبِ دکمه همیشه چاپ می‌شود، چون در حالتِ تپ **ورودیِ نوبتِ بعد** است و
          // بدونِ دیدنش نمی‌شود فهمید حلقه از کجا شروع شد.
          console.log(`      🏷 دکمه: ${t.followUp ? `«${t.followUp}»${c.fuBad ? ` ❌ ${c.fuBad} (گارد حذفش کرد)` : ''}` : '(ندارد)'}`);
          if (c.issues.length) c.issues.forEach((x) => console.log(`      ❌ ${x}`));
          if (c.notes.length) c.notes.forEach((x) => console.log(`      ⚠️ ${x}`));
        }
      }
    }
  }
}

/* ═══════════════ 🔁 تکرارِ بین‌نوبتی و بین‌پرسونایی ═══════════════
 *
 * مهم‌ترین سنجه‌ی این آزمایشگاه. یک جواب به‌تنهایی هرگز قالبی بودن را لو نمی‌دهد؛ فقط
 * کنارِ هم گذاشتنِ نوبت‌ها (و پرسوناها) نشان می‌دهد کدام جمله دارد از پرامپت یا از
 * عادتِ مدل تکرار می‌شود — و درست همین‌جا بود که دو بار نشتِ few-shot پیدا شد. */
console.log(`\n${'═'.repeat(72)}`);
console.log('🔁 تکرار (متنی که در بیش از یک نوبت عیناً آمده)');
console.log('═'.repeat(72));
/* ⚠️ گروه‌بندی باید **بازو و پاس** را با هم ببیند: با دو بازو، جوابِ بازوی A و بازوی B
 * در یک سطل می‌افتادند و یک ۶کلمه‌ای مشترک «تکرار» شمرده می‌شد، در حالی که این عدد
 * قرار است بگوید **یک** مدل خودش را تکرار می‌کند یا نه. */
const groups = [...new Set(all.map((c) => `${c.arm}::${c.rep}`))].sort();
const repeatCounts = [];
for (const gk of groups) {
  const [gArm, gRep] = gk.split('::');
  const convs = all.filter((c) => c.arm === gArm && String(c.rep) === gRep);
  const items = [];
  for (const c of convs) {
    for (const [k, t] of c.turns.entries()) {
      if (t.reply) items.push({ key: `${c.persona}.${k + 1}`, text: t.reply });
    }
  }
  const cross = repeatedNgrams(items, 6);
  repeatCounts.push(cross.length);
  const label = (ARM_LIST.length > 1 ? `${gArm} / ` : '') + `پاسِ ${Number(gRep) + 1}`;
  if (groups.length > 1) console.log(`\n   ── ${label}: ${cross.length} تکرار`);
  if (!cross.length) console.log('   ✅ هیچ ۶کلمه‌ای در دو نوبتِ متفاوت تکرار نشده');
  else for (const [g, keys] of cross.slice(0, groups.length > 1 ? 8 : 20)) console.log(`      [${keys.join(', ')}] «${g}»`);
}

/* ═══════════════ 📊 جمع‌بندی ═══════════════ */
console.log(`\n${'═'.repeat(72)}`);
console.log('📊 جمع‌بندی');
console.log('═'.repeat(72));
console.log(`   💾 فالِ پایه: ${cacheStat.hit} از کش، ${cacheStat.miss} تازه ساخته شد`
  + (FAKE ? '  (حالتِ fake: کش اصلاً لمس نمی‌شود)' : `  → ${path.relative(process.cwd(), BASE_FILE)}`));

function summarize(rows) {
  const done = rows.filter((t) => t.reply);
  const skipped = rows.filter((t) => t.skipped).length;
  const failed = rows.filter((t) => t.failed).length;
  const hookOkN = done.filter((t) => t.check.hook.ok).length;
  const bait = done.reduce((s, t) => s + t.check.chatbait, 0);
  const formal = done.reduce((s, t) => s + t.check.formal.length, 0);
  const dash = done.reduce((s, t) => s + t.check.dashes, 0);
  const dashRaw = done.reduce((s, t) => s + t.check.dashesRaw, 0);
  const qbad = done.filter((t) => t.check.qmarks > 1).length;
  const firstOk = done.filter((t) => t.check.firstLine.ok).length;
  const bad = done.filter((t) => t.check.issues.length).length;
  const thin = done.filter((t) => t.check.thin).length;
  const fuHas = done.filter((t) => t.followUp).length;
  const fuBad = done.filter((t) => t.check.fuBad).length;
  const fuStyle = done.filter((t) => t.check.fuStyle).length;
  const fuNoAsk = done.filter((t) => t.check.fuNoAsk).length;
  const fuLong = done.filter((t) => t.check.fuLong).length;
  const noOffer = done.filter((t) => t.check.noOffer).length;
  const fuLens = done.filter((t) => t.followUp).map((t) => t.check.fuLen).sort((a, b) => a - b);
  const lines = done.map((t) => t.check.lines).sort((a, b) => a - b);
  const inTarget = lines.filter((n) => n >= LINE_MIN && n <= LINE_MAX).length;
  const ms = done.map((t) => t.ms).sort((a, b) => a - b);
  const usd = done.reduce((s, t) => s + (t.usage?.usd || 0), 0);
  const tin = done.reduce((s, t) => s + (t.usage?.in || 0), 0);
  const tout = done.reduce((s, t) => s + (t.usage?.out || 0), 0);
  const cached = done.reduce((s, t) => s + (t.usage?.cached || 0), 0);
  return { n: done.length, skipped, failed, hookOkN, bait, formal, dash, dashRaw, qbad,
    firstOk, bad, thin, fuHas, fuBad, fuStyle, fuNoAsk, fuLong, noOffer, fuLens, lines, inTarget,
    ms, usd, tin, tout, cached,
    hookFail: done.length ? (done.length - hookOkN) * 100 / done.length : null };
}

const pct = (a, b) => (b ? Math.round(a * 100 / b) : 0);

/* 🔗 **شمارشِ per گفتگو، نه per نوبت — برای سنجه‌های چسبنده.**
 *
 * 🐛 درسِ دورِ ۴ (۱۴۰۵/۰۶/۲۳) و یک تصحیحِ جدی روی سه دورِ قبلی: نوبت‌های یک گفتگو
 * **مستقل نیستند**. تاریخچه‌ای که به مدل داده می‌شود شاملِ جواب‌های قبلیِ خودش است،
 * پس مدل قالبِ نوبتِ اول را تا آخر تقلید می‌کند. دیتای دورِ ۴ این را بی‌ابهام نشان
 * داد: در بازوی خط پایه پرسونای P2 هر پنج نوبت چندخطی بود و P3 هر پنج نوبت تک‌خطی؛
 * در بازوی v2 دقیقاً برعکس. یعنی «۱۵ نمونه» در واقع **۳ نمونه** بود.
 *
 * پیامدش این است که «۱۵/۱۵ در برابرِ ۱۰/۱۵» را باید «۳/۳ در برابرِ ۲/۳» خواند، و
 * نوسانِ خط پایه بین دورها (۱۵ ⟵ ۱۰ ⟵ ۸) اصلاً دریفت نبود، سه شیر-یا-خط بود. یک
 * عددِ per نوبت این‌جا **دقتِ کاذب** می‌سازد، و عددی که واحدش را اشتباه بگیری از
 * نبودش بدتر است.
 *
 * ⚠️ این برای همه‌ی سنجه‌ها یکسان نیست: «لحنِ کتابی» و «اکوی برچسب» **داخلِ** یک
 * گفتگو هم بالا و پایین می‌شوند (دورِ ۱: نوبت‌های ۲،۵،۶،۷،۸،۱۳،۱۵ از سه پرسونای
 * مختلف)، پس عددِ per نوبتشان معنا دارد. «طول» چسبنده است. برای همین هر دو چاپ
 * می‌شوند و این خط صریحاً `n` را می‌گوید. */
function convLineStats(convs) {
  const rows = convs.map((c) => {
    const done = c.turns.filter((t) => t.reply);
    const ok = done.filter((t) => t.check.lines >= LINE_MIN && t.check.lines <= LINE_MAX).length;
    return { n: done.length, ok };
  }).filter((r) => r.n);
  return {
    convs: rows.length,
    allOk: rows.filter((r) => r.ok === r.n).length,
    noneOk: rows.filter((r) => r.ok === 0).length,
  };
}

function printSummary(label, rows, convs = null) {
  const s = summarize(rows);
  if (!s.n) { console.log(`\n   ${label}: هیچ نوبتی جواب نگرفت`); return s; }
  console.log(`\n   ── ${label}`);
  console.log(`   نوبت: ${s.n} جواب‌گرفته | ${s.skipped} رایگان (بحران/تعارف) | ${s.failed} شکست‌خورده | ${s.bad} با ایراد`);
  console.log(`   🪝 خطِ آخرِ سالم: ${s.hookOkN}/${s.n} (${pct(s.hookOkN, s.n)}٪) | chatbait: ${s.bait}`
    + ` | «شما»: ${s.formal} | خط تیره: ${s.dash} (خام: ${s.dashRaw}) | بیش از یک «؟»: ${s.qbad}`);
  console.log(`   🎯 خطِ اول خودِ جواب: ${s.firstOk}/${s.n} (${pct(s.firstOk, s.n)}٪)`);
  /* دو خطِ تازه‌ی ۱۴۰۵/۰۶/۲۵ — هر دو مستقیماً به بازخوردِ مالک وصل‌اند و هر دو پولی‌اند:
   * جوابِ زیرِ کف یعنی یک الماسِ سوخته، و برچسبِ خرابِ دکمه یعنی نوبتِ بعدی هم می‌سوزد. */
  console.log(`   🪫 زیرِ کفِ محتوا: ${s.thin}/${s.n} (${pct(s.thin, s.n)}٪)`
    + (convs ? ` | بلندترین زنجیره‌ی پیاپی: ${Math.max(0, ...convs.map((c) => c.thinMax || 0))}` : ''));
  /* ⚠️ «سؤال نیست» **جدا** از «امری» چاپ می‌شود، نه جمع‌شده: کلاسِ غالبِ نقضِ خطِ
   * پایه امری نبود و اگر یکی می‌شدند همان تفکیکی گم می‌شد که تصمیمِ v5 روی آن نشست. */
  console.log(`   🏷 دکمه: ${s.fuHas}/${s.n} ساخته شد | ❌ خراب: ${s.fuBad}`
    + ` | ⚠️ امری: ${s.fuStyle} | ❓ سؤال نیست: ${s.fuNoAsk}`
    + ` | ✂️ بلندتر از ${CHAT_FU_PROMPT_MAX}: ${s.fuLong}`
    + (s.fuLens.length ? ` (طول‌ها: ${s.fuLens.join(', ')})` : ''));
  /* 🎁 سنجه‌ی مرکزیِ v6 و تنها سنجه‌ای که خواسته‌ی «تو همه پیام‌ها» را اندازه می‌گیرد.
   * عمداً خطِ **خودش** را دارد و با «خطِ آخرِ سالم» جمع نمی‌شود: آن یکی می‌گوید خطِ آخر
   * لنگر دارد، این یکی می‌گوید **شکلش** پیشنهاد است؛ یک جمله می‌تواند اولی را پاس کند
   * و دومی را نه (همان چیزی که کلِ ترنسکریپتِ مالک بود). */
  console.log(`   🎁 خطِ آخر پیشنهاد است: ${s.n - s.noOffer}/${s.n} (${pct(s.n - s.noOffer, s.n)}٪)`);
  console.log(`   📏 طول: ${s.inTarget}/${s.n} داخلِ هدفِ ${LINE_MIN} تا ${LINE_MAX} خط`
    + ` | توزیع: ${s.lines.join(', ')} خط`);
  /* و همان عدد در واحدِ درستش. عددِ per نوبتِ بالا برای دیدنِ توزیع می‌ماند، ولی
   * **مقایسه‌ی بازوها باید روی این خط بنشیند**، نه روی آن. */
  if (convs) {
    const cs = convLineStats(convs);
    console.log(`   🔗 طول per گفتگو (واحدِ درستِ مقایسه، چون نوبت‌ها مستقل نیستند):`
      + ` ${cs.allOk}/${cs.convs} گفتگو کاملاً داخلِ هدف، ${cs.noneOk}/${cs.convs} کاملاً بیرون`
      + (cs.convs < 8 ? `  ⚠️ n=${cs.convs} — برای نتیجه‌گیری کم است، --reps را بالا ببر` : ''));
  }
  if (s.ms.length) console.log(`   ⏱ تأخیر: ${s.ms[0]} تا ${s.ms[s.ms.length - 1]}ms (میانه ${s.ms[Math.floor(s.ms.length / 2)]}ms)`);
  // عددِ دلاری فقط وقتی چاپ می‌شود که **واقعی** باشد؛ نبودنش یعنی سکوت، نه یک تخمینِ
  // ساختگی که بعداً به‌عنوان «هزینه» نقل شود.
  console.log(`   💵 توکن: ${s.tin} ورودی + ${s.tout} خروجی`
    + (s.cached ? ` (${s.cached} کش‌خورده، ${pct(s.cached, s.tin)}٪ ورودی)` : '')
    + (s.usd > 0 ? ` | هزینه‌ی واقعی: $${s.usd.toFixed(4)} (per نوبت: $${(s.usd / s.n).toFixed(5)})` : ''));
  return s;
}

const allTurns = (rows) => rows.flatMap((c) => c.turns);
for (const arm of ARM_LIST) printSummary(ARM_LIST.length > 1 ? `بازو ${arm}` : 'کلِ دور', allTurns(all.filter((c) => c.arm === arm)), all.filter((c) => c.arm === arm));

/* دامنه‌ی بین پاس‌ها = واحدِ سنجشِ نویز. بدونِ این عدد نمی‌شود فهمید یک تفاوتِ
 * چندواحدی «بهبود» است یا فقط شانسِ نمونه‌برداریِ مدل (یافته‌ی ثبت‌شده‌ی دورِ هفتمِ
 * آزمایشگاهِ خوانش: یک اجرای ۹آیتمی ±۶ واحد نویز دارد). */
if (REPS > 1) {
  console.log('\n   ── نویزِ بین پاس‌ها');
  for (const arm of ARM_LIST) {
    const per = [];
    for (let rep = 0; rep < REPS; rep++) {
      const s = summarize(allTurns(all.filter((c) => c.arm === arm && c.rep === rep)));
      per.push(s.hookFail == null ? null : Math.round(s.hookFail));
    }
    const nums = per.filter((x) => x != null);
    console.log(`   ${arm}: قلابِ ناسالم per پاس ${per.map((x) => (x == null ? '-' : `${x}٪`)).join(' , ')}`
      + (nums.length > 1 ? `  (دامنه ${Math.min(...nums)} تا ${Math.max(...nums)})` : ''));
  }
  console.log(`   🔁 تکرار per گروه: ${repeatCounts.join(' , ')}`);
}

/* ═══ 🅰️🅱️ مقایسه‌ی جفت‌شده ═══
 *
 * چرا جفت‌شده و نه دو درصدِ کلی: اثرِ **سناریو** بزرگ است (یک فال و یک سؤال ذاتاً
 * سخت‌تر از دیگری است) و نویزِ نمونه‌برداریِ مدل هم روی آن سوار می‌شود، در حالی که
 * تفاوتی که دنبالش هستیم کوچک است. چون همه‌ی بازوها **عینِ همان فالِ پایه و همان
 * سؤال‌ها** را گرفته‌اند، می‌شود per سناریو تفاضل گرفت و اثرِ سناریو کاملاً حذف می‌شود.
 *
 * ⚠️ عمداً p-value چاپ نمی‌شود: با این تعداد سناریو هیچ آزمونی توانِ کافی ندارد و یک
 * عددِ آماریِ خوش‌قیافه فقط اعتمادِ کاذب می‌سازد. */
if (ARM_LIST.length > 1) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log('🅰️🅱️ مقایسه‌ی جفت‌شده (هر سناریو با فال و سؤالِ یکسان بینِ بازوها)');
  console.log('═'.repeat(72));
  const key = (c) => `${c.persona}.${c.base.step + 1}`;
  const scen = [...new Set(all.map(key))];
  const rateOf = (convs) => {
    const s = summarize(allTurns(convs));
    return s.hookFail;
  };
  const base = ARM_LIST[0];
  for (const other of ARM_LIST.slice(1)) {
    const diffs = [], rows = [];
    for (const sc of scen) {
      const a = rateOf(all.filter((c) => key(c) === sc && c.arm === base));
      const b = rateOf(all.filter((c) => key(c) === sc && c.arm === other));
      if (a == null || b == null) continue;
      diffs.push(b - a);
      rows.push(`   ${sc.padEnd(7)} ${a.toFixed(0).padStart(3)}٪  →  ${b.toFixed(0).padStart(3)}٪   (${b - a >= 0 ? '+' : ''}${(b - a).toFixed(0)})`);
    }
    console.log(`\n   🅱️ ${other}  در برابرِ  🅰️ ${base}   (قلابِ ناسالم، کمتر یعنی بهتر)`);
    if (!diffs.length) { console.log('   (دادهٔ قابلِ جفت‌شدن نبود)'); continue; }
    rows.forEach((x) => console.log(x));
    const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
    const better = diffs.filter((d) => d < 0).length;
    const worse = diffs.filter((d) => d > 0).length;
    console.log('   ─────');
    console.log(`   میانگینِ تفاضلِ per سناریو: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} واحد (منفی یعنی «${other}» بهتر است)`);
    console.log(`   بردِ سناریویی: ${better} بهتر / ${worse} بدتر / ${diffs.length - better - worse} مساوی`);
    console.log(Math.abs(mean) >= 5 && (better >= diffs.length * 0.7 || worse >= diffs.length * 0.7)
      ? '   ✅ الگو یک‌دست است، این تفاوت قابلِ اتکاست'
      : `   ⚠️ الگو یک‌دست نیست؛ با ${diffs.length} سناریو این تفاوت **قطعی نیست**، پاسِ بیشتر لازم است`);
  }
}

/* ═══ 📄 رونوشتِ کاملِ گفتگوها ═══
 *
 * چرا در **انتهای** لاگ و یک‌جا: ارزیابیِ کیفیت کارِ خواندنِ خودِ متن است، نه خواندنِ
 * یک عدد. لاگِ Actions فقط از انتها قابلِ برداشت است و بلوکِ هر گفتگو ده‌ها خط بالاتر
 * لای خروجیِ سنجه‌ها گم می‌شود. */
function dumpTranscripts(rows) {
  console.log('\n' + '═'.repeat(72));
  console.log('📄 رونوشتِ کاملِ گفتگوها (برای ارزیابیِ دستیِ کیفیت)');
  console.log('═'.repeat(72));
  for (const c of rows) {
    console.log(`\n▓ ${c.arm} | ${c.persona}.${c.base.step + 1}${c.rep ? ` پ${c.rep + 1}` : ''}`
      + ` | ${spreadName(SPREAD_BY_ID[c.base.spread].fa)}`);
    console.log(`؟ سؤالِ فال: ${c.base.question}`);
    console.log(`🃏 ${c.base.cards.map((x) => cardName(x.key) + (x.reversed ? '↕' : '')).join('، ')}`);
    console.log(`📩 ${[c.base.rendered.headline, c.base.rendered.body, c.base.rendered.closing].filter(Boolean).join('\n')}`);
    for (const [k, t] of c.turns.entries()) {
      console.log(`\n🙋 ${k + 1}) ${t.viaTap ? '👆 ' : ''}${t.q}`);
      if (t.skipped) { console.log(`🤖 (رایگان، بدونِ مدل: ${t.skipped})`); continue; }
      if (t.failed) { console.log('🤖 (شکست خورد)'); continue; }
      console.log(`🤖 ${t.reply}`);
      if (t.followUp) console.log(`🏷 [${t.followUp}]`);
    }
  }
}
dumpTranscripts(all);

/* ═══ 🎯 فهرستِ معیارهای ارزیابی ═══
 * داور **خودِ سشن** است، نه یک مدلِ دیگر. این بلوک فقط همان فهرستِ ثابت را جلوی چشم
 * می‌گذارد تا ارزیابی روی مرجع بنشیند نه حافظه، و یادآوری می‌کند که هر نمره‌ی بالای
 * صفر باید نقلِ قولِ عیناً موجود در متن داشته باشد (`verifyEvidence`). */
console.log('\n' + '═'.repeat(72));
console.log(`🎯 معیارهای ارزیابی (سقف ${RUBRIC_MAX} امتیاز) — داور: همین سشن، نه یک مدلِ دیگر`);
console.log('═'.repeat(72));
for (const r of CHAT_RUBRIC) console.log(`   [${r.id}] ×${r.w}  ${r.title}  ← ${r.src}\n      ${r.ask}`);
console.log('   ⚠️ هر نمره‌ی بالای صفر باید نقلِ قولی داشته باشد که عیناً در همان جواب باشد؛');
console.log('      `verifyEvidence` در tools/reading-lab/chat-rubric.mjs راستی‌آزمایی‌اش می‌کند.');

/* ═══ ✅ کنترلِ مثبتِ حالتِ fake ═══
 *
 * بند ۶ب-۲ ریشه: گاردی که با «نبودِ قرمز» سبز می‌شود هیچ چیز ثابت نمی‌کند. استاب دو
 * نقصِ **شناخته‌شده** تزریق می‌کند (خطِ آخرِ chatbait و خطِ آخرِ بی‌لنگر)؛ اگر سنجه
 * پیدایشان نکند یعنی مسیرِ سنجش عملاً مرده است و این اجرا باید قرمز شود، نه اینکه
 * یک گزارشِ خوش‌قیافه‌ی بی‌معنی چاپ کند. */
if (FAKE) {
  const whys = new Set(allTurns(all).filter((t) => t.check).map((t) => t.check.hook.why));
  const enough = allTurns(all).filter((t) => t.reply).length >= 3;
  const missed = enough ? ['chatbait', 'noanchor'].filter((w) => !whys.has(w)) : [];
  if (missed.length) {
    console.log(`\n❌ کنترلِ مثبت: نقصِ تزریق‌شده گرفته نشد (${missed.join('، ')}).`);
    console.log('   یعنی سنجه‌ی قلاب یا لیستِ chatbait دیگر کار نمی‌کند، یا سؤال‌های سناریو');
    console.log('   با جمله‌ی بی‌لنگرِ استاب کلمه‌ی مشترک پیدا کرده‌اند.');
    process.exit(1);
  }
  if (enough) console.log('\n✅ کنترلِ مثبت: هر دو نقصِ تزریق‌شده‌ی استاب (chatbait و بی‌لنگر) گرفته شدند.');

  // کنترلِ مثبتِ دومِ همان قاعده، برای سنجه‌ی تازه‌ی برچسبِ دکمه.
  const fuWhys = new Set(allTurns(all).filter((t) => t.check).map((t) => t.check.fuBad).filter(Boolean));
  const fuMissed = enough ? ['meta', 'assent'].filter((w) => !fuWhys.has(w)) : [];
  if (fuMissed.length) {
    console.log(`\n❌ کنترلِ مثبت: برچسبِ خرابِ تزریق‌شده گرفته نشد (${fuMissed.join('، ')}).`);
    console.log('   یعنی `followUpBad` دیگر کار نمی‌کند، یا سنجه برچسبِ گاردخورده را می‌بیند');
    console.log('   به‌جای برچسبِ خام — که همیشه صفر گزارش می‌دهد.');
    process.exit(1);
  }
  if (enough) console.log('✅ کنترلِ مثبت: هر دو برچسبِ خرابِ استاب (meta و assent) گرفته شدند.');

  /* کنترلِ سومِ همان قاعده، برای سنجه‌ی **نکته**ی «برچسبِ امری».
   *
   * ⚠️ این یکی را استاب نمی‌تواند تزریق کند، چون `fuStyle` فقط روی برچسبی می‌نشیند که
   * `followUpBad` **نگرفته** باشد و استاب هر دو برچسبِ بدش را گارد می‌گیرد. پس الگو
   * مستقیم روی پیکره‌ی پین‌شده‌ی `lang/<locale>.mjs` اجرا می‌شود — هر دو جهت، چون
   * پهن‌کردنِ این الگو رایگان نیست و یک نسخه‌ی گشاد، سؤالِ سالمِ کاربر را نکته می‌کند. */
  const re = LANG.followUpImperative;
  const pos = LANG_MOD.FU_STYLE_POSITIVE || [];
  const neg = LANG_MOD.FU_STYLE_NEGATIVE || [];
  if (!re || !pos.length || !neg.length) {
    console.log('\n❌ کنترلِ مثبت: پیکره‌ی سنجه‌ی برچسبِ امری در lang/' + LOCALE + '.mjs نیست.');
    console.log('   یک پیکره‌ی خالی همه‌ی ادعاهای زیر را بی‌صدا پاس می‌کند.');
    process.exit(1);
  }
  const posMiss = pos.filter((s) => !re.test(s));
  const negHit = neg.filter((s) => re.test(s));
  if (posMiss.length || negHit.length) {
    console.log('\n❌ کنترلِ مثبت: سنجه‌ی «برچسبِ امری» با پیکره‌ی خودش نمی‌خواند.');
    if (posMiss.length) console.log(`   نگرفت (باید بگیرد): ${posMiss.map((s) => `«${s}»`).join('، ')}`);
    if (negHit.length) console.log(`   قرمزِ کاذب: ${negHit.map((s) => `«${s}»`).join('، ')}`);
    process.exit(1);
  }
  console.log(`✅ کنترلِ مثبت: سنجه‌ی برچسبِ امری روی ${pos.length} نقضِ واقعی قرمز و روی ${neg.length} برچسبِ سالم ساکت است.`);

  /* کنترلِ چهارم، برای سنجه‌ی «برچسب سؤال است یا نه» (`followUpAsk`).
   *
   * ⚠️ جهتِ این الگو **برعکسِ** سه‌تای بالاست: گرفتن یعنی **سالم** (برچسب سؤالِ خودِ
   * کاربر است) و نگرفتن یعنی نکته. پس `FU_ASK_POSITIVE` باید بگیرد و
   * `FU_ASK_NEGATIVE` نباید — دقیقاً برچسب‌های واقعیِ خطِ پایه که تصمیمِ پرامپتِ v5
   * روی آن‌ها نشست. مثل بالا استاب نمی‌تواند تزریقش کند، چون برچسبِ استاب گارد
   * می‌خورد و این سنجه فقط روی برچسبِ گاردنخورده اجرا می‌شود. */
  const reAsk = LANG.followUpAsk;
  const aPos = LANG_MOD.FU_ASK_POSITIVE || [];
  const aNeg = LANG_MOD.FU_ASK_NEGATIVE || [];
  if (!reAsk || !aPos.length || !aNeg.length) {
    console.log('\n❌ کنترلِ مثبت: پیکره‌ی سنجه‌ی «برچسب سؤال نیست» در lang/' + LOCALE + '.mjs نیست.');
    console.log('   یک پیکره‌ی خالی یا الگوی غایب، این سنجه را بی‌صدا به صفرِ همیشگی تبدیل می‌کند');
    console.log('   — همان چیزی که یک بار برای `fuStyle` رخ داد و شکافِ ۲/۸ را نامرئی کرد.');
    process.exit(1);
  }
  const askMiss = aPos.filter((s) => !reAsk.test(s));
  const askHit = aNeg.filter((s) => reAsk.test(s));
  if (askMiss.length || askHit.length) {
    console.log('\n❌ کنترلِ مثبت: سنجه‌ی «برچسب سؤال نیست» با پیکره‌ی خودش نمی‌خواند.');
    if (askMiss.length) console.log(`   سؤالِ سالم را سؤال ندید: ${askMiss.map((s) => `«${s}»`).join('، ')}`);
    if (askHit.length) console.log(`   برچسبِ غیرسؤالی را سؤال دید: ${askHit.map((s) => `«${s}»`).join('، ')}`);
    process.exit(1);
  }
  console.log(`✅ کنترلِ مثبت: سنجه‌ی «برچسب سؤال نیست» روی ${aPos.length} سؤالِ سالم ساکت و روی ${aNeg.length} برچسبِ واقعیِ خطِ پایه قرمز است.`);

  /* کنترلِ پنجم، برای سنجه‌ی مرکزیِ پرامپتِ v6: **خطِ آخر پیشنهاد است؟**
   *
   * ⚠️ این تنها سنجه‌ای است که پیکره‌اش کاملاً از **جمله‌های واقعیِ ترنسکریپت** آمده و
   * برچسبِ درست/غلطش را خودِ مالک زده. برای همین هر دو جهت اجباری است: نسخه‌ی تنگ
   * («فقط «می‌خوای» باشد») بدترین شکلِ ردشده‌ی او را **سالم** می‌خواند
   * («چه مرزی می‌خوای بذاری؟»)، و نسخه‌ی گشاد جمله‌ی خبری را پیشنهاد می‌شمارد.
   *
   * 🔑 و برخلافِ چهار کنترلِ بالا، این یکی روی خودِ `chatMetrics` اجرا می‌شود نه روی
   * الگوی خام: چیزی که تصمیم می‌گیرد ترکیبِ سه الگو است (`ask`/`mine`/`can`) و سنجشِ
   * تک‌تکشان آینه‌ی خودش می‌شد، نه سنجشِ خروجی (بند ۲و/۶ب ریشه). */
  const oPos = LANG_MOD.OFFER_POSITIVE || [];
  const oNeg = LANG_MOD.OFFER_NEGATIVE || [];
  if (!LANG.closingOffer || !oPos.length || !oNeg.length) {
    console.log('\n❌ کنترلِ مثبت: پیکره یا الگوی «خطِ آخر پیشنهاد است» در lang/' + LOCALE + '.mjs نیست.');
    console.log('   بدونِ آن این سنجه بی‌صدا به صفرِ همیشگی تبدیل می‌شود و v6 قابلِ اندازه‌گیری نیست.');
    process.exit(1);
  }
  const offerOf = (line) => chatMetrics({ reply: `جوابت اینه که کارتِ برج می‌گه صبر لازمه.\n${line}` }).noOffer;
  const offMiss = oPos.filter((x) => offerOf(x));
  const offHit  = oNeg.filter((x) => !offerOf(x));
  if (offMiss.length || offHit.length) {
    console.log('\n❌ کنترلِ مثبت: سنجه‌ی «خطِ آخر پیشنهاد است» با پیکره‌ی خودش نمی‌خواند.');
    if (offMiss.length) console.log(`   پیشنهادِ تأییدشده‌ی مالک را پیشنهاد ندید: ${offMiss.map((x) => `«${x}»`).join('، ')}`);
    if (offHit.length) console.log(`   شکلِ ردشده را پیشنهاد دید: ${offHit.map((x) => `«${x}»`).join('، ')}`);
    process.exit(1);
  }
  console.log(`✅ کنترلِ مثبت: سنجه‌ی «خطِ آخر پیشنهاد است» روی ${oPos.length} پیشنهادِ تأییدشده ساکت و روی ${oNeg.length} شکلِ ردشده قرمز است.`);

  /* کنترلِ ششم: **تنها معافیتِ** سنجه‌ی پیشنهاد، و هر چهار ترکیبِ پرچم.
   *
   * دورِ اولِ v6 نشان داد ۵ نقض از ۶ یک کلاس بودند (جوابِ محصولی/پشتیبانی/دکمه). حالا
   * پرامپت آن‌ها را استثنا نمی‌داند و سنجه هم نباید بداند — وگرنه همان کلاس بی‌صدا از
   * گزارش بیرون می‌رود و «نمی‌بینم» شبیهِ «چیزی نیست» می‌شود (بند ۶ب-۲ ریشه).
   * تنها معافیتِ مجاز `wants_end` است، و کنترلِ مثبتش همان متن بدونِ آن پرچم است. */
  const endLine = 'دکمه‌ی «🙏 پایان مکالمه» زیرِ همین جواب گفتگو رو می‌بنده.';
  const endBody = `کارتِ برج می‌گه همین الان لازم نیست تصمیمِ بزرگ بگیری.\n${endLine}`;
  const noOfferWith = (flags) => chatMetrics({ reply: endBody, flags }).noOffer;
  const exempt = [
    ['پایانِ مکالمه معاف است', noOfferWith({ end: true }) === false],
    ['کنترلِ مثبت: همان متن بدونِ پرچمِ پایان قرمز می‌شود', noOfferWith({ end: false }) === true],
    ['نوبتِ پشتیبانی معاف نمی‌شود', noOfferWith({ support: true }) === true],
    ['نوبتِ فالِ تازه معاف نمی‌شود', noOfferWith({ newReading: true }) === true],
  ].filter(([, okk]) => !okk).map(([lbl]) => lbl);
  if (exempt.length) {
    console.log('\n❌ کنترلِ مثبت: معافیتِ سنجه‌ی «خطِ آخر پیشنهاد است» درست نیست.');
    console.log(`   ${exempt.join('؛ ')}`);
    process.exit(1);
  }
  console.log('✅ کنترلِ مثبت: سنجه‌ی پیشنهاد فقط نوبتِ پایانِ مکالمه را معاف می‌کند، نه پشتیبانی و فالِ تازه را.');
}

if (OUT) {
  /* ⚠️ این map فیلدها را **صریح** انتخاب می‌کند، پس افزودنِ فیلد به `all` خودبه‌خود به
   * JSON نمی‌رسد. `arm` و `rep` حتماً بمانند: بدونشان مقایسه‌ی جفت‌شده‌ی دورِ بعد همه‌ی
   * بازوها را در یک سطل می‌ریزد و تفکیکی که کلِ تصمیم روی آن است بی‌صدا گم می‌شود. */
  fs.writeFileSync(OUT, JSON.stringify(all.map((c) => ({
    persona: c.persona, step: c.base.step, arm: c.arm, rep: c.rep,
    spread: c.base.spread, question: c.base.question, cards: c.base.cards,
    baseModel: c.base.model, baseHeadline: c.base.llm?.headline || '',
    prefixStable: c.prefixStable,
    turns: c.turns.map((t) => ({
      q: t.q, viaTap: !!t.viaTap, reply: t.reply || '', raw: t.raw || '', skipped: t.skipped || '',
      followUp: t.followUp || '', flags: t.flags || null,
      failed: !!t.failed, model: t.model || '', attempts: t.attempts || 0,
      ms: t.ms || 0, usage: t.usage || null, check: t.check || null,
    })),
  })), null, 2));
  console.log(`\n💾 خروجیِ خام: ${OUT}`);
}
