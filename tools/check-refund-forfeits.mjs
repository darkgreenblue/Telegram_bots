#!/usr/bin/env node
/* گاردِ جبرانِ فال‌هایی که به‌خاطرِ گاردِ اشتباه «انصراف» خوردند (tarot v3.122.0).
 *
 * پول و پیامِ برگشت‌ناپذیر در کار است، پس چک **رفتاری** است: ابزار را روی یک SQLite واقعی
 * با `fetch` استابی می‌دواند. مهم‌ترین ادعا این است که فقط انصرافی جبران شود که **خودِ
 * پیامِ گارد** را یک تپِ غیرناوبری ساخته بود، نه هر انصرافی که آخرین تپش آن شکل را داشت.
 */
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(ROOT, 'bots/tarot/package.json'));
const Database = require_('better-sqlite3');
const T = await import('file://' + join(ROOT, 'tools/refund-forfeits-tarot.mjs'));
const { ensureAnalytics } = await import('file://' + join(ROOT, 'shared/analytics.js'));
const { ensureJourney } = await import('file://' + join(ROOT, 'shared/journey.js'));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { errs.push(m); console.log('  ❌ ' + m); } };

const GUARD = 'g_guard';
const isGuard = (k) => k === GUARD;
const act = (a, d) => ({ event: 'act', a, d: d ?? a });
const view = (k) => ({ event: 'view', k });

/* ═══════ ۱) ماشه = اقدامی که پیامِ گارد را ساخت ═══════ */
console.log('\n▶ ۱) ماشه‌ی گارد از خودِ مسیر');
{
  // جدیدترین اول (همان ترتیبِ ORDER BY id DESC)
  const stale = [act('reading', 'reading:cancel'), view(GUARD), act('shuffle_stop'), view('x'), act('ready_breath')];
  ok(T.triggerOf(stale, isGuard)?.a === 'shuffle_stop', 'تپِ تکراریِ «توقفِ بُر» که گارد ساخت، ماشه است');
  // ⭐ کاربر با منو گارد گرفت، بعد یک دکمه‌ی کهنه‌ی pick زد (عبور می‌کند، گارد نمی‌سازد)، بعد انصراف.
  const nav = [act('reading', 'reading:cancel'), act('pick', 'pick:3'), view(GUARD), act('wallet_go')];
  ok(T.triggerOf(nav, isGuard)?.a === 'wallet_go', '⭐ آخرین تپ ماشه نیست: ناوبری که گارد ساخت ماشه است (pick بعدی نه)');
  ok(T.triggerOf([act('reading', 'reading:cancel'), act('shuffle_stop')], isGuard) === null,
    'بدونِ پیامِ گارد در مسیر هیچ ماشه‌ای نیست («نمی‌دانم» یعنی نه)');
  ok(T.triggerOf([view(GUARD), act('shuffle_stop')], isGuard) === null, 'بدونِ خودِ تپِ انصراف هیچ ماشه‌ای نیست');
  ok(T.triggerOf([act('rcancel', 'rcancel:9'), view(GUARD), act('ready_breath')], isGuard)?.a === 'ready_breath',
    'انصراف از دکمه‌ی rcancel: هم شناخته می‌شود');
}

/* ═══════ ۲) کدام انصراف مالِ باگ بود ═══════ */
console.log('\n▶ ۲) طبقه‌بندی');
{
  const r = { type: 'love3', question: '', question_audio: '' };
  ok(T.classify(act('shuffle_stop'), r) === 'stale_step', 'shuffle_stop ⟵ stale_step');
  ok(T.classify(act('ready_breath'), r) === 'stale_step', 'ready_breath ⟵ stale_step');
  ok(T.classify(act('pick', 'pick:4'), r) === 'stale_step', 'pick ⟵ stale_step');
  ok(T.classify(act('spread', 'spread:love3'), r) === 'same_spread', 'اندازه‌ی همین فال قبل از سؤال ⟵ same_spread');
  ok(T.classify(act('spread', 'spread:love5'), r) === null, '⭐ اندازه‌ی دیگر = تغییرِ نظر ⟵ جبران ندارد');
  ok(T.classify(act('spread', 'spread:love3'), { ...r, question: 'سؤال' }) === null, 'اندازه‌ی همین فال بعد از سؤال ⟵ جبران ندارد');
  ok(T.classify(act('spread', 'spread:love3'), { ...r, question_audio: 'fid' }) === null, 'سؤالِ صوتی هم «سؤال ثبت شده» است');
  ok(T.classify(act('text'), r) === null, 'متنِ آزاد ⟵ جبران ندارد (هشدار را دیده و انتخاب کرده)');
  ok(T.classify(act('kb', 'kb'), r) === null && T.classify(act('wallet_go'), r) === null, 'ناوبریِ واقعی ⟵ جبران ندارد');
  ok(T.classify(null, r) === null, 'ماشه‌ی نامعلوم ⟵ جبران ندارد');
}

