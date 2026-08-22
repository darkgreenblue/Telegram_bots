#!/usr/bin/env node
// 💎 چکِ «سمتِ ادمین هم زبانِ الماس را بلد است» — پیام‌های ادمینِ ربات + پنلِ داشبورد.
//
// چرا این فایل هست (باگِ واقعیِ ۱۴۰۵/۰۵/۳۰، رسیدِ #۱۵۳):
//   `payments.amount` = پولی که کاربر واقعاً پرداخته (تومان).
//   `payments.original_amount` = **اعتبار**، و برای پرداختِ بسته واحدش **داخلی** است
//   (۱۰۰ الماس = ۱٬۰۰۰٬۰۰۰)، نه تومان.
// پیامِ ادمین دومی را با برچسبِ «تومان» چاپ می‌کرد، پس مالک برای فاکتورِ ۱۵۰٬۰۰۰ تومانی
// پیامِ «مبلغ: ۱٬۰۰۰٬۰۰۰ تومان» گرفت. پول سالم بود، **نمایش** دروغ می‌گفت — و همین
// کلاسِ باگ (واحدِ پول) قبلاً یک بار پولِ واقعی خورده بود (ریال/تومانِ ۱۴۰۵/۰۵/۱۲).
//
// اجرا: node tools/check-admin-coins.mjs
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const L = (await import('../bots/tarot/locales/fa.js')).default;
const SRC = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
const DASH = readFileSync(path.resolve('bots/dashboard/lib/bots.js'), 'utf8');
const SUPPORT = readFileSync(path.resolve('bots/dashboard/routes/support.js'), 'utf8');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

// همان بسته‌ای که در تولید فروخته شد، و همان ردیفِ واقعیِ پرداخت #۱۵۳.
const MAGIC = { key: 'magic', fa: 'بسته‌ی جادویی', emoji: '🪄', coins: 100, toman: 150_000 };
const P153 = { id: 153, user_id: 37578585, amount: 150_000, original_amount: 1_000_000, pkg: 'magic' };
const USER = { name: 'SAMANTHA', username: 'Samantha_r66' };

console.log('▶ 💰 خطِ مبلغِ ادمین برای پرداختِ بسته');
{
  const t = L.wallet.adminMoney(P153, MAGIC);
  // ⚠️ مهم‌ترین ادعای این فایل: عددِ اعتبارِ داخلی هرگز نباید به‌عنوان تومان چاپ شود.
  ok(!/۱٬۰۰۰٬۰۰۰ تومان/.test(t), 'اعتبارِ داخلی (۱٬۰۰۰٬۰۰۰) به‌عنوان تومان چاپ نمی‌شود');
  ok(/۱۵۰٬۰۰۰ تومان/.test(t), 'مبلغِ واقعیِ فاکتور (۱۵۰٬۰۰۰ تومان) چاپ می‌شود');
  ok(/۱۰۰ الماس/.test(t), 'و اعتبار به الماس گفته می‌شود، نه به واحدِ داخلی');
  ok(/بسته‌ی جادویی/.test(t), 'نامِ بسته می‌آید تا ادمین بداند چه چیزی فروخته شده');

  // گاردِ عمومی: هر عددی که با برچسبِ «تومان» می‌آید باید واقعاً تومان باشد. تنها عددِ
  // تومانیِ معتبرِ این ردیف `amount` است، پس هیچ عددِ دیگری نباید کنارِ «تومان» بنشیند.
  const tomans = [...t.matchAll(/([۰-۹٬]+) تومان/g)].map(m => m[1]);
  ok(tomans.length === 1 && tomans[0] === '۱۵۰٬۰۰۰',
    `دقیقاً یک عددِ تومانی در متن هست و همان amount است (دیده شد: ${tomans.join(', ') || 'هیچ'})`);
}

