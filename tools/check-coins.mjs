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

console.log('▶ گاردِ «فقط ادمین» (تا وقتی مالک تست نکرده، هیچ کاربرِ واقعی نباید ببیند)');
{
  for (const [flag, gate, helper] of [
    ['READING_TONE_V2', 'READING_TONE_V2_ADMIN_ONLY', 'toneV2For'],
    ['COIN_ECONOMY', 'COIN_ECONOMY_ADMIN_ONLY', 'coinsOn'],
  ]) {
    ok(new RegExp(`const ${gate}\\s*=\\s*true`).test(SRC), `${gate} هنوز true است (فقط ادمین)`);
    const re = new RegExp(`const ${helper}\\s*=\\s*\\(uid\\)\\s*=>\\s*${flag}\\s*&&\\s*\\(!${gate}\\s*\\|\\|\\s*isAdmin\\(uid\\)\\)`);
    ok(re.test(SRC), `${helper} هم پرچمِ اصلی و هم گاردِ ادمین را با هم چک می‌کند`);
  }
  // هر تصمیمِ رو-به-کاربر باید از همین دو helper بیاید، نه از خودِ پرچمِ خام (وگرنه یک
  // مسیر گاردِ ادمین را جا می‌اندازد و کاربرِ واقعی وسطِ فلو سکه می‌بیند). کامنت‌ها را
  // کنار می‌گذاریم چون خودِ توضیحِ رول‌بک نامِ پرچم را می‌آورد.
  const CODE = SRC.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const rawUses = [...CODE.matchAll(/\bCOIN_ECONOMY\b(?!_ADMIN_ONLY)/g)].length;
  ok(rawUses === 2, `COIN_ECONOMY فقط در تعریف و داخلِ coinsOn استفاده شده (${rawUses} مورد)`);
  const rawTone = [...CODE.matchAll(/\bREADING_TONE_V2\b(?!_ADMIN_ONLY)/g)].length;
  ok(rawTone === 2, `READING_TONE_V2 فقط در تعریف و داخلِ toneV2For استفاده شده (${rawTone} مورد)`);
}

console.log('\n▶ ریاضیِ سکه: هر کارت = ۱ سکه = ۱۰٬۰۰۰ تومان، بدونِ هیچ عددِ دومی');
{
  ok(new RegExp(`const COIN_VALUE\\s*=\\s*10_000`).test(SRC), 'COIN_VALUE برابرِ ۱۰٬۰۰۰ است');
  const all = [...SPREADS, ...SPREADS_V2, ...OPEN_SPREADS];
  const bad = all.filter(s => s.price !== s.size * COIN_VALUE);
  ok(bad.length === 0, `قیمتِ همه‌ی چیدمان‌ها = تعدادِ کارت × ۱۰٬۰۰۰ (${all.length} چیدمان)`);
  const badPos = all.filter(s => s.positions.length !== s.size);
  ok(badPos.length === 0, 'تعدادِ جایگاه‌ها با تعدادِ کارت‌ها می‌خواند');
  // یعنی «قیمت به سکه» هرگز نباید جداگانه نوشته شود
  ok(all.every(s => Math.round(s.price / COIN_VALUE) === s.size), 'قیمتِ سکه‌ای دقیقاً برابرِ تعدادِ کارت درمی‌آید');
}

