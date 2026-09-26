// چکِ CI برای ریلِ پرداختِ tarot.
//
// چرا این فایل وجود دارد: در یک روز چهار باگ از **یک خانواده** پیدا شد — «شرطِ نشان‌دادنِ
// یک چیز» با «شرطِ پذیرفتنش» یکی نبود (کدی که ربات پیشنهاد می‌داد و خودش ردش می‌کرد،
// فاکتورِ رهاشده‌ای که کد را برای همیشه قفل می‌کرد، متنی که به‌جای کد رسید حساب می‌شد).
// این‌جا همان خانواده قفل می‌شود.
//
// نکته‌ی کلیدیِ طراحی: SQL از **خودِ index.js خوانده می‌شود**، نه کپی‌برداری. اگر کسی فردا
// countPendingDiscount یا claimAmount را عوض کند، این تست همان SQLِ جدید را اجرا می‌کند و
// اگر قرارداد شکسته باشد قرمز می‌شود. تستی که از روی کد کپی شده باشد هیچ‌چیز را تضمین نمی‌کند.
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/dashboard/node_modules/better-sqlite3'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

// استخراجِ یک prepared statement از سورس با نامش (همان رشته‌ای که ربات واقعاً اجرا می‌کند)
function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» در index.js پیدا نشد`); return null; }
  return m[2];
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0, original_amount INTEGER, discount_code_id INTEGER,
    discount_toman INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'amount',
    adjust_note TEXT NOT NULL DEFAULT '', invoice_issued_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE discount_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, discount_percent INTEGER NOT NULL,
    max_discount_amount INTEGER, expires_at INTEGER, max_uses_per_user INTEGER NOT NULL DEFAULT 1,
    only_user_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, total_uses INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE discount_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    payment_id INTEGER, discount_amount INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER NOT NULL DEFAULT (unixepoch()));
`);

const UID = 555;
db.prepare('INSERT INTO users (telegram_id, balance) VALUES (?, 0)').run(UID);
db.prepare("INSERT INTO discount_codes (code, discount_percent, only_user_id) VALUES ('T50X', 20, ?)").run(UID);
const CODE_ID = 1;

const S = {
  insertPayment: sqlOf('insertPayment'),
  claimAmount: sqlOf('claimAmount'),
  setPaymentDiscount: sqlOf('setPaymentDiscount'),
  countPendingDiscount: sqlOf('countPendingDiscount'),
  getUserDiscountUses: sqlOf('getUserDiscountUses'),
  getDiscountCode: sqlOf('getDiscountCode'),
};
if (Object.values(S).some(v => !v)) { console.error('\n❌ استخراجِ SQL شکست خورد\n'); process.exit(1); }

const newPayment = () => Number(db.prepare(S.insertPayment).run(UID).lastInsertRowid);
const claim = (amt, id) => db.prepare(S.claimAmount).run(amt, id).changes;
const setStatus = (st, id) => db.prepare('UPDATE payments SET status=? WHERE id=?').run(st, id);
const held = (cur) => db.prepare(S.countPendingDiscount).get(CODE_ID, UID, cur).c;
const used = () => db.prepare(S.getUserDiscountUses).get(CODE_ID, UID).c;

console.log('\n▶ claimAmount اتمیک است (ضدِ دوبار-تپِ دو مبلغ)');
{
  const p = newPayment();
  ok(claim(50_000, p) === 1, 'اولین ادعای مبلغ موفق شد');
  ok(claim(200_000, p) === 0, 'ادعای دوم بی‌اثر ماند (changes=0)');
  const row = db.prepare('SELECT amount, step FROM payments WHERE id=?').get(p);
  ok(row.amount === 50_000 && row.step === 'receipt', 'مبلغ همان اولی ماند و مرحله به رسید رفت');
}

console.log('\n▶ ریاضیِ تخفیفِ فال: اعتبارِ داده‌شده = قیمتِ کاملِ فال');
{
  const price = 30_000, payAmount = 24_000;   // ۲۰٪ تخفیف
  const p = newPayment();
  claim(price, p);
  db.prepare(S.setPaymentDiscount).run(CODE_ID, payAmount, price - payAmount, p);
  const row = db.prepare('SELECT amount, original_amount, discount_toman FROM payments WHERE id=?').get(p);
  ok(row.original_amount === price, 'original_amount = قیمتِ کاملِ فال');
  ok(row.amount === payAmount, 'amount = مبلغی که کاربر واقعاً می‌پردازد');
  ok(row.discount_toman === price - payAmount,
    `مبلغِ تخفیف در ستونِ خودش ثبت شد (${row.discount_toman}) — نه بازسازی از دو ستونِ ناهم‌واحد`);
  const credited = row.original_amount || row.amount;   // همان چیزی که approvePayment می‌کند
  ok(credited === price, 'اعتبارِ لحظه‌ی تأیید دقیقاً کفافِ فال را می‌دهد (فال باز می‌شود)');
  setStatus('canceled', p);
}

console.log('\n▶ باگِ واقعی: فاکتورِ رهاشده نباید کدِ کاربر را قفل کند');
{
  const p = newPayment();
  claim(100_000, p);
  db.prepare(S.setPaymentDiscount).run(CODE_ID, 80_000, 0, p);   // کد روی یک فاکتور نشست
  ok(held(0) === 0, 'فاکتورِ pendingِ رهاشده کد را نگه نمی‌دارد');
  const p2 = newPayment();
  claim(30_000, p2);
  ok(held(p2) === 0, 'پس کاربر می‌تواند روی فاکتورِ بعدی همان کد را بگیرد');
  setStatus('canceled', p);
  setStatus('canceled', p2);
}

