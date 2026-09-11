#!/usr/bin/env node
/* چکِ صفحه‌ی فاکتورِ کارت‌به‌کارت (v3.81.0 — خواسته‌ی صریحِ مالک: «تا حد ممکن ساده،
 * سرراست، بدون حاشیه و خلوت»).
 *
 * چهار چیز سنجیده می‌شود و هر چهار **رفتاری**‌اند (locale واقعاً رندر می‌شود، منطقِ
 * ریل از سورس بریده و اجرا می‌شود):
 *   ۱) عنوانِ داینامیک: «🧾 فاکتور خرید ۳۰ الماس 💎»، و برگشتِ امن وقتی بسته‌ای نیست.
 *   ۲) خطِ مبلغ: کیسه‌ی پول + عددِ **کامل** + **همان عدد** به شکلِ کوتاه، داخلِ پرانتز.
 *   ۳) ریلِ کارت صفحه‌ی بسته‌ها را پاک می‌کند، ریلِ استارز نگهش می‌دارد.
 *   ۴) چیزهایی که مالک صریح گفت دست نخورند: هشدارِ رسید، شماره‌کارت، دکمه‌ها.
 *
 * ⚠️ مرکزی‌ترین ادعا، تطابقِ **شکلِ کوتاه با عددِ کامل** است. این هم‌خانواده‌ی باگِ
 * ثبت‌شده‌ی ریال/تومانِ رسید (بند ۹ ریشه) و «۶۰٬۰۰۰ ستاره» (بند ۲و/۶ج) است: هر جا یک
 * کمیت از دو جا ساخته شود، دیر یا زود یکی عوض می‌شود و آن یکی ساکت می‌ماند. این‌جا خطر
 * واقعی‌تر هم هست، چون کلِ هدفِ این خط «کاربر صفرها را اشتباه نشمارد» است؛ عددِ کوتاهِ
 * غلط بدتر از نبودنِ آن است.
 *
 * برای همین، خواننده‌ی شکلِ کوتاه در **همین فایل و مستقل** نوشته شده و از خودِ locale
 * چیزی import نمی‌کند. اگر آینه‌ی همان تابع بود، یک غلطِ مشترک در هر دو طرف سبز رد
 * می‌شد (بند ۶ب ریشه: گاردِ آینه‌ای فقط آینه‌ی خودش را می‌سنجد).
 *
 * ⚠️ و **ترتیب** خودش یک ادعاست، نه سلیقه: نسخه‌ی اولِ این کار کوتاه‌شده را جای اصلی
 * گذاشته بود و مالک ردش کرد. عددی که پررنگ و اول می‌آید باید همانی باشد که واقعاً کسر
 * می‌شود؛ اگر گردشده جای اصلی را بگیرد، دیر یا زود به‌عنوان مبلغِ واقعی خوانده می‌شود.
 */
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const L = (await import('../bots/tarot/locales/fa.js')).default;

const CUR = { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji };
const render = (amount, purchase) => L.wallet.invoice(amount, '6219-8619-0000-0000', 'علیرضا اولیا', purchase, CUR);
const lineOf = (text, needle) => text.split('\n').find((l) => l.includes(needle)) || '';

/* ── خواننده‌ی مستقلِ شکلِ کوتاه (نوشته‌شده از صفر، بدونِ import از locale) ──────
 * «۶۳ هزار و ۵۰۰» ⟵ ۶۳۵۰۰. ارقامِ فارسی به لاتین برمی‌گردند و هر تکه در مقیاسِ
 * خودش ضرب می‌شود. `null` یعنی چیزی دیدم که نمی‌شناسم — عمداً، تا یک خروجیِ خراب
 * به‌جای «برابر نیست» با یک عددِ ساختگی مقایسه نشود. */
const SCALE = { هزار: 1e3, میلیون: 1e6, میلیارد: 1e9 };
const faDigits = (s) => s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,]/g, '');
function shortToNum(text) {
  let total = 0;
  for (const chunk of text.trim().split(' و ')) {
    const parts = chunk.trim().split(/\s+/);
    const num = Number(faDigits(parts[0]));
    if (!Number.isFinite(num) || parts[0] === '') return null;
    if (parts.length === 1) { total += num; continue; }
    if (parts.length !== 2 || SCALE[parts[1]] === undefined) return null;
    total += num * SCALE[parts[1]];
  }
  return total;
}

