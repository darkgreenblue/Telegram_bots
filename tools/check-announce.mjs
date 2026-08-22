#!/usr/bin/env node
// 📣 چکِ پیامِ اطلاع‌رسانیِ آپدیت — قراردادِ سه نسخه و گاردهای ارسال.
//
// چرا این فایل هست: این پیام **یک بار** به همه‌ی کاربرانِ یک رباتِ زنده می‌رود و
// برگشت‌پذیر نیست. یک عددِ غلط یا یک خطِ اضافه برای دسته‌ی اشتباه، برای همیشه در چتِ
// کاربر می‌ماند. پس متن و تفکیکِ دسته‌ها قبل از ارسال اثبات می‌شود، نه بعدش.
//
// اجرا: node tools/check-announce.mjs
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';
import { BODY, CTA, KEYBOARD, MENU_KEYBOARD, MENU_NOTE, sendKeyboard, balanceLines, messageFor, planFor, groupOf, assertReady, ANNOUNCE_KEY } from './announce-tarot.mjs';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));
const SRC = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

console.log('▶ قواعدِ کپیِ سراسری');
{
  const all = [BODY, CTA, balanceLines(5, true), balanceLines(5, false)].join('\n');
  ok(!/—|--/.test(all), 'هیچ خط تیره‌ی بلندی در متن نیست (بند ۱۰ ریشه)');
  ok(!/هوشمند|هوش مصنوعی/.test(all), 'هیچ ادعای «هوشمند» یا هوش مصنوعی نیست (خواسته‌ی صریحِ مالک)');
  // مالک صریح گفت درصد و عدد و «یک‌سوم» را ننویسیم: «خودشان بروند ببینند».
  ok(!/درصد|٪|یک‌سوم|یک سوم/.test(all), 'هیچ درصد یا کسری از کاهشِ قیمت گفته نمی‌شود');
  ok(/قیمت هر فال خیلی خیلی کمتر شده/.test(BODY), 'و به‌جایش دقیقاً همان جمله‌ی خودِ مالک آمده');
  // فعلِ کارت شانس «خوردن» نیست (تصحیحِ صریحِ مالک).
  ok(!/نخورده|می‌خوره|بخوره/.test(all), 'فعلِ غلطِ «خوردن» برای کارت شانس به کار نرفته');
  ok(CTA === 'کارت شانس امروزت رو از دست نده 👇', 'متنِ CTA دقیقاً همان چیزی است که مالک نوشت');
  ok(!/فرصت کمی/.test(CTA), 'جمله‌ی «فرصت کمی براش مونده» حذف شده (تصمیمِ مالک)');
  ok(CTA.endsWith('👇'), 'و با انگشتِ رو-به-پایین تمام می‌شود تا چشم به سه دکمه برود');
}

