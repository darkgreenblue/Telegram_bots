#!/usr/bin/env node
// 📊 چکِ داشبوردِ اصلی (BI) — سه قراردادی که اگر بشکنند، صفحه هنوز رندر می‌شود ولی **دروغ می‌گوید**.
//
// ۱) **عدد و لیستِ کاربرانِ پشتِ عدد یکی‌اند.** قراردادِ آهنینِ داشبورد این است که هر عددِ
//    کاربرمحور با یک کلیک لیستِ همان آدم‌ها را باز کند. اگر شرطِ عدد و شرطِ لیست از هم
//    واگرا شوند، هیچ خطایی رخ نمی‌دهد — فقط مالک روی عددی تصمیم می‌گیرد که لیستش
//    چیزِ دیگری است. این‌جا هر دو روی یک دیتابیسِ **واقعی** اجرا و مقایسه می‌شوند.
// ۲) **حذفِ ادمین.** تستِ خودِ مالک نباید ماندگاری و رضایت را باد کند.
// ۳) **مقاومتِ ورودیِ مخرب.** هیچ رشته‌ای از URL نباید به SQL برسد.
//
// اجرا: node tools/check-dash.mjs   (بدون شبکه؛ فیکسچرِ SQLite در یک پوشه‌ی موقت)
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

