#!/usr/bin/env node
/* چکِ «گفتگوی پس از فال» (tarot v3.84.0).
 *
 * چرا این فایل جداست و چرا بیشترش **رفتاری** است نه رجکسی: این فیچر روی مسیرِ **پول**
 * می‌نشیند (هر سؤال یک الماس) و روی رباتِ 🟢 زنده. درسِ ثبت‌شده‌ی ریپو این است که
 * ادعای متنی فقط می‌گوید «کد نوشته شد»، نه «عدد رسید» (بند ۲و/۶ب ریشه). پس هر جا که
 * می‌شود، خودِ منطق از سورس بریده و روی SQLite واقعی یا با استابِ fetch **اجرا** می‌شود.
 *
 * اجرا: node tools/check-chat.mjs
 */
import fs from 'node:fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

const SRC = fs.readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const CORE = fs.readFileSync(new URL('../bots/tarot/chat-core.js', import.meta.url), 'utf8');
const FA = fs.readFileSync(new URL('../bots/tarot/locales/fa.js', import.meta.url), 'utf8');
const RC = fs.readFileSync(new URL('../bots/tarot/reading-core.js', import.meta.url), 'utf8');

/* ⚠️ کامنت‌ها **قبل از** هر ادعای متنی حذف می‌شوند. این تله در همین ریپو شش بار ثبت
 * شده (v3.56.0، v3.64.0، check-price-ladder، check-invoice-page، check-llm-usage…):
 * سندنویسیِ خودِ ما یک ادعای سالم را قرمزِ کاذب می‌کند. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODE = strip(SRC);
const CORE_CODE = strip(CORE);

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); } };

/* بدنه‌ی یک تابع/بلوک از سورس، با شمارشِ آکولاد (نه رجکسِ شکننده).
 * ⚠️ آکولادِ **پارامترِ destructure شده** آغازِ بدنه نیست: `openChat(ctx, id, { resumed })`
 * با یک `indexOf('{')`ِ ساده بدنه‌اش می‌شد `{ resumed = false }` و سه ادعا به دلیلِ
 * اشتباه قرمز می‌شدند (نقصِ خودِ هارنس، نه کدِ محصول). پس اولین آکولادی که در عمقِ
 * پرانتزِ صفر باشد آغازِ بدنه است. */
function bodyOf(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let par = 0, start = -1;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '(') par++;
    else if (c === ')') par--;
    else if (c === '{' && par === 0) { start = j; break; }
  }
  if (start < 0) return null;
  let d = 0, started = false;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return null;
}
const num = (name, s = CODE) => Number((s.match(new RegExp(`const ${name}\\s*=\\s*(-?\\d+)`)) || [])[1]);
const bool = (name, s = CODE) => (s.match(new RegExp(`const ${name}\\s*=\\s*(true|false)`)) || [])[1] === 'true';
/* ⚠️ `bodyOf` برای هدرِ `bot.action(...)` **بیش از اندازه** برمی‌دارد: اولین `{`ِ
 * عمقِ-صفر بعد از آن هدر، بلوکِ **بعدی** است نه بدنه‌ی خودش. یعنی هر ادعای «این
 * هندلر X را صدا نمی‌زند» می‌توانست با کدِ هندلرِ همسایه سبزِ دروغین بدهد (همان
 * تله‌ی دامنه در check-night-reminder). این یکی دقیقاً تا `\n});` می‌بُرد. */
const actBody = (header, s = CODE) => {
  const i = s.indexOf(header);
  if (i < 0) return null;
  const j = s.indexOf('\n});', i);
  return j < 0 ? null : s.slice(i, j + 4);
};
/* ⚠️ ادعای **ترتیب** باید وجودِ هر دو سر را هم بسنجد. `indexOf` برای چیزِ غایب `-1`
 * می‌دهد و `-1 < n` همیشه درست است، پس حذفِ کاملِ یک قدم از یک ادعای ترتیبیِ ساده
 * **زنده رد می‌شود** — دقیقاً همان جهشی که اولین دورِ تستِ جهش گرفت. */
const before = (body, a, b) => {
  const i = body.indexOf(a), j = body.indexOf(b);
  return i >= 0 && j >= 0 && i < j;
};
const countOf = (re, s = CODE) => (s.match(re) || []).length;

const chat = await import('../bots/tarot/chat-core.js');

console.log('🗣 گفتگوی پس از فال\n');

/* ═══ ۱) پرچم، دامنه و انتشارِ مرحله‌ای (بند ۲ج-۲ ریشه) ═════════════════ */
console.log('▶ ۱) پرچم و دامنه');
{
  ok(/const CHAT_AFTER_READING = (true|false);/.test(CODE), 'کلیدِ خاموشیِ کلِ فیچر جداست');
  ok(/const CHAT_AFTER_READING_ADMIN_ONLY = (true|false);/.test(CODE), 'و دامنه یک ثابتِ **دوم** است، نه همان بولین');
  /* ⚠️ ادعای مرکزیِ بند ۲ج-۲: پرچمِ **دامنه** هیچ‌جا خام صدا زده نمی‌شود. اگر مسیری
   * گاردِ ادمین را جا بیندازد، کاربرِ واقعیِ رباتِ زنده نسخه‌ی نیمه‌تمام می‌بیند. */
  ok(countOf(/CHAT_AFTER_READING_ADMIN_ONLY/g) === 2,
    `پرچمِ دامنه دقیقاً ۲ بار (تعریف + helper) استفاده شده، نه بیشتر (${countOf(/CHAT_AFTER_READING_ADMIN_ONLY/g)})`);
  /* کلیدِ خاموشی سه مصرفِ دیگر دارد و هر سه عمدی‌اند و **رو-به-کاربر نیستند**:
   * تعریف، helper، میدل‌ورِ خروج، و جاروی بوت. آن دو تای آخر نمی‌توانند از `chatOn`
   * بروند (یکی ctx ندارد و دیگری باید برای همه‌ی کاربران اجرا شود، نه فقط تسترها). */
  const rawKill = countOf(/CHAT_AFTER_READING(?!_)/g);
  ok(rawKill === 4, `کلیدِ خاموشی دقیقاً ۴ بار (تعریف، helper، میدل‌ورِ خروج، جاروی بوت) (${rawKill})`);
  ok(/getState\(uid\) !== 'chatting'\) return next\(\)/.test(CODE) && /if \(CHAT_AFTER_READING\) \{/.test(CODE),
    'و هر دو مصرفِ اضافه در مسیرِ **غیرِ رو-به-کاربر** اند (خروجِ استیت و ریفاندِ یتیم)');

  // رفتاری: خودِ helper با locale و تسترِ تزریقی اجرا می‌شود.
  const helper = (SRC.match(/const chatOn = \(uid\) =>[\s\S]*?;\n/) || [])[0] || '';
  ok(/CHAT_LOCALES\.includes\(LOCALE\)/.test(helper), 'helper هر سه شرط را با هم می‌خواند (فلگ، زبان، دامنه)');
  const mkChatOn = (kill, adminOnly, locale, testers) => new Function(
    'CHAT_AFTER_READING', 'CHAT_AFTER_READING_ADMIN_ONLY', 'CHAT_LOCALES', 'LOCALE', 'isTester',
    `${helper} return chatOn;`)(kill, adminOnly, ['fa'], locale, (u) => testers.includes(u));
  ok(mkChatOn(true, true, 'fa', [7])(7) === true, 'تستر/ادمینِ فارسی گفتگو را می‌بیند');
  ok(mkChatOn(true, true, 'fa', [7])(9) === false, '⚠️ کاربرِ عادی **نمی‌بیند** (انتشارِ مرحله‌ای)');
  ok(mkChatOn(true, false, 'fa', [7])(9) === true, 'و باز کردن برای همه دقیقاً یک خط است');
  ok(mkChatOn(true, true, 'ru', [7])(7) === false, '⚠️ زبانِ دیگر حتی برای ادمین هم خاموش است (گیتِ ساختاریِ v1)');
  ok(mkChatOn(false, false, 'fa', [7])(7) === false, 'و رول‌بکِ یک‌خطی همه را خاموش می‌کند');
  ok(/const CHAT_LOCALES = \['fa'\]/.test(CODE), 'دامنه‌ی زبانیِ v1 فقط فارسی است');
}

/* ═══ ۲) مهاجرتِ افزایشی (بند ۲ج/۱) ═══════════════════════════════════ */
console.log('\n▶ ۲) مهاجرت روی دیتابیسِ زنده');
{
  const ddl = (SRC.match(/CREATE TABLE IF NOT EXISTS chat_messages[\s\S]*?`\)/) || [])[0] || '';
  ok(ddl.includes('IF NOT EXISTS'), 'جدولِ گفتگو با IF NOT EXISTS ساخته می‌شود');
  /* ⚠️ هر سه ستونِ این فیچر از **خودِ سورس** برداشته و اجرا می‌شوند، نه با DDLِ
   * دست‌نویس. نسخه‌ی قبلیِ همین بلوک DDL را کپی کرده بود، یعنی اگر کسی یک مهاجرت را
   * از `index.js` برمی‌داشت این چک همچنان سبز می‌ماند و ستونِ گم‌شده تازه روی سرور
   * با `SqliteError: no such column` خودش را نشان می‌داد (همان تله‌ی گاردِ آینه‌ای). */
  const ALTERS = [...SRC.matchAll(/db\.prepare\('(ALTER TABLE (?:readings|chat_messages) ADD COLUMN (\w+)[^']*)'\)/g)]
    .map((m) => ({ sql: m[1], table: /TABLE readings/.test(m[1]) ? 'readings' : 'chat_messages', col: m[2] }));
  const NEEDED_COLS = [
    ['readings', 'anchor_msg_id', 'لنگرِ سرخط'],
    ['readings', 'tail_msg_id', 'لنگرِ دُم (v3.88.0)'],
    ['chat_messages', 'tg_msg_id', 'شناسه‌ی پیامِ کاربر (v3.88.0)'],
  ];
  for (const [table, col, label] of NEEDED_COLS) {
    const a = ALTERS.find((x) => x.table === table && x.col === col);
    ok(!!a && /NOT NULL DEFAULT 0/.test(a.sql),
      `مهاجرتِ «${label}» افزایشی است و DEFAULT دارد (ردیفِ قدیمی معتبر می‌ماند)`);
  }
  ok(!/DROP (TABLE|COLUMN)\s+(chat_messages|anchor_msg_id|tail_msg_id|tg_msg_id)/i.test(SRC),
    'هیچ DROP ای روی جدول و ستون‌های این فیچر نیست (بند ۲ج/۱)');

  // رفتاری: همان DDL و همان ALTERها روی یک دیتابیسِ **اسکیمای قدیمی** دو بار اجرا می‌شوند.
  const d = new Database(':memory:');
  d.exec('CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT)');
  d.prepare("INSERT INTO readings (user_id, status) VALUES (1, 'delivered')").run();
  // جدولِ گفتگو عمداً به **شکلِ v3.84.0** ساخته می‌شود (بدونِ `tg_msg_id`)، یعنی دقیقاً
  // همان چیزی که روی سرورِ زنده هست؛ وگرنه مهاجرتِ ستونِ تازه هرگز آزمایش نمی‌شد.
  d.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  d.prepare("INSERT INTO chat_messages (reading_id, user_id, role) VALUES (1, 1, 'user')").run();
  const run = () => {
    d.exec(ddl.replace(/`\)$/, ''));                      // همان CREATE TABLE IF NOT EXISTS سورس
    for (const a of ALTERS) { try { d.exec(a.sql); } catch { /* ستون از قبل هست */ } }
  };
  run(); run();
  for (const [table, col, label] of NEEDED_COLS) {
    ok(d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col),
      `ستونِ «${label}» روی اسکیمای قدیمی ساخته می‌شود`);
  }
  ok(d.prepare('SELECT anchor_msg_id a, tail_msg_id t FROM readings WHERE id=1').get().a === 0
    && d.prepare('SELECT tail_msg_id t FROM readings WHERE id=1').get().t === 0,
    'و فالِ قدیمی هر دو لنگرش مقدارِ امنِ صفر می‌گیرد (فالبک، نه کرش)');
  ok(d.prepare('SELECT tg_msg_id t FROM chat_messages WHERE id=1').get().t === 0,
    'و نوبتِ گفتگوی قدیمی هم شناسه‌ی صفر می‌گیرد');
  ok(d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='chat_messages'").get().c === 1, 'اجرای دوباره چیزی را نمی‌شکند (idempotent)');
}