console.log('\n▶ ساختارِ سه نسخه');
{
  const a = messageFor({ coins: 7, paid: true });
  const b = messageFor({ coins: 5, paid: false });
  const c = messageFor({ coins: 0, paid: false });

  ok(/بالاترین نرخ تبدیل/.test(a), 'نسخه‌ی A عبارتِ «بالاترین نرخ تبدیل» را دارد');
  ok(!/بالاترین نرخ تبدیل/.test(b), 'نسخه‌ی B آن را **ندارد** (خواسته‌ی صریحِ مالک)');
  ok(!/بالاترین نرخ تبدیل/.test(c), 'نسخه‌ی C هم ندارد');

  ok(/موجودی ذخایر الماس: ۷💎/.test(a), 'نسخه‌ی A عددِ الماس را با ایموجی می‌گوید');
  // ⚠️ ارقام باید **فارسی** باشند، چون کلِ ربات با toLocaleString('fa-IR') عدد می‌دهد.
  // نسخه‌ی اول عددِ خام می‌گذاشت و کاربر «7 الماس» در پیام و «۷💎» داخلِ ربات می‌دید.
  ok(!/[0-9]/.test(a) && !/[0-9]/.test(b), 'هیچ رقمِ لاتینی در متنِ رو-به-کاربر نیست');
  ok(/موجودی ذخایر الماس: ۵💎/.test(b), 'نسخه‌ی B هم عددِ الماس را با ایموجی می‌گوید');
  // ⚠️ مهم‌ترین ادعای این فایل: کسی که موجودی ندارد **هیچ** خطی درباره‌ی الماس نبیند.
  ok(!/موجودی/.test(c), 'نسخه‌ی C هیچ خطی درباره‌ی موجودی ندارد');
  ok(!/الماس تبدیل/.test(c), 'و هیچ حرفی از تبدیل شدن نمی‌زند');

  ok(a.includes(BODY) && b.includes(BODY) && c.includes(BODY), 'بدنه در هر سه نسخه یکی است');
  ok(a.endsWith(CTA) && b.endsWith(CTA) && c.endsWith(CTA), 'و CTA همیشه آخرین خط است');
  // ترتیب: بدنه، بعد موجودی، بعد CTA (خواسته‌ی مالک در بند ۶).
  ok(a.indexOf('موجودی ذخایر') > a.indexOf('واحد جدید') && a.indexOf('موجودی ذخایر') < a.indexOf(CTA),
    'خطِ موجودی بینِ بدنه و CTA می‌نشیند');
  // ⚠️ واحد **ایموجی** است نه کلمه (تصمیمِ صریحِ مالک): داخلِ ربات همه‌جا `۵💎` نوشته
  // می‌شود و این پیام باید عیناً همان شکل باشد. عددِ فارسی هم اجباری است.
  ok(b.split('\n').filter(Boolean).at(-2) === 'موجودی ذخایر الماس: ۵💎',
    'خطِ موجودی با ایموجیِ الماس می‌آید، نه کلمه، و بلافاصله بعد از خطِ تبدیل');
  ok(!/\d/.test(b), 'هیچ رقمِ لاتینی در متن نیست (همان قراردادِ fa-IR کلِ ربات)');
}

console.log('\n▶ دکمه‌ها');
{
  const rows = KEYBOARD.inline_keyboard;
  ok(rows.length === 3, 'دقیقاً سه دکمه (سه چیزی که در این آپدیت عوض شده)');
  ok(rows[0][0].callback_data === 'lucky_go', 'دکمه‌ی اول: کارت شانس');
  ok(rows[1][0].callback_data === 'reading_go', 'دکمه‌ی دوم: گرفتن فال جدید');
  ok(rows[2][0].callback_data === 'wallet_go', 'دکمه‌ی سوم: ذخایر الماس');
  ok(rows[0][0].text === '🎲 کارت شانس', 'نامِ دکمه‌ی اول همان «کارت شانس» است');
  // ⚠️ هر سه callback باید در خودِ ربات ثبت شده باشند، وگرنه دکمه‌ی پیامِ انبوه مرده است.
  for (const r of rows) {
    const cb = r[0].callback_data;
    ok(new RegExp(`bot\\.action\\('${cb}'`).test(SRC), `هندلرِ «${cb}» در ربات ثبت شده`);
  }
}

