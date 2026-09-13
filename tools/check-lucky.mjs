#!/usr/bin/env node
// 🎲 چکِ کارت شانس — **رفتاری**، روی یک SQLite واقعیِ در-حافظه.
//
// چرا این فایل هست: ممیزیِ فلو یک یافته داد که رها کردنِ دستِ نیمه‌کاره، روز و
// انتخاب‌های باقی‌مانده را می‌سوزاند. تأییدش شد و ریشه‌اش این بود که دست در **سشن**
// نگه داشته می‌شد و سشن در شش نقطه با `setSession(uid, null)` پاک می‌شود.
// از v3.19.0 دست روی **ردیفِ کاربر** است. این چک همان سناریوی خرابی را واقعاً اجرا
// می‌کند، نه اینکه فقط رجکس بخواند.
//
// اجرا: node tools/check-lucky.mjs
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { seedToInt, GRID_SIZE } from '../bots/tarot/reading-core.js';

const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const num = (n) => Number((SRC.match(new RegExp(`const ${n}\\s*=\\s*([0-9_]+)`)) || [])[1]?.replace(/_/g, ''));
const LUCKY_PICKS = num('LUCKY_PICKS');
const LUCKY_COINS = num('LUCKY_COINS');
const LUCKY_COIN_VALUE = num('LUCKY_COIN_VALUE');

/* ═══════ یک ماکتِ کوچک از همان منطق، با همان SQLِ خودِ ربات ═══════ */
const db = new Database(':memory:');
db.exec(`CREATE TABLE users (
  telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'idle', session_json TEXT NOT NULL DEFAULT '',
  lucky_date TEXT NOT NULL DEFAULT '', lucky_hand TEXT NOT NULL DEFAULT '',
  lucky_hands INTEGER NOT NULL DEFAULT 0)`);

// SQLِ کلیدی **از خودِ index.js** خوانده می‌شود، پس این کپیِ منطق نیست.
const sqlOf = (name) => {
  const m = SRC.match(new RegExp(`${name}:\\s+db\\.prepare\\((['"\`])([\\s\\S]*?)\\1\\)`));
  if (!m) throw new Error(`SQL «${name}» در index.js پیدا نشد`);
  return m[2];
};
const claimLucky = db.prepare(sqlOf('claimLucky'));
const bumpLuckyHands = db.prepare(sqlOf('bumpLuckyHands'));
const setLuckyHand = db.prepare(sqlOf('setLuckyHand'));
const credit = db.prepare(sqlOf('credit'));
const getUser = db.prepare('SELECT * FROM users WHERE telegram_id=?');
const setState = db.prepare('UPDATE users SET state=? WHERE telegram_id=?');
const wipeSession = db.prepare("UPDATE users SET session_json='' WHERE telegram_id=?");

const TODAY = '2026-08-19';

/* ── منطقِ حساس **از خودِ index.js** برداشته و اجرا می‌شود، نه کپی ────────────────
   چرا: نسخه‌ی اولِ این فایل چیدمان و منطقِ «کفِ دستِ اول» را دوباره در تست می‌نوشت.
   نتیجه‌اش این بود که شبیه‌سازی مدلِ **من** را می‌سنجید نه کدِ محصول را؛ در تستِ جهش
   ثابت شد: «کف را برای همه‌ی دست‌ها روشن کن» را اصلاً نمی‌دید چون کدِ محصول اجرا
   نمی‌شد. حالا همان چهار قطعه‌ی حساس از سورس بریده و با `new Function` اجرا می‌شوند،
   دقیقاً مثلِ کاری که `sqlOf` با SQL می‌کند. */
