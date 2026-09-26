// 💎 جبرانِ یک‌باره‌ی فال‌هایی که به‌خاطرِ گاردِ اشتباه «انصراف» خوردند (v3.122.0).
//
// ── مسئله (تیکتِ #TRT-1957801074 و خانواده‌اش) ────────────────────────────────
// گاردِ مرکزیِ کالبک (v3.94.3) هر دکمه‌ای را که در allowlistِ قدمِ جاری نبود «ترکِ فال»
// حساب می‌کرد و پیامِ «یه فالِ باز داری… اگه انصراف بدی الماسش برنمی‌گرده» را می‌داد. دو
// نوع تپ که **ترکِ فلو نبودند** هم همین گارد را می‌گرفتند:
//   · stale_step  تپِ تکراری یا دیررس روی دکمه‌ی قدمِ قبلیِ همین فال
//                 (`ready_breath`، `shuffle_stop`، `pick:N`) — Codex در #411 بستش.
//   · same_spread تپِ دوباره روی دکمه‌ی اندازه‌ی **همین** فال، وقتی الماسش تازه کم شده و
//                 هنوز سؤالی ننوشته — v3.122.0 بستش.
// کاربر یک بار «می‌خواهم» گفته بود و ربات جلویش دکمه‌ی انصرافِ الماس‌سوز گذاشت.
//
// ── تصمیمِ مالک (۱۴۰۵/۰۷/۰۵) ───────────────────────────────────────────────────
// «خود سیستم اگه می‌تونه بهشون پیام بده و جبران کنه، بدون دخالت من اوکی‌ام؛ فقط مراقب
// باش که هر کاری انجام می‌شه تمیز انجام بشه.» یعنی این **یک تصمیمِ انسانیِ per کوهورت**
// است (بند ۹ب-۴ ریشه)، نه یک پیامِ خودکارِ دائمی: ابزار یک‌بار اجرا می‌شود و تمام.
//
// ── چرا تشخیص از خودِ مسیر است، نه از «آخرین اقدام» ────────────────────────────
// نسخه‌ی اولِ تحلیل «آخرین اقدامِ قبل از انصراف» را ماشه می‌گرفت. ولی کاربری که با
// دکمه‌ی منو گارد را گرفت و بعد یک دکمه‌ی کهنه‌ی `pick:` زد (که عبور می‌کند و گارد
// نمی‌سازد) با آن روش «تپِ تکراری» حساب می‌شد و پولی می‌گرفت که بابتِ تصمیمِ خودش سوخته
// بود. پس ماشه این است: **اقدامی که درست قبل از خودِ پیامِ گارد آمد.** بدونِ پیامِ گارد
// در مسیر، هیچ جبرانی نیست (محافظه‌کارانه؛ «نمی‌دانم» یعنی نه).
//
// ── ترتیبِ مقدس ──────────────────────────────────────────────────────────────
// الماس **قبل از** پیام برمی‌گردد و در همان تراکنشِ ادعا. پیامِ نرسیده پول را نمی‌سوزاند
// و اجرای دوباره نه دوبار الماس می‌دهد نه دوبار پیام (دفترِ `forfeit_refund_log`).
//
// ── اجرا ─────────────────────────────────────────────────────────────────────
//   node tools/refund-forfeits-tarot.mjs <dataDir>          ← گزارش، هیچ تغییری (پیش‌فرض)
//   node tools/refund-forfeits-tarot.mjs <dataDir> --send   ← بکاپ + جبران + پیام
//   env FORFEIT_ONLY="<id>,<id>"  ← فقط این آی‌دی‌ها (تستِ زنده روی خودِ مالک)
//
// ⚠️ حریمِ خصوصی: لاگِ Ops ممکن است عمومی باشد (بند ۳ج ریشه)، پس آی‌دیِ کاربر فقط
// ماسک‌شده چاپ می‌شود و هیچ متنی از کاربر خوانده یا چاپ نمی‌شود.
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { logPush } from '../shared/journey.js';
import { track } from '../shared/analytics.js';

const require = createRequire(import.meta.url);

