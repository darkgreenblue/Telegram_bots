#!/usr/bin/env node
// 🔁💸 چکِ «کدنسِ چسبندگی» و «CPA per کانال» — دو سنجه‌ای که اگر غلط باشند، صفحه هنوز
// رندر می‌شود و فقط **تصمیم** غلط گرفته می‌شود. پس هر دو روی یک دیتابیسِ واقعیِ موقت با
// الگوهای دست‌ساز و جوابِ **از پیش حساب‌شده** اجرا می‌شوند.
//
// اجرا: node tools/check-engage-cpa.mjs   (بدون شبکه)
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const root = mkdtempSync(path.join(tmpdir(), 'engcpa-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const D = 86400;
// «امروز» را روی وسطِ روزِ تهران قفل می‌کنیم تا تستِ مرزِ روز به ساعتِ اجرا حساس نباشد
const todayNo = Math.floor((Math.floor(Date.now() / 1000) + 12600) / D);
const dayTs = (n) => n * D - 12600 + 12 * 3600;   // ظهرِ تهرانِ روزِ n
const ago = (d) => dayTs(todayNo - d);

{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
      balance INTEGER DEFAULT 0, daily_streak INTEGER DEFAULT 0, first_source TEXT DEFAULT '',
      first_payload TEXT DEFAULT '', first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
    CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, price INTEGER,
      feedback TEXT DEFAULT '', status TEXT DEFAULT 'delivered', created_at INTEGER);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'approved', original_amount INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
    CREATE TABLE referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER, referee_id INTEGER UNIQUE, rewarded INTEGER DEFAULT 0, created_at INTEGER);
    CREATE TABLE llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER DEFAULT 0, kind TEXT DEFAULT '',
      ref_id INTEGER DEFAULT 0, model TEXT DEFAULT '', prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, ms INTEGER DEFAULT 0, created_at INTEGER);
  `);
  const u = db.prepare('INSERT INTO users (telegram_id,name,first_source,created_at,last_seen) VALUES (?,?,?,?,?)');
  const r = db.prepare("INSERT INTO readings (user_id,type,price,status,created_at) VALUES (?,?,?,'delivered',?)");
  const e = db.prepare('INSERT INTO events (user_id,event,props,created_at) VALUES (?,?,?,?)');
  const grant = (uid, amt, kind, t) => e.run(uid, 'credit_granted', JSON.stringify({ amount: amt, kind }), t);

  /* ── جمعیتِ کدنس (الگوها دست‌ساز، جوابشان از قبل معلوم) ── */
  u.run(1, 'روزانه', 'campaign:cad', ago(30), ago(0));
  for (let d = 9; d >= 0; d--) r.run(1, 'love3', 3, ago(d));          // هر روز، آخری امروز
  u.run(2, 'هر سه روز', 'campaign:cad', ago(30), ago(0));
  for (let d = 12; d >= 0; d -= 3) r.run(2, 'love3', 3, ago(d));      // ۰،۳،۶،۹،۱۲ → وقفه ۳
  u.run(3, 'وقفه‌ی ۱۰', 'campaign:cad', ago(30), ago(0));
  r.run(3, 'love3', 3, ago(10)); r.run(3, 'love3', 3, ago(0));        // وقفه ۱۰ → هیچ سطلی
  u.run(4, 'تازه‌وارد', 'campaign:cad', ago(1), ago(0));                    // عضویت < ۳ روز
  for (let d = 1; d >= 0; d--) r.run(4, 'love3', 3, ago(d));
  u.run(5, 'تک‌اکشن', 'campaign:cad', ago(30), ago(0));
  r.run(5, 'love3', 3, ago(0));                                       // یک روز → حذف
  u.run(6, 'فقط رایگان', 'campaign:cad', ago(30), ago(0));
  for (let d = 9; d >= 0; d--) e.run(6, 'daily_card', '{}', ago(d));   // فقط لایه‌ی ۲
  u.run(99, 'ادمین', 'campaign:cad', ago(40), ago(0));
  e.run(99, 'view', JSON.stringify({ k: 'menu', adm: 1 }), ago(1));
  for (let d = 9; d >= 0; d--) r.run(99, 'love3', 3, ago(d));          // باید همه‌جا حذف شود

  /* ── جمعیتِ CPA: عددها طوری چیده شده‌اند که با دست قابلِ حساب باشند ──
     نرخ‌ها: فالِ ۳کارتی $0.003 → هر الماس $0.001 ؛ فالِ ۵کارتی $0.010 → هر الماس $0.002 */
  const A = 11, B = 12, C = 13;
  u.run(A, 'A ارگانیک', 'organic', ago(20), ago(0));
  u.run(B, 'B ارگانیک', 'organic', ago(20), ago(0));
  u.run(C, 'C دعوت‌شده', `referral:${A}`, ago(20), ago(0));
  grant(A, 5, 'welcome', ago(20)); grant(B, 5, 'welcome', ago(20)); grant(C, 5, 'welcome', ago(20));
  grant(A, 3, 'referral', ago(15));                       // پاداشِ دعوتِ C
  db.prepare('INSERT INTO payments (user_id,amount,status,original_amount,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(A, 100000, 'approved', 10, ago(10), ago(10));    // خریدِ ۱۰ الماس
  db.prepare('INSERT INTO referrals (referrer_id,referee_id,rewarded,created_at) VALUES (?,?,1,?)').run(A, C, ago(15));
  // A: سه فالِ ۳کارتی (۹💎) + یک فالِ ۵کارتی (۵💎) = ۱۴💎
  for (let i = 0; i < 3; i++) { const x = r.run(A, 'love3', 3, ago(5 - i)); addCost(x.lastInsertRowid, 0.003, ago(5 - i)); }
  { const x = r.run(A, 'open5', 5, ago(2)); addCost(x.lastInsertRowid, 0.010, ago(2)); }
  // B: یک فالِ ۳کارتی (۳💎)
  { const x = r.run(B, 'love3', 3, ago(4)); addCost(x.lastInsertRowid, 0.003, ago(4)); }
  // C: یک فالِ ۳کارتی (۳💎)
  { const x = r.run(C, 'love3', 3, ago(4)); addCost(x.lastInsertRowid, 0.003, ago(4)); }
  function addCost(rid, usd, t) {
    db.prepare('INSERT INTO llm_usage (user_id,kind,ref_id,model,cost_usd,created_at) VALUES (0,?,?,?,?,?)')
      .run('reading', rid, 'm', usd, t);
  }
  db.close();
}

process.env.TAROT_DB_DIR = dataDir;
process.chdir(root);
const base = path.resolve(import.meta.dirname, '../bots/dashboard');
const eng = await import(`file://${base}/lib/engage.js`);
const { channelCosts, costPerDiamond, SELF_ACQ_KINDS } = await import(`file://${base}/lib/cpa.js`);
const { resolveCohort } = await import(`file://${base}/lib/cohorts.js`);
const { instancesOf, withDb } = await import(`file://${base}/lib/bots.js`);
const now = Math.floor(Date.now() / 1000);
const inst = instancesOf('tarot')[0];
const count = (q) => withDb(inst.file, (db) => db.prepare(`SELECT COUNT(*) c FROM (${q.sql})`).get(...q.params).c, -1);
const ids = (q) => withDb(inst.file, (db) => db.prepare(q.sql).all(...q.params).map(x => x.uid).sort((a, b) => a - b), []);