console.log('\n🔢 خواننده‌ی مستقل واقعاً کار می‌کند (وگرنه بقیه‌ی ادعاها بی‌معنا می‌شوند)');
{
  // کنترلِ مثبت: بدونِ این، یک `shortToNum` که همیشه null بدهد همه‌ی ادعاهای پایین را
  // بی‌صدا خنثی می‌کرد (بند ۶ب-۲: سبزِ حاصل از نبودِ قرمز هیچ چیز ثابت نمی‌کند).
  ok(shortToNum('۶۰ هزار') === 60_000, 'شکلِ دست‌نویسِ «۶۰ هزار» خوانده می‌شود');
  ok(shortToNum('۶۳ هزار و ۵۰۰') === 63_500, 'و «۶۳ هزار و ۵۰۰» هم');
  ok(shortToNum('۱ میلیون و ۴۹۰ هزار') === 1_490_000, 'و مقیاسِ میلیون هم');
  ok(shortToNum('چیزِ ناشناس') === null, 'و ورودیِ ناشناس null می‌دهد، نه یک عددِ ساختگی');
}

console.log('\n💰 خطِ مبلغ: عددِ کامل اول، شکلِ کوتاه در پرانتز، هر دو از یک مبلغ');
{
  const purchase = { pack: { key: 'gold' }, coins: 30 };
  /* اعدادِ واقعیِ کاتالوگ + مبلغ‌های تخفیف‌خورده + مرزها. ادعای مرکزی: عددِ داخلِ
   * پرانتز، خوانده‌شده با خواننده‌ی مستقل، دقیقاً همان مبلغِ فاکتور باشد. */
  const NUMS = [10_000, 15_000, 30_000, 45_000, 60_000, 100_000, 150_000, 490_000,
    1_490_000, 63_500, 48_000, 24_000, 1_000, 1_001, 999_999, 1_000_000, 2_000_000_000];
  let bad = null;
  for (const n of NUMS) {
    const line = lineOf(render(n, purchase), 'مبلغ:');
    const inParens = (line.match(/\(([^)]+)\)/) || [])[1] || '';
    const got = shortToNum(inParens.replace('تومان', ''));
    if (got !== n) { bad = `${n} ⟵ «${inParens}» ⟵ ${got}`; break; }
  }
  ok(!bad, `هر ${NUMS.length} مبلغ، پرانتزش همان عدد را می‌گوید${bad ? ` (شکست: ${bad})` : ''}`);

  const line = lineOf(render(60_000, purchase), 'مبلغ:');
  /* ⚠️ ترتیب: عددِ کامل **قبل از** پرانتز. نسخه‌ی اولِ این کار برعکس بود و مالک ردش
   * کرد؛ بدونِ این ادعا، برگشتنِ سهویِ ترتیب بی‌صدا رد می‌شد. */
  ok(line.indexOf('۶۰٬۰۰۰ تومان') < line.indexOf('('),
    'عددِ کاملِ گروه‌بندی‌شده اول می‌آید، بعد پرانتز');
  ok(line.includes('*۶۰٬۰۰۰ تومان*'), 'و عددِ کامل همان چیزی است که بولد می‌شود');
  ok(line.includes('(۶۰ هزار تومان)'), 'شکلِ کوتاه داخلِ پرانتز است، نه جای اصلی');
  ok(lineOf(render(63_500, purchase), 'مبلغ:').includes('*۶۳٬۵۰۰ تومان* (۶۳ هزار و ۵۰۰ تومان)'),
    'مبلغِ غیرِرُند هم دقیق می‌ماند و هرگز گرد نمی‌شود');
  ok(!lineOf(render(500, purchase), 'مبلغ:').includes('('),
    'زیرِ هزار پرانتزِ تکراری ساخته نمی‌شود (همان عدد بود)');

  // ایموجیِ کیسه‌ی پول (خواسته‌ی مالک؛ بولتِ خنثای نسخه‌ی قبلی را خودش پس داد).
  ok(line.trim().startsWith('💰'), 'خطِ مبلغ با ایموجیِ کیسه‌ی پول شروع می‌شود');
}

