#!/usr/bin/env node
/* چکِ «تشخیصِ گیر افتادنِ کاربر» (`tools/stuck-detect.mjs` + سیم‌کشی‌اش در health-watch).
 *
 * ═══ چرا این چک وجود دارد ═══
 *
 * این تشخیص جانشینِ مکانیزمی است که در v3.78.0 **حذف** شد چون هدف‌گیری‌اش غلط بود:
 * از ۲۱۹ کاربری که «گیرکرده» شناخته شدند، ۱۸۲ نفر حتی پیامِ گارد را ندیده بودند.
 * یعنی خرابیِ آن مکانیزم **صفر خطا و صفر لاگِ قرمز** داشت و تنها کاشفش یک انسان بود
 * که اتفاقاً خودش گیرنده‌ی پیام شد. هر دو جهتِ خطای جانشینش هم همان‌قدر بی‌صداست:
 *   • منفیِ کاذب ⟶ کاربران واقعاً گیر می‌کنند و هیچ‌کس خبردار نمی‌شود.
 *   • مثبتِ کاذب ⟶ هشدار مدام شلیک می‌کند، بی‌معنا می‌شود، و یافته‌ی واقعی لای
 *     نویزش گم می‌شود (همان پینگ‌پنگِ `chmod` در بند ۳ ریشه).
 *
 * ═══ قاعده‌ی بند ۶ب-۲ ریشه: «سبزیِ حاصل از نبودِ قرمز هیچ چیز ثابت نمی‌کند» ═══
 *
 * هر ادعای **منفی** این‌جا (این الگو نباید هشدار بدهد) یک **کنترلِ مثبت** کنارش دارد
 * که ثابت می‌کند همان الگو با برداشتنِ فقط همان یک گارد **قرمز می‌شود**. وگرنه یک
 * کوئریِ خرابِ همیشه-خالی هم همه‌ی ادعاهای منفی را پاس می‌کرد.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  STUCK, IGNORED_SCREENS, maxBurst, findStuckScreens, formatAlert, stuckCycle,
} from './stuck-detect.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(process.cwd());
const Database = require(path.join(ROOT, 'bots/tarot/node_modules/better-sqlite3'));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const BASE = 1_800_000_000;           // «الان»ِ ساختگی
const H = 3600;

/* ── فیکسچر: یک دیتابیسِ در-حافظه با همان شکلِ قراردادِ shared/analytics.js ──
 * عمداً `events` واقعی ساخته می‌شود (ستونِ `event`، `props` به‌صورت JSON) نه یک شکلِ
 * ساده‌شده: اگر فردا نامِ ستون عوض شود، این چک باید قرمز شود نه اینکه کپیِ خودش را
 * بسنجد. */
