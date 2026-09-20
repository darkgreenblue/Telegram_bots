#!/usr/bin/env node
// 🔁 چکِ بازیابیِ فالِ پرداخت‌شده‌ی نیمه‌تحویل (#215) — **رفتاری**، روی SQLite واقعیِ در-حافظه.
//
// باگی که این فایل نگهبانش است: `readingId` و `revealIdx` فقط داخلِ `users.session_json`
// زندگی می‌کردند و `setSession(uid, null)` در سیزده نقطه آن ردیف را خالی می‌کند — از جمله
// `handleStart` که هیچ گاردی ندارد. نتیجه: فالی که کاربر **پولش را داده** و متنش کامل
// تولید شده، بی‌صدا غیرقابل‌دسترس می‌شد؛ نه ریفاند، نه پیام، نه دکمه. جاروی یتیم‌ها هم
// عمداً ردش می‌کند چون فقط `llm_json=''` را نجات می‌دهد.
//
// قربانیِ واقعی: فالِ #872 کاربر 8334528761 (۵ الماس، موجودیِ صفر) در ۱۴۰۵/۰۶/۰۸، که
// پاداشِ دعوتِ معرفش را هم بی‌صدا خورد.
//
// ادعای مرکزی: **پاک‌شدنِ سشن نباید دسترسی به فالِ پرداخت‌شده را از بین ببرد.**
// SQL از خودِ `index.js` خوانده می‌شود (نه کپیِ منطق)، پس اگر کسی کوئری را عوض کند
// همان کوئریِ جدید تست می‌شود.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

// همان استخراجِ SQL که check-lucky/check-payments استفاده می‌کنند
const sqlOf = (name) => {
  const m = SRC.match(new RegExp(`${name}:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`));
  if (!m) throw new Error(`SQL «${name}» در index.js پیدا نشد`);
  return m[2];
};

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, session_json TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'idle', balance INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0,
    cards_json TEXT NOT NULL DEFAULT '', llm_json TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_payment',
    reveal_idx INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