/* ── فیکسچر: کاربران با الگوهای درگیریِ مشخص و **جوابِ دستیِ معلوم** ── */
const root = mkdtempSync(path.join(tmpdir(), 'dashcheck-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const now = Math.floor(Date.now() / 1000);
const D = 86400;
{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
      balance INTEGER DEFAULT 0, daily_streak INTEGER DEFAULT 0, first_source TEXT DEFAULT '',
      first_payload TEXT DEFAULT '', first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
    CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, price INTEGER,
      focus_area TEXT DEFAULT '', feedback TEXT DEFAULT '', status TEXT DEFAULT 'pending_payment', created_at INTEGER);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending', step TEXT, original_amount INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
    CREATE TABLE referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER, referee_id INTEGER UNIQUE, rewarded INTEGER DEFAULT 0, created_at INTEGER);
    CREATE TABLE llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER DEFAULT 0, kind TEXT DEFAULT '',
      ref_id INTEGER DEFAULT 0, model TEXT DEFAULT '', prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, ms INTEGER DEFAULT 0, created_at INTEGER);
  `);
  const u = db.prepare('INSERT INTO users (telegram_id,name,created_at,last_seen) VALUES (?,?,?,?)');
  const r = db.prepare("INSERT INTO readings (user_id,type,price,feedback,status,created_at) VALUES (?,?,?,?,'delivered',?)");
  const e = db.prepare('INSERT INTO events (user_id,event,props,created_at) VALUES (?,?,?,?)');

  // ۱ فعالِ تمام‌عیار: اولین فال ۱۰ روز پیش، سه روزِ متفاوت، آخری دیروز.
  //
  // ⚠️ آخری عمداً ۲۳ ساعت پیش است نه دقیقاً ۲۴ ساعت. پنجره‌ی فعالیت
  // `MAX(created_at) >= now - windowDays*86400` است و `now` دو بار خوانده می‌شود:
  // یک‌بار اینجا موقعِ ساختنِ فیکسچر و یک‌بار داخلِ کوئری. با `now - 1*D` آخرین فال
  // دقیقاً **روی مرز** می‌نشست، پس اگر ثانیه‌ی ساعت بینِ این دو خواندن یک واحد جلو
  // می‌رفت کاربر از پنجره بیرون می‌افتاد و چک تصادفی قرمز می‌شد (یک‌بار در CI
  // همین شد). خودِ منطقِ سنجه سالم است؛ این فقط فیکسچر را از لبه دور می‌کند.
  u.run(1, 'فعال', now - 20 * D, now);
  for (const d of [10, 5, 1]) r.run(1, 'love3', 3, 'rate:5', now - d * D + (d === 1 ? 3600 : 0));
  // ۲ تازه‌وارد: اولین فالش امروز (شرطِ «۳ روز» را ندارد) — نباید فعال شمرده شود
  u.run(2, 'تازه', now - 2 * D, now);
  r.run(2, 'love3', 3, '', now - 60);
  r.run(2, 'love5', 5, '', now - 30);
  // ۳ تک‌روزه: پنج فال، همه در یک روزِ قدیمی — نه فعال است نه برگشتی
  u.run(3, 'تک‌روزه', now - 30 * D, now);
  for (let i = 0; i < 5; i++) r.run(3, 'love3', 3, 'rate:2', now - 20 * D + i * 600);
  // ۴ خفته: دو روزِ متفاوت ولی آخرین فالش ۲۰ روز پیش — از پنجره‌ی ۷ روز بیرون است
  u.run(4, 'خفته', now - 40 * D, now);
  r.run(4, 'love3', 3, 'rate:4', now - 30 * D);
  r.run(4, 'love3', 3, 'rate:5', now - 20 * D);
  // ۵ فقط کارتِ روز (رایگان): هیچ فالِ کاملی ندارد
  u.run(5, 'رایگان', now - 30 * D, now);
  r.run(5, 'daily', 0, '', now - D);
  // ۶ ادمین: پرمصرف‌ترین، ولی باید از **همه‌ی** سنجه‌ها حذف شود
  u.run(6, 'ادمین', now - 50 * D, now);
  e.run(6, 'view', '{"k":"menu","adm":1}', now - D);
  for (const d of [30, 20, 10, 2]) r.run(6, 'love10', 10, 'rate:5', now - d * D);

  db.prepare('INSERT INTO referrals (referrer_id,referee_id,rewarded,created_at) VALUES (?,?,1,?)').run(1, 2, now);
  db.prepare('INSERT INTO referrals (referrer_id,referee_id,rewarded,created_at) VALUES (?,?,1,?)').run(1, 3, now);
  db.prepare('INSERT INTO referrals (referrer_id,referee_id,rewarded,created_at) VALUES (?,?,0,?)').run(4, 5, now);
  db.prepare('INSERT INTO llm_usage (kind,model,cost_usd,created_at) VALUES (?,?,?,?)').run('reading', 'x', 0.5, now - D);
  /* 💳 یک پرداختِ **قدیمی** (۶۰ روز پیش). این ردیف صرفاً «دیتای بیشتر» نیست؛ بدونش
     عمرِ ربات کوتاه‌تر از یک ماه می‌ماند و آن‌وقت «ماهانه» و «کل عمر» **عددِ یکسانی**
     می‌دهند — یعنی ادعای «نمای کلی و اقتصاد یک عددند» حتی وقتی نمای کلی بازه‌ی غلطی
     را صدا بزند سبز می‌ماند. (این دقیقاً با جهش اثبات شد: تغییرِ `'all'` به `'month'`
     در `dash.js` قبل از افزودنِ این ردیف قرمز نمی‌داد.) */
  db.prepare("INSERT INTO payments (user_id,amount,status,step,created_at) VALUES (?,?,'approved','receipt',?)")
    .run(1, 300_000, now - 60 * D);
  db.close();
}

process.env.TAROT_DB_DIR = dataDir;
process.chdir(root);                       // platform.db داشبورد در پوشه‌ی موقت ساخته شود
const base = path.resolve(import.meta.dirname, '../bots/dashboard');
/* 💵 نرخِ دلار **قبل از** لودِ صفحه‌ها ست می‌شود، و این یک جزئیاتِ فیکسچر نیست:
   بدونِ نرخ، `economicsBody` کارتِ سود را اصلاً رندر نمی‌کند و `dashBody` هم سرخطِ
   سود را. یعنی هر ادعایی درباره‌ی سود روی یک صفحه‌ی نیم‌رندرشده سبز می‌ماند بدونِ
   اینکه چیزی سنجیده باشد. (دقیقاً همین اتفاق افتاد: یک جهشِ واقعی — افزودنِ انتخابگرِ
   بازه‌ی دوم به کارتِ سود — سبز رد شد، چون آن کارت اصلاً رندر نمی‌شد.) */
const RATE = 100_000;
const { setSetting } = await import(`file://${base}/lib/platform.js`);
setSetting('usd_toman', String(RATE));
const { dashBody } = await import(`file://${base}/routes/dash.js`);
/* بعد از بازطراحیِ ساختار (۱۴۰۵/۰۶/۰۹) هر عدد سرِ صفحه‌ی خودش رفت: دعوت به «جذب» و
   هزینه‌ی مدل به «اقتصاد». ادعاها همان‌اند، فقط روی صفحه‌ی درست سنجیده می‌شوند. */