export const CTA_LABEL = '🔮 فال بگیر';
export const CTA_DATA = 'reading_go';
const STALE_STEP = new Set(['ready_breath', 'shuffle_stop', 'pick']);
/** پنجره‌ی جست‌وجوی مسیرِ قبل از انصراف (ثانیه). پیامِ گارد و تپِ انصراف معمولاً چند ثانیه فاصله دارند. */
const LOOKBACK_S = 900;

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const mask = (uid) => `…${String(uid).slice(-3)}`;

/* ═══════ متنِ پیام — تک‌منبع، و در چکِ CI ادعا می‌شود ═══════ */
export function messageFor(total) {
  return [
    'یه فال از تو نیمه‌کاره موند 🌿',
    '',
    'موقعِ گرفتنِ فالت، یه اختلال توی ربات پیامِ «انصراف» رو بی‌دلیل جلوت آورد و فالت بسته شد. تقصیرِ ربات بود، نه تو، و حالا برطرف شده.',
    '',
    `${fa(total)} الماسی که بابتش کم شده بود به ذخایرت برگشت ✅`,
  ].join('\n');
}

/** مسیرِ قبل از انصراف (جدیدترین اول) ⟵ ماشه‌ی گارد. خالص تا چکِ CI مستقیم بسنجدش.
 *  events: [{event:'act'|'view', a?, d?, k?}] به ترتیبِ نزولیِ id، از قبل از انصراف. */
export function triggerOf(events, isGuardKey) {
  let i = 0;
  // ۱) خودِ تپِ انصراف (ممکن است چند بار زده شده باشد)
  while (i < events.length && !(events[i].event === 'act' && /^(reading:cancel|rcancel:\d+)$/.test(events[i].d || ''))) i++;
  if (i >= events.length) return null;
  // ۲) پیامِ گاردی که آن دکمه زیرش بود
  while (i < events.length && !(events[i].event === 'view' && isGuardKey(events[i].k))) i++;
  if (i >= events.length) return null;
  // ۳) اقدامی که گارد را ساخت: اولین act قبل از پیامِ گارد
  for (i++; i < events.length; i++) if (events[i].event === 'act') return events[i];
  return null;
}

/** آیا این انصراف مالِ باگ بود؟ trigger از `triggerOf`، reading ردیفِ خودِ فال. */
export function classify(trigger, reading) {
  if (!trigger || !reading) return null;
  const a = trigger.a || '';
  if (STALE_STEP.has(a)) return 'stale_step';
  // اندازه‌ی **همین** فال، و فقط وقتی هنوز سؤالی ثبت نشده بود (یعنی استیت await_question):
  // همان جایی که v3.122.0 حالا فقط toast می‌زند. اندازه‌ی دیگر = تغییرِ نظر، جبران ندارد.
  if (a === 'spread' && trigger.d === `spread:${reading.type}`
      && !reading.question && !reading.question_audio) return 'same_spread';
  return null;
}

/** برنامه‌ی per کاربر. خالص. items: [{readingId, userId, amount, kind, compensated}] */
export function planFrom(items, { admins = new Set() } = {}) {
  const byUser = new Map();
  for (const it of items) {
    if (!it.kind || !(it.amount > 0) || admins.has(it.userId) || it.compensated) continue;
    const u = byUser.get(it.userId) || { userId: it.userId, readings: [], total: 0 };
    if (u.readings.some((r) => r.readingId === it.readingId)) continue;
    u.readings.push({ readingId: it.readingId, amount: it.amount, kind: it.kind });
    u.total += it.amount;
    byUser.set(it.userId, u);
  }
  return [...byUser.values()].sort((a, b) => a.userId - b.userId);
}