/* ═══════ ۳) برنامه‌ی per کاربر ═══════ */
console.log('\n▶ ۳) برنامه');
{
  const items = [
    { readingId: 1, userId: 11, amount: 3, kind: 'stale_step' },
    { readingId: 2, userId: 11, amount: 5, kind: 'same_spread' },
    { readingId: 3, userId: 22, amount: 3, kind: 'stale_step', compensated: true },
    { readingId: 4, userId: 99, amount: 3, kind: 'stale_step' },
    { readingId: 5, userId: 33, amount: 0, kind: 'stale_step' },
    { readingId: 6, userId: 44, amount: 3, kind: null },
  ];
  const plan = T.planFrom(items, { admins: new Set([99]) });
  ok(plan.length === 1 && plan[0].userId === 11 && plan[0].total === 8, 'یک پیام per کاربر با جمعِ همه‌ی فال‌هایش');
  ok(!plan.some((p) => p.userId === 22), 'کاربری که پشتیبانی از قبل جبران کرده رد می‌شود');
  ok(!plan.some((p) => p.userId === 99), 'ادمین رد می‌شود');
  ok(!plan.some((p) => p.userId === 33 || p.userId === 44), 'مبلغِ صفر و فالِ بی‌طبقه رد می‌شوند');
}

/* ═══════ ۴) متن ═══════ */
console.log('\n▶ ۴) متنِ پیام');
{
  const t = T.messageFor(8);
  ok(t.includes('۸ الماس'), 'مبلغ با ارقامِ فارسی');
  ok(!/—|--/.test(t), 'بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)');
  ok(/تقصیرِ ربات بود/.test(t), 'صادقانه: مسئولیت با ربات است');
  const src = readFileSync(join(ROOT, 'bots/tarot/index.js'), 'utf8');
  ok(src.includes(`bot.action('${T.CTA_DATA}'`), 'دکمه‌ی پیام به یک هندلرِ زنده می‌رسد (بن‌بست نیست)');
}

