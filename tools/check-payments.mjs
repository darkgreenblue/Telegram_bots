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
    status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'amount',
    adjust_note TEXT NOT NULL DEFAULT '',
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
  db.prepare(S.setPaymentDiscount).run(CODE_ID, payAmount, p);
  const row = db.prepare('SELECT amount, original_amount FROM payments WHERE id=?').get(p);
  ok(row.original_amount === price, 'original_amount = قیمتِ کاملِ فال');
  ok(row.amount === payAmount, 'amount = مبلغی که کاربر واقعاً می‌پردازد');
  const credited = row.original_amount || row.amount;   // همان چیزی که approvePayment می‌کند
  ok(credited === price, 'اعتبارِ لحظه‌ی تأیید دقیقاً کفافِ فال را می‌دهد (فال باز می‌شود)');
  setStatus('canceled', p);
}

console.log('\n▶ باگِ واقعی: فاکتورِ رهاشده نباید کدِ کاربر را قفل کند');
{
  const p = newPayment();
  claim(100_000, p);
  db.prepare(S.setPaymentDiscount).run(CODE_ID, 80_000, p);   // کد روی یک فاکتور نشست
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
  db.prepare(S.setPaymentDiscount).run(CODE_ID, 40_000, p);
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
    discount_code_id INTEGER, updated_at INTEGER NOT NULL DEFAULT 0);`);
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
  const gold = packs.find((p) => p.toman === 60000) || packs[packs.length - 1];
  ok(disc(gold.toman, 20, 50000) === Math.round(gold.toman * 0.8),
    `✅ با پایه‌ی قیمتِ بسته، ۲۰٪ ⇒ ${disc(gold.toman, 20, 50000)} تومان`);

  // و اینکه کد واقعاً همین را می‌کند (ساختاری، نه فقط ریاضی)
  const applyBody = (() => {
    const at = src.indexOf('async function applyDiscount(');
    return at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
  })();
  ok(/const pk = packOf\(p\)/.test(applyBody) && /pk\.toman/.test(applyBody),
    'applyDiscount پایه را از قیمتِ خودِ بسته می‌گیرد');
  ok(!/validateDiscount\(codeText, uid, p\.original_amount \|\| p\.amount/.test(applyBody),
    'و دیگر original_amount را به‌عنوان پایه نمی‌دهد');
  ok(/if \(p\.discount_code_id\)/.test(applyBody),
    'و یک فاکتور بیش از یک کد نمی‌گیرد (ضدِ انباشتِ تخفیف)');

  // دفترِ تخفیف هم تومانی ثبت شود
  const approveBody = (() => {
    const at = src.indexOf('function approvePayment(');
    return at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
  })();
  ok(/dbase - p\.amount/.test(approveBody),
    'مبلغِ ثبت‌شده در دفترِ تخفیف هم تومانی است، نه اختلافِ الماسی');
  d2.close();
}

db.close();
console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
