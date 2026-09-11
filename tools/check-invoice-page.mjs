#!/usr/bin/env node
/* چکِ صفحه‌ی فاکتورِ کارت‌به‌کارت (v3.81.0 — خواسته‌ی صریحِ مالک: «تا حد ممکن ساده،
 * سرراست، بدون حاشیه و خلوت»).
 *
 * چهار چیز سنجیده می‌شود و هر چهار **رفتاری**‌اند (locale واقعاً رندر می‌شود، منطقِ
 * ریل از سورس بریده و اجرا می‌شود):
 *   ۱) عنوانِ داینامیک: «🧾 فاکتور خرید ۳۰ الماس 💎»، و برگشتِ امن وقتی بسته‌ای نیست.
 *   ۲) خطِ مبلغ: ایموجیِ ابتدایی + عدد + **همان عدد** به حروف، داخلِ پرانتز.
 *   ۳) ریلِ کارت صفحه‌ی بسته‌ها را پاک می‌کند، ریلِ استارز نگهش می‌دارد.
 *   ۴) چیزهایی که مالک صریح گفت دست نخورند: هشدارِ رسید، شماره‌کارت، دکمه‌ها.
 *
 * ⚠️ مرکزی‌ترین ادعا، تطابقِ **حروف با عدد** است. این هم‌خانواده‌ی باگِ ثبت‌شده‌ی
 * ریال/تومانِ رسید (بند ۹ ریشه) و «۶۰٬۰۰۰ ستاره» (بند ۲و/۶ج) است: هر جا یک کمیت از دو
 * جا ساخته شود، دیر یا زود یکی عوض می‌شود و آن یکی ساکت می‌ماند. این‌جا خطر واقعی‌تر
 * هم هست، چون کلِ هدفِ این خط «کاربر صفرها را اشتباه نشمارد» است؛ حروفِ غلط بدتر از
 * نبودنِ حروف است.
 *
 * برای همین، خواننده‌ی حروف در **همین فایل و مستقل** نوشته شده و از جدولِ خودِ locale
 * چیزی import نمی‌کند. اگر آینه‌ی همان جدول بود، یک غلطِ مشترک در هر دو طرف سبز رد
 * می‌شد (بند ۶ب ریشه: گاردِ آینه‌ای فقط آینه‌ی خودش را می‌سنجد).
 */
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const L = (await import('../bots/tarot/locales/fa.js')).default;
const { numToFa } = await import('../bots/tarot/locales/fa.js');

const CUR = { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji };
const render = (amount, purchase) => L.wallet.invoice(amount, '6219-8619-0000-0000', 'علیرضا اولیا', purchase, CUR);
const lineOf = (text, needle) => text.split('\n').find((l) => l.includes(needle)) || '';

/* ── خواننده‌ی مستقلِ حروفِ فارسی (معکوسِ numToFa، نوشته‌شده از صفر) ───────────── */
const W = {
  صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9,
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16,
  هفده: 17, هجده: 18, نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60,
  هفتاد: 70, هشتاد: 80, نود: 90, صد: 100, دویست: 200, سیصد: 300, چهارصد: 400,
  پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900,
};
const SCALE = { هزار: 1e3, میلیون: 1e6, میلیارد: 1e9 };
/** حروفِ فارسی را دوباره به عدد برمی‌گرداند؛ `null` یعنی واژه‌ی ناشناس دیدم. */
function faToNum(words) {
  let total = 0, chunk = 0;
  for (const w of words.trim().split(/\s+/)) {
    if (w === 'و' || w === '') continue;
    if (SCALE[w] !== undefined) { total += (chunk || 1) * SCALE[w]; chunk = 0; continue; }
    if (W[w] === undefined) return null;
    chunk += W[w];
  }
  return total + chunk;
}

console.log('\n🔢 خواننده‌ی حروف واقعاً کار می‌کند (وگرنه بقیه‌ی ادعاها بی‌معنا می‌شوند)');
{
  // کنترلِ مثبت: بدونِ این، یک `faToNum` که همیشه null بدهد همه‌ی ادعاهای پایین را
  // بی‌صدا خنثی می‌کرد (بند ۶ب-۲: سبزِ حاصل از نبودِ قرمز هیچ چیز ثابت نمی‌کند).
  ok(faToNum('شصت هزار') === 60_000, 'حروفِ دست‌نویسِ «شصت هزار» خوانده می‌شود');
  ok(faToNum('سه هزار') === 3_000, 'و «سه هزار» هم');
  ok(faToNum('چیزِ ناشناس') === null, 'و واژه‌ی ناشناس null می‌دهد، نه یک عددِ ساختگی');
}

