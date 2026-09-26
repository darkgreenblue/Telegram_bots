// چکِ CI برای صفحه‌ی «🏦 کارت‌های پرداخت» داشبورد (v3.123.0 — فازِ ۱cِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// چرا: از این صفحه مالک شماره‌ی کارتی را ثبت می‌کند که کاربران رویش پول واریز می‌کنند.
// خرابی‌هایی که این چک جلویشان را می‌گیرد، همه بی‌صدا:
//   ۱) داشبورد مستقیم روی `cards` بنویسد (منطقِ کارت دوتا شود و مالک خبر نگیرد).
//   ۲) رباتی که کارت ندارد (زبان‌های دیگر، voice2text) ردیفی بگیرد که sweepش نمی‌فهمد.
//   ۳) شکلی در صف بنشیند که خودِ ربات لحظه‌ی اجرا ردش کند (مثلاً بانکِ خالی به‌جای «-»)،
//      یعنی داشبورد بگوید «در صف قرار گرفت» و هیچ اتفاقی نیفتد.
//   ۴) ورودیِ نامعتبر (Luhn، تکراری، کارتِ آخر) تا صف برسد به‌جای خطای فوری.
// صفحه و اکشن روی یک دیتابیسِ فیکسچرِ واقعی **اجرا** می‌شوند (همان الگوی check-dash).
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import * as CA from '../bots/tarot/cards-admin.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const root = mkdtempSync(path.join(os.tmpdir(), 'cards-page-'));
const dataDir = path.join(root, 'tarot-data');
const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
{
  (await import('fs')).mkdirSync(dataDir, { recursive: true });
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
  `);
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('6219861904145405','علیرضا اولیا','بلوبانک',100257975,'regular',1)").run();
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('5022291612282234','علیرضا اولیاء','بانک پاسارگاد',100257975,'white',2)").run();
  db.prepare("INSERT INTO events (user_id, event, props) VALUES (100257975, 'card_changed', ?)").run(JSON.stringify({ card_id: 2, what: 'نوع ⟵ سفید', via: 'bot' }));
  db.close();
}
process.env.TAROT_DB_DIR = dataDir;
const cwd = process.cwd();
process.chdir(root);   // platform.db (audit) در پوشه‌ی موقت
const base = path.resolve(cwd, 'bots/dashboard');
const { cardsBody, cardsAction } = await import(`file://${base}/routes/cards.js`);
const { cardsPageSupported, adminActionSupported } = await import(`file://${base}/lib/bots.js`);

console.log('\n🏦 صفحه‌ی کارت‌های پرداخت (داشبورد)\n');

console.log('دامنه:');
ok(cardsPageSupported('tarot'), 'تاروتِ فارسی صفحه را دارد');
ok(!cardsPageSupported('tarot-intl') && adminActionSupported('tarot-intl', 'card_update'),
  'tarot-intl: sweep همان کد است (اعلام شده) ولی صفحه ندارد، چون ریلِ کارت ندارد');
ok(!cardsPageSupported('voice2text') && !adminActionSupported('voice2text', 'card_update'), 'voice2text هیچ‌کدام را ندارد');

console.log('\nرندر:');
const html = cardsBody(new URL('http://x/cards?bot=tarot'));
ok(/6219-8619-0414-5405/.test(html) && /5022-2916-1228-2234/.test(html), 'هر دو کارت با شماره‌ی چهارتا-چهارتا');
ok(/⏸ غیرفعال کن/.test(html) && /🔁 عادی کن/.test(html) && /افزودنِ کارت/.test(html), 'دکمه‌های اقدام و فرمِ افزودن');
ok(!/name="field"[^>]*>[\s\S]{0,400}value="number"/.test(html), 'شماره در گزینه‌های ویرایش نیست');
ok(!/حذف/.test(html.replace(/حذف و ویرایشِ شماره/g, '')), 'هیچ دکمه‌ی حذفی نیست');
ok(/نوع ⟵ سفید/.test(html), 'تاریخچه‌ی تغییرها از رویدادِ card_changed');
const intl = cardsBody(new URL('http://x/cards?bot=tarot-intl'));
ok(/کارتِ پرداخت ندارد/.test(intl) && !/افزودنِ کارت/.test(intl), 'رباتِ بی‌کارت فقط توضیح می‌بیند، نه فرم');

console.log('\nاکشن (صف، نه نوشتنِ مستقیم):');
const post = (o) => cardsAction(new URLSearchParams({ bot: 'tarot', ...o }));
const db = new Database(path.join(dataDir, 'bot-fa.db'));
const queued = () => db.prepare("SELECT * FROM admin_actions WHERE action='card_update' ORDER BY id").all();
const cardsNow = () => db.prepare('SELECT * FROM cards ORDER BY id').all();
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

ok(throws(() => post({ op: 'active', id: '1', value: '0' }), /آخرین کارتِ عادیِ فعال/) && queued().length === 0,
  'خاموش‌کردنِ آخرین کارتِ عادیِ فعال همین‌جا رد می‌شود و به صف نمی‌رسد');
ok(throws(() => post({ op: 'add', number: '6219861904145406', holder: 'x y', bank: '-', admin: '12345', kind: 'regular' }), /اشتباه/),
  'Luhn همین‌جا');
ok(throws(() => post({ op: 'add', number: '6219 8619 0414 5405', holder: 'x y', bank: '-', admin: '12345', kind: 'regular' }), /قبلاً ثبت شده/),
  'شماره‌ی تکراری همین‌جا');
ok(throws(() => post({ op: 'edit', id: '1', field: 'number', value: '5022291612282234' }), /ویرایش‌پذیر نیست/), 'ویرایشِ شماره رد می‌شود');
ok(throws(() => cardsAction(new URLSearchParams({ bot: 'tarot-intl', op: 'active', id: '2', value: '0' })), /اجرا نمی‌کند/),
  'POST به رباتِ بی‌کارت (تبِ کهنه) رد می‌شود، نه صف');
const safe = (fn) => { try { return String(fn()); } catch (e) { return `THROW ${e.message}`; } };
ok(/لازم نبود/.test(safe(() => post({ op: 'active', id: '1', value: '1' }))) && queued().length === 0, 'no-op چیزی صف نمی‌کند');

let valid = '603799759919901';
for (let d = 0; d < 10; d++) if (CA.luhnOk(valid + d)) { valid += d; break; }
const before = JSON.stringify(cardsNow());
post({ op: 'add', number: valid.replace(/(\d{4})(?=\d)/g, '$1-'), holder: 'زهرا احمدی', bank: '', admin: '۳۰۰۰۰۰۳', kind: 'regular' });
post({ op: 'edit', id: '2', field: 'bank', value: '-' });
post({ op: 'kind', id: '2', value: 'regular' });
const qs = queued();
ok(qs.length === 3, 'سه دستورِ معتبر در صف');
ok(JSON.stringify(cardsNow()) === before, 'داشبورد **هیچ** ردیفی از cards را مستقیم عوض نکرد');
const add = JSON.parse(qs[0].note);
ok(add.number === valid && add.bank === '-' && add.admin === '3000003', 'شکلِ نرمال‌شده صف شد (نه ورودیِ خام)');
ok(qs.every((q) => q.done_at === null && q.payment_id === 0), 'ردیف‌ها منتظرِ sweepِ ربات‌اند');
/* رفت‌وبرگشت: هر چیزی که داشبورد صف می‌کند باید از اعتبارسنجیِ **خودِ ربات** رد شود.
   بدونِ این، داشبورد «در صف قرار گرفت» می‌گفت و sweep بی‌صدا ردش می‌کرد (بانکِ خالی
   که `parseCardField` آن را کوتاه‌تر از ۲ حرف می‌داند). */
const cs = cardsNow();
ok(qs.every((q) => CA.planCardOp(JSON.parse(q.note), cs).ok), 'هر ردیفِ صف از اعتبارسنجیِ خودِ ربات هم رد می‌شود');
const html2 = cardsBody(new URL('http://x/cards?bot=tarot'));
ok(/در صفِ ربات \(۳\)/.test(html2), 'صفحه صفِ در انتظار را نشان می‌دهد');

console.log('\nساختاری:');
const src = readFileSync(path.resolve(cwd, 'bots/dashboard/routes/cards.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(!/(UPDATE|INSERT INTO|DELETE FROM)\s+cards\b/i.test(src), 'هیچ SQLِ نوشتنی روی cards در داشبورد نیست');
const g = src.indexOf('cardsPageSupported(bot)', src.indexOf('export function cardsAction'));
ok(g > 0 && g < src.indexOf('INSERT INTO admin_actions'), 'گاردِ توانِ ربات قبل از INSERT');
ok(/CA\.planCardOp\(/.test(src), 'اعتبارسنجی از همان تک‌منبعِ ربات (cards-admin.js)');
const nav = readFileSync(path.resolve(cwd, 'bots/dashboard/lib/nav.js'), 'utf8');
ok(/\['\/cards', /.test(nav), 'در منوی «اقدام‌ها» هست');

db.close();
process.chdir(cwd);
rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