console.log('\n▶ ⌨️ کیبوردِ ماندگارِ پیامِ انبوه');
{
  // مالک با اکانتِ تازه تست کرد و منوی پایین نسل قبل مانده بود تا وقتی /start زد.
  // این پیامِ انبوه تنها فرصتِ به‌روز کردنِ منوی **همه** با هم است.
  const L = (await import('../bots/tarot/locales/fa.js')).default;
  const flat = MENU_KEYBOARD.keyboard.flat().map(b => b.text);
  const want = [
    L.buttons.reading, L.buttons.luckyMain, L.buttons.dailyOneCard,
    L.buttons.coinShop, L.buttons.inviteMain, L.support.button,
  ];
  ok(flat.join('|') === want.join('|'),
    `کیبوردِ پیامِ انبوه دقیقاً همان mainKeyboard دنیای الماس است\n     دیده شد: ${flat.join(' | ')}`);
  ok(MENU_KEYBOARD.keyboard[0][0].text === L.buttons.reading, 'ردیفِ اول: فال بگیر');
  ok(MENU_KEYBOARD.keyboard[1][0].text === L.buttons.luckyMain, 'ردیفِ دوم: کارت شانس');
  ok(MENU_KEYBOARD.keyboard[2][0].text === L.buttons.dailyOneCard, 'ردیفِ سوم: فال تک کارت');
  ok(MENU_KEYBOARD.resize_keyboard === true, 'resize_keyboard روشن است');
  ok(!/[0-9]/.test(MENU_NOTE) && MENU_NOTE.length < 40, 'پیامِ حاملِ کیبورد کوتاه است');
  const src = readFileSync(path.resolve('tools/announce-tarot.mjs'), 'utf8');
  ok(/await sendKeyboard\(token, p\.id\);/.test(src), 'کیبورد بعد از پیامِ اصلی فرستاده می‌شود');

  // 🫥 حاملِ کیبورد **دیده نمی‌شود** (تصمیمِ صریحِ مالک: «پیامی در این زمینه نیاز نیست»).
  //    سه شرط با هم این را می‌سازند و هر سه جدا ادعا می‌شوند، چون افتادنِ هرکدام یک
  //    نقصِ متفاوت است: بی‌صدا نبودن = پینگِ دوم، حذف‌نشدن = پیامِ ناخواسته، نبودِ
  //    try/catch = شکستنِ کلِ ارسالِ ۱۰۲ نفره به‌خاطرِ یک چتِ بسته.
  // ⚠️ این بلوک عمداً **رفتاری** است، نه رجکسی. نسخه‌ی اولش فقط وجودِ رشته‌ی
  //    `deleteMessage` را در سورس می‌دید و در تستِ جهش معلوم شد یک `return`ِ زودهنگام
  //    قبل از آن را **اصلاً نمی‌گیرد** — یعنی خطرناک‌ترین حالت (پیامِ ناخواسته برای
  //    ۱۰۲ نفر) بی‌محافظ بود. حالا خودِ تابع با یک fetchِ قلابی **اجرا** می‌شود.
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    calls.push({ url: String(url), body: JSON.parse(opt.body) });
    return { json: async () => ({ ok: true, result: { message_id: 4242 } }) };
  };
  try {
    await sendKeyboard('TOK', 777);
    const sendCall = calls.find(c => c.url.endsWith('/sendMessage'));
    const delCall = calls.find(c => c.url.endsWith('/deleteMessage'));
    ok(!!sendCall, 'حاملِ کیبورد واقعاً فرستاده می‌شود');
    ok(sendCall?.body.disable_notification === true, 'بی‌صدا می‌رود (کاربر پینگِ دوم نمی‌گیرد)');
    ok(!!sendCall?.body.reply_markup?.keyboard, 'و کیبوردِ ماندگار را حمل می‌کند');
    ok(!!delCall, 'و بلافاصله حذف می‌شود، پس کاربر هیچ پیامِ اضافه‌ای نمی‌بیند');
    ok(delCall?.body.message_id === 4242, 'حذف روی شناسه‌ی همان پیامِ تازه‌فرستاده انجام می‌شود');
    ok(delCall?.body.chat_id === 777, 'و در چتِ همان کاربر');
    ok(calls.indexOf(sendCall) < calls.indexOf(delCall), 'اول فرستاده می‌شود، بعد حذف');

    // شکستِ شبکه نباید کلِ ارسالِ ۱۰۲ نفره را بشکند.
    globalThis.fetch = async () => { throw new Error('network down'); };
    let threw = false;
    await sendKeyboard('TOK', 777).catch(() => { threw = true; });
    ok(!threw, 'شکستِ شبکه بالا نمی‌زند (کلِ ارسال را نمی‌شکند)');

    // پاسخِ بدونِ message_id (مثلاً چتِ بسته): نباید حذفِ بی‌هدف بزند.
    calls.length = 0;
    globalThis.fetch = async (url, opt) => {
      calls.push({ url: String(url), body: JSON.parse(opt.body) });
      return { json: async () => ({ ok: false, description: 'bot was blocked' }) };
    };
    await sendKeyboard('TOK', 777);
    ok(!calls.some(c => c.url.endsWith('/deleteMessage')), 'اگر پیام نرفت، حذفِ بی‌هدف هم نمی‌زند');
  } finally {
    globalThis.fetch = realFetch;
  }
  // ⚠️ دفتر باید مالِ پیامِ **اصلی** بماند: اگر حذف/ارسالِ کیبورد در مسیرِ ثبت بنشیند،
  //    یک چتِ بسته می‌تواند کاربر را از دفتر بیرون بگذارد و اجرای بعدی دوبار پیام بدهد.
  ok(/await sendKeyboard\(token, p\.id\);\s*\n\s*log\.run\(ANNOUNCE_KEY, p\.id\); sent\+\+;/.test(src),
    'ثبت در دفتر به موفقیتِ پیامِ اصلی گره خورده، نه به کیبورد');
}

