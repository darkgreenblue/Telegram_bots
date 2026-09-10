#!/usr/bin/env node
// چکِ CI برای «اقتصادِ سکه» و «نسخه‌ی دومِ لحن» (tarot v3.0.0).
//
// چرا لازم است: هر دو تغییر **فعلاً فقط روی اکانتِ ادمین** اند و قرار است بعداً با یک
// خط برای همه باز شوند. دو خطرِ واقعی وجود دارد که CI باید جلویشان را بگیرد:
//   ۱) نشتی: یک مسیر یادش برود گاردِ ادمین را بزند و کاربرِ واقعیِ ربات زنده وسطِ فلو
//      ناگهان «سکه» ببیند در حالی که کیف‌پولش تومانی است.
//   ۲) ناسازگاریِ عدد: قیمتِ سکه‌ای با قیمتِ تومانی یکی نباشد (هر کارت = ۱ سکه = ۱۰٬۰۰۰).
//
// اجرا: node tools/check-coins.mjs
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import SPREADS, { SPREADS_V2, OPEN_SPREADS, SPREAD_BY_ID, spreadsFor, faOf } from '../bots/tarot/spreads.js';
import { normalizeVerdict, decisiveMode, VERDICT_MODES } from '../bots/tarot/verdict.js';

const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const LOC = readFileSync(new URL('../bots/tarot/locales/fa.js', import.meta.url), 'utf8');

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); } };

const COIN_VALUE = 10_000;

console.log('▶ الگوی دو-پرچمیِ بند ۲ج-۲ (پرچمِ فیچر + دامنه، با یک helper)');
{
  // `expectAdminOnly` = دامنه‌ی فعلیِ هر فیچر. عوض‌کردنش اینجا **عمداً** لازم است: باز کردنِ
  // یک فیچر برای همه باید یک تغییرِ آگاهانه در تست هم باشد، نه چیزی که بی‌صدا از کنارش رد شود.
  for (const [flag, gate, helper, expectFlag, expectAdminOnly] of [
    ['READING_TONE_V2', 'READING_TONE_V2_ADMIN_ONLY', 'toneV2For', true, false], // v3.3.0: برای همه باز شد
    ['COIN_ECONOMY', 'COIN_ECONOMY_ADMIN_ONLY', 'coinsOn', false, true],         // پارک‌شده
    ['UX_V2', 'UX_V2_ADMIN_ONLY', 'uxV2For', true, false],                       // v3.25.0: برای همه باز شد
  ]) {
    ok(new RegExp(`const ${flag}\\s*=\\s*${expectFlag}`).test(SRC),
      `${flag} === ${expectFlag} (${expectFlag ? 'روشن؛ رول‌بک = false کردنش' : 'پارک‌شده'})`);
    ok(new RegExp(`const ${gate}\\s*=\\s*${expectAdminOnly}`).test(SRC),
      `${gate} === ${expectAdminOnly} (${expectAdminOnly ? 'فقط ادمین' : 'باز برای همه'})`);
    // شکلِ helper باید ثابت بماند: خاموش‌کردنِ پرچمِ اصلی همیشه همه را به رفتارِ قبلی
    // برمی‌گرداند، حتی وقتی دامنه باز است (تنها مسیرِ رول‌بکِ یک‌خطی — بند ۲ج/۸).
    // استثنای عمدی: `coinsOn` یک شرطِ **اضافه** دارد چون UX v2 خودش سکه‌محور است
    // (سکه‌فروشی جزوِ همان بسته است)، پس رول‌بکش `UX_V2 = false` است نه `COIN_ECONOMY`.
    // v2.8: گاردِ دامنه از `isAdmin` به `isTester` رفت (ادمین + تسترهای دعوت‌شده).
    const own = `${flag}\\s*&&\\s*\\(!${gate}\\s*\\|\\|\\s*isTester\\(uid\\)\\)`;
    const re = helper === 'coinsOn'
      ? new RegExp(`const coinsOn\\s*=\\s*\\(uid\\)\\s*=>\\s*uxV2For\\(uid\\)\\s*\\|\\|\\s*\\(${own}\\)`)
      : new RegExp(`const ${helper}\\s*=\\s*\\(uid\\)\\s*=>\\s*${own}`);
    ok(re.test(SRC), `${helper} هم پرچمِ اصلی و هم گاردِ دامنه را با هم چک می‌کند`);
  }
  // هر تصمیمِ رو-به-کاربر باید از همین دو helper بیاید، نه از خودِ پرچمِ خام (وگرنه یک
  // مسیر گاردِ ادمین را جا می‌اندازد و کاربرِ واقعی وسطِ فلو سکه می‌بیند). کامنت‌ها را
  // کنار می‌گذاریم چون خودِ توضیحِ رول‌بک نامِ پرچم را می‌آورد.
  const CODE = SRC.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const rawUses = [...CODE.matchAll(/\bCOIN_ECONOMY\b(?!_ADMIN_ONLY)/g)].length;
  ok(rawUses === 2, `COIN_ECONOMY فقط در تعریف و داخلِ coinsOn استفاده شده (${rawUses} مورد)`);
  const rawTone = [...CODE.matchAll(/\bREADING_TONE_V2\b(?!_ADMIN_ONLY)/g)].length;
  ok(rawTone === 2, `READING_TONE_V2 فقط در تعریف و داخلِ toneV2For استفاده شده (${rawTone} مورد)`);
  // UX v2 مسیرهای زیادی را عوض می‌کند (آنبوردینگ، کاتالوگ، انتخابِ کارت، کارتِ روز،
  // سکه‌فروشی). یک مسیری که گاردِ ادمین را جا بیندازد یعنی کاربرِ واقعیِ ربات زنده
  // وسطِ فلو نسخه‌ی نیمه‌تمام می‌بیند — دقیقاً چیزی که بند ۲ج-۲ ممنوع کرده.
  const rawUx = [...CODE.matchAll(/\bUX_V2\b(?!_ADMIN_ONLY)/g)].length;
  ok(rawUx === 2, `UX_V2 فقط در تعریف و داخلِ uxV2For استفاده شده (${rawUx} مورد)`);
}