`);
const resumable = db.prepare(sqlOf('resumableReading'));
const setIdx = db.prepare(sqlOf('setRevealIdx'));
const claimInterrupted = db.prepare(sqlOf('claimInterruptedReading'));

const CARDS = JSON.stringify([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
const LLM = JSON.stringify({ headline: 'x', reads: ['a', 'b', 'c'] });
const U = 111, OTHER = 222;
db.prepare('INSERT INTO users (telegram_id) VALUES (?),(?)').run(U, OTHER);
const mk = (uid, status, llm, cards = CARDS, idx = 0) => Number(db.prepare(
  'INSERT INTO readings (user_id, type, price, cards_json, llm_json, status, reveal_idx) VALUES (?,?,?,?,?,?,?)')
  .run(uid, 'love3', 5, cards, llm, status, idx).lastInsertRowid);

console.log('\n── ۱) فالِ نیمه‌تحویل پیدا می‌شود، حتی وقتی سشن خالی است ──');
const rid = mk(U, 'started', LLM, CARDS, 2);
db.prepare("UPDATE users SET session_json='' WHERE telegram_id=?").run(U);   // همان کاری که /start می‌کند
const found = resumable.get(U);
ok(!!found && found.id === rid, 'با سشنِ خالی هم فالِ started پیدا می‌شود');
ok(found?.reveal_idx === 2, 'پیشرفتِ افشا از خودِ رکورد خوانده می‌شود (نه از سشن)');

console.log('\n── ۲) مالکیتِ رکورد (بند ۹ ریشه) ──');
ok(!resumable.get(OTHER), 'فالِ کاربرِ دیگر برای این کاربر برنمی‌گردد');

console.log('\n── ۳) مرزِ کار با جاروی یتیم‌ها ──');
db.prepare('DELETE FROM readings').run();
mk(U, 'started', '');                       // llm خالی → کارِ recoverOrphanReadings (ریفاند)
ok(!resumable.get(U), 'فالِ بدونِ متن بازیابی نمی‌شود (ریفاند می‌شود، نه ادامه)');
db.prepare('DELETE FROM readings').run();
mk(U, 'started', LLM, '');                  // بدونِ کارت → افشا بی‌معناست
ok(!resumable.get(U), 'فالِ بدونِ کارت بازیابی نمی‌شود');

console.log('\n── ۴) وضعیت‌هایی که نباید بازیابی شوند ──');
for (const st of ['delivered', 'refunded', 'canceled', 'pending_payment', 'paid']) {
  db.prepare('DELETE FROM readings').run();
  mk(U, st, LLM);
  ok(!resumable.get(U), `وضعیتِ «${st}» بازیابی نمی‌شود`);
}

console.log('\n── ۴.۵) فالِ بدون خروجی هرگز دکمه‌ی مرده یا ریفاندِ دوباره نمی‌گیرد ──');
db.prepare('DELETE FROM readings').run();
const stale = mk(U, 'started', '', CARDS, 0);
ok(claimInterrupted.run(stale, U).changes === 1,
  'اولین بازیابیِ فالِ بدون خروجی، اتمیک آن را refunded می‌کند');
ok(claimInterrupted.run(stale, U).changes === 0,
  'تپ/مسیرِ دوم نمی‌تواند همان فال را دوباره claim یا دوباره refund کند');
ok(db.prepare('SELECT status FROM readings WHERE id=?').get(stale).status === 'refunded',
  'بعد از claim، فال از حالت started خارج شده است');

console.log('\n── ۵) تازه‌ترین فال انتخاب می‌شود ──');
db.prepare('DELETE FROM readings').run();
mk(U, 'started', LLM);
const newer = mk(U, 'started', LLM);
ok(resumable.get(U)?.id === newer, 'از بینِ چند فالِ باز، تازه‌ترین برمی‌گردد');

console.log('\n── ۶) پیشرفت فقط جلو می‌رود (دکمه‌ی کهنه عقبش نمی‌برد) ──');
db.prepare('DELETE FROM readings').run();
const r2 = mk(U, 'started', LLM, CARDS, 0);
setIdx.run(1, r2, 1);
setIdx.run(2, r2, 2);
ok(db.prepare('SELECT reveal_idx c FROM readings WHERE id=?').get(r2).c === 2, 'پیشرفت جلو می‌رود');
setIdx.run(1, r2, 1);   // تپِ کهنه‌ی کارتِ اول
ok(db.prepare('SELECT reveal_idx c FROM readings WHERE id=?').get(r2).c === 2, 'دکمه‌ی کهنه پیشرفت را عقب نمی‌برد');

console.log('\n── ۷) سیم‌کشی در خودِ index.js ──');
ok(/ALTER TABLE readings ADD COLUMN reveal_idx/.test(SRC), 'ستونِ reveal_idx مهاجرتِ افزایشی دارد');
ok(/function resumeRowFromDb\s*\(/.test(SRC), 'تابعِ resumeRowFromDb وجود دارد');
// اگر revealResumeRow فالبک نداشته باشد، کلِ این فیچر مرده است
const body = SRC.slice(SRC.indexOf('function revealResumeRow'), SRC.indexOf('function resumeRowFromDb'));
ok(/if\s*\(!rid\)\s*return resumeRowFromDb\(uid\)/.test(body),
  'revealResumeRow با سشنِ خالی به بازیابیِ DB می‌رود (نه return null)');
ok(/!r\.llm_json/.test(body),
  'revealResumeRow بدون خروجیِ مدل، دکمه‌ی «کارت بعدی» نمی‌سازد');
// پیشرفت باید هم در سشن و هم روی رکورد مهر بخورد
ok(/stmts\.setRevealIdx\.run\(/.test(SRC), 'پیشرفتِ افشا روی رکورد هم ذخیره می‌شود');
const stalled = SRC.slice(SRC.indexOf('async function resolveUnreadyReveal'), SRC.indexOf('function resumeRowFromDb'));
ok(/llmInflight\.has\(rid\)/.test(stalled),
  'تا وقتی مدل واقعاً در حال اجراست، گارد پول را پس نمی‌دهد');
ok(/claimInterruptedReading\.run\(rid, uid\)/.test(stalled) && /retryr:\$\{rid\}/.test(stalled),
  'پس از شکستِ واقعی، گارد فقط همان فال را refund و retry می‌کند');
// /start نباید بلاک شود؛ فقط پیشنهادِ ادامه بدهد
const startBlock = SRC.slice(SRC.indexOf('async function handleStart'), SRC.indexOf('bot.start(handleStart)'));
ok(/resumeRowFromDb\(uid\)/.test(startBlock), 'handleStart بعد از پاک‌کردنِ سشن ادامه را پیشنهاد می‌دهد');
ok(!/blockDuringOpenReading\(ctx/.test(startBlock),
  '/start همچنان بلاک نمی‌شود (راهِ فرارِ کاربر باز می‌ماند، بند ۹ب)');

console.log(errs.length
  ? `\n❌ ${errs.length} خطا از ${pass + errs.length} ادعا`
  : `\n✅ همه‌ی ${pass} ادعای بازیابیِ فال پاس شدند`);
process.exit(errs.length ? 1 : 0);