console.log('\n▶ 🔑 کلیدِ دفتر به متن گره خورده');
{
  // ⚠️ چرا این ادعا هست: `announce_log` هرکسی را که کلیدِ فعلی را گرفته رد می‌کند. پس
  //    اگر متن عوض شود ولی کلید همان بماند، **نسخه‌ی تازه هرگز به کسی که نسخه‌ی قبلی
  //    را گرفته نمی‌رسد** و این بی‌صدا اتفاق می‌افتد (اجرا سبز تمام می‌شود، فقط
  //    گیرنده‌ها کمترند). دقیقاً همان چیزی که مالک خواست جلویش گرفته شود.
  //    راه‌حل: اثرانگشتِ متن کنارِ کلید پین می‌شود. عوض کردنِ متن بدونِ بامپِ کلید ⟶ قرمز.
  const { createHash } = await import('crypto');
  const fingerprint = createHash('sha256')
    .update([BODY, CTA, balanceLines(5, true), balanceLines(5, false)].join(' '))
    .digest('hex').slice(0, 12);
  const PINNED = { key: 'v3.26.0', fingerprint: 'ded495602f4c' };
  ok(ANNOUNCE_KEY === PINNED.key,
    `کلیدِ دفتر همان نسخه‌ی پین‌شده است (${ANNOUNCE_KEY})`);
  ok(fingerprint === PINNED.fingerprint,
    `متن عوض نشده بدونِ بامپِ کلید\n     اثرانگشتِ فعلی: ${fingerprint}\n     ` +
    `اگر متن را عمداً عوض کرده‌ای: هم ANNOUNCE_KEY را بامپ کن، هم PINNED را در همین فایل به‌روز کن`);
}