const chunk = (start, end) => {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error(`قطعه‌ی «${start}» در index.js پیدا نشد`);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error(`پایانِ قطعه‌ی «${start}» پیدا نشد`);
  return SRC.slice(i, j + end.length);
};
const fstLines = SRC.match(/^\s*fst = .+;$/gm) || [];
if (fstLines.length !== 1) throw new Error(`انتظارِ دقیقاً یک خطِ «fst = …» بود، ${fstLines.length} تا پیدا شد`);
const REAL = new Function(
  'GRID_SIZE', 'LUCKY_COINS', 'LUCKY_PICKS', 'LUCKY_FIRST_MIN', 'seedToInt', 'getUser', `
${chunk('function luckyCoinSlots(', '\n}')}
${chunk('const luckySlotsFor = ', '\n};')}
${chunk('function forcedHit(', '\n}')}
function firstFlag(uid) { let fst; ${fstLines[0].trim()} return fst; }
function decide(uid, hand, fst, i, picks) {
${chunk('  const h = { ...hand, fst };', 'const found = hand.f + (hit ? 1 : 0);')}
  return { hit, x, coinSlots, found };
}
return { luckyCoinSlots, luckySlotsFor, forcedHit, firstFlag, decide };`
)(GRID_SIZE, LUCKY_COINS, LUCKY_PICKS, num('LUCKY_FIRST_MIN'), seedToInt, (uid) => getUser.get(uid));

const { luckyCoinSlots, luckySlotsFor: slotsFor, forcedHit, firstFlag, decide } = REAL;
const readHand = (uid) => { try { const r = getUser.get(uid)?.lucky_hand; if (!r) return null; const h = JSON.parse(r); return (h && typeof h.d === 'string' && Array.isArray(h.p)) ? { d: h.d, n: String(h.n || ''), p: h.p.map(Number), f: Number(h.f) || 0, fst: h.fst ? 1 : 0, x: Array.isArray(h.x) ? h.x.map(Number) : [] } : null; } catch { return null; } };
const LUCKY_FIRST_MIN = num('LUCKY_FIRST_MIN');
const writeHand = (uid, h) => setLuckyHand.run(JSON.stringify(h), uid);
const openHand = (uid, today = TODAY) => { const h = readHand(uid); return h && h.d === today && h.n && h.p.length < LUCKY_PICKS ? h : null; };

const newUser = (uid) => db.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(uid);
const startHand = (uid, nonce) => { setState.run('lucky_pick', uid); writeHand(uid, { d: TODAY, n: nonce, p: [], f: 0, fst: 0, x: [] }); };
/** دقیقاً همان ترتیبِ هندلرِ `lpick:`. خروجی: 'ok' | 'dup' | 'expired' | 'claimed' */
function pick(uid, i, today = TODAY) {
  const hand = readHand(uid);
  if (!hand || hand.d !== today || !hand.n) return 'expired';
  const picks = hand.p.slice();
  if (picks.includes(i) || picks.length >= LUCKY_PICKS) return 'dup';
  let fst = hand.fst;
  if (!picks.length) {
    if (claimLucky.run(today, uid, today).changes === 0) { setState.run('idle', uid); return 'claimed'; }
    fst = firstFlag(uid);                    // ← همان خطِ خودِ index.js
    bumpLuckyHands.run(uid);
  }
  // ← تصمیمِ «برد/اجبار/چیدمانِ مؤثر» عیناً همان بلوکِ خودِ هندلر است (بریده از سورس)
  const { hit, x, found } = decide(uid, hand, fst, i, picks);
  setState.run(picks.length >= LUCKY_PICKS ? 'idle' : 'lucky_pick', uid);
  writeHand(uid, { d: today, n: hand.n, p: picks, f: found, fst, x });
  if (hit) credit.run(LUCKY_COIN_VALUE, uid);
  return 'ok';
}
/** یک دستِ کامل: سه انتخابِ شبه‌تصادفی. خروجی: {found, faces} — faces همان چیزی که
 *  گرید به کاربر **نشان می‌دهد** (از چیدمانِ مؤثرِ نهایی). */
function playHand(uid, day, seed) {
  const order = [...Array(GRID_SIZE).keys()].sort((a, b) => seedToInt(seed + a) - seedToInt(seed + b));
  for (let k = 0; k < LUCKY_PICKS; k++) pick(uid, order[k], day);
  const h = readHand(uid);
  const finalSlots = slotsFor(uid, h);
  return { found: h.f, picks: h.p, faces: h.p.map(i => finalSlots.includes(i)) };
}

console.log('▶ ثابت‌ها و ریاضیِ پایه');
ok(LUCKY_PICKS === 3 && LUCKY_COINS === 8 && GRID_SIZE === 24,
  `۳ انتخاب از ۲۴ کارت با ۸ الماس (${LUCKY_PICKS}/${LUCKY_COINS}/${GRID_SIZE})`);
