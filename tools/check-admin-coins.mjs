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
import { readFileSync } from 'fs';
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
  // ⚠️ اگر این عدد با COIN_VALUE ربات یکی نماند، مالک فکر می‌کند ۱۰۰ الماس داده ولی
  // عددِ دیگری در کیفِ کاربر می‌نشیند — یعنی دقیقاً همان کلاسِ باگِ واحدِ پول.
  const botCoin = Number((SRC.match(/const COIN_VALUE = ([0-9_]+)/) || [])[1]?.replace(/_/g, ''));
  const dashCoin = Number((DASH.match(/coinValue: ([0-9_]+)/) || [])[1]?.replace(/_/g, ''));
  ok(botCoin === 10_000, `COIN_VALUE ربات خوانده شد (${botCoin})`);
  ok(dashCoin === botCoin, `coinValue داشبورد با COIN_VALUE ربات یکی است (${dashCoin})`);

  const { coinOf, walletText } = await import('../bots/dashboard/lib/bots.js');
  const c = coinOf('tarot');
  ok(c && c.value === botCoin, 'coinOf(tarot) واحدِ الماس را می‌دهد');
  ok(coinOf('voice2text') === null, 'و رباتِ تومانی null می‌گیرد (رفتارش دقیقاً مثل قبل)');
  ok(walletText('tarot', 1_000_000) === '۱۰۰💎', 'اعتبارِ ۱٬۰۰۰٬۰۰۰ به «۱۰۰💎» رندر می‌شود');
  ok(/تومان/.test(walletText('voice2text', 50_000)), 'و رباتِ تومانی همان «تومان» را می‌گیرد');

  // تبدیل باید **در داشبورد** باشد نه در sweepِ ربات، وگرنه ردیف‌های قدیمیِ در صف
  // (که واحدِ داخلی دارند) با تبدیلِ دوباره چند برابر می‌شدند.
  ok(/const amount = coin \? raw \* coin\.value : raw;/.test(SUPPORT),
    'ورودیِ الماس در داشبورد به واحدِ داخلی تبدیل می‌شود');
  ok(!/coinValue|coinOf/.test(SRC.slice(SRC.indexOf("act.action === 'credit'"), SRC.indexOf("act.action === 'unlock_reading'"))),
    'و sweepِ ربات دست‌نخورده مانده (ریلِ پول تک‌منبع)');
  // سقفِ ایمنی باید روی مقدارِ **تبدیل‌شده** بنشیند، وگرنه ۵٬۰۰۰٬۰۰۰ الماس هم قبول می‌شد.
  ok(/const maxIn = coin \? Math\.floor\(MAX_MANUAL \/ coin\.value\) : MAX_MANUAL;/.test(SUPPORT),
    'سقفِ ایمنی هم به همان واحد تبدیل می‌شود (۵۰۰ الماس، نه ۵٬۰۰۰٬۰۰۰)');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