console.log('▶ ۱) کدنسِ لایه‌ی ۱ (خرجِ الماس) — الگوهای دست‌ساز');
{
  // فقط جمعیتِ تستِ کدنس (شناسه‌ی تک‌رقمی)؛ کاربرانِ فیکسچرِ CPA جدا سنجیده می‌شوند
  const spend = (n) => ids(eng.spendCadenceSql(n, now, true, { windowDays: 0 })).filter(x => x < 10);
  // کاربرِ ۱ هر روز؛ کاربرِ ۲ هر ۳ روز؛ ۳ وقفه‌ی ۱۰؛ ۴ تازه‌وارد؛ ۵ تک‌اکشن؛ ۹۹ ادمین
  ok(JSON.stringify(spend(1)) === '[1]', `«هر روز» فقط کاربرِ ۱ (دیده شد: ${spend(1)})`);
  ok(JSON.stringify(spend(2)) === '[1]', `«هر ۲ روز» هنوز فقط کاربرِ ۱ (دیده شد: ${spend(2)})`);
  ok(JSON.stringify(spend(3)) === '[1,2]', `«هر ۳ روز» کاربرِ ۱ و ۲ (دیده شد: ${spend(3)})`);
  ok(JSON.stringify(spend(7)) === '[1,2]', `«هفته‌ای یک‌بار» باز هم ۱ و ۲ (وقفه‌ی ۱۰ بیرون است؛ دیده شد: ${spend(7)})`);
  ok(!spend(7).includes(4), 'کاربرِ تازه‌وارد (عضویت < ۳ روز) شمرده نمی‌شود');
  ok(!spend(7).includes(5), 'کاربرِ تک‌اکشن شمرده نمی‌شود (یک اکشن عادت نیست)');
  ok(!spend(7).includes(99), 'ادمین از کدنس حذف است');
  // تجمعی بودن: هر سطل باید زیرمجموعه‌ی سطلِ بزرگ‌تر باشد
  let mono = true;
  for (let n = 1; n < 7; n++) if (!spend(n).every(x => spend(n + 1).includes(x))) mono = false;
  ok(mono, 'سطل‌ها تجمعی‌اند: هر کدنس زیرمجموعه‌ی کدنسِ بزرگ‌تر است');
}

