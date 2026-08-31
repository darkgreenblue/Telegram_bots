#!/usr/bin/env node
// چکِ CI ریلِ پرداختِ استارز — بدونِ شبکه، بدونِ توکن، بدونِ دیتابیس.
// ماژولِ خالصِ `bots/tarot/starspay.js` را واقعاً import و اجرا می‌کند، چون
// `node --check` فقط سینتکس را می‌بیند و تستِ دودِ boot به این مسیرِ سرد نمی‌رسد
// (درسِ `decideReceipt` — بند ۸ ریشه).
import assert from 'node:assert/strict';
import {
  STAR_LADDERS, LADDER_RATIO, STARS_EXPERIMENT,
  ladderFor, starsFor, buildPayload, parsePayload, buildInvoice,
} from '../bots/tarot/starspay.js';

let n = 0;
const ok = (label, fn) => { fn(); n++; process.stdout.write(`  ✓ ${label}\n`); };

console.log('starspay:');

// ── نردبانِ قیمت ─────────────────────────────────────────────────────────────
ok('نردبانِ control همان تصمیمِ مالک است (۵۰/۱۰۰/۲۵۰)', () => {
  assert.deepEqual(STAR_LADDERS.control, { basic: 50, gold: 100, magic: 250 });
});

ok('هر نردبان نسبتِ ۱×/۲×/۵× را نگه می‌دارد', () => {
  for (const [name, ladder] of Object.entries(STAR_LADDERS)) {
    const base = ladder.basic;
    for (const [key, mult] of Object.entries(LADDER_RATIO)) {
      assert.equal(ladder[key], base * mult,
        `نردبانِ «${name}» نسبت را شکست: ${key} باید ${base * mult} باشد ولی ${ladder[key]} است`);
    }
  }
});

ok('بسته‌ی پایه زیرِ حداقلِ خریدِ ۵۰ استارزِ تلگرام نمی‌رود', () => {
  // زیرِ ۵۰، کاربرِ تازه مجبور است ۵۰ بخرد و باقی‌مانده برایش بماند؛ یعنی اصطکاکِ
  // خریدِ اول. اگر روزی عمداً خواستیم پایین‌تر برویم، این چک باید آگاهانه عوض شود.
  assert.ok(STAR_LADDERS.control.basic >= 50,
    `بسته‌ی پایه‌ی control (${STAR_LADDERS.control.basic}⭐) زیرِ حداقلِ خریدِ ۵۰ استارز است`);
});

ok('هر مقدارِ نردبان عددِ صحیحِ مثبت است', () => {
  for (const ladder of Object.values(STAR_LADDERS)) {
    for (const v of Object.values(ladder)) {
      assert.ok(Number.isInteger(v) && v > 0, `مقدارِ نامعتبر در نردبان: ${v}`);
    }
  }
});

ok('ladderFor روی نامِ ناشناخته به control برمی‌گردد', () => {
  assert.deepEqual(ladderFor('does-not-exist'), STAR_LADDERS.control);
  assert.deepEqual(ladderFor(undefined), STAR_LADDERS.control);
  assert.deepEqual(ladderFor('low'), STAR_LADDERS.low);
});

ok('starsFor بسته‌ی ناشناخته را null می‌دهد، نه صفر', () => {
  const l = STAR_LADDERS.control;
  assert.equal(starsFor('basic', l), 50);
  assert.equal(starsFor('nope', l), null);   // صفر یعنی «رایگان» و فاجعه است
  assert.equal(starsFor('basic', {}), null);
});

// ── payload ─────────────────────────────────────────────────────────────────
ok('payload رفت‌وبرگشتِ سالم دارد', () => {
  assert.deepEqual(parsePayload(buildPayload(42, 777)), { paymentId: 42, userId: 777 });
});

ok('payload زیرِ سقفِ ۱۲۸ بایتِ تلگرام می‌ماند', () => {
  const big = buildPayload(9_999_999_999, 9_999_999_999);
  assert.ok(Buffer.byteLength(big, 'utf8') <= 128, `payload بلند شد: ${big}`);
});

ok('payload دستکاری‌شده رد می‌شود', () => {
  for (const bad of ['', null, undefined, 'tp:1', 'tp:a:b', 'xx:1:2', 'tp:1:2:3', 'tp:-1:2']) {
    assert.equal(parsePayload(bad), null, `این payload نباید پذیرفته شود: ${bad}`);
  }
});

// ── فاکتور ──────────────────────────────────────────────────────────────────
const pack = { key: 'basic', coins: 10 };
ok('فاکتور قراردادِ استارزِ Bot API را رعایت می‌کند', () => {
  const inv = buildInvoice({ pack, stars: 50, paymentId: 7, userId: 9, title: 'T', description: 'D' });
  assert.equal(inv.currency, 'XTR');            // هر چیزِ دیگری = ردِ فاکتور
  assert.equal(inv.provider_token, '');         // استارز provider token ندارد
  assert.equal(inv.prices.length, 1);           // Bot API دقیقاً یک آیتم می‌خواهد
  assert.equal(inv.prices[0].amount, 50);       // خودِ تعدادِ استارز، نه ×۱۰۰
  assert.deepEqual(parsePayload(inv.payload), { paymentId: 7, userId: 9 });
});

ok('فاکتورِ با استارزِ نامعتبر ساخته نمی‌شود', () => {
  for (const bad of [0, -5, 1.5, NaN, null, undefined, '50']) {
    assert.throws(
      () => buildInvoice({ pack, stars: bad, paymentId: 1, userId: 2, title: 'T', description: 'D' }),
      /invalid stars/,
      `استارزِ ${bad} نباید فاکتور بسازد`);
  }
});

ok('فاکتورِ بدونِ بسته ساخته نمی‌شود', () => {
  assert.throws(
    () => buildInvoice({ pack: null, stars: 50, paymentId: 1, userId: 2, title: 'T', description: 'D' }),
    /invalid pack/);
});

ok('نامِ آزمایش ثابت است (کلیدِ داشبورد رویش نشسته)', () => {
  assert.equal(STARS_EXPERIMENT, 'stars_price_v1');
});

console.log(`\n✅ starspay: ${n} ادعا سبز`);
