#!/usr/bin/env node
// چکِ «گیتِ عضویت در کانال» + قرارداد «فالِ محبوب هم‌اندازه‌ی هدیه».
//
// چرا وجود دارد: گیتِ عضویت تنها چیزی در این ربات است که می‌تواند **کاربر را بیرون نگه دارد**.
// یک اشتباهِ کوچک در دامنه‌اش دو فاجعه‌ی متفاوت می‌سازد و هیچ‌کدام سروصدا نمی‌کنند:
//   ۱) دامنه‌ی زیادی گشاد → کاربرِ فعلیِ پولی هم گیت می‌خورد و از ربات بیرون می‌افتد.
//   ۲) fail-closed شدنِ چکِ عضویت → اگر ربات از ادمینیِ کانال بیفتد، **همه‌ی** ثبت‌نام‌های
//      جدید بی‌صدا می‌خشکند و تا وقتی کسی شکایت نکند نمی‌فهمیم.
// هر دو مسیرِ سردند و boot smoke test نمی‌بیندشان (درسِ بند ۸ ریشه).
//
// اجرا: node tools/check-gate.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const idx = readFileSync(join(root, 'bots/tarot/index.js'), 'utf8');
const loc = readFileSync(join(root, 'bots/tarot/locales/fa.js'), 'utf8');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; } else { fails++; console.error(`❌ ${msg}`); } };

// ── ۱) دامنه‌ی گیت: کاربرِ فعلی هرگز گیت نمی‌خورد ────────────────────────────
const needsGateSrc = idx.match(/function needsGate\(user\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
ok(needsGateSrc, 'تابعِ needsGate پیدا شد');
ok(/!user\.welcome_bonus_at/.test(needsGateSrc),
   'needsGate باید روی «هدیه‌ی خوش‌آمد را نگرفته» شرط بگذارد، وگرنه کاربرِ فعلی هم گیت می‌خورد');
ok(/!gateOn\(\)\)\s*return false/.test(needsGateSrc),
   'گاردِ خاموشی باید اولین شرطِ needsGate باشد (رول‌بکِ یک‌خطی)');

// شبیه‌سازیِ واقعیِ همان تابع روی کاربرهای نمونه
const needsGate = new Function('gateOn', `return (${needsGateSrc.replace(/^function /, 'function ')});`);
for (const enabled of [true, false]) {
  const fn = needsGate(() => enabled);
  const t = (m) => `${enabled ? 'روشن' : 'خاموش'}: ${m}`;
  ok(fn({ joined_gate_at: null, welcome_bonus_at: null, welcomed: 0 }) === enabled,
     t('کاربرِ کاملاً جدید باید گیت بخورد (و با فلگِ خاموش، نخورد)'));
  ok(fn({ joined_gate_at: null, welcome_bonus_at: 1_700_000_000, welcomed: 0 }) === false,
     t('کاربری که هدیه گرفته ولی آنبوردینگ را رها کرده هرگز گیت نمی‌خورد'));
  ok(fn({ joined_gate_at: null, welcome_bonus_at: 1_700_000_000, welcomed: 1 }) === false,
     t('کاربرِ کاملِ فعلی هرگز گیت نمی‌خورد'));
  ok(fn({ joined_gate_at: 1_700_000_000, welcome_bonus_at: null, welcomed: 0 }) === false,
     t('کاربری که گیت را رد کرده دوباره گیت نمی‌خورد'));
  ok(fn(null) === false, t('کاربرِ ناموجود نباید گیت بخورد'));
}

// ── ۲) چکِ عضویت باید fail-open باشد ─────────────────────────────────────────
const memberSrc = idx.match(/async function isChannelMember\([\s\S]*?\n\}/)?.[0] || '';
ok(memberSrc, 'تابعِ isChannelMember پیدا شد');
ok(/catch[\s\S]*return true/.test(memberSrc),
   'خطای getChatMember باید fail-open باشد؛ وگرنه افتادنِ ربات از ادمینیِ کانال همه‌ی ثبت‌نام‌ها را می‌خشکاند');
ok(/GATE_CHECK/.test(memberSrc), 'خطای گیت باید با پیشوندِ قابلِ grep لاگ شود');
ok(/restricted/.test(memberSrc) && /is_member/.test(memberSrc),
   'وضعیتِ restricted فقط با is_member===true عضو حساب می‌شود');

// ── ۳) راهِ فرار همیشه باز است (بند ۶ج ریشه) ─────────────────────────────────
const mwSrc = idx.match(/GATE_FREE_CMD[\s\S]*?\n\s{2}\}\);/)?.[0] || '';
ok(mwSrc, 'میدل‌ورِ گیت پیدا شد');
ok(/'\/start'/.test(mwSrc), 'دستور /start باید همیشه از گیت رد شود');
ok(/'\/support'/.test(mwSrc), 'دستور /support هرگز گیت نمی‌شود (راهِ فرارِ کاربرِ گیرکرده)');
ok(/support\?\.button/.test(mwSrc), 'دکمه‌ی پشتیبانی هم باید آزاد باشد، نه فقط دستورش');
// باگِ واقعی (۱۴۰۵/۰۵/۱۳): ادمینی که وسطِ گیت بود دکمه‌ی ریست را زد و به‌جای ریست، پیامِ
// یادآوریِ گیت گرفت — چون `bot.hears(resetTest)` و `/reset` **بعد از** این میدل‌ور ثبت
// می‌شوند. بند ۶ب می‌گوید این دکمه همیشه در دسترسِ ادمین است.
ok(/'\/reset'/.test(mwSrc), 'دستور /reset باید از گیت آزاد باشد (ابزارِ همیشگیِ ادمین، بند ۶ب)');
ok(/buttons\.resetTest/.test(mwSrc), 'دکمه‌ی «ریست حساب (ادمین)» هم باید از گیت آزاد باشد، نه فقط دستورش');
ok(/data\.startsWith\('gate:'\)/.test(mwSrc), 'خودِ دکمه‌ی گیت نباید توسط گیت بلاک شود');
ok(/catch[\s\S]*return next\(\)/.test(mwSrc), 'هر خطای میدل‌ور باید fail-open باشد، نه قفلِ ربات');
// باگِ واقعی (۱۴۰۵/۰۵/۱۳): آپدیتِ سرویسیِ my_chat_member (ترک/عضویتِ کانال، بلاک/آنبلاکِ ربات)
// پیام ندارد و «اقدامِ کاربر» حساب می‌شد، پس کاربر بدونِ هیچ کاری یادآوریِ گیت می‌گرفت.
ok(/!ctx\.message\s*&&\s*!ctx\.callbackQuery/.test(mwSrc),
   'فقط پیام و کال‌بک باید گیت شوند؛ آپدیتِ سرویسی (my_chat_member و…) باید بی‌صدا رد شود');