const { acquisitionBody } = await import(`file://${base}/routes/acquisition.js`);
const { economicsBody } = await import(`file://${base}/routes/economics.js`);
const { resolveCohort } = await import(`file://${base}/lib/cohorts.js`);
const { instancesOf } = await import(`file://${base}/lib/bots.js`);

ok(instancesOf('tarot').length === 1, 'فیکسچرِ تاروت دیده شد');

const U = (q) => new URL(`http://x/dash?${q}`);
const html = dashBody(U('bot=tarot&range=all&aw=7'));
const acqHtml = acquisitionBody(U('bot=tarot'));
const econHtml = economicsBody(U('bot=tarot&rEcon=all'));
const fa = (n) => Number(n).toLocaleString('fa-IR');

console.log('▶ ۱) اعدادِ کلیدی همان چیزی‌اند که با دست حساب می‌شود');
{
  // ۵ کاربر + ادمین = ۶ ردیفِ users (شمارشِ کاربر عمداً ادمین را هم دارد: «هرکس وارد شده»)
  ok(html.includes(`<div class="k">کل کاربران فعال‌شده</div><div class="v">`), 'کارتِ کل کاربران هست');
  // فالِ کامل بدونِ ادمین: 3 (کاربر۱) + 2 (کاربر۲) + 5 (کاربر۳) + 2 (کاربر۴) = ۱۲ ؛ کارتِ روز و ادمین بیرون
  ok(html.includes(`<div class="k">کل فال‌های کامل</div><div class="v">${fa(12)}</div>`),
    'کل فال‌های کامل = ۱۲ (کارتِ روزِ رایگان و ۴ فالِ ادمین شمرده نشدند)');
}

console.log('\n▶ ۲) «کاربر فعال» هر سه شرط را با هم اعمال می‌کند');
{
  const c = resolveCohort(U('k=tarot&bot=tarot&t=active&aw=7'));
  const ids = c.users.map(x => x.uid).sort();
  ok(JSON.stringify(ids) === '[1]',
    `فقط کاربرِ ۱ فعال است (دیده شد: ${ids.join(',') || 'هیچ'}) — تازه‌وارد، تک‌روزه، خفته و ادمین همه بیرون‌اند`);
  const wide = resolveCohort(U('k=tarot&bot=tarot&t=active&aw=7')).users.length;
  ok(wide === 1, 'پنجره‌ی ۷ روزه همان یک نفر را می‌دهد');
  // با پنجره‌ی یک‌روزه کسی که دیروز فال گرفته هنوز داخل است
  ok(resolveCohort(U('k=tarot&bot=tarot&t=active&aw=1')).users.length === 1, 'پنجره‌ی ۱ روزه هم کاربرِ دیروز را نگه می‌دارد');
}