console.log('\n▶ ۲) وقفه‌ی دنباله شمرده می‌شود (کاربرِ رفته «فعال» نمی‌ماند)');
{
  // کاربرِ ۲ آخرین خرجش امروز است؛ اگر وقفه‌ی دنباله شمرده نمی‌شد، کاربرِ ۳ هم با
  // وقفه‌ی ۱۰ در سطلِ ۷ می‌افتاد. این ادعا دقیقاً همان گارد را می‌سنجد.
  ok(!ids(eng.spendCadenceSql(7, now, true, {})).filter(x => x < 10).includes(3),
    'کاربری با وقفه‌ی ۱۰ روز در هیچ سطلِ ≤۷ نیست');
}

console.log('\n▶ ۳) لایه‌ی ۲ (اکشنِ مفید) لایه‌ی ۱ را در بر می‌گیرد و کاربرِ رایگان را هم می‌بیند');
{
  const useful1 = ids(eng.usefulCadenceSql(1, now, true, {}));
  ok(useful1.includes(6), 'کاربرِ «فقط رایگان» در لایه‌ی ۲ دیده می‌شود');
  ok(!ids(eng.spendCadenceSql(1, now, true, {})).includes(6), 'ولی در لایه‌ی ۱ (خرجِ الماس) نیست');
  ok(!useful1.includes(99), 'ادمین در لایه‌ی ۲ هم حذف است');
  for (let n = 1; n <= 7; n++) {
    const s = ids(eng.spendCadenceSql(n, now, true, {}));
    const uu = ids(eng.usefulCadenceSql(n, now, true, {}));
    if (!s.every(x => uu.includes(x))) { ok(false, `لایه‌ی ۲ باید لایه‌ی ۱ را در بر بگیرد (n=${n})`); break; }
    if (n === 7) ok(true, 'در هر هفت سطل، لایه‌ی ۲ ابرمجموعه‌ی لایه‌ی ۱ است');
  }
}

console.log('\n▶ ۴) عدد و لیستِ کوهورتش یکی‌اند');
{
  const U = (q) => new URL(`http://x/c?${q}`);
  for (const n of [1, 3, 7]) {
    for (const layer of ['spend', 'useful']) {
      const listed = resolveCohort(U(`k=tarot&bot=tarot&t=cadence&layer=${layer}&n=${n}`)).users.length;
      const counted = count(layer === 'spend' ? eng.spendCadenceSql(n, now, true, {}) : eng.usefulCadenceSql(n, now, true, {}));
      ok(listed === counted, `کدنس ${layer} n=${n}: لیست ${listed} = عدد ${counted}`);
    }
  }
}

console.log('\n▶ ۵) هزینه‌ی هر الماس per اندازه‌ی فال');
{
  const cpd = costPerDiamond('tarot');
  const s3 = cpd.sizes.find(s => s.size === 3), s5 = cpd.sizes.find(s => s.size === 5);
  // ۵ فالِ ۳کارتی × $0.003 = $0.015 روی ۱۵💎 → $0.001 ؛ یک فالِ ۵کارتی $0.010 روی ۵💎 → $0.002
  ok(s3 && near(s3.cpd, 0.001, 1e-12), `۳کارتی: هر الماس $0.001 (شد ${s3?.cpd})`);
  ok(s5 && near(s5.cpd, 0.002, 1e-12), `۵کارتی: هر الماس $0.002 (شد ${s5?.cpd})`);
  ok(!near(s3.cpd, s5.cpd), 'نرخِ دو اندازه عمداً یکی نیست (یک نرخِ واحد ساختن غلط بود)');
}