/* ═══════ ۵) اجرای واقعی روی SQLite ═══════ */
console.log('\n▶ ۵) اجرا: پول قبل از پیام، یک‌بار، و بی‌خطر در اجرای دوباره');
{
  const dir = mkdtempSync(join(tmpdir(), 'forfeit-'));
  const file = join(dir, 'bot-fa.db');
  const db = new Database(file);
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
           CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, price INTEGER,
             status TEXT, question TEXT NOT NULL DEFAULT '', question_audio TEXT NOT NULL DEFAULT '');`);
  ensureAnalytics(db); ensureJourney(db);
  db.prepare("INSERT INTO screens (k, sample, buttons) VALUES (?, 'یه فالِ باز داری که تمومش نکردی 🌙', 'reading:resume|reading:cancel')").run(GUARD);
  const U = [101, 202, 303, 404];
  for (const u of U) db.prepare('INSERT INTO users (telegram_id, balance) VALUES (?, 0)').run(u);
  const ev = db.prepare('INSERT INTO events (user_id, event, props, created_at) VALUES (?,?,?,?)');
  const T0 = 1_790_000_000;
  const scenario = (uid, rid, type, trigger, { question = '' } = {}) => {
    db.prepare("INSERT INTO readings (id, user_id, type, price, status, question) VALUES (?,?,?,3,'canceled',?)").run(rid, uid, type, question);
    ev.run(uid, 'act', JSON.stringify(trigger), T0 + 1);
    ev.run(uid, 'view', JSON.stringify({ k: GUARD, t: 'msg' }), T0 + 2);
    ev.run(uid, 'act', JSON.stringify({ a: 'reading', d: 'reading:cancel' }), T0 + 5);
    ev.run(uid, 'reading_forfeited', JSON.stringify({ reading_id: rid, amount: 3, reason: 'cancel' }), T0 + 5);
  };
  scenario(101, 1, 'love3', { a: 'shuffle_stop' });                     // ✅ جبران
  scenario(202, 2, 'open3', { a: 'spread', d: 'spread:open3' });        // ✅ جبران
  scenario(303, 3, 'love3', { a: 'wallet_go' });                        // ❌ ناوبری
  scenario(404, 4, 'open3', { a: 'spread', d: 'spread:open5' });        // ❌ اندازه‌ی دیگر
  db.close();

  const sent = [];
  let mode = 'ok';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (mode === 'fail') return { json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }) };
    sent.push(body);
    return { json: async () => ({ ok: true }) };
  };
  const quiet = console.log; console.log = () => {};
  const bal = (u) => { const d = new Database(file); const b = d.prepare('SELECT balance FROM users WHERE telegram_id=?').get(u).balance; d.close(); return b; };
  const credits = () => { const d = new Database(file); const n = d.prepare("SELECT COUNT(*) n FROM events WHERE event='credit_granted' AND json_extract(props,'$.kind')='forfeit_refund'").get().n; d.close(); return n; };

  try {
    await T.run(file, { token: 'x', sendReal: false });
    console.log = quiet;
    ok(bal(101) === 0 && sent.length === 0 && !existsSync(file + '.pre-forfeit-refund.bak'), 'آزمایشی: هیچ الماس، هیچ پیام، هیچ بکاپ');

    console.log = () => {};
    mode = 'fail';
    await T.run(file, { token: 'x', sendReal: true });
    console.log = quiet;
    ok(bal(101) === 3 && bal(202) === 3, '⭐ پیامِ نرسیده پول را نمی‌سوزاند: الماس قبل از ارسال برگشته');
    ok(bal(303) === 0 && bal(404) === 0, '⭐ ناوبری و اندازه‌ی دیگر هیچ الماسی نمی‌گیرند');
    ok(existsSync(file + '.pre-forfeit-refund.bak'), 'بکاپِ همان لحظه قبل از هر نوشتن (بند ۲ج/۹)');

    console.log = () => {};
    mode = 'ok';
    await T.run(file, { token: 'x', sendReal: true });
    await T.run(file, { token: 'x', sendReal: true });
    console.log = quiet;
    ok(bal(101) === 3 && bal(202) === 3, '⭐ اجرای دوباره و سوباره: الماس دقیقاً یک بار');
    ok(credits() === 2, 'دقیقاً یک رویدادِ credit_granted per فال (kind=forfeit_refund)');
    ok(sent.length === 2 && new Set(sent.map((s) => s.chat_id)).size === 2, 'دقیقاً یک پیام per کاربر، حتی بعد از اجرای دوباره');
    ok(sent.every((s) => s.reply_markup.inline_keyboard[0][0].callback_data === T.CTA_DATA), 'پیام دکمه‌ی ادامه دارد');
    const d = new Database(file);
    ok(d.prepare("SELECT COUNT(*) n FROM events WHERE event='view' AND json_extract(props,'$.k')='forfeit_refund'").get().n === 2,
      'پیامِ مالی در تایم‌لاین ثبت می‌شود (logPush)');
    d.close();
  } finally { console.log = quiet; rmSync(dir, { recursive: true, force: true }); }
}

/* ═══════ ۶) سیم‌کشیِ Ops ═══════ */
console.log('\n▶ ۶) Ops');
{
  const ops = readFileSync(join(ROOT, '.github/workflows/ops.yml'), 'utf8');
  ok(/forfeit-dry/.test(ops) && /forfeit-send/.test(ops), 'دو اکشنِ آزمایشی و واقعی در Ops');
  ok(/tools\/refund-forfeits-tarot\.mjs bots\/tarot\/data \$SEND/.test(ops), 'Ops همین ابزار را روی دیتای tarot صدا می‌زند');
  ok(/forfeit-dry\|forfeit-send\)[\s\S]{0,900}\(\*\[!0-9,\]\*\)/.test(ops), 'لیستِ آی‌دی ضدِ تزریق است');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach((e) => console.log('   - ' + e)); process.exit(1); }