// ── ۳ب) اتریبیوشن با متنِ تصادفی آلوده نشود ──────────────────────────────────
// handleStart از دکمه‌ی ریست و از مسیرِ کاربرِ ناتمام هم صدا زده می‌شود؛ آن‌جا متنِ پیام
// اصلاً /start نیست و فالبکِ «کلمه‌ی دوم» payload را با متنِ تصادفی پر می‌کرد.
const payloadSrc = idx.match(/const isStartCmd[\s\S]{0,320}?const payload =[^\n]*/)?.[0] || '';
ok(payloadSrc, 'استخراجِ payload در handleStart پیدا شد');
ok(/\/\^\\\/start/.test(payloadSrc),
   'payload فقط از یک پیامِ واقعیِ /start خوانده شود، نه از کلمه‌ی دومِ هر متنی');
ok(/isStartCmd \?/.test(payloadSrc), 'فالبکِ متن باید پشتِ شرطِ isStartCmd باشد');

// ── ۴) گیت یک نقطه است، نه ده‌ها گارد پراکنده ────────────────────────────────
ok((idx.match(/needsGate\(/g) || []).length <= 4,
   'needsGate باید فقط در چند نقطه‌ی مشخص صدا زده شود (گیت میدل‌ورِ واحد است، نه گاردِ پراکنده)');

// ── ۵) هدیه دقیقاً لحظه‌ی عبور از گیت داده می‌شود، نه قبلش ───────────────────
const startSrc = idx.match(/async function handleStart\([\s\S]*?\n\}/)?.[0] || '';
ok(!/grantWelcomeBonus/.test(startSrc),
   'handleStart نباید مستقیم هدیه بدهد؛ هدیه فقط از startOnboarding (بعد از گیت) می‌آید');
const gateCheckSrc = idx.match(/bot\.action\('gate:check'[\s\S]*?\n\}\);/)?.[0] || '';
ok(/claimGate\.run\(uid\)\.changes/.test(gateCheckSrc), 'عبور از گیت باید اتمیک باشد (ضدِ دوبار-تپ)');
ok(/show_alert: true/.test(gateCheckSrc), 'عضو نبودن باید پاپ‌آپِ روی صفحه بدهد، نه پیامِ جدید');
ok(/startOnboarding/.test(gateCheckSrc), 'بعد از تأییدِ عضویت، فلو باید به همان آنبوردینگِ همیشگی برود');