console.log('\n▶ ۶) FIFO و تخصیصِ کانال — با جوابِ دستی');
{
  const { channels } = channelCosts('tarot', { sinceSec: 0, campaignUsdPerUser: 0 });
  /* دستی:
     A: اعتبار به ترتیب welcome5 → referral3 → purchase10 ؛ خرج ۱۴💎
        FIFO: welcome ۵ مصرف، referral ۳ مصرف، purchase ۶ مصرف.
        نرخِ وزنیِ A = (۹×۰٫۰۰۱ + ۵×۰٫۰۰۲) ÷ ۱۴ = ۰٫۰۱۹÷۱۴
        جذبِ خودِ A = فقط welcome ۵  →  ۵ × ۰٫۰۱۹÷۱۴
     B: welcome5، خرج ۳💎 → welcome ۳ مصرف، نرخ ۰٫۰۰۱ → ۰٫۰۰۳
     ارگانیک = A + B ، دو کاربر. */
  const aCost = 5 * (0.019 / 14), bCost = 3 * 0.001;
  const org = channels.organic;
  ok(org.users === 2, `ارگانیک ۲ کاربر (شد ${org.users})`);
  ok(near(org.costUsd, aCost + bCost, 1e-9), `هزینه‌ی ارگانیک = $${(aCost + bCost).toFixed(6)} (شد $${org.costUsd.toFixed(6)})`);
  ok(near(org.cpaUsd, (aCost + bCost) / 2, 1e-9), 'CPA ارگانیک = هزینه ÷ کاربر');
  /* C: دعوت‌شده. welcome ۵، خرج ۳💎 → ۳ مصرف با نرخِ ۰٫۰۰۱ = ۰٫۰۰۳
     به‌علاوه سهمِ پاداشِ دعوت: A سه الماسِ referral را کامل خرج کرده → ۳ × avgCpd،
     تقسیم بر ۱ دعوت. avgCpd = کلِ دلار ÷ کلِ الماس = ۰٫۰۲۵ ÷ ۲۰ = ۰٫۰۰۱۲۵ */
  const avgCpd = 0.025 / 20;
  const cCost = 3 * 0.001 + 3 * avgCpd;
  ok(channels.referral.users === 1, 'کانالِ دعوت یک کاربر دارد');
  ok(near(channels.referral.costUsd, cCost, 1e-9),
    `هزینه‌ی دعوت = $${cCost.toFixed(6)} (شد $${channels.referral.costUsd.toFixed(6)})`);
}

console.log('\n▶ ۷) پاداشِ دعوت دو بار شمرده نمی‌شود (باگِ واقعیِ همین PR)');
{
  ok(!SELF_ACQ_KINDS.has('referral'),
    'سطلِ referral در هزینه‌ی جذبِ **خودِ** دعوت‌کننده نمی‌آید (فقط از راهِ سهمِ دعوت‌شده)');
  const { channels } = channelCosts('tarot', { sinceSec: 0, campaignUsdPerUser: 0 });
  // اگر دوباره‌شماری برگردد، هزینه‌ی ارگانیک ۳ الماس بیشتر می‌شود
  const withBug = 5 * (0.019 / 14) + 3 * 0.001 + 3 * (0.019 / 14);
  ok(!near(channels.organic.costUsd, withBug, 1e-9), 'هزینه‌ی ارگانیک شاملِ پاداشِ دعوتِ A نیست');
}

console.log('\n▶ ۸) هزینه‌ی دستیِ کمپین روی هر کاربرِ کمپین می‌نشیند');
{
  const a = channelCosts('tarot', { sinceSec: 0, campaignUsdPerUser: 0 }).channels.campaign;
  const b = channelCosts('tarot', { sinceSec: 0, campaignUsdPerUser: 0.02 }).channels.campaign;
  ok(a.users === b.users, 'تعدادِ کاربرِ کمپین به هزینه‌ی دستی حساس نیست');
  ok(near(b.costUsd - a.costUsd, 0.02 * a.users, 1e-9), 'هزینه‌ی دستی دقیقاً × تعدادِ کاربرِ کمپین اضافه می‌شود');
}