console.log('\n▶ ۳) عدد و لیستِ کاربرانش هرگز از هم نمی‌پاشند');
{
  // برای هر سنجه، عددی که روی صفحه چاپ شده باید دقیقاً برابر طولِ لیستِ کوهورتش باشد.
  const CASES = [
    ['readers', 'کاربران فال‌گرفته (حداقل ۱ فال)'],
    ['repeat', 'برگشتی (در ۲ روزِ متفاوت فال گرفته)'],
    ['satisfied', 'کاربران راضی'],
    ['raters', 'کاربرانی که نمره داده‌اند'],
    ['referrer', 'کاربران دعوت‌کننده‌ی موفق'],
  ];
  // عدد از خودِ HTML بیرون کشیده می‌شود (همان چیزی که مالک می‌بیند). عددِ کاربرمحور داخلِ
  // <details class="cohort"> می‌نشیند، پس اولین رشته‌ی رقمِ فارسی بعد از برچسب برداشته می‌شود.
  const shownFor = (label, page = html) => {
    const marker = `<div class="k">${label}</div>`;
    const at = page.indexOf(marker);
    if (at < 0) return -1;
    const m = /[\u06F0-\u06F9\u066C]+/.exec(page.slice(at + marker.length, at + marker.length + 400));
    return m ? Number(m[0].replace(/\u066C/g, '').replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))) : -1;
  };
  for (const [t, label] of CASES) {
    const list = resolveCohort(U(`k=tarot&bot=tarot&t=${t}`)).users.length;
    const page = t === 'referrer' ? acqHtml : html;
    const shown = shownFor(label, page);
    ok(shown === list, `«${label}»: عددِ صفحه ${shown} = تعدادِ لیست ${list}`);
  }
  for (const i of [0, 1, 2, 3, 4, 5]) {
    const n = resolveCohort(U(`k=tarot&bot=tarot&t=bucket&i=${i}`)).users.length;
    ok(Number.isInteger(n), `سطلِ ${i} لیستِ معتبر می‌دهد (${n} نفر)`);
  }
  // سطل‌ها باید کلِ فال‌گرفته‌ها را دقیقاً یک‌بار بپوشانند (نه دوباره‌شماری، نه جاافتادن)
  const readers = resolveCohort(U('k=tarot&bot=tarot&t=readers')).users.length;
  const sum = [0, 1, 2, 3, 4, 5].reduce((a, i) => a + resolveCohort(U(`k=tarot&bot=tarot&t=bucket&i=${i}`)).users.length, 0);
  ok(sum === readers, `مجموعِ سطل‌ها (${sum}) = کلِ فال‌گرفته‌ها (${readers}) — بدونِ همپوشانی و بدونِ جاافتادگی`);
}

console.log('\n▶ ۴) ادمین از سنجه‌های محصولی حذف است');
{
  for (const t of ['readers', 'repeat', 'satisfied', 'raters', 'active']) {
    const has = resolveCohort(U(`k=tarot&bot=tarot&t=${t}`)).users.some(x => Number(x.uid) === 6);
    ok(!has, `کاربرِ ادمین در «${t}» نیست`);
  }
  ok(!html.includes('rate:5'), 'هیچ مقدارِ خامِ بازخورد به HTML نشت نمی‌کند');
}

console.log('\n▶ ۵) رضایت: فقط نمره‌ی عددی، و «راضی» یعنی میانگین بالای ۴');
{
  const sat = resolveCohort(U('k=tarot&bot=tarot&t=satisfied')).users.map(x => Number(x.uid)).sort();
  // کاربر۱ (۵) راضی · کاربر۳ (۲) نه · کاربر۴ (۴ و ۵ → میانگین ۴.۵) راضی · ادمین حذف
  ok(JSON.stringify(sat) === '[1,4]', `کاربرانِ راضی = ۱ و ۴ (دیده شد: ${sat.join(',')})`);
  const raters = resolveCohort(U('k=tarot&bot=tarot&t=raters')).users.map(x => Number(x.uid)).sort();
  ok(JSON.stringify(raters) === '[1,3,4]', `نمره‌دهنده‌ها = ۱، ۳، ۴ (دیده شد: ${raters.join(',')})`);
}

console.log('\n▶ ۶) دعوتِ موفق فقط ردیفِ پاداش‌داده‌شده است');
{
  const refs = resolveCohort(U('k=tarot&bot=tarot&t=referrer')).users.map(x => Number(x.uid));
  ok(JSON.stringify(refs) === '[1]', `فقط کاربرِ ۱ دعوت‌کننده‌ی موفق است (دیده شد: ${refs.join(',')})`);
  ok(acqHtml.includes('<div class="k">بیشترین دعوت توسط یک کاربر</div><div class="v">' + fa(2) + '</div>'),
    'بیشترین دعوت توسط یک کاربر = ۲ (صفحه‌ی جذب)');
}

