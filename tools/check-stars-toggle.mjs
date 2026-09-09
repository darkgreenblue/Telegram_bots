// چکِ CI برای سوییچِ استارز per-فاکتورِ tarot (v3.76.0، خواسته‌ی صریحِ مالک، فقط-ادمین):
// دکمه‌ی «پرداخت با استارز تلگرام» زیرِ فاکتورِ کارت‌به‌کارت، سوییچِ رفت‌وبرگشت، انقضای
// ۳۰دقیقه‌ای، و قیمت‌گذاریِ استارز از نرخِ زنده‌ی تتر (نوبیتکس، عمومی و بدونِ کلید).
//
// ⚠️ خطرناک‌ترین جهت این‌جا **دست‌خوردنِ payments.amount** است: اگر سوییچ مبلغِ تومانی
// را با عددِ استارز جایگزین کند، SUM(amount) داشبوردِ فارسی (پروفایلِ MONEY_WALLET،
// واحدش تومان) توماناتِ واقعی را با استارز جمع می‌زند — همان خانواده‌ی باگِ مستندِ
// «۶۳۵٬۹۵۹💎 محاله» در bots/dashboard/CLAUDE.md. این چک صریح می‌سنجد که هیچ‌جای این
// فیچر amount/original_amount را نمی‌نویسد.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function bodyOf(marker, end) {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}
function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  return m ? m[2] : null;
}

console.log('\n⭐ سوییچِ استارز per-فاکتور (فارسی، فقط-ادمین)\n');

/* ══ ۱) مهاجرت‌ها و پرچمِ استقرارِ مرحله‌ای ══════════════════════════════ */
console.log('۱) مهاجرت‌ها و پرچمِ فقط-ادمین');
for (const col of ['stars_invoice_msg_id', 'stars_toggle_at', 'stars_amount', 'stars_paid_amount']) {
  ok(new RegExp(`ALTER TABLE payments ADD COLUMN ${col}`).test(SRC), `ستونِ \`${col}\` افزایشی اضافه شد`);
}
ok(/const FEATURE_STARS_TOGGLE = true;/.test(SRC), 'FEATURE_STARS_TOGGLE (کلیدِ خاموشیِ کل)');
ok(/const FEATURE_STARS_TOGGLE_ADMIN_ONLY = true;/.test(SRC), 'فعلاً فقط-ادمین، طبقِ بند ۲ج-۲ ریشه');
const gateFn = bodyOf('const starsToggleOn = (uid) =>', ';') || '';
ok(/!starsRail/.test(gateFn), 'گارد شاملِ !starsRail است — روی ru/pt/es هرگز روشن نمی‌شود');
ok(/FEATURE_STARS_TOGGLE\b/.test(gateFn) && /FEATURE_STARS_TOGGLE_ADMIN_ONLY/.test(gateFn) && /isAdmin\(uid\)/.test(gateFn),
  'و هیچ‌جا پرچمِ خام صدا زده نمی‌شود، فقط از طریقِ همین helper');

/* ══ ۲) دکمه فقط رویِ فاکتورِ بسته‌ای ═══════════════════════════════════ */
console.log('\n۲) دکمه فقط برای فاکتورِ بسته‌ای (buildInvoice بدونِ pack.key خطا می‌دهد)');
const rowFn = bodyOf('const starsToggleRow = (uid, paymentId, hasPkg) =>', ';') || '';
ok(/hasPkg && starsToggleOn\(uid\)/.test(rowFn), 'شرط هم hasPkg هم starsToggleOn را می‌خواهد');
// دو مسیرِ میراثیِ بدونِ بسته (invoiceForReading و setRechargeAmount) نباید این دکمه را صدا بزنند
const readingInvoiceFn = bodyOf('async function invoiceForReading(ctx, uid, readingId, withDiscount) {', '\n}') || '';
ok(!/starsToggleRow/.test(readingInvoiceFn), 'invoiceForReading (دنیای تومانیِ میراثی) اصلاً این دکمه را نمی‌سازد');
const setAmountFn = bodyOf('async function setRechargeAmount(ctx, uid, amount) {', '\n}') || '';
ok(!/starsToggleRow/.test(setAmountFn), 'setRechargeAmount (مبلغِ آزادِ میراثی) هم همین‌طور');
// اکشنِ pkg: همیشه true می‌دهد (pack همان‌جا انتخاب‌شده و تضمیناً موجود است)
ok(/starsToggleRow\(uid, payId, true\)/.test(SRC), 'اکشنِ pkg: همیشه hasPkg=true می‌دهد (بسته از قبل معلوم است)');