// ── ۶) قرارداد: فالِ «محبوب‌ترین» باید با اعتبارِ هدیه قابلِ گرفتن باشد ───────
const { default: SPREADS, SPREAD_BY_ID } = await import(join(root, 'bots/tarot/spreads.js'));
// ⚠️ هدیه‌ی خوش‌آمد از ثابتِ **الماسیِ** فعال خوانده می‌شود. `WELCOME_BONUS` تومانی
// بازمانده‌ی نسلِ مرده است (`coinsOn` برای همه true است، پس هرگز اجرا نمی‌شود) و سنجیدنِ
// قیمتِ الماسی با آن، عددِ تومان را با عددِ الماس مقایسه می‌کرد.
const WELCOME_BONUS = Number(idx.match(/const WELCOME_BONUS_COINS_V2\s*=\s*(\d+)/)?.[1] || 0);
ok(WELCOME_BONUS > 0, 'هدیه‌ی خوش‌آمدِ الماسی از index.js خوانده شد');

const badge = loc.match(/catalogBadges:\s*\{\s*(\w+):\s*'محبوب‌ترین'/)?.[1];
ok(badge, 'بَجِ «محبوب‌ترین» در locale پیدا شد');
const popular = SPREAD_BY_ID[badge];
ok(popular, `فالِ محبوب (${badge}) در spreads.js وجود دارد`);
// قراردادِ اصلی: کاربرِ تازه باید بتواند فالِ محبوب را **با هدیه و بدونِ پرداخت** بگیرد.
// در نسلِ الماسی هدیه ۵ و فالِ محبوب ۳ است، پس برابری دیگر لازم نیست — کفایت لازم است.
ok(popular?.price > 0 && popular.price <= WELCOME_BONUS,
   `قرارداد: هدیه‌ی خوش‌آمد باید کفافِ فالِ محبوب را بدهد (فال: ${popular?.price}💎، هدیه: ${WELCOME_BONUS}💎)`);
ok(SPREADS[0]?.id === badge, 'فالِ محبوب باید اولین گزینه‌ی کاتالوگ باشد');
ok(new RegExp(`startPopular[\\s\\S]{0,80}${popular?.fa}`).test(loc),
   'دکمه‌ی CTAِ پایانِ آنبوردینگ باید همان فالِ محبوب را نام ببرد');
ok(new RegExp(`startPopular\\(\\),\\s*'spread:${badge}'`).test(idx),
   `دکمه‌ی CTA باید به spread:${badge} وصل باشد، نه فالِ دیگری`);

// ── ۷) آنبوردینگ بعد از بسته‌شدنِ آزمایشِ ترتیب ────────────────────────────────
// 🔴 آزمایشِ `intro_order` در ۴ شهریور ۱۴۰۵ بسته شد. ترتیبِ کنترل ماند (تجربه اول، آمار
// بعد) و متنِ تجربه برای همه به نسخه‌ی تازه رفت.
//
// ⚠️ درسی که این آزمایش داد و این‌جا ثبت می‌شود: نسخه‌ی قبلیِ همین چک ادعا می‌کرد
// «کدام نسخه‌ی متن بیاید فرقی به حالِ آزمایش نمی‌کند، چون v2 یک متغیرِ مستقلِ دیگر است».
// این **غلط** بود: از v3.25.0 که `uxV2For` برای همه true شد، شاخه‌ی stat_first متنِ V2
// می‌گرفت و control متنِ v1، پس دو شاخه هم ترتیب هم متنشان فرق داشت و نتیجه تفسیرناپذیر
// شد. کامنتِ بالای همین بلوک از اول همین را ممنوع کرده بود، ولی به‌شکلِ **کامنت** بود نه
// **ادعا**. هر آزمایشِ بعدی باید تقارنِ شاخه‌هایش یک assert داشته باشد، نه یک کامنت
// (نمونه‌ی درست: تقارنِ طولِ دو CTA در `check-night-reminder.mjs`).
ok(/const INTRO_EXPERIENCE\s*=/.test(loc) && /const INTRO_STAT\s*=/.test(loc)
   && /const INTRO_EXPERIENCE_V2\s*=/.test(loc),
   'هر سه بلوکِ محتوایی ثابتِ module-level اند (تک‌منبع برای هر دو پیام)');
const gateIntroSrc = loc.match(/gateIntro:\s*\(v2\)[\s\S]*?,\n/)?.[0] || '';
const welcomeSrc = loc.match(/welcome:\s*\(name, v2\)[\s\S]*?,\n/)?.[0] || '';
ok(gateIntroSrc && welcomeSrc, 'هیچ‌کدام از دو پیامِ آنبوردینگ دیگر پارامترِ شاخه نمی‌گیرد');
ok(/v2 \? INTRO_EXPERIENCE_V2 : INTRO_EXPERIENCE/.test(gateIntroSrc),
   'پیامِ اول همیشه بلوکِ تجربه است (نسخه‌ی تازه در دنیای الماس، v1 در دنیای تومانی)');
ok(/\+ INTRO_STAT,/.test(welcomeSrc) && !/INTRO_EXPERIENCE/.test(welcomeSrc),
   'پیامِ بعد از نام همیشه بلوکِ آمار است (مکملِ پیامِ اول، نه تکرارش)');
// هر کاربر باید **هر دو** بلوک را دقیقاً یک‌بار ببیند؛ همان قراردادِ همیشگی، بدونِ شاخه
ok(!/statFirst/.test(loc) && !/statFirst/.test(idx),
   'شاخه‌ی آزمایش کاملاً پاک شده (کدِ مرده نمی‌ماند)');
ok(!/const statFirstFor =/.test(idx), 'helperِ شاخه هم حذف شده');
// مکانیکِ محصول عمداً توضیح داده نمی‌شود (کاربر چند ثانیه بعد خودش می‌بیند)
ok(!/از دک برمی‌داری|انتخاب می‌کنی/.test(loc.match(/const INTRO_EXPERIENCE[\s\S]*?;\n/)?.[0] || ''),
   'بلوکِ تجربه نباید مکانیکِ محصول را توضیح دهد');
/* موضع‌گیریِ «هوش مصنوعی» از فلو برداشته شد (بیرون از ربات تست می‌شود).
 *
 * دو استثنا، و هر دو با دلیل:
 *   ۱) **نامِ کانال** (استثنای تاریخی).
 *   ۲) **ممنوع‌کردنِ صریحِ همان عبارت در پرامپت** (از ۱۴۰۵/۰۶/۲۲). دورِ اکتشافیِ همان
 *      روز نشان داد مدل در جوابِ «تو کی هستی؟» می‌گوید «من یک هوش مصنوعی‌ام» — یعنی
 *      همان چیزی که v2.8.0 از کلِ ربات برداشت، حالا از دهانِ مدل و در جوابِ پول‌داده
 *      بیرون می‌آید، جایی که این چک اصلاً نمی‌بیندش. تنها راهِ بستنش نام‌بردنِ عبارت
 *      در پرامپت است («هرگز نگو …»)، و آن‌وقت خودِ ممنوعیت در همین اسکن می‌افتاد.
 *      نام‌بردنِ عبارتِ ممنوع هم بی‌خطر است: فرضیه‌ی «تلقین» در دورِ یازدهمِ آزمایشگاه
 *      تست و **رد** شد.
 *
 * ⚠️ استثنا عمداً تنگ است: فقط ساختِ **نهی**. یک ادعای مثبتِ «ما هوش مصنوعی هستیم»
 * هیچ‌کدام از این دو را ندارد و همچنان قرمز می‌دهد؛ کنترلِ مثبتِ پایین همین را ثابت
 * می‌کند، وگرنه یک استثنای گشاد بی‌صدا کلِ این گارد را بی‌اثر می‌کرد (بند ۶ب-۲). */
const aiAllowed = (line) => /کانال/.test(line) || /هرگز نگو|ننویس|ممنوع/.test(line);
const aiHits = [...loc.matchAll(/^.*هوش مصنوعی.*$/gm)].map(m => m[0]);
for (const line of aiHits) {
  ok(aiAllowed(line), `«هوش مصنوعی» فقط نامِ کانال یا ممنوعیتِ صریح است، نه ادعای محصولی: ${line.trim().slice(0, 70)}`);
}
// کنترلِ مثبت: ادعای واقعی باید همچنان بیفتد، وگرنه استثنای بالا گارد را پوچ کرده.
ok(!aiAllowed('  intro: «ما یک هوش مصنوعی پیشرفته‌ایم که فال می‌گیرد»,'),
   'کنترلِ مثبت: ادعای مثبتِ «هوش مصنوعی» هنوز رد می‌شود');
ok(aiAllowed('- دربارهٔ خودت: هرگز نگو «هوش مصنوعی».'),
   'و ممنوعیتِ صریح در پرامپت مجاز است');
// آزمایشِ بسته‌شده باید صراحتاً stop شود و **seedش برداشته شده باشد**، وگرنه هر بوت
// دوباره running می‌سازدش و بعد stop می‌کند (پینگ‌پنگِ بی‌معنی در گزارشِ داشبورد).
ok(/UPDATE experiments SET status='stopped'[\s\S]{0,400}AB_INTRO_ORDER/.test(idx),
   'آزمایشِ ترتیب صراحتاً stop می‌شود');
ok(!/INSERT OR IGNORE INTO experiments[\s\S]{0,300}AB_INTRO_ORDER/.test(idx),
   'و seedش برداشته شده (آزمایشِ بسته دوباره running نمی‌شود)');
ok(/UPDATE experiments SET status='stopped'[\s\S]*?gate_intro_ai/.test(idx),
   'آزمایشِ بازنشسته باید صراحتاً stop شود، نه اینکه در داشبورد «در حال اجرا»ی دروغین بماند');

// قانونِ قیمت (بدونِ استثنا): هر کارت ۱۰٬۰۰۰ تومان
for (const s of SPREADS) {
  ok(s.price === s.size, `قیمتِ «${s.fa}» باید برابرِ تعدادِ کارت باشد (${s.price}💎)`);
  ok(s.positions.length === s.size, `تعدادِ جایگاه‌های «${s.fa}» باید با size یکی باشد`);
}

/* ══════════════════════════════════════════════════════════════════════════
   ▶ گیتِ عضویت per زبان — زبانی که کانال ندارد نباید به کانالِ زبانِ دیگر برود

   🐛 باگی که این بلوک از آن ساخته شد: `GATE_CHANNEL` پیش‌فرضِ هاردکدِ `@taroot_fa`
   داشت و `write_env` برای زبان‌های تازه چیزی نمی‌نوشت. یعنی اولین چیزی که یک
   کاربرِ روس یا برزیلی می‌دید «عضوِ این کانالِ فارسی شو» بود — و چون هدیه‌ی
   خوش‌آمد لحظه‌ی تأییدِ عضویت واریز می‌شود، عملاً پشتِ یک کانالِ بی‌ربط قفل می‌شد.
   هیچ خطایی هم نمی‌داد: ربات واقعاً ادمینِ آن کانال است، پس چکِ عضویت «درست» کار
   می‌کرد و کاربر را درست بلاک می‌کرد.

   پیش‌فرضِ صادقانه برای زبانِ بی‌کانال **خاموش بودنِ گیت** است. این‌جا خودِ منطق
   از سورس بریده و **اجرا** می‌شود، نه اینکه شکلِ جدول خوانده شود.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const src = [
    idx.match(/const GATE_BY_LOCALE = \{[\s\S]*?\n\};/)?.[0],
    idx.match(/^const GATE_CHANNEL {5}=.*$/m)?.[0],
    idx.match(/^const GATE_CHANNEL_URL =.*$/m)?.[0],
    idx.match(/^const gateOn = .*$/m)?.[0],
  ];
  ok(src.every(Boolean), 'هر چهار قطعه‌ی گیتِ per زبان پیدا شدند');
  const run = (locale, env = {}) => {
    try {
      return new Function('LOCALE', 'process', 'JOIN_GATE_ENABLED',
        `${src.join('\n')}; return { on: gateOn(), ch: GATE_CHANNEL };`)(locale, { env }, true);
    } catch { return null; }
  };
  /* ⚠️ هر زبانی که کانال دارد باید به کانالِ **خودش** وصل باشد.
   * نامِ کانالِ روسی و اسپانیایی دو «o» دارد (`TAROOT_*`) و پرتغالی یک «o»
   * (`TAROT_PT`) — عمدی است، چون یوزرنیمِ تک-oی آن دو گرفته شده بود. یک تایپوی
   * تک‌حرفی یعنی گیت به کانالی اشاره می‌کند که وجود ندارد، و چون `isChannelMember`
   * عمداً **fail-open** است خطا کاربر را رد نمی‌کند: گیت بی‌صدا تزئینی می‌شود و
   * هیچ‌کس نمی‌فهمد. همان کلاسِ خرابیِ خاموشی که این ریپو بارها ثبت کرده. */
  const EXPECT = { fa: '@taroot_fa', ru: '@TAROOT_RU', pt: '@TAROT_PT', es: '@TAROOT_ES' };
  const seen = new Set();
  for (const [loc, ch] of Object.entries(EXPECT)) {
    const g = run(loc);
    ok(g?.on === true, `گیتِ «${loc}» روشن است`);
    ok(g?.ch === ch, `«${loc}» به کانالِ خودش وصل است (انتظار ${ch}، شد ${g?.ch})`);
    ok(!seen.has(String(g?.ch).toLowerCase()), `کانالِ «${loc}» با زبانِ دیگری مشترک نیست`);
    seen.add(String(g?.ch).toLowerCase());
  }
  /* لینک و یوزرنیم باید **یک** کانال را بگویند، وگرنه دکمه‌ی «عضو شو» کاربر را جایی
   * می‌برد که چکِ عضویت آن‌جا را نمی‌سنجد: کاربر عضو می‌شود و باز هم رد می‌شود. */
  {
    const tbl = src.join('\n').match(/const GATE_BY_LOCALE = \{[\s\S]*?\n\};/)[0];
    const T = new Function(`${tbl}; return GATE_BY_LOCALE;`)();
    for (const [loc, row] of Object.entries(T)) {
      const fromUrl = `@${String(row.url || '').split('/').pop()}`;
      ok(fromUrl.toLowerCase() === String(row.ch || '').toLowerCase(),
        `«${loc}» لینک و یوزرنیمش یکی است (${row.url} در برابرِ ${row.ch})`);
    }
  }
  // زبانی که هنوز کانال ندارد نباید کانالِ زبانِ دیگری را به ارث ببرد.
  ok(run('de')?.on === false, 'زبانِ بی‌کانال اصلاً گیت نمی‌شود');
  ok(run('de')?.ch !== '@taroot_fa', 'زبانِ بی‌کانال هرگز کانالِ فارسی را به ارث نمی‌برد');
  // و روزی که کانالش ساخته شد، دو متغیرِ env بدونِ تغییرِ کد گیتش را روشن می‌کنند
  const deEnv = run('de', { GATE_CHANNEL: '@taroot_de', GATE_CHANNEL_URL: 'https://t.me/taroot_de' });
  ok(deEnv?.on === true && deEnv?.ch === '@taroot_de', 'ست‌کردنِ کانال از env گیت را روشن می‌کند');
  // کانال بدونِ لینک = دکمه‌ی خراب وسطِ اجباری‌ترین مسیرِ ربات
  ok(run('de', { GATE_CHANNEL: '@taroot_de' })?.on === false, 'کانال بدونِ لینک گیت را روشن نمی‌کند');
}

if (fails) {
  console.error(`\n${fails} ادعا شکست خورد.`);
  process.exit(1);
}

console.log(`✅ چکِ گیتِ عضویت و فالِ محبوب: ${passes} ادعا، همه سبز.`);