console.log('\n▶ تفکیکِ دسته‌ها از دیتای واقعی، نه از لیستِ دستی');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ann-'));
  const db = new Database(path.join(dir, 'bot-fa.db'));
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '', balance INTEGER DEFAULT 0);
           CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, amount INTEGER);
           CREATE TABLE announce_log (key TEXT, user_id INTEGER, sent_at INTEGER, PRIMARY KEY (key, user_id));`);
  const add = db.prepare('INSERT INTO users VALUES (?,?,?,?)');
  add.run(1, 'payer', 'p', 70_000);       // پرداخت‌کرده با موجودی → A
  add.run(2, 'gifted', 'g', 50_000);      // هدیه‌بگیر با موجودی   → B
  add.run(3, 'empty', 'e', 0);            // بدونِ موجودی          → C
  add.run(4, 'fake', 'f', 0);             // دوستِ تستیِ صفرشده     → C
  db.prepare("INSERT INTO payments VALUES (1,1,'approved',100000)").run();
  db.prepare("INSERT INTO payments VALUES (2,4,'reversed',130000)").run();  // رسیدِ جعلیِ برگشت‌خورده

  const plan = planFor(db);
  const by = Object.fromEntries(plan.map(p => [p.id, p]));
  ok(groupOf(by[1]) === 'A' && by[1].coins === 7, 'پرداخت‌کرده با ۷ الماس ⟶ نسخه‌ی A');
  ok(groupOf(by[2]) === 'B' && by[2].coins === 5, 'هدیه‌بگیر با ۵ الماس ⟶ نسخه‌ی B');
  ok(groupOf(by[3]) === 'C', 'کاربرِ بی‌موجودی ⟶ نسخه‌ی C');
  // ⚠️ سناریوی سجاد: پرداختش `reversed` شده، پس نه پرداخت‌کننده حساب می‌شود و نه
  // موجودی دارد. یعنی خودکار نسخه‌ی C می‌گیرد، بدونِ اینکه آی‌دی‌اش جایی نوشته شود.
  ok(groupOf(by[4]) === 'C', 'کاربرِ رسیدِ جعلی (پرداختِ reversed، موجودیِ صفر) ⟶ نسخه‌ی C');
  ok(!by[4].paid, 'و پرداختِ برگشت‌خورده او را پرداخت‌کننده نمی‌کند');
  ok(!/موجودی/.test(messageFor(by[4])), 'پس هیچ عددی از موجودی به او گفته نمی‌شود');
  ok(plan.length === 4, 'همه‌ی کاربران در برنامه‌اند (حتی بدونِ موجودی)');

  // idempotency: کسی که قبلاً پیام گرفته دوباره نمی‌گیرد
  db.prepare('INSERT INTO announce_log (key,user_id,sent_at) VALUES (?,?,0)').run(ANNOUNCE_KEY, 1);
  ok(planFor(db).length === 3, 'کاربری که قبلاً پیام گرفته دوباره در برنامه نیست');
  ok(!planFor(db).some(p => p.id === 1), 'و دقیقاً همان کاربر حذف شده');

  const only = planFor(db, { only: [2] });
  ok(only.length === 1 && only[0].id === 2, 'ANNOUNCE_ONLY فقط همان آی‌دی را می‌فرستد (تستِ زنده)');

  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n▶ گاردِ ترتیبِ اجرا');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ann2-'));
  // هنوز نه مهاجرت اجرا شده نه ربات باز شده
  const bad = assertReady(dir, 'const UX_V2_ADMIN_ONLY = true;');
  ok(bad.length === 2, 'اگر ربات باز نشده و مهاجرت اجرا نشده، هر دو ایراد گزارش می‌شود');
  ok(bad.some(p => /UX_V2_ADMIN_ONLY/.test(p)), 'بسته بودنِ دنیای الماس تشخیص داده می‌شود');
  ok(bad.some(p => /مهاجرت/.test(p)), 'اجرا نشدنِ مهاجرت تشخیص داده می‌شود');
  require('fs').writeFileSync(path.join(dir, '.coin-migration-done'), 'x');
  ok(assertReady(dir, 'const UX_V2_ADMIN_ONLY = false;').length === 0, 'با هر دو شرط، اجازه‌ی ارسال داده می‌شود');

  const mig = readFileSync(path.resolve('tools/announce-tarot.mjs'), 'utf8');
  ok(/if \(problems\.length && sendReal\)/.test(mig), 'و گارد فقط ارسالِ واقعی را متوقف می‌کند، نه dry-run را');
  ok(/--send/.test(mig) && /if \(!sendReal\)/.test(mig), 'dry-run پیش‌فرض است');
  ok(/INSERT OR IGNORE INTO announce_log/.test(mig), 'هر ارسالِ موفق ثبت می‌شود (ضدِ پیامِ تکراری)');
  ok(/error_code === 429/.test(mig), 'سقفِ نرخِ تلگرام (۴۲۹) رعایت می‌شود');
  rmSync(dir, { recursive: true, force: true });
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