console.log('\n🔤 numToFa روی عددهای واقعیِ فاکتور');
{
  /* اعدادِ واقعیِ کاتالوگ + مبلغ‌های تخفیف‌خورده + مرزها. هر کدام رفت‌وبرگشت می‌شوند:
   * numToFa → faToNum → باید همان عددِ اول بدهد. */
  const NUMS = [
    10_000, 15_000, 30_000, 45_000, 60_000, 100_000, 150_000, 490_000, 1_490_000,
    63_500, 24_000, 1, 11, 19, 20, 21, 100, 101, 110, 115, 999, 1_000, 1_001,
    900_000, 1_000_000, 1_000_001, 2_000_000_000,
  ];
  let bad = null;
  for (const n of NUMS) {
    const back = faToNum(numToFa(n));
    if (back !== n) { bad = `${n} ⟵ «${numToFa(n)}» ⟵ ${back}`; break; }
  }
  ok(!bad, `هر ${NUMS.length} عدد رفت‌وبرگشتِ سالم دارند${bad ? ` (شکست: ${bad})` : ''}`);
  ok(numToFa(0) === '', 'صفر حروف ندارد (خطِ پرانتز اصلاً ساخته نمی‌شود)');
  ok(numToFa(1_000) === 'یک هزار', '«هزار» بدونِ ضریب هم صریح «یک هزار» می‌گوید، نه خالی');
  ok(!numToFa(30_000).includes('undefined') && !numToFa(300).includes('undefined'),
    'هیچ خانه‌ی جدول خالی نمانده (undefined در خروجی نیست)');
}

console.log('\n💵 خطِ مبلغ: عدد و حروف از یک مبلغ می‌آیند');
{
  const purchase = { pack: { key: 'gold' }, coins: 30 };
  for (const amount of [30_000, 60_000, 150_000, 63_500]) {
    const line = lineOf(render(amount, purchase), 'مبلغ:');
    const inParens = (line.match(/\(([^)]+)\)/) || [])[1] || '';
    const got = faToNum(inParens.replace('تومان', ''));
    ok(got === amount, `«${amount}»: حروفِ داخلِ پرانتز همان عدد است (شد: ${got})`);
  }
  const line = lineOf(render(60_000, purchase), 'مبلغ:');
  ok(/^[^\p{L}\p{N}\s]/u.test(line.trim()), 'خطِ مبلغ با ایموجی شروع می‌شود (خواسته‌ی مالک: به چشم بیاید)');
  ok(line.includes('۶۰ هزار تومان'), 'شکلِ کوتاهِ خوانا برای مبلغِ رُند');
  ok(lineOf(render(63_500, purchase), 'مبلغ:').includes('۶۳٬۵۰۰ تومان'),
    'و مبلغِ غیرِرُند عددِ کاملِ خودش را می‌گوید، نه یک «هزار»ِ گردشده');
  ok(line.includes('(') && line.includes('تومان)'), 'واحد داخلِ پرانتز هم تکرار می‌شود');
}

console.log('\n🧾 عنوانِ داینامیک');
{
  const head = render(60_000, { pack: { key: 'gold' }, coins: 30 }).split('\n')[0];
  ok(head.startsWith('🧾'), 'با ایموجیِ فاکتور شروع می‌شود');
  ok(head.includes('۳۰') && head.includes(L.coinUnit.name), 'تعداد و واحدِ الماس در خودِ عنوان است');
  ok(head.includes(L.coinUnit.emoji), 'و ایموجیِ الماس هم هست');
  ok(!head.includes('شارژ'), 'دیگر «فاکتور شارژ» نیست');
  // بسته‌ی بازنشسته (`pack: null`) نباید عنوان را بشکند: عدد همان چیزی است که می‌خرد.
  const retired = render(490_000, { pack: null, coins: 300 }).split('\n')[0];
  ok(retired.includes('۳۰۰') && retired.includes(L.coinUnit.name), 'بسته‌ی بی‌نام هم عددش را در عنوان دارد');
  // و برگشتِ امن: بدونِ اثباتِ الماس، هیچ عددی چاپ نمی‌شود (بند ۹ ریشه).
  const legacy = render(60_000, null).split('\n')[0];
  ok(legacy === '🧾 فاکتور شارژ', `دنیای میراثی به عنوانِ قبلی برمی‌گردد (شد: «${legacy}»)`);
  ok(!/\d|[۰-۹]/.test(legacy), 'و هیچ عددِ ساختگی‌ای در آن نیست');
}

console.log('\n🚫 خطِ «بابت خرید» دیگر جدا تکرار نمی‌شود');
{
  const body = render(60_000, { pack: { key: 'gold' }, coins: 30 });
  ok(!body.includes('بابت خرید'), 'خطِ جداگانه‌ی «بابت خرید بسته‌ی…» حذف شده (عنوان خودش می‌گوید)');
  const coinCount = (body.match(/۳۰/g) || []).length;
  ok(coinCount === 1, `عددِ الماس دقیقاً یک بار در فاکتور می‌آید (شد: ${coinCount})`);
}