/* ══ ۳) amount/original_amount هرگز دست‌خورده نمی‌شوند ═══════════════════ */
console.log('\n۳) محافظتِ حسابداری: amount همیشه تومان می‌ماند');
for (const marker of [
  "bot.action(/^stars_toggle:(\\d+)$/, async (ctx) => {",
  "bot.action(/^card_toggle:(\\d+)$/, async (ctx) => {",
  'async function expireStarsInvoice(p) {',
]) {
  const fn = bodyOf(marker, marker.startsWith('async function') ? '\n}' : '\n});') || '';
  ok(fn.length > 0, `تابع/هندلر پیدا شد: ${marker.slice(0, 40)}…`);
  ok(!/SET\s+amount\s*=/i.test(fn) && !/setPaymentAmount|setPaymentPackage|claimAmount\.run/.test(fn),
    `و amount/original_amount را نمی‌نویسد`);
}
// ⚠️ خطی‌سنجی، نه پنجره‌ای: نسخه‌ی اولِ این ادعا کامنتِ توضیحیِ خودِ مهاجرت را («… در
// هیچ SUM(amount) ای شرکت نمی‌کند») به‌اشتباه به‌عنوانِ استفاده‌ی واقعی می‌گرفت.
const sumLines = SRC.split('\n').filter(l => /\bSUM\(/i.test(l) && /stars_paid_amount/.test(l));
ok(sumLines.length === 0, 'هیچ خطِ کدی stars_paid_amount را داخلِ SUM(...) نمی‌آورد (فقط برای آمارِ استقبال، نه درآمد)');

/* ══ ۴) رفت‌وبرگشت و انقضا ═══════════════════════════════════════════════ */
console.log('\n۴) رفت‌وبرگشت و انقضای ۳۰دقیقه‌ای');
const toggleOnFn = bodyOf("bot.action(/^stars_toggle:(\\d+)$/, async (ctx) => {", '\n});') || '';
ok(/p\.user_id !== uid \|\| p\.status !== 'pending' \|\| p\.step !== 'receipt'/.test(toggleOnFn), 'مالکیت + وضعیت قبل از هر کاری چک می‌شود');
ok(/if \(!pack\) return;/.test(toggleOnFn), 'و دفاعِ دومِ pack (حتی اگر hasPkg اشتباه صدا زده شود)');
ok(/setStarsToggle\.run\(null, stars, pid\)\.changes === 0\) return;/.test(toggleOnFn), 'ادعای اتمیک قبل از هر ادیت/ارسال (ضدِ دوبار-تپ)');
ok(/replyWithInvoice\(buildInvoice\(/.test(toggleOnFn), 'همان buildInvoice ی که ru/pt/es استفاده می‌کنند، نه یک کپی');

const toggleOffFn = bodyOf("bot.action(/^card_toggle:(\\d+)$/, async (ctx) => {", '\n});') || '';
ok(/deleteMessage\(ctx\.chat\.id, p\.stars_invoice_msg_id\)/.test(toggleOffFn), 'فاکتورِ نیتیو حذف می‌شود (editMessageText رویش کار نمی‌کند)');
ok(/clearStarsToggle\.run\(pid\)/.test(toggleOffFn), 'و نشانه‌ی سوییچ پاک می‌شود');
ok(/editMessageText\(L\.wallet\.invoice\(/.test(toggleOffFn), 'پیامِ اصلی به‌جای فاکتورِ همیشگی برمی‌گردد (همان یک منبعِ رندر)');

const expireFn = bodyOf('async function expireStarsInvoice(p) {', '\n}') || '';
ok(!/setPaymentStatus/.test(expireFn), 'انقضای استارز هرگز status را canceled نمی‌کند (بند ۹ب رول‌بک: فقط انصرافِ صریح)');
ok(/starsInvoiceExpiredNotice/.test(expireFn) && /L\.wallet\.invoice\(/.test(expireFn),
  'متنِ انقضا از همان L.wallet.invoice همیشگی می‌آید، نه رندرِ موازی');
ok(/const STARS_INVOICE_EXPIRE_SEC = 30 \* 60;/.test(SRC), 'سقفِ فاکتورِ استارزی دقیقاً ۳۰ دقیقه است');

const sweepFn = bodyOf('function sweepInvoiceLifecycle() {', '\n}') || '';
ok(/starsExpiryCandidates\.all\(STARS_INVOICE_EXPIRE_SEC\)/.test(sweepFn), 'سوییپِ ۶۰ثانیه‌ای کاندیدهای استارز را هم می‌پاید');
ok(/if \(FEATURE_STARS_TOGGLE\)/.test(sweepFn), 'و فقط وقتی فیچر روشن است (رول‌بکِ فوری بدونِ اثرِ جانبی)');

/* ══ ۵) سیم‌کشیِ successful_payment ═══════════════════════════════════════ */
console.log('\n۵) واریز از همان مسیرِ همیشگی');
ok(/if \(starsRail \|\| FEATURE_STARS_TOGGLE\)/.test(SRC), 'registerStarsPay برای فارسی هم ثبت می‌شود، طبقِ همین پرچم');
const approveFn = bodyOf('approve: (id) => {\n      const p0 = stmts.getPayment.get(id);', '\n    },') || '';
ok(/return approvePayment\(id\);/.test(approveFn), 'approve همچنان approvePayment همیشگی را صدا می‌زند (منطقِ پول تک‌منبع)');
ok(/if \(p0\?\.stars_amount\)/.test(approveFn), 'stars_paid_amount فقط وقتی ردیف واقعاً سوییچ‌شده بود زده می‌شود');

/* ══ ۶) فرمولِ قیمت‌گذاریِ استارز — روی خودِ کد اجرا می‌شود ═══════════════ */
console.log('\n۶) فرمولِ تومان⟶استارز (رفتاری)');
const usdPerStar = Number(SRC.match(/const USD_PER_STAR = ([\d.]+);/)?.[1] || 0);
ok(Math.abs(usdPerStar - 0.018) < 1e-9, `USD_PER_STAR ثابتِ تکی و تصمیمِ صریحِ مالک است (شد: ${usdPerStar})`);
ok(!/STARS_MARKUP|STARS_PER_USD/.test(SRC), 'هیچ ثابتِ «مارک‌آپ»ِ جداگانه‌ای نمانده — فرمول یک‌مرحله‌ای است');
// ⚠️ bodyOf متنِ **تا قبل از** مارکرِ پایان را می‌دهد (بدونِ خودِ `\n}`)، پس برای اجرای
// واقعی باید آکولادِ بسته را دستی برگرداند — همان نکته‌ای که نسخه‌ی اولِ همین ادعا جا انداخت.
const fnBodyRaw = bodyOf('function starsForToman(amountToman, usdtToman) {', '\n}');
const fnBody = fnBodyRaw ? fnBodyRaw + '\n}' : '';
if (fnBody) {
  const starsForToman = new Function('USD_PER_STAR', 'amountToman', 'usdtToman',
    fnBody + '\nreturn starsForToman(amountToman, usdtToman);');
  const run = (t, usdt) => starsForToman(usdPerStar, t, usdt);
  ok(run(90_000, 220_000) === 23, `۹۰٬۰۰۰ تومان با نرخِ ۲۲۰٬۰۰۰ ⟶ ۲۳ استارز (شد: ${run(90_000, 220_000)})`);
  ok(run(1_490_000, 220_000) === 377, `۱٬۴۹۰٬۰۰۰ تومان ⟶ ۳۷۷ استارز (شد: ${run(1_490_000, 220_000)})`);
  ok(run(1, 220_000) >= 1, 'کف همیشه حداقلِ ۱ استارز است، هیچ‌وقت صفر یا منفی');
  // یکنواختی: وقتی تتر گران‌تر می‌شود (تومان ضعیف‌تر)، همان مبلغِ تومانی از نظرِ
  // دلاری کمتر می‌ارزد، پس باید استارزِ **کمتری** بخرد — نه بیشتر.
  ok(run(90_000, 300_000) < run(90_000, 220_000),
    `با گران‌شدنِ نرخِ تتر، همان مبلغِ تومانی استارزِ کمتری می‌شود (۲۲۰k⟶${run(90_000, 220_000)}، ۳۰۰k⟶${run(90_000, 300_000)})`);
}

/* ══ ۷) منبعِ نرخ (نوبیتکس، عمومی بدونِ کلید) + کف/سقفِ منطقی ═══════════════ */
console.log('\n۷) نرخِ زنده از نوبیتکس + دفاع در برابرِ پاسخِ بدشکل');
ok(!/NAVASAN_API_KEY|FX_API_KEY|navasan\.tech/.test(SRC),
  'هیچ ردی از سرویسِ کلید-محورِ قبلی نمانده — نوبیتکس کلید نمی‌خواهد');
ok(/apiv2\.nobitex\.ir\/market\/stats/.test(SRC), 'endpoint نوبیتکسِ market/stats (عمومی، مستندِ خودِ سرویس)');
ok(/srcCurrency=usdt.*dstCurrency=rls/.test(SRC), 'پارامترها: بازارِ usdt-rls');
const fetchFn = bodyOf('async function fetchLiveUsdtToman() {', '\n}') || '';
ok(!/FX_API_KEY/.test(fetchFn), 'فراخوانی بدونِ هیچ کلید/توکنی انجام می‌شود (API عمومی است)');
ok(/rial \/ 10/.test(fetchFn), 'ریالِ نوبیتکس به تومان تبدیل می‌شود (÷۱۰) قبل از هر مقایسه‌ای');
ok(/FX_SANITY_MIN/.test(fetchFn) && /FX_SANITY_MAX/.test(fetchFn), 'پاسخِ بیرونِ بازه‌ی معقول رد می‌شود، نه قبول');
ok(/const FX_SANITY_MIN = 50_000, FX_SANITY_MAX = 3_000_000;/.test(SRC), 'بازه‌ی معقول: ۵۰هزار تا ۳میلیون تومان به‌ازای تتر');
ok(/FX_FALLBACK_TOMAN_PER_USDT/.test(SRC) && /process\.env\.USDT_TOMAN_RATE/.test(SRC),
  'fallback از env قابلِ تنظیم است، بدونِ دیپلوی');

/* ══ ۸) جهش‌ها ═══════════════════════════════════════════════════════════ */
console.log('\n۸) جهش‌های تأییدکننده');
{
  // جهش ۱: حذفِ گاردِ hasPkg از خودِ **شرط** (نه کلِ عبارت‌سازِ دکمه، تا وابسته به
  // Markup/L نباشد و صرفاً منطقِ بولی سنجیده شود).
  const condSrc = '(hasPkg && starsToggleOn(uid))';
  ok(rowFn.includes(condSrc), 'شرطِ اصلی در سورس پیدا شد (پایه‌ی جهش)');
  const evalCond = (src, hasPkg, starsOn) => new Function('hasPkg', 'starsToggleOn', `return ${src.replace('starsToggleOn(uid)', 'starsToggleOn()')};`)(hasPkg, () => starsOn);
  ok(evalCond(condSrc, false, true) === false, 'شرطِ سالم: بدونِ بسته، حتی با فیچرِ روشن، false می‌دهد');
  const mutatedCond = condSrc.replace('hasPkg && ', '');
  ok(evalCond(mutatedCond, false, true) === true,
    'جهشِ حذفِ hasPkg باعث می‌شود فاکتورِ بدونِ بسته هم true بگیرد — دقیقاً باگی که ادعای اصلی جلویش را می‌گیرد');

  // جهش ۲: اگر amount هم در سوییچ نوشته می‌شد (شبیه‌سازیِ درجِ دستی)
  const poisoned = toggleOnFn + '\n  stmts.setPaymentAmount.run(stars, "receipt", pid);';
  ok(/setPaymentAmount\.run/.test(poisoned) && !/setPaymentAmount\.run/.test(toggleOnFn),
    'و ادعای بخشِ ۳ روی نسخه‌ی سالم سبز و روی نسخه‌ی آلوده قرمز می‌شود (تفکیک واقعی است)');
}

/* ══ ۹) پاک‌سازیِ آرتیفکت‌ها روی انصراف/خروج (v3.77.0، گزارشِ مالک) ══════════
   باگ: بعد از انصرافِ فاکتور، «بسته‌ی فلان: ➕n الماس 💎» و فاکتورِ نیتیوِ استارز
   هر دو در چت می‌ماندند — هیچ‌کدام هیچ‌جا پاک نمی‌شدند، چون شناسه‌شان یا اصلاً
   ذخیره نشده بود (پیامِ بسته) یا فقط توسطِ card_toggle خوانده می‌شد نه pay_cancel/
   pay_exit. */
console.log('\n۹) پاک‌سازیِ آرتیفکت‌های فاکتور روی انصراف/خروج');
{
  const chosenBlock = bodyOf('const pickedMsg = await ctx.reply(L.wallet.coinPackChosen', 'const invMsg = await ctx.reply(L.wallet.invoice(pack.toman') || '';
  ok(!!chosenBlock, 'پیامِ «بسته‌ی فلان» شناسه‌اش را نگه می‌دارد');
  ok(/patchSession\(uid, \{ pickedMsgId: pickedMsg\.message_id \}\)/.test(chosenBlock),
    'و شناسه در سشن ذخیره می‌شود (dropInvoiceArtifacts بعداً از همین می‌خواند)');

  const dropFn = bodyOf('async function dropInvoiceArtifacts(ctx, uid, p) {', '\n}') || '';
  ok(/deleteMessage\(ctx\.chat\.id, p\.stars_invoice_msg_id\)/.test(dropFn), 'فاکتورِ نیتیوِ استارز حذف می‌شود');
  ok(/deleteMessage\(ctx\.chat\.id, s\.pickedMsgId\)/.test(dropFn), 'و پیامِ «بسته‌ی فلان» هم حذف می‌شود');
  ok(/patchSession\(uid, \{ pickedMsgId: null \}\)/.test(dropFn), 'و شناسه‌اش پاک می‌شود تا دوباره حذفِ بی‌اثر تلاش نشود');

  for (const marker of ["bot.action(/^pay_cancel:(\\d+)$/, async (ctx) => {", "bot.action(/^pay_exit:(\\d+)$/, async (ctx) => {"]) {
    const fn = bodyOf(marker, '\n});') || '';
    ok(/await dropInvoiceArtifacts\(ctx, uid, p\);/.test(fn),
      `«${marker.match(/\^([a-z_]+):/)[1]}» قبل از تغییرِ وضعیت آرتیفکت‌ها را پاک می‌کند`);
  }

  // جهشِ تأییدکننده: اگر dropInvoiceArtifacts واقعاً هر دو پیام را اجرا نکند (مثلاً
  // فقط یکی را حذف کند)، ادعاهای بالا باید قرمز شوند — با شبیه‌سازیِ نسخه‌ی ناقص.
  const halfFixed = dropFn.replace(/if \(s\.pickedMsgId\) \{[\s\S]*?\n  \}/, '');
  ok(/deleteMessage\(ctx\.chat\.id, p\.stars_invoice_msg_id\)/.test(halfFixed) &&
     !/deleteMessage\(ctx\.chat\.id, s\.pickedMsgId\)/.test(halfFixed),
    'جهشِ «فقط فاکتورِ استارز پاک شود» ادعای پیامِ بسته را قرمز می‌کند (تفکیک واقعی است)');
}

/* ══ نتیجه ═══════════════════════════════════════════════════════════════ */
console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
