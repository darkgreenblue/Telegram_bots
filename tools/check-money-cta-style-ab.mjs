#!/usr/bin/env node
// چکِ بدونِ DB برای سیم‌کشی آزمایشِ ظاهرِ CTAهای مالی. تستِ رفتاری SQLite در محیط
// دیپلوی اجرا می‌شود؛ این فایل عمداً native module نمی‌خواهد تا در CI/ماشین توسعه هم
// قراردادهای حیاتیِ ترکیبِ رنگ+قیمت را قفل کند.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ab = readFileSync('shared/ab.js', 'utf8');
const tarot = readFileSync('bots/tarot/index.js', 'utf8');
const dashboard = readFileSync('bots/dashboard/routes/experiments.js', 'utf8');
const docs = readFileSync('bots/tarot/CLAUDE.md', 'utf8');

const must = (haystack, needle, label) => {
  assert.ok(haystack.includes(needle), label);
  console.log(`  ✅ ${label}`);
};

console.log('\n🧪 رنگِ CTA + تخصیصِ لایه‌بندی‌شده\n');

must(ab, 'CREATE TABLE IF NOT EXISTS ab_assignments', 'جدول reservation جدا از exposure وجود دارد');
must(ab, 'stratum        TEXT', 'لایه در exposure/assignment ذخیره می‌شود');
must(ab, 'export function reserveStratifiedVariant', 'رزروِ variant پیش از رندر وجود دارد');
must(ab, 'export function exposeStratifiedVariant', 'exposure فقط در مسیر تأیید جداگانه ثبت می‌شود');
must(ab, 'export function releaseStratifiedReservation', 'شکست ارسال reservation را آزاد می‌کند');
must(ab, 'assign.immediate()', 'تخصیص هم‌زمان با BEGIN IMMEDIATE از توازن محافظت می‌کند');
must(ab, 'weightedBalancedChoice', 'انتخاب وزن‌دارِ متوازن یک تک‌منبع دارد');

// الگوریتم را مستقیماً از shared/ab.js اجرا می‌کنیم، نه یک کپیِ نزدیک: تغییرِ منطقِ
// واقعی بدون تغییر این تست فوراً قرمز می‌شود، ولی برای این بخش نیازی به native SQLite نیست.
const from = (src, start, end, label) => {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `${label} از shared/ab.js پیدا نشد`);
  return src.slice(a, b);
};
const hashSource = from(ab, 'function hash01', '\n\n/* تصمیمِ خالص', 'hash01');
const choiceSource = from(ab, 'function weightedBalancedChoice', '\n\n/** رزروِ شاخه', 'weightedBalancedChoice');
const { weightedBalancedChoice } = new Function('createHash', `${hashSource}\n${choiceSource}\nreturn { weightedBalancedChoice };`)(createHash);
const styleExp = { variants_json: JSON.stringify([{ key: 'control', weight: 50 }, { key: 'colored', weight: 50 }]) };
for (const layer of ['price:price_ladder_p3:control', 'price:price_ladder_p3:bulk']) {
  const counts = new Map();
  for (let i = 0; i < 101; i++) {
    const chosen = weightedBalancedChoice(styleExp, counts, `${layer}:${i}`);
    counts.set(chosen, (counts.get(chosen) || 0) + 1);
  }
  const delta = Math.abs((counts.get('control') || 0) - (counts.get('colored') || 0));
  assert.ok(delta <= 1, `توازن 50/50 در ${layer} شکسته شد: ${JSON.stringify(Object.fromEntries(counts))}`);
  console.log(`  ✅ در ${layer} توازن واقعی ${counts.get('control')}/${counts.get('colored')} است`);
}

must(tarot, "const MONEY_CTA_STYLE_EXPERIMENT = 'money_cta_style_v1';", 'کلید آزمایشِ ثابت تعریف شده است');
must(tarot, "const MONEY_CTA_COLORED_VARIANT = 'colored';", 'treatment دقیقاً colored نام دارد');
must(tarot, 'return priceExperiment ? `price:${priceExperiment}:${priceArm(uid)}`', 'لایه از بازوی قیمتِ همان کاربر ساخته می‌شود');
must(tarot, 'reserveStratifiedVariant(db, uid, MONEY_CTA_STYLE_EXPERIMENT, moneyCtaStratum(uid))', 'رنگ با تخصیص لایه‌بندی‌شده خوانده می‌شود');
must(tarot, "coinsOn(uid) && moneyCtaIsColored(uid) ? 'success' : undefined", 'خرید الماس فقط در treatment رنگی است');
must(tarot, 'colored ? PACK_STYLE[p.key] : undefined', 'بسته‌ها فقط در treatment رنگ تاریخی می‌گیرند');
must(tarot, "'money_package_callback' : 'money_recharge_callback'", 'callback دو CTA جدا ثبت می‌شود');
must(tarot, 'exposeMoneyCtaStyle(uid);', 'نمایش موفق CTA exposure را ثبت می‌کند');
must(tarot, 'releaseMoneyCtaStyle(uid);', 'شکست ارسال CTA exposure کاذب نمی‌سازد');

must(dashboard, "COALESCE(x.stratum,'')<>''", 'داشبورد لایه‌ها را جدا query می‌کند');
must(dashboard, 'نتایج لایه‌بندی‌شده', 'داشبورد کارتِ تحلیل اثر متقابل دارد');
must(docs, 'key=money_cta_style_v1', 'راهنمای راه‌اندازی دقیق آزمایش ثبت شده است');
must(docs, 'price_ladder_p3', 'راهنما صریحاً هم‌زمانی با آزمایش قیمت را پوشش می‌دهد');

console.log('\n✅ قراردادِ رنگ/قیمت/اندازه‌گیری برقرار است');