ok(Math.abs(LUCKY_PICKS * LUCKY_COINS / GRID_SIZE - 1) < 1e-9, 'امیدِ ریاضی دقیقاً ۱ الماس در روز');

console.log('\n▶ 🐛 سناریوی خرابیِ گزارش‌شده: رها کردنِ دستِ نیمه‌کاره');
{
  newUser(1);
  startHand(1, 'nonce-A');
  ok(pick(1, 0) === 'ok', 'کارتِ اول کشیده شد');
  ok(getUser.get(1).lucky_date === TODAY, 'روز مهر خورد (طبقِ طراحی: با اولین انتخاب)');

  // کاربر «فال بگیر» می‌زند → قبلاً این‌جا سشن پاک می‌شد و دست از بین می‌رفت
  wipeSession.run(1);
  setState.run('choose_spread', 1);

  const h = openHand(1);
  ok(!!h, 'دست بعد از پاک‌شدنِ سشن **زنده مانده** (روی ردیفِ کاربر است)');
  ok(h.n === 'nonce-A', 'همان nonce، یعنی تخته عوض نمی‌شود و ورق‌های دیده‌شده جابه‌جا نمی‌شوند');
  ok(h.p.length === 1 && h.p[0] === 0, 'انتخابِ قبلی سرِ جایش است');
  ok(pick(1, 7) === 'ok' && pick(1, 13) === 'ok', 'دو انتخابِ باقی‌مانده قابلِ ادامه‌اند');
  ok(readHand(1).p.length === LUCKY_PICKS, 'دست کامل شد (هیچ انتخابی سوخته نشد)');
  ok(getUser.get(1).state === 'idle', 'بعد از کارتِ آخر استیت آزاد می‌شود');
}

console.log('\n▶ استیت هم نمی‌تواند دست را بکُشد');
{
  newUser(2); startHand(2, 'nonce-B');
  pick(2, 3);
  setState.run('daily_pick', 2);           // مثلاً کاربر رفت کارتِ روز
  ok(pick(2, 9) === 'ok', 'انتخاب حتی با استیتِ عوض‌شده کار می‌کند (استیت فقط UX است)');
  ok(readHand(2).p.length === 2, 'و ثبت می‌شود');
}

console.log('\n▶ گاردهای ضدِ سوءاستفاده دست‌نخورده‌اند');
{
  newUser(3); startHand(3, 'nonce-C');
  pick(3, 4);
  ok(pick(3, 4) === 'dup', 'همان کارت دوباره شمرده نمی‌شود');
  pick(3, 5); pick(3, 6);
  ok(pick(3, 7) === 'dup', `بیش از ${LUCKY_PICKS} انتخاب ممکن نیست`);
  ok(readHand(3).p.length === LUCKY_PICKS, 'دفتر هم بیشتر از سهمیه ثبت نکرده');

  // دستِ دیروز که در چت مانده
  newUser(4);
  setState.run('lucky_pick', 4); writeHand(4, { d: '2026-08-18', n: 'old', p: [], f: 0 });
  ok(pick(4, 0) === 'expired', 'گریدِ دیروز کار نمی‌کند');
  ok(getUser.get(4).lucky_date !== TODAY, 'و روزِ امروزش را هم نمی‌سوزاند');

  // دستِ دومِ همان روز (ریستِ ادمین): claimLucky اتمیک جلویش را می‌گیرد
  newUser(5); startHand(5, 'n1'); pick(5, 0);
  const balAfterFirst = getUser.get(5).balance;
  writeHand(5, { d: TODAY, n: 'n2', p: [], f: 0 });   // دستِ تازه بدونِ ریستِ lucky_date
  ok(pick(5, 0) === 'claimed', 'دستِ دومِ همان روز از گاردِ اتمیکِ روز رد نمی‌شود');
  ok(getUser.get(5).balance === balAfterFirst, 'و هیچ الماسِ اضافه‌ای نمی‌دهد');
}