console.log('\n▶ پارک‌شدنِ اقتصادِ سکه و انحلالِ آزمایشِ نامِ واحد (تصمیمِ مالک ۱۴۰۵/۰۵/۲۴)');
{
  // کد عمداً حذف نشده (به‌زودی دوباره رویش کار می‌شود) ولی باید **خاموش** باشد، حتی برای ادمین.
  ok(/const COIN_ECONOMY = false;/.test(SRC), 'اقتصادِ سکه خاموش است (حتی ادمین دنیای تومانی را می‌بیند)');
  // چون کاتالوگِ نسل دوم هم از coinsOn شاخه می‌گیرد، همین یک پرچم هر دو را برمی‌گرداند
  ok(/spreadsFor\(coinsOn\(uid\)\)|const v2 = coinsOn\(uid\)/.test(SRC),
    'کاتالوگِ نسل دوم به همان پرچم گره خورده، پس با هم برمی‌گردند');
  // «فال‌گیر» کلاً حذف: فقط یک واحد وجود دارد. نامِ واحد از سکه 🪙 به **الماس 💎**
  // عوض شد (تصمیمِ مالک ۱۴۰۵/۰۵/۲۸) و چون تک‌منبع است، همان یک خط کافی بود.
  ok(/coinUnit: \{ name: 'الماس', emoji: '💎' \}/.test(LOC), 'واحد فقط «الماس 💎» است');
  // هیچ متنِ رو-به-کاربری نباید نام یا ایموجیِ واحد را دستی بنویسد، وگرنه عوض‌کردنِ
  // بعدیِ واحد دوباره یک شکارِ رشته‌ای می‌شود. تنها استثنا **خالِ سکه‌ی تاروت** است
  // («🪙 سکه (خاک)» = پنتاکل) که یک اصطلاحِ تاروت است نه واحدِ پول.
  {
    const lines = LOC.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .filter(l => /سکه|🪙/.test(l));
    const stray = lines.filter(l => !/سکه \(خاک\)/.test(l));
    ok(stray.length === 0, `هیچ متنی واحد را دستی «سکه» نمی‌نویسد (${stray.length} مورد)`);
    ok(lines.length === 1, 'خالِ سکه‌ی تاروت عمداً دست‌نخورده ماند (اصطلاحِ تاروت، نه واحدِ پول)');
  }
  // هیچ متنِ رو-به-کاربری نباید ایموجیِ قدیمیِ واحد را در ربات نشان بدهد
  ok(!/'🪙'/.test(SRC), 'هیچ ایموجیِ سکه‌ای در خودِ ربات نمانده (گریدِ کارت شانس هم 💎 شد)');
}