console.log('\n▶ ۹) «اکشنِ مفید» فیچرِ خاموش و دُمِ فلوی دیگر را نمی‌شمارد');
{
  /* ⚠️ این بخش عمداً **ساختاری** است، نه آینه‌ای. یک ادعای آینه‌ای («فلان اسم در
     لیست نیست») فقط خودش را می‌سنجد و اگر فردا کسی اسمِ تازه‌ای از یک فیچرِ خاموش
     اضافه کند ساکت می‌ماند. پس به‌جای لیستِ ثابت، **سورسِ خودِ ربات** خوانده می‌شود:
     هر پرچمی که `= false` است پیدا می‌شود، بعد هر رویدادی که فقط داخلِ بلوکِ گاردشده
     با آن پرچم `track` می‌شود «دست‌نیافتنی» علامت می‌خورد. اگر چنین رویدادی در
     USEFUL_EVENTS باشد، سنجه چیزی را می‌شمارد که کاربر اصلاً نمی‌بیند. */
  // مسیر نسبت به خودِ اسکریپت، نه cwd — این چک cwd را عوض می‌کند.
  const src = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
  const lines = src.split('\n');

  const offFlags = [...src.matchAll(/^const\s+([A-Z0-9_]+)\s*=\s*false\s*;/gm)].map(m => m[1]);
  ok(offFlags.length > 0, `پرچمِ خاموش در سورسِ tarot پیدا شد (${offFlags.join(', ') || '—'})`);

  // بلوک‌های سطحِ بالا: از خطی که در ستونِ ۰ شروع می‌شود تا خطی که دقیقاً بسته می‌شود.
  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    if (/^(async\s+)?function\s|^const\s+\w+\s*=\s*(async\s*)?\(|^bot\.(action|hears|command|on)\(/.test(ln)) {
      if (cur) blocks.push(cur);
      cur = [ln];
    } else if (cur) {
      cur.push(ln);
      if (/^(\}|\}\);|\}\)\.catch)/.test(ln)) { blocks.push(cur); cur = null; }
    }
  }
  if (cur) blocks.push(cur);

  const unreachable = new Set();
  for (const b of blocks) {
    const text = b.join('\n');
    if (!offFlags.some(f => new RegExp(`if\\s*\\(\\s*!${f}\\b`).test(text))) continue;
    for (const m of text.matchAll(/track\(\s*db\s*,\s*\w+\s*,\s*'([a-z0-9_]+)'/g)) unreachable.add(m[1]);
  }
  ok(unreachable.size > 0, `رویدادهای پشتِ پرچمِ خاموش شناسایی شدند (${unreachable.size} تا)`);

  const { USEFUL_EVENTS } = eng;
  const leaked = USEFUL_EVENTS.filter(e => unreachable.has(e));
  ok(leaked.length === 0,
    `هیچ رویدادِ پشتِ پرچمِ خاموش در USEFUL_EVENTS نیست${leaked.length ? ` — نشتی: ${leaked.join(', ')}` : ''}`);

  // ادعای آینه‌ایِ مکمل: «دُمِ فلوی دیگر» با سورس قابلِ تشخیص نیست، پس صریح گفته می‌شود.
  ok(!USEFUL_EVENTS.includes('feedback'),
    'نمره‌دادن (feedback) اکشنِ مفید نیست: دُمِ فالِ پولی است، نه بازگشتِ مستقل');

  // و گاردِ معکوس: هرچه در لیست هست باید واقعاً در سورسِ ربات ثبت شود.
  const tracked = new Set([...src.matchAll(/track(Once)?\(\s*db\s*,\s*\w+\s*,\s*'([a-z0-9_]+)'/g)].map(m => m[2]));
  // ثابت‌های EVENTS در shared/analytics.js تعریف شده‌اند، نه در سورسِ ربات.
  const evSrc = readFileSync(new URL('../shared/analytics.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/track(Once)?\(\s*db\s*,\s*\w+\s*,\s*EVENTS\.([A-Z_]+)/g)) {
    const c = evSrc.match(new RegExp(`${m[2]}:\\s*'([a-z0-9_]+)'`));
    if (c) tracked.add(c[1]);
  }
  const ghosts = USEFUL_EVENTS.filter(e => !tracked.has(e));
  ok(ghosts.length === 0,
    `هر رویدادِ USEFUL_EVENTS واقعاً در ربات ثبت می‌شود${ghosts.length ? ` — بی‌ریشه: ${ghosts.join(', ')}` : ''}`);
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
