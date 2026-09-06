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
const { profitDaily, profitSinceTracking, costTrackingSince } = await import(`file://${base}/lib/profit.js`);

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
  const a = profitDaily('tarot', { days: 5, usdToman: RATE, campaignUsdPerUser: 0 });
  const b = profitDaily('tarot', { days: 5, usdToman: RATE, campaignUsdPerUser: 0.5 });
  // دو کاربرِ کمپینِ غیرادمین در پنجره → $1.00 → ۲۰۰٬۰۰۰ ت
  ok(b.totals.campaignUsers === 2, `کاربرِ کمپینِ شمرده‌شده = ۲ (ادمین حذف شد؛ شد ${b.totals.campaignUsers})`);
  ok(Math.abs(b.totals.adUsd - 1.0) < 1e-9, `هزینه‌ی تبلیغ = $1.00 (شد $${b.totals.adUsd.toFixed(4)})`);
  ok(b.totals.net === a.totals.net - 200_000, 'سود دقیقاً به اندازه‌ی هزینه‌ی تبلیغ کم شد');
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

console.log('\n▶ ۹) خلاصه‌ی «از شروعِ ثبتِ هزینه» با محاسبه‌ی مستقیم یکی است');
{
  const s = profitSinceTracking('tarot', { usdToman: RATE });
  ok(s.ok === true, 'وقتی هزینه ثبت شده، خلاصه ok می‌دهد');
  const direct = profitDaily('tarot', { days: s.days, usdToman: RATE });
  ok(s.totals.net === direct.totals.net, 'عددِ سرخطِ نمای کلی = همان محاسبه‌ی صفحه‌ی اقتصاد (تک‌منبع)');
}

console.log('\n▶ ۱۱) هزینه‌ی قبل از ثبت پخش می‌شود، نه کنار گذاشته');
{
  /* دیتای فیکسچر: ۵ روزِ اخیر هزینه‌ی ثبت‌شده دارند، ۵ روزِ قبلش فقط درآمد.
     با لُختِ $2 روی آن دوره، «کل عمر» باید **دقیقاً** هر دو را جمع بزند. */
  const PRE = 2;
  const wide = profitDaily('tarot', { days: 30, usdToman: RATE, preTrackUsd: PRE });
  const without = profitDaily('tarot', { days: 30, usdToman: RATE, preTrackUsd: 0 });
  const delta = wide.totals.llmUsd - without.totals.llmUsd;
  ok(Math.abs(delta - PRE) < 1e-6,
    `کلِ لُختِ دستی دقیقاً یک‌بار وارد شد ($${delta.toFixed(4)} = $${PRE})`);
  ok(wide.totals.net === without.totals.net - Math.round(PRE * RATE),
    'سود دقیقاً به اندازه‌ی لُخت کم شد، نه بیشتر و نه کمتر');
  // و روی روزهای قبل از شروعِ ثبت نشسته باشد، نه روی یک روزِ دلبخواه
  const startStr = new Date((costTrackingSince('tarot') + 12600) * 1000).toISOString().slice(0, 10);
  const before = wide.series.filter(r => r.d < startStr);
  const spread = before.reduce((a, r) => a + r.llmUsd, 0);
  ok(Math.abs(spread - PRE) < 1e-6,
    `لُخت روی روزهای **قبل از** شروعِ ثبت پخش شد ($${spread.toFixed(4)})`);
  ok(before.length > 1, `روی بیش از یک روز پخش شد (${before.length} روز)، نه همه روی یک روز`);
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }

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