console.log('\n▶ بسته‌های خریدِ سکه');
{
  const m = SRC.match(/const COIN_PACKAGES = \[([\s\S]*?)\n\];/);
  ok(!!m, 'COIN_PACKAGES تعریف شده');
  const packs = [...m[1].matchAll(/coins:\s*([\d_]+),\s*toman:\s*([\d_]+)/g)]
    .map(x => ({ coins: +x[1].replace(/_/g, ''), toman: +x[2].replace(/_/g, '') }));
  ok(packs.length === 3, `دقیقاً سه بسته (${packs.length}) — کاربر نباید بینِ گزینه‌های زیاد گیر کند`);
  // نردبانِ قیمت: بسته‌ی بزرگ‌تر باید هر سکه را **ارزان‌تر** کند، وگرنه دلیلی برای ارتقا نیست
  const per = packs.map(p => p.toman / p.coins);
  ok(per.every((v, i) => i === 0 || v < per[i - 1]), `هر بسته‌ی بزرگ‌تر، هر سکه ارزان‌تر (${per.join(' > ')})`);
  // هر بسته باید نسبت به قیمتِ اسمیِ سکه (۱۰k) تخفیف بدهد، وگرنه خریدنش بی‌معنی است
  ok(per.every(v => v < COIN_VALUE), 'هر سه بسته از قیمتِ اسمیِ هر سکه ارزان‌ترند');
  // هدیه‌ی شارژِ ۲۰۰k نباید روی بسته اعمال شود (وگرنه بسته‌ی بزرگ دو بار تخفیف می‌گیرد)
  ok(/const bonus = p\.pkg \? 0 : bonusFor\(creditAmount\)/.test(SRC), 'هدیه‌ی شارژ به بسته نمی‌چسبد');
  ok(/const back = creditAmount \+ \(p\.pkg \? 0 : bonusFor\(creditAmount\)\)/.test(SRC),
    'برگشتِ پرداخت هم دقیقاً همان مقدارِ داده‌شده را پس می‌گیرد (بدونِ هدیه‌ی نداده)');
  // اصلاحِ خودکارِ «پرداختِ کمتر» وعده‌ی بسته را می‌شکند → باید به تصمیمِ انسانی برود
  ok(/const safe = !p\.discount_code_id && !p\.pkg &&/.test(SRC),
    'پرداختِ کمترِ یک بسته خودکار اصلاح نمی‌شود (تصمیمِ انسانی)');
  // ستون افزایشی است و پیش‌فرضِ خالی دارد (بند ۲ج/۱)
  ok(/ALTER TABLE payments ADD COLUMN pkg TEXT NOT NULL DEFAULT ''/.test(SRC), 'ستونِ pkg افزایشی با پیش‌فرضِ خالی');
  // فاکتورِ بسته باید مبلغِ **پرداختی** را نشان بدهد نه ارزشِ سکه‌ها
  ok(/L\.wallet\.invoice\(pack\.toman, CARD_NUMBER, CARD_OWNER\)/.test(SRC), 'فاکتور، قیمتِ واقعیِ بسته را نشان می‌دهد');
  ok(/stmts\.claimAmount\.run\(pack\.coins \* COIN_VALUE, s\.paymentId\)/.test(SRC),
    'اعتبارِ داده‌شده = ارزشِ سکه‌های بسته (original_amount)');
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
    updated_at INTEGER DEFAULT (unixepoch()), adjust_note TEXT DEFAULT '', pkg TEXT NOT NULL DEFAULT '');`);
  ok(!!S.claimAmount && !!S.setPaymentPackage, 'SQLِ واقعیِ claimAmount و setPaymentPackage از index.js خوانده شد');
  const pack = { key: 'magic', coins: 100, toman: 150_000 };
  const id = Number(db.prepare('INSERT INTO payments (user_id) VALUES (?)').run(7).lastInsertRowid);
  db.prepare(S.claimAmount).run(pack.coins * COIN_VALUE, id);
  db.prepare(S.setPaymentPackage).run(pack.key, pack.toman, id);
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  ok(p.amount === pack.toman, `مبلغِ پرداختی = قیمتِ بسته (${p.amount})`);
  ok(p.original_amount === pack.coins * COIN_VALUE, `اعتبارِ داده‌شده = ارزشِ سکه‌ها (${p.original_amount})`);
  const creditAmount = p.original_amount || p.amount;
  ok(Math.round(creditAmount / COIN_VALUE) === pack.coins, `کاربر دقیقاً ${pack.coins} سکه می‌گیرد، نه کمتر`);
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

console.log('\n▶ قواعدِ کپیِ پرامپتِ جدید');
{
  const p = LOC.slice(LOC.indexOf('readerSystemV2'), LOC.indexOf('readerSystem: (spread)'));
  ok(p.length > 500, 'پرامپتِ نسخه‌ی دوم پیدا شد');
  for (const phrase of ['شاید', 'بستگی داره', 'به شهودت اعتماد کن', 'کائنات']) {
    ok(p.includes(phrase), `عبارتِ طفره‌ایِ «${phrase}» صریحاً به مدل ممنوع شده`);
  }
  ok(/کلمه‌های «سرگرمی»، «فان»/.test(p), 'کلمه‌ی «سرگرمی»/«فان» در خروجی ممنوع شده (دلیلِ تغییر، در متن نمی‌آید)');
  ok(/هشدار نده/.test(p), 'هشدارِ «این نباید مبنای تصمیمت باشد» حذف شده');
  ok(/تراپیست نیستی/.test(p), 'لحنِ تراپیستی/لوس‌کننده ممنوع شده');
  ok(/خط تیره‌ی بلند/.test(p), 'قاعده‌ی سراسریِ «بدونِ خط تیره» حفظ شده (بند ۱۰ ریشه)');
  ok(/Rider–Waite/.test(p), 'جواب باید به نمادِ واقعیِ کارت لنگر بخورد، نه حدس');
}

console.log('\n▶ متن‌ها: هیچ عددِ پولی دو جا نوشته نشده');
{
  // واحدِ نمایش تک‌منبع است: money/moneyLong در locale
  ok(/const money = \(toman, cur\)/.test(LOC) && /const moneyLong = \(toman, cur\)/.test(LOC),
    'تبدیلِ واحدِ نمایش فقط در یک تابع است');
  ok(/cur\?\.on \? .*cur\.value/.test(LOC), 'وقتی سکه خاموش است، خروجی دقیقاً تومانِ قبلی می‌ماند');
  // پولِ واقعی (فاکتور) همیشه تومان می‌ماند
  const inv = LOC.slice(LOC.indexOf('invoice: (amount, card, owner)'), LOC.indexOf('invoice: (amount, card, owner)') + 300);
  ok(inv.includes('تومان') && !inv.includes('cur'), 'فاکتورِ کارت‌به‌کارت همیشه به تومان می‌ماند (پولِ واقعی)');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
