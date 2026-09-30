#!/usr/bin/env node
// 📣 چکِ «هزینه‌ی تبلیغ per روز است، نه یک عددِ ثابت».
//
// خواسته‌ی صریحِ مالک (۱۴۰۵/۰۶/۱۶): «کمپین‌ها هر روز ران‌اند و من بعضی روزها
// بهینه‌شان می‌کنم. باید هر عدد را در روزِ خودش وارد کنم، نه یک عددِ ثابت.»
//
// این چک کلِ مسیرِ واقعی را می‌دواند: فرم رندر می‌شود، POST اجرا می‌شود، دیتابیس
// نوشته می‌شود، و مدل دوباره خوانده می‌شود. یعنی هیچ ادعایی آینه‌ی خودش نیست.
//
// سه چیزی که اگر بشکنند **هیچ خطایی نمی‌دهند** و فقط عددِ سود را بی‌صدا غلط می‌کنند:
//   ۱) «خالی» و «صفر» یکی شوند → هر روزِ واردنشده صفر حساب شود و سود خوش‌بینانه شود.
//   ۲) میانگین **ساده** به‌جای **وزنی** → روزی که ۲ کاربر آورده هم‌وزنِ روزی که ۲۰۰
//      کاربر آورده، و عددِ حاصل هیچ سؤالِ واقعی‌ای را جواب ندهد.
//   ۳) فیلدِ تاریخ مقدارِ همان روز را برنگرداند → مالک فکر کند ثبت نشده و دوباره
//      وارد کند، یا بدتر، عددِ روزِ دیگری را ببیند و بر اساسش تصمیم بگیرد.
//
// اجرا: node tools/check-cpa-day.mjs   (بدون شبکه؛ فیکسچرِ SQLite در پوشه‌ی موقت)
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
const base = path.resolve('bots/dashboard');

const root = mkdtempSync(path.join(tmpdir(), 'cpaui-'));
const dataDir = path.join(root, 'tarotdata'); mkdirSync(dataDir, { recursive: true });
const now = Math.floor(Date.now()/1000), D = 86400;
const db = new Database(path.join(dataDir, 'bot-fa.db'));
db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
  balance INTEGER DEFAULT 0, first_source TEXT DEFAULT '', first_payload TEXT DEFAULT '',
  first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
 CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', step TEXT, original_amount INTEGER, created_at INTEGER, updated_at INTEGER);
 CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
 CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, price INTEGER,
  focus_area TEXT DEFAULT '', feedback TEXT DEFAULT '', status TEXT DEFAULT 'delivered', created_at INTEGER);
 CREATE TABLE llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER DEFAULT 0, kind TEXT DEFAULT '',
  ref_id INTEGER DEFAULT 0, model TEXT DEFAULT '', prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, ms INTEGER DEFAULT 0, created_at INTEGER);`);
const u = db.prepare('INSERT INTO users(telegram_id,name,first_source,created_at,last_seen) VALUES(?,?,?,?,?)');
u.run(1,'a','campaign:AB', now-2*D, now);
u.run(2,'b','campaign:AB', now-2*D, now);   // دو کاربر در یک روز
u.run(3,'c','campaign:AB', now-1*D, now);   // یک کاربر روز بعد
db.close();
process.env.TAROT_DB_DIR = dataDir;
// صفحه‌ی اقتصاد از کشِ worker می‌خواند؛ کش و worker داخلِ ریشه‌ی موقت (worker بی‌اثر)
process.env.DASH_CACHE_DIR = path.join(root, 'cache');
process.env.DASH_CACHE_WORKER = path.join(root, 'noop-worker.mjs');
writeFileSync(process.env.DASH_CACHE_WORKER, 'process.exit(0);\n');
process.chdir(root); mkdirSync(path.join(root,'data'), {recursive:true});

const { setSetting } = await import(`file://${base}/lib/platform.js`);
setSetting('usd_toman','100000');
const { economicsBody, cpaDaySet } = await import(`file://${base}/routes/economics.js`);
const { campaignCostModel } = await import(`file://${base}/lib/profit.js`);
const day = (d) => new Date((now - d*D + 12600)*1000).toISOString().slice(0,10);

let pass=0, errs=[];
const ok=(c,m)=>{ if(c){pass++;console.log('  ✅ '+m);} else {errs.push(m);console.log('  ❌ '+m);} };

// ۱) پیش‌فرضِ فیلد = امروز، و خالی
const today = new Date((now+12600)*1000).toISOString().slice(0,10);
let html = economicsBody(new URL('http://x/economics?bot=tarot'));
ok(html.includes(`type="date" value="${today}"`), `فیلدِ تاریخ پیش‌فرض امروز است (${today})`);
const amtField = html.match(/name="usd"[^>]*value="([^"]*)"/);
ok(amtField && amtField[1]==='', 'و فیلدِ مبلغ برای روزِ ثبت‌نشده خالی است');

