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
  db.close();
}

process.env.TAROT_DB_DIR = dataDir;
process.chdir(root);                       // platform.db داشبورد در پوشه‌ی موقت ساخته شود
const base = path.resolve(import.meta.dirname, '../bots/dashboard');
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
  ok(/\$0\.50/.test(econHtml), 'هزینه‌ی کل ($0.50) در صفحه‌ی اقتصاد هست');
  ok(econHtml.includes('فراخوانیِ ثبت‌شده'), 'تعدادِ فراخوانی هم گزارش می‌شود');
}

console.log('\n▶ ۹) رباتِ بدونِ داشبوردِ اصلی، پیامِ صادقانه می‌دهد (نه عددِ ساختگی)');
{
  const other = dashBody(U('bot=voice2text'));
  ok(/فقط برای/.test(other) && !/کاربر فعال<\/div>/.test(other), 'برای ربات دیگر عددی ساخته نمی‌شود');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
