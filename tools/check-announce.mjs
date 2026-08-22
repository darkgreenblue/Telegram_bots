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
import { BODY, CTA, KEYBOARD, balanceLines, messageFor, planFor, groupOf, assertReady, ANNOUNCE_KEY } from './announce-tarot.mjs';

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

  ok(/موجودی ذخایر الماس: ۷ الماس/.test(a), 'نسخه‌ی A عددِ الماس را می‌گوید');
  // ⚠️ ارقام باید **فارسی** باشند، چون کلِ ربات با toLocaleString('fa-IR') عدد می‌دهد.
  // نسخه‌ی اول عددِ خام می‌گذاشت و کاربر «7 الماس» در پیام و «۷💎» داخلِ ربات می‌دید.
  ok(!/[0-9]/.test(a) && !/[0-9]/.test(b), 'هیچ رقمِ لاتینی در متنِ رو-به-کاربر نیست');
  ok(/موجودی ذخایر الماس: ۵ الماس/.test(b), 'نسخه‌ی B هم عددِ الماس را می‌گوید');
  // ⚠️ مهم‌ترین ادعای این فایل: کسی که موجودی ندارد **هیچ** خطی درباره‌ی الماس نبیند.
  ok(!/موجودی/.test(c), 'نسخه‌ی C هیچ خطی درباره‌ی موجودی ندارد');
  ok(!/الماس تبدیل/.test(c), 'و هیچ حرفی از تبدیل شدن نمی‌زند');

  ok(a.includes(BODY) && b.includes(BODY) && c.includes(BODY), 'بدنه در هر سه نسخه یکی است');
  ok(a.endsWith(CTA) && b.endsWith(CTA) && c.endsWith(CTA), 'و CTA همیشه آخرین خط است');
  // ترتیب: بدنه، بعد موجودی، بعد CTA (خواسته‌ی مالک در بند ۶).
  ok(a.indexOf('موجودی ذخایر') > a.indexOf('واحد جدید') && a.indexOf('موجودی ذخایر') < a.indexOf(CTA),
    'خطِ موجودی بینِ بدنه و CTA می‌نشیند');
  ok(b.split('\n').filter(Boolean).at(-2) === 'موجودی ذخایر الماس: ۵ الماس',
    'و خطِ «موجودی ذخایر» دقیقاً بعد از خطِ تبدیل می‌آید');
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