/* ═══ ۳) پول: کسر قبل از LLM، تراکنش، ریفاندِ یک‌باره ══════════════════ */
console.log('\n▶ ۳) مسیرِ پول');
{
  const h = bodyOf(CODE, 'async function handleChatMessage(');
  const turn = bodyOf(CODE, 'async function runChatTurn(');
  ok(!!h && !!turn, 'هندلرِ نوبت و خودِ نوبت از سورس برداشته شدند');
  const iPay = h.indexOf('payForChat(');
  const iRun = h.indexOf('runChatTurn(');
  /* 🔑 حیاتی‌ترین ادعای این فیچر (بند ۹ ریشه): هیچ فراخوانیِ پولی قبل از کسرِ اعتبار.
   * از v3.88.0 خودِ نوبت در `runChatTurn` است (چون دو صداکننده دارد)، پس ادعا دو تکه
   * شد و **هر دو تکه لازم است**: هندلر قبل از فراخوانی کسر می‌کند، و خودِ نوبت
   * ساختاراً هیچ راهی برای کسر ندارد. با یکی از این دو، جابه‌جاییِ کسر به داخلِ نوبت
   * (یعنی بعد از فراخوانیِ مدل) بی‌صدا از چک رد می‌شد. */
  ok(iPay > 0 && iRun > 0 && iPay < iRun, '🔑 کسرِ اتمیک **قبل از** اجرای نوبت است');
  ok(/orChatResilient\(/.test(turn) && !/orChatResilient\(/.test(h),
    'و فراخوانیِ مدل فقط داخلِ نوبت است، نه در هندلر');
  ok(!/payForChat\(|stmts\.deduct/.test(turn),
    '🔑 و خودِ نوبت **هرگز کسر نمی‌کند** (ردیفِ از قبل پرداخت‌شده می‌گیرد)');
  ok(/const paid = payForChat\(uid, rid, text, askedId\);/.test(h), 'و کسر واقعاً همان تراکنشِ اتمیک است، نه یک مقدارِ ثابت');
  /* 🎁 قیمتِ همین نوبت از **خروجیِ همان تراکنش** می‌آید، نه از ثابتِ `CHAT_PRICE`.
   * وگرنه سؤالِ رایگانِ اول در پیامِ شکست «۱💎 برگشت» می‌گفت و در رویداد هم عددِ
   * دروغ ثبت می‌شد (هم‌خانواده‌ی بند ۲و/۶ج: عدد و واحد از دو منبعِ مختلف). */
  ok(/const \{ id: msgId, price \} = paid;/.test(h),
    '🔑 قیمتِ نوبت از خودِ تراکنش خوانده می‌شود، نه دوباره از ثابت');
  ok(!/refundChat\(msgId, uid, CHAT_PRICE\)/.test(h),
    '⚠️ و هیچ ریفاندی روی `CHAT_PRICE`ِ ثابت بسته نشده (سؤالِ رایگان پولی ندارد که برگردد)');
  ok(before(h, 'crisisIn(', 'payForChat(') && before(h, 'smallTalkIn(', 'payForChat('),
    'و گاردهای رایگان (بحران و تعارف) قبل از کسرند');
  ok(h.indexOf('chatInflight.has(') < iPay, 'گاردِ هم‌زمانی هم قبل از کسر است');
  ok(/if \(!paid\) \{/.test(h) && h.indexOf('chat_paywall') > iPay, 'کم‌موجودی بعد از تلاشِ کسر تشخیص داده می‌شود (نه با خواندنِ موجودی)');
  /* ⚠️ `getBalance` از v3.88.0 در این هندلر هست (خطِ موجودیِ پی‌وال)، ولی فقط **بعد**
   * از تلاشِ کسر. ادعا همان نیتِ قبلی را دارد با دقتِ بیشتر: موجودی هرگز به‌عنوان
   * **شرطِ تصمیم** خوانده نمی‌شود، چون «توانِ پرداخت» با «کسرِ واقعی» یکی نیست. */
  ok(h.indexOf('getBalance(') > iPay, '⚠️ موجودی فقط برای نمایش خوانده می‌شود، نه به‌جای کسر');
  ok(!/if \(getBalance\(/.test(h), '⚠️ و هیچ شرطی روی آن بسته نشده');

  // رفتاری: همان تراکنش‌ها روی SQLite واقعی.
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      tg_msg_id INTEGER NOT NULL DEFAULT 0);`);
  /* ⚠️ SQL از **خودِ سورس** خوانده می‌شود، نه اینکه این‌جا دوباره تایپ شود.
   * نسخه‌ی اولِ همین بلوک SQL را کپی کرده بود و در تستِ جهش **زنده ماند**: برداشتنِ
   * `AND refunded=0` از `index.js` هیچ چیزی را قرمز نکرد، چون چک آینه‌ی خودش را
   * می‌سنجید (همان تله‌ی ثبت‌شده‌ی check-lucky و check-announce). */
  const BT = String.fromCharCode(96);   // بک‌تیک، بدونِ درگیر کردنِ خودِ template literal
  // هر سه شکلِ نقلِ‌قولِ جاوااسکریپت پشتیبانی می‌شود؛ وگرنه افزودنِ یک statement با
  // نقلِ‌قولِ دوتایی چک را با یک خطای مبهم می‌ترکاند، نه با یک ادعای خوانا.
  const sqlOf = (name) => {
    const m = SRC.match(new RegExp(name + ":\\s*db\\.prepare\\((?:'([^']+)'|\"([^\"]+)\"|" + BT + '([\\s\\S]*?)' + BT + ')\\)'));
    return (m && (m[1] || m[2] || m[3])) || null;
  };
  const NEEDED = ['credit', 'deduct', 'insertChatMsg', 'markChatRefunded', 'chatAsked'];
  ok(NEEDED.every(n => sqlOf(n)), 'هر پنج statementِ مسیرِ پول از سورس برداشته شدند');
  const st = Object.fromEntries(NEEDED.map(n => [n, d.prepare(sqlOf(n))]));
  ok(/AND refunded\s*=\s*0/.test(sqlOf('markChatRefunded')), 'ادعای ریفاند در خودِ SQL اتمیک است');
  ok(/balance >= \?/.test(sqlOf('deduct')), 'و کسر هم گاردِ موجودی را در خودِ SQL دارد');
  const CHAT_PRICE = num('CHAT_PRICE');
  ok(CHAT_PRICE === 1, `قیمتِ هر سؤال ${CHAT_PRICE} الماس است`);
  // خودِ تراکنش‌ها از سورس بریده می‌شوند (کپیِ منطق = همان تله‌ی check-lucky).
  const paySrc = (SRC.match(/const payForChat = db\.transaction\([\s\S]*?\n\}\);/) || [])[0];
  const refSrc = (SRC.match(/const refundChat = db\.transaction\([\s\S]*?\n\}\);/) || [])[0];
  const priceSrc = (SRC.match(/const chatPriceFor = [\s\S]*?;\n/) || [])[0];
  ok(!!paySrc && !!refSrc && !!priceSrc, 'هر سه تکه‌ی مسیرِ پول از سورس برداشته شدند');
  /* 🎁 `CHAT_FREE_FIRST` **تزریقی** است تا هر دو حالت روی همان کدِ محصول اجرا شود:
   * روشن (رفتارِ امروز) و خاموش (مسیرِ رول‌بک). یک هارنسِ تک‌حالته یعنی نیمی از کدِ
   * زنده هرگز اجرا نمی‌شود. */
  const mk = (freeFirst) => new Function('db', 'stmts', 'CHAT_PRICE', 'CHAT_FREE_FIRST',
    `${priceSrc}\n${paySrc}\n${refSrc}\nreturn { payForChat, refundChat, chatPriceFor };`)(d, st, CHAT_PRICE, freeFirst);
  const { payForChat, refundChat, chatPriceFor } = mk(bool('CHAT_FREE_FIRST'));
  ok(bool('CHAT_FREE_FIRST') === true, '🎁 سؤالِ اولِ هر فال رایگان است (خواسته‌ی صریحِ مالک)');

  d.prepare('INSERT INTO users (telegram_id, balance) VALUES (5, 2)').run();
  const bal = () => d.prepare('SELECT balance b FROM users WHERE telegram_id=5').get().b;
  /* 🔑 سؤالِ اول: ردیف ثبت می‌شود، قیمتش صفر است، و **هیچ چیزی کم نمی‌شود**. */
  const p1 = payForChat(5, 10, 'سؤال اول', 4242);
  ok(p1?.id > 0 && p1?.price === 0 && bal() === 2,
    '🔑 سؤالِ اولِ فال رایگان است و از موجودی چیزی کم نمی‌کند');
  ok(d.prepare('SELECT price p FROM chat_messages WHERE id=?').get(p1?.id)?.p === 0,
    '⚠️ و قیمتِ صفر روی خودِ ردیف می‌نشیند (ردپای پول، بند ۹ ریشه)');
  ok(d.prepare('SELECT tg_msg_id t FROM chat_messages WHERE id=?').get(p1?.id)?.t === 4242,
    '📎 شناسه‌ی پیامِ کاربر روی همان ردیف می‌نشیند (ورودیِ ریپلایِ جواب و بازگشتِ بعد از شارژ)');
  const p2 = payForChat(5, 10, 'سؤال دوم');
  ok(p2?.price === CHAT_PRICE && bal() === 1, '🔑 و از سؤالِ دوم به بعد کسر می‌شود');
  const p3 = payForChat(5, 10, 'سؤال سوم');
  ok(p3?.price === CHAT_PRICE && bal() === 0, 'سؤالِ سوم هم کسر شد');
  const p4 = payForChat(5, 10, 'سؤال چهارم');
  ok(p4 === null, 'با موجودیِ صفر کسر انجام نمی‌شود');
  ok(d.prepare('SELECT COUNT(*) c FROM chat_messages').get().c === 3,
    '🔑 و **هیچ ردیفی** ثبت نمی‌شود (تراکنش: یا هر دو یا هیچ‌کدام)');
  ok(bal() === 0, 'و موجودی منفی نمی‌شود');
  /* 🔑 فالِ **دیگر** سهمیه‌ی رایگانِ خودش را دارد: شمارش per فال است نه per کاربر.
   * و این با موجودیِ صفر اجرا می‌شود، یعنی ثابت می‌کند کاربرِ بی‌پول هم به دیوار
   * نمی‌خورد (همان دلیلی که این فیچر برایش ساخته شد). */
  const q1 = payForChat(5, 11, 'سؤالِ اولِ فالِ دیگر');
  ok(q1?.price === 0 && bal() === 0, '🔑 هر فال سهمیه‌ی رایگانِ خودش را دارد، حتی با موجودیِ صفر');

  ok(!!p2 && refundChat(p2.id, 5, p2.price) === true && bal() === 1, 'ریفاند پول را برمی‌گرداند');
  ok(!!p2 && refundChat(p2.id, 5, p2.price) === false && bal() === 1,
    '🔑 ریفاندِ دوباره **بی‌اثر** است (ادعا قبل از واریز، ضدِ دوبار-برگشت)');
  ok(d.prepare('SELECT refunded r FROM chat_messages WHERE id=?').get(p2?.id)?.r === 1, 'و ردیف مهرِ refunded می‌خورد');
  ok(d.prepare('SELECT text t FROM chat_messages WHERE id=?').get(p2?.id)?.t === 'سؤال دوم', 'متنِ سؤال ذخیره می‌شود (پشتیبانی و آزمایشگاه)');
  /* ⚠️ سؤالِ رایگانی که جوابی نگرفت و ریفاند شد، **دوباره رایگان** می‌شود: کاربر
   * بابتِ خرابیِ ما سهمیه‌اش را از دست نمی‌دهد. این دقیقاً به شرطِ `refunded=0` در
   * `chatAsked` وابسته است، پس اگر آن شرط برداشته شود همین‌جا قرمز می‌شود. */
  if (q1) refundChat(q1.id, 5, q1.price);
  ok(chatPriceFor(11) === 0, '🔑 سؤالِ رایگانِ بی‌جواب سهمیه را نمی‌سوزاند');
  ok(chatPriceFor(10) === CHAT_PRICE, '⚠️ ولی فالی که سؤالِ سالم دارد دیگر رایگان نیست');
  /* کنترلِ مثبت (بند ۶ب-۲): با پرچمِ خاموش، **همان کد** از اولین سؤال کسر می‌کند.
   * بدونِ این، یک `chatPriceFor`ِ همیشه-صفر هم همه‌ی ادعاهای بالا را پاس می‌کرد. */
  const off = mk(false);
  ok(off.chatPriceFor(999) === CHAT_PRICE, '🔁 و با رول‌بکِ `CHAT_FREE_FIRST=false` سؤالِ اول هم پولی است');

  // شکستِ مدل → ریفاندِ فوری، و ترتیبش در کد
  ok(before(turn, 'if (!res?.out)', 'refundChat(msgId') && /if \(!res\?\.out\)/.test(turn),
    'شکستِ کاملِ مدل بلافاصله ریفاند می‌شود (پول در حالتِ نامعلوم نمی‌ماند)');
  ok(/catch \(e\) \{[\s\S]*?refundChat\(msgId/.test(turn), 'و هر استثنای دیگری هم ریفاند می‌گیرد، نه فقط شکستِ مدل');
  ok(before(turn, "insertChatMsg.run(rid, uid, 'assistant'", 'await send(reply)'),
    'ثبتِ جواب **قبل از** ارسال است (وگرنه هر خطای گذرای شبکه یک ریفاندِ کاذب می‌سازد)');
}

/* ═══ ۴) جاروی یتیم‌ها ════════════════════════════════════════════════ */
console.log('\n▶ ۴) جاروی سؤالِ بی‌جواب');
{
  const sql = (SRC.match(/orphanChatMsgs: db\.prepare\(`([\s\S]*?)`\)/) || [])[1];
  ok(!!sql && /NOT EXISTS/.test(sql), 'کاندید با NOT EXISTS تعریف می‌شود (جوابِ بعد از سؤال)');
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()));`);
  const ins = d.prepare('INSERT INTO chat_messages (reading_id, user_id, role, price, refunded, created_at) VALUES (?,?,?,?,?,?)');
  const now = Math.floor(Date.now() / 1000);
  const old = now - 9999;
  const A = Number(ins.run(1, 5, 'user', 1, 0, old).lastInsertRowid);            // یتیمِ واقعی
  const B = Number(ins.run(2, 5, 'user', 1, 0, old).lastInsertRowid);            // جواب گرفته
  ins.run(2, 5, 'assistant', 0, 0, old + 1);
  const C = Number(ins.run(3, 5, 'user', 1, 1, old).lastInsertRowid);            // قبلاً ریفاند شده
  const D = Number(ins.run(4, 5, 'user', 1, 0, now).lastInsertRowid);            // تازه، هنوز منتظر
  const rows = d.prepare(sql).all(num('CHAT_ORPHAN_SEC')).map(r => r.id);
  ok(rows.includes(A), 'سؤالِ کهنه‌ی بی‌جواب ریفاند می‌شود');
  ok(!rows.includes(B), '⚠️ سؤالی که جواب گرفته **هرگز** (وگرنه پولِ محصولِ تحویل‌شده برمی‌گردد)');
  ok(!rows.includes(C), 'و ردیفِ قبلاً ریفاندشده دوباره شمرده نمی‌شود');
  ok(!rows.includes(D), 'و کاربرِ همین‌حالا-منتظر مصون است (پنجره‌ی CHAT_ORPHAN_SEC)');
  const sweep = bodyOf(CODE, 'async function recoverOrphanChats(');
  ok(before(sweep, 'refundChat(', 'sendMessage('),
    '🔑 ترتیبِ مقدس: اول ریفاند در دفتر، بعد پیام (پیامِ نرسیده نباید پول را بسوزاند)');
  ok(/if \(!refundChat\([\s\S]*?\) continue;/.test(sweep), 'و پیام فقط وقتی می‌رود که ریفاند واقعاً انجام شده باشد');
}

/* ═══ ۵) استیت و ناوبری (بند ۹ب) ══════════════════════════════════════ */
console.log('\n▶ ۵) استیت');
{
  const quiet = (SRC.match(/const KB_QUIET_STATES = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
  const payStates = (SRC.match(/const PAY_STATES = \[([\s\S]*?)\]/) || [])[1] || '';
  ok(/'chatting'/.test(quiet), 'استیتِ گفتگو در KB_QUIET_STATES است (استیتِ ورودی، بند ۹ب)');
  /* ⚠️ استخراج‌کننده هم باید **کنترلِ مثبت** داشته باشد. نسخه‌ی اول دنبالِ
   * `const OPEN_FLOW_STATES = [` می‌گشت در حالی که سورس `new Set([` دارد، پس رشته‌ی
   * خالی می‌گرفت و ادعای «chatting این‌جا نیست» **بی‌معنا سبز** می‌شد — همان
   * «سبزیِ حاصل از نبودِ قرمز» بند ۶ب-۲ ریشه. */
  const openFlow = (SRC.match(/const OPEN_FLOW_STATES = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
  ok(/'await_question'/.test(openFlow), 'کنترلِ مثبت: OPEN_FLOW_STATES واقعاً خوانده شد');
  ok(!/'chatting'/.test(openFlow),
    '⚠️ و عمداً در OPEN_FLOW_STATES **نیست**: خروج رایگان است و یادآوریِ شبانه نباید خاموش شود');
  ok(/'await_question'/.test(quiet), 'کنترلِ مثبت: KB_QUIET_STATES هم واقعاً خوانده شد');
  ok(/'pay_amount'/.test(payStates), 'کنترلِ مثبت: PAY_STATES هم');
  ok(!/'chatting'/.test(payStates), 'و فلوی پرداخت نیست (هیچ فاکتوری باز نمی‌کند)');

  // شاخه‌ی رول‌بک: پرچمِ خاموش نباید کاربر را در استیتی بی‌هندلر گیر بیندازد.
  const txt = bodyOf(CODE, "bot.on('text', async (ctx) => {");
  const br = txt.slice(txt.indexOf("if (state === 'chatting')"), txt.indexOf("if (state === 'pay_amount')"));
  ok(/if \(!chatOn\(uid\)\) \{ leaveChat\(uid, 'flag_off'\); return sendContinuePrompt/.test(br),
    '🔑 با پرچمِ خاموش، کاربرِ وسطِ گفتگو آزاد می‌شود (رول‌بک کسی را قفل نمی‌کند)');
  ok(before(br, '!chatOn(uid)', 'handleChatMessage'),
    'و آن شاخه **قبل از** هندلر است (وگرنه رول‌بک بی‌اثر می‌ماند)');

  // میدل‌ورِ خروج: تک‌نقطه، نه ۱۵ گاردِ پراکنده (بند ۸ ریشه).
  const mw = bodyOf(CODE, 'bot.use(async (ctx, next) => {');
  ok(/leaveChat\(uid, txt \? 'menu' : 'action'\)/.test(mw), 'خروج از گفتگو یک میدل‌ورِ واحد دارد');
  ok(/!txt\.startsWith\('\/'\)/.test(mw), 'و دستور (`/start`, `/support`) هم خروج حساب می‌شود');
  ok(/CHAT_KEEP_CB\.test\(cb\)/.test(mw), 'ولی اکشن‌های خودِ گفتگو استیت را نگه می‌دارند');
  const keep = (SRC.match(/const CHAT_KEEP_CB = (\/.*\/);/) || [])[1];
  const KEEP = new Function(`return ${keep}`)();
  ok(KEEP.test('chat:42'), 'الگوی نگه‌دارنده اکشنِ ورود به گفتگو را می‌گیرد');
  ok(!KEEP.test('chat_skip'),
    '⚠️ ولی `chat_skip` را **نه**: معنی‌اش «گفتگو نمی‌خواهم» است، پس باید واقعاً خارج کند');
  ok(!KEEP.test('recharge') && !KEEP.test('nav:menu') && !KEEP.test('lucky_go'),
    '⚠️ و هیچ اکشنِ دیگری را (وگرنه کاربرِ رفته به منو در استیتِ ورودی می‌ماند و پیامِ بعدی‌اش یک الماس خرج می‌کند)');
}

/* ═══ ۶) پیامِ ورود: بدونِ دکمه، با باکسِ هزینه و خطِ موجودی ══════════ */
console.log('\n▶ ۶) پیامِ ورود');
{
  const oc = bodyOf(CODE, 'async function openChat(');
  const reply = oc.slice(oc.lastIndexOf('await ctx.reply('));
  ok(!/inlineKeyboard/.test(reply), '🔑 استیتِ ورودی **هیچ دکمه‌ی inline ندارد** (بند ۹ب: استثنای مقدس)');
  /* ⚠️ HTML و نه Markdown: `blockquote` تنها راهِ «باکس» در Bot API است و فقط با HTML
   * رندر می‌شود. اگر این برگردد به Markdown، کاربر تگِ خام می‌بیند. */
  ok(/parse_mode: 'HTML'/.test(reply), 'پیام HTML می‌رود (باکسِ نقل‌قول با Markdown رندر نمی‌شود)');
  ok(/chatPriceFor\(readingId\) === 0/.test(oc),
    '🔑 و «رایگان بودن» از **دیتا** خوانده می‌شود، نه از ثابت (ادعا از دیتا جلو نمی‌زند، بند ۲و/۶ج)');
  const L = await import('../bots/tarot/locales/fa.js');
  // همان چیزی که `curOf` در دنیای الماس می‌سازد (`value: 1`، چون از v3.27.0 عددِ
  // دیتابیس خودِ تعدادِ الماس است). ساختنش این‌جا یعنی متن دقیقاً همان‌طور رندر شود
  // که کاربر می‌بیند، نه با یک آبجکتِ ناقص که واحدش به تومان برگردد.
  const CUR = { on: true, value: 1, name: L.default.coinUnit.name, emoji: L.default.coinUnit.emoji };
  const introFree = L.default.chat.intro(1, CUR, 3, true);
  const introPaid = L.default.chat.intro(1, CUR, 3, false);
  for (const [intro, tag] of [[introFree, 'رایگان'], [introPaid, 'پولی']]) {
    ok(/⬇️/.test(intro) && /<b>.+<\/b>/.test(intro), `متنِ ورودِ ${tag} با ⬇️ و جمله‌ی بولد تمام می‌شود`);
    ok(/<blockquote>[\s\S]*<\/blockquote>/.test(intro), `🔑 توضیحِ هزینه‌ی ${tag} داخلِ باکسِ نقل‌قول است`);
    /* 🔑 خطِ موجودی باید **زیرِ** باکس باشد (خواسته‌ی صریحِ مالک)، پس جایش سنجیده
     * می‌شود نه صرفاً وجودش. */
    const iBox = intro.indexOf('</blockquote>');
    const iBal = intro.indexOf('موجودی');
    ok(iBox > 0 && iBal > iBox, `🔑 و خطِ موجودیِ ${tag} **زیرِ** باکس می‌نشیند، نه داخلش`);
    // ۳۰٬۰۰۰ تومان با نرخِ واحد = ۳💎. عددِ واقعی سنجیده می‌شود، نه صرفاً کلمه‌ی «موجودی»:
    // یک `purseLine`ِ خراب که عدد را جا بیندازد هم آن کلمه را دارد.
    ok(/۳💎/.test(intro), `و عددِ واقعیِ موجودی در متنِ ${tag} چاپ می‌شود`);
    ok(!/—|--/.test(intro), `و متنِ ${tag} خط تیره‌ی بلند ندارد (بند ۱۰ ریشه)`);
  }
  ok(/🎁/.test(introFree) && !/🎁/.test(introPaid),
    '🔑 وعده‌ی «سؤالِ اول مهمونِ منه» فقط وقتی می‌آید که واقعاً رایگان باشد');
  ok(!/<blockquote>/.test(L.default.chat.intro(1, { on: false }, 0, true)),
    '⚠️ و در دنیای تومانی هیچ تگِ خامی ساخته نمی‌شود (همان گاردِ `purseQuote`)');
  const intro = introFree;
  for (const k of ['offer', 'resumed', 'voiceOnly', 'smallTalk', 'busy', 'capped', 'unavailable', 'off', 'crisis', 'nudge']) {
    if (/—|--/.test(String(L.default.chat[k]))) ok(false, `متنِ chat.${k} خط تیره‌ی بلند دارد`);
  }
  ok(!Object.values(L.default.chat).some(v => typeof v === 'string' && /—|--/.test(v)),
    'هیچ‌کدام از متن‌های گفتگو خط تیره‌ی بلند ندارند');
}

/* ═══ ۷) گاردهای رایگان: بحران و تعارف ════════════════════════════════ */
console.log('\n▶ ۷) بحران و تعارف');
{
  ok(!!chat.crisisIn('می‌خوام خودکشی کنم'), 'الگوی بحران روی جمله‌ی صریح شلیک می‌کند');
  ok(!!chat.crisisIn('دیگه نمی‌خوام زنده باشم، کارتِ برج چی می‌گفت؟'), 'و در هر طولی از پیام (نه فقط پیامِ کوتاه)');
  // کنترلِ منفی: بدونِ آن، یک `crisisIn` همیشه-true هم سبز رد می‌شد.
  ok(!chat.crisisIn('کارتِ مرگ یعنی چی؟'), '⚠️ کنترلِ منفی: «کارتِ مرگ» بحران نیست (کارتِ تاروت است)');
  ok(!chat.crisisIn('این رابطه داره منو می‌کشه از بس سخته'), 'و استعاره‌ی روزمره هم نه');
  const hc = bodyOf(CODE, 'async function handleChatMessage(');
  ok(before(hc, 'crisisIn(text)', 'payForChat('), '🔑 گاردِ بحران قبل از کسر و بدونِ فراخوانیِ مدل است');
  ok(/track\(db, uid, 'chat_crisis', \{ reading_id: rid \}\)/.test(hc),
    '⚠️ و متنِ کاربر در رویداد ثبت **نمی‌شود** (حساس‌ترین چیزی که ممکن است بنویسد)');

  ok(chat.smallTalkIn('مرسی') === true, 'تعارفِ خالص رایگان است');
  ok(chat.smallTalkIn('سلام') === true, 'و سلام هم');
  // کنترلِ مثبت (بند ۶ب-۲ ریشه): بدونِ این، یک `smallTalkIn` همیشه-true همه‌ی ادعاها را پاس می‌کرد.
  ok(chat.smallTalkIn('مرسی، ولی کارتِ دوم رو نفهمیدم') === false,
    '🔑 کنترلِ مثبت: سؤالِ واقعی تعارف نیست و کسر می‌شود');
  ok(chat.smallTalkIn('یعنی باید برم؟') === false, 'و سؤالِ کوتاهِ واقعی هم نه');
  ok(chat.CHAT_SMALLTALK_MAX <= 20, `فیلترِ تعارف عمداً تنگ است (سقفِ ${chat.CHAT_SMALLTALK_MAX} کاراکتر)`);
}

/* ═══ ۸) بودجه و پیشوندِ کش ════════════════════════════════════════════ */
console.log('\n▶ ۸) بودجه و کشِ پرامپت');
{
  const B = chat.CHAT_BUDGET;
  const sum = B.sys + B.question + B.cards + B.reading + B.memory + B.prev + B.hist + B.ask;
  ok(sum <= B.total, `جمعِ اجزا (${sum}) زیرِ کرانِ اعلام‌شده (${B.total}) است`);
  // بدترین حالتِ واقعی: تاریخچه‌ی پر، کانتکستِ پر.
  const big = 'ن'.repeat(5000);
  const rows = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: big }));
  const packed = chat.packHistory(rows);
  const msgs = chat.toMessages(big.slice(0, B.sys + 5400), packed, big);
  ok(chat.messagesChars(msgs) <= B.total + B.sys,
    `بدترین حالتِ ورودی کران‌دار است (${chat.messagesChars(msgs)} کاراکتر)`);
  ok(packed.turns.length <= chat.CHAT_RECENT_TURNS * 2, `فقط ${chat.CHAT_RECENT_TURNS} نوبتِ آخر خام می‌ماند`);
  ok(packed.digest.length <= chat.CHAT_DIGEST_CHARS, 'و فشرده‌ی قدیمی‌ها سقف دارد');
  /* 🔑 و سقفِ `hist` واقعاً **اجرا** می‌شود، نه اینکه فقط اعلام شود. نسخه‌ی اول هر
   * نوبت را جدا می‌بُرید و جمعش از عددِ اعلام‌شده رد می‌شد؛ یعنی «کرانِ کل» یک ادعای
   * نادرست بود. کنترلِ مثبت پایین ثابت می‌کند این سقف واقعاً چیزی را می‌اندازد. */
  const histChars = packed.digest.length + packed.turns.reduce((s2, t) => s2 + t.content.length, 0);
  ok(histChars <= B.hist, `🔑 سقفِ تاریخچه واقعاً اعمال می‌شود (${histChars} ≤ ${B.hist})`);
  ok(packed.turns.length < chat.CHAT_RECENT_TURNS * 2,
    'کنترلِ مثبت: با نوبت‌های غول‌پیکر، قدیمی‌ترین‌ها واقعاً افتادند (سقف تزئینی نیست)');
  const small = chat.packHistory([{ role: 'user', text: 'کوتاه' }, { role: 'assistant', text: 'جواب' }]);
  ok(small.turns.length === 2, 'و گفتگوی کوچک دست‌نخورده می‌ماند (سقف فقط در بدترین حالت می‌بُرد)');

  /* 🔑 پیشوندِ ثابت باید در طولِ گفتگو **بیت‌به‌بیت** یکسان بماند، وگرنه کش نمی‌خورد و
   * اقتصادِ فیچر (۲۰٪ هزینه‌ی یک فال) به ۵۹٪ می‌پرد — یعنی شرطِ طراحی، نه بهینه‌سازی. */
  const sys = 'پیشوندِ ثابتِ همین فال';
  const short = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `پیامِ ${i}` }));
  const p0 = chat.packHistory([]);
  const pLong = chat.packHistory(short);
  ok(pLong.digest.length > 0, 'گفتگوی بلند واقعاً فشرده تولید می‌کند (پیش‌شرطِ ادعای بعدی)');
  const m1 = chat.toMessages(sys, p0, 'سؤال ۱');
  const m2 = chat.toMessages(sys, pLong, 'سؤال ۲');
  ok(m1[0].role === 'system' && m2[0].role === 'system', 'پیشوند در یک پیامِ system واحد است');
  /* 🔑 حتی وقتی فشرده‌ی تاریخچه ساخته شده، پیشوند نباید تکان بخورد. اگر فشرده داخلِ
   * همان پیامِ system برود، هر نوبت پیشوند را عوض می‌کند و **کش کاملاً از بین می‌رود**
   * — یعنی هزینه‌ی هر پیام سه برابر، بی‌آنکه چیزی خطا بدهد. */
  ok(m1[0].content === m2[0].content, '🔑 و با رشدِ تاریخچه بیت‌به‌بیت دست‌نخورده می‌ماند');
  ok(m2.some(x => x.content.includes(pLong.digest)) && !m2[0].content.includes(pLong.digest),
    '🔑 فشرده **بیرونِ** پیشوندِ کش می‌نشیند، نه داخلش');
  ok(m2.length > m1.length, 'نوبت‌ها فقط به دُمش اضافه می‌شوند (append-only)');
  ok(m2[m2.length - 1].role === 'user' && m2[m2.length - 1].content === 'سؤال ۲', 'و سؤالِ فعلی آخرین پیام است');

  // فشرده‌سازی **بدونِ مدل**: قطعی و رایگان.
  ok(!/orChat|fetch\(/.test(CORE_CODE), '⚠️ هسته‌ی گفتگو هیچ فراخوانیِ شبکه‌ای ندارد (فشرده‌سازی قطعی است)');
  const p1 = chat.packHistory(rows.slice(0, 20));
  const p2 = chat.packHistory(rows.slice(0, 20));
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'و خروجی‌اش قطعی است (مقایسه‌ی جفت‌شده‌ی آزمایشگاه سالم می‌ماند)');
}

/* ═══ ۹) بدنه‌ی مسیرِ فال دست‌نخورده ═══════════════════════════════════ */
console.log('\n▶ ۹) مسیرِ فال لمس نشده');
{
  ok(/messages: opts\.messages \|\| \[\{ role: 'system', content: system \}, \{ role: 'user', content: user \}\]/.test(RC),
    'افزودنِ opts.messages افزایشی است');
  // رفتاری: بدنه‌ی ریکوئستِ مسیرِ فال (بدونِ opts.messages) بیت‌به‌بیت همان قبلی است.
  const before = JSON.stringify({ role: 'system', content: 'S' }) + JSON.stringify({ role: 'user', content: 'U' });
  const built = (opts) => JSON.stringify((opts.messages || [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }])
    .map(m => JSON.stringify(m)).join(''));
  ok(built({}) === JSON.stringify(before), '🔑 مسیرِ فال بدونِ opts.messages دقیقاً همان دو پیامِ قبلی را می‌سازد');
  ok(built({ messages: [{ role: 'system', content: 'X' }] }) !== JSON.stringify(before), 'و گفتگو مسیرِ خودش را دارد');
  ok(/export const CHAT_MODEL = \(process\.env\.CHAT_MODEL/.test(RC), 'مدلِ گفتگو قابلِ override است');
  ok(/CHAT_MODEL \|\| ''\)\.trim\(\) \|\| READING_MODEL/.test(RC),
    'و پیش‌فرضش **همان مدلِ خوانش** است (لحن یکسان، خواسته‌ی صریحِ مالک)');
  ok(/const CHAT_PLAN\s+= \[CHAT_MODEL, CHAT_MODEL, FLASH, FALLBACK_MODEL\]/.test(RC),
    'زنجیره‌ی فالبک دارد (هیچ مسیرِ پولی بدونِ فالبک، بند ۹)');
}

/* ═══ ۱۰) دکمه‌ی کهنه: هشت حالت، هیچ‌کدام بن‌بست و هیچ‌کدام کسر ═══════ */
console.log('\n▶ ۱۰) دکمه‌ی کهنه (بند ۲ج/۶)');
{
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT,
    status TEXT, llm_json TEXT DEFAULT '', created_at INTEGER DEFAULT 0, anchor_msg_id INTEGER DEFAULT 0);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER, user_id INTEGER,
      role TEXT, text TEXT DEFAULT '', price INTEGER DEFAULT 0, refunded INTEGER DEFAULT 0,
      model TEXT DEFAULT '', created_at INTEGER DEFAULT 0);`);
  const now = Math.floor(Date.now() / 1000);
  const mk = (uid, status, llm, age = 0) => Number(d.prepare(
    'INSERT INTO readings (user_id, type, status, llm_json, created_at) VALUES (?,?,?,?,?)')
    .run(uid, 'love3', status, llm, now - age).lastInsertRowid);
  const st = {
    getReading: d.prepare('SELECT * FROM readings WHERE id=?'),
    chatTurns: d.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE reading_id=? AND role='assistant'"),
  };
  const elSrc = bodyOf(SRC, 'function chatEligible(uid, readingId) {');
  ok(!!elSrc, 'گاردِ واجد بودن از سورس برداشته شد');
  const mkEl = (windowDays, maxTurns) => new Function('stmts', 'CHAT_WINDOW_DAYS', 'CHAT_MAX_TURNS',
    `${elSrc}; return chatEligible;`)(st, windowDays, maxTurns);
  const el = mkEl(num('CHAT_WINDOW_DAYS'), num('CHAT_MAX_TURNS'));

  ok(el(5, 0).why === 'missing', 'شناسه‌ی صفر → «missing»، نه کرش');
  ok(el(5, 999).why === 'missing', 'فالِ ناموجود → missing');
  const foreign = mk(6, 'delivered', '{"headline":"x"}');
  ok(el(5, foreign).why === 'missing', '🔑 فالِ کاربرِ دیگر (مالکیتِ رکورد)');
  ok(el(5, mk(5, 'started', '{"a":1}')).why === 'notdelivered', 'فالِ نیمه‌تحویل → notdelivered');
  ok(el(5, mk(5, 'refunded', '{"a":1}')).why === 'notdelivered', 'فالِ ریفاندشده هم');
  ok(el(5, mk(5, 'delivered', '')).why === 'notdelivered', '⚠️ فالِ بدونِ llm_json (وگرنه JSON.parse کرش می‌کرد)');
  const good = mk(5, 'delivered', '{"headline":"جواب"}');
  ok(el(5, good).ok === true, 'فالِ سالم واجد است');
  // سقف
  const capped = mk(5, 'delivered', '{"a":1}');
  const insMsg = d.prepare("INSERT INTO chat_messages (reading_id, user_id, role) VALUES (?,?,'assistant')");
  for (let i = 0; i < num('CHAT_MAX_TURNS'); i++) insMsg.run(capped, 5);
  ok(el(5, capped).why === 'capped', 'فالِ به‌سقف‌رسیده → capped');
  ok(el(5, capped).r?.type === 'love3', 'و رکوردش برمی‌گردد تا پیشنهادِ فالِ تازه ساخته شود (بن‌بست نیست)');
  // پنجره‌ی زمانی: امروز خاموش است، ولی وقتی روشن شود باید کار کند.
  const elWin = mkEl(7, 0);
  ok(elWin(5, mk(5, 'delivered', '{"a":1}', 30 * 86400)).why === 'old', 'با پنجره‌ی روشن، فالِ خیلی قدیمی رد می‌شود');
  ok(el(5, mk(5, 'delivered', '{"a":1}', 300 * 86400)).ok === true,
    '⚠️ ولی امروز پنجره **صفر** است: هر فالِ تحویل‌شده، بدونِ محدودیتِ زمانی (تصمیمِ مالک)');
  ok(!/deduct|payForChat/.test(elSrc), '🔑 و هیچ‌کدام از این حالت‌ها کسری انجام نمی‌دهد');

  const oc = bodyOf(CODE, 'async function openChat(');
  ok(/L\.chat\.capped/.test(oc) && /L\.chat\.unavailable/.test(oc), 'هر دو حالتِ ناواجد پیامِ صریح دارند، نه سکوت');
  ok(/return sendContinuePrompt\(ctx, uid\)/.test(oc), 'و هیچ‌کدام بن‌بست نیست (قدمِ بعدی می‌آید)');
}

/* ═══ ۱۱) دو لنگرِ ریپلای (خواسته‌ی صریحِ مالک، بازنگری‌شده در v3.88.0) ═══
 *
 * تا v3.87.0 **همه‌چیز** به سرخطِ فال ریپلای می‌خورد. تستِ دستیِ مالک دو ایراد داد و
 * حالا دو لنگرِ متفاوت داریم:
 *   • پیامِ پیشنهاد / ورودِ گفتگو / فلگِ بستن ⟵ **دُمِ** فال (`tail_msg_id`)
 *   • جوابِ هر سؤال ⟵ **خودِ سؤالِ کاربر**
 * این بخش هر دو را می‌سنجد، و مهم‌تر: ادعای **معکوس** دارد که جواب‌ها دیگر به فال
 * لنگر نمی‌خورند — وگرنه «لنگر هست» سبز می‌ماند در حالی که لنگرِ غلط است. */
console.log('\n▶ ۱۱) دو لنگرِ ریپلای: دُمِ فال و سؤالِ کاربر');
{
  const anchorSrc = SRC.slice(SRC.indexOf('const replyToExtra = (mid)'),
    SRC.indexOf('Number(reading?.anchor_msg_id) || 0);') + 38);
  const { replyToExtra, chatTailExtra } = new Function(
    `${anchorSrc}; return { replyToExtra, chatTailExtra };`)();

  const to = replyToExtra(555);
  ok(to.reply_parameters?.message_id === 555, '🔑 ریپلای به شناسه‌ی داده‌شده می‌خورد');
  ok(to.reply_parameters?.allow_sending_without_reply === true,
    '⚠️ و اگر کاربر آن پیام را پاک کرده باشد ارسال **رد نمی‌شود** (وگرنه جوابِ پول‌داده گم می‌شد)');
  ok(Object.keys(replyToExtra(0)).length === 0, 'شناسه‌ی صفر ریپلای نمی‌سازد');
  ok(Object.keys(replyToExtra(undefined)).length === 0, 'و undefined هم کرش نمی‌کند');

  ok(chatTailExtra({ tail_msg_id: 42, anchor_msg_id: 7 }).reply_parameters?.message_id === 42,
    '🔑 پیامِ پیشنهاد/ورود به **دُمِ** فال می‌خورد، نه سرخط (خواسته‌ی مالک)');
  ok(chatTailExtra({ tail_msg_id: 0, anchor_msg_id: 7 }).reply_parameters?.message_id === 7,
    '⚠️ فالِ ثبت‌شده‌ی قبل از این نسخه به سرخط فالبک می‌کند (بدتر از v3.87.0 نمی‌شود)');
  ok(Object.keys(chatTailExtra({ tail_msg_id: 0, anchor_msg_id: 0 })).length === 0,
    'فالِ کاملاً بی‌لنگر بدونِ ریپلای کار می‌کند');
  ok(Object.keys(chatTailExtra(null)).length === 0, 'و رکوردِ نال هم کرش نمی‌کند');

  /* 🔑 رفتاری، نه متنی: جهشِ `if (false) { ... setAnchorMsg ... }` از یک ادعای رجکسی
   * **زنده رد شد** — یعنی «کد نوشته شده» با «عدد رسید» یکی گرفته شده بود (بند ۲و/۶ب).
   * حالا خودِ بلوکِ ارسال از سورس بریده و با ctxِ قلابی اجرا می‌شود. */
  const END = "logErr('tail:', e.message); } }";
  const blk = SRC.slice(SRC.indexOf('    let anchor = 0;'), SRC.indexOf(END) + END.length);
  ok(blk.includes('setAnchorMsg') && blk.includes('setTailMsg'),
    'بلوکِ ارسالِ متنِ نهایی از سورس برداشته شد (هر دو لنگر داخلش است)');
  /** بلوکِ واقعی را با ctx قلابی می‌دواند و می‌گوید چه شناسه‌هایی ثبت شدند. */
  const runBlock = (headline, body, closing) => {
    const saved = { anchor: [], tail: [] };
    const ctx = { reply: async () => ({ message_id: 909 }) };            // سرخط
    const replyLong = async (_c, t) => ({ message_id: t === closing ? 933 : 921 });
    const stmts2 = {
      setAnchorMsg: { run: (a, r) => saved.anchor.push([a, r]) },
      setTailMsg: { run: (a, r) => saved.tail.push([a, r]) },
    };
    const fn = new Function('ctx', 'stmts', 'headline', 'body', 'closing', 'readingId', 'sleep', 'PACE_M', 'replyLong', 'logErr',
      `return (async () => { ${blk} })();`);
    return fn(ctx, stmts2, headline, body, closing, 77, async () => {}, 0, replyLong, () => {}).then(() => saved);
  };
  const full = await runBlock('جوابت اینه', 'بدنه', 'جمع‌بندی');
  ok(full.anchor.some(([a, r]) => a === 909 && r === 77),
    '🔑 شناسه‌ی سرخط واقعاً روی همان رکورد **ثبت می‌شود** (نه فقط در کد نوشته شده)');
  ok(full.tail.some(([a, r]) => a === 933 && r === 77),
    '🔑 و شناسه‌ی دُم = **آخرین** پیامِ فال (جمع‌بندی)، نه سرخط و نه بدنه');
  const noClosing = await runBlock('جوابت اینه', 'بدنه', '');
  ok(noClosing.tail.some(([a]) => a === 921), 'بدونِ جمع‌بندی، دُم همان بدنه است');
  const only = await runBlock('جوابت اینه', '', '');
  ok(only.tail.some(([a]) => a === 909), 'و فالِ تک‌پیامی، دُم و سرخطش یکی است');
  ok((await runBlock('', '', '')).anchor.length === 0, 'فالِ بدونِ سرخط لنگرِ جعلی نمی‌سازد');

  const fin = bodyOf(CODE, 'async function finishReading(');
  ok(before(fin, 'anchor = m?.message_id', 'setAnchorMsg'), 'شناسه از همان ارسالِ سرخط گرفته می‌شود');
  ok(/try \{ stmts\.setAnchorMsg\.run/.test(fin) && /try \{ stmts\.setTailMsg\.run/.test(fin),
    'و شکستِ هیچ‌کدام فالِ پول‌داده را نمی‌شکند');

  /* ⏎ `replyLong` باید آخرین پیام را **برگرداند**، وگرنه دُم همیشه صفر می‌ماند و
   * بی‌صدا به سرخط فالبک می‌کند — یعنی دقیقاً همان چیزی که قرار بود عوض شود. */
  const rl = bodyOf(CODE, 'async function replyLong(');
  ok(/return last;/.test(rl), 'replyLong آخرین پیامِ ارسال‌شده را برمی‌گرداند');

  const hc = bodyOf(CODE, 'async function handleChatMessage(');
  ok(/const askedId = ctx\.message\?\.message_id \|\| 0;/.test(hc),
    'گفتگو شناسه‌ی پیامِ خودِ کاربر را برمی‌دارد');
  ok(/const extra = replyToExtra\(askedId\)/.test(hc),
    '🔑 جوابِ هر سؤال به **همان سؤال** ریپلای می‌خورد');
  // ⚠️ ادعای معکوس: بدونِ این، «لنگر هست» سبز می‌ماند در حالی که لنگر غلط است.
  ok(!/chatTailExtra/.test(hc),
    '⚠️ و دیگر به فال لنگر نمی‌خورد (وگرنه خطِ «کدام جواب مالِ کدام سؤال» گم می‌شود)');
  /* جواب از `send` می‌رود که هندلر با همان `extra` می‌سازد — یعنی ریپلای به سؤالِ
   * کاربر، در هر دو مسیر (پیامِ زنده و بازگشتِ بعد از شارژ). */
  ok(/send: \(t, kb\) => ctx\.reply\(t, kb \? \{ \.\.\.extra/.test(hc),
    'جوابِ گفتگو با همان extra می‌رود');
  // شناسه‌ی سؤال روی ردیف می‌نشیند، وگرنه بازگشتِ خودکارِ بعد از شارژ نمی‌داند به چه
  // چیزی ریپلای کند (آن لحظه ctx آن پیام را ندارد).
  ok(/payForChat\(uid, rid, text, askedId\)/.test(hc),
    '📎 شناسه‌ی سؤال روی خودِ ردیفِ chat_messages ثبت می‌شود، نه در حافظه');
}

/* ═══ ۱۲) پیامِ پیشنهاد و ترتیبِ دکمه‌ها ══════════════════════════════ */
console.log('\n▶ ۱۲) پیشنهادِ پس از فال');
{
  const po = bodyOf(CODE, 'async function postReadingOffer(');
  /* 🔘 از v3.88.0 **دو** دکمه، نه سه (تصمیمِ صریحِ مالک): «پیشنهادهای من» حذف شد.
   * ترتیب همچنان قرارداد است (بند ۱۰): اوجِ لحظه اول، فالِ تازه دوم. */
  const order = [...po.matchAll(/L\.buttons\.(chatStart|chatAnotherReading|chatSkip)/g)].map(m => m[1]);
  ok(JSON.stringify(order) === JSON.stringify(['chatStart', 'chatAnotherReading']),
    '🔑 دقیقاً دو دکمه، به ترتیبِ گفتگو و بعد فالِ تازه (بند ۱۰: ترتیب در خدمتِ حس)');
  ok(!/L\.buttons\.chatSkip/.test(po), '⚠️ و «پیشنهادهای من» دیگر ساخته نمی‌شود');
  ok(/if \(!chatOn\(uid\) \|\| !el\.ok\) return sendContinuePrompt/.test(po),
    '⚠️ و اگر گفتگو باز نباشد، رفتار بیت‌به‌بیت همان قبلی است');
  ok(/chatTailExtra\(el\.r\)/.test(po), '📎 پیامِ پیشنهاد به **پایانِ فال** ریپلای می‌خورد');
  ok(/track\(db, uid, 'chat_offer_shown'/.test(po), 'مخرجِ نرخِ پذیرش ثبت می‌شود (بدونِ آن هیچ عددی معنی ندارد)');
  const skip = actBody("bot.action('chat_skip', async (ctx) => {");
  ok(/return sendContinuePrompt\(ctx, ctx\.from\.id\)/.test(skip),
    '⚠️ هندلرِ «پیشنهادهای من» ثبت می‌ماند (دکمه‌اش در چتِ کاربرانِ فعلی زنده است، بند ۲ج/۶)');

  /* 🔁 جمع‌شدنِ پیام بعد از تپ — رفتاری، نه رجکسی: خودِ تابع اجرا می‌شود و متن و
   * تعدادِ دکمه‌ی نهایی سنجیده می‌شود. */
  const colSrc = bodyOf(CODE, 'async function collapseChatOffer(');
  ok(!!colSrc, 'تابعِ جمع‌کردنِ پیشنهاد از سورس برداشته شد');
  {
    const seen = [];
    /* ⚠️ `bodyOf` **کلِ اعلانِ تابع** را برمی‌گرداند (از سرِ `async function`)، نه فقط
     * بدنه را. پس باید صدایش هم بزنیم؛ وگرنه فقط تعریف می‌شود و هیچ ادعایی واقعاً
     * اجرا نمی‌شود — یعنی چکی که هر جهشی را سبز رد می‌کند. */
    const fn = new Function('ctx', 'readingId', 'L', 'Markup',
      `return (async () => { ${colSrc}\nreturn collapseChatOffer(ctx, readingId); })();`);
    const Mk = { inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
      button: { callback: (t, d) => ({ text: t, callback_data: d }) } };
    const Lst = { chat: { offerDone: 'هر وقت بخوای…' }, buttons: { chatStart: '💬 گفتگو' } };
    await fn({ editMessageText: async (t, kb) => seen.push([t, kb]) }, 77, Lst, Mk);
    ok(seen.length === 1 && seen[0][0] === 'هر وقت بخوای…', 'متن به یادآوریِ «هر وقت خواستی» ادیت می‌شود');
    const rows = seen[0][1].reply_markup.inline_keyboard;
    ok(rows.length === 1 && rows[0].length === 1, '🔑 دو دکمه به **یک** دکمه جمع می‌شوند');
    ok(rows[0][0].callback_data === 'chat:77',
      'و آن یک دکمه همان درِ ورودِ همیشگی به گفتگوی همین فال است');
    // ⚠️ بدونِ پسوندِ `:o`، وگرنه تپِ بعدی دوباره همان پیام را ادیت می‌کند و تلگرام
    // «message is not modified» می‌دهد — بی‌ضرر، ولی یک فراخوانیِ بی‌دلیل در هر تپ.
    ok(!/chat:\$\{readingId\}:o/.test(colSrc), 'دکمه‌ی جمع‌شده پسوندِ پیشنهاد را حمل نمی‌کند');
  }
  {
    // شکستِ ادیت نباید هیچ چیزی را بشکند: بدترین حالت، پیامِ پیشنهاد با دو دکمه می‌ماند.
    const fn = new Function('ctx', 'readingId', 'L', 'Markup',
      `return (async () => { ${colSrc}\nreturn collapseChatOffer(ctx, readingId); })();`);
    const Mk = { inlineKeyboard: () => ({}), button: { callback: () => ({}) } };
    let threw = false;
    await fn({ editMessageText: async () => { throw new Error('too old'); } }, 1,
      { chat: {}, buttons: {} }, Mk).catch(() => { threw = true; });
    ok(!threw, '⚠️ و شکستِ ادیت (پیامِ کهنه) هیچ چیزی را نمی‌شکند');
  }

  /* ⚠️ و اجرای تابع در خلأ هیچ چیزی ثابت نمی‌کند: باید **هر دو دکمه** واقعاً صدایش
   * بزنند. جهشِ «فراخوانی از هندلرِ `chat:` برداشته شود» اولین بار زنده ماند، چون چک
   * فقط خودِ تابع را می‌سنجید و نه سیمِ اتصالش (هم‌خانواده‌ی بند ۲و/۶ب ریشه: «مقدار
   * وجود دارد» با «مقدار می‌رسد» یکی نیست). */
  const chatAct = actBody('bot.action(/^chat:(\\d+)(?::(o))?$/, async (ctx) => {');
  ok(/if \(ctx\.match\[2\] === 'o'\) await collapseChatOffer\(ctx, rid\);/.test(chatAct),
    '🔑 تپِ دکمه‌ی گفتگو همان پیامِ پیشنهاد را جمع می‌کند');
  ok(before(chatAct, 'collapseChatOffer', 'openChat'),
    '⚠️ و جمع‌شدن قبل از بازکردنِ گفتگو می‌آید (وگرنه پیامِ ورود بالای پیامِ کهنه می‌نشیند)');
  const newAct = actBody('bot.action(/^chat_new:(\\d+)$/, async (ctx) => {');
  ok(/await collapseChatOffer\(ctx, parseInt\(ctx\.match\[1\], 10\)\)/.test(newAct),
    '🔑 و تپِ «یه فالِ دیگه» هم همان پیام را جمع می‌کند (هر دو دکمه، نه یکی)');

  /* 🗣 جانشینیِ نظرسنجی (تصمیمِ صریحِ مالک): کوهورتِ گفتگو نظرسنجی نمی‌بیند و پیشنهاد
   * **در همان جایگاه** می‌آید. ادعای معکوس هم لازم است، وگرنه «پیشنهاد می‌آید» سبز
   * می‌ماند در حالی که نظرسنجی هم کنارش مانده و کاربر دو دعوتِ رقیب می‌گیرد. */
  const fin = bodyOf(CODE, 'async function finishReading(');
  const iChat = fin.indexOf('if (chatOn(uid) && chatEligible(uid, readingId).ok)');
  const iRate = fin.indexOf('L.reading.rateAsk');
  ok(iChat > 0 && iRate > iChat, '🔑 پیشنهادِ گفتگو **جای** نظرسنجی می‌نشیند، نه بعدش');
  ok(/postReadingOffer\(ctx, uid, readingId\);\s*\n\s*}\s*\n\s*await ensureKeyboard\(ctx\.telegram, uid\);/.test(fin),
    '⌨️ و چون نقطه‌ی صدورِ کیبوردِ `fbr:` از دست می‌رود، حاملِ بی‌صدا جایش را می‌گیرد (بند ۹ب-۳)');
  ok(/L\.reading\.rateAsk/.test(fin), '⚠️ و کدِ نظرسنجی پاک نشده (کوهورتِ بدونِ گفتگو همان را می‌بیند)');
  const fbr = bodyOf(CODE, "bot.action(/^fbr:([1-5]):(\\d+)$/, async (ctx) => {");
  ok(before(fbr, 'L.reading.rateThanks', 'postReadingOffer'),
    'تشکر همیشه اول می‌آید، بعد قدمِ بعدی (قراردادِ v3.14.0 نشکسته)');
  ok(/!\(isFirstReading && luckyAvailable\)/.test(fbr),
    '⚠️ و شاخه‌ی کارتِ شانسِ **اولین فال** مقدم می‌ماند (آخرین قدمِ آنبوردینگ)');
}

/* ═══ ۱۳) پرامپت ════════════════════════════════════════════════════ */
console.log('\n▶ ۱۳) پرامپتِ گفتگو');
{
  const p = (FA.match(/chatSystem: `([\s\S]*?)`,\n/) || [])[1] || '';
  ok(p.length > 500, 'پرامپتِ گفتگو در locale است، نه در index.js');
  ok(p.length <= chat.CHAT_BUDGET.sys, `و زیرِ سقفِ ${chat.CHAT_BUDGET.sys} کاراکتر است (${p.length})`);
  ok(!/—|--/.test(p), 'بدونِ خط تیره‌ی بلند (مدل از سبکِ پرامپت تقلید می‌کند، بند ۱۰ ریشه)');
  /* ⚠️ هیچ **جمله‌ی نمونه‌ی قابلِ کپی** نباشد: نشتِ few-shot دو بار در همین پروژه
   * خروجی را یکنواخت کرد (تکرارِ بین‌فالی). قاعده‌ها بله، جمله‌ی آماده نه. */
  ok(!/«[^»]{40,}»/.test(p), '🔑 هیچ جمله‌ی نمونه‌ی بلندِ قابلِ کپی در پرامپت نیست');
  ok(/بله‌ی گران|اما|ولی/.test(p), 'قاعده‌ی «بله‌ی گران» در پرامپت هست');
  ok(/لنگر/.test(p), 'قانونِ لنگر هم');
  /* ⚠️ این سه ادعا **وجودِ قاعده** را می‌سنجند، نه نبودِ کلمه. نسخه‌ی اولشان نبودِ
   * کلمه را می‌خواست و هر سه قرمزِ کاذب دادند، چون پرامپت دقیقاً همان کلمه‌ها را
   * به‌عنوان **ممنوعیتِ صریح** می‌برد — و درسِ دورِ یازدهمِ آزمایشگاه این است که
   * نام‌بردنِ عبارتِ ممنوع در پرامپت تلقینش نمی‌کند (آن فرضیه تست و رد شد). */
  ok(/هرگز ننویس «نشونه‌ات اینه»/.test(p), 'برچسبِ ممنوعِ «نشونه‌ات اینه» صریح ممنوع شده (STYLE.md قاعده ۴)');
  ok(/همیشه «تو»، هرگز «شما»/.test(p), 'خطاب همیشه «تو» است، نه «شما»');
  ok(/متخصص|پزشک|وکیل|مالی/.test(p), 'مرزهای پزشکی/حقوقی/مالی در پرامپت هست');
  ok(/حداکثر یک علامتِ سؤال/.test(p), 'قاعده‌ی حداکثر یک سؤال در هر پاسخ هست');
  ok(/خروجی فقط متنِ ساده\. بدونِ JSON/.test(p), 'خروجی متنِ ساده است، نه JSON (سرعت)');
  ok(/جمع نکن و خداحافظی نکن/.test(p), 'و هرگز جمع‌بندی/خداحافظی نمی‌کند (Model Spec: never wrap up)');
}

/* ═══ ۱۴) سنجه‌ی قلاب و پاکسازیِ خروجی ═══════════════════════════════ */
console.log('\n▶ ۱۴) قلاب و پاکسازی');
{
  const anchors = { cardNames: ['برج', 'ستاره'], questionWords: ['رابطه', 'تصمیم'] };
  ok(chat.hookOk('جوابت اینه.\nولی یه چیزی توی کارتِ برج هست که هنوز بازش نکردیم و به رابطه‌ت برمی‌گرده.', anchors).ok,
    'خطِ آخرِ لنگرخورده قبول می‌شود');
  ok(chat.hookOk('جوابت اینه.\nسؤال دیگه‌ای داری؟', anchors).why === 'chatbait',
    '🔑 قلابِ توخالی (chatbait) رد می‌شود');
  ok(chat.hookOk('خیلی سؤال خوبیه! جوابت اینه.\nسؤال خوبیه.', anchors).why === 'chatbait',
    'و چاپلوسی هم (تحسینِ خودِ سؤال، حالتِ شکستِ مستندِ sycophancy)');
  ok(chat.hookOk('جوابت اینه.\nهمین.', anchors).why === 'short', 'خطِ آخرِ خیلی کوتاه رد می‌شود');
  ok(chat.hookOk('جوابت اینه.\nیه وقتایی آدم باید فقط صبر کنه تا همه چیز خودش روشن بشه.', anchors).why === 'noanchor',
    '🔑 و جمله‌ای که بشود عیناً زیرِ فالِ کاربرِ دیگری گذاشت، لنگر ندارد (تستِ ضدِ Barnum)');
  ok(chat.hookOk('', anchors).why === 'empty', 'خروجیِ خالی هم حالتِ خودش را دارد');

  ok(!/—/.test(chat.cleanChatReply('جواب — با خط تیره')), 'خط تیره‌ی بلند از خروجیِ مدل پاک می‌شود');
  ok(chat.cleanChatReply('تاروت‌خوان: جوابت اینه') === 'جوابت اینه', 'برچسبِ خودسرانه‌ی ابتدای جواب حذف می‌شود');
  ok(!/سارا/.test(chat.cleanChatReply('سارا، جوابت اینه', { name: 'سارا' })), 'نامِ نشتی‌شده حذف می‌شود');
  ok(chat.cleanChatReply('ساراب یه شهره', { name: 'سارا' }).includes('ساراب'),
    '⚠️ ولی فقط با مرزِ واژه (یک کلمه‌ی مشابه قربانی نمی‌شود)');
  ok(chat.cleanChatReply('ن'.repeat(2000)).length <= chat.CHAT_HARD_CHARS, 'و خروجی سقفِ سخت دارد');
  ok(chat.chatShapeOk('ن'.repeat(100)) === true, 'validate خروجیِ عادی را می‌پذیرد');
  ok(chat.chatShapeOk('باشه') === false, 'جوابِ تک‌کلمه‌ای رد می‌شود (خرابیِ مدل)');
  ok(chat.chatShapeOk('ن'.repeat(2000)) === false, 'و خروجیِ بیش از حد بلند هم');
}

/* ═══ ۱۵) حسابداری، رویدادها و نسخه ══════════════════════════════════ */
console.log('\n▶ ۱۵) حسابداری و رویدادها');
{
  const hc = bodyOf(CODE, 'async function runChatTurn(');
  ok(/kind: 'chat', refId: rid, userId: uid/.test(hc),
    "هزینه با kind='chat' و شناسه‌ی فال در llm_usage ثبت می‌شود");
  ok(/validate: chatShapeOk/.test(hc), 'و خروجی validate می‌شود (هیچ فراخوانی بدونِ validate)');
  ok(/maxTokens: CHAT_MAX_TOKENS/.test(hc), 'سقفِ توکنِ خروجی صریح است');
  for (const ev of ['chat_offer_shown', 'chat_opened', 'chat_message', 'chat_paywall',
    'chat_llm_failed', 'chat_refund', 'chat_crisis', 'chat_exited']) {
    ok(new RegExp(`'${ev}'`).test(CODE), `رویدادِ ${ev} ثبت می‌شود`);
  }
  ok(!/EVENTS\.(PAYWALL_SHOWN|REFUND)[\s\S]{0,80}chat/i.test(hc),
    '⚠️ رویدادهای هسته آلوده نمی‌شوند (رویدادِ اختصاصی، بند ۲ج/۳)');
  const ver = (SRC.match(/PRODUCT_VERSION = '([\d.]+)'/) || [])[1] || '0';
  const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - Number(b.split('.')[i] || 0), 0);
  // v3.88.0 = دورِ بازخوردِ تستِ دستیِ مالک (ده موردِ UX و استیت). بامپ اجباری است
  // حتی برای فیچرِ فقط-ادمین (بند ۲ج/۴ ریشه).
  ok(cmp(ver, '3.88.0') >= 0, `PRODUCT_VERSION بامپ شده (${ver}) — تغییرِ رفتاری، حتی فقط-ادمین`);
  const wipe = strip(SRC.slice(SRC.indexOf('function wipeUser('), SRC.indexOf('function wipeUser(') + 1800));
  ok(/chat_messages/.test(wipe), 'wipeUser جدولِ گفتگو را پاک می‌کند (ریستِ ادمین کامل است)');
  ok(/INTENT\.CHAT\]:\s*\(ctx, arg\) => openChat\(ctx, arg\)/.test(CODE),
    'نیتِ گفتگو با **شناسه‌ی فال** بازپخش می‌شود، نه روی فالِ صفر');
}

/* ═══ ۱۶) سنجه‌های لحن و اکوی برچسب (درسِ دورِ ۱ آزمایشگاه) ══════════
 *
 * 🐛 چرا این بخش هست: دورِ ۱ با **همه‌ی** آستانه‌های فاز ۱ سبز تمام شد، در حالی که
 * خواندنِ چشمیِ همان ۱۵ نوبت دو نقصِ سیستماتیک نشان داد — ۷ جواب به فارسیِ کتابی
 * می‌لغزیدند و ۱۱ خطِ آخر با همان کلمه‌ای ساخته شده بودند که تیترِ بلوکِ پرامپت است.
 * هیچ‌کدام باگِ مدل نبودند که از گارد فرار کند؛ گارد **ساختاراً** نمی‌دیدشان:
 * `bookish` در `lang/fa.mjs` وجود داشت و `chatMetrics` هرگز صدایش نمی‌زد، و برای
 * اکوی برچسب اصلاً الگویی نبود. یعنی سبزی از «نبودِ قرمز» آمده بود (بند ۶ب-۲ ریشه).
 *
 * پس ادعاها **رفتاری** اند نه رجکسی، و هرکدام یک **کنترلِ مثبت** دارد: نمونه‌ی
 * واقعیِ نقض باید قرمز بدهد، وگرنه یک سنجه‌ی همیشه‌خاموش هم همه‌ی ادعاهای منفی را
 * پاس می‌کرد. */
console.log('\n▶ ۱۶) سنجه‌های لحن و اکوی برچسب');
{
  const { chatMetrics } = await import('./reading-lab/chat-checks.mjs');
  const LANGFA = (await import('./reading-lab/lang/fa.mjs')).default;
  const mOf = (reply) => chatMetrics({ reply, raw: reply, cardNames: ['برج'], questionWords: [], question: 'چرا؟' });

  ok(!!LANGFA.bookish?.re && !!LANGFA.hookLabel, 'دادهٔ هر دو سنجه در lang/fa.mjs هست');

  /* کنترلِ مثبت — عینِ نوبتِ ۸ دورِ ۱ (شش نشتِ کتابی در یک جواب). */
  const bookishReal = 'درِ بازِ این فال، فرقِ میان «اقدامِ روشن» و «چک‌کردنِ وسواسی» است؛\n'
    + 'اولی از پیک شمشیر می‌آید و دومی فقط هفت چوبدست را خسته‌تر می‌کند.\n'
    + 'برج هم همین را نشان می‌دهد، چون مسیر روشن است.';
  ok(mOf(bookishReal).bookish.length >= 3,
    'کنترلِ مثبت: جوابِ واقعیِ کتابیِ دورِ ۱ قرمز می‌شود');
  ok(mOf(bookishReal).issues.some((i) => /لحنِ کتابی/.test(i)), 'و به‌عنوان «ایراد» گزارش می‌شود');

  /* کنترلِ منفی — همان معنا به فارسیِ گفتاری. اگر این هم قرمز بدهد، سنجه پهن است و
   * روی خروجیِ سالم قرمزِ کاذب می‌دهد (درسِ الگوی پهن‌شده‌ی پرتغالی، بند ۲و/۶ب-۲). */
  const spoken = 'فرقِ «اقدامِ روشن» با «چک‌کردنِ وسواسی» همینه که برج نشون می‌ده.\n'
    + 'اولی از پیک شمشیر میاد و دومی فقط هفت چوبدست رو خسته‌تر می‌کنه.';
  ok(mOf(spoken).bookish.length < 3, 'کنترلِ منفی: همان معنا به گفتاری قرمز نمی‌دهد');

  /* اکوی برچسب: هر پنج شکلی که در دورِ ۱ واقعاً دیده شد. */
  for (const last of ['زاویه‌ی بازِ فال اینه که برج رو جدی بگیری.',
    'درِ بازِ این فال، فرقِ حرف با رفتارِ برج است.',
    'بخشِ هنوزبازِ ماجرا رفتارِ واقعیِ برج است.',
    'چیزی که هنوز باز مانده، مقایسه‌ی قولِ برج با رفتارِ اوست.',
    'رابطه‌ی برج با این ماجرا هنوز باز است.']) {
    ok(!!mOf(`یه خطِ اول.\n${last}`).labelEcho, `اکوی برچسب گرفته می‌شود: «${last.slice(0, 22)}…»`);
  }
  /* کنترلِ منفی: قلابِ سالمِ نوبتِ ۱۰ دورِ ۱ — همان کار را می‌کند بدونِ نام‌بردنش. */
  ok(!mOf('یه خطِ اول.\nبرج اینجا فقط یه مسیرِ امن‌تر رو نشون می‌ده: تصمیم رو از حدس جدا کن.').labelEcho,
    'کنترلِ منفی: قلابِ سالمِ بدونِ نام‌بردن قرمز نمی‌شود');
  /* و «در باز» **وسطِ** متن یک استعاره‌ی مشروع است، نه اکو. */
  ok(!mOf('درِ بازِ رابطه‌تون هنوز هست.\nبرج می‌گه یه قدمِ عملی لازمه.').labelEcho,
    'و فقط خطِ آخر سنجیده می‌شود، نه کلِ جواب');

  /* گاردِ ساختاری: آزمایشگاه باید نبودِ این دادهٔ زبانی را **بلند** شکست بدهد،
   * وگرنه برای زبانِ تازه بی‌صدا از رویش رد می‌شود و همان سبزیِ دروغین برمی‌گردد. */
  const LAB = strip(fs.readFileSync(new URL('./chat-lab.mjs', import.meta.url), 'utf8'));
  ok(/for \(const k of \['bookish', 'hookLabel'\]\)[\s\S]{0,160}errs\.push/.test(LAB),
    'آزمایشگاه نبودِ سنجه‌ی زبانی را خطا می‌دهد (نه رد شدنِ بی‌صدا)');
  ok(/systemFor\(armVariant\(arm\)\)/.test(LAB) && /planFor\(armModel\(arm\)\)/.test(LAB),
    'بازوی `model@variant` هم پرامپت و هم مدل را جدا resolve می‌کند');
  ok(/out === base[\s\S]{0,200}process\.exit\(1\)/.test(LAB),
    'واریانتی که هیچ‌چیز را وصله نکند، دورِ پولی را شروع نمی‌کند');

  /* و گاردِ دوم، چون اولی برای واریانتِ **مرکب** کور است: `v3`/`v4` اول `v2` را صدا
   * می‌زنند، پس «در مجموع چیزی عوض شد» همیشه درست است و یک لنگرِ خطاخورده وسطِ
   * زنجیره بازو را بی‌صدا به `v2` تبدیل می‌کند. رفتاری سنجیده می‌شود: خودِ `rep` از
   * سورس بیرون کشیده و با یک لنگرِ ناموجود اجرا می‌شود. */
  const repSrc = (LAB.match(/const rep = \([\s\S]*?\n\};/) || [])[0] || '';
  ok(!!repSrc, 'helperِ اجباری‌کردنِ لنگر (`rep`) در آزمایشگاه هست');
  {
    let died = false;
    const realExit = process.exit;
    process.exit = () => { died = true; throw new Error('exit'); };
    const realErr = console.error;
    console.error = () => {};
    try { new Function(`${repSrc}; return rep;`)()('سلام', 'لنگرِ ناموجود', 'x'); } catch { /* از exit */ }
    process.exit = realExit; console.error = realErr;
    ok(died, 'کنترلِ مثبت: لنگرِ ناموجود دورِ پولی را می‌کُشد، نه اینکه بی‌صدا رد شود');
  }
  {
    const realExit = process.exit; let died = false;
    process.exit = () => { died = true; };
    const out = new Function(`${repSrc}; return rep;`)()('سلام دنیا', 'دنیا', 'رفیق');
    process.exit = realExit;
    ok(!died && out === 'سلام رفیق', 'کنترلِ منفی: لنگرِ موجود عادی جایگزین می‌شود');
  }
}

/* ═══ ۱۷) پاراگراف‌بندیِ قطعی و لحنِ گفتاری ═══════════════════════════
 *
 * هر دو تغییر از آزمایشگاه آمدند، نه از شهود، و هر دو ادعای **منفی** دارند؛ پس طبقِ
 * بند ۶ب-۲ ریشه هر کدام یک **کنترلِ مثبت** کنارش دارد که ثابت می‌کند سنجه واقعاً
 * می‌بیند — وگرنه یک `splitChatLines`ِ همیشه-بی‌اثر هم همه‌ی ادعاهای منفی را پاس
 * می‌کرد. */
console.log('\n▶ ۱۷) پاراگراف‌بندی و لحنِ گفتاری');
{
  const lines = (s) => String(s).split('\n').filter((x) => x.trim()).length;
  const long = 'این یک جوابِ نمونه‌ی بلند است که در یک تکه نوشته شده. جمله‌ی دوم هم همین‌جاست و ادامه می‌ده. جمله‌ی سوم یک چیزِ تازه می‌گه. جمله‌ی چهارم هم برای رسیدن به سقفِ نویسه‌ها لازمه.';
  ok(long.length >= chat.CHAT_SPLIT_MIN_CHARS, 'فیکسچرِ بلند واقعاً از کفِ تکه‌کردن رد می‌شود');
  ok(lines(chat.splitChatLines(long)) >= 2, 'جوابِ یک‌تکه‌ی بلند به چند خط تکه می‌شود');

  /* 🔑 کنترلِ مثبت: بدونِ تکه‌کردن همان متن **یک** خط است. بدونِ این ادعا، یک تابعِ
   * بی‌اثر هم ادعای بالا را با «≥۲» رد نمی‌کرد ولی ادعاهای منفیِ پایین را پاس می‌کرد. */
  ok(lines(long) === 1, 'کنترلِ مثبت: همان متن قبل از تکه‌کردن یک خط بود');

  // ۱) متنی که مدل خودش خط جدا کرده، دست نمی‌خورد.
  /* ⚠️ خطوطِ این فیکسچر عمداً **سرِ جمله نمی‌شکنند** و خودش از کفِ نویسه هم ردّ
   * می‌شود. با فیکسچری که مرزِ خطش دقیقاً مرزِ جمله باشد، برداشتنِ این گارد خروجیِ
   * **یکسان** می‌دهد و جهش زنده رد می‌شود (نقصِ نسخه‌ی اولِ همین ادعا). */
  const multi = 'خطِ اول اینه که یه چیزی داره عوض می‌شه و هنوز تموم نشده\n'
    + 'خطِ دوم هم همین رو کامل می‌کنه. و این جمله‌ی سومه که وسطِ همین خط اومده و باید دقیقاً همون‌جا بمونه.';
  ok(multi.length >= chat.CHAT_SPLIT_MIN_CHARS, 'فیکسچرِ چندخطی از کفِ تکه‌کردن رد می‌شود');
  ok(chat.splitChatLines(multi) === multi, 'متنِ از-قبل-چندخطی بیت‌به‌بیت دست‌نخورده می‌ماند');

  // ۲) جوابِ کوتاه یک‌تکه می‌ماند (تکه‌کردنش متن را بریده‌بریده می‌کند).
  const short = 'آره. ولی صبر می‌خواد.';
  ok(short.length < chat.CHAT_SPLIT_MIN_CHARS && chat.splitChatLines(short) === short,
    'جوابِ کوتاه‌تر از کف تکه نمی‌شود');

  // ۳) سقفِ خط رعایت می‌شود و **هیچ جمله‌ای حذف نمی‌شود**.
  const many = Array.from({ length: 12 }, (_, i) => `جمله‌ی شماره‌ی ${i + 1} این‌جاست و به اندازه‌ی کافی بلند هست.`).join(' ');
  const cutd = chat.splitChatLines(many);
  ok(lines(cutd) <= chat.CHAT_SPLIT_MAX_LINES, `بیش از ${chat.CHAT_SPLIT_MAX_LINES} خط ساخته نمی‌شود`);
  ok(cutd.replace(/\n/g, ' ') === many, '🔑 و هیچ جمله‌ای در راه گم نمی‌شود (فقط جداکننده عوض می‌شود)');

  /* ۴) ⚠️ `؛` عمداً جداکننده **نیست**: با آن ۹۳ خط از ۱۲۰ نوبتِ واقعی به نیم‌جمله‌ای
   * ختم می‌شد که با نقطه‌ویرگول تمام می‌شود، یعنی یک خطِ ناتمام. */
  const semi = 'این بخشِ اول است که به اندازه‌ی کافی بلند نوشته شده؛ و این ادامه‌ی همان جمله است که نباید جدا شود چون هنوز تمام نشده؛ و این هم تکه‌ی سومِ همان جمله است که باز هم با نقطه‌ویرگول آمده.';
  ok(semi.length >= chat.CHAT_SPLIT_MIN_CHARS, 'فیکسچرِ نقطه‌ویرگول از کف رد می‌شود');
  ok(!chat.splitChatLines(semi).split('\n').some((l) => l.trim().endsWith('؛')),
    'هیچ خطی به نقطه‌ویرگول ختم نمی‌شود (`؛` جداکننده نیست)');

  // ۵) مسیرِ واقعیِ محصول: `cleanChatReply` خودش تکه می‌کند، نه اینکه تابع بی‌مصرف بماند.
  ok(lines(chat.cleanChatReply(long)) >= 2, '🔑 `cleanChatReply` واقعاً تکه‌کردن را صدا می‌زند');

  /* ۶) 🐛 باگِ خفته‌ی حذفِ نامِ نشتی: فشرده‌سازیِ فاصله با `\s` خطِ جدید را هم می‌خورد،
   * پس جوابِ چندخطیِ مدل **فقط برای کاربرانی که نامشان در متن آمده بود** یک‌تکه
   * می‌شد. بی‌صدا، و دقیقاً روی همان کاربرانی که بیشتر شخصی‌سازی دیده بودند. */
  /* ⚠️ نامِ نشتی عمداً **آخرِ خط** است، نه وسطِ جمله: حذفش یک فاصله کنارِ `\n` جا
   * می‌گذارد و دقیقاً همان‌جاست که `\s{2,}` خطِ جدید را می‌بلعد. فیکسچرِ وسط-جمله
   * این جهش را زنده رد می‌کرد (نقصِ نسخه‌ی اولِ همین ادعا). */
  const named = 'سلام این خطِ اول است، مریم\nو این خطِ دوم است که باید جدا بماند.';
  const cleaned = chat.cleanChatReply(named, { name: 'مریم' });
  ok(lines(cleaned) === 2, '🔑 حذفِ نامِ نشتی خطوطِ مدل را به هم نمی‌چسباند');
  ok(!cleaned.includes('مریم'), 'و خودِ نام واقعاً حذف می‌شود');
  ok(!/  /.test(cleaned), 'و فاصله‌ی دوتاییِ به‌جامانده هم جمع می‌شود');

  /* ۷) قفلِ لحنِ گفتاری در پرامپت. این متن **عیناً همانی است که در آزمایشگاه سنجیده
   * شد** و نشتِ لحنِ کتابی را ۷/۱۵ ⟵ ۰/۱۵ برد؛ عوض‌کردنش یعنی باطل‌کردنِ آن اندازه‌گیری. */
  const P = (FA.match(/chatSystem: `([\s\S]*?)`,\n/) || [])[1] || '';
  ok(/هیچ فعلی را با «ـد» تمام نکن/.test(P), '🔑 قفلِ لحنِ گفتاری در پرامپت هست');
  ok(/می‌ده نه می‌دهد/.test(P), 'و مثالِ تبدیل دارد، نه فقط قاعده‌ی توصیفی');
  // و همان چیزی که ru/es/pt از قبل داشتند: فارسی حالا هم‌ترازشان است.
  for (const [lang, re] of [['ru', /канцелярит/], ['es', /Nada de forma escrita/], ['pt', /Nada de forma escrita/]]) {
    const other = fs.readFileSync(new URL(`../bots/tarot/locales/${lang}.js`, import.meta.url), 'utf8');
    const op = (other.match(/chatSystem: `([\s\S]*?)`,\n/) || [])[1] || '';
    ok(re.test(op), `قفلِ لحن در locale «${lang}» هم هست (هم‌ترازیِ بند ۲و/۱)`);
  }

  /* ۸) قاعده‌ی «اسمِ قلاب را نبر» — در **هر چهار** زبان (بند ۲و/۱: پیش‌فرض همه).
   * این همان کلاسِ `labelLeak` است: مدل به‌جای انجامِ کار، برچسبش را چاپ می‌کند. */
  const hookRules = [['fa', /اسمِ این کار را نبر/], ['ru', /Не называй это вслух/],
    ['es', /No le pongas nombre a esto/], ['pt', /Não dê nome a isso/]];
  for (const [lang, re] of hookRules) {
    const src = lang === 'fa' ? FA : fs.readFileSync(new URL(`../bots/tarot/locales/${lang}.js`, import.meta.url), 'utf8');
    const op = (src.match(/chatSystem: `([\s\S]*?)`,\n/) || [])[1] || '';
    ok(re.test(op), `قاعده‌ی «اسمِ قلاب را نبر» در locale «${lang}» هست`);
  }
}

/* ═══ ۱۸) پی‌والِ داخلِ گفتگو و سؤالِ معلق (موارد ۷ و ۸) ═══════════════ */
console.log('\n▶ ۱۸) پی‌وال و سؤالِ معلق');
{
  const h = bodyOf(CODE, 'async function handleChatMessage(');
  const pay = h.slice(h.indexOf('if (!paid) {'), h.indexOf('const { id: msgId'));
  ok(/walletRows\(uid\)/.test(pay), 'پی‌وال همان `walletRows` تک‌منبع را می‌دهد (خرید + دعوت + کارتِ شانس)');
  /* 🔑 دکمه‌ی «برگرد به گفتگو» حذف شد (خواسته‌ی صریحِ مالک): استیت از قبل `chatting`
   * است، پس آن دکمه فقط به همان دیوار برمی‌گرداند. */
  ok(!/chatBack/.test(pay), '🔑 و دکمه‌ی «برگرد به گفتگو» دیگر ساخته نمی‌شود');
  ok(/parkChatQuestion\(uid, rid, text, askedId\)/.test(pay), '🅿️ و سؤال پارک می‌شود، نه اینکه دور ریخته شود');
  ok(/getBalance\(uid\)/.test(pay), 'خطِ موجودی زیرِ پیام می‌آید (خواسته‌ی صریحِ مالک)');
  ok(/\.\.\.extra/.test(pay), '📎 و پیامِ پی‌وال هم به **خودِ سؤالِ کاربر** ریپلای می‌خورد');
  // هندلرِ دکمه‌ی کهنه زنده می‌ماند (بند ۲ج/۶) حتی با حذفِ خودِ دکمه.
  ok(/bot\.action\(\/\^chat:\(\\d\+\)/.test(SRC), '⚠️ ولی هندلرِ همان دکمه ثبت می‌ماند (دکمه‌ی کهنه نمی‌میرد)');

  // متنِ رندرشده: وعده‌ی «نگهش داشتم» فقط وقتی پارک شده باشد.
  const L = (await import('../bots/tarot/locales/fa.js')).default;
  const CUR = { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji };
  const nbParked = L.chat.needBalance(1, CUR, 0, true);
  const nbPlain = L.chat.needBalance(1, CUR, 0, false);
  ok(/موجودی/.test(nbParked) && /۰💎/.test(nbParked), 'متنِ پی‌وال خطِ موجودیِ واقعی دارد');
  ok(nbParked.length > nbPlain.length && /نگه داشتم/.test(nbParked),
    '🔑 وعده‌ی «سؤالت رو نگه داشتم» در متن هست');
  ok(!/نگه داشتم/.test(nbPlain),
    '⚠️ و اگر پارک نشده باشد آن وعده **نمی‌آید** (ادعا از دیتا جلو نمی‌زند، بند ۲و/۶ج)');

  /* 🅿️ رفتاری: پارک و ادعا روی SQLite واقعی، با SQLِ خوانده‌شده از سورس. */
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      tg_msg_id INTEGER NOT NULL DEFAULT 0);`);
  const BT2 = String.fromCharCode(96);
  const sqlOf2 = (name) => {
    const m = SRC.match(new RegExp(name + ":\\s*db\\.prepare\\((?:'([^']+)'|\"([^\"]+)\"|" + BT2 + '([\\s\\S]*?)' + BT2 + ')\\)'));
    return (m && (m[1] || m[2] || m[3])) || null;
  };
  const NEED2 = ['insertChatPending', 'pendingChatMsg', 'dropChatPendings', 'claimChatPending', 'deduct', 'chatAsked'];
  ok(NEED2.every(n => sqlOf2(n)), 'هر شش statementِ سؤالِ معلق از سورس برداشته شدند');
  ok(/AND role='pending'/.test(sqlOf2('claimChatPending')),
    "🔑 ادعای سؤالِ معلق در خودِ SQL اتمیک است (شرطِ role='pending')");
  ok(/created_at=unixepoch\(\)/.test(sqlOf2('claimChatPending')),
    '🔑 و `created_at` تازه می‌شود، وگرنه جاروی یتیم‌ها ردیفِ تازه‌ادعاشده را وسطِ فراخوانی ریفاند می‌کند');
  const st2 = Object.fromEntries(NEED2.map(n => [n, d.prepare(sqlOf2(n))]));
  const parkSrc = (SRC.match(/const parkChatQuestion = db\.transaction\([\s\S]*?\n\}\);/) || [])[0];
  const claimSrc = (SRC.match(/const claimPendingChat = db\.transaction\([\s\S]*?\n\}\);/) || [])[0];
  const priceSrc2 = (SRC.match(/const chatPriceFor = [\s\S]*?;\n/) || [])[0];
  ok(!!parkSrc && !!claimSrc, 'هر دو تراکنشِ سؤالِ معلق از سورس برداشته شدند');
  const api = new Function('db', 'stmts', 'CHAT_PRICE', 'CHAT_FREE_FIRST', 'CHAT_PENDING_RESUME',
    `${priceSrc2}\n${parkSrc}\n${claimSrc}\nreturn { parkChatQuestion, claimPendingChat, chatPriceFor };`)(
    d, st2, num('CHAT_PRICE'), bool('CHAT_FREE_FIRST'), bool('CHAT_PENDING_RESUME'));

  d.prepare('INSERT INTO users (telegram_id, balance) VALUES (7, 0)').run();
  /* سناریوی واقعی: سؤالِ **اولِ رایگان** قبلاً پرسیده شده (وگرنه اصلاً پی‌والی در کار
   * نبود)، پس سؤالِ بعدی پولی است و کاربرِ بی‌موجودی پشتِ دیوار می‌ماند. */
  d.prepare("INSERT INTO chat_messages (reading_id, user_id, role, text, price) VALUES (20, 7, 'user', 'سؤالِ اولِ رایگان', 0)").run();
  const pk1 = api.parkChatQuestion(7, 20, 'سؤالِ پشتِ دیوار', 555);
  ok(pk1 > 0, 'سؤالِ پشتِ پی‌وال پارک می‌شود');
  const pk2 = api.parkChatQuestion(7, 20, 'سؤالِ تازه‌تر', 556);
  ok(d.prepare("SELECT COUNT(*) c FROM chat_messages WHERE role='pending'").get().c === 1,
    '🔑 و **یک** پارک per کاربر می‌ماند (وگرنه بعد از شارژ چند جوابِ پشتِ‌سرهم می‌رفت)');
  ok(d.prepare('SELECT text t FROM chat_messages WHERE id=?').get(pk2).t === 'سؤالِ تازه‌تر',
    'و تازه‌ترین سؤال جای قبلی را می‌گیرد');
  /* 🔑 سؤالِ پارک‌شده نه سهمیه‌ی رایگان را می‌سوزاند و نه جاروی یتیم‌ها را فعال می‌کند:
   * هر دو فقط `role='user'` را می‌بینند. */
  ok(st2.chatAsked.get(20).c === 1,
    '🔑 سؤالِ پارک‌شده در شمارشِ سهمیه نمی‌آید (فقط همان سؤالِ واقعیِ قبلی شمرده می‌شود)');
  const sweepSql = (SRC.match(/orphanChatMsgs: db\.prepare\(`([\s\S]*?)`\)/) || [])[1];
  ok(/role='user'/.test(sweepSql), '⚠️ و جاروی یتیم‌ها هم سراغش نمی‌رود');

  // ادعا با موجودیِ صفر: هیچ چیزی نباید عوض شود (تراکنش رول‌بک می‌کند).
  let threw = false;
  try { api.claimPendingChat(7, pk2, 20); } catch { threw = true; }
  ok(threw, 'ادعا با موجودیِ صفر شکست می‌خورد');
  ok(d.prepare('SELECT role r FROM chat_messages WHERE id=?').get(pk2).r === 'pending',
    '🔑 و ردیف **دست‌نخورده** پارک می‌ماند (تراکنش: یا هر دو یا هیچ‌کدام)');
  d.prepare('UPDATE users SET balance=2 WHERE telegram_id=7').run();
  const got = api.claimPendingChat(7, pk2, 20);
  ok(got === num('CHAT_PRICE'), 'با موجودی، ادعا قیمتِ واقعی را برمی‌گرداند');
  ok(d.prepare('SELECT balance b FROM users WHERE telegram_id=7').get().b === 1, 'و کسر انجام شده');
  ok(d.prepare('SELECT role r, price p FROM chat_messages WHERE id=?').get(pk2).r === 'user',
    'و ردیف به سؤالِ واقعی تبدیل شده');
  ok(api.claimPendingChat(7, pk2, 20) === null,
    '🔑 ادعای دوباره بی‌اثر است (دو مسیر نمی‌توانند یک سؤال را دو بار جواب بدهند)');

  /* 🔌 سیمِ اتصال: بدونِ این، همه‌ی بالا کدِ مرده است. */
  const res = bodyOf(CODE, 'async function resumePendingChat(');
  ok(!!res, 'تابعِ بازگشتِ خودکار از سورس برداشته شد');
  ok(before(res, 'claimPendingChat(', 'runChatTurn('),
    '🔑 کسر **قبل از** فراخوانیِ مدل است، مثل هر مسیرِ پولیِ دیگر (بند ۹ ریشه)');
  ok(/replyToExtra\(p\.tg_msg_id\)/.test(res),
    '📎 و جواب به **خودِ سؤالِ کاربر** ریپلای می‌خورد، نه به فال');
  ok(/logPush\(db, uid/.test(res),
    '⚠️ پیامِ بدونِ ctx در بازپخشِ مسیر نامرئی می‌ماند، پس صریح ثبت می‌شود (بند ۲الف ریشه)');
  ok(/if \(!CHAT_PENDING_RESUME\) return false;/.test(res), 'و رول‌بکِ یک‌خطی دارد');
  const aa = bodyOf(CODE, 'async function afterApproval(');
  ok(/resumePendingChat\(uid, 'purchase'\)/.test(aa), '🔑 مسیرِ **خرید** بازگشت را صدا می‌زند');
  const lp = actBody("bot.action(/^lpick:(\\d+)$/, async (ctx) => {");
  ok(/resumePendingChat\(uid, 'lucky'\)/.test(lp), '🔑 و مسیرِ **کارتِ شانس** هم');
  /* ⚠️ ادعای معکوس و مهم‌ترین ادعای این بلوک: پاداشِ دعوت **نباید** بازگشت را صدا بزند
   * (تصمیمِ صریحِ مالک + بند ۹ب-۴ ریشه: پیامِ خودکار فقط جوابِ کاری است که خودِ کاربر
   * همین حالا کرده؛ آن‌جا دوستش فال گرفته، نه خودش). */
  const refBlock = SRC.slice(SRC.indexOf('setReferralRewarded'), SRC.indexOf('setReferralRewarded') + 2500);
  ok(!/resumePendingChat/.test(refBlock), '🔑 ولی پاداشِ دعوت **هرگز** پیامِ خودکار نمی‌فرستد');
  ok((SRC.match(/resumePendingChat\(/g) || []).length === 3,
    '⚠️ و دقیقاً همین دو صداکننده وجود دارند (شمارش، تا مسیرِ سومی بی‌صدا اضافه نشود)');
}

/* ═══ ۱۹) گاردِ استیتِ گفتگو و فلگِ بازگشت (موارد ۹ و ۱۰) ══════════════ */
console.log('\n▶ ۱۹) گاردِ استیت و فلگِ بازگشت');
{
  /* 🚧 رفتاری: خودِ میدل‌ور از سورس بریده و با ورودی‌های واقعی **اجرا** می‌شود.
   * ادعای رجکسی این‌جا بی‌فایده است، چون تصمیم از ترکیبِ چهار شرط درمی‌آید (نوعِ
   * آپدیت، برچسبِ کیبورد، درِ کسبِ الماس، و موجودی) و هر رجکسی فقط یکی را می‌بیند. */
  const mwSrc = (SRC.match(/const CHAT_KEEP_CB = [\s\S]*?\n\}\);\n/) || [])[0];
  ok(!!mwSrc, 'میدل‌ورِ استیتِ گفتگو از سورس برداشته شد');
  /* ⚠️ هارنسِ پایین پرچم را **تزریق** می‌کند تا هر دو حالت سنجیده شود، پس خودِ مقدارِ
   * منتشرشده باید جدا پین شود — وگرنه خاموش‌کردنِ گارد در سورس از این چک سبز رد
   * می‌شد و کلِ مورد ۹ بی‌صدا از بین می‌رفت (همان گاردِ آینه‌ای، بند ۶ب ریشه). */
  ok(bool('CHAT_STATE_GUARD') === true, '🔑 گاردِ استیتِ گفتگو روشن منتشر شده');
  ok(bool('CHAT_CLOSE_FLAG') === true, '🏳️ و فلگِ بازگشت هم');
  const LBL = { wallet: '💎 ذخایر الماس', lucky: '🎲 کارت شانس (استخراج الماس)',
    invite: '📤 دعوت دوستان', reading: '🔮 فال بگیر', support: '💬 پشتیبانی' };
  const runMw = ({ cb = null, txt = null, balance = 0, guard = true, state = 'chatting' }) => {
    const seen = { next: 0, guard: 0, left: 0 };
    const fn = new Function('bot', 'getState', 'getSession', 'getBalance', 'KB_LABELS',
      'WALLET_LABELS', 'LUCKY_LABELS', 'INVITE_LABELS', 'CHAT_AFTER_READING',
      'CHAT_STATE_GUARD', 'chatOpenGuard', 'leaveChat', 'logErr', 'L', 'seen',
      `${mwSrc}\nreturn bot.__mw;`);
    const stubBot = { use: (h) => { stubBot.__mw = h; } };
    const mw = fn(stubBot, () => state, () => ({ chatReadingId: 9 }), () => balance,
      new Set([...Object.values(LBL), LBL.support]), [LBL.wallet], [LBL.lucky], [LBL.invite],
      true, guard, async () => { seen.guard++; }, () => { seen.left++; },
      () => {}, { support: { button: LBL.support } }, seen);
    return mw({ from: { id: 5 }, message: txt ? { text: txt } : undefined,
      callbackQuery: cb ? { data: cb } : undefined }, async () => { seen.next++; })
      .then(() => seen);
  };
  ok((await runMw({ txt: 'سؤالم اینه که چی می‌شه؟' })).next === 1, 'متنِ آزاد سؤالِ گفتگوست و رد می‌شود');
  ok((await runMw({ cb: 'chat:9' })).next === 1, 'اکشنِ خودِ گفتگو هم');
  /* 🔑 دو دکمه‌ی **خودِ گارد** هم باید رد شوند. میدل‌ور قبل از همه‌ی هندلرهاست، پس
   * بدونِ این، تپِ «ادامه می‌دم»/«بستن گفتگو» دوباره گارد می‌گرفت و کاربر در حلقه‌ی
   * بی‌پایان می‌افتاد — همان کلاسِ تیکتِ `#TRT-8976388520` (بند ۹ب/۶ ریشه).
   * ⚠️ این باگ در همین PR **واقعاً ساخته شد** و همین هارنس گرفتش. */
  for (const cb of ['chat_keep', 'chat_close', 'chat_close:9', 'lremind:1']) {
    const g = await runMw({ cb, balance: 5 });
    ok(g.next === 1 && g.guard === 0, `🔑 دکمه‌ی خودِ گارد («${cb}») گارد نمی‌خورد (ضدِ حلقه)`);
  }
  ok((await runMw({})).next === 1, 'آپدیتِ سرویسی/ویس دست نمی‌خورد');
  /* 🔑 قلبِ مورد ۹: تنها درِ باز، کسبِ الماس است و **فقط** با موجودیِ صفر. */
  for (const cb of ['recharge', 'wallet_go', 'lucky_go', 'invite_go']) {
    ok((await runMw({ cb, balance: 0 })).next === 1, `🔑 «${cb}» با موجودیِ صفر باز است`);
    const g = await runMw({ cb, balance: 3 });
    ok(g.guard === 1 && g.next === 0, `⚠️ ولی همان «${cb}» با موجودیِ ناصفر گارد می‌خورد`);
  }
  for (const [k, lb] of [['wallet', LBL.wallet], ['lucky', LBL.lucky], ['invite', LBL.invite]]) {
    ok((await runMw({ txt: lb, balance: 0 })).next === 1, `🔑 برچسبِ کیبوردِ «${k}» هم با موجودیِ صفر باز است`);
    ok((await runMw({ txt: lb, balance: 3 })).guard === 1, `⚠️ و با موجودیِ ناصفر گارد می‌خورد`);
  }
  /* 🔑 هر چیزِ دیگری گارد می‌خورد — و این نقطه‌ی تفاوت با v3.87.0 است: آن‌جا گفتگو
   * **بی‌صدا** بسته می‌شد. */
  for (const [what, arg] of [['فال بگیر', { txt: LBL.reading }], ['nav:menu', { cb: 'nav:menu' }],
    ['/start', { txt: '/start' }], ['chat_skip', { cb: 'chat_skip' }], ['pkg:gold', { cb: 'pkg:gold' }]]) {
    const g = await runMw({ ...arg, balance: 0 });
    ok(g.guard === 1 && g.next === 0 && g.left === 0, `🔑 «${what}» گارد می‌خورد، نه خروجِ بی‌صدا`);
  }
  /* 💬 و تنها استثنای دیگر: پشتیبانی (بند ۶ج ریشه، قاعده‌ی آهنین). راهِ فرارِ کاربرِ
   * گیرکرده هرگز گارد نمی‌شود، حتی وسطِ گفتگو. */
  for (const arg of [{ txt: LBL.support }, { txt: '/support' }, { txt: '/paysupport' }]) {
    const g = await runMw({ ...arg, balance: 5 });
    ok(g.next === 1 && g.guard === 0, `🔑 «${arg.txt}» هرگز گارد نمی‌شود (بند ۶ج ریشه)`);
  }

  /* 🔁 کنترلِ مثبتِ رول‌بک (بند ۶ب-۲): با پرچمِ خاموش، **همان کد** دقیقاً رفتارِ
   * v3.87.0 را می‌دهد. بدونِ این، یک میدل‌ورِ همیشه-گارد هم همه‌ی ادعاهای بالا را
   * پاس می‌کرد و «رول‌بکِ یک‌خطی» یک حرفِ بی‌پشتوانه می‌شد. */
  const off = await runMw({ cb: 'nav:menu', guard: false });
  ok(off.left === 1 && off.guard === 0 && off.next === 1,
    '🔁 و با `CHAT_STATE_GUARD=false` رفتار بیت‌به‌بیت همان خروجِ بی‌صدای قبلی است');
  ok((await runMw({ cb: 'nav:menu', state: 'idle' })).next === 1,
    '⚠️ و کاربرِ بیرونِ گفتگو هیچ‌وقت گارد نمی‌خورد');

  // دو دکمه‌ی گارد، و اینکه هیچ‌کدام بن‌بست نیست.
  const gsrc = bodyOf(CODE, 'async function chatOpenGuard(');
  ok(/L\.buttons\.chatKeep/.test(gsrc) && /L\.buttons\.chatClose/.test(gsrc),
    '🔑 گارد دو گزینه‌ی صریح دارد: ادامه و بستن (بند ۹ب/۲)');
  const keep = actBody("bot.action('chat_keep', async (ctx) => {");
  // کامنت‌ها قبل از سنجش حذف می‌شوند (تله‌ی ثبت‌شده‌ی v3.56.0: سندنویسی خودش باگ می‌سازد).
  const keepCode = keep.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/deleteMessage\(\)/.test(keepCode) && !/setState|leaveChat|closeChat/.test(keepCode),
    '🔑 «ادامه می‌دم» فقط پیامِ گارد را برمی‌دارد و هیچ استیتی را عوض نمی‌کند');

  /* 🏳️ مورد ۱۰: ترتیبِ فلگ و پیامِ همیشگی، و لنگرش. */
  const cl = bodyOf(CODE, 'async function closeChat(');
  ok(before(cl, 'leaveChat(uid, via)', 'L.chat.closed'), 'اول استیت بسته می‌شود، بعد فلگ می‌رود');
  ok(/chatTailExtra\(r\)/.test(cl), '📎 فلگ به **پایانِ فال** ریپلای می‌خورد، نه به سؤال');
  ok(/L\.buttons\.chatStart/.test(cl), '🔑 و دکمه‌ی برگشت به همان گفتگو را دارد');
  ok(/if \(!rid \|\| !CHAT_CLOSE_FLAG\) return false;/.test(cl), 'و رول‌بکِ یک‌خطی دارد');
  const close = actBody('bot.action(/^chat_close(?::(\\d+))?$/, async (ctx) => {');
  ok(before(close, 'closeChat(ctx, uid', 'replyCanceled(ctx, uid)'),
    '🔑 فلگ **قبل از** پیامِ همیشگی می‌رود (ترتیب، خواسته‌ی صریحِ مالک)');
  ok(/chat_close\(\?:\:\(\\d\+\)\)\?/.test(SRC) || /\^chat_close\(\?::\(\\d\+\)\)\?\$/.test(SRC),
    '⚠️ و شناسه در الگو **اختیاری** است (دکمه‌ی کهنه نمی‌میرد، بند ۲ج/۶)');
}

const total = pass + errs.length;
if (errs.length) {
  console.log(`\n❌ گفتگوی پس از فال: ${pass} پاس، ${errs.length} خطا`);
  for (const e of errs) console.log(`   - ${e}`);
  process.exit(1);
}
console.log(`\n✅ گفتگوی پس از فال: ${total} ادعا، ۰ خطا`);