console.log('\n▶ ۷) ورودیِ مخرب به SQL نمی‌رسد');
{
  const bad = [
    "k=tarot&bot=tarot&t=' OR 1=1--",
    'k=tarot&bot=tarot&t=bucket&i=99',
    "k=tarot&bot=tarot&t=ret&d=1);DROP TABLE users;--",
    'k=tarot&bot=tarot&t=active&aw=-5',
  ];
  for (const q of bad) {
    let r;
    try { r = resolveCohort(U(q)); } catch (e) { r = { threw: e.message }; }
    ok(!r.threw, `«${q.slice(0, 44)}…» بدونِ کرش هندل شد`);
  }
  const db = new Database(file, { readonly: true });
  ok(db.prepare('SELECT COUNT(*) c FROM users').get().c === 6, 'جدولِ users بعد از ورودی‌های مخرب سالم است');
  db.close();
}

console.log('\n▶ ۸) هزینه‌ی مدل از جدولِ llm_usage خوانده می‌شود');
{
  ok(/\$0\.50/.test(econHtml), 'هزینه‌ی ثبت‌شده ($0.50) در صفحه‌ی اقتصاد هست');
  ok(econHtml.includes('فراخوانیِ ثبت‌شده'), 'تعدادِ فراخوانی هم گزارش می‌شود');

  /* 🧾 و از ۱۴۰۵/۰۶/۱۵: **تفکیکِ کاملِ هزینه** روی همان صفحه.
     ایرادِ مالک این بود که هزینه‌ی تبلیغ اصلاً در صفحه‌ی اقتصاد نبود و باید از صفحه‌ی
     «جذب» برداشته و دستی جمع زده می‌شد — و آن عدد هم CPA بود نه هزینه‌ی تبلیغ، پس
     جمعِ دستی همیشه غلط درمی‌آمد. */
  ok(/هزینه‌ها به تفکیک/.test(econHtml), 'کارتِ تفکیکِ هزینه‌ها وجود دارد');
  ok(/هزینه‌ی تبلیغ/.test(econHtml), 'و هزینه‌ی تبلیغ هم همان‌جاست، نه فقط در صفحه‌ی جذب');
  ok(/جمعِ هزینه/.test(econHtml), 'و جمعِ نهایی را خودش می‌زند (کاربر دستی جمع نزند)');
  ok(/CPA/.test(econHtml) && /دو بار شمردن/.test(econHtml),
    'و صریح هشدار می‌دهد که عددِ صفحه‌ی جذب CPA است، نه هزینه‌ی تبلیغ');

  /* 🚫 ادعای معکوس: صفحه نباید دو انتخابگرِ بازه داشته باشد. سه انتخابگرِ مستقل روی
     یک محاسبه دقیقاً چیزی بود که سه عددِ متناقض ساخت. */
  /* ⚠️ الگو عمداً `r` + حرفِ **بزرگ** است (rEcon، rProfit). نسخه‌ی اولش `r[A-Za-z]+`
     بود و فیلدِ ورودیِ `name="rate"` را «انتخابگرِ بازه» می‌دید — یعنی ادعا سبز بود
     ولی اصلاً چیزی را که ادعا می‌کرد نمی‌سنجید. */
  /* ⚠️ `rangePicker` لینک تولید می‌کند نه `<select name=…>`، پس پارامترِ بازه باید از
     **کوئریِ همان لینک‌ها** خوانده شود. نسخه‌ی اولِ این ادعا دنبالِ `name="r…"` گشت،
     چیزی پیدا نکرد، و «هیچ» را هم قبول می‌کرد — یعنی سبز بود بدونِ اینکه چیزی بسنجد.
     حالا اگر انتخابگر اصلاً نباشد هم قرمز می‌شود. */
  const pickers = new Set([...econHtml.matchAll(/[?&;](r[A-Z][A-Za-z]*)=/g)].map(m => m[1]));
  ok(pickers.size === 1 && pickers.has('rEcon'),
    `صفحه‌ی اقتصاد دقیقاً یک انتخابگرِ بازه دارد و آن rEcon است (دیده شد: ${[...pickers].join(', ') || 'هیچ'})`);
  ok(!/<h1>/.test(econHtml), 'و هیچ صفحه‌ی دومی داخلش embed نشده (h1 تودرتو)');
}

