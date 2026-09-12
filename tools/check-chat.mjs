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
  ok(/ALTER TABLE readings ADD COLUMN anchor_msg_id INTEGER NOT NULL DEFAULT 0/.test(SRC),
    'ستونِ لنگر افزایشی است و DEFAULT دارد (ردیفِ قدیمی معتبر می‌ماند)');
  ok(!/DROP (TABLE|COLUMN)\s+(chat_messages|anchor_msg_id)/i.test(SRC), 'هیچ DROP ای روی این دو نیست');

  // رفتاری: همان DDL روی یک دیتابیسِ **اسکیمای قدیمی** دو بار اجرا می‌شود.
  const d = new Database(':memory:');
  d.exec('CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT)');
  d.prepare("INSERT INTO readings (user_id, status) VALUES (1, 'delivered')").run();
  const run = () => {
    d.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0,
      refunded INTEGER NOT NULL DEFAULT 0, model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    try { d.exec('ALTER TABLE readings ADD COLUMN anchor_msg_id INTEGER NOT NULL DEFAULT 0'); } catch {}
  };
  run(); run();
  ok(d.prepare('PRAGMA table_info(readings)').all().some(c => c.name === 'anchor_msg_id'), 'ستون روی اسکیمای قدیمی ساخته می‌شود');
  ok(d.prepare('SELECT anchor_msg_id AS a FROM readings WHERE id=1').get().a === 0, 'و ردیفِ قدیمی مقدارِ امنِ صفر می‌گیرد');
  ok(d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='chat_messages'").get().c === 1, 'اجرای دوباره چیزی را نمی‌شکند (idempotent)');
}