console.log('\n▶ ولی رسیدِ در انتظارِ تأیید باید کد را نگه دارد (ضدِ دوبار خرج کردن)');
{
  const p = newPayment();
  claim(50_000, p);
  db.prepare(S.setPaymentDiscount).run(CODE_ID, 40_000, 0, p);
  setStatus('waiting_review', p);
  const p2 = newPayment();
  ok(held(p2) === 1, 'کد روی رسیدِ منتظرِ تأیید قفل است');
  ok(held(p) === 0, 'ولی خودِ همان فاکتور خودش را قفل نمی‌کند (ورودِ دوباره‌ی کد روی همان فاکتور)');
  setStatus('rejected', p);
  ok(held(p2) === 0, 'بعد از رد شدنِ رسید، کد دوباره آزاد است');
}

console.log('\n▶ بعد از مصرفِ واقعی، کد برای همیشه بسته است');
{
  db.prepare('INSERT INTO discount_uses (code_id, user_id, payment_id, discount_amount) VALUES (?,?,?,?)')
    .run(CODE_ID, UID, 1, 6_000);
  ok(used() === 1, 'مصرف در discount_uses ثبت شد');
  const dc = db.prepare(S.getDiscountCode).get('T50X');
  ok(used() + held(0) >= dc.max_uses_per_user, 'شرطِ «سهمیه تمام شد» برقرار است');
}

console.log('\n▶ قرارداد: شرطِ نشان‌دادن و شرطِ پذیرفتن یکی است');
{
  // firstDiscountAvailable در index.js دقیقاً همین دو شمارنده را جمع می‌کند
  const src = SRC.slice(SRC.indexOf('function firstDiscountAvailable'), SRC.indexOf('function firstDiscountAvailable') + 700);
  ok(/getUserDiscountUses/.test(src) && /countPendingDiscount/.test(src),
    'firstDiscountAvailable از همان دو شمارنده‌ی validateDiscount استفاده می‌کند');
  // تا **انتهای خودِ تابع** بخوان، نه یک پنجره‌ی کاراکتریِ ثابت: کامنتِ جدید داخلِ تابع
  // نباید ادعا را قرمز کند، ولی جابه‌جا شدنِ شرط به بیرونِ تابع باید قرمز کند.
  const nbrStart = SRC.indexOf('const needBalanceRows');
  const nbr = SRC.slice(nbrStart, SRC.indexOf('\n};', nbrStart));
  ok(/firstDiscountAvailable\(uid\)/.test(nbr),
    'دکمه‌ی پی‌وال هم از همان تابع می‌پرسد (نه از شرطِ جداگانه)');
  // اقتصادِ سکه یک مسیرِ زودهنگامِ return دارد؛ باید **قبل** از ردیفِ تخفیف باشد تا در آن
  // دنیا هیچ دکمه‌ی تخفیفی ساخته نشود (بسته‌ها خودشان تخفیف‌اند).
  ok(nbr.indexOf('coinsOn(uid)') >= 0 && nbr.indexOf('coinsOn(uid)') < nbr.indexOf('firstDiscountAvailable(uid)'),
    'در اقتصادِ سکه، پی‌وال قبل از رسیدن به دکمه‌ی تخفیف برمی‌گردد');
}

console.log('\n▶ ایجنتِ رسید با «مبلغِ روی فاکتور» مقایسه می‌کند، نه با اصلِ قبل از تخفیف');
{
  // باگِ واقعی ۱۴۰۵/۰۵/۰۹: expected = original_amount بود، پس کاربری که ۵۰k را با ۲۰٪
  // تخفیف ۴۰k پرداخت کرده بود، رسیدِ درستش «مبلغ کم» تشخیص داده و **رد** می‌شد.
  const block = SRC.slice(SRC.indexOf('const amountToman'), SRC.indexOf('const amountToman') + 120);
  ok(/const amountToman\s*=\s*p\.amount\s*;/.test(block),
    'amountToman = p.amount (مبلغی که کاربر واقعاً باید واریز کند)');
  ok(!/amountToman\s*=\s*p\.original_amount/.test(SRC),
    'هیچ‌جا original_amount مبنای تطبیقِ رسید نیست');
  // و در مقابل: اعتبارِ لحظه‌ی تأیید همچنان باید original_amount باشد
  ok(/const creditAmount\s*=\s*p\.original_amount\s*\|\|\s*p\.amount\s*;/.test(SRC),
    'ولی اعتبارِ approvePayment همچنان original_amount است (کاربر اصلِ شارژ را می‌گیرد)');
}