console.log('\n▶ نامِ «جای موجودی»: کیف‌پول در دنیای تومانی، «ذخایر الماس» در دنیای الماس');
{
  // چرا وابسته به واحد و نه یک جایگزینیِ سراسری: کاربرِ واقعیِ امروز موجودی‌اش **تومان**
  // است؛ گفتنِ «کیف الماس» به او دروغ می‌شود. پس کلمه از خودِ واحد می‌آید، تک‌منبع.
  // نامِ خودِ جا: «موجودی الماس» → «کیف الماس» (۱۴۰۵/۰۵/۲۸) → **«ذخایر الماس»** (۱۴۰۵/۰۵/۲۹).
  ok(/const purse = \(cur\) => \(cur\?\.on \? `ذخایر \$\{cur\.name\}` : 'کیف‌پول'\)/.test(LOC),
    'نامِ جای موجودی تک‌منبع و وابسته به واحد است');
  // هیچ متنی نباید «کیف‌پول» را دستی بنویسد؛ همه باید از purse بخوانند. لیستِ زیر
  // استثناهای **عمدی** است و هر کدام فقط در دنیای تومانی دیده می‌شود. اگر متنِ تازه‌ای
  // این کلمه را بیاورد، این چک قرمز می‌کند تا تصمیم آگاهانه باشد نه سهو.
  const ALLOWED_PURSE = [
    "cur?.on ? `ذخایر ${cur.name}` : 'کیف‌پول'",         // خودِ تعریفِ purse (تک‌منبع)
    "wallet: '💰 کیف پول'",                            // دکمه‌ی کیبوردِ دنیای قدیم
    "recharge: '➕ افزایش موجودی کیف پول'",             // دکمه‌ی شارژِ دنیای قدیم
    '`موجودی کیف‌پولت: ${moneyLong(balance, cur)}`',   // شاخه‌ی تومانیِ خودِ purseLine
    'به کیف‌پولت اضافه شد!',                            // جایزه‌ی استریک (فقط مسیرِ قدیمِ کارت روز)
    'برای اولین اقدام به شارژ کیف‌پولت',                // تخفیفِ اولین شارژ (فقط دنیای تومانی)
  ];
  {
    let body = LOC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const a of ALLOWED_PURSE) {
      ok(body.includes(a), `استثنای عمدی هنوز سرِ جایش است: ${a.slice(0, 34)}…`);
      body = body.split(a).join('');
    }
    const left = (body.match(/کیف.?پول/g) || []).length;
    ok(left === 0, `هیچ متنِ دیگری «کیف‌پول» را دستی نمی‌نویسد (${left} مورد)`);
  }
  ok(/wallet: '💰 کیف پول'/.test(LOC), 'دکمه‌ی کیف‌پولِ دنیای قدیم دست‌نخورده (الماسی‌ها «کیف الماس» می‌بینند)');
  ok(/coinShop: '💎 ذخایر الماس'/.test(LOC), 'دکمه‌ی کیبوردِ دنیای الماس «ذخایر الماس» است');
  // برچسبِ کهنه روی گوشیِ کاربر تا اولین جایگزینیِ کیبورد می‌ماند → باید هنوز match شود.
  ok(/WALLET_LABELS = \[L\.buttons\.coinShop, '💎 کیف الماس', '💎 الماس فروشی'\]/.test(SRC),
    'برچسب‌های کهنه‌ی دکمه‌ی ذخایر هنوز match می‌شوند (کیبوردِ کش‌شده)');
  ok(/rechargeLabel = \(uid\) => \(coinsOn\(uid\) \? L\.buttons\.buyCoins/.test(SRC),
    'دکمه‌ی شارژ در دنیای الماس «خرید الماس» است، نه نامِ کیف‌پول');
  // بسته‌ی وسط: نامِ «الماسی» و ایموجیِ غیرِ 💎 (وگرنه در همان دکمه دو 💎 پشت‌سرهم می‌آید)
  // v3.17.0: نامش از «بسته‌ی الماسی» به «بسته ویژه» رفت (تصمیمِ مالک) — «الماسی» با واحدِ
  // الماس اشتباه گرفته می‌شد. ایموجی و کلیدِ `gold` عمداً دست‌نخورده ماندند (کلید در
  // `payments` کاربرانِ واقعی نشسته، بند ۲ج/۱).
  // v3.38.0: نامِ بسته به `locales/<lang>.js` منتقل شد (بند ۲و)، پس این ادعا حالا دو
  // نیمه دارد: ایموجی از index.js و نام از locale. هر دو نیمه هنوز همان تصمیمِ مالک را
  // قفل می‌کنند، فقط از دو فایل خوانده می‌شوند.
  ok(/key: 'gold',\s*emoji: '💠'/.test(SRC), 'بسته‌ی وسط ایموجیِ 💠 دارد (نه 💎، وگرنه دو 💎 پشت‌سرهم)');
  ok(/packs:\s*\{[^}]*gold: 'بسته ویژه'/.test(LOC), 'نامِ بسته‌ی وسط در locale «بسته ویژه» است');
  ok(!/بسته‌ی طلایی/.test(SRC), 'نامِ قدیمیِ «بسته‌ی طلایی» نمانده');
  const LOC_CODE = LOC.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/فال‌گیر/.test(LOC_CODE), 'هیچ متنِ رو-به-کاربری «فال‌گیر» ندارد');
  ok(!/variant\(db, uid, AB_COIN_NAME\)/.test(SRC), 'دیگر هیچ انتسابِ A/B روی نامِ واحد انجام نمی‌شود');
  ok(/UPDATE experiments SET status='stopped'[\s\S]{0,220}WHERE key=\?/.test(SRC),
    'آزمایشِ نامِ واحد در DB صراحتاً stop می‌شود (نه «در حال اجرا»ی دروغین)');
}