console.log('\n▶ ریاضی و پول: شبیه‌سازیِ ۱۰٬۰۰۰ دست');
{
  let total = 0; const dist = [0, 0, 0, 0];
  for (let u = 0; u < 10_000; u++) {
    const slots = luckyCoinSlots(1000 + u, TODAY, `n${u}`);
    const board = Array.from({ length: GRID_SIZE }, (_, i) => i).sort((a, b) => seedToInt(`s${u}${a}`) - seedToInt(`s${u}${b}`));
    let f = 0;
    for (let k = 0; k < LUCKY_PICKS; k++) if (slots.includes(board[k])) f++;
    total += f; dist[f]++;
  }
  const mean = total / 10_000;
  ok(Math.abs(mean - 1) < 0.05, `میانگینِ واقعیِ الماس در هر دست ≈ ۱ (${mean.toFixed(3)})`);
  ok(dist[3] / 10_000 < 0.06, `«هر سه الماس» نادر می‌ماند (${(dist[3] / 100).toFixed(1)}٪)`);
  ok(dist.every(x => x > 0), 'هر چهار خروجی (۰ تا ۳) ممکن است');
  // چیدمانِ دو دستِ متفاوتِ همان کاربر در همان روز باید فرق کند (باگِ v3.10.1)
  const a = luckyCoinSlots(7, TODAY, 'h1').join(','), b = luckyCoinSlots(7, TODAY, 'h2').join(',');
  ok(a !== b, 'دو دستِ هم‌روزِ یک کاربر چیدمانِ متفاوت دارند (nonce کار می‌کند)');
  ok(luckyCoinSlots(7, TODAY, 'h1').join(',') === a, 'ولی داخلِ یک دست ثابت است (بستن/بازکردنِ چت بی‌اثر)');
}