// ۲) ثبتِ یک روز
const post=(o)=>cpaDaySet(new URLSearchParams(o));
console.log(' →', post({bot:'tarot', day:day(2), usd:'0.5'}));
let m = campaignCostModel('tarot');
ok(m.rates.get(day(2))===0.5, 'نرخِ روز ثبت شد');
ok(Math.abs(m.avgUsd-0.5)<1e-9, `میانگین = $0.5 (تنها روزِ ثبت‌شده)`);

// ۳) انتخابِ همان تاریخ مقدارش را برمی‌گرداند (خواسته‌ی مالک)
html = economicsBody(new URL(`http://x/economics?bot=tarot&cpaDay=${day(2)}`));
ok(/name="usd"[^>]*value="0\.5"/.test(html), 'انتخابِ آن تاریخ همان عدد را در فیلد می‌آورد');

// ۴) ویرایش
post({bot:'tarot', day:day(2), usd:'0.8'});
ok(campaignCostModel('tarot').rates.get(day(2))===0.8, 'ویرایش کار می‌کند');

// ۵) روزِ دوم با نرخِ متفاوت → میانگینِ وزنی
post({bot:'tarot', day:day(1), usd:'2'});
m = campaignCostModel('tarot');
// روزِ ۲: ۲ کاربر × 0.8 = 1.6 ؛ روزِ ۱: ۱ کاربر × 2 = 2 → (1.6+2)/3 = 1.2
ok(Math.abs(m.avgUsd-1.2)<1e-9, `میانگینِ وزنی = $1.2 (شد $${m.avgUsd.toFixed(4)})`);
ok(Math.abs(m.spentUsd-3.6)<1e-9, `خرجِ کل = $3.6 (شد $${m.spentUsd})`);

/* ۵ب) ⚠️ **جمعِ کل نمی‌تواند این را ثابت کند — سریِ روزانه می‌تواند.**
   کشفِ حین نوشتنِ همین چک: اگر `rateFor` همیشه میانگین برگرداند، **جمعِ هزینه‌ی تبلیغ
   دقیقاً همان می‌ماند**. دلیلش جبری است، نه تصادفی: میانگین خودش وزنی است، یعنی
   `avg × Σn = Σ(rate_d × n_d)` به‌طورِ اتحادی. پس هر ادعایی روی جمع، این جهش را
   **زنده** می‌گذارد (و اولین نسخه‌ی همین چک دقیقاً همین‌طور بود).
   ارزشِ واقعیِ نرخِ روزانه در **توزیعِ روزانه** است: جدولِ سودِ روزانه، نقطه‌ی سربه‌سر،
   و اینکه کدام روز گران بود. پس ادعا باید روی خودِ سری بنشیند. */
{
  const { profitDaily } = await import(`file://${base}/lib/profit.js`);
  const mm = campaignCostModel('tarot');
  const pr = profitDaily('tarot', { days: 5, usdToman: 100000, campaign: mm });
  const row = (d) => pr.series.find((r) => r.d === d);
  const r2 = row(day(2)), r1 = row(day(1));
  ok(r2 && Math.abs(r2.adUsd - 0.8 * 2) < 1e-9,
    `روزِ گران: ۲ کاربر × $0.8 = $1.6 (شد $${r2?.adUsd})`);
  ok(r1 && Math.abs(r1.adUsd - 2 * 1) < 1e-9,
    `روزِ ارزان: ۱ کاربر × $2 = $2 (شد $${r1?.adUsd})`);
  ok(r2 && r1 && Math.abs(r2.adUsd / 2 - r1.adUsd / 1) > 1e-6,
    'و دو روز واقعاً دو نرخِ متفاوت per کاربر دارند (نه هر دو میانگین)');
  ok(pr.totals.adExact === 3, `هر سه کاربر نرخِ روزِ خودشان را گرفتند (${pr.totals.adExact})`);
}

// ۶) خالی = پاک، صفر = صفر
post({bot:'tarot', day:day(1), usd:''});
ok(!campaignCostModel('tarot').rates.has(day(1)), 'فیلدِ خالی ردیف را پاک کرد');
post({bot:'tarot', day:day(1), usd:'0'});
ok(campaignCostModel('tarot').rates.get(day(1))===0, 'ولی صفرِ صریح ثبت می‌شود');

// ۷) گاردها
for (const [o,why] of [
  [{bot:'tarot', day:'not-a-date', usd:'1'}, 'تاریخِ بدشکل'],
  [{bot:'nope', day:day(1), usd:'1'}, 'رباتِ نامعتبر'],
  [{bot:'tarot', day:'2099-01-01', usd:'1'}, 'تاریخِ آینده'],
  [{bot:'tarot', day:day(1), usd:'-5'}, 'عددِ منفی'],
  [{bot:'tarot', day:day(1), usd:'99999'}, 'عددِ غیرمنطقی'],
]) { let threw=false; try{post(o);}catch{threw=true;} ok(threw, `${why} رد شد`); }