console.log('\n▶ ریاضیِ الماس: هر کارت = ۱ الماس، بدونِ هیچ ضریبی');
{
  // مهاجرتِ «الماسِ بومی»: ضریب باید از کد **حذف** شده باشد، وگرنه دوباره ضرب می‌شود.
  ok(!/\bCOIN_VALUE\b/.test(SRC), 'هیچ ضریبی در کد نمانده (عددِ دیتابیس خودِ الماس است)');
  const all = [...SPREADS, ...SPREADS_V2, ...OPEN_SPREADS];
  const bad = all.filter(s => s.price !== s.size);
  ok(bad.length === 0, `قیمتِ همه‌ی چیدمان‌ها = تعدادِ کارت (${all.length} چیدمان)`);
  const badPos = all.filter(s => s.positions.length !== s.size);
  ok(badPos.length === 0, 'تعدادِ جایگاه‌ها با تعدادِ کارت‌ها می‌خواند');
  // یعنی «قیمت به سکه» هرگز نباید جداگانه نوشته شود
  ok(all.every(s => s.price === s.size), 'قیمتِ الماسی دقیقاً برابرِ تعدادِ کارت است');
}

console.log('\n▶ بسته‌های خریدِ سکه');
{
  const m = SRC.match(/const COIN_PACKAGES = \[([\s\S]*?)\n\];/);
  ok(!!m, 'COIN_PACKAGES تعریف شده');
  const packs = [...m[1].matchAll(/coins:\s*([\d_]+),\s*toman:\s*([\d_]+)/g)]
    .map(x => ({ coins: +x[1].replace(/_/g, ''), toman: +x[2].replace(/_/g, '') }));
  // ⚠️ v3.75.0 دو بسته‌ی گران به کاتالوگ اضافه کرد و v3.78.0 آن‌ها را به `EXTRA_PACKAGES`
  // منتقل کرد (خاموش، نه حذف‌شده). `COIN_PACKAGES` دوباره همان سه بسته‌ی فروشگاه است و
  // ادعاهای نردبانِ قیمتِ پایین هم روی همین سه می‌نشینند — دقیقاً همان چیزی که کاربر
  // می‌بیند. وضعیتِ دو بسته‌ی خاموش را `check-pack-reveal.mjs` جدا می‌سنجد.
  ok(packs.length === 3, `سه بسته‌ی فروشگاه (${packs.length}) — معمولی/ویژه/جادویی`);
  // نردبانِ قیمت: بسته‌ی بزرگ‌تر باید هر سکه را **ارزان‌تر** کند، وگرنه دلیلی برای ارتقا نیست
  const per = packs.map(p => p.toman / p.coins);
  ok(per.every((v, i) => i === 0 || v < per[i - 1]), `هر بسته‌ی بزرگ‌تر، هر سکه ارزان‌تر (${per.join(' > ')})`);
  // هر بسته باید نسبت به قیمتِ اسمیِ سکه (۱۰k) تخفیف بدهد، وگرنه خریدنش بی‌معنی است
  ok(per.every(v => v < COIN_VALUE), 'هر سه بسته از قیمتِ اسمیِ هر سکه ارزان‌ترند');
  // هدیه‌ی شارژِ ۲۰۰k نباید روی بسته اعمال شود (وگرنه بسته‌ی بزرگ دو بار تخفیف می‌گیرد)
  // ⚠️ از v3.70.0 این حساب در `creditForPayment` نشسته، چون **فاکتور** هم باید همان
  // عدد را نشان بدهد که `approvePayment` واریز می‌کند. ادعا جابه‌جا شد، ضعیف نشد.
  ok(/return amount \+ \(p\.pkg \? 0 : bonusFor\(amount\)\);/.test(SRC), 'هدیه‌ی شارژ به بسته نمی‌چسبد');
  ok(/const bonus = creditForPayment\(p\) - creditAmount;/.test(SRC),
    'و `approvePayment` از همان تک‌منبع می‌خواند، نه از کپیِ خودش');
  ok(/const back = creditAmount \+ \(p\.pkg \? 0 : bonusFor\(creditAmount\)\)/.test(SRC),
    'برگشتِ پرداخت هم دقیقاً همان مقدارِ داده‌شده را پس می‌گیرد (بدونِ هدیه‌ی نداده)');
  // اصلاحِ خودکارِ «پرداختِ کمتر» وعده‌ی بسته را می‌شکند → باید به تصمیمِ انسانی برود
  ok(/const safe = !p\.discount_code_id && !p\.pkg &&/.test(SRC),
    'پرداختِ کمترِ یک بسته خودکار اصلاح نمی‌شود (تصمیمِ انسانی)');
  // ستون افزایشی است و پیش‌فرضِ خالی دارد (بند ۲ج/۱)
  ok(/ALTER TABLE payments ADD COLUMN pkg TEXT NOT NULL DEFAULT ''/.test(SRC), 'ستونِ pkg افزایشی با پیش‌فرضِ خالی');
  // فاکتورِ بسته باید مبلغِ **پرداختی** را نشان بدهد نه ارزشِ سکه‌ها
  ok(/L\.wallet\.invoice\(pack\.toman, CARD_NUMBER, CARD_OWNER/.test(SRC), 'فاکتور، قیمتِ واقعیِ بسته را نشان می‌دهد');
  // ⚠️ شناسه‌ی فاکتور در v3.51.0 از `s.paymentId` به متغیرِ محلیِ `payId` رفت (چون مسیر
  // حالا روی ردیفِ مرده یک ردیفِ زنده باز می‌کند). چیزی که این ادعا واقعاً قفل می‌کند
  // **آرگومانِ اولِ** claimAmount است، یعنی همان عددی که به اعتبارِ کاربر تبدیل می‌شود؛
  // پس فقط نامِ شناسه آزاد شد و نیمه‌ی پولی سفت ماند.
  ok(/stmts\.claimAmount\.run\(pack\.coins, \w+\)/.test(SRC),
    'اعتبارِ داده‌شده = خودِ تعدادِ الماسِ بسته (original_amount)');
}

console.log('\n▶ ریلِ پولِ بسته: با SQLِ واقعیِ index.js روی یک DB موقت');
{
  // چرا این تست: `claimAmount` فقط `amount` را می‌نویسد و `approvePayment` اعتبار را از
  // `original_amount || amount` می‌خواند. اگر setPaymentPackage مقدارِ قبلی را به
  // original_amount منتقل نکند، کاربر به‌جای ۱۰۰ سکه فقط ۱۵ سکه می‌گیرد و **بی‌صدا**.
  // این باگ یک‌بار در همین PR اتفاق افتاد و همین تست جلویش را گرفت.
  const S = Object.fromEntries([...SRC.matchAll(/^\s{2}(\w+):\s*db\.prepare\(\s*([\s\S]*?)\),\n/gm)]
    .map(m => [m[1], m[2].trim().replace(/^["'`]|["'`]$/g, '').replace(/["'`]\s*\+\s*["'`]/g, '')]));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', step TEXT DEFAULT 'amount', receipt_file_id TEXT, admin_message_id INTEGER,
    discount_code_id INTEGER, original_amount INTEGER, created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()), adjust_note TEXT DEFAULT '', pkg TEXT NOT NULL DEFAULT '',
    invoice_issued_at INTEGER, invoice_msg_id INTEGER, invoice_reminded_at INTEGER);`);
  ok(!!S.claimAmount && !!S.setPaymentPackage, 'SQLِ واقعیِ claimAmount و setPaymentPackage از index.js خوانده شد');
  const pack = { key: 'magic', coins: 100, toman: 150_000 };
  const id = Number(db.prepare('INSERT INTO payments (user_id) VALUES (?)').run(7).lastInsertRowid);
  db.prepare(S.claimAmount).run(pack.coins, id);
  db.prepare(S.setPaymentPackage).run(pack.key, pack.toman, id);
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  ok(p.amount === pack.toman, `مبلغِ پرداختی = قیمتِ بسته (${p.amount})`);
  ok(p.original_amount === pack.coins, `اعتبارِ داده‌شده = تعدادِ الماس (${p.original_amount})`);
  const creditAmount = p.original_amount || p.amount;
  ok(creditAmount === pack.coins, `کاربر دقیقاً ${pack.coins} الماس می‌گیرد، نه کمتر`);
  ok(p.pkg === pack.key, 'کلیدِ بسته ثبت شد (گاردِ هدیه و گاردِ اصلاحِ خودکار به همین وابسته‌اند)');
  // دوبار-تپ روی دو بسته‌ی متفاوت نباید بسته را عوض کند (claimAmount اتمیک است)
  const id2 = Number(db.prepare('INSERT INTO payments (user_id) VALUES (?)').run(8).lastInsertRowid);
  db.prepare(S.claimAmount).run(10 * COIN_VALUE, id2);
  const second = db.prepare(S.claimAmount).run(100 * COIN_VALUE, id2);
  ok(second.changes === 0, 'تپِ دومِ انتخابِ بسته بی‌اثر است (گاردِ step=amount)');
  db.close();
}

console.log('\n▶ کاتالوگِ نسل دوم: عشق‌محور و تقابلی');
{
  const v2 = spreadsFor(true);
  const v1 = spreadsFor(false);
  ok(v2 !== v1, 'spreadsFor دو کاتالوگِ متفاوت می‌دهد');
  const love = v2.filter(s => s.focus === 'love');
  ok(love.length * 2 >= v2.length, `حداقل نیمی از کاتالوگ عشق است (${love.length} از ${v2.length})`);
  for (const id of ['crush', 'broken', 'stayleave', 'lovehate', 'commit']) {
    ok(v2.some(s => s.id === id), `فالِ «${id}» در کاتالوگ هست`);
  }
  ok(v2.some(s => s.id === 'yesno') && v2.some(s => s.id === 'choice'), 'آری/نه و دوراهی ماندند');
  ok(!v2.some(s => s.id === 'inner'), '«حال درونی» از کاتالوگ برداشته شد');
  // ولی هیچ چیدمانی از SPREAD_BY_ID حذف نمی‌شود، وگرنه خوانش‌های ثبت‌شده و دکمه‌های
  // کهنه‌ی داخلِ چت‌ها می‌شکنند (بند ۲ج/۱ و ۲ج/۶)
  for (const s of [...v1, ...OPEN_SPREADS]) ok(!!SPREAD_BY_ID[s.id], `چیدمانِ قدیمیِ «${s.id}» هنوز resolve می‌شود`);
  // نامِ «موضوع دلخواه» فقط در کاتالوگِ v2 به «سؤال سفارشی» تغییر می‌کند
  const o3 = OPEN_SPREADS.find(s => s.id === 'open3');
  ok(faOf(o3, true).includes('سؤال') && !faOf(o3, false).includes('سؤال'),
    'نامِ «سؤال سفارشی» فقط در کاتالوگِ v2 دیده می‌شود');
  // آی‌دی‌ها یکتا بمانند وگرنه SPREAD_BY_ID بی‌صدا یکی را می‌بلعد
  const ids = v2.map(s => s.id);
  ok(new Set(ids).size === ids.length, 'آی‌دی‌های کاتالوگِ v2 یکتا هستند');
}

console.log('\n▶ جوابِ قاطع: برچسبِ اختصاصیِ فال‌های تقابلی');
{
  const stay = spreadsFor(true).find(s => s.id === 'stayleave');
  ok(Array.isArray(stay.choiceLabels) && stay.choiceLabels.length === 2, '«موندن یا جدایی» دو برچسبِ اختصاصی دارد');
  const v = normalizeVerdict({ answer: 'موندن', sign: 'شمشیرِ سه در جایگاهِ دوم' }, 'choice', { choiceLabels: stay.choiceLabels });
  ok(v?.answer === 'موندن', 'جواب با همان کلمه‌ی عنوانِ فال برمی‌گردد، نه «مسیر اول»');
  const v2 = normalizeVerdict({ answer: 'جدایی', sign: 'برجِ سرنگون' }, 'choice', { choiceLabels: stay.choiceLabels });
  ok(v2?.answer === 'جدایی', 'سمتِ دوم هم درست تشخیص داده می‌شود');
  ok(normalizeVerdict({ answer: 'هر دو', sign: 'x' }, 'choice', { choiceLabels: stay.choiceLabels }) === null,
    'جوابِ مبهم حتی با برچسبِ اختصاصی هم رد می‌شود');
  // بدونِ برچسب باید دقیقاً مثلِ قبل کار کند (سازگاری با فال‌های قدیمی)
  ok(normalizeVerdict({ answer: 'مسیر دوم', sign: 'x' }, 'choice')?.answer === 'مسیر دوم', 'رفتارِ قدیمیِ choice دست‌نخورده');
}

console.log('\n▶ نسخه‌ی دومِ لحن: هر فال باید جواب بدهد');
{
  const love = spreadsFor(true).find(s => s.id === 'love');
  ok(decisiveMode(love, false) === null, 'در لحنِ قدیم، فالِ تفسیری جوابِ قاطع ندارد (رفتارِ قبلی)');
  ok(decisiveMode(love, true) === VERDICT_MODES.DIRECT, 'در لحنِ جدید، فالِ تفسیری هم جواب می‌دهد');
  const yesno = spreadsFor(true).find(s => s.id === 'yesno');
  ok(decisiveMode(yesno, true) === 'binary', 'فالِ تصمیم‌محور حالتِ خودش را نگه می‌دارد');
  // جوابِ طفره‌ای نباید نمایش داده شود (همان قانونِ نشکستنیِ v2.4.0، حالا برای همه‌ی فال‌ها)
  for (const hedge of ['شاید بشه، بستگی داره', 'ممکنه هم این باشه هم اون؛ بستگی به خودت داره', 'نمی‌دونم']) {
    ok(normalizeVerdict({ answer: hedge, sign: 'x' }, 'direct') === null, `جوابِ طفره‌ای رد شد: «${hedge.slice(0, 24)}»`);
  }
  ok(normalizeVerdict({ answer: 'آره، این رابطه ادامه پیدا می‌کنه', sign: 'عاشقان در جایگاهِ سوم' }, 'direct')?.answer,
    'جوابِ صریح پذیرفته می‌شود');
  ok(normalizeVerdict({ answer: 'آره، ادامه داره', sign: '' }, 'direct') === null,
    'بدونِ «نشونه» هیچ جوابی نمایش داده نمی‌شود (قلبِ فیدبکِ کاربر)');
  ok(normalizeVerdict({ answer: 'بله', sign: 'x' }, 'direct') === null,
    'تک‌کلمه جوابِ یک سؤالِ باز نیست');
}

console.log('\n▶ قواعدِ کپیِ پرامپتِ جدید (منبع: bots/tarot/STYLE.md)');
{
  // مرزِ برش تا **شروعِ پرامپتِ v4** است، نه تا readerSystem قدیمی: از v3.5.0 پرامپتِ v4
  // بینِ این دو نشسته و اگر مرز اصلاح نشود، اندازه و قواعدِ v4 به حسابِ v2 گذاشته می‌شود.
  // هر پرامپت سقف و قواعدِ خودش را دارد (سقفِ v4 در tools/check-reading-v4.mjs).
  const p = LOC.slice(LOC.indexOf('readerSystemV2'), LOC.indexOf('readerSystemV4'));
  ok(p.length > 800, 'پرامپتِ نسخه‌ی دوم پیدا شد');

  // ⚠️ سقفِ اندازه: پرامپتِ متورم روی Gemini Flash هم گران است هم کیفیت را پایین می‌آورد
  // (بازخوردِ صریحِ مالک). این ادعا عمداً سخت‌گیر است تا دفعه‌ی بعد دوباره باد نکند.
  const built = LOC.slice(p.indexOf('`') + p.indexOf('readerSystemV2'));
  ok(p.length < 4200, `پرامپت فشرده مانده (${p.length} کاراکترِ سورس، سقف ۴۲۰۰)`);
  void built;

  // «احتمال آری، طفره نه» — تاروت‌خوانِ واقعی آزادانه «احتمالا/ممکنه» می‌گوید ولی با جهت
  ok(/زبانِ احتمال آزاد است/.test(p), 'زبانِ احتمال مجاز است (نه ممنوع)');
  ok(/جهت/.test(p), 'قاعده‌ی «هر جمله باید جهت داشته باشد» هست');
  for (const phrase of ['بستگی به خودت داره', 'شاید آره شاید نه', 'به شهودت اعتماد کن', 'کائنات']) {
    ok(p.includes(phrase), `جوابِ بی‌جهتِ «${phrase}» صریحاً ممنوع شده`);
  }

  // بازخوردِ صریحِ مالک: «نشونه» مفهوم است نه برچسبی که ربات اسمش را ببرد
  ok(/هرگز ننویس «نشونه‌ات اینه»/.test(p), 'برچسبِ «نشونه‌ات» صریحاً ممنوع شده');
  ok(!/🔎/.test(p), 'هیچ برچسبِ ایموجی‌داری در پرامپت نمانده');

  // صدا
  ok(/فارسیِ گفتاری/.test(p), 'فارسیِ گفتاری خواسته شده');
  ok(/تراپیستی/.test(p), 'لحنِ تراپیستی ممنوع شده');
  ok(/بگو نیامده/.test(p), 'حرکتِ «بگو چه کارتی نیامده» هست');
  ok(/کارتِ درباری/.test(p), 'حرکتِ «کارتِ درباری = آدمِ واقعی» هست');
  ok(/نمونه‌ی صدا/.test(p), 'یک نمونه‌ی واقعی برای تقلیدِ صدا در پرامپت هست');

  // ایموجی: ممنوعِ مطلق نیست، ولی سقف دارد (تصمیمِ مالک: حداکثر یکی، در بهترین جا)
  ok(/حداکثر یک ایموجی در کلِ هر متن/.test(p), 'سقفِ یک ایموجی per پیام در پرامپت هست');
  ok(!/بدونِ ایموجی/.test(p), 'ایموجی دیگر کاملاً ممنوع نشده (فقط سقف دارد)');

  ok(/سرگرمی\/فان/.test(p), 'کلمه‌های سرگرمی/فان در خروجی ممنوع شده');
  ok(/بدونِ هشدار درباره‌ی تاروت/.test(p), 'هشدارِ «مبنای تصمیم نباشه» حذف شده');
  ok(/بدونِ شعارِ پایانی/.test(p), 'شعارِ پایانی ممنوع شده');
  ok(/خط تیره‌ی بلند/.test(p), 'قاعده‌ی «بدونِ خط تیره» حفظ شده (بند ۱۰ ریشه)');
  ok(/از خودت نساز/.test(p), 'معنیِ کارت باید از کلیدواژه‌ها بیاید نه از حدس');

  // رندرِ خروجی: نسخه‌ی جدید بدونِ برچسب، نسخه‌ی قدیم دست‌نخورده
  const vb = LOC.slice(LOC.indexOf('verdictHeader:'), LOC.indexOf('actionHeader:'));
  ok(/toneV2 \? '<b>در کل:<\/b>'/.test(vb), 'جمع‌بندیِ نسخه‌ی جدید با «در کل:» می‌آید');
  ok(/⚖️/.test(vb) && /🔎/.test(vb), 'نسخه‌ی قدیم دقیقاً دست‌نخورده مانده (رول‌بک سالم)');
  ok(/\[answer, sign, because, nuance\]\.filter\(Boolean\)\.join/.test(vb),
    'در نسخه‌ی جدید چهار بخش بدونِ هیچ برچسبی پشتِ‌هم می‌آیند');

  // جمله‌های اضافه‌ی وسطِ جرنی فقط در لحنِ قدیم می‌مانند
  ok(/if \(!toneV2For\(uid\)\) \{[\s\S]{0,200}empowerClose/.test(SRC), 'شعارِ پایانی در لحنِ جدید نمی‌رود');
  // v3.53.0: مکثِ قبلِ همین جمله هم پشتِ همان شرط رفت (وگرنه بدونِ جمله می‌ماند و تأخیرِ کور می‌شد)
  ok(/if \(!toneV2For\(uid\)\) \{ await typing\(ctx, PACE_M\); await ctx\.reply\(L\.reading\.atmosphere2\); \}/.test(SRC),
    'جمله‌ی «کارت‌ها قرار نیست بترسوننت» در لحنِ جدید نمی‌رود');
  ok(/expectations: \(toneV2\) => \(toneV2/.test(LOC), 'جمله‌ی «انتخاب دست خودته» در لحنِ جدید نمی‌رود');
}

console.log('\n▶ متن‌ها: هیچ عددِ پولی دو جا نوشته نشده');
{
  // واحدِ نمایش تک‌منبع است: money/moneyLong در locale
  ok(/const money = \(toman, cur\)/.test(LOC) && /const moneyLong = \(toman, cur\)/.test(LOC),
    'تبدیلِ واحدِ نمایش فقط در یک تابع است');
  ok(/cur\?\.on \? .*cur\.value/.test(LOC), 'وقتی سکه خاموش است، خروجی دقیقاً تومانِ قبلی می‌ماند');
  /* پولِ واقعیِ فاکتور همیشه تومان می‌ماند.
     ⚠️ نسخه‌ی قبلیِ این ادعا «هیچ `cur` ای در بدنه‌ی فاکتور نباشد» بود. از v3.70.0 که
     خطِ «بابت خرید … الماس» اضافه شد، آن **شکل** دیگر درست نیست، ولی خودِ **قاعده**
     دست‌نخورده است: چیزی که اضافه شد یک عددِ دیگر است، نه واحدی تازه برای مبلغ. پس
     ادعا تیزتر شد به‌جای اینکه برداشته شود، و حالا مستقیماً روی خودِ `amount` می‌نشیند. */
  const inv = LOC.slice(LOC.indexOf('invoice: (amount, card, owner'), LOC.indexOf('invoiceDiscounted:'));
  ok(/\$\{fmt\(amount\)\} تومان/.test(inv), 'مبلغِ فاکتور با واحدِ «تومان» چاپ می‌شود');
  ok(!/money(Long|Tight)?\(\s*amount/.test(inv),
    'و مبلغ از هیچ تابعِ تبدیلِ واحد رد نمی‌شود (پولِ واقعی هرگز به الماس تبدیل نمی‌شود)');
  // و ادعای رفتاری: عوض‌شدنِ نرخِ واحدِ نمایش نباید مبلغِ فاکتور را تکان بدهد.
  {
    const L = (await import('../bots/tarot/locales/fa.js')).default;
    const amountLine = (value) => L.wallet.invoice(60_000, 'C', 'O',
      { pack: { key: 'gold' }, coins: 30 },
      { on: true, value, name: L.coinUnit.name, emoji: L.coinUnit.emoji })
      .split('\n').find(x => x.startsWith('مبلغ:'));
    ok(!!amountLine(1) && amountLine(1).includes('تومان'), 'خطِ مبلغ در رندرِ واقعی تومانی است');
    ok(amountLine(1) === amountLine(10_000),
      'و با عوض‌شدنِ نرخِ واحدِ نمایش تکان نمی‌خورد (پولِ واقعی تبدیل نمی‌شود)');
  }
}

console.log('\n▶ تعدادِ الماس بدونِ جداکننده‌ی هزارگان (v3.77.0، گزارشِ مالک)');
{
  // «بسته جاودان» تنها بسته‌ای است که تعدادِ الماسش از هزار رد می‌شود (۱۰۰۰). جداکننده‌ی
  // هزارگانِ فارسی (٬) فقط برای مبلغ معنی دارد؛ روی یک شمارش، شبیهِ مبلغِ پولی می‌شود.
  ok(/const coinsFmt = \(n\) => Number\(n\)\.toLocaleString\('fa-IR', \{ useGrouping: false \}\);/.test(LOC),
    'coinsFmt بدونِ جداکننده تعریف شده');
  const { default: L } = await import('../bots/tarot/locales/fa.js');
  const eternal = { key: 'eternal', emoji: '👑', coins: 1000, toman: 1_490_000 };
  const cur = { name: 'الماس', emoji: '💎' };
  const btn = L.buttons.coinPack(eternal, cur);
  ok(btn.includes('۱۰۰۰') && !btn.includes('۱٬۰۰۰'), `دکمه‌ی بسته: تعدادِ الماس بدونِ جداکننده (شد: «${btn}»)`);
  ok(btn.includes('۱٬۴۹۰٬۰۰۰'), 'و مبلغِ تومانی همچنان جداکننده دارد (این عدد پول است)');
  const desc = L.wallet.starsInvoiceDesc(eternal, 100);
  ok(desc.includes('۱۰۰۰ الماس') && !desc.includes('۱٬۰۰۰'), `متنِ فاکتورِ استارز هم همین‌طور (شد: «${desc}»)`);
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