function mkdb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, event TEXT NOT NULL,
      props TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE screens (
      k TEXT PRIMARY KEY, label TEXT DEFAULT '', kind TEXT DEFAULT '',
      sample TEXT DEFAULT '', buttons TEXT DEFAULT ''
    );
  `);
  db.ins = db.prepare('INSERT INTO events (user_id, event, props, created_at) VALUES (?,?,?,?)');
  return db;
}

/** n بازدید از صفحه‌ی k توسطِ هر کاربرِ uids، با فاصله‌ی spacing ثانیه، که آخرینش
 *  `agoS` ثانیه پیش از BASE است. */
function seed(db, { k, uids, n = 4, spacing = 300, agoS = H, adm = false }) {
  for (const uid of uids) {
    for (let i = 0; i < n; i++) {
      const ts = BASE - agoS - (n - 1 - i) * spacing;
      db.ins.run(uid, 'view', JSON.stringify({ k, t: 'msg', ...(adm ? { adm: 1 } : {}) }), ts);
    }
  }
}

// دستورِ /menu عمداً همان صفحه‌ی پیشنهادها را دوباره می‌فرستد. این فیکسچر شکلِ واقعیِ
// journey را می‌سازد: act پیش از view و ترتیب با id، نه با حدس از timestamp.
function seedMenuRenders(db, { k, uids, n = 4, spacing = 300, agoS = H }) {
  for (const uid of uids) {
    for (let i = 0; i < n; i++) {
      const ts = BASE - agoS - (n - 1 - i) * spacing;
      db.ins.run(uid, 'act', JSON.stringify({ a: 'cmd', d: '/menu' }), ts);
      db.ins.run(uid, 'view', JSON.stringify({ k, t: 'msg' }), ts);
    }
  }
}

// کنترلِ مثبت برای اینکه ناظر به‌اشتباه «هر عملی قبل از همان صفحه» را نادیده نگیرد.
function seedActionRenders(db, { k, uids, action = 'catalog_go', n = 4, spacing = 300, agoS = H }) {
  for (const uid of uids) {
    for (let i = 0; i < n; i++) {
      const ts = BASE - agoS - (n - 1 - i) * spacing;
      db.ins.run(uid, 'act', JSON.stringify({ a: action }), ts);
      db.ins.run(uid, 'view', JSON.stringify({ k, t: 'msg' }), ts);
    }
  }
}

const keysOf = (db, cfg) => findStuckScreens(db, { now: BASE, cfg }).map((f) => f.k);

/* ══════════════════════════════════════════════════════════════════════════
   ۱) پنجره‌ی لغزان (واحدِ پایه)
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۱) maxBurst — فشرده‌ترین خوشه، نه مجموعِ روز');
ok(maxBurst([], 7200) === 0, 'لیستِ خالی ⟶ صفر');
ok(maxBurst([100], 7200) === 1, 'یک بازدید ⟶ یک');
ok(maxBurst([0, 60, 120, 180], 7200) === 4, 'چهار بازدید در ۳ دقیقه ⟶ ۴');
// ⚠️ مهم‌ترین ادعای این بخش: مجموعِ زیاد در بازه‌ی پهن، حلقه نیست.
ok(maxBurst([0, 3 * H, 6 * H, 9 * H], 2 * H) === 1, 'چهار بازدید با فاصله‌ی ۳ ساعت ⟶ خوشه‌ی ۱ (حلقه نیست)');
ok(maxBurst([0, 100, 200, 3 * H, 3 * H + 100], 2 * H) === 3, 'دو خوشه ⟶ بزرگ‌ترین برمی‌گردد');
ok(maxBurst([0, 7200], 7200) === 2, 'مرزِ دقیقِ پنجره شامل است (≤ نه <)');

/* ══════════════════════════════════════════════════════════════════════════
   ۲) گاردِ «بیش از یک کاربر» — خواسته‌ی صریحِ مالک
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۲) یک کاربرِ دست‌وپاچلفتی هشدار نمی‌سازد، دو نفر می‌سازند');
{
  const db = mkdb();
  seed(db, { k: 'loopA', uids: [101, 102] });
  seed(db, { k: 'solo', uids: [103], n: 8 });   // هشت بار! ولی فقط یک نفر
  const found = keysOf(db);
  ok(found.includes('loopA'), 'دو کاربر روی یک صفحه ⟶ هشدار');
  ok(!found.includes('solo'), '🔒 یک کاربر، حتی با ۸ بازدید ⟶ هیچ هشداری');
  // کنترلِ مثبت: تنها چیزی که «solo» را ساکت کرده همان گارد است، نه کوئریِ خراب.
  ok(keysOf(db, { ...STUCK, MIN_USERS: 1 }).includes('solo'),
    '   ↳ کنترلِ مثبت: با MIN_USERS=1 همان الگو قرمز می‌شود');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۳) ادمین/تستر شمرده نمی‌شود
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۳) مالک پرتکرارترین «گیرکرده»ی هر دیتاست است و باید حذف شود');
{
  const db = mkdb();
  seed(db, { k: 'admloop', uids: [104, 105], n: 10, adm: true });
  ok(!keysOf(db).includes('admloop'), '🔒 دو ادمین با ۱۰ بازدید ⟶ هیچ هشداری');
  const db2 = mkdb();
  seed(db2, { k: 'admloop', uids: [104, 105], n: 10, adm: false });
  ok(keysOf(db2).includes('admloop'),
    '   ↳ کنترلِ مثبت: همان الگو بدونِ تگِ adm قرمز می‌شود');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۴) صفحه‌های ذاتاً تکرارشونده
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۴) سطلِ `content` (خروجیِ LLM) طبیعتاً چند پیام در هر فال دارد');
{
  const db = mkdb();
  seed(db, { k: 'content', uids: [106, 107], n: 9 });
  ok(!keysOf(db).includes('content'), '🔒 `content` هرگز هشدار نمی‌دهد');
  ok(IGNORED_SCREENS.has('content'), '   ↳ و دلیلش صریح در IGNORED_SCREENS است');
  const db2 = mkdb();
  seed(db2, { k: 'notcontent', uids: [106, 107], n: 9 });
  ok(keysOf(db2).includes('notcontent'),
    '   ↳ کنترلِ مثبت: همان الگو با کلیدِ دیگر قرمز می‌شود');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۵) زمان: پخش‌شده حلقه نیست، و قدیمی دیده نمی‌شود
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۵) «چهار بار در دو ساعت» یعنی فشرده، نه چهار بار در روز');
{
  const db = mkdb();
  // چهار بازدید با فاصله‌ی ۱۰۰ دقیقه: داخلِ lookback هست ولی خوشه‌اش ≤۲ است.
  seed(db, { k: 'spread', uids: [108, 109], n: 4, spacing: 100 * 60, agoS: 600 });
  ok(!keysOf(db).includes('spread'), '🔒 ناوبریِ پخش‌شده در ۵ ساعت ⟶ هیچ هشداری');
  ok(keysOf(db, { ...STUCK, WINDOW_H: 8 }).includes('spread'),
    '   ↳ کنترلِ مثبت: با پنجره‌ی ۸ ساعته همان ردیف‌ها قرمز می‌شوند');

  const old = mkdb();
  seed(old, { k: 'ancient', uids: [110, 111], agoS: 10 * H });  // بیرونِ lookback ۶ساعته
  ok(!keysOf(old).includes('ancient'), '🔒 حلقه‌ی ۱۰ ساعت پیش ⟶ دیگر هشدار نمی‌دهد');
  ok(keysOf(old, { ...STUCK, LOOKBACK_H: 24 }).includes('ancient'),
    '   ↳ کنترلِ مثبت: با lookback ۲۴ ساعته همان ردیف‌ها قرمز می‌شوند');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۵ب) 🎯 قلبِ معیار: تکرارِ **پیاپی**، نه تکرار در یک پنجره
   ──────────────────────────────────────────────────────────────────────────
   این بخش مهم‌ترین ادعای کلِ فایل است. نسخه‌ی اولِ معیار («۴ بار در ۲ ساعت») روی
   یک هفته‌ی واقعیِ رباتِ فارسی **۲۹ صفحه** را علامت زد که هیچ‌کدام باگ نبودند:
   پی‌وال، خوش‌آمد، گیتِ عضویت، تنظیمات، موجودی. همان کوئری با شرطِ «پیاپی» فقط
   **۱ صفحه** برگرداند. تفاوتِ «گیر افتادن» با «برگشتن» تکرار نیست، نبودِ پیشرفت است.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۵ب) صفحه‌ای که کاربرِ سالم به آن برمی‌گردد، حلقه نیست');
{
  // کاربرِ سالم: منو ⟶ پی‌وال ⟶ منو ⟶ پی‌وال ⟶ … چهار بار پی‌وال، ولی با پیشرفت وسطش.
  const healthy = mkdb();
  for (const uid of [701, 702]) {
    for (let i = 0; i < 4; i++) {
      healthy.ins.run(uid, 'view', JSON.stringify({ k: 'menu' }), BASE - H - (7 - i * 2) * 300);
      healthy.ins.run(uid, 'view', JSON.stringify({ k: 'paywall' }), BASE - H - (6 - i * 2) * 300);
    }
  }
  ok(!keysOf(healthy).includes('paywall'),
    '🔒 چهار بار دیدنِ پی‌وال با منو وسطش ⟶ هیچ هشداری (رها کردن، نه گیر افتادن)');

  // 🐛 کنترلِ مثبت: **همان کاربران، همان تعداد بازدید از همان صفحه** — تنها تفاوت
  // اینکه صفحه‌ی وسطی برداشته شده. اگر این قرمز نشود یعنی معیار اصلاً کار نمی‌کند.
  const stuck = mkdb();
  seed(stuck, { k: 'paywall', uids: [701, 702], n: 4, spacing: 600 });
  ok(keysOf(stuck).includes('paywall'),
    '   ↳ کنترلِ مثبت: همان ۴ بازدید بدونِ صفحه‌ی وسطی ⟶ قرمز');

  // و یک صفحه‌ی دیگر وسطِ رشته، رشته را واقعاً **می‌بندد** (نه اینکه فقط کم کند).
  const broken = mkdb();
  for (const uid of [703, 704]) {
    for (const k of ['x', 'x', 'x', 'other', 'x', 'x', 'x']) {
      broken.ins.run(uid, 'view', JSON.stringify({ k }), BASE - H);
    }
  }
  ok(!keysOf(broken).includes('x'),
    '🔒 دو رشته‌ی ۳تایی با یک صفحه وسطشان ⟶ حلقه نیست (رشته‌ها جمع نمی‌شوند)');
  const whole = mkdb();
  for (const uid of [703, 704]) {
    for (const k of ['x', 'x', 'x', 'x', 'x', 'x']) {
      whole.ins.run(uid, 'view', JSON.stringify({ k }), BASE - H);
    }
  }
  ok(keysOf(whole).includes('x'), '   ↳ کنترلِ مثبت: همان شش بازدید بدونِ وقفه ⟶ قرمز');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۵ج) `/menu` عمداً همان صفحه‌ی پیشنهادها را بازمی‌کشد
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۵ج) دستورِ آگاهانه‌ی /menu حلقه نیست، ولی loop واقعی پنهان نمی‌شود');
{
  const menu = mkdb();
  seedMenuRenders(menu, { k: 'continue', uids: [711, 712] });
  ok(!keysOf(menu).includes('continue'),
    '🔒 چهار بار /menu و همان صفحه‌ی ادامه ⟶ هشدار نمی‌دهد');

  // تنها تفاوت با نمونه‌ی بالا نوعِ عملِ کاربر است. اگر این قرمز نشود، فیلتر بیش از
  // حد وسیع شده و loop واقعیِ «تپ ⟶ همان صفحه» را هم پنهان می‌کند.
  const broken = mkdb();
  seedActionRenders(broken, { k: 'continue', uids: [711, 712] });
  ok(keysOf(broken).includes('continue'),
    '↳ کنترلِ مثبت: callback دیگری که همان صفحه را برگرداند ⟶ هشدار می‌دهد');

  const bare = mkdb();
  seed(bare, { k: 'continue', uids: [711, 712] });
  ok(keysOf(bare).includes('continue'),
    '↳ کنترلِ مثبت: بازنماییِ بدونِ /menu نیز همچنان هشدار می‌دهد');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۶) عددی که به مالک گزارش می‌شود باید همان چیزی باشد که اسمش می‌گوید
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۶) اعدادِ گزارش (باگِ نسخه‌ی اول: «۴ بازدید» به‌صورت views=1 چاپ می‌شد)');
{
  const db = mkdb();
  seed(db, { k: 'loopA', uids: [201, 202], n: 5 });
  const [f] = findStuckScreens(db, { now: BASE });
  ok(f.users === 2, `users = تعدادِ کاربرانِ متمایز (${f.users})`);
  ok(f.views === 10, `views = مجموعِ بازدیدهای واقعی، نه تعدادِ ردیفِ واجد شرط (${f.views})`);
  ok(f.uids.length === 2 && f.uids.includes('201'), 'آی‌دی‌های خام برای کوئریِ Ops برمی‌گردند');
  ok(f.lastTs === BASE - H, 'lastTs آخرین بازدید است');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۷) قدمِ قبلی و برچسبِ صفحه — چیزی که یافته را قابلِ اقدام می‌کند
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۷) قدمِ قبلی و کاتالوگِ صفحه‌ها');
{
  const db = mkdb();
  // هر دو کاربر از «menu» وارد حلقه شده‌اند.
  for (const uid of [301, 302]) db.ins.run(uid, 'view', JSON.stringify({ k: 'menu' }), BASE - 2 * H);
  seed(db, { k: 'loopA', uids: [301, 302] });
  db.prepare('INSERT INTO screens (k,label,sample,buttons) VALUES (?,?,?,?)')
    .run('loopA', 'صفحه‌ی بسته‌ها', 'یکی   از\nبسته‌ها را انتخاب کن', 'pay_1|pay_2');
  const [f] = findStuckScreens(db, { now: BASE });
  ok(f.prev === 'menu', 'قدمِ قبلی از خودِ ترتیبِ رویدادها می‌آید');
  ok(f.label === 'صفحه‌ی بسته‌ها', 'برچسب از جدولِ screens خوانده می‌شود');
  ok(f.sample === 'یکی از بسته‌ها را انتخاب کن', 'نمونه‌ی متن نرمال‌سازیِ فاصله می‌شود');
  ok(f.buttons === 'pay_1|pay_2', 'دکمه‌ها هم می‌آیند');

  // 🔒 رباتی که هنوز journey ندارد نباید این مسیر را بشکند.
  const bare = mkdb();
  bare.exec('DROP TABLE screens');
  seed(bare, { k: 'loopA', uids: [301, 302] });
  let threw = false;
  try { findStuckScreens(bare, { now: BASE }); } catch { threw = true; }
  ok(!threw, 'نبودِ جدولِ screens فقط برچسب را خالی می‌کند، کرش نمی‌کند');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۸) کول‌داون — هشداری که هر ۳۰ دقیقه تکرار شود بی‌معنا می‌شود
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۸) یک هشدار per صفحه در ۲۴ ساعت');
{
  const db = mkdb();
  seed(db, { k: 'loopA', uids: [401, 402] });
  seed(db, { k: 'loopA', uids: [401, 402], agoS: -25 * H }); // موجِ دوم، ۲۵ ساعت بعد
  const state = {};
  ok(stuckCycle(db, 'tarot', state, { now: BASE }) !== null, 'بارِ اول هشدار می‌رود');
  ok(stuckCycle(db, 'tarot', state, { now: BASE }) === null, '🔒 بارِ دوم در همان دقیقه ساکت است');
  ok(stuckCycle(db, 'tarot', state, { now: BASE + 6 * H }) === null, '🔒 شش ساعت بعد هنوز ساکت است');
  ok(stuckCycle(db, 'tarot', state, { now: BASE + 25 * H }) !== null, '۲۵ ساعت بعد دوباره هشدار می‌رود');
}
{
  // 🐛 دامِ کلاسیک: اگر مهرِ زمان روی یافته‌ی **کول‌داون‌خورده** هم بنشیند، کول‌داون در
  // هر دور تمدید می‌شود و آن هشدار **هرگز** دوباره نمی‌آید — یعنی سکوتِ دائمی.
  const db = mkdb();
  seed(db, { k: 'loopA', uids: [501, 502] });
  seed(db, { k: 'loopB', uids: [503, 504] });
  const state = { stuck: { 'tarot:loopA': BASE - H } };
  const r = stuckCycle(db, 'tarot', state, { now: BASE });
  ok(r && r.keys.join() === 'loopB', 'فقط یافته‌ی تازه گزارش می‌شود');
  ok(state.stuck['tarot:loopA'] === BASE - H, '🔒 مهرِ یافته‌ی کول‌داون‌خورده تمدید نمی‌شود');
  ok(state.stuck['tarot:loopB'] === BASE, 'مهرِ یافته‌ی گزارش‌شده نوشته می‌شود');
  // کول‌داون per ربات است: همان صفحه در رباتِ دیگر هنوز هشدار می‌دهد.
  ok(stuckCycle(db, 'tarot-ru', state, { now: BASE })?.keys.includes('loopA'),
    'کول‌داون per ربات است، نه سراسری');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۹) شکلِ پیامِ مالک — «فقط کپی کنم برای کلاد کد» (خواسته‌ی صریحِ مالک)
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۹) پیام باید آماده‌ی کپی در Claude Code باشد');
{
  const db = mkdb();
  for (const uid of [601, 602]) db.ins.run(uid, 'view', JSON.stringify({ k: 'menu' }), BASE - 2 * H);
  seed(db, { k: 'loopA', uids: [601, 602] });
  db.prepare('INSERT INTO screens (k,label,sample,buttons) VALUES (?,?,?,?)')
    .run('loopA', 'بسته‌ها', 'یکی از بسته‌ها را انتخاب کن', 'pay_1');
  const txt = formatAlert('tarot', findStuckScreens(db, { now: BASE }));
  ok(txt.includes('loopA'), 'کلیدِ صفحه در پیام هست');
  ok(txt.includes('601') && txt.includes('602'), 'آی‌دی کاربران خام در پیام هستند');
  ok(txt.includes('menu'), 'قدمِ قبلی در پیام هست');
  ok(txt.includes('یکی از بسته‌ها را انتخاب کن'), 'متنِ صفحه هست تا لازم نباشد دنبالش بگردیم');
  ok(/بررسی کن چرا/.test(txt), 'یک جمله‌ی دستوری دارد که خودش prompt است');
  ok(txt.includes('۹ب-۴'), 'یادآوریِ «هیچ پیامی خودکار به کاربر نمی‌رود» در پیام هست');
  // بند ۱۰ ریشه: هیچ «—» در متنِ رو-به-مالک. (خطِ جداکننده‌ی `─` کاراکترِ دیگری است.)
  ok(!/—|--/.test(txt), 'کپی طبق بند ۱۰: هیچ خط تیره‌ی بلند');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۱۰) ادعاهای ساختاری — این ماژول اجازه‌ی نوشتن و پیام دادن ندارد
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۱۰) بند ۹ب-۴: تشخیص خودکار، ارتباط با کاربر هرگز');
{
  const SRC = readFileSync(new URL('./stuck-detect.mjs', import.meta.url), 'utf8');
  const code = SRC.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, '');  // کامنت‌ها را کنار بگذار
  ok(!/sendMessage|api\.telegram\.org|\bfetch\s*\(/.test(code),
    '🔒 هیچ مسیرِ ارسالِ پیامی در این ماژول نیست');
  ok(!/\b(INSERT|UPDATE|DELETE|CREATE|DROP)\b/i.test(code),
    '🔒 هیچ عبارتِ نوشتنی در SQL این ماژول نیست (فقط SELECT)');
  // بند ۹ ریشه: هیچ ورودی‌ای در SQL درجا گذاشته نمی‌شود.
  const sqls = code.match(/`\n[\s\S]*?SELECT[\s\S]*?`/g) || [];
  ok(sqls.length > 0 && sqls.every((s) => !s.includes('${')),
    '🔒 SQL پارامتری است و هیچ interpolation ندارد');
  ok(/MIN_USERS:\s*2/.test(SRC), 'آستانه‌ی «بیش از ۱ کاربر» همان ۲ مانده (خواسته‌ی مالک)');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۱۱) سیم‌کشی در health-watch — ماژولِ بی‌عیبی که صدا زده نشود، وجود ندارد
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n۱۱) سیم‌کشی در ناظرِ سلامت (رفتاری: حلقه از سورس بریده و اجرا می‌شود)');
{
  const HW = readFileSync(new URL('./health-watch.mjs', import.meta.url), 'utf8');
  ok(/import \{ stuckCycle \} from '\.\/stuck-detect\.mjs'/.test(HW), 'ناظر ماژول را import می‌کند');
  ok(/await checkStuck\(state, now\)/.test(HW), 'و در هر دور صدایش می‌زند');
  // ⚠️ عمداً بیرونِ آرایه‌ی `problems`: وگرنه پایانِ یک حلقه‌ی کاربران یک «✅ رفع شد»
  // می‌ساخت که هیچ‌کس رفعش نکرده بود.
  ok(!/\.\.\.\(await checkStuck/.test(HW), '🔒 جزوِ مشکلاتِ باز/رفع‌شده نیست');

  const m = HW.match(/for \(const \[name, loc\] of HEARTBEAT_APPS\) \{\n {4}const file[\s\S]*?\n {2}\}\n/);
  ok(!!m, 'حلقه‌ی per دیتابیس در سورس پیدا شد');
  if (m) {
    const calls = [];
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fn = new AsyncFunction(
      'HEARTBEAT_APPS', 'join', 'ROOT', 'existsSync', 'Database', 'stuckCycle', 'tg', 'logErr', 'state', 'now', 'calls',
      m[0],
    );
    const stub = {
      apps: [['tarot', 'fa'], ['tarot-ru', 'ru']],
      join: (...p) => p.join('/'),
      exists: (p) => !p.endsWith('bot-ru.db'),          // فایلِ روسی روی دیسک نیست
      Database: function (file, opts) { calls.push({ file, opts }); this.close = () => {}; },
      cycle: (db, bot) => ({ text: `ALERT:${bot}`, keys: ['x'] }),
    };
    await fn(
      stub.apps, stub.join, '/r', stub.exists, stub.Database, stub.cycle,
      (t) => calls.push({ tg: t }), () => {}, {}, BASE * 1000, calls,
    );
    const opened = calls.filter((c) => c.file);
    ok(opened.length === 1 && opened[0].file === '/r/bots/tarot/data/bot-fa.db',
      'مسیرِ دیتابیسِ per زبان درست ساخته می‌شود و فایلِ نبوده رد می‌شود');
    ok(opened[0].opts?.readonly === true, '🔒 اتصال readonly است (ناظر روی DBِ زنده نمی‌نویسد)');
    ok(calls.some((c) => c.tg === 'ALERT:tarot'), 'یافته به تلگرامِ مالک می‌رود');

    // 🔒 خطای یک دیتابیس نباید بقیه را قربانی کند و نباید ناظر را بکشد.
    const c2 = [];
    let escaped = false;
    try {
      await fn(
        stub.apps, stub.join, '/r', () => true,
        function () { throw new Error('db corrupt'); },
        stub.cycle, (t) => c2.push(t), () => {}, {}, BASE * 1000, c2,
      );
    } catch { escaped = true; }
    ok(!escaped, 'دیتابیسِ خراب هشدار را از حلقه بیرون نمی‌اندازد');
  }
}

console.log(errs.length
  ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا\n   ${errs.join('\n   ')}`
  : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