// ۸) میانگین در HTML و غیرقابل‌ویرایش
html = economicsBody(new URL('http://x/economics?bot=tarot'));
ok(/میانگینِ هزینه per کاربرِ کمپین/.test(html), 'باکسِ میانگین در صفحه هست');
const avgBlock = html.slice(html.indexOf('میانگینِ هزینه per کاربرِ کمپین'), html.indexOf('میانگینِ هزینه per کاربرِ کمپین')+400);
ok(!/<input/.test(avgBlock), 'و قابلِ ویرایش نیست (هیچ input ای ندارد)');
ok(/روزهای ثبت‌شده/.test(html), 'جدولِ تاریخچه‌ی روزها رندر می‌شود');

// ۹) انتخابِ تاریخ هیچ درخواستی به سرور نمی‌زند و هرگز صفحه را به «در حال آماده‌سازی» نمی‌برد
//    (گزارشِ مالک ۱۴۰۵/۰۷/۰۸: هر تاریخ یک کلیدِ کشِ تازه بود ⟵ کشِ خالی ⟵ ساختِ کاملِ آمار)
{
  const { economicsPage, COST_INPUTS_SLOT } = await import(`file://${base}/routes/economics.js`);
  const { canonicalAnalyticsUrl, writeDashCache } = await import(`file://${base}/lib/dash-cache.js`);
  const { renderCachedAnalyticsPage } = await import(`file://${base}/lib/analytics-pages.js`);
  html = economicsBody(new URL('http://x/economics?bot=tarot'));
  ok(!/method="get"[^>]*>[\s\S]{0,400}name="cpaDay"/.test(html) && !/this\.form\.submit\(\)/.test(html),
    'فیلدِ تاریخ دیگر فرمِ GET نیست و با تغییر، چیزی submit نمی‌کند');
  const form = html.slice(html.indexOf('id="cpa-day-form"'), html.indexOf('</form>', html.indexOf('id="cpa-day-form"')));
  ok(/method="post"/.test(html.slice(html.lastIndexOf('<form', html.indexOf('id="cpa-day-form"')), html.indexOf('id="cpa-day-form"')))
    && /name="day" type="date"/.test(form) && /name="usd"/.test(form),
    'تاریخ و مبلغ در همان فرمِ POSTِ «ثبت»اند (تاریخ فقط با ثبت فرستاده می‌شود)');
  const rates = JSON.parse((form.match(/data-rates="([^"]*)"/) || [])[1]?.replace(/&quot;/g, '"') || '{}');
  ok(rates[day(2)] === 0.8 && rates[day(1)] === 0, 'نرخِ همه‌ی روزهای ثبت‌شده داخلِ فرم است (عوض‌کردنِ تاریخ در مرورگر)');
  ok(/addEventListener\('change'/.test(html) && /data-cpa-day=/.test(html), 'اسکریپتِ تاریخ و لینک‌های جدولِ روزها بدونِ رفت‌وبرگشت کار می‌کنند');

  ok(canonicalAnalyticsUrl('/economics?bot=tarot&cpaDay=2026-01-01') === canonicalAnalyticsUrl('/economics?bot=tarot'),
    'cpaDay در کلیدِ کش نیست (لینکِ بدونِ جاوااسکریپت هم کشِ تازه نمی‌سازد)');

  // بدونِ کش: کارتِ ورودی باز هم هست (نه فقط «در حال آماده‌سازی»)
  let page = economicsPage(new URL(`http://x/economics?bot=tarot&cpaDay=${day(2)}`));
  ok(/id="cpa-day-form"/.test(page) && /name="usd"[^>]*value="0\.8"/.test(page),
    'بدونِ کشِ آماده هم کارتِ ورودی زنده با مقدارِ همان روز دیده می‌شود');
  // با کش: worker نشانگر می‌گذارد و route کارتِ زنده را جایش می‌نشاند
  const built = renderCachedAnalyticsPage(new URL('http://127.0.0.1/economics?bot=tarot'));
  ok(built.includes(COST_INPUTS_SLOT) && !/id="cpa-day-form"/.test(built), 'نسخه‌ی کش‌شده کارتِ ورودی ندارد، فقط نشانگرش را');
  writeDashCache(new URL('http://127.0.0.1/economics?bot=tarot'), built);
  post({bot:'tarot', day:day(2), usd:'0.9'});       // بعد از ساختِ کش عوض شد
  page = economicsPage(new URL(`http://x/economics?bot=tarot&cpaDay=${day(2)}`));
  ok(!page.includes(COST_INPUTS_SLOT) && (page.match(/id="cpa-day-form"/g) || []).length === 1,
    'با کش، کارت دقیقاً یک بار و جای نشانگر می‌نشیند');
  ok(/name="usd"[^>]*value="0\.9"/.test(page), 'کارتِ ورودی زنده است: عددِ تازه‌ثبت‌شده بلافاصله دیده می‌شود، نه عددِ کش');
}

console.log(errs.length?`\n❌ ${pass} پاس، ${errs.length} خطا`:`\n✅ ${pass} پاس، 0 خطا`);
if (errs.length) process.exit(1);