/* ══ 💳 شماره کارت: دش‌دار، داخلِ بک‌تیک، قابلِ تپ ═══════════════════════════
 * خواسته‌ی مالک در دو قدم: اول «۴رقم‌۴رقم با دش»، بعد «تپ روی عدد هم کپی کند، با
 * همان دش» — چون خودش روی اپ‌های بانکی تست کرد و دش مشکلی نمی‌سازد.
 *
 * ⚠️ ادعای مرکزی یک **تساوی** است: نمایشِ بدونِ دش == `CARD_NUMBER`. این همان
 * خانواده‌ی باگی است که ریپو بارها خورده (ریال/تومانِ رسید، «۶۰٬۰۰۰ ستاره»): چیزی که
 * **نمایش** داده می‌شود و چیزی که **واقعاً استفاده** می‌شود از دو جا می‌آیند و
 * یکی‌شان دیر یا زود عوض می‌شود. این‌جا خطرش عملی است: یک رقمِ جابه‌جا در فرمت‌کننده
 * یعنی پولِ کاربر به کارتِ دیگری می‌رود، بی‌صدا. */
console.log('\n💳 شماره کارت: دش‌دار و قابلِ تپ');
{
  const CARD = SRC.match(/const CARD_NUMBER = '([^']+)'/)?.[1] || '';
  const OWNER = SRC.match(/const CARD_OWNER {2}= '([^']+)'/)?.[1] || '';
  ok(/^\d{16}$/.test(CARD), `CARD_NUMBER در سورس ۱۶ رقمِ خام است (بدونِ دش): ${CARD}`);

  const body = L.wallet.invoice(60_000, CARD, OWNER, { pack: { key: 'gold' }, coins: 30 }, CUR);
  const shown = body.split('\n').find((l) => /\d{4}-\d{4}/.test(l)) || '';
  ok(/^`\d{4}-\d{4}-\d{4}-\d{4}`$/.test(shown.trim()),
    `روی پیام ۴رقم‌۴رقم با دش دیده می‌شود (شد: «${shown.trim()}»)`);
  ok(shown.replace(/[^\d]/g, '') === CARD, 'و برداشتنِ دش‌ها دقیقاً همان CARD_NUMBER را می‌دهد');

  /* ⚠️ بک‌تیک **اجباری** است: تنها راهی که تپ روی خودِ عدد کپی کند. تصمیمِ صریحِ مالک
   * بعد از تستِ خودش روی اپ‌های بانکی («دش رو هم می‌فهمند و مشکل نداره»)، پس تپ عدد را
   * با دش کپی می‌کند و این عارضه نیست، انتخاب است.
   * تفکیکِ «نمایشِ دش‌دار + کپیِ تمیز» در Bot API ممکن نیست (فقط `code`/`pre` با تپ کپی
   * می‌کنند و عیناً همان چیزِ نمایشی را می‌دهند). */
  ok(/`\d{4}-\d{4}-\d{4}-\d{4}`/.test(body),
    'شماره کارت داخلِ بک‌تیک است، پس تپ روی خودش کپی می‌کند');

  /* 🔒 ولی دکمه عمداً ارقامِ **خام** را نگه می‌دارد: مسیرِ کپیِ تضمینی برای اپی که
   * روزی دش را نفهمد. یعنی دو مسیرِ کپی داریم و هر دو معتبرند. */
  const copyRow = SRC.match(/const cardCopyRow = \(\) => (.+);/)?.[1] || '';
  ok(/copy_text: \{ text: CARD_NUMBER \}/.test(copyRow),
    'دکمه‌ی کپی همچنان ارقامِ خام را می‌دهد (مسیرِ کپیِ تضمینی)');
  ok(!/cardFmt|-/.test(copyRow.replace('=>', '')), 'و هیچ دشی واردِ فیلدِ دکمه نمی‌شود');

  // نامِ صاحب کارت: خواسته‌ی صریحِ مالک «مثل روال سابق، بدونِ تغییر».
  ok(body.includes(OWNER), `نامِ صاحب کارت دست‌نخورده چاپ می‌شود («${OWNER}»)`);
  ok(/بلوبانک|بلو بانک/.test(OWNER), 'و نامِ بانک هم داخلش هست');

  /* و تطبیقِ ایجنتِ رسید از همان ارقامِ خام می‌آید، نه از رشته‌ی نمایشی — وگرنه
   * فرمتِ نمایشی می‌توانست بی‌صدا تأییدِ خودکارِ رسید را بشکند. */
  const last4 = SRC.match(/const CARD_DEST_LAST4 {5}= '(\d+)'/)?.[1] || '';
  ok(last4 && CARD.endsWith(last4), `چهار رقمِ آخرِ ایجنتِ رسید با CARD_NUMBER می‌خواند (${last4})`);
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
  ok(lineOf(body, 'کارت‌به‌کارت به:').trim().startsWith('💳'),
    'و خطِ کارت‌به‌کارت ایموجیِ مرتبطِ خودش را دارد (خواسته‌ی مالک)');
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