console.log('\n▶ ۸ب) نمای کلی و صفحه‌ی اقتصاد **یک** عدد می‌گویند');
{
  /* 🐛 ایرادِ صریحِ مالک (۱۴۰۵/۰۶/۱۵): «توی نمای کلی یک عدد می‌بینم، توی اقتصاد یک
     عددِ دیگه». این ادعا هر دو صفحه را واقعاً رندر می‌کند و عددِ سودشان را از HTML
     بیرون می‌کشد — نه از فراخوانیِ مستقیمِ تابع، چون خطا در همان لایه‌ی صفحه بود
     (دو تابعِ متفاوت با دو بازه‌ی متفاوت)، نه در محاسبه. */
  const grab = (h, re) => (h.match(re) || [])[1] || '';
  const dashNet = grab(html, /سودِ خالص<\/div>\s*<div class="v">(?:<span[^>]*>)?([^<]+)/);
  const econNet = grab(econHtml, /<div class="k">سودِ خالص<\/div><div class="v"><b[^>]*>([^<]+)/);
  ok(!!dashNet, `سودِ خالص در نمای کلی رندر شد (${dashNet.trim()})`);
  ok(!!econNet, `سودِ خالص در صفحه‌ی اقتصاد رندر شد (${econNet.trim()})`);
  ok(dashNet.trim() === econNet.trim(),
    `و هر دو **دقیقاً** یک عددند («${dashNet.trim()}» در برابر «${econNet.trim()}»)`);
  ok(!/شروعِ ثبتِ هزینه/.test(html),
    'نمای کلی دیگر «از شروعِ ثبتِ هزینه» را زیرِ عدد نمی‌نویسد');
  ok(/کلِ عمر/.test(html), 'و به‌جایش می‌گوید این عدد کلِ عمر است');
}

console.log('\n▶ ۹) رباتِ بدونِ داشبوردِ اصلی، پیامِ صادقانه می‌دهد (نه عددِ ساختگی)');
{
  const other = dashBody(U('bot=voice2text'));
  ok(/فقط برای/.test(other) && !/کاربر فعال<\/div>/.test(other), 'برای ربات دیگر عددی ساخته نمی‌شود');
}

/* ══ عددِ سود در «نمای کلی» و «اقتصاد» یکی است — روی **HTMLِ رندرشده** ═════════
 *
 * 🐛 ایرادِ مرکزیِ مالک (۱۴۰۵/۰۶/۱۵): «توی نمای کلی یک عدد می‌بینم، توی اقتصاد و
 * هزینه یک عددِ دیگر. من به خدا گیج شده‌ام.»
 *
 * ⚠️ `check-profit` این را با یک رجکس روی **سورسِ** `dash.js` می‌سنجد
 * (`profitFor(bot, 'all')` صدا زده می‌شود یا نه). آن لازم است ولی کافی نیست: یک گاردِ
 * آینه‌ای است و فقط می‌گوید «همان تابع صدا زده شد»، نه «همان عدد روی صفحه نشست».
 * بینِ آن فراخوانی و چیزی که کاربر می‌بیند هنوز جا برای واگرایی هست — یک گردکردنِ
 * متفاوت، یک فرمت‌کننده‌ی دیگر، یا یک ضربِ سهویِ نرخ. و دقیقاً همان جا بود که مالک
 * تناقض را دید، نه در سورس. (بند ۶ب ریشه: گاردِ آینه‌ای همیشه گاردِ ساختاری هم لازم
 * دارد.) پس این‌جا **هر دو صفحه رندر می‌شوند** و عددِ سود از HTML بیرون کشیده و
 * مقایسه می‌شود. */