console.log('\n📌 آن‌چه مالک گفت دست نخورد');
{
  const body = render(60_000, { pack: { key: 'gold' }, coins: 30 });
  ok(body.includes('کارت‌به‌کارت به:') && body.includes('6219-8619-0000-0000') && body.includes('علیرضا اولیا'),
    'اطلاعاتِ کارت‌به‌کارت سرِ جایش است');
  ok(body.includes('اسکرین شات رسید رو همین‌جا توی چت بفرست'), 'راهنمای ارسالِ رسید سرِ جایش است');
  ok(body.includes('بدون ارسالِ رسید، پرداخت تأیید نمی‌شود'), 'هشدارِ قرمزِ پایانِ فاکتور سرِ جایش است');
  ok(!body.includes('—') && !body.includes('--'), 'و هیچ خطِ تیره‌ی بلندی در متن نیست (بند ۱۰ ریشه)');
  // دکمه‌ها: کپیِ کارت و انصراف هر دو زیرِ همین فاکتور ساخته می‌شوند.
  const invStart = SRC.indexOf('L.wallet.invoice(pack.toman');
  const invBlock = invStart > 0 ? SRC.slice(invStart, SRC.indexOf('});', invStart)) : '';
  ok(!!invBlock, 'بلوکِ ارسالِ فاکتور در سورس پیدا شد');
  ok(/cardCopyRow\(\)/.test(invBlock), 'دکمه‌ی «کپی شماره کارت» زیرِ فاکتور هست');
  ok(/pay_cancel:\$\{payId\}/.test(invBlock), 'و دکمه‌ی انصراف هم');
}

/* ══ ریلِ کارت پاک می‌کند، ریلِ استارز نگه می‌دارد ══════════════════════════
 * این تنها واگراییِ ساختاریِ مجازِ بند ۲و/۴ است و **هر دو جهتش** اهمیت دارد:
 *   • اگر ریلِ کارت پاک نکند ⟵ همان پیامِ اضافه‌ای که مالک خواست برود، می‌ماند.
 *   • اگر ریلِ استارز پاک کند ⟵ فاکتورِ بومیِ تلگرام جا برای دکمه‌ی سفارشی ندارد،
 *     پس تنها راهِ انصراف از بین می‌رود و صفحه بن‌بست می‌شود (بند ۹ب/۱).
 * منطق از سورس بریده و با هر دو مقدارِ `starsRail` **اجرا** می‌شود. */
console.log('\n🧹 پاک‌شدنِ صفحه‌ی بسته‌ها فقط روی ریلِ کارت');
{
  const from = SRC.indexOf('  const packMsgId = ctx.callbackQuery?.message?.message_id;');
  const to = SRC.indexOf('  /* ⭐ ریلِ استارز:', from);
  const block = from > 0 && to > from ? SRC.slice(from, to) : '';
  ok(!!block, 'بلوکِ تصمیمِ ریل در سورس پیدا شد');

  const run = (starsRail) => {
    const log = [];
    const ctx = {
      callbackQuery: { message: { message_id: 55 } },
      editMessageReplyMarkup: async () => { log.push('edit'); },
      deleteMessage: async () => { log.push('delete'); },
    };
    const fn = new Function('ctx', 'starsRail', 'patchSession', 'uid', 'payId', 'Markup', 'L', 'log',
      `return (async () => {${block}})();`);
    return fn(ctx, starsRail, (_u, p) => log.push(`patch:${JSON.stringify(p)}`), 7, 1,
      { inlineKeyboard: () => ({ reply_markup: {} }), button: { callback: () => ({}) } },
      { buttons: { cancel: '❌' } }, log).then(() => log);
  };

  const card = await run(false);
  ok(card.includes('delete'), 'ریلِ کارت: پیامِ صفحه‌ی بسته‌ها حذف می‌شود');
  ok(!card.includes('edit'), 'و به دکمه‌ی انصرافِ تکراری ادیت نمی‌شود');
  ok(card.some((x) => x.includes('"packMsgId":null')),
    'و شناسه‌اش صفر می‌شود تا pay_cancel صفحه‌ی تازه بسازد (نه ادیتِ پیامی که نیست)');

  const stars = await run(true);
  ok(stars.includes('edit') && !stars.includes('delete'),
    'ریلِ استارز: همان پیام می‌ماند و کیبوردش به انصراف تبدیل می‌شود (وگرنه بن‌بست)');

  // جهش: اگر شرطِ ریل برداشته شود، هر دو ریل یک رفتار می‌گیرند و این تفکیک می‌میرد.
  const mutated = block.replace('if (starsRail) {', 'if (true) {');
  const mFn = new Function('ctx', 'starsRail', 'patchSession', 'uid', 'payId', 'Markup', 'L',
    `return (async () => {${mutated}})();`);
  const mLog = [];
  await mFn({
    callbackQuery: { message: { message_id: 55 } },
    editMessageReplyMarkup: async () => { mLog.push('edit'); },
    deleteMessage: async () => { mLog.push('delete'); },
  }, false, () => {}, 7, 1,
  { inlineKeyboard: () => ({ reply_markup: {} }), button: { callback: () => ({}) } },
  { buttons: { cancel: '❌' } });
  ok(!mLog.includes('delete'),
    'جهشِ «شرطِ ریل برداشته شود» ادعای بالا را قرمز می‌کند (تفکیک واقعی است، نه تصادفی)');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
for (const e of errs) console.log(`   - ${e}`);
assert.equal(errs.length, 0, `${errs.length} خطای صفحه‌ی فاکتور`);