console.log(`\n▶ 🎁 کفِ دستِ اول: هر کاربر در اولین تجربه‌اش حداقل ${LUCKY_FIRST_MIN} الماس می‌گیرد`);
{
  // 📌 عدد **پین** است، نه مشتق: عوض‌کردنش یک تصمیمِ محصولی/هزینه‌ای است و باید همین‌جا
  // آگاهانه به‌روز شود، نه اینکه بی‌صدا از سورس دنبالش برویم. (v3.84.0: ۲ ⟵ ۱)
  ok(LUCKY_FIRST_MIN === 1, `کف روی ${LUCKY_FIRST_MIN} الماس تنظیم شده`);

  // ── شبیه‌سازیِ ۵۰۰۰ کاربرِ تازه، هر کدام دو دستِ کامل در دو روزِ متفاوت ──
  const first = [0, 0, 0, 0], second = [0, 0, 0, 0];
  let faceMismatch = 0, firstBelowMin = 0, forcedOnPick1 = 0;
  const DAY2 = '2026-08-20';
  for (let u = 0; u < 5000; u++) {
    const id = 100000 + u;
    newUser(id);

    // دستِ اول
    setState.run('lucky_pick', id);
    writeHand(id, { d: TODAY, n: `h1-${u}`, p: [], f: 0, fst: 0, x: [] });
    const r1 = playHand(id, TODAY, `s1-${u}`);
    first[r1.found]++;
    if (r1.found < LUCKY_FIRST_MIN) firstBelowMin++;
    // 🔒 نامرئی بودن: چیزی که گرید نشان می‌دهد باید **دقیقاً** با تعدادِ الماسِ
    // واریزشده بخواند. اگر کارتی 💎 حساب شده ولی 🍂 رندر شود، کاربر تناقض می‌بیند.
    if (r1.faces.filter(Boolean).length !== r1.found) faceMismatch++;
    // انتخابِ **اول** هرگز نباید دستکاری شود (شرطِ صریحِ مالک)
    const h1 = readHand(id);
    if (h1.x.includes(h1.p[0])) forcedOnPick1++;

    // دستِ دوم، روزِ بعد — باید کاملاً شانسی باشد
    setState.run('lucky_pick', id);
    writeHand(id, { d: DAY2, n: `h2-${u}`, p: [], f: 0, fst: 0, x: [] });
    const r2 = playHand(id, DAY2, `s2-${u}`);
    second[r2.found]++;
    if (r2.faces.filter(Boolean).length !== r2.found) faceMismatch++;
  }

  ok(firstBelowMin === 0, `هیچ کاربری در دستِ اول زیرِ ${LUCKY_FIRST_MIN} الماس نگرفت (۵۰۰۰ نمونه)`);
  ok(first.slice(0, LUCKY_FIRST_MIN).every(n => n === 0),
    `دستِ اول هرگز زیرِ ${LUCKY_FIRST_MIN} الماس نمی‌دهد (سطل‌های ۰ تا ${LUCKY_FIRST_MIN - 1} خالی‌اند)`);
  ok(forcedOnPick1 === 0, 'انتخابِ **اول** هرگز دستکاری نمی‌شود (کاملاً شانسی، شرطِ مالک)');
  ok(faceMismatch === 0,
    '🔒 نامرئی: هر کارتی که الماس حساب شده روی گرید هم 💎 رندر می‌شود (هیچ تناقضی دیده نمی‌شود)');

  /* 🎲 «کاملاً شانسی به نظر برسد» یک ادعای سنجیدنی است، نه یک آرزو: تعدادِ نتیجه‌های
     **متمایزِ** ممکنِ دستِ اول باید دقیقاً `LUCKY_PICKS + 1 − LUCKY_FIRST_MIN` باشد.
     با کفِ ۲ فقط دو نتیجه ممکن بود (۲ یا ۳)؛ با کفِ ۱ سه نتیجه. این یک **کنترلِ مثبت**
     هم هست: بدونِ آن، یک `forcedHit`ِ همیشه-روشن (که همه را به سقف می‌برد) از بقیه‌ی
     ادعاها سبز رد می‌شد. */
  const distinct = first.filter(n => n > 0).length;
  ok(distinct === LUCKY_PICKS + 1 - LUCKY_FIRST_MIN,
    `دستِ اول ${distinct} نتیجه‌ی متمایز دارد (${first.map((n, k) => n ? k : null).filter(k => k !== null).join('/')} الماس) — هرچه کف پایین‌تر، شانسی‌تر`);

  // توزیعِ دستِ اول: تئوری می‌گوید ۳ الماس فقط وقتی رخ می‌دهد که کاربر **خودش**
  // هر سه را طبیعی برده باشد: (8/24)(7/23)(6/22) ≈ ۲.۷۷٪
  const p3 = first[3] / 5000;
  const theory3 = (LUCKY_COINS / GRID_SIZE) * ((LUCKY_COINS - 1) / (GRID_SIZE - 1)) * ((LUCKY_COINS - 2) / (GRID_SIZE - 2));
  ok(Math.abs(p3 - theory3) < 0.02,
    `نرخِ «هر سه الماس» در دستِ اول با تئوری می‌خواند (${(p3 * 100).toFixed(1)}٪ در برابرِ ${(theory3 * 100).toFixed(1)}٪)`);

  /* امیدِ ریاضیِ دستِ اول از **خودِ توزیعِ هایپرژئومتریک** مشتق می‌شود، نه از یک بازه‌ی
     هاردکد: E = Σ max(k, MIN) × P(k). این‌طور هر تغییرِ کف/سکه/گرید خودبه‌خود سنجیده
     می‌ماند و هزینه‌ی واقعیِ تصمیم در همین خط دیده می‌شود.
     امروز (کف ۱): ۱.۲۷۷ الماس — در برابرِ ۲.۰۲۸ با کفِ ۲ و ۱.۰۰۰ بدونِ هیچ کفی. */
  const choose = (n, r) => (r < 0 || r > n) ? 0
    : Array.from({ length: r }, (_, i) => (n - i) / (r - i)).reduce((a, b) => a * b, 1);
  const pmf = (k) => choose(LUCKY_COINS, k) * choose(GRID_SIZE - LUCKY_COINS, LUCKY_PICKS - k)
    / choose(GRID_SIZE, LUCKY_PICKS);
  const theoryFirst = Array.from({ length: LUCKY_PICKS + 1 }, (_, k) => Math.max(k, LUCKY_FIRST_MIN) * pmf(k))
    .reduce((a, b) => a + b, 0);
  const meanFirst = first.reduce((a, c, k) => a + k * c, 0) / 5000;
  ok(Math.abs(meanFirst - theoryFirst) < 0.05,
    `امیدِ ریاضیِ دستِ اول ≈ ${meanFirst.toFixed(3)} و با تئوری می‌خواند (${theoryFirst.toFixed(3)})`);
  ok(theoryFirst > 1 && theoryFirst < 1.4,
    `هزینه‌ی کف = ${(theoryFirst - 1).toFixed(3)} الماسِ اضافه، یک‌بار در عمرِ هر کاربر (با کفِ ۲ این عدد ۱.۰۲۸ بود)`);

  // ── دستِ دوم دست‌نخورده است ──
  const meanSecond = second.reduce((a, c, k) => a + k * c, 0) / 5000;
  ok(Math.abs(meanSecond - 1) < 0.06, `دستِ دوم کاملاً شانسی ماند (میانگین ${meanSecond.toFixed(3)} ≈ ۱)`);
  ok(second[0] > 0, 'و در دستِ دوم «صفر الماس» دوباره ممکن است (هیچ کفی نیست)');
  ok(second.every(x => x > 0), 'هر چهار خروجیِ ۰ تا ۳ در دستِ دوم دیده می‌شود');

  // ── سناریوهای صریحِ اسپکِ مالک، تک‌به‌تک ──
  // ⚠️ تخته را **دستکاری نمی‌کنیم**؛ به‌جایش خانه‌هایی را انتخاب می‌کنیم که طبیعتاً
  //    وضعیتِ خواسته‌شده را دارند: برای «طبیعتاً الماس» یکی از خانه‌های `luckyCoinSlots`
  //    و برای «طبیعتاً پوچ» یکی از بقیه. (نسخه‌ی اولِ این هِلپر `x` را از قبل می‌نوشت
  //    که غلط بود: `x` دفترِ الماسِ **تضمینی** است و فقط می‌تواند الماس **اضافه** کند،
  //    پس هرگز نمی‌تواند خانه‌ای را پوچ کند.)
  let scId = 900000;
  const scenario = (want) => {                 // want = آرایه‌ی سه‌تاییِ «طبیعتاً الماس؟»
    const id = ++scId;
    newUser(id);
    setState.run('lucky_pick', id);
    const nonce = 'sc';
    const base = luckyCoinSlots(id, TODAY, nonce);
    const coins = base.slice();
    const blanks = [...Array(GRID_SIZE).keys()].filter(i => !base.includes(i));
    const idxs = want.map(w => (w ? coins.shift() : blanks.shift()));
    writeHand(id, { d: TODAY, n: nonce, p: [], f: 0, fst: 0, x: [] });
    const hits = [];
    for (const i of idxs) { const before = readHand(id).f; pick(id, i); hits.push(readHand(id).f > before); }
    const h = readHand(id);
    const finalSlots = slotsFor(id, h);
    return { hits, found: h.f, forced: h.x, faces: h.p.map(i => finalSlots.includes(i)) };
  };
  const sameFaces = (s) => s.faces.every((f, k) => f === s.hits[k]);

  /* ⚠️ انتظارِ هر سناریو از **خودِ کف** مشتق می‌شود، نه هاردکد. نسخه‌ی قبلی رفتارِ کفِ ۲
     را عدد-به-عدد نوشته بود و با تغییرِ کف به ۱ سه ادعا قرمز شدند در حالی که کد کاملاً
     درست بود — یعنی چک داشت یک **مقدار** را قفل می‌کرد نه یک **قاعده**. قاعده‌ی واقعی
     این است: خانه فقط وقتی تضمینی می‌شود که رسیدن به کف از آن به بعد حسابی ناممکن باشد
     (`h.f + باقی‌مانده < MIN`)، پس تضمینی‌ها همیشه **آخرین** خانه‌هایند و تعدادشان دقیقاً
     همان کسری است که طبیعی جبران نشد. */
  const expectAllBlank = Array.from({ length: LUCKY_PICKS }, (_, k) => k >= LUCKY_PICKS - LUCKY_FIRST_MIN);

  // سناریو ۱: هر سه خانه طبیعتاً پوچ → فقط به‌اندازه‌ی کف، آن هم از آخر
  const s1 = scenario([false, false, false]);
  ok(s1.hits.join() === expectAllBlank.join() && s1.found === LUCKY_FIRST_MIN,
    `سناریو ۱: هر سه پوچ → فقط ${LUCKY_FIRST_MIN} خانه‌ی آخر تضمینی می‌شود (نتیجه ${s1.found})`);
  ok(sameFaces(s1), 'سناریو ۱: گرید هم همان الماس‌ها را نشان می‌دهد (نامرئی می‌ماند)');
  ok(s1.hits[0] === false,
    'سناریو ۱: و انتخابِ **اول** حتی در بدترین حالت هم دستکاری نمی‌شود');

  /* سناریو ۲ب: اولی طبیعتاً الماس، دو تای بعد پوچ. با کفِ ۱ همان یک الماسِ طبیعی کف را
     برآورده می‌کند و **هیچ دخالتی لازم نیست**؛ با کفِ ۲ خانه‌ی آخر تضمینی می‌شد. */
  const s2 = scenario([true, false, false]);
  const s2Forced = Math.max(0, LUCKY_FIRST_MIN - 1);
  ok(s2.hits[0] === true && s2.found === Math.max(1, LUCKY_FIRST_MIN) && s2.forced.length === s2Forced,
    `سناریو ۲ب: یک الماسِ طبیعی + دو پوچ → ${s2Forced} دخالت (نتیجه ${s2.found})`);
  ok(s2.forced.length <= 1, 'و دخالت هرگز از کمترین ممکن بیشتر نمی‌شود');

  // سناریو ۲الف: اولی و دومی طبیعتاً الماس → سومی کاملاً رها می‌شود
  const s2a = scenario([true, true, false]);
  ok(s2a.hits[2] === false && s2a.found === 2 && s2a.forced.length === 0,
    'سناریو ۲الف: دو الماسِ طبیعی → سومی دست‌نخورده می‌ماند (پوچ می‌شود، هیچ دخالتی نیست)');

  // سناریو ۳: کاربر خودش هر سه را می‌برد → هیچ دخالتی
  const s3 = scenario([true, true, true]);
  ok(s3.found === 3 && s3.forced.length === 0, 'سناریو ۳: سه الماسِ طبیعی، بدونِ هیچ دخالتی');

  // و دستِ **دوم** هیچ کفی ندارد، حتی اگر هر سه پوچ باشند
  {
    const id = ++scId;
    newUser(id);
    setState.run('lucky_pick', id);
    writeHand(id, { d: TODAY, n: 'sc', p: [], f: 0, fst: 0, x: [] });
    const base = luckyCoinSlots(id, TODAY, 'sc');
    const blanks = [...Array(GRID_SIZE).keys()].filter(i => !base.includes(i));
    for (const i of blanks.slice(0, LUCKY_PICKS)) pick(id, i);          // دستِ اول (کف‌دار)
    setState.run('lucky_pick', id);
    writeHand(id, { d: DAY2, n: 'sc2', p: [], f: 0, fst: 0, x: [] });
    const b2 = luckyCoinSlots(id, DAY2, 'sc2');
    const bl2 = [...Array(GRID_SIZE).keys()].filter(i => !b2.includes(i));
    for (const i of bl2.slice(0, LUCKY_PICKS)) pick(id, i);             // دستِ دوم
    const h2 = readHand(id);
    ok(h2.f === 0 && h2.x.length === 0,
      'دستِ دوم با سه انتخابِ پوچ واقعاً صفر می‌شود (کف فقط یک‌بار در عمرِ کاربر)');
  }
}

