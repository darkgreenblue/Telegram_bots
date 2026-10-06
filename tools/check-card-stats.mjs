// چکِ CI برای «📊 آمارِ روزانه‌ی کارت‌ها» در `/cards` (v3.129.0 — فازِ ۸ِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// خرابی‌های بی‌صدا که این‌جا گرفته می‌شوند:
//   • صدور/تعویض/خطا از `payments.card_id` شمرده شود: آن ستون بعد از تعویض و «پیامکش اومده» جابه‌جا
//     می‌شود، پس فاکتورِ کارتِ الف به کارتِ ب نسبت داده می‌شد. منبعِ درست رویدادهای ربات است.
//   • «تأییدشده» با شمارشِ سقفِ ربات فرق کند (مالک دو عدد برای یک چیز ببیند).
//   • «مبلغ» حسابِ تستی را درآمد بشمارد، یا روز با مرزِ غلط بریده شود (از v3.132.0 نیمه‌شبِ تهران، از `approved_at`).
// صفحه روی یک دیتابیسِ فیکسچرِ واقعی **رندر** و اعداد از HTML خوانده می‌شوند.
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import * as CA from '../bots/tarot/cards-admin.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const root = mkdtempSync(path.join(os.tmpdir(), 'card-stats-'));
const dataDir = path.join(root, 'tarot-data');
mkdirSync(dataDir, { recursive: true });
const Database = createRequire(path.resolve('bots/dashboard/package.json'))('better-sqlite3');
const TESTER = 409581917;
const now = Math.floor(Date.now() / 1000);
const TODAY = CA.cardDay(), YDAY = CA.cardDay(Date.now() - 86400_000);
const tNow = CA.cardDay((now - 5) * 1000) === TODAY ? now - 5 : now;
const tY = now - 86400;
{
  const db = new Database(path.join(dataDir, 'bot-fa.db'));
  db.exec(`
    CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL, holder TEXT NOT NULL,
      bank TEXT NOT NULL DEFAULT '', admin_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'regular',
      active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, daily_cap INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL, action TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'dashboard', created_at INTEGER NOT NULL DEFAULT (unixepoch()), done_at INTEGER,
      user_id INTEGER, amount INTEGER, ref_id INTEGER, note TEXT NOT NULL DEFAULT '');
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT NOT NULL,
      props TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, status TEXT,
      card_id INTEGER, approved_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  `);
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('0000000000425405','ع','بلوبانک',1,'regular',1)").run();
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('0000000000122234','ع','پاسارگاد',1,'white',2)").run();
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('6037997599199013','ب','ملی',2,'regular',3)").run();
  const ev = db.prepare('INSERT INTO events (user_id, event, props, created_at) VALUES (?,?,?,?)');
  // امروز: کارتِ ۱ سه فاکتور، ۳ یک فاکتور؛ یک تعویض ۱⟵۳؛ یک خطای انتقال ۱⟵۲. دیروز: کارتِ ۳ دو فاکتور.
  for (let i = 0; i < 3; i++) ev.run(5, 'card_assigned', JSON.stringify({ payment_id: 10 + i, card_id: 1 }), tNow);
  ev.run(6, 'card_assigned', JSON.stringify({ payment_id: 20, card_id: 3 }), tNow);
  ev.run(5, 'card_switched', JSON.stringify({ payment_id: 10, from: 1, to: 3 }), tNow);
  ev.run(5, 'transfer_error_switch', JSON.stringify({ payment_id: 11, from: 1, to: 2 }), tNow);
  ev.run(7, 'card_assigned', JSON.stringify({ payment_id: 30, card_id: 3 }), tY);
  ev.run(7, 'card_assigned', JSON.stringify({ payment_id: 31, card_id: 3 }), tY);
  ev.run(7, 'card_assigned', JSON.stringify({ payment_id: 99, card_id: 1 }), now - 40 * 86400);   // بیرون از ماه
  // ۲۳:۰۰ تهرانِ دیروز ⟵ روزِ کارتِ **دیروز**. بدونِ این ردیف، بریدنِ روز با مرزِ غلط هیچ ادعایی را قرمز نمی‌کرد.
  ev.run(7, 'card_assigned', JSON.stringify({ payment_id: 32, card_id: 3 }), Math.floor(Date.parse(`${TODAY}T00:00:00+03:30`) / 1000) - 3600);
  const pay = db.prepare('INSERT INTO payments (user_id, amount, status, card_id, approved_at) VALUES (?,?,?,?,?)');
  // پرداختِ ۱۱ حالا card_id=2 دارد (خطای انتقال جابه‌جایش کرد) ولی صدورش مالِ کارتِ ۱ است.
  pay.run(5, 60000, 'approved', 1, tNow);
  pay.run(TESTER, 30000, 'approved', 1, tNow);      // حسابِ تستی: در شمارشِ سقف هست، در مبلغ نه
  pay.run(6, 150000, 'approved', 3, tY);
  pay.run(8, 90000, 'rejected', 1, null);
  pay.run(5, 60000, 'pending', 2, null);            // همان پرداختِ ۱۱ِ جابه‌جاشده (card_id حالا سفید)
  db.close();
}
process.env.TAROT_DB_DIR = dataDir;
const cwd = process.cwd();
process.chdir(root);
const base = path.resolve(cwd, 'bots/dashboard');
try {
  const { cardsBody, cardDays } = await import(`file://${base}/routes/cards.js`);
  console.log('\n📊 آمارِ روزانه‌ی کارت‌ها\n');

  const d7 = cardDays(7);
  ok(d7.length === 7 && d7[0] === TODAY && d7[1] === YDAY && new Set(d7).size === 7, 'cardDays: هفت روزِ کارتِ یکتا، امروز اول');
  ok(cardDays(1).length === 1 && cardDays(1)[0] === TODAY, 'بازه‌ی روزانه = فقط روزِ کارتِ امروز');
  // مرزِ نیمه‌شب (v3.132.0): ۲۳:۵۹ تهران مالِ همان روز است و ۰۰:۰۱ روزِ تازه.
  const at2359 = Date.parse('2026-09-25T23:59:00+03:30'), at0001 = Date.parse('2026-09-26T00:01:00+03:30');
  ok(cardDays(1, at2359)[0] === '2026-09-25' && cardDays(1, at0001)[0] === '2026-09-26', 'مرزِ روز ۰۰:۰۰ تهران است');

  const cell = (html, cardLabel) => {
    const tb = html.slice(html.indexOf('📊 آمارِ روزانه‌ی کارت‌ها'));
    const row = tb.split('<tr>').find((r) => r.includes(cardLabel)) || '';
    return [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  };
  const week = cardsBody(new URL('http://x/cards?bot=tarot'));
  ok(week.indexOf('📊 آمارِ روزانه‌ی کارت‌ها') > 0 && week.indexOf('📊 آمارِ روزانه‌ی کارت‌ها') < week.indexOf('📋 کارت‌ها'),
    'کارتِ آمار بالای فهرستِ کارت‌ها رندر شد');
  const c1 = cell(week, '#1 💳'), c3 = cell(week, '#3 💳');
  // ستون‌ها: [کارت، صادرشده، فاکتور از تعویض، تعویض به کارتِ دیگر، خطای انتقال، تأییدشده، مبلغ]
  ok(c1[1] === '۳' && c1[2] === '۰' && c1[3] === '۱' && c1[4] === '۱', `کارتِ ۱ (هفته): ۳ صدور، ۱ تعویض، ۱ خطای انتقال — ${JSON.stringify(c1)}`);
  ok(c1[5] === '۲', 'تأییدشده = شمارشِ سقفِ ربات (حسابِ تستی هم)');
  ok(/۶۰٬۰۰۰/.test(c1[6]) && !/۹۰٬۰۰۰/.test(c1[6]), `مبلغ بدونِ حسابِ تستی: ${c1[6]}`);
  ok(c3[1] === '۴' && c3[5] === '۱' && /۱۵۰٬۰۰۰/.test(c3[6]), `کارتِ ۳ (هفته): امروز + دیروز — ${JSON.stringify(c3)}`);
  ok(c3[2] === '۱' && cell(week, '#2 🤍')[2] === '۱' && cell(week, '#2 🤍')[1] === '۰',
    'فاکتور از تعویض: تعویضِ ۱⟵۳ برای کارتِ ۳ و خطای انتقالِ ۱⟵۲ برای کارتِ سفید؛ «صادرشده» دست‌نخورده (فاکتورِ یکتا)');
  ok(cell(week, '#2 🤍').length === 0 || cell(week, '#2 🤍')[1] === '۰',
    'کارتِ سفید با وجودِ card_id=2 روی پرداختِ جابه‌جاشده، صدوری نگرفته (منبع رویداد است نه ستون)');
  ok(/تفکیکِ روزبه‌روز/.test(week) && week.includes(`>${YDAY}<`), 'تفکیکِ روزبه‌روز با روزِ دیروز');

  const day = cardsBody(new URL('http://x/cards?bot=tarot&rCard=day'));
  const d3 = cell(day, '#3 💳');
  ok(d3[1] === '۱' && d3[5] === '۰', `بازه‌ی روزانه: فقط امروز (رویدادِ ۲۳:۰۰ِ دیشب مالِ دیروز است) — ${JSON.stringify(d3)}`);
  const month = cardsBody(new URL('http://x/cards?bot=tarot&rCard=month'));
  ok(cell(month, '#1 💳')[1] === '۳', 'رویدادِ ۴۰ روز پیش بیرون از بازه‌ی ماهانه');
  const bad = cardsBody(new URL('http://x/cards?bot=tarot&rCard=all%27--'));
  ok(cell(bad, '#1 💳')[1] === '۳' && /class="pill on"[^>]*>هفتگی/.test(bad.replace(/href="[^"]*"/g, '')), 'بازه‌ی ناشناخته/خصمانه ⟵ هفتگی (whitelist)');
  ok(/rCard=day/.test(week) && /rCard=month/.test(week) && !/rCard=all/.test(week), 'انتخابگرِ بازه‌ی خودِ کارت (rangePicker)، بدونِ «کل»');
} catch (e) { fail++; console.error('  ❌', e.stack); }
process.chdir(cwd);
rmSync(root, { recursive: true, force: true });

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