console.log('\n▶ عددِ سود در هر دو صفحه، از روی HTML');
{
  /* ⚠️ `toLocaleString('fa-IR')` منفی را با U+200E و **U+2212** می‌سازد، نه خطِ تیره‌ی
     اسکیِ. نسخه‌ی اولِ همین تابع `[^\d-]` را پاک می‌کرد و U+2212 هم با آن می‌رفت، پس
     «−۴۴۹٬۹۷۶» به **۴۴۹۹۷۶ مثبت** تبدیل می‌شد. برای یک ادعای برابری این کشنده است:
     دو صفحه با علامتِ مخالف هم برابر گزارش می‌شدند. */
  const fa = (x) => Number(String(x).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[\u2212\u2013\u2014]/g, '-').replace(/[^\d-]/g, ''));
  const dashHtml = dashBody(U('bot=tarot&range=all&aw=7'));
  const econHtml = economicsBody(new URL('http://x/economics?bot=tarot&rEcon=all'));

  /* سرخطِ نمای کلی: عنوانِ «سودِ خالص» و بعدش اولین عددِ فارسی. */
  const grab = (html, from) => {
    const at = html.indexOf(from);
    if (at < 0) return null;
    const m = html.slice(at, at + 600).match(/[-\u2212]?\s*[۰-۹][۰-۹٬,]*/);
    return m ? fa(m[0]) : null;
  };
  const heroNet = grab(dashHtml, 'سودِ خالص');
  const cardNet = grab(dashHtml.slice(dashHtml.indexOf('هزینه و سود')), 'سودِ خالص');
  const econNet = grab(econHtml, 'سودِ خالص');

  ok(heroNet !== null, `سرخطِ «سودِ خالص» در نمای کلی رندر شد (${heroNet})`);
  ok(econNet !== null, `کارتِ «سودِ خالص» در صفحه‌ی اقتصاد رندر شد (${econNet})`);
  ok(heroNet === econNet,
    `سرخطِ نمای کلی و صفحه‌ی اقتصاد **عددِ یکسان** می‌دهند (${heroNet} = ${econNet})`);
  ok(cardNet === econNet,
    `کارتِ «هزینه و سود»ِ نمای کلی هم همان عدد است (${cardNet} = ${econNet})`);

  /* و «کل عمر» در هر دو یک معنی دارد: نمای کلی صریح می‌گوید کدام بازه را نشان می‌دهد،
     وگرنه کاربر عددِ «کل» را با بازه‌ی انتخابیِ خودش اشتباه می‌گیرد. */
  ok(/کلِ عمر/.test(dashHtml), 'نمای کلی صریح می‌گوید این عدد مالِ کلِ عمر است');

  /* ⚠️ ادعای معکوس: اگر نمای کلی دوباره حسابِ محلیِ خودش را داشته باشد، این چک باید
     بتواند بگیردش. پس ثابت می‌کنیم عدد واقعاً از profitFor می‌آید و تصادفی برابر
     نشده — با عوض‌کردنِ یک ورودیِ مشترک و انتظارِ حرکتِ **هر دو** عدد با هم. */
  setSetting('llm_cost_pretrack_usd', '7');
  const d2 = grab(dashBody(U('bot=tarot&range=all&aw=7')), 'سودِ خالص');
  const e2 = grab(economicsBody(new URL('http://x/economics?bot=tarot&rEcon=all')), 'سودِ خالص');
  ok(d2 !== heroNet, `با تغییرِ لُختِ هزینه، عددِ نمای کلی هم حرکت کرد (${heroNet} → ${d2})`);
  ok(d2 === e2, `و باز هم با صفحه‌ی اقتصاد یکی است (${d2} = ${e2})`);
  setSetting('llm_cost_pretrack_usd', '0');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