console.log('\n▶ پرداختِ غیربسته‌ای دقیقاً مثل قبل می‌ماند');
{
  // تخفیف: amount=۲۴٬۰۰۰ پرداخت شد، original_amount=۳۰٬۰۰۰ اعتبار داده شد. هر دو تومان‌اند.
  const disc = { id: 9, user_id: 1, amount: 24_000, original_amount: 30_000, pkg: '' };
  const t = L.wallet.adminMoney(disc, null);
  ok(/۲۴٬۰۰۰ تومان/.test(t), 'مبلغِ پرداختی چاپ می‌شود');
  ok(/۳۰٬۰۰۰ تومان/.test(t), 'و اعتبارِ تومانی هم (این‌جا واقعاً تومان است)');
  ok(!/الماس/.test(t), 'هیچ حرفی از الماس نیست');

  const plain = { id: 10, user_id: 1, amount: 50_000, original_amount: null, pkg: '' };
  ok(L.wallet.adminMoney(plain, null) === 'مبلغ: ۵۰٬۰۰۰ تومان',
    'شارژِ ساده تک‌خطی و بدونِ پرانتزِ اضافه می‌ماند');
}

console.log('\n▶ هر سه پیامِ ادمین از همان تک‌منبع می‌خوانند');
{
  // ⚠️ اگر پیامی مستقیم original_amount را چاپ کند، دوباره همان باگ برمی‌گردد.
  const auto = L.wallet.adminAutoApproved(P153, USER, 'تأیید شد.', MAGIC);
  const notify = L.wallet.adminNotify(P153, USER, MAGIC);
  for (const [name, t] of [['adminAutoApproved', auto], ['adminNotify', notify]]) {
    ok(t.includes(L.wallet.adminMoney(P153, MAGIC)), `${name} از adminMoney می‌خواند`);
    ok(!/۱٬۰۰۰٬۰۰۰ تومان/.test(t), `${name} عددِ داخلی را تومان نمی‌گوید`);
  }
  // برگشتِ رسیدِ فیک: مبلغِ کسرشده هم اعتبارِ داخلی است.
  const rev = L.wallet.adminReversed(153, 37578585, 1_000_000, 100);
  ok(/۱۰۰ الماس کسر شد/.test(rev), 'adminReversed برای بسته الماس می‌گوید');
  ok(!/۱٬۰۰۰٬۰۰۰/.test(rev), 'و عددِ داخلی را نشان نمی‌دهد');
  ok(/۵۰٬۰۰۰ تومان کسر شد/.test(L.wallet.adminReversed(1, 2, 50_000, null)),
    'و برای پرداختِ تومانی دقیقاً مثل قبل تومان می‌گوید');
}