/* ═══ ۳) پول: کسر قبل از LLM، تراکنش، ریفاندِ یک‌باره ══════════════════ */
console.log('\n▶ ۳) مسیرِ پول');
{
  const h = bodyOf(CODE, 'async function handleChatMessage(');
  ok(!!h, 'هندلرِ نوبت از سورس برداشته شد');
  const iPay = h.indexOf('payForChat(');
  const iLLM = h.indexOf('orChatResilient(');
  /* 🔑 حیاتی‌ترین ادعای این فیچر (بند ۹ ریشه): هیچ فراخوانیِ پولی قبل از کسرِ اعتبار.
   * گاردی که **بعد از** خرجِ پول بیاید بی‌فایده است، پس ترتیب سنجیده می‌شود نه وجود. */
  ok(iPay > 0 && iLLM > 0 && iPay < iLLM, '🔑 کسرِ اتمیک **قبل از** فراخوانیِ مدل است');
  ok(/const msgId = payForChat\(uid, rid, text\);/.test(h), 'و کسر واقعاً همان تراکنشِ اتمیک است، نه یک مقدارِ ثابت');
  ok(before(h, 'crisisIn(', 'payForChat(') && before(h, 'smallTalkIn(', 'payForChat('),
    'و گاردهای رایگان (بحران و تعارف) قبل از کسرند');
  ok(h.indexOf('chatInflight.has(') < iPay, 'گاردِ هم‌زمانی هم قبل از کسر است');
  ok(/if \(!msgId\) \{/.test(h) && h.indexOf('chat_paywall') > iPay, 'کم‌موجودی بعد از تلاشِ کسر تشخیص داده می‌شود (نه با خواندنِ موجودی)');
  ok(!/getBalance\(/.test(h), '⚠️ هیچ‌جا «توانِ پرداخت» جای «کسرِ واقعی» را نمی‌گیرد');

  // رفتاری: همان تراکنش‌ها روی SQLite واقعی.
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()));`);
  /* ⚠️ SQL از **خودِ سورس** خوانده می‌شود، نه اینکه این‌جا دوباره تایپ شود.
   * نسخه‌ی اولِ همین بلوک SQL را کپی کرده بود و در تستِ جهش **زنده ماند**: برداشتنِ
   * `AND refunded=0` از `index.js` هیچ چیزی را قرمز نکرد، چون چک آینه‌ی خودش را
   * می‌سنجید (همان تله‌ی ثبت‌شده‌ی check-lucky و check-announce). */
  const BT = String.fromCharCode(96);   // بک‌تیک، بدونِ درگیر کردنِ خودِ template literal
  const sqlOf = (name) => {
    const m = SRC.match(new RegExp(name + ":\\s*db\\.prepare\\((?:'([^']+)'|" + BT + '([\\s\\S]*?)' + BT + ')\\)'));
    return (m && (m[1] || m[2])) || null;
  };
  const NEEDED = ['credit', 'deduct', 'insertChatMsg', 'markChatRefunded'];
  ok(NEEDED.every(n => sqlOf(n)), 'هر چهار statementِ مسیرِ پول از سورس برداشته شدند');
  const st = Object.fromEntries(NEEDED.map(n => [n, d.prepare(sqlOf(n))]));
  ok(/AND refunded\s*=\s*0/.test(sqlOf('markChatRefunded')), 'ادعای ریفاند در خودِ SQL اتمیک است');
  ok(/balance >= \?/.test(sqlOf('deduct')), 'و کسر هم گاردِ موجودی را در خودِ SQL دارد');
  const CHAT_PRICE = num('CHAT_PRICE');
  ok(CHAT_PRICE === 1, `قیمتِ هر سؤال ${CHAT_PRICE} الماس است`);
  // خودِ تراکنش‌ها از سورس بریده می‌شوند (کپیِ منطق = همان تله‌ی check-lucky).
  const paySrc = (SRC.match(/const payForChat = db\.transaction\([\s\S]*?\n\}\);/) || [])[0];
  const refSrc = (SRC.match(/const refundChat = db\.transaction\([\s\S]*?\n\}\);/) || [])[0];
  ok(!!paySrc && !!refSrc, 'هر دو تراکنش از سورس برداشته شدند');
  const { payForChat, refundChat } = new Function('db', 'stmts', 'CHAT_PRICE',
    `${paySrc}\n${refSrc}\nreturn { payForChat, refundChat };`)(d, st, CHAT_PRICE);

  d.prepare('INSERT INTO users (telegram_id, balance) VALUES (5, 2)').run();
  const bal = () => d.prepare('SELECT balance b FROM users WHERE telegram_id=5').get().b;
  const m1 = payForChat(5, 10, 'سؤال اول');
  ok(m1 > 0 && bal() === 1, 'کسر و ثبتِ سؤال با هم انجام شدند');
  const m2 = payForChat(5, 10, 'سؤال دوم');
  ok(m2 > 0 && bal() === 0, 'سؤالِ دوم هم کسر شد');
  const m3 = payForChat(5, 10, 'سؤال سوم');
  ok(m3 === 0, 'با موجودیِ صفر کسر انجام نمی‌شود');
  ok(d.prepare('SELECT COUNT(*) c FROM chat_messages').get().c === 2,
    '🔑 و **هیچ ردیفی** ثبت نمی‌شود (تراکنش: یا هر دو یا هیچ‌کدام)');
  ok(bal() === 0, 'و موجودی منفی نمی‌شود');

  ok(refundChat(m1, 5, CHAT_PRICE) === true && bal() === 1, 'ریفاند پول را برمی‌گرداند');
  ok(refundChat(m1, 5, CHAT_PRICE) === false && bal() === 1,
    '🔑 ریفاندِ دوباره **بی‌اثر** است (ادعا قبل از واریز، ضدِ دوبار-برگشت)');
  ok(d.prepare('SELECT refunded r FROM chat_messages WHERE id=?').get(m1).r === 1, 'و ردیف مهرِ refunded می‌خورد');
  ok(d.prepare('SELECT text t FROM chat_messages WHERE id=?').get(m2).t === 'سؤال دوم', 'متنِ سؤال ذخیره می‌شود (پشتیبانی و آزمایشگاه)');

  // شکستِ مدل → ریفاندِ فوری، و ترتیبش در کد
  ok(before(h, 'if (!res?.out)', 'refundChat(msgId') && /if \(!res\?\.out\)/.test(h),
    'شکستِ کاملِ مدل بلافاصله ریفاند می‌شود (پول در حالتِ نامعلوم نمی‌ماند)');
  ok(/catch \(e\) \{[\s\S]*?refundChat\(msgId/.test(h), 'و هر استثنای دیگری هم ریفاند می‌گیرد، نه فقط شکستِ مدل');
  ok(before(h, "insertChatMsg.run(rid, uid, 'assistant'", 'await ctx.reply(reply'),
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

/* ═══ ۶) پیامِ ورود: بدونِ دکمه، بدونِ موجودی ══════════════════════════ */
console.log('\n▶ ۶) پیامِ ورود');
{
  const oc = bodyOf(CODE, 'async function openChat(');
  const reply = oc.slice(oc.lastIndexOf('await ctx.reply('));
  ok(!/inlineKeyboard/.test(reply), '🔑 استیتِ ورودی **هیچ دکمه‌ی inline ندارد** (بند ۹ب: استثنای مقدس)');
  ok(/parse_mode: 'Markdown'/.test(reply), 'و جمله‌ی آخرش بولد است (قرارداد ⬇️ + بولد)');
  const L = await import('../bots/tarot/locales/fa.js');
  const intro = L.default.chat.intro(1, L.default.coinUnit);
  ok(/⬇️/.test(intro) && /\*.+\*/.test(intro), 'متنِ ورود با ⬇️ و جمله‌ی بولد تمام می‌شود');
  ok(!/موجودی|ذخایر الماست:|balance/i.test(intro.replace(/از .*?ت کم/g, '')),
    '⚠️ موجودی نشان داده **نمی‌شود** (خواسته‌ی صریحِ مالک: کاربر نباید تشویق شود چند سؤال را یک‌جا بپرسد)');
  ok(!/—|--/.test(intro), 'و خط تیره‌ی بلند ندارد (بند ۱۰ ریشه)');
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

/* ═══ ۱۱) لنگرِ ریپلای (خواسته‌ی صریحِ مالک) ══════════════════════════ */
console.log('\n▶ ۱۱) ریپلای به بدنه‌ی فال');
{
  const fnSrc = bodyOf(SRC, 'function chatReplyExtra(reading) {');
  const chatReplyExtra = new Function(`${fnSrc}; return chatReplyExtra;`)();
  const withAnchor = chatReplyExtra({ anchor_msg_id: 555 });
  ok(withAnchor.reply_parameters?.message_id === 555, '🔑 پاسخ‌ها به پیامِ بدنه‌ی همان فال ریپلای می‌خورند');
  ok(withAnchor.reply_parameters?.allow_sending_without_reply === true,
    '⚠️ و اگر کاربر آن پیام را پاک کرده باشد ارسال **رد نمی‌شود** (وگرنه جوابِ پول‌داده گم می‌شد)');
  ok(Object.keys(chatReplyExtra({ anchor_msg_id: 0 })).length === 0, 'فالِ قدیمیِ بی‌لنگر بدونِ ریپلای کار می‌کند');
  ok(Object.keys(chatReplyExtra(null)).length === 0, 'و رکوردِ نال هم کرش نمی‌کند');
  /* 🔑 رفتاری، نه متنی: جهشِ `if (false) { ... setAnchorMsg ... }` از یک ادعای رجکسی
   * **زنده رد شد** — یعنی «کد نوشته شده» با «عدد رسید» یکی گرفته شده بود (بند ۲و/۶ب).
   * حالا خودِ بلوکِ ارسال از سورس بریده و با ctxِ قلابی اجرا می‌شود. */
  const blk = SRC.slice(SRC.indexOf('    let anchor = 0;'),
    SRC.indexOf("logErr('anchor:', e.message); } }") + 34);
  ok(blk.includes('setAnchorMsg'), 'بلوکِ ارسالِ متنِ نهایی از سورس برداشته شد');
  const runBlock = (headline) => {
    const saved = [];
    const ctx = { reply: async () => ({ message_id: 909 }) };
    const stmts2 = { setAnchorMsg: { run: (a, r) => saved.push([a, r]) } };
    const fn = new Function('ctx', 'stmts', 'headline', 'body', 'closing', 'readingId', 'sleep', 'PACE_M', 'replyLong', 'logErr',
      `return (async () => { ${blk} })();`);
    return fn(ctx, stmts2, headline, '', '', 77, async () => {}, 0, async () => {}, () => {}).then(() => saved);
  };
  ok((await runBlock('جوابت اینه')).some(([a, r]) => a === 909 && r === 77),
    '🔑 شناسه‌ی سرخط واقعاً روی همان رکورد **ثبت می‌شود** (نه فقط در کد نوشته شده)');
  ok((await runBlock('')).length === 0, 'و فالِ بدونِ سرخط لنگرِ جعلی نمی‌سازد');
  const fin = bodyOf(CODE, 'async function finishReading(');
  ok(before(fin, 'anchor = m?.message_id', 'setAnchorMsg'), 'شناسه از همان ارسالِ سرخط گرفته می‌شود');
  ok(/try \{ stmts\.setAnchorMsg\.run/.test(fin), 'و شکستش هرگز فالِ پول‌داده را نمی‌شکند');
  const hc = bodyOf(CODE, 'async function handleChatMessage(');
  ok(/await ctx\.reply\(reply, extra\)/.test(hc), 'جوابِ گفتگو با همان extra می‌رود');
}

/* ═══ ۱۲) پیامِ پیشنهاد و ترتیبِ دکمه‌ها ══════════════════════════════ */
console.log('\n▶ ۱۲) پیشنهادِ پس از فال');
{
  const po = bodyOf(CODE, 'async function postReadingOffer(');
  const order = [...po.matchAll(/L\.buttons\.(chatStart|chatAnotherReading|chatSkip)/g)].map(m => m[1]);
  ok(JSON.stringify(order) === JSON.stringify(['chatStart', 'chatAnotherReading', 'chatSkip']),
    '🔑 ترتیبِ دکمه‌ها: گفتگو، فالِ تازه، و درِ خروج آخر (بند ۱۰: ترتیب در خدمتِ حس)');
  ok(/if \(!chatOn\(uid\) \|\| !chatEligible\(uid, readingId\)\.ok\) return sendContinuePrompt/.test(po),
    '⚠️ و اگر گفتگو باز نباشد، رفتار بیت‌به‌بیت همان قبلی است');
  ok(/track\(db, uid, 'chat_offer_shown'/.test(po), 'مخرجِ نرخِ پذیرش ثبت می‌شود (بدونِ آن هیچ عددی معنی ندارد)');
  const skip = bodyOf(CODE, "bot.action('chat_skip', async (ctx) => {");
  ok(/return sendContinuePrompt\(ctx, ctx\.from\.id\)/.test(skip),
    'دکمه‌ی «پیشنهادهای من» **همان** تابعِ تک‌منبع را صدا می‌زند، نه یک کپیِ دوم');
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
  const hc = bodyOf(CODE, 'async function handleChatMessage(');
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
  ok(cmp(ver, '3.84.0') >= 0, `PRODUCT_VERSION بامپ شده (${ver}) — تغییرِ رفتاری، حتی فقط-ادمین`);
  const wipe = strip(SRC.slice(SRC.indexOf('function wipeUser('), SRC.indexOf('function wipeUser(') + 1800));
  ok(/chat_messages/.test(wipe), 'wipeUser جدولِ گفتگو را پاک می‌کند (ریستِ ادمین کامل است)');
  ok(/INTENT\.CHAT\]:\s*\(ctx, arg\) => openChat\(ctx, arg\)/.test(CODE),
    'نیتِ گفتگو با **شناسه‌ی فال** بازپخش می‌شود، نه روی فالِ صفر');
}

const total = pass + errs.length;
if (errs.length) {
  console.log(`\n❌ گفتگوی پس از فال: ${pass} پاس، ${errs.length} خطا`);
  for (const e of errs) console.log(`   - ${e}`);
  process.exit(1);
}
console.log(`\n✅ گفتگوی پس از فال: ${total} ادعا، ۰ خطا`);