console.log('\n▶ پرداختِ کمتر از فاکتور: تشخیصِ decideReceipt');
{
  // نکته: از v2.6.0 مدل عددِ **خام** رسید را با واحدش می‌دهد و تبدیل در کد انجام می‌شود
  // (باگِ ریال: نگاه کن به tools/check-receipt-amount.mjs). پس فیکسچرها باید واحد داشته
  // باشند؛ رسیدِ بدونِ واحد که ده‌برابرِ فاکتور هم نیست عمداً به بازبینیِ انسانی می‌رود.
  const { decideReceipt } = await import('../bots/tarot/cardpay.js');
  const rial = (n) => ({ amount_raw: n, amount_currency: 'rial' });

  const low = decideReceipt({ verdict: 'reject', reason_code: 'amount_too_low',
    extracted: rial(400000) }, 50000);
  ok(low.action === 'underpaid', 'پرداختِ ۴۰k روی فاکتورِ ۵۰k → underpaid (نه reject)');
  ok(low.paid === 40000, 'مبلغِ واقعیِ پرداخت‌شده برگردانده می‌شود');

  const enough = decideReceipt({ verdict: 'reject', reason_code: 'amount_too_low',
    extracted: rial(500000) }, 50000);
  ok(enough.action === 'approve', 'پرداختِ کافی که مدل اشتباه رد کرده → override به approve');

  const notReceipt = decideReceipt({ verdict: 'reject', reason_code: 'not_a_receipt', extracted: {} }, 50000);
  ok(notReceipt.action === 'not_a_receipt', 'رسید نبودن همچنان مسیرِ خودش را دارد');

  const noAmount = decideReceipt({ verdict: 'reject', reason_code: 'amount_too_low', extracted: {} }, 50000);
  ok(noAmount.action === 'reject', 'بدونِ مبلغِ استخراج‌شده، underpaid نمی‌شود');

  // و همان فیکسچر بدونِ واحدِ خوانا. از v3.28.0 عددِ چاپ‌شده **همیشه ریال** خوانده می‌شود
  // (تصمیمِ صریحِ مالک: رسیدِ بانکیِ ایرانی بلااستثنا ریال است)، پس ۴۰٬۰۰۰ یعنی ۴٬۰۰۰ تومان
  // در برابرِ فاکتورِ ۵۰٬۰۰۰ — یک پرداختِ واقعاً کمتر، نه یک ابهام.
  const noUnit = decideReceipt({ verdict: 'reject', reason_code: 'amount_too_low',
    extracted: { amount_toman: 40000 } }, 50000);
  ok(noUnit.action !== 'approve', 'رسیدِ بدونِ واحدِ خوانا هرگز خودکار تأیید نمی‌شود');
  ok(noUnit.action === 'underpaid', 'و به‌عنوان پرداختِ کمتر شناخته می‌شود');
  ok(noUnit.paid === 4000, `مبلغ باید ریال خوانده شود: ۴٬۰۰۰ تومان (شد: ${noUnit.paid})`);
  // ⚠️ اصلاحِ خودکارِ فاکتور این‌جا **رخ نمی‌دهد**، ولی گاردش بالادست است نه در این تابع:
  // `processReceipt` فقط وقتی فاکتور را اصلاح می‌کند که `paid >= MIN_RECHARGE` باشد، و
  // ۴٬۰۰۰ < ۱۰٬۰۰۰. همان قاعده‌ای که پرداختِ بسته‌ای (`p.pkg`) را هم کنار می‌گذارد.
  ok(/const safe = !p\.discount_code_id && !p\.pkg && paid >= MIN_RECHARGE && paid < amountToman;/.test(SRC),
    'گاردِ اصلاحِ فاکتور هنوز MIN_RECHARGE و بسته‌ای‌نبودن را می‌خواهد');
}

console.log('\n▶ اصلاحِ فاکتور: اعتبار = دقیقاً همان چیزی که پرداخت شد');
{
  const p = newPayment();
  claim(50_000, p);
  const adj = sqlOf('adjustPaymentAmount');
  ok(!!adj, 'statement اصلاحِ فاکتور در index.js هست');
  db.prepare(adj).run(40_000, 40_000, 'اصلاح به دلیل پرداخت کمتر', p);
  const row = db.prepare('SELECT amount, original_amount, adjust_note, status FROM payments WHERE id=?').get(p);
  ok(row.amount === 40_000, 'مبلغِ فاکتور به پرداختِ واقعی اصلاح شد (درآمد = ۴۰k)');
  ok((row.original_amount || row.amount) === 40_000, 'اعتبار هم ۴۰k می‌شود، نه ۵۰k');
  ok(row.adjust_note === 'اصلاح به دلیل پرداخت کمتر', 'دلیلِ اصلاح لاگ شد');
  setStatus('approved', p);
  ok(db.prepare(adj).run(10, 10, 'x', p).changes === 0, 'فاکتورِ نهایی‌شده دیگر اصلاح نمی‌شود');
}

console.log('\n▶ گاردِ صریح: با تخفیف، پرداختِ کمتر خودکار تصمیم گرفته نمی‌شود');
{
  const src = SRC.slice(SRC.indexOf("decision.action === 'underpaid'"), SRC.indexOf("decision.action === 'underpaid'") + 400);
  ok(/!p\.discount_code_id/.test(src), 'شرطِ safe شاملِ «تخفیف نداشته باشد» است');
  ok(/paid >= MIN_RECHARGE/.test(src), 'مبلغِ خیلی کم هم خودکار تصمیم گرفته نمی‌شود');
  ok(/paid < amountToman/.test(src), 'و فقط وقتی واقعاً کمتر از فاکتور باشد');
}

console.log('\n▶ کدِ غیرفعال اصلاً پیدا نمی‌شود (getDiscountCode فیلترِ is_active دارد)');
{
  db.prepare("UPDATE discount_codes SET is_active=0 WHERE id=?").run(CODE_ID);
  ok(!db.prepare(S.getDiscountCode).get('T50X'), 'کدِ غیرفعال برنمی‌گردد');
  db.prepare("UPDATE discount_codes SET is_active=1 WHERE id=?").run(CODE_ID);
}


/* ═══ 💥 پایه‌ی تخفیف باید **پول** باشد، نه تعدادِ الماس ═══════════════════
 *
 * 🐛 باگِ واقعی و شدید (۱۴۰۵/۰۶/۱۵). ترتیبِ دو UPDATE در دنیای الماس این است:
 *   claimAmount        → amount = 30 (تعدادِ الماس)، step='receipt'
 *   setPaymentPackage  → original_amount = COALESCE(original_amount, amount) = 30
 *                        amount = 60000 (قیمتِ واقعی)
 * پس `original_amount` **الماس** است و `amount` **تومان**. `applyDiscount` پایه را
 * `p.original_amount || p.amount` می‌گرفت، یعنی ۳۰ به‌جای ۶۰٬۰۰۰:
 *   • تخفیفِ ۲۰٪ ⇒ فاکتور ۲۴ تومان، ولی الماسِ کامل داده می‌شد
 *   • `max_discount_amount` (تومانی) روی عددِ الماسی هرگز نمی‌بست
 *   • کدِ ۱۰۰٪ ⇒ تأییدِ خودکار بدونِ رسید
 * ادعاها عمداً با **SQLِ خوانده‌شده از خودِ index.js** اجرا می‌شوند تا اگر روزی ترتیبِ
 * این دو UPDATE عوض شود، همین‌جا قرمز شود.
 */