console.log('\n▶ سیم‌کشی در index.js (هیچ نقطه‌ای packOf را جا نینداخته)');
{
  ok(/const packOf = \(p\) =>/.test(SRC), 'helperِ packOf تعریف شده');
  // هر فراخوانیِ این سه پیام باید بسته را پاس بدهد، وگرنه همان نقطه دوباره باگ‌دار است.
  // ⚠️ عمداً **همه‌ی** وقوع‌ها شمرده می‌شوند، نه یک رجکسِ مرزدار: نسخه‌ی اولِ این چک با
  // یک رجکسِ `([^;]*?)` نوشته شده بود و یکی از چهار فراخوانی را ندید — یعنی دقیقاً همان
  // «یک مسیر جا می‌ماند»ی که این چک قرار است جلویش را بگیرد (بند ۸ ریشه).
  const NAMES = ['adminAutoApproved', 'adminNotify', 'adminReversed'];
  let total = 0;
  for (const name of NAMES) {
    const needle = `L.wallet.${name}(`;
    let i = SRC.indexOf(needle), n = 0;
    while (i !== -1) {
      n++; total++;
      // آرگومان‌ها ممکن است چندخطی باشند؛ پنجره‌ی بعد از نامِ تابع کافی و پایدار است.
      const win = SRC.slice(i, i + 260);
      ok(/packOf\(/.test(win), `${name} #${n} بسته را پاس می‌دهد`);
      i = SRC.indexOf(needle, i + needle.length);
    }
    ok(n > 0, `${name} در کد صدا زده می‌شود (${n} بار)`);
  }
  ok(total === 4, `هر چهار فراخوانی دیده شد (${total})`);
}

console.log('\n▶ 💎 پنلِ داشبورد به الماس شارژ می‌کند');
{
  // بعد از مهاجرتِ «الماسِ بومی» ضریبی وجود ندارد: عددِ دیتابیس خودِ تعدادِ الماس است.
  ok(!/\bCOIN_VALUE\b/.test(SRC), 'ضریب از کدِ ربات حذف شده');
  const dashCoin = Number((DASH.match(/coinValue: ([0-9_]+)/) || [])[1]?.replace(/_/g, ''));
  ok(dashCoin === 1, `coinValue داشبورد ۱ است (بدونِ تبدیل) — دیده شد ${dashCoin}`);

  const { coinOf, creditText } = await import('../bots/dashboard/lib/bots.js');
  ok(coinOf('tarot')?.value === 1, 'coinOf(tarot) واحدِ الماس با ضریبِ ۱');
  ok(coinOf('voice2text') === null, 'و رباتِ تومانی null می‌گیرد (رفتارش دقیقاً مثل قبل)');
  ok(creditText('tarot', 197) === '۱۹۷💎', 'موجودیِ ۱۹۷ به «۱۹۷💎» رندر می‌شود');
  ok(/تومان/.test(creditText('voice2text', 50_000)), 'و رباتِ تومانی همان «تومان» را می‌گیرد');

  // ورودیِ پنل دیگر ضرب نمی‌شود، ولی سقفِ ایمنی باید به واحدِ الماس باشد نه تومان.
  ok(/const amount = coin \? raw \* coin\.value : raw;/.test(SUPPORT),
    'ورودیِ الماس مستقیم ثبت می‌شود (ضریب ۱)');
  ok(/const MAX_MANUAL_COINS = 1_000;/.test(SUPPORT),
    'سقفِ ایمنیِ الماسیِ جدا تعریف شده');
  ok(/const maxIn = coin \? MAX_MANUAL_COINS : MAX_MANUAL;/.test(SUPPORT),
    'و سقف از همان می‌آید، نه از تقسیمِ سقفِ تومانی (وگرنه ۵٬۰۰۰٬۰۰۰ الماس قبول می‌شد)');
  ok(!/coinValue|coinOf/.test(SRC.slice(SRC.indexOf("act.action === 'credit'"), SRC.indexOf("act.action === 'unlock_reading'"))),
    'و sweepِ ربات دست‌نخورده مانده (ریلِ پول تک‌منبع)');
}

console.log('\n▶ 💎 دو helperِ جدا: اعتبار در برابر پولِ واقعی');
{
  const B = await import('../bots/dashboard/lib/bots.js');
  // ⚠️ helperِ مبهم نباید وجود داشته باشد. `walletText` معنی‌اش به نیتِ صداکننده بستگی
  // داشت و دقیقاً به همین دلیل `users.balance` جا ماند و مالک «۹۶۰٬۰۰۰ تومان» دید.
  ok(B.walletText === undefined, 'helperِ مبهمِ walletText دیگر وجود ندارد');
  ok(typeof B.creditText === 'function' && typeof B.moneyText === 'function',
    'دو helperِ صریح هست: creditText (اعتبار) و moneyText (پولِ واقعی)');

  ok(B.creditText('tarot', 197) === '۱۹۷💎', 'اعتبارِ tarot الماس رندر می‌شود (بدونِ تبدیل)');
  ok(B.creditNum('tarot', 197) === 197, 'و عددِ خامش برای CSV/جمع همان است');
  ok(B.moneyText('tarot', 150_000) === '۱۵۰٬۰۰۰ تومان', 'ولی پولِ واقعیِ tarot تومان می‌ماند');
  ok(!/💎/.test(B.moneyText('tarot', 150_000)), 'و هرگز الماسی نمی‌شود (درآمد تومانی است)');

  // ربات‌های دیگر باید بیت‌به‌بیت مثل قبل بمانند.
  ok(B.creditText('voice2text', 50_000) === '۵۰٬۰۰۰ تومان', 'اعتبارِ voice2text دقیقاً مثل قبل تومان است');
  ok(B.coinOf('voice2text') === null && B.coinOf('tabir-khab') === null,
    'هیچ رباتِ دیگری الماسی نشده');
  ok(B.moneyText('tabir-khab', 500_000) === '۵۰٬۰۰۰ تومان', 'ریالِ tabir مثل قبل به تومان نمایش داده می‌شود');

  // moneyText نباید به coinOf وابسته باشد — گاردِ ساختاری، نه ادعای شفاهی.
  const libSrc = readFileSync(path.resolve('bots/dashboard/lib/bots.js'), 'utf8');
  const mtBody = libSrc.slice(libSrc.indexOf('export const moneyText'), libSrc.indexOf('const fmtNum'));
  ok(!/coinOf|coinValue/.test(mtBody), 'moneyText اصلاً به واحدِ الماس کاری ندارد');
}

console.log('\n▶ 🔒 هیچ مسیری اعتبار را دوباره تومانی نمی‌کند');
{
  // ستون‌هایی که **اعتبار**اند. هر جا اسمشان کنارِ یک برچسبِ تومانیِ خام بیاید، همان باگ
  // برگشته. عمداً روی سورسِ همه‌ی routeها اجرا می‌شود تا مسیرِ **آینده** هم پوشش بگیرد.
  const dir = path.resolve('bots/dashboard/routes');
  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  ok(files.length >= 5, `فایل‌های route خوانده شدند (${files.length})`);
  const bad = [];
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    src.split('\n').forEach((ln, i) => {
      if (/^\s*(\/\/|\*)/.test(ln)) return;                       // کامنت مهم نیست
      if (!/balance|original_amount|r\.price/.test(ln)) return;
      // برچسبِ تومانیِ خام کنارِ یک ستونِ اعتباری
      if (/(' ت'|" ت"|تومان)/.test(ln) && !/creditText|creditNum|moneyText/.test(ln)) {
        bad.push(`${f}:${i + 1} ${ln.trim().slice(0, 80)}`);
      }
    });
  }
  ok(bad.length === 0, `هیچ ستونِ اعتباری با برچسبِ تومانِ خام رندر نمی‌شود${bad.length ? `\n     ${bad.join('\n     ')}` : ''}`);
}

console.log('\n▶ 🧮 «خالص» دیگر اعتبارِ مجانی را از درآمد کم نمی‌کند');
{
  // اعتبارِ مجانی پولِ نقد نیست (بدهیِ تبلیغاتی است)، پس تفریقش از درآمد عددی می‌ساخت
  // که نه جریانِ نقدی بود نه سود و زیان. فقط تخفیف درآمدِ ازدست‌رفته‌ی واقعی است.
  const fin = readFileSync(path.resolve('bots/dashboard/routes/finance.js'), 'utf8');
  ok(/const net = sum\.rev - sum\.gift - sum\.disc;/.test(fin),
    'خالص = درآمد − اعتبارِ تومانیِ ربات‌های غیرالماسی − تخفیف');
  ok(!/sum\.giftCoins.*net|net.*sum\.giftCoins/.test(fin),
    'الماسِ هدیه‌شده هرگز واردِ محاسبه‌ی تومانیِ خالص نمی‌شود');
  ok(/giftCoins/.test(fin), 'الماسِ هدیه‌شده سطلِ جدای خودش را دارد');
  ok(/function coinEconomy/.test(fin), 'کارتِ اقتصادِ الماس (هدیه/خرید/مصرف/مانده) وجود دارد');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
