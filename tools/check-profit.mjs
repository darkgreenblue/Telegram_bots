#!/usr/bin/env node
// 📈 چکِ «سودِ خالص» — عددی که اگر غلط باشد هیچ خطایی نمی‌دهد و فقط مالک روی آن
// تصمیمِ غلط می‌گیرد. پس روی یک دیتابیسِ **واقعیِ** موقت با جوابِ از پیش حساب‌شده.
//
// سه خانواده‌ی خرابی که این چک می‌گیرد و هر سه بی‌صدا هستند:
//   ۱) **دوباره‌شماریِ تخفیف** — باگِ واقعیِ ۱۴۰۵/۰۶/۱۵. `SUM(amount)` از قبل بعدِ
//      تخفیف است؛ کم‌کردنِ دوباره‌اش سود را کم‌برآورد می‌کرد.
//   ۲) **شمردنِ اعتبارِ هدیه به‌عنوان هزینه** — بدهیِ تبلیغاتی است نه پولِ نقد، و
//      هزینه‌ی واقعی‌اش وقتی خرج شود از قبل در `llm_usage` هست (دوباره‌شماری).
//   ۳) **سودِ خوش‌بینانه‌ی قبل از شروعِ ثبتِ هزینه** — درآمد از روزِ اول هست ولی هزینه
//      نه؛ روزهای بی‌هزینه نباید سودِ ساختگی بسازند.
//
// اجرا: node tools/check-profit.mjs   (بدون شبکه)
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const root = mkdtempSync(path.join(tmpdir(), 'profit-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const D = 86400;
// «امروز» روی ظهرِ تهران قفل می‌شود تا تست به ساعتِ اجرا حساس نباشد
const todayNo = Math.floor((Math.floor(Date.now() / 1000) + 12600) / D);
const at = (back) => (todayNo - back) * D - 12600 + 12 * 3600;

const db = new Database(file);
db.exec(`
CREATE TABLE users(telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
  balance INTEGER DEFAULT 0, state TEXT DEFAULT 'new', first_source TEXT DEFAULT '',
  first_payload TEXT DEFAULT '', first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
CREATE TABLE events(id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
CREATE TABLE readings(id INTEGER PRIMARY KEY, user_id INTEGER, spread TEXT DEFAULT 'three', price INTEGER DEFAULT 3,
  rating INTEGER, feedback TEXT DEFAULT '', status TEXT DEFAULT 'delivered', created_at INTEGER);
CREATE TABLE payments(id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, original_amount INTEGER,
  discount_code_id INTEGER, pkg TEXT, status TEXT, step TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER);
CREATE TABLE llm_usage(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, ref_id INTEGER, model TEXT,
  prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, cost_usd REAL, ms INTEGER, created_at INTEGER);
CREATE TABLE discount_uses(id INTEGER PRIMARY KEY, code_id INTEGER, user_id INTEGER, payment_id INTEGER,
  discount_amount INTEGER, used_at INTEGER);
`);

const u = db.prepare('INSERT INTO users(telegram_id,name,first_source,balance,created_at,last_seen) VALUES(?,?,?,?,?,?)');
const e = db.prepare('INSERT INTO events(user_id,event,props,created_at) VALUES(?,?,?,?)');
const p = db.prepare("INSERT INTO payments(user_id,amount,original_amount,pkg,status,created_at,updated_at) VALUES(?,?,?,?,'approved',?,?)");
const l = db.prepare('INSERT INTO llm_usage(user_id,kind,ref_id,cost_usd,total_tokens,created_at) VALUES(?,?,?,?,?,?)');

/* ═══ دیتای دست‌ساز با جوابِ از پیش معلوم ═══
   روزهای ۰..۴ (پنج روز): هر روز ۱۰۰٬۰۰۰ ت درآمد و $0.20 هزینه‌ی مدل.
   روزهای ۹..۵ (پنج روزِ قدیمی‌تر): فقط درآمد، **هیچ هزینه‌ای** — یعنی دوره‌ی قبل از
   روشن‌شدنِ ثبتِ هزینه. این‌ها نباید واردِ سود شوند. */
for (let d = 4; d >= 0; d--) { p.run(1, 100_000, 10, 'basic', at(d), at(d)); l.run(1, 'reading', 1, 0.20, 1000, at(d)); }
for (let d = 9; d >= 5; d--) p.run(1, 100_000, 10, 'basic', at(d), at(d));

// یک تخفیفِ ۳۰٬۰۰۰ت — نباید از سود کم شود (از قبل داخلِ amount است)
db.prepare('INSERT INTO discount_uses(code_id,user_id,payment_id,discount_amount,used_at) VALUES(1,1,1,30000,?)').run(at(2));
/* اعتبارِ هدیه — نباید هزینه شمرده شود.
   ⚠️ عمداً **داخلِ** پنجره‌ی سنجش (روزِ ۲) است، نه بیرونش. نسخه‌ی اولِ همین چک آن را
   روی روزِ ۳۰ گذاشته بود و جهشِ «هدیه را هزینه بشمار» زنده ماند: ادعا سبز بود چون
   هیچ‌وقت اجرا نمی‌شد. یک ادعا فقط وقتی چیزی ثابت می‌کند که دیتایش واقعاً از مسیرِ
   سنجیده‌شده رد شود. */
u.run(1, 'a', 'organic', 0, at(30), at(0));
e.run(1, 'credit_granted', JSON.stringify({ kind: 'welcome', amount: 5 }), at(2));
e.run(1, 'credit_granted', JSON.stringify({ kind: 'referral', amount: 3 }), at(3));
// دو کاربرِ کمپین در دوره‌ی پوشش‌دار (روزِ ۱ و ۳) برای تستِ هزینه‌ی تبلیغ
u.run(2, 'b', 'campaign:AB', 0, at(3), at(0));
u.run(3, 'c', 'campaign:AB', 0, at(1), at(0));
// یک کاربرِ کمپینِ **ادمین** — نباید هزینه‌ی تبلیغ بگیرد
u.run(4, 'adm', 'campaign:AB', 0, at(2), at(0));
e.run(4, 'view', JSON.stringify({ adm: 1 }), at(2));
db.close();

process.chdir(root);
const base = path.resolve(import.meta.dirname, '../bots/dashboard');
process.env.TAROT_DB_DIR = dataDir;
const { profitDaily, costTrackingSince, profitFor, lifetimeDays, botStartSec } = await import(`file://${base}/lib/profit.js`);

const RATE = 200_000; // نرخِ گردِ تست تا ریاضی با چشم قابلِ بررسی بماند

console.log('\n▶ ۱) شروعِ ثبتِ هزینه درست تشخیص داده می‌شود');
{
  const since = costTrackingSince('tarot');
  const expected = at(4);
  ok(since === expected, `costSince = روزِ اولین llm_usage (${since} = ${expected})`);
}

console.log('\n▶ ۲) ریاضیِ سود روی پنجره‌ی پوشش‌دار');
{
  const p5 = profitDaily('tarot', { days: 5, usdToman: RATE });
  // ۵ روز × ۱۰۰٬۰۰۰ = ۵۰۰٬۰۰۰ درآمد ؛ ۵ × $0.20 × ۲۰۰٬۰۰۰ = ۲۰۰٬۰۰۰ هزینه
  ok(p5.totals.rev === 500_000, `درآمدِ ۵ روز = ۵۰۰٬۰۰۰ (شد ${p5.totals.rev})`);
  ok(Math.abs(p5.totals.llmUsd - 1.0) < 1e-9, `هزینه‌ی مدل = $1.00 (شد $${p5.totals.llmUsd.toFixed(4)})`);
  ok(p5.totals.costToman === 200_000, `هزینه به تومان = ۲۰۰٬۰۰۰ (شد ${p5.totals.costToman})`);
  ok(p5.totals.net === 300_000, `سود = ۳۰۰٬۰۰۰ (شد ${p5.totals.net})`);
  ok(p5.series.length === 5, 'سری دقیقاً ۵ روز دارد');
  ok(p5.series[0].d < p5.series[4].d, 'سری از قدیم به جدید مرتب است (لازمه‌ی تجمعی)');
  ok(p5.series[4].cum === 300_000, `تجمعیِ روزِ آخر = کلِ سود (شد ${p5.series[4].cum})`);
}

console.log('\n▶ ۳) تخفیف دو بار کم نمی‌شود (باگِ واقعیِ ۱۴۰۵/۰۶/۱۵)');
{
  const p5 = profitDaily('tarot', { days: 5, usdToman: RATE });
  // اگر تخفیف دوباره کم می‌شد: ۳۰۰٬۰۰۰ − ۳۰٬۰۰۰ = ۲۷۰٬۰۰۰
  ok(p5.totals.net !== 270_000, 'سود برابرِ نسخه‌ی باگ‌دار (۲۷۰٬۰۰۰) نیست');
  ok(p5.totals.net === 300_000, 'سود دقیقاً درآمدِ دریافتی منهای هزینه است، بی‌ربط به تخفیف');
}

console.log('\n▶ ۴) اعتبارِ هدیه هزینه شمرده نمی‌شود');
{
  const p5 = profitDaily('tarot', { days: 5, usdToman: RATE });
  // اگر ۵ الماسِ هدیه به هر نرخی هزینه می‌شد، costToman از ۲۰۰٬۰۰۰ بیشتر می‌شد
  ok(p5.totals.costToman === 200_000, 'هزینه فقط مدل است؛ هدیه‌ی خوش‌آمد واردش نشده');
}

console.log('\n▶ ۵) هزینه‌ی تبلیغ per کاربرِ کمپین، با حذفِ ادمین');
{
  const flat = (u) => ({ rates: new Map(), avgUsd: u, rateFor: () => u });
  const a = profitDaily('tarot', { days: 5, usdToman: RATE, campaign: flat(0) });
  const b = profitDaily('tarot', { days: 5, usdToman: RATE, campaign: flat(0.5) });
  // دو کاربرِ کمپینِ غیرادمین در پنجره → $1.00 → ۲۰۰٬۰۰۰ ت
  ok(b.totals.campaignUsers === 2, `کاربرِ کمپینِ شمرده‌شده = ۲ (ادمین حذف شد؛ شد ${b.totals.campaignUsers})`);
  ok(Math.abs(b.totals.adUsd - 1.0) < 1e-9, `هزینه‌ی تبلیغ = $1.00 (شد $${b.totals.adUsd.toFixed(4)})`);
  ok(b.totals.net === a.totals.net - 200_000, 'سود دقیقاً به اندازه‌ی هزینه‌ی تبلیغ کم شد');
}

/* ══ ۵ب) نرخِ تبلیغ **per روز** ═══════════════════════════════════════════
 *
 * خواسته‌ی صریحِ مالک (۱۴۰۵/۰۶/۱۶): «کمپین‌ها هر روز ران‌اند و من بعضی روزها
 * بهینه‌شان می‌کنم، پس هزینه per کاربر یک عددِ ثابت نیست.»
 *
 * فیکسچر دو کاربرِ کمپین دارد: یکی روزِ ۱ و یکی روزِ ۳. اگر فقط **یکی** از آن دو روز
 * نرخِ ثبت‌شده داشته باشد، آن یکی نرخِ خودش را می‌گیرد و دیگری میانگین را — و چون
 * میانگین این‌جا از همان تک‌روز ساخته می‌شود، هر دو باید به همان نرخ برسند. بعد با
 * ثبتِ نرخِ **متفاوت** برای روزِ دوم، جمع باید دقیقاً `r1 + r2` شود، نه `2 × میانگین`. */
console.log('\n▶ ۵ب) نرخِ تبلیغ per روز، نه یک عددِ ثابت');
{
  const { setCampaignCost, clearCampaignCost } = await import(`file://${base}/lib/platform.js`);
  const { campaignCostModel } = await import(`file://${base}/lib/profit.js`);
  const dayOf = (d) => new Date((at(d) + 12600) * 1000).toISOString().slice(0, 10);
  const [d1, d3] = [dayOf(1), dayOf(3)];

  // فقط روزِ ۱ ثبت شود → آن روز نرخِ خودش، روزِ ۳ میانگین (که همان است)
  setCampaignCost('tarot', d1, 2);
  let m = campaignCostModel('tarot');
  ok(m.enteredDays === 1, `یک روز ثبت شد (${m.enteredDays})`);
  ok(Math.abs(m.rateFor(d1) - 2) < 1e-9, 'روزِ ثبت‌شده نرخِ خودش را می‌گیرد');
  ok(Math.abs(m.rateFor(d3) - 2) < 1e-9, 'روزِ ثبت‌نشده میانگین را می‌گیرد');
  let pr = profitDaily('tarot', { days: 5, usdToman: RATE, campaign: m });
  ok(Math.abs(pr.totals.adUsd - 4) < 1e-9, `دو کاربر × $2 = $4 (شد $${pr.totals.adUsd})`);
  ok(pr.totals.adExact === 1, `فقط یک کاربر نرخِ روزِ خودش را داشت (${pr.totals.adExact})`);

  // حالا روزِ ۳ نرخِ **متفاوت** بگیرد → جمع باید 2 + 10 شود، نه 2 × میانگین
  setCampaignCost('tarot', d3, 10);
  m = campaignCostModel('tarot');
  pr = profitDaily('tarot', { days: 5, usdToman: RATE, campaign: m });
  /* ⚠️ این ادعا **جمع** را می‌سنجد و عمداً ضعیف است: چون میانگین وزنی است،
     `avg × Σn = Σ(rate_d × n_d)` یک اتحاد است، پس جمعِ کل حتی اگر همه‌ی روزها
     میانگین بگیرند هم همین می‌شود. ادعای **تمیزکننده** روی سریِ روزانه است و در
     `tools/check-cpa-day.mjs` نشسته (آن‌جا فیکسچر کاربرِ نامتقارن per روز دارد).
     این‌جا فقط می‌گوید جمع درست است و `adExact` روزهای دستی را می‌شمارد. */
  ok(Math.abs(pr.totals.adUsd - 12) < 1e-9,
    `هر روز نرخِ خودش: $2 + $10 = $12 (شد $${pr.totals.adUsd})`);
  ok(pr.totals.adExact === 2, 'هر دو کاربر نرخِ روزِ خودشان را داشتند');

  /* ⚠️ با یک کاربر در هر روز، میانگینِ **وزنی** و **ساده** هر دو ۶ می‌شوند، پس این
     فیکسچر به‌تنهایی هیچ‌کدام را رد نمی‌کند — و ادعایی که نتواند غلط را رد کند، چیزی
     ثابت نمی‌کند. پس یک کاربرِ کمپینِ موقت به روزِ ارزان اضافه می‌کنیم تا دو تعریف از
     هم جدا شوند: وزنی = (2×2 + 10×1) ÷ 3 = ۴٫۶۶۷ ولی ساده = (2 + 10) ÷ 2 = ۶. */
  /* اتصالِ فیکسچر بعد از ساختِ دیتا بسته شده (تا داشبورد readonly بخواند)، پس برای
     این دستکاریِ موقت یک اتصالِ کوتاهِ خودمان باز می‌کنیم و بلافاصله می‌بندیم. */
  const tmp = new Database(file);
  tmp.prepare('INSERT INTO users(telegram_id,name,first_source,balance,created_at,last_seen) VALUES(?,?,?,?,?,?)')
    .run(901, 'w', 'campaign:AB', 0, at(1), at(0));
  tmp.close();
  m = campaignCostModel('tarot');
  ok(m.coveredUsers === 3, `سه کاربرِ کمپین پوشش داده شدند (${m.coveredUsers})`);
  ok(Math.abs(m.avgUsd - 14 / 3) < 1e-9,
    `میانگینِ **وزنی** = $${(14 / 3).toFixed(4)} (شد $${m.avgUsd.toFixed(4)})`);
  ok(Math.abs(m.avgUsd - 6) > 1e-6, 'و عمداً با میانگینِ سادهٔ $6 برابر **نیست**');
  const tmp2 = new Database(file);
  tmp2.prepare('DELETE FROM users WHERE telegram_id=901').run();
  tmp2.close();
  m = campaignCostModel('tarot');
  ok(Math.abs(m.avgUsd - 6) < 1e-9, 'با برداشتنِ کاربرِ موقت، میانگین به $6 برمی‌گردد');

  // ⚠️ «خالی» ≠ «صفر»: پاک‌کردن باید روز را به میانگین برگرداند، نه صفرش کند
  clearCampaignCost('tarot', d3);
  m = campaignCostModel('tarot');
  ok(m.enteredDays === 1, 'پاک‌کردن ردیف را حذف کرد');
  ok(Math.abs(m.rateFor(d3) - 2) < 1e-9, 'و آن روز دوباره میانگین می‌گیرد، نه صفر');
  setCampaignCost('tarot', d3, 0);
  m = campaignCostModel('tarot');
  ok(Math.abs(m.rateFor(d3) - 0) < 1e-9, 'ولی صفرِ صریح واقعاً صفر می‌ماند');
  clearCampaignCost('tarot', d1); clearCampaignCost('tarot', d3);
}

console.log('\n▶ ۶) بدونِ نرخِ دلار، هیچ عددِ تومانی ساخته نمی‌شود');
{
  const p5 = profitDaily('tarot', { days: 5, usdToman: 0 });
  ok(p5.hasRate === false, 'پرچمِ hasRate خاموش است تا کارت بتواند صادق باشد');
  ok(p5.totals.costToman === 0, 'هزینه‌ی تومانی صفر می‌ماند (نرخ حدس زده نمی‌شود)');
}

console.log('\n▶ ۷) نقطه‌ی سربه‌سر «اولین مثبتِ ماندگار» است، نه اولین مثبت');
{
  // روزهای ۹..۵ درآمد دارند و هزینه ندارند، پس در پنجره‌ی ۱۰روزه تجمعی از روزِ اول مثبت است
  const p10 = profitDaily('tarot', { days: 10, usdToman: RATE });
  ok(p10.breakEven === p10.series[0].d, 'وقتی از ابتدا مثبت است، سربه‌سر همان روزِ اول است');
  ok(p10.series.every((r, i) => i === 0 || r.cum >= p10.series[i - 1].cum - 1e9),
    'تجمعی واقعاً تجمعی است (هر روز = قبلی + سودِ روز)');
}

console.log('\n▶ ۸) پنجره‌ی بی‌هزینه سودِ ساختگی نمی‌سازد — مصرف‌کننده ابزارش را دارد');
{
  const p10 = profitDaily('tarot', { days: 10, usdToman: RATE });
  // ۱۰ روز درآمد = ۱٬۰۰۰٬۰۰۰ ولی هزینه فقط ۵ روزِ آخر
  ok(p10.totals.rev === 1_000_000, `درآمدِ ۱۰ روز = ۱٬۰۰۰٬۰۰۰ (شد ${p10.totals.rev})`);
  ok(p10.totals.costToman === 200_000, 'هزینه همان ۵ روز است، نه ۱۰ روز');
  ok(p10.costSince === at(4), 'costSince برگردانده می‌شود تا کارت بتواند روزهای بی‌هزینه را کنار بگذارد');
  // همان کاری که کارتِ /economics می‌کند: فیلترِ روزهای پوشش‌دار
  const startStr = new Date((p10.costSince + 12600) * 1000).toISOString().slice(0, 10);
  const covered = p10.series.filter(r => r.d >= startStr);
  const netCovered = covered.reduce((a, r) => a + r.net, 0);
  ok(covered.length === 5, `پنجره‌ی پوشش‌دار ۵ روز است (شد ${covered.length})`);
  ok(netCovered === 300_000, `سودِ پوشش‌دار = ۳۰۰٬۰۰۰، نه ۸۰۰٬۰۰۰ خوش‌بینانه (شد ${netCovered})`);
}

console.log('\n▶ ۹) نمای کلی و صفحه‌ی اقتصاد ساختاراً یک عدد می‌دهند');
{
  /* 🐛 ایرادِ صریحِ مالک (۱۴۰۵/۰۶/۱۵): «توی نمای کلی یک عدد می‌بینم، توی اقتصاد و
     هزینه یک عددِ دیگه». ریشه‌اش دو **فرمولِ** متفاوت بود، نه یک اختلافِ گرد کردن:
     نمای کلی `profitSinceTracking` را صدا می‌زد (پنجره از «شروعِ ثبتِ هزینه»، و لُختِ
     دوره‌ی قبل **اصلاً پاس داده نمی‌شد**) و صفحه‌ی اقتصاد `profitDaily` را با بازه‌ی
     «کل عمر» و لُخت. دو تابع، دو جواب.

     پس این بخش عمداً دو ادعای **متفاوت** دارد: یکی عددی، یکی ساختاری. ادعای عددی
     به‌تنهایی کافی نیست — اگر فردا کسی دوباره در `dash.js` حسابِ محلی بنویسد که
     امروز اتفاقی همان عدد را بدهد، ادعای عددی سبز می‌ماند. */
  const life = profitFor('tarot', 'all');
  const direct = profitDaily('tarot', {
    days: lifetimeDays('tarot'), usdToman: life.rate,
    campaign: life.campaign, preTrackUsd: life.preUsd,
  });
  ok(life.totals.net === direct.totals.net,
    `profitFor('all') = محاسبه‌ی مستقیمِ کل عمر (${life.totals.net})`);

  const { readFileSync } = await import('fs');
  /* ⚠️ کامنت‌ها **قبل از** سنجش پاک می‌شوند. یک جهشِ واقعی این را نشان داد: جایگزینیِ
     `'all'` با `'month'` اول به کامنتِ بالای همان خط خورد و ادعا سبز ماند، در حالی که
     کد دست‌نخورده بود. ادعایی که کامنت را هم می‌بیند، عملاً مستندات را می‌سنجد نه کد. */
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dashSrc = strip(readFileSync(`${base}/routes/dash.js`, 'utf8'));
  ok(/profitFor\(bot, 'all'\)/.test(dashSrc),
    'نمای کلی دقیقاً همان profitFor را با همان بازه صدا می‌زند');
  ok(!/profitSinceTracking/.test(dashSrc), 'و دیگر هیچ مسیرِ دومی برای محاسبه‌ی سود ندارد');
  ok(!/costSince|شروعِ ثبتِ هزینه/.test(dashSrc),
    'و مفهومِ «شروعِ ثبتِ هزینه» را به کاربر نشان نمی‌دهد (خواسته‌ی صریحِ مالک)');

  const econNoComments = strip(readFileSync(`${base}/routes/economics.js`, 'utf8'));
  ok(/profitFor\(bot, rk\)/.test(econNoComments),
    'صفحه‌ی اقتصاد هم از همان تابع می‌خواند، فقط با بازه‌ی انتخابیِ کاربر');
  /* «شروعِ ثبت» فقط جایی مجاز است که کاربر **ورودی** می‌دهد (باید بداند چه عددی وارد
     کند). هرجای دیگر — برچسبِ یک عدد، سرتیترِ یک کارت، یا هشدار — همان چیزی است که
     مالک گفت بی‌خیالش شویم. پس دامنه سنجیده می‌شود، نه صرفِ وجود. */
  const inputsAt = econNoComments.indexOf('export function costInputsCard');
  const outsideInputs = inputsAt < 0 ? econNoComments : econNoComments.slice(0, inputsAt);
  ok(!/شروعِ ثبت/.test(outsideInputs),
    'و «شروعِ ثبت» بیرون از فرمِ ورودی، برچسبِ هیچ عددی نیست');
  ok(/شروعِ ثبت/.test(econNoComments.slice(Math.max(0, inputsAt))),
    'ولی در خودِ فرمِ ورودی هست (کاربر باید بداند چه عددی وارد کند)');
}

console.log('\n▶ ۱۱) هزینه‌ی قبل از ثبت پخش می‌شود، نه کنار گذاشته');
{
  /* دیتای فیکسچر: ۵ روزِ اخیر هزینه‌ی ثبت‌شده دارند، ۵ روزِ قبلش فقط درآمد.
     با لُختِ $2 روی آن دوره، «کل عمر» باید **دقیقاً** هر دو را جمع بزند. */
  const PRE = 2;
  /* ⚠️ بازه عمداً **کلِ عمر** است، نه یک عددِ گرد مثل ۳۰ روز. نسخه‌ی اولِ همین چک
     `days: 30` داشت و بعد از اینکه مرزِ «کل عمر» از «اولین درآمد» به «اولین کاربر»
     منتقل شد، $۱٫۹۲ از $۲ را دید و قرمز شد. آن قرمز **درست** بود و باگ نبود: دوره‌ی
     پخش از پنجره‌ی ۳۰روزه بیرون زده بود. ادعای معنادار این است که **کلِ عمر** کلِ
     لُخت را می‌گیرد؛ ادعای «هر بازه‌ای کلش را می‌گیرد» اصلاً درست نیست. */
  const LIFE = lifetimeDays('tarot');
  const wide = profitDaily('tarot', { days: LIFE, usdToman: RATE, preTrackUsd: PRE });
  const without = profitDaily('tarot', { days: LIFE, usdToman: RATE, preTrackUsd: 0 });
  const delta = wide.totals.costUsd - without.totals.costUsd;
  ok(Math.abs(delta - PRE) < 1e-6,
    `کلِ لُختِ دستی دقیقاً یک‌بار وارد شد ($${delta.toFixed(4)} = $${PRE})`);
  /* ⚠️ تلورانس عمدی و کوچک است، و دلیلش یک تصمیمِ طراحی: تومانِ **هر روز** جدا گرد
     می‌شود و جمع از همان‌ها ساخته می‌شود، نه از گردکردنِ جمعِ دلاری. یعنی جدولِ روزانه
     دقیقاً به عددِ «هزینه‌ی کل» جمع می‌زند — که برای کاربری که دارد با ماشین‌حساب چک
     می‌کند از یک اختلافِ چندریالیِ نامرئی مهم‌تر است. خطای انباشته حداکثر نصفِ تعدادِ
     روزهاست. */
  const expected = Math.round(PRE * RATE);
  const drop = without.totals.net - wide.totals.net;
  ok(Math.abs(drop - expected) <= wide.series.length,
    `سود به اندازه‌ی لُخت کم شد (${drop} ≈ ${expected}، خطای گردکردنِ روزانه)`);
  // و روی روزهای قبل از شروعِ ثبت نشسته باشد، نه روی یک روزِ دلبخواه
  const startStr = new Date((costTrackingSince('tarot') + 12600) * 1000).toISOString().slice(0, 10);
  const before = wide.series.filter(r => r.d < startStr);
  const spread = before.reduce((a, r) => a + r.preUsd, 0);
  ok(Math.abs(spread - PRE) < 1e-6,
    `لُخت روی روزهای **قبل از** شروعِ ثبت پخش شد ($${spread.toFixed(4)})`);
  // و در سطلِ خودش نشسته، نه قاطیِ هزینه‌ی ثبت‌شده — وگرنه کارتِ تفکیک نمی‌تواند
  // این دو را از هم جدا نشان بدهد و همان «نصفِ داستان»ِ قبلی برمی‌گردد.
  ok(Math.abs(wide.totals.preUsd - PRE) < 1e-6, 'لُخت در سطلِ preUsd است، نه داخلِ llmUsd');
  ok(Math.abs(wide.totals.llmUsd - without.totals.llmUsd) < 1e-9,
    'و هزینه‌ی ثبت‌شده دست‌نخورده ماند');
  ok(before.length > 1, `روی بیش از یک روز پخش شد (${before.length} روز)، نه همه روی یک روز`);

  /* و طرفِ دیگرِ همان قاعده: بازه‌ی کوتاه **سهمِ خودش** را می‌گیرد، نه کلِ لُخت را.
     اگر این نبود، «روزانه» و «هفتگی» یک هزینه‌ی نجومیِ ساختگی نشان می‌دادند. */
  const week = profitDaily('tarot', { days: 7, usdToman: RATE, preTrackUsd: PRE });
  ok(week.totals.preUsd < PRE,
    `بازه‌ی کوتاه فقط سهمِ خودش را می‌گیرد ($${week.totals.preUsd.toFixed(4)} < $${PRE})`);
  ok(botStartSec('tarot') !== null && botStartSec('tarot') <= costTrackingSince('tarot'),
    'مرزِ «کل عمر» از اولین روزِ ربات است، نه از اولین روزِ ثبتِ هزینه');
}

console.log('\n▶ ۱۰) پرداختِ حساب‌های تستی از درآمد بیرون است، و هیچ مسیری جا نمی‌ماند');
{
  /* ⚠️ گاردِ **ساختاری**، نه آینه‌ای: خطرِ واقعی این نیست که `revenueWhere` فیلتر را
     جا بیندازد (یک خط است و پیداست)، بلکه این است که یک صفحه‌ی دیگر خودش
     `status='approved'` بنویسد و از فیلتر بی‌خبر بماند. آن‌وقت درآمدِ دو صفحه با هم
     فرق می‌کند و هیچ خطایی هم رخ نمی‌دهد. پس سورسِ همه‌ی routeها گشته می‌شود. */
  const { readFileSync, readdirSync } = await import('fs');
  const { testUserClause } = await import(`file://${base}/lib/bots.js`);

  ok(/NOT IN \(409581917/.test(testUserClause('tarot')),
    'شرطِ کاربرِ تستیِ tarot ساخته می‌شود');
  ok(testUserClause('voice2text') === '',
    'رباتِ بدونِ حساب تستی هیچ شرطی نمی‌گیرد (رفتارِ قبلی دست‌نخورده)');
  ok(!/[a-z]'/i.test(testUserClause('tarot').replace(/NOT IN \([\d,]+\)/, '')),
    'هیچ رشته‌ای در شرط نیست؛ فقط عددِ پاک‌شده (قراردادِ امنیتی)');

  const dirs = [`${base}/routes`, `${base}/lib`];
  const miss = [];
  for (const d of dirs) {
    for (const f of readdirSync(d).filter(x => x.endsWith('.js'))) {
      const src = readFileSync(`${d}/${f}`, 'utf8');
      for (const line of src.split('\n')) {
        // خطی که خودش وضعیتِ موفقِ پول را می‌نویسد ولی نه از revenueWhere می‌آید نه فیلتر دارد
        const t = line.trim();
        // خطِ کامنت خودش کوئری نیست (نسخه‌ی اولِ همین گارد روی کامنتِ توضیحیِ خودش قرمز داد)
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
        if (!/successStatus\}'|status='approved'/.test(line)) continue;
        if (/testUserClause|revenueWhere|rw\.where/.test(line)) continue;
        miss.push(`${f}: ${line.trim().slice(0, 70)}`);
      }
    }
  }
  ok(miss.length === 0,
    `هیچ کوئریِ پولی بدونِ فیلترِ حسابِ تستی نمانده${miss.length ? `\n     ${miss.join('\n     ')}` : ''}`);
}

console.log('\n▶ ۱۲) پرداختِ سرگردان: حسابداریِ سه وضعیت');
{
  /* ⚠️ خطرِ واقعی این‌جا «خطا دادن» نیست، **بی‌صدا غلط شمردن** است. دو جهتِ خرابی هر دو
     ممکن‌اند و هیچ‌کدام خطایی نمی‌دهند:
       • `resolved_late` اگر در درآمد بماند → یک پول **دو بار** شمرده می‌شود (ردیفِ
         واقعی‌اش حالا در `payments` ربات هم هست).
       • `resolved_support` اگر از درآمد برود → پولی که واقعاً به حساب آمده **ناپدید**
         می‌شود (هیچ‌وقت در ربات ثبت نشد).
     پس هر دو جهت صریح سنجیده می‌شوند، نه فقط یکی. */
  const { addOrphan, resolveOrphan, orphanRevenueByDay, ORPHAN_REVENUE_STATES } =
    await import(`file://${base}/lib/platform.js`);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const when = at(1);
  const base0 = sum(orphanRevenueByDay('tarot', 0));

  addOrphan({ bot: 'tarot', amount: 11_000, paidAt: when, coins: 3 });
  const idLate = addOrphan({ bot: 'tarot', amount: 22_000, paidAt: when, coins: 5 });
  const idSupp = addOrphan({ bot: 'tarot', amount: 33_000, paidAt: when, coins: 7 });
  ok(sum(orphanRevenueByDay('tarot', 0)) === base0 + 66_000,
    'هر سه ردیفِ تازه (هنوز باز) در درآمد می‌آیند');

  resolveOrphan(idLate, 'resolved_late');
  ok(sum(orphanRevenueByDay('tarot', 0)) === base0 + 44_000,
    '«رسید را دیر فرستاد» از درآمد **خارج** شد (وگرنه دوباره‌شماری)');

  resolveOrphan(idSupp, 'resolved_support', 555);
  ok(sum(orphanRevenueByDay('tarot', 0)) === base0 + 44_000,
    '«از راه پشتیبانی» در درآمد **ماند** (وگرنه پول ناپدید می‌شد)');

  ok(resolveOrphan(idSupp, 'resolved_late') === 0,
    'گذارِ دوباره روی ردیفِ حل‌شده بی‌اثر است (ضدِ دوبار-تپ)');
  ok(ORPHAN_REVENUE_STATES.includes('orphan') && ORPHAN_REVENUE_STATES.includes('resolved_support')
     && !ORPHAN_REVENUE_STATES.includes('resolved_late'),
    'فهرستِ وضعیت‌های درآمدی دقیقاً همان دو تاست');

  // و واقعاً به سریِ سود می‌رسد، نه فقط در جدولِ خودش بماند
  const pr = profitDaily('tarot', { days: 5, usdToman: RATE });
  ok(pr.totals.orphan === base0 + 44_000,
    `سهمِ سرگردان در سریِ سود جدا گزارش می‌شود (${pr.totals.orphan})`);
  ok(pr.totals.rev - pr.totals.orphan === 500_000,
    `درآمدِ عادی دست‌نخورده ماند (${pr.totals.rev - pr.totals.orphan})`);
}

console.log('\n▶ ۱۳) اعدادِ کارتِ تفکیکِ هزینه واقعاً جمع می‌زنند');
{
  /* 🐛 خواسته‌ی صریحِ مالک: «من دستی حساب کردم و با عددِ پنل نمی‌خواند». پس صرفِ درست
     بودنِ محاسبه کافی نیست؛ چیزی که **روی صفحه** است باید جمع بزند. یک گردکردنِ
     ناهماهنگ (اجزا جدا گرد شوند ولی جمع از کلِ دلار ساخته شود) دقیقاً همان شکایت را
     دوباره می‌سازد، و هیچ خطایی هم نمی‌دهد.

     این بخش هم دیتا را می‌سنجد هم **HTMLِ رندرشده** را — چون خطا می‌تواند در هرکدام
     باشد و ادعای یکی، دیگری را ثابت نمی‌کند. */
  const { setSetting } = await import(`file://${base}/lib/platform.js`);
  setSetting('usd_toman', String(RATE));
  setSetting('llm_cost_pretrack_usd', '2');
  const { economicsBody } = await import(`file://${base}/routes/economics.js`);

  for (const rk of ['day', 'week', 'month', 'all']) {
    const p = profitFor('tarot', rk);
    const parts = p.totals.llmToman + p.totals.preToman + p.totals.adToman;
    ok(parts === p.totals.costToman,
      `[${rk}] اجزای تومانی دقیقاً به جمع می‌رسند (${parts} = ${p.totals.costToman})`);
    ok(p.totals.net === p.totals.rev - p.totals.costToman,
      `[${rk}] سود = درآمد − هزینه، بدونِ هیچ جمله‌ی پنهانی`);
    const seriesCost = p.series.reduce((a, r) => a + r.costToman, 0);
    ok(seriesCost === p.totals.costToman,
      `[${rk}] جدولِ روزانه هم به همان جمع می‌رسد (${seriesCost})`);
  }

  // و همان چیزی که کاربر می‌بیند
  const html = economicsBody(new URL('http://x/economics?bot=tarot&rEcon=all'));
  const at = html.indexOf('هزینه‌ها به تفکیک');
  ok(at > 0, 'کارتِ تفکیک رندر شد');
  const toNum = (x) => Number(String(x).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d-]/g, '')) || 0;
  const trs = html.slice(at).split('<tr>').slice(1, 8);
  const money = trs.map((tr) => {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m2) => m2[1]);
    return { label: (tds[0] || '').replace(/<[^>]*>/g, ''), toman: toNum(tds[2] || '') };
  });
  const comps = money.filter((r) => /هزینه‌ی مدل|هزینه‌ی تبلیغ/.test(r.label));
  const totalRow = money.find((r) => /جمعِ هزینه/.test(r.label));
  ok(comps.length >= 2 && !!totalRow, `ردیف‌های هزینه و ردیفِ جمع در HTML پیدا شدند (${comps.length} جزء)`);
  if (totalRow) {
    const sum = comps.reduce((a, r) => a + r.toman, 0);
    ok(sum === totalRow.toman,
      `ستونِ تومانِ HTML واقعاً جمع می‌زند (${comps.map((r) => r.toman).join(' + ')} = ${totalRow.toman})`);
  }
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