console.log('\n▶ پایه‌ی تخفیف: پول، نه الماس');
{
  const claim = sqlOf('claimAmount');
  const setPkg = sqlOf('setPaymentPackage');
  const setDisc = sqlOf('setPaymentDiscount');
  ok(!!(claim && setPkg && setDisc), 'SQLهای مسیر از سورس برداشته شدند');

  const d2 = new Database(':memory:');
  d2.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'amount',
    amount INTEGER NOT NULL DEFAULT 0, original_amount INTEGER, pkg TEXT,
    discount_code_id INTEGER, discount_toman INTEGER NOT NULL DEFAULT 0,
    invoice_issued_at INTEGER, updated_at INTEGER NOT NULL DEFAULT 0);`);
  const pid = Number(d2.prepare("INSERT INTO payments (user_id, amount, step) VALUES (7, 0, 'amount')").run().lastInsertRowid);
  d2.prepare(claim).run(30, pid);              // ۳۰ الماس
  d2.prepare(setPkg).run('gold', 60000, pid);  // قیمتِ واقعی
  const row = d2.prepare('SELECT * FROM payments WHERE id=?').get(pid);
  ok(row.original_amount === 30 && row.amount === 60000,
    `بعد از انتخابِ بسته: original_amount=${row.original_amount} (الماس)، amount=${row.amount} (تومان)`);
  ok(row.original_amount !== row.amount,
    '⇒ پس این دو ستون **هم‌واحد نیستند** و یکی‌گرفتنشان باگِ واحد می‌سازد');

  // پایه‌ی غلطِ قدیمی، و آنچه می‌ساخت
  const disc = (base, pct, cap) => { let d = Math.round(base * pct / 100); if (cap != null && d > cap) d = cap; return Math.max(0, base - d); };
  const oldBase = row.original_amount || row.amount;
  ok(disc(oldBase, 20, 50000) === 24,
    `🐛 با پایه‌ی قدیمی، تخفیفِ ۲۰٪ فاکتورِ ۶۰٬۰۰۰ را ${disc(oldBase, 20, 50000)} تومان می‌کرد`);
  ok(disc(oldBase, 100, null) === 0,
    '🐛 و کدِ ۱۰۰٪ به تأییدِ خودکارِ بدونِ رسید می‌رسید');

  // و پایه‌ی درست
  const src = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
  const packs = [...src.matchAll(/\{ key: '([a-z]+)',[^}]*coins: ([\d_]+),\s*toman: ([\d_]+)/g)]
    .map((m) => ({ key: m[1], coins: Number(m[2].replace(/_/g, '')), toman: Number(m[3].replace(/_/g, '')) }));
  ok(packs.length >= 2, `کاتالوگِ بسته‌ها از سورس خوانده شد (${packs.map((p) => p.key).join(', ')})`);
  // ⚠️ با کلید پیدا شود نه با قیمتِ هاردکد: قیمت‌ها در v3.75.0 عوض شدند و بستهٔ آخرِ
  // آرایه هم دیگر «گلد» نیست (افسانه‌ای/جاودان اضافه شدند)، پس یک پایه‌ی متناسب لازم
  // است — سقفِ ۵۰۰۰۰ فقط برای رقم‌های همان‌مقیاسِ «گلد» معنا دارد، نه بسته‌ی میلیونی.
  const gold = packs.find((p) => p.key === 'gold') || packs[0];
  ok(disc(gold.toman, 20, 50000) === Math.round(gold.toman * 0.8),
    `✅ با پایه‌ی قیمتِ بسته، ۲۰٪ ⇒ ${disc(gold.toman, 20, 50000)} تومان`);

  // و اینکه کد واقعاً همین را می‌کند (ساختاری، نه فقط ریاضی)
  const applyBody = (() => {
    const at = src.indexOf('async function applyDiscount(');
    const body = at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
    // ⚠️ کامنت‌ها پاک می‌شوند: خودِ کامنتِ توضیحی نامِ `packOf(p)` را می‌برد (تا بگوید
    // چرا استفاده **نمی‌شود**) و ادعای «به کاتالوگ وابسته نیست» را الکی قرمز می‌کرد.
    return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  })();
  /* ⚠️ ادعا عمداً روی **سادگی** هم می‌نشیند، نه فقط درستی: پایه باید مستقیم از رکورد
     بیاید. نسخه‌ی اولِ فیکس آن را از کاتالوگ می‌گرفت (`packOf(p).toman`) و یک سوراخ
     داشت — کلیدِ بسته‌ای که از کاتالوگ برداشته شود ⇒ `packOf` نال ⇒ برگشت به
     `original_amount` ⇒ **همان باگِ الماس/تومان، بی‌صدا**. `p.amount` آن سوراخ را ندارد. */
  ok(/const base = p\.amount;/.test(applyBody),
    'applyDiscount پایه را مستقیم از رکورد می‌گیرد (بدونِ وابستگی به کاتالوگ)');
  ok(!/packOf\(p\)/.test(applyBody),
    'و به کاتالوگ وابسته نیست (کلیدِ حذف‌شده نباید باگ را برگرداند)');
  ok(!/validateDiscount\(codeText, uid, p\.original_amount \|\| p\.amount/.test(applyBody),
    'و دیگر original_amount را به‌عنوان پایه نمی‌دهد');
  ok(/if \(p\.discount_code_id\)/.test(applyBody),
    'و یک فاکتور بیش از یک کد نمی‌گیرد (ضدِ انباشتِ تخفیف)');

  // دفترِ تخفیف هم تومانی ثبت شود
  const approveBody = (() => {
    const at = src.indexOf('function approvePayment(');
    return at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
  })();
  ok(/p\.discount_toman/.test(approveBody),
    'مبلغِ دفترِ تخفیف از ستونِ اختصاصیِ خودش خوانده می‌شود، نه بازسازی از original_amount');
  const src2 = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
  ok(/ALTER TABLE payments ADD COLUMN discount_toman INTEGER NOT NULL DEFAULT 0/.test(src2),
    'و ستونش افزایشی است با DEFAULT (ردیف‌های قدیمی معتبر می‌مانند — بند ۲ج/۱)');
  ok(/setPaymentDiscount\.run\(v\.dc\.id, v\.finalAmount, Math\.max\(0, base - v\.finalAmount\), p\.id\)/.test(applyBody),
    'و لحظه‌ی اعمال نوشته می‌شود، جایی که پایه واقعاً در دسترس است');
  d2.close();
}


/* ═══ 🔁 پرداختِ تأییدشده با رسیدِ دوم زنده نمی‌شود ═══════════════════════
 *
 * 🐛 `setPaymentReceipt` تنها گذارِ وضعیت بود که **هیچ گاردی روی status نداشت** و
 * بی‌قید `waiting_review` می‌نوشت. یعنی یک پرداختِ `approved` به صف برمی‌گشت، ادمین
 * دوباره تأییدش می‌کرد، و **دو بار اعتبار** به یک پرداخت می‌رسید.
 *
 * مسیرش فرضی نیست: `sendReceiptToAdmin` بعد از چند `await` (ارسال به هر ادمین) و در
 * مسیرِ داوری بعد از یک فراخوانیِ LLM این خط را می‌زند. کاربری که آلبومِ دو عکسی
 * بفرستد، عکسِ دوم `paymentId` را قبل از پاک‌شدنِ استیت برمی‌دارد و بعد از تأییدِ
 * عکسِ اول دقیقاً همان‌جا می‌رسد.
 */
console.log('\n▶ رسیدِ دوم پرداختِ تأییدشده را زنده نمی‌کند');
{
  const setRcpt = sqlOf('setPaymentReceipt');
  const setSt = sqlOf('setPaymentStatus');
  ok(!!(setRcpt && setSt), 'SQLها از سورس برداشته شدند');
  if (setRcpt && setSt) {
    const d3 = new Database(':memory:');
    d3.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
      receipt_file_id TEXT, admin_message_id INTEGER, updated_at INTEGER NOT NULL DEFAULT 0);`);
    const mk = (st) => Number(d3.prepare("INSERT INTO payments (user_id, amount, status) VALUES (9, 60000, ?)").run(st).lastInsertRowid);
    const statusOf = (id) => d3.prepare('SELECT status FROM payments WHERE id=?').get(id).status;

    // مسیرِ عادی هنوز کار می‌کند
    const live = mk('pending');
    ok(d3.prepare(setRcpt).run('f1', 11, 'waiting_review', live).changes === 1,
      'رسید روی پرداختِ زنده مثل قبل می‌نشیند');
    ok(statusOf(live) === 'waiting_review', 'و وضعیت به بازبینی می‌رود');

    // رسیدِ بهترِ دوم وقتی هنوز در صف است، هنوز مجاز است
    ok(d3.prepare(setRcpt).run('f2', 12, 'waiting_review', live).changes === 1,
      'رسیدِ دومِ همان پرداختِ در صف هم می‌نشیند (کاربر عکسِ واضح‌تر می‌فرستد)');

    // و سه وضعیتِ تعیین‌تکلیف‌شده **زنده نمی‌شوند**
    for (const dead of ['approved', 'rejected', 'canceled']) {
      const id = mk(dead);
      const ch = d3.prepare(setRcpt).run('fx', 99, 'waiting_review', id).changes;
      ok(ch === 0 && statusOf(id) === dead,
        `پرداختِ «${dead}» با رسیدِ تازه به صف برنمی‌گردد (changes=${ch})`);
    }
    d3.close();
  }

  // و گاردِ زودهنگام که فراخوانیِ پولیِ LLM را هدر نمی‌دهد
  const src3 = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
  const proc = (() => {
    const at = src3.indexOf('async function processReceipt(');
    const body = at < 0 ? '' : src3.slice(at, at + 2500);
    return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  })();
  ok(/RECEIPT_LIVE_STATES\.includes\(p\.status\)/.test(proc),
    'processReceipt پرداختِ تعیین‌تکلیف‌شده را زودهنگام رد می‌کند');
  const guardAt = proc.indexOf('RECEIPT_LIVE_STATES');
  const replyAt = proc.indexOf('receiptSent');
  ok(guardAt >= 0 && replyAt > guardAt,
    'و این گارد **قبل از** پیامِ «رسیدت رسید» و قبل از کارِ پرهزینه است');
  ok(/receiptAlreadyDone/.test(proc), 'و کاربر بی‌جواب نمی‌ماند');
  for (const loc of ['fa', 'ru', 'es', 'pt']) {
    const ls = readFileSync(path.resolve(`bots/tarot/locales/${loc}.js`), 'utf8');
    ok(/receiptAlreadyDone:/.test(ls), `پیامش در locale «${loc}» هست`);
  }
}