async function send(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [[{ text: CTA_LABEL, callback_data: CTA_DATA }]] },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.ok) return { ok: true };
  if (j.error_code === 429) return { ok: false, retryAfter: j.parameters?.retry_after || 5 };
  return { ok: false, fatal: j.description || 'unknown' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function scan(db) {
  const guardKeys = new Set(db.prepare(
    `SELECT k FROM screens WHERE sample LIKE 'یه فالِ باز داری%' OR buttons LIKE '%reading:cancel%'`,
  ).all().map((r) => r.k));
  const isGuardKey = (k) => guardKeys.has(k);
  const forfeits = db.prepare(`
    SELECT id, user_id, created_at,
           CAST(json_extract(props,'$.reading_id') AS INTEGER) AS reading_id,
           CAST(json_extract(props,'$.amount') AS INTEGER) AS amount
    FROM events
    WHERE event='reading_forfeited' AND json_extract(props,'$.reason')='cancel'
    ORDER BY id`).all();
  const pathOf = db.prepare(`
    SELECT event, json_extract(props,'$.a') AS a, json_extract(props,'$.d') AS d,
           json_extract(props,'$.k') AS k
    FROM events
    WHERE user_id=? AND id<? AND created_at>=? AND event IN ('act','view')
    ORDER BY id DESC LIMIT 60`);
  const readingOf = db.prepare('SELECT id, user_id, type, price, status, question, question_audio FROM readings WHERE id=?');
  // جبرانِ دستیِ قبلی (پشتیبانی) بعد از همین انصراف ⟵ دوباره پرداخت نمی‌شود.
  const laterSupport = db.prepare(`
    SELECT COUNT(*) AS n FROM events
    WHERE user_id=? AND event='credit_granted' AND created_at>=?
      AND json_extract(props,'$.kind') IN ('support','support_reading')`);

  const items = [];
  const byKind = { stale_step: 0, same_spread: 0, other: 0 };
  for (const f of forfeits) {
    const trig = triggerOf(pathOf.all(f.user_id, f.id, f.created_at - LOOKBACK_S), isGuardKey);
    const r = readingOf.get(f.reading_id);
    const ok = r && r.user_id === f.user_id && r.status === 'canceled';
    const kind = ok ? classify(trig, r) : null;
    byKind[kind || 'other']++;
    if (!kind) continue;
    items.push({
      readingId: f.reading_id, userId: f.user_id, amount: f.amount || r.price, kind,
      compensated: laterSupport.get(f.user_id, f.created_at).n > 0,
    });
  }
  return { forfeits: forfeits.length, byKind, items, guardKeys: guardKeys.size };
}

export async function run(dbFile, { token, only = [], sendReal = false, admins = new Set() }) {
  const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));
  const db = new Database(dbFile);
  db.exec(`CREATE TABLE IF NOT EXISTS forfeit_refund_log (
             reading_id  INTEGER PRIMARY KEY,
             user_id     INTEGER NOT NULL,
             amount      INTEGER NOT NULL,
             kind        TEXT    NOT NULL DEFAULT '',
             refunded_at INTEGER NOT NULL DEFAULT 0,
             sent_at     INTEGER NOT NULL DEFAULT 0
           );`);

  const { forfeits, byKind, items, guardKeys } = scan(db);
  let plan = planFrom(items, { admins });
  if (only.length) plan = plan.filter((p) => only.includes(p.userId));
  const skippedComp = items.filter((i) => i.compensated).length;

  console.log(`\n📁 ${path.basename(dbFile)} — ${fa(forfeits)} انصرافِ الماس‌سوز، ${fa(guardKeys)} کلیدِ صفحه‌ی گارد`);
  console.log(`   تپِ تکراریِ قدمِ فال: ${fa(byKind.stale_step)} · اندازه‌ی همین فال: ${fa(byKind.same_spread)} · بقیه (تصمیمِ خودِ کاربر، جبران ندارد): ${fa(byKind.other)}`);
  if (skippedComp) console.log(`   ⏭ ${fa(skippedComp)} فال رد شد (پشتیبانی از قبل جبران کرده)`);
  console.log(`   👥 ${fa(plan.length)} نفر، ${fa(plan.reduce((s, p) => s + p.total, 0))} الماس`);

  const ensureRow = db.prepare('INSERT OR IGNORE INTO forfeit_refund_log (reading_id, user_id, amount, kind) VALUES (?,?,?,?)');
  const claim = db.prepare('UPDATE forfeit_refund_log SET refunded_at=unixepoch() WHERE reading_id=? AND refunded_at=0');
  const credit = db.prepare('UPDATE users SET balance=balance+? WHERE telegram_id=?');
  const userSent = db.prepare('SELECT MAX(sent_at) AS s, SUM(amount) AS total FROM forfeit_refund_log WHERE user_id=? AND refunded_at>0');
  const markSent = db.prepare('UPDATE forfeit_refund_log SET sent_at=unixepoch() WHERE user_id=? AND refunded_at>0');

  if (sendReal && plan.length) {
    // بکاپِ همان لحظه (بند ۲ج/۹ ریشه) — هرگز بازنویسی نمی‌شود.
    const bak = `${dbFile}.pre-forfeit-refund.bak`;
    if (!existsSync(bak)) { db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`); console.log(`   💾 بکاپ: ${path.basename(bak)}`); }
  }

  let sent = 0;
  for (const p of plan) {
    const tag = `uid=${mask(p.userId)} · ${p.readings.map((r) => `#${r.readingId}(${r.kind}, ${fa(r.amount)}💎)`).join(' ')}`;
    if (!sendReal) { console.log(`   ── ${tag}`); continue; }

    // ⚠️ ترتیبِ مقدس: اول پول (اتمیک، per فال)، بعد پیام.
    db.transaction(() => {
      for (const r of p.readings) {
        ensureRow.run(r.readingId, p.userId, r.amount, r.kind);
        if (claim.run(r.readingId).changes) {
          credit.run(r.amount, p.userId);
          track(db, p.userId, 'credit_granted', { amount: r.amount, kind: 'forfeit_refund', reading_id: r.readingId });
        }
      }
    })();
    const st = userSent.get(p.userId);
    if (st?.s) { console.log(`   ⏭ ${tag} قبلاً پیام گرفته`); continue; }
    const text = messageFor(st?.total || p.total);
    let attempt = 0;
    for (;;) {
      const res = await send(token, p.userId, text);
      if (res.ok) {
        markSent.run(p.userId); sent++;
        logPush(db, p.userId, text, { label: 'forfeit_refund' });
        console.log(`   ✅ ${tag}`);
        break;
      }
      if (res.retryAfter && attempt < 3) { await sleep((res.retryAfter + 1) * 1000); attempt++; continue; }
      console.log(`   ⚠️ ${tag} پیام نرسید (${res.fatal || 'rate limit'}) — الماس برگشته است`);
      break;
    }
    await sleep(120);
  }
  if (!sendReal) console.log('\n   ℹ️ آزمایشی — هیچ الماسی جابه‌جا نشد و هیچ پیامی نرفت (برای اجرای واقعی: --send)');
  if (!sendReal && plan.length) console.log('\n   متنِ پیام (نمونه):\n' + messageFor(plan[0].total).split('\n').map((l) => '      ' + l).join('\n'));
  db.close();
  return sent;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dataDir = process.argv[2];
  const sendReal = process.argv.includes('--send');
  if (!dataDir || !existsSync(dataDir)) { console.error(`❌ مسیر data نامعتبر: ${dataDir}`); process.exit(1); }
  const envFile = path.resolve('bots/tarot/.env');
  const envTxt = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const token = process.env.BOT_TOKEN || (envTxt.match(/^BOT_TOKEN=(.+)$/m) || [])[1]?.trim() || '';
  if (!token && sendReal) { console.error('❌ BOT_TOKEN پیدا نشد'); process.exit(1); }
  const admins = new Set(String(process.env.ADMIN_IDS || (envTxt.match(/^ADMIN_IDS=(.+)$/m) || [])[1] || '')
    .split(',').map((s) => Number(s.trim())).filter(Boolean));
  const only = String(process.env.FORFEIT_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  // فقط رباتِ فارسی: کوهورتِ اندازه‌گیری‌شده همین‌جاست و متنِ پیام فارسی است.
  const total = await run(path.join(dataDir, 'bot-fa.db'), { token, only, sendReal, admins });
  if (sendReal) console.log(`\n🏁 تمام شد (${fa(total)} پیام).`);
}
