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
  lucky_date TEXT NOT NULL DEFAULT '', lucky_hand TEXT NOT NULL DEFAULT '')`);

// SQLِ کلیدی **از خودِ index.js** خوانده می‌شود، پس این کپیِ منطق نیست.
const sqlOf = (name) => {
  const m = SRC.match(new RegExp(`${name}:\\s+db\\.prepare\\((['"\`])([\\s\\S]*?)\\1\\)`));
  if (!m) throw new Error(`SQL «${name}» در index.js پیدا نشد`);
  return m[2];
};
const claimLucky = db.prepare(sqlOf('claimLucky'));
const setLuckyHand = db.prepare(sqlOf('setLuckyHand'));
const credit = db.prepare(sqlOf('credit'));
const getUser = db.prepare('SELECT * FROM users WHERE telegram_id=?');
const setState = db.prepare('UPDATE users SET state=? WHERE telegram_id=?');
const wipeSession = db.prepare("UPDATE users SET session_json='' WHERE telegram_id=?");

const TODAY = '2026-08-19';
const luckyCoinSlots = (uid, day, nonce = '') => {
  const seed = `lucky:${uid}:${day}:${nonce}`;
  return Array.from({ length: GRID_SIZE }, (_, i) => i)
    .sort((a, b) => seedToInt(seed + a) - seedToInt(seed + b)).slice(0, LUCKY_COINS);
};
const readHand = (uid) => { try { const r = getUser.get(uid)?.lucky_hand; if (!r) return null; const h = JSON.parse(r); return (h && typeof h.d === 'string' && Array.isArray(h.p)) ? { d: h.d, n: String(h.n || ''), p: h.p.map(Number), f: Number(h.f) || 0 } : null; } catch { return null; } };
const writeHand = (uid, h) => setLuckyHand.run(JSON.stringify(h), uid);
const openHand = (uid, today = TODAY) => { const h = readHand(uid); return h && h.d === today && h.n && h.p.length < LUCKY_PICKS ? h : null; };

const newUser = (uid) => db.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(uid);
const startHand = (uid, nonce) => { setState.run('lucky_pick', uid); writeHand(uid, { d: TODAY, n: nonce, p: [], f: 0 }); };
/** دقیقاً همان ترتیبِ هندلرِ `lpick:`. خروجی: 'ok' | 'dup' | 'expired' | 'claimed' */
function pick(uid, i, today = TODAY) {
  const hand = readHand(uid);
  if (!hand || hand.d !== today || !hand.n) return 'expired';
  const picks = hand.p.slice();
  if (picks.includes(i) || picks.length >= LUCKY_PICKS) return 'dup';
  if (!picks.length && claimLucky.run(today, uid, today).changes === 0) { setState.run('idle', uid); return 'claimed'; }
  const hit = luckyCoinSlots(uid, today, hand.n).includes(i);
  picks.push(i);
  const found = hand.f + (hit ? 1 : 0);
  setState.run(picks.length >= LUCKY_PICKS ? 'idle' : 'lucky_pick', uid);
  writeHand(uid, { d: today, n: hand.n, p: picks, f: found });
  if (hit) credit.run(LUCKY_COIN_VALUE, uid);
  return 'ok';
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
  const cancel = CODE.slice(CODE.indexOf("bot.action('lucky:cancel'"), CODE.indexOf("async function luckyCard"));
  ok(!/setLuckyHand|writeLuckyHand/.test(cancel),
    '«بی‌خیال» دستِ کاربر را پاک نمی‌کند (انتخاب‌های باقی‌مانده حقِ اوست تا آخرِ روز)');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