/* ══ 💎 «بابت خرید بسته‌ی فلان، فلان الماس» روی فاکتور ═══════════════════════
 *
 * خواسته‌ی مالک: کاربر همان اولِ فاکتور ببیند چه می‌خرد. ولی این یک خطِ تزئینی نیست،
 * یک **ادعای مالی** است: عددی که آن‌جا می‌نویسیم باید دقیقاً همان عددی باشد که موقعِ
 * تأیید به حسابش می‌نشیند. اگر این دو از دو جای مختلف بیایند، یکی‌شان دیر یا زود عوض
 * می‌شود و آن یکی ساکت می‌ماند — همان کلاسِ باگِ ریال/تومان (بند ۹ ریشه) و باگِ
 * «۶۰٬۰۰۰ ستاره» (بند ۲و/۶ج).
 *
 * و خطرناک‌ترین حالت این‌جا **واحدِ دروغ** است: در مسیرِ تومانیِ کهنه همان ستونِ
 * `original_amount` تومان است، پس چاپِ بی‌قیدش «۵۰٬۰۰۰ الماس» می‌شد. پس ادعای مرکزیِ
 * این بلوک این است که بدونِ اثباتِ الماس بودن، **هیچ عددی چاپ نشود**. */
console.log('\n💎 خطِ «بابت خرید» روی فاکتور');
{
  const bodyOf = (marker, end) => {
    const a = SRC.indexOf(marker);
    if (a < 0) return null;
    const b = SRC.indexOf(end, a);
    return b < 0 ? null : SRC.slice(a, b + end.length);
  };
  const credFn = bodyOf('const creditForPayment = (p) => {', '\n};');
  const purchFn = bodyOf('const invoicePurchaseFor = (uid, paymentId) => {', '\n};');
  ok(!!credFn, '`creditForPayment` از سورس بریده شد');
  ok(!!purchFn, '`invoicePurchaseFor` از سورس بریده شد');

  // تک‌منبع بودن: خودِ `approvePayment` هم باید از همین تابع بخواند، نه از یک کپیِ عبارت.
  const approve = bodyOf('function approvePayment(paymentId, allowRejected = false) {', '\n}');
  const approveCode = (approve || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/creditForPayment\(p\)/.test(approveCode),
    '`approvePayment` هم از همان `creditForPayment` می‌خواند (تک‌منبعِ مبلغ)');
  ok(!/bonusFor\(/.test(approveCode),
    'و کپیِ دومِ حسابِ هدیه در `approvePayment` نمانده');

  const d2 = new Database(':memory:');
  d2.exec(`CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pkg TEXT,
    amount INTEGER NOT NULL DEFAULT 0, original_amount INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'amount')`);
  const ins = d2.prepare('INSERT INTO payments (user_id, pkg, amount, original_amount) VALUES (?,?,?,?)');
  // بسته‌ی ویژه: ۳۰ الماس در `original_amount`، ۶۰٬۰۰۰ تومان در `amount` (قراردادِ setPaymentPackage)
  const pkgId = Number(ins.run(1, 'gold', 60_000, 30).lastInsertRowid);
  // مسیرِ تومانیِ کهنه: بدونِ pkg، و `original_amount` خالی ⟵ عدد **تومان** است
  const tomanId = Number(ins.run(1, null, 50_000, null).lastInsertRowid);

  const stmtsStub = { getPayment: d2.prepare('SELECT * FROM payments WHERE id=?') };
  const build = (curOn) => new Function('stmts', 'curOf', 'packOf', 'bonusFor', 'logErr', `
    ${credFn}
    ${purchFn}
    return { creditForPayment, invoicePurchaseFor };
  `)(stmtsStub, () => ({ on: curOn }), (p) => (p?.pkg ? { key: p.pkg, coins: 30, emoji: '💠' } : null),
     () => 0, () => {});

  const m = build(true);
  const got = m.invoicePurchaseFor(1, pkgId);
  ok(got && got.coins === 30, 'ردیفِ بسته ⟵ ۳۰ الماس', `دیدم: ${JSON.stringify(got)}`);
  ok(got && got.pack && got.pack.key === 'gold', 'و نامِ بسته هم همراهش می‌آید');

  // 🔴 مهم‌ترین ادعای این بلوک.
  ok(m.invoicePurchaseFor(1, tomanId) === null,
    'ردیفِ تومانیِ کهنه ⟵ **هیچ عددی** (وگرنه «۵۰٬۰۰۰ الماس» چاپ می‌شد)');
  ok(build(false).invoicePurchaseFor(1, pkgId) === null,
    'دنیای تومانی ⟵ هیچ عددی، حتی روی ردیفِ بسته');
  ok(m.invoicePurchaseFor(1, 99_999) === null, 'پرداختِ ناموجود ⟵ هیچ عددی');
  ok(m.invoicePurchaseFor(1, null) === null, 'بدونِ شناسه‌ی پرداخت ⟵ هیچ عددی');

  // fail-safe: خطای دیتابیس نباید فاکتور را بشکند.
  const boom = new Function('stmts', 'curOf', 'packOf', 'bonusFor', 'logErr', `
    ${credFn}
    ${purchFn}
    return invoicePurchaseFor;
  `)({ getPayment: { get() { throw new Error('db down'); } } }, () => ({ on: true }),
     () => null, () => 0, () => {});
  ok(boom(1, pkgId) === null, 'خطای دیتابیس ⟵ هیچ عددی، نه استثنا (فاکتور نمی‌شکند)');

  // 🔗 عددِ نمایشی == عددی که واقعاً واریز می‌شود.
  const row = stmtsStub.getPayment.get(pkgId);
  ok(m.creditForPayment(row) === got.coins,
    'عددِ روی فاکتور دقیقاً همان چیزی است که `approvePayment` واریز می‌کند');

  // و همان عدد روی متنِ واقعیِ فارسی می‌نشیند.
  const L = (await import('../bots/tarot/locales/fa.js')).default;
  const cur = { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji };
  const text = L.wallet.invoice(60_000, '6219861904145405', 'مالک', got, cur);
  ok(text.includes('۳۰'), 'متنِ فاکتور عددِ ۳۰ را نشان می‌دهد', text);
  /* ⚠️ v3.81.0: خطِ جداگانه‌ی «بابت خرید …» حذف شد و همان عدد به **عنوانِ** فاکتور رفت
   * («🧾 فاکتور خرید ۳۰ الماس»). قاعده‌ی این بلوک عوض نشده — «عددی که وعده می‌دهیم همان
   * است که واریز می‌شود» و «اول چه می‌خری، بعد چقدر می‌پردازی» — فقط جایش یک خط بالاتر
   * رفت، پس ادعا هم یک خط بالاتر می‌رود نه اینکه برداشته شود. */
  ok(text.startsWith('🧾 فاکتور خرید ۳۰'), 'و عنوانِ فاکتور خودش همان عدد را می‌گوید');
  ok(text.indexOf('۳۰') < text.indexOf('مبلغ:'),
    'عددِ خرید **قبل از** مبلغ می‌آید (ترتیبِ خواسته‌ی مالک)');
  ok(text.indexOf('مبلغ:') < text.indexOf('کارت‌به‌کارت'),
    'و مبلغ قبل از شماره‌ی کارت');
  const legacy = L.wallet.invoice(50_000, '6219861904145405', 'مالک');
  ok(!legacy.includes('💎') && !legacy.includes('بابت خرید'),
    'فاکتورِ بدونِ خرید بیت‌به‌بیت همان قبلی است (نه خطِ خرید، نه ایموجیِ الماس)');
  ok(!/—|--/.test(text), 'بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)');

  // چهار زبان باید هم‌شکل باشند، وگرنه اولین locale که امضایش عقب بماند بی‌صدا خطا می‌دهد.
  for (const loc of ['fa', 'ru', 'es', 'pt']) {
    const LL = (await import(`../bots/tarot/locales/${loc}.js`)).default;
    const c2 = { on: true, value: 1, name: LL.coinUnit.name, emoji: LL.coinUnit.emoji };
    let withP = '', without = '';
    try {
      withP = LL.wallet.invoice(1, 'c', 'o', { pack: { key: 'gold' }, coins: 30 }, c2);
      without = LL.wallet.invoice(1, 'c', 'o');
    } catch (e) { /* پایین قرمز می‌شود */ }
    ok(withP.includes('30') || withP.includes('۳۰'), `locale «${loc}»: عدد را چاپ می‌کند`);
    ok(!!without && !without.includes('💎'), `locale «${loc}»: بدونِ خرید، خطِ الماس نمی‌آید`);
  }
  d2.close();
}

/* ══ ⏱️ پیام و مکثِ انسانیِ رسید ════════════════════════════════════════════ */
console.log('\n▶ پیام و زمان‌بندیِ بررسیِ رسید');
{
  const src = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
  const start = src.indexOf('const receiptDecisionDelayMs =');
  const end = start < 0 ? -1 : src.indexOf('\n\n/*', start);
  const helperSrc = start < 0 || end < 0 ? '' : src.slice(start, end);
  ok(!!helperSrc, 'helper زمان‌بندیِ رسید از سورس پیدا شد');

  const sampled = [];
  const delayFor = helperSrc
    ? new Function('randomInt', `${helperSrc}\nreturn receiptDecisionDelayMs;`)((min, max) => {
      sampled.push([min, max]);
      return min;
    })
    : () => 0;
  ok(delayFor({ pkg: 'basic' }) === 40_000 && sampled.at(-1)?.join(',') === '40,61',
    'بسته‌ی معمولی از بازه‌ی تصادفیِ ۴۰ تا ۶۰ ثانیه می‌آید');
  ok(delayFor({ pkg: 'gold' }) === 15_000 && sampled.at(-1)?.join(',') === '15,31',
    'بسته‌ی ویژه از بازه‌ی تصادفیِ ۱۵ تا ۳۰ ثانیه می‌آید');
  ok(delayFor({ pkg: 'magic' }) === 15_000 && sampled.at(-1)?.join(',') === '15,31',
    'بسته‌ی جادویی از بازه‌ی تصادفیِ ۱۵ تا ۳۰ ثانیه می‌آید');

  const faLocale = (await import('../bots/tarot/locales/fa.js')).default;
  const fa = faLocale.wallet.receiptSent;
  ok(fa.includes('حداکثر تا ۱۲ ساعت') && fa.includes('ارسال رسید تکراری خودداری کن'),
    'پیامِ رسید، سقفِ بررسی و پرهیز از رسیدِ تکراری را روشن می‌گوید');
  ok(fa.includes('بسته‌های ویژه💠 و جادویی🪄 معمولاً زودتر تایید می‌شن'),
    'پیامِ رسید، اولویتِ بسته‌های ویژه و جادویی را روشن می‌گوید');

  const rejectStart = src.indexOf('const rejectedPaymentReply =');
  const rejectEnd = rejectStart < 0 ? -1 : src.indexOf('\nasync function sendRejectedPayment', rejectStart);
  const rejectHelper = rejectStart < 0 || rejectEnd < 0 ? '' : src.slice(rejectStart, rejectEnd);
  ok(!!rejectHelper && /supportLink\(SUPPORT_BOT_CODE, uid, L\.support\)/.test(rejectHelper),
    'دکمه‌ی رد پرداخت از همان لینکِ پشتیبانیِ منوی اصلی ساخته می‌شود');
  const markup = {
    button: { url: (text, url) => ({ text, url }) },
    inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
  };
  const { supportLink } = await import('../shared/support.js');
  const rejectedFor = rejectHelper
    ? new Function('Markup', 'supportLink', 'SUPPORT_BOT_CODE', 'L', `${rejectHelper}\nreturn rejectedPaymentReply;`)(
      markup, supportLink, 'TRT', { wallet: { rejected: faLocale.wallet.rejected }, support: faLocale.support })
    : () => ({ text: '', extra: {} });
  const rejected = rejectedFor(1050056040);
  const supportButton = rejected.extra?.reply_markup?.inline_keyboard?.[0]?.[0];
  ok(rejected.text === '❌ پرداخت شما تأیید نشد.\n\nبرای پیگیری با پشتیبانی ربات از طریق دکمه‌ی زیر می‌تونی ارتباط بگیری👇',
    'متنِ ردِ فارسی دقیقاً همان نسخه‌ی مصوب است و آی‌دیِ پشتیبانی ندارد');
  ok(supportButton?.text === faLocale.support.openBtn
    && new URL(supportButton?.url).searchParams.get('text') === faLocale.support.draft('#TRT-1050056040'),
  'دکمه‌ی رد، کد #TRT و متنِ آماده‌ی همان مسیرِ پشتیبانی را در چت باز می‌کند');
  ok(!/ctx\.reply\(L\.wallet\.rejected\)/.test(src)
    && !/sendMessage\(p\.user_id, L\.wallet\.rejected\)/.test(src)
    && (src.match(/rejectedPaymentReply\(/g) || []).length === 3
    && (src.match(/sendRejectedPayment\(/g) || []).length === 3,
  'هر چهار مسیرِ ارسالِ رد از پیامِ دکمه‌دارِ مشترک استفاده می‌کنند');
}

/* ══ 🛟 رسیدِ **دستی**-تأییدشده هم شبکه‌ی ایمنیِ برگشت می‌گیرد ══════════════════════ */
// از تیکتِ واقعیِ پرداختِ #۱۳۰۲: مالک یک رسید را دستی approve کرد و بعد فهمید اشتباه
// بوده. رسیدِ auto-approve شده از قبل دکمه‌ی «🚫 پیامکش نیومده» را داشت (notifyAdminAutoApproved)؛
// approve/susyes دستی هیچ‌کدام نداشتند و کیبورد را کاملاً حذف می‌کردند
// (`editMessageReplyMarkup(undefined)`), یعنی تصمیمِ اشتباهِ ادمین راهِ برگشتی جز
// جست‌وجوی دستیِ ردیف در DB نداشت. حالا هر دو همان یک‌دکمه‌ایِ `cardsms:${pid}` را
// می‌گذارند که به همان `confirmReverse → cardrev → reversePayment` وصل است.
console.log('\n▶ 🛟 approve/susyes همان دکمه‌ی «پیامکش نیومده» را می‌گذارند');
{
  function bodyOf(marker, end = '\n});') {
    const from = SRC.indexOf(marker);
    if (from < 0) return null;
    const to = SRC.indexOf(end, from);
    return to < 0 ? null : SRC.slice(from, to);
  }
  const approveBody = bodyOf("bot.action(/^approve:(\\d+)$/, async (ctx) => {");
  const susyesBody = bodyOf("bot.action(/^susyes:(\\d+)$/, async (ctx) => {");
  const rejectBody = bodyOf("bot.action(/^reject:(\\d+)$/, async (ctx) => {");
  const susnoBody = bodyOf("bot.action(/^susno:(\\d+)$/, async (ctx) => {");
  ok(!!approveBody, 'بدنه‌ی approve: از سورس پیدا شد');
  ok(!!susyesBody, 'بدنه‌ی susyes: از سورس پیدا شد');
  ok(!!rejectBody, 'بدنه‌ی reject: از سورس پیدا شد');
  ok(!!susnoBody, 'بدنه‌ی susno: از سورس پیدا شد');

  // از v3.120.0 کیبوردِ بعد از تأیید از تک‌منبعِ `creditedReceiptKb` ساخته می‌شود («پیامکش
  // نیومده» + زیرش «رسید تکراری»). محتوای خودِ آن کیبورد را check-receipt-agent می‌سنجد.
  const CARDSMS_KEYBOARD = /editMessageReplyMarkup\(creditedReceiptKb\(pid\)\)/;

  ok(approveBody ? CARDSMS_KEYBOARD.test(approveBody) : false,
    'approve: بعد از تأیید، کیبورد را با تک‌دکمه‌ی cardsms جایگزین می‌کند');
  ok(approveBody ? !/editMessageReplyMarkup\(undefined\)/.test(approveBody) : false,
    'و دیگر کلِ کیبورد را (undefined) حذف نمی‌کند');

  ok(susyesBody ? CARDSMS_KEYBOARD.test(susyesBody) : false,
    'susyes: هم بعد از تأیید همان تک‌دکمه‌ی cardsms را می‌گذارد');
  ok(susyesBody ? !/editMessageReplyMarkup\(undefined\)/.test(susyesBody) : false,
    'و دیگر کلِ کیبورد را (undefined) حذف نمی‌کند');

  // کنترلِ معکوس: reject/susno چیزی برای برگشت ندارند (کریدیت داده نشده)، پس باید
  // بیت‌به‌بیت رفتارِ قدیمی را حفظ کرده باشند — وگرنه یعنی این فیکس بیش از دامنه‌اش رفته.
  ok(rejectBody ? /editMessageReplyMarkup\(undefined\)/.test(rejectBody) : false,
    'کنترلِ معکوس: reject: هنوز کلِ کیبورد را حذف می‌کند (چیزی برای برگشت نیست)');
  ok(susnoBody ? /editMessageReplyMarkup\(undefined\)/.test(susnoBody) : false,
    'کنترلِ معکوس: susno: هم همین‌طور');

  // دکمه از همان تابعی ساخته می‌شود که رسیدهای auto-approve از v3.61.0 دارند
  // (notifyAdminAutoApproved) — یعنی منطقِ تازه‌ای موازی ساخته نشده.
  const autoBody = bodyOf('function notifyAdminAutoApproved(');
  const kbDef = bodyOf('const creditedReceiptKb', ']).reply_markup;');
  ok(autoBody && kbDef ? /creditedReceiptKb\(p\.id\)/.test(autoBody)
      && /Markup\.button\.callback\(L\.buttons\.smsNotArrived,\s*`cardsms:\$\{pid\}`\)/.test(kbDef) : false,
    'همان الگوی دکمه‌ای که رسیدِ auto-approve از قبل داشت، اینجا هم تکرار شده');
}

db.close();
console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