console.log('\n▶ سیم‌کشیِ کد');
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/ALTER TABLE users ADD COLUMN lucky_hand TEXT NOT NULL DEFAULT ''/.test(SRC),
    'ستونِ دست افزایشی اضافه شده (بند ۲ج/۱)');
  const lp = CODE.slice(CODE.indexOf('bot.action(/^lpick:'), CODE.indexOf('bot.action(/^lremind:'));
  ok(/const hand = readLuckyHand\(uid\);/.test(lp), 'هندلر دست را از ردیفِ کاربر می‌خواند');
  ok(!/getSession\(uid\)/.test(lp), 'و **هیچ** وابستگی‌ای به سشن ندارد');
  ok(!/getState\(uid\) !== 'lucky_pick'/.test(lp), 'و استیت را شرطِ ورود نمی‌کند (استیت پاک‌شدنی است)');
  ok(lp.indexOf('writeLuckyHand') < lp.indexOf('await ctx.answerCbQuery'),
    'نوشتنِ دست **قبل از** اولین await است (گاردِ دوبار-تپ)');
  ok(lp.indexOf('claimLucky') < lp.indexOf('credit.run') || /stmts\.credit\.run/.test(lp),
    'ادعای روز قبل از واریزِ الماس است');
  const lc = CODE.slice(CODE.indexOf('async function luckyCard'), CODE.indexOf('const LUCKY_LABELS'));
  ok(/const open = openLuckyHand\(uid\);\s*\n\s*if \(open\) return resumeLuckyHand/.test(lc),
    'دکمه‌ی کارت شانس دستِ نیمه‌تمام را ادامه می‌دهد، نه «امروز استفاده کردی»');
  ok(lc.indexOf('openLuckyHand') < lc.indexOf('L.lucky.already'),
    'و این چک **قبل از** پیامِ «امروز استفاده کردی» است');
  const g = CODE.slice(CODE.indexOf('async function blockDuringOpenLucky'), CODE.indexOf('bot.action(\'lucky:resume\''));
  ok(/lucky_shuffle', 'lucky_pick/.test(g), 'گارد هر دو استیتِ بازی را می‌بیند');
  ok(/if \(!h\) return false;/.test(g), 'اگر دستی برای ادامه نباشد گارد فعال نمی‌شود');
  ok((CODE.match(/blockDuringOpenLucky\(ctx/g) || []).length >= 6,
    `گارد روی نقاطِ ورودِ منو سیم شده (${(CODE.match(/blockDuringOpenLucky\(ctx/g) || []).length} نقطه)`);
  // سیم‌کشیِ کفِ دستِ اول
  ok(/ALTER TABLE users ADD COLUMN lucky_hands INTEGER NOT NULL DEFAULT 0/.test(SRC),
    'شمارنده‌ی دست‌ها ستونِ افزایشی است (بند ۲ج/۱)');
  ok(/const forced = forcedHit\(h, picks\.length, natural\);/.test(lp), 'هر انتخاب از منطقِ کف رد می‌شود');
  ok(/const hit = natural \|\| forced;/.test(lp), 'و «برد» یا طبیعی است یا اجباری');
  ok(/const coinSlots = forced \? \[\.\.\.slots, i\] : slots;/.test(lp),
    '🔒 گرید از **همان** مجموعه‌ی مؤثر رندر می‌شود (وگرنه کارتِ الماس‌شده 🍂 دیده می‌شد)');
  ok(lp.indexOf('bumpLuckyHands') > lp.indexOf('claimLucky'),
    'شمارنده **بعد از** گاردِ اتمیکِ روز بالا می‌رود (پس دقیقاً یک بار)');
  ok(!/await/.test(lp.slice(0, lp.indexOf('writeLuckyHand'))),
    'کلِ تصمیمِ کف قبل از اولین await است (ضدِ دوبار-تپ)');
  const fh = CODE.slice(CODE.indexOf('function forcedHit'), CODE.indexOf('\n}', CODE.indexOf('function forcedHit')));
  ok(/if \(!h\.fst \|\| naturalHit\) return false;/.test(fh),
    'فقط دستِ اول، و فقط وقتی کارت طبیعتاً الماس نبوده');
  ok(/h\.f \+ remainingAfterThis < LUCKY_FIRST_MIN/.test(fh),
    'و فقط وقتی بدونِ دخالت به کف نمی‌رسیدیم (کمینه‌ترین دخالتِ ممکن)');
  ok(/first: fst/.test(CODE), 'رویدادِ lucky_card propِ افزایشیِ first را دارد (قابلِ اندازه‌گیری)');

  const cancel = CODE.slice(CODE.indexOf("bot.action('lucky:cancel'"), CODE.indexOf("async function luckyCard"));
  ok(!/setLuckyHand|writeLuckyHand/.test(cancel),
    '«بی‌خیال» دستِ کاربر را پاک نمی‌کند (انتخاب‌های باقی‌مانده حقِ اوست تا آخرِ روز)');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
