#!/usr/bin/env node
// 💳 چکِ مسیرِ پولِ voice2text — رباتِ زنده‌ی درآمدزا که «هرگز نباید بشکند».
//
// این فایل از یک ممیزیِ خصمانه‌ی مسیرِ پول آمد (۱۴۰۵/۰۶/۱۵) که دو باگِ واقعی این‌جا
// پیدا کرد. هر دو بی‌صدا بودند: نه خطایی می‌دادند، نه در هیچ لاگی دیده می‌شدند.
//
// ⚠️ ادعاها عمداً **منطق را اجرا می‌کنند**، نه فقط شکلِ کد را ببینند. یک رجکس روی
// شرطِ `if` می‌گوید «شرط عوض شد»، ولی نمی‌گوید «شرطِ تازه درست است». برای یک شاخه‌ای
// که به کاربر اعتبارِ رایگان می‌دهد، این فرق حیاتی است.
//
// اجرا: node tools/check-v2t-money.mjs   (بدون شبکه، بدون دیتابیس)
import { readFileSync } from 'fs';
import path from 'path';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const SRC = readFileSync(path.resolve('bots/voice2text/index.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n💳 مسیرِ پولِ voice2text\n');

/* ══ ۱) کدِ «۱۰۰٪ تا سقفِ X» اعتبارِ بی‌سقف نمی‌دهد ═══════════════════════
 *
 * 🐛 شرطِ قبلی: `(dc.discount_percent === 100 || result.finalAmount === 0)`.
 * آن `||` سقفِ کد را کاملاً بی‌اثر می‌کرد: کدِ «۱۰۰٪ تا ۵۰٬۰۰۰» درصدش ۱۰۰ است ولی
 * `max_discount_amount` تخفیفِ واقعی را می‌بُرد، پس روی شارژِ ۵۰۰٬۰۰۰ کاربر ۴۵۰٬۰۰۰
 * بدهکار می‌ماند — و شاخه باز هم فعال می‌شد و **کلِ ۵۰۰٬۰۰۰ را رایگان** می‌داد.
 */
console.log('▶ ۱) تأییدِ خودکار فقط وقتی فاکتور واقعاً صفر شده');
{
  // همان ریاضیِ validateDiscount، برای اجرای سناریوها
  const validate = (amount, pct, cap) => {
    let d = Math.round(amount * pct / 100);
    if (cap !== null && d > cap) d = cap;
    return { discountAmount: d, finalAmount: Math.max(0, amount - d) };
  };
  const fires = (amount, pct, cap) => {
    const r = validate(amount, pct, cap);
    return { r, now: r.finalAmount === 0 && amount > 0, before: (pct === 100 || r.finalAmount === 0) && amount > 0 };
  };

  // کدِ ۱۰۰٪ بدونِ سقف: رفتارِ درست نباید عوض شده باشد
  const plain = fires(200_000, 100, null);
  ok(plain.r.finalAmount === 0 && plain.now,
    'کدِ ۱۰۰٪ بدونِ سقف هنوز خودکار تأیید می‌شود (رفتارِ درست دست‌نخورده)');

  // کدِ «۱۰۰٪ تا سقفِ ۵۰٬۰۰۰» روی مبلغ‌های مختلف
  for (const amount of [500_000, 2_000_000]) {
    const f = fires(amount, 100, 50_000);
    ok(f.r.finalAmount > 0, `[${amount}] با سقفِ ۵۰٬۰۰۰ فاکتور صفر نمی‌شود (${f.r.finalAmount})`);
    ok(f.before === true, `[${amount}] 🐛 شرطِ قدیمی این‌جا فعال می‌شد و ${amount} را رایگان می‌داد`);
    ok(f.now === false, `[${amount}] ✅ شرطِ تازه فعال نمی‌شود؛ کاربر باید ${f.r.finalAmount} را بپردازد`);
  }

  // و کدِ معمولی هم مثل قبل
  ok(fires(500_000, 90, 50_000).now === false, 'کدِ ۹۰٪ مثل قبل خودکار تأیید نمی‌شود');

  // و اینکه **کد** واقعاً همین شرط را دارد (وگرنه بالا فقط ریاضی را اثبات کرده)
  ok(/if \(result\.finalAmount === 0 && payment\.amount > 0\) \{/.test(CODE),
    'و خودِ سورس همین شرط را دارد');
  ok(!/discount_percent === 100 \|\|/.test(CODE),
    'و شاخه‌ی `discount_percent === 100 ||` که سقف را بی‌اثر می‌کرد برداشته شده');
}

/* ══ ۲) ورودیِ آزادِ مبلغ سقف دارد (بند ۹ ریشه) ═════════════════════════ */
console.log('\n▶ ۲) مبلغِ شارژ هم کف دارد هم سقف');
{
  const min = Number((SRC.match(/const MIN_RECHARGE = ([\d_]+)/) || [])[1]?.replace(/_/g, '') || 0);
  const max = Number((SRC.match(/const MAX_RECHARGE = ([\d_]+)/) || [])[1]?.replace(/_/g, '') || 0);
  ok(min > 0, `کفِ شارژ تعریف شده (${min})`);
  ok(max > 0, `سقفِ شارژ تعریف شده (${max})`);
  ok(max > min * 100, 'و سقف خیلی بالاتر از کف است (کاربرِ عادی نباید به آن بخورد)');
  ok(/amount > MAX_RECHARGE/.test(CODE), 'و در مسیرِ ورودی واقعاً اعمال می‌شود');
  // ترتیب: هر دو گارد قبل از ساختنِ فاکتور
  const guardAt = CODE.indexOf('amount > MAX_RECHARGE');
  const applyAt = CODE.indexOf('applyRechargeAmount(ctx, userId, state.paymentId, amount)');
  ok(guardAt >= 0 && applyAt > guardAt, 'و **قبل از** ثبتِ مبلغ روی فاکتور است');
}

/* ══ ۳) کارِ بوت روی .then آویزان نیست ═══════════════════════════════════
 * جزئیاتش در بخشِ زمان‌بندیِ `check-pay-exit.mjs` است (که خودِ telegraf را می‌دواند).
 * این‌جا فقط یک یادآورِ محلی است تا اگر کسی این فایل را جدا اجرا کرد هم ببیندش. */
console.log('\n▶ ۳) ریفاندِ فلوهای یتیم لحظه‌ی بوت اجرا می‌شود');
{
  ok(/bot\.launch\(\{ dropPendingUpdates: true \}, onLaunched\)/.test(CODE),
    'کارِ بوت در قلابِ onLaunch است، نه .then');
  ok(/if \(bootDone\) return;/.test(CODE), 'و گاردِ یک‌بار دارد');
  ok(/recoverOrphanFlows\(\);/.test(CODE), 'و ریفاند هنوز صدا زده می‌شود');
}

/* ══ ۴) اکشنِ ناشناخته‌ی صف بی‌صدا دور ریخته نمی‌شود ═════════════════════ */
console.log('\n▶ ۴) صفِ admin_actions ردی از اکشنِ ناشناخته می‌گذارد');
{
  ok(/ADMIN_ACTION_UNKNOWN/.test(SRC), 'مارکرِ ADMIN_ACTION_UNKNOWN هست');
  ok(/act\.action === 'approve'/.test(CODE) && /act\.action === 'reject'/.test(CODE),
    'و دو اکشنی که این ربات واقعاً می‌فهمد هنوز هندل می‌شوند');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
