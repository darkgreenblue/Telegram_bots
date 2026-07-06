// index.js — ربات فال تاروت فارسی 🔮
//
// بازسازی سفر مشتریِ یک تاروت‌خوان حرفه‌ای در تلگرام (۵ مرحله):
//  ۱) پیش‌جلسه: پرسشنامه‌ی تمرکز + سؤال کاربر (متن/ویس)
//  ۲) فضاسازی: مدیریت انتظارات + تمرین تنفس
//  ۳) خوانش: بُر زدن با توقفِ کاربر → انتخاب ۳ کارت از گرید ۲۴تایی →
//     پی‌وال دقیقاً قبل از افشا (اوج کنجکاوی) → افشای مرحله‌ای با spoiler →
//     حلقه‌ی بازخورد وسط خوانش (پاسخ منفی = فراخوانی کوچک تصحیح)
//  ۴) پایان‌بندی: روایت پیوندی + سه قدم عملی + جمله‌ی توانمندساز
//  ۵) قلاب بازگشت: مدیاگروپ یادگاری + milestone ۱۴روزه + کد تخفیف اولین خرید + رفرال
//
// مغز فالگیر: google/gemini-2.5-flash (OpenRouter) — تک‌فراخوانی per فال، پیش‌فراخوانی بعد از انتخاب کارت سوم.
// چندزبانه: همه‌ی متن‌ها/پرامپت‌ها از locales/<LOCALE>.js؛ هر زبان بعداً یک اپ pm2 جدا با ENV_FILE خودش.
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import { mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import CARDS, { CARD_BY_KEY } from './cards.js';
import SPREADS, { DAILY, SPREAD_BY_ID } from './spreads.js';

/* ===== 0) Logger ===== */
function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function log(...a)    { console.log(`[${ts()}]`,   ...a); }
function logErr(...a) { console.error(`[${ts()}]`, ...a); }

/* ===== 1) ENV و ثابت‌ها ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { logErr('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const LOCALE = process.env.LOCALE?.trim() || 'fa';
const L = (await import(`./locales/${LOCALE}.js`)).default;
const fmt = L.fmt;

const FLASH          = 'google/gemini-2.5-flash';
const FALLBACK_MODEL = 'deepseek/deepseek-v3.2'; // هم‌سطح Flash و ارزان‌تر — وقتی Flash بعد از ۳ تلاش جواب نداد
const OR_TIMEOUT_MS  = 10 * 60 * 1000;
const MAX_VOICE_SEC  = 120;              // سقف طول ویسِ سؤال — جلوی هزینه‌ی رونویسیِ نامحدود قبل از پرداخت
const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_PREFETCH_PER_DAY = 15;         // سقف پیش‌فراخوانی LLM per کاربر — ضد حلقه‌ی «انتخاب کن، لغو کن»

// ⚠️ TEST_PHASE: تا وقتی true است دکمه‌ی «ریست ربات (تست)» برای همه فعال است.
// قبل از انتشار عمومی حتماً false شود (دکمه کلاً مخفی می‌شود؛ /reset فقط برای OWNER می‌ماند).
const TEST_PHASE = true;

const ADMIN_IDS = [100257975];
const OWNER_ID  = 100257975;
const isAdmin = (uid) => ADMIN_IDS.includes(uid);

const CARD_NUMBER = '6219861904145405';
const CARD_OWNER  = 'علیرضا اولیا — بلوبانک';

const WELCOME_GIFT     = 30_000;  // دقیقاً قیمت فال سه‌کارتی — «فال اول مهمان ما»
const MIN_RECHARGE     = 50_000;
const QUICK_AMOUNTS    = [50_000, 100_000, 200_000];
const REFERRAL_BONUS   = 10_000;
const FIRST_PAID_DISCOUNT = { percent: 20, hours: 72 };
const MILESTONE_DAYS   = 14;
const PUSH_COOLDOWN_S  = 7 * 24 * 3600; // حداکثر یک پوش پیشگیرانه در هفته
const REVERSAL_PROB    = 0.3;
const GRID_SIZE        = 24; // ۶ ردیف × ۴
const USER_PICKS       = 3;  // حداکثر تعداد انتخاب کاربر از گرید (فال کوچک‌تر = به تعداد خودش)

const PACE_S = 1200, PACE_M = 2500, PACE_REVEAL = 3500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ===== 2) Database ===== */
mkdirSync('./data', { recursive: true });
const db = new Database(`./data/bot-${LOCALE}.db`);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id       INTEGER PRIMARY KEY,
    name              TEXT    NOT NULL DEFAULT '',
    username          TEXT    NOT NULL DEFAULT '',
    state             TEXT    NOT NULL DEFAULT 'new',
    balance           INTEGER NOT NULL DEFAULT 0,
    focus_area        TEXT    NOT NULL DEFAULT '',
    last_daily_date   TEXT    NOT NULL DEFAULT '',
    session_json      TEXT    NOT NULL DEFAULT '',
    next_milestone_at INTEGER,
    last_push_at      INTEGER NOT NULL DEFAULT 0,
    referred_by       INTEGER,
    welcomed          INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen         INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT    NOT NULL,
    price       INTEGER NOT NULL,
    focus_area  TEXT    NOT NULL DEFAULT '',
    question    TEXT    NOT NULL DEFAULT '',
    seed        TEXT    NOT NULL DEFAULT '',
    cards_json  TEXT    NOT NULL DEFAULT '',
    llm_json    TEXT    NOT NULL DEFAULT '',
    summary     TEXT    NOT NULL DEFAULT '',
    feedback    TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending_payment',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    amount           INTEGER NOT NULL DEFAULT 0,
    status           TEXT    NOT NULL DEFAULT 'pending',
    step             TEXT,
    receipt_file_id  TEXT,
    admin_message_id INTEGER,
    discount_code_id INTEGER,
    original_amount  INTEGER,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS discount_codes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT    NOT NULL UNIQUE,
    discount_percent  INTEGER NOT NULL,
    expires_at        INTEGER,
    max_uses_per_user INTEGER NOT NULL DEFAULT 1,
    only_user_id      INTEGER,
    is_active         INTEGER NOT NULL DEFAULT 1,
    total_uses        INTEGER NOT NULL DEFAULT 0,
    created_by        INTEGER NOT NULL,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS discount_uses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id         INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    payment_id      INTEGER,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    used_at         INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS referrals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referee_id  INTEGER NOT NULL UNIQUE,
    rewarded    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS card_files (
    card_key   TEXT PRIMARY KEY,
    file_id    TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()
  `),
  getUser:    db.prepare('SELECT * FROM users WHERE telegram_id=?'),
  setState:   db.prepare('UPDATE users SET state=?, last_seen=unixepoch() WHERE telegram_id=?'),
  setFocus:   db.prepare('UPDATE users SET focus_area=? WHERE telegram_id=?'),
  setWelcomed: db.prepare('UPDATE users SET welcomed=1 WHERE telegram_id=?'),
  setSession: db.prepare('UPDATE users SET session_json=? WHERE telegram_id=?'),
  setDaily:   db.prepare('UPDATE users SET last_daily_date=? WHERE telegram_id=?'),
  setMilestone: db.prepare('UPDATE users SET next_milestone_at=? WHERE telegram_id=?'),
  setPush:    db.prepare('UPDATE users SET last_push_at=unixepoch(), next_milestone_at=NULL WHERE telegram_id=?'),
  setReferredBy: db.prepare('UPDATE users SET referred_by=? WHERE telegram_id=?'),
  credit:     db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id=?'),
  deduct:     db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id=? AND balance >= ?'),
  dueMilestones: db.prepare(`
    SELECT telegram_id FROM users
    WHERE next_milestone_at IS NOT NULL AND next_milestone_at <= unixepoch()
      AND last_push_at < unixepoch() - ${PUSH_COOLDOWN_S}
    LIMIT 20
  `),

  insertReading: db.prepare(`INSERT INTO readings (user_id, type, price, focus_area, question, seed, cards_json) VALUES (?,?,?,?,?,?,?)`),
  getReading:    db.prepare('SELECT * FROM readings WHERE id=?'),
  setReadingLlm: db.prepare('UPDATE readings SET llm_json=?, summary=? WHERE id=?'),
  setReadingStatus: db.prepare('UPDATE readings SET status=? WHERE id=?'),
  setReadingFeedback: db.prepare('UPDATE readings SET feedback=? WHERE id=?'),
  lastDelivered: db.prepare("SELECT * FROM readings WHERE user_id=? AND status='delivered' ORDER BY id DESC LIMIT ?"),
  countReadingsToday: db.prepare('SELECT COUNT(*) AS c FROM readings WHERE user_id=? AND created_at >= unixepoch()-86400'),
  countDelivered: db.prepare("SELECT COUNT(*) AS c FROM readings WHERE user_id=? AND status='delivered'"),
  countPaidDelivered: db.prepare("SELECT COUNT(*) AS c FROM readings WHERE user_id=? AND status='delivered' AND price>0"),
  readingsByType: db.prepare("SELECT type, COUNT(*) AS c, COALESCE(SUM(price),0) AS s FROM readings WHERE status='delivered' GROUP BY type"),

  insertPayment: db.prepare("INSERT INTO payments (user_id, amount, step) VALUES (?, 0, 'amount')"),
  getPayment:    db.prepare('SELECT * FROM payments WHERE id=?'),
  setPaymentAmount:  db.prepare("UPDATE payments SET amount=?, step=?, updated_at=unixepoch() WHERE id=?"),
  setPaymentStatus:  db.prepare('UPDATE payments SET status=?, updated_at=unixepoch() WHERE id=?'),
  setPaymentReceipt: db.prepare('UPDATE payments SET receipt_file_id=?, admin_message_id=?, status=?, updated_at=unixepoch() WHERE id=?'),
  setPaymentDiscount: db.prepare('UPDATE payments SET discount_code_id=?, original_amount=COALESCE(original_amount, amount), amount=?, updated_at=unixepoch() WHERE id=?'),
  dailyRevenue:   db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='approved' AND created_at >= unixepoch()-86400"),
  monthlyRevenue: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='approved' AND created_at >= unixepoch()-2592000"),
  totalRevenue:   db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='approved'"),
  countUsers:     db.prepare('SELECT COUNT(*) AS c FROM users'),

  getDiscountCode:     db.prepare('SELECT * FROM discount_codes WHERE code=? AND is_active=1'),
  getDiscountById:     db.prepare('SELECT * FROM discount_codes WHERE id=?'),
  insertDiscountCode:  db.prepare('INSERT INTO discount_codes (code, discount_percent, expires_at, max_uses_per_user, only_user_id, created_by) VALUES (?,?,?,?,?,?)'),
  incDiscountUses:     db.prepare('UPDATE discount_codes SET total_uses=total_uses+1 WHERE id=?'),
  insertDiscountUse:   db.prepare('INSERT INTO discount_uses (code_id, user_id, payment_id, discount_amount) VALUES (?,?,?,?)'),
  getUserDiscountUses: db.prepare('SELECT COUNT(*) AS c FROM discount_uses WHERE code_id=? AND user_id=?'),
  countPendingDiscount: db.prepare("SELECT COUNT(*) AS c FROM payments WHERE discount_code_id=? AND user_id=? AND status IN ('pending','waiting_review')"),

  insertReferral: db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referee_id) VALUES (?,?)'),
  getReferralByReferee: db.prepare('SELECT * FROM referrals WHERE referee_id=?'),
  setReferralRewarded:  db.prepare('UPDATE referrals SET rewarded=1 WHERE id=?'),

  getCardFile: db.prepare('SELECT file_id FROM card_files WHERE card_key=?'),
  setCardFile: db.prepare('INSERT INTO card_files (card_key, file_id, updated_at) VALUES (?,?,unixepoch()) ON CONFLICT(card_key) DO UPDATE SET file_id=excluded.file_id, updated_at=unixepoch()'),
};

/* ===== 3) هلپرهای کاربر/سشن ===== */
function upsertUser(ctx) {
  const before = stmts.getUser.get(ctx.from.id);
  stmts.upsertUser.run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
  return { isNew: !before };
}
const getUser  = (uid) => stmts.getUser.get(uid);
const getState = (uid) => getUser(uid)?.state || 'new';
const setState = (uid, s) => stmts.setState.run(s, uid);
const getBalance = (uid) => getUser(uid)?.balance || 0;

function getSession(uid) {
  const raw = getUser(uid)?.session_json;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function setSession(uid, s) { stmts.setSession.run(s ? JSON.stringify(s) : '', uid); }
function patchSession(uid, patch) { const s = getSession(uid); Object.assign(s, patch); setSession(uid, s); return s; }

// پاک‌سازی کامل یک کاربر — فاز تست (شامل کیف‌پول، چون فقط پول هدیه است)
function wipeUser(uid) {
  for (const [t, col] of [['users','telegram_id'],['readings','user_id'],['payments','user_id'],['discount_uses','user_id'],['referrals','referee_id']]) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(uid); } catch (e) { logErr('wipe', t, e.message); }
  }
  prefetches.delete(uid);
}

function normalizeDigits(s) {
  return String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}
const tehranToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ===== 4) OpenRouter ===== */
async function orRequest(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OR_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      logErr(`❌ OpenRouter ${res.status} (${body.model}) after ${Date.now() - t0}ms:`, errBody.slice(0, 300));
      throw new Error(`OpenRouter error ${res.status}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    const u = data.usage || {};
    log(`✅ ${body.model} in ${Date.now() - t0}ms | tok(in/out)=${u.prompt_tokens ?? '?'}/${u.completion_tokens ?? '?'}`);
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function orChat(system, user, opts = {}) {
  return orRequest({
    model: opts.model || FLASH,
    temperature: opts.temperature ?? 0.9,
    max_tokens: opts.maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
}
// فراخوانی مقاوم: چند تلاش با مدل اصلی، بعد مدل فالبک؛ validate اختیاری برای ردکردن خروجی خراب
async function orChatResilient(system, user, opts = {}, plan = [FLASH, FLASH, FLASH, FALLBACK_MODEL, FALLBACK_MODEL]) {
  for (let i = 0; i < plan.length; i++) {
    try {
      const out = await orChat(system, user, { ...opts, model: plan[i] });
      if (!opts.validate || opts.validate(out)) return { out, model: plan[i] };
      logErr(`LLM invalid output (attempt ${i + 1}, ${plan[i]})`);
    } catch (e) {
      logErr(`LLM error (attempt ${i + 1}, ${plan[i]}):`, e.message);
    }
    if (i < plan.length - 1) await sleep(1500);
  }
  return null;
}
function orTranscribe(audioBuffer, format) {
  return orRequest({
    model: FLASH,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.' },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ] }],
  });
}
function parseJsonLoose(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch (e) { logErr('JSON parse failed:', e.message, '| head:', t.slice(0, 120)); return null; }
}

/* ===== 5) موتور دک (شافل قطعی از seed) ===== */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedToInt(seedStr) {
  return createHash('sha256').update(seedStr).digest().readUInt32LE(0);
}
// دک شافل‌شده + جهت هر کارت — کاملاً قطعی از روی seed (بعد از ری‌استارت هم همان است)
function shuffledDeck(seedStr) {
  const rng = mulberry32(seedToInt(seedStr));
  const deck = CARDS.map(c => c.key);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.map(key => ({ key, reversed: rng() < REVERSAL_PROB }));
}
// کارت‌های نهایی خوانش: انتخاب‌های کاربر از گرید + بقیه از «جای بریدن دک»
// مهم: برای فال‌های کوچک‌تر از تعداد انتخاب (مثل آری/نه ۲کارتی) فقط size کارت اول
function drawCards(seedStr, picks, size) {
  const deck = shuffledDeck(seedStr);
  const chosen = picks.slice(0, size).map(i => deck[i]);
  let cursor = GRID_SIZE;
  while (chosen.length < size) chosen.push(deck[cursor++]);
  return chosen;
}

/* ===== 6) هلپرهای تلگرام ===== */
const TG_LIMIT = 3800;
async function replyLong(ctx, text, extra) {
  for (let i = 0; i < text.length; i += TG_LIMIT) {
    const isLast = i + TG_LIMIT >= text.length;
    await ctx.reply(text.slice(i, i + TG_LIMIT), isLast ? extra : undefined);
  }
}
// ارسال عکس کارت با کش file_id (اولین بار از فایل، بعد از آن از file_id تلگرام)
async function sendCardPhoto(ctx, cardKey, caption, { spoiler = true } = {}) {
  const cached = stmts.getCardFile.get(cardKey)?.file_id;
  const media = cached || { source: `./assets/cards/${cardKey === 'back' ? 'back.jpg' : CARD_BY_KEY[cardKey].file}` };
  const msg = await ctx.replyWithPhoto(media, { caption, has_spoiler: spoiler });
  if (!cached) {
    const fid = msg.photo?.[msg.photo.length - 1]?.file_id;
    if (fid) stmts.setCardFile.run(cardKey, fid);
  }
  return msg;
}
async function typing(ctx, ms, action = 'typing') {
  try { await ctx.sendChatAction(action); } catch {}
  await sleep(ms);
}

function mainKeyboard() {
  const rows = [
    [L.buttons.daily, L.buttons.reading],
    [L.buttons.wallet],
  ];
  if (TEST_PHASE) rows.push([L.buttons.resetTest]);
  return Markup.keyboard(rows).resize();
}

/* ===== 7) LLM خوانش — پیش‌فراخوانی و ساخت کانتکست ===== */
const prefetches = new Map(); // uid -> Promise<object|null> (فقط بهینه‌سازی؛ منبع حقیقت readings.llm_json)

function buildReadingCtx(user, spread, question, cards) {
  const prev = stmts.lastDelivered.all(user.telegram_id, 2)
    .map(r => ({ 'خلاصه': r.summary, 'بازخورد کاربر': r.feedback || '-' }));
  return {
    name: user.name || '',
    focusFa: L.focusFa[user.focus_area] || user.focus_area || '-',
    question,
    spreadFa: spread.fa,
    cards: cards.map((c, i) => ({
      positionFa: spread.positions[i]?.fa || `کارت ${i + 1}`,
      fa: CARD_BY_KEY[c.key].fa,
      en: CARD_BY_KEY[c.key].en,
      reversed: c.reversed,
      up: CARD_BY_KEY[c.key].up,
      down: CARD_BY_KEY[c.key].down,
    })),
    previous: prev,
    today: tehranToday(),
  };
}

async function callReadingLLM(readingId) {
  const r = stmts.getReading.get(readingId);
  if (!r) return null;
  const user = getUser(r.user_id);
  const spread = SPREAD_BY_ID[r.type];
  const cards = JSON.parse(r.cards_json);
  const ctx = buildReadingCtx(user, spread, r.question, cards);
  const system = L.prompts.readerSystem(spread);
  const userMsg = L.prompts.readingContext(ctx);
  // ۳ تلاش Flash → ۲ تلاش DeepSeek؛ خروجی فقط با JSON معتبر و کامل پذیرفته می‌شود
  let parsed = null;
  const res = await orChatResilient(system, userMsg, {
    maxTokens: spread.maxTokens,
    validate: (out) => {
      const obj = parseJsonLoose(out);
      if (obj && Array.isArray(obj.cards) && obj.cards.length >= cards.length && obj.narrative) { parsed = obj; return true; }
      return false;
    },
  });
  if (!res || !parsed) { logErr(`reading#${readingId} همه‌ی تلاش‌ها شکست خورد (REFUND path)`); return null; }
  log(`reading#${readingId} آماده شد با ${res.model}`);
  stmts.setReadingLlm.run(JSON.stringify(parsed), String(parsed.summary || '').slice(0, 300), readingId);
  return parsed;
}

function startPrefetch(uid, readingId) {
  const p = callReadingLLM(readingId).catch(e => { logErr('prefetch:', e.message); return null; });
  prefetches.set(uid, p);
  return p;
}
// نتیجه‌ی LLM؛ اگر پیش‌فراخوانی از دست رفته بود (مثلاً ری‌استارت) دوباره صدا می‌زند
async function awaitReadingLLM(uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (r?.llm_json) { try { return JSON.parse(r.llm_json); } catch {} }
  const p = prefetches.get(uid);
  const result = p ? await p : await callReadingLLM(readingId);
  prefetches.delete(uid);
  if (result) return result;
  const r2 = stmts.getReading.get(readingId);
  if (r2?.llm_json) { try { return JSON.parse(r2.llm_json); } catch {} }
  return null;
}

/* ===== 8) Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: OR_TIMEOUT_MS });
let BOT_USERNAME = '';

// گارد خطای سراسری: هیچ خطایی نباید بی‌صدا فلو را بکشد — لاگ کامل + پیام عذرخواهی به کاربر
bot.catch(async (err, ctx) => {
  logErr(`global error [${ctx.updateType}] uid=${ctx.from?.id} state=${ctx.from ? getState(ctx.from.id) : '-'}:`, err.stack || err.message);
  try { await ctx.reply(L.errors.generic); } catch {}
});

/* ---------- آنبوردینگ و /start ---------- */
async function handleStart(ctx) {
  const uid = ctx.from.id;
  const { isNew } = upsertUser(ctx);
  const user = getUser(uid);

  // رفرال: /start ref_<id>
  const payload = (ctx.startPayload ?? ctx.message?.text?.split(/\s+/)[1] ?? '').trim();
  const refMatch = payload.match(/^ref_(\d+)$/);
  let refBonus = false;
  if (refMatch && isNew) {
    const refId = parseInt(refMatch[1], 10);
    if (refId !== uid && getUser(refId)) {
      stmts.insertReferral.run(refId, uid);
      stmts.setReferredBy.run(refId, uid);
      refBonus = true;
    }
  }

  if (!user.welcomed) {
    stmts.setWelcomed.run(uid);
    stmts.credit.run(WELCOME_GIFT, uid);
    if (refBonus) stmts.credit.run(REFERRAL_BONUS, uid);
    await ctx.reply(L.onboarding.welcome(ctx.from.first_name, WELCOME_GIFT), mainKeyboard());
    if (refBonus) await ctx.reply(L.share.referralWelcome(REFERRAL_BONUS));
    await typing(ctx, PACE_S);
    setState(uid, 'onboard_focus');
    await ctx.reply(L.onboarding.askFocus, Markup.inlineKeyboard(
      L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
    ));
    return;
  }

  // کاربر برگشتی
  setState(uid, 'idle');
  setSession(uid, null);
  let msg = L.returning.greeting(ctx.from.first_name, getBalance(uid));
  const last = stmts.lastDelivered.all(uid, 1)[0];
  if (user.next_milestone_at && user.next_milestone_at <= Date.now() / 1000 && last?.summary) {
    try { msg += L.returning.milestoneHook(JSON.parse(last.llm_json)?.next_milestone?.text || last.summary); } catch {}
  } else if (user.last_daily_date !== tehranToday()) {
    msg += L.returning.dailyReminder;
  }
  await ctx.reply(msg, mainKeyboard());
}
bot.start(handleStart);

bot.action(/^focus:(\w+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const key = ctx.match[1];
  stmts.setFocus.run(key, uid);
  const inOnboarding = getState(uid) === 'onboard_focus';
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.onboarding.focusSaved(L.focusFa[key] || key));
  if (inOnboarding) {
    await typing(ctx, PACE_M);
    setState(uid, 'idle');
    await ctx.reply(L.onboarding.expectations, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.dailyAfterOnboard, 'daily_go')],
    ]));
  } else {
    // تغییر تمرکز وسط فلوی فال
    setState(uid, 'await_question');
    const s = getSession(uid);
    const spread = SPREAD_BY_ID[s.spreadId];
    if (spread) await ctx.reply(L.reading.askQuestion());
  }
});

/* ---------- کارت روز (رایگان، روزی یک‌بار) ---------- */
async function dailyCard(ctx) {
  const uid = ctx.from.id;
  upsertUser(ctx);
  const user = getUser(uid);
  const today = tehranToday();
  if (user.last_daily_date === today) {
    return ctx.reply(L.daily.alreadyUsed, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.startThree(SPREAD_BY_ID.three.price, false), 'spread:three')],
    ]));
  }
  stmts.setDaily.run(today, uid);
  const [card] = shuffledDeck(`daily:${uid}:${today}`);
  const info = CARD_BY_KEY[card.key];

  // فراخوانی LLM همین حالا فایر می‌شود و با مکث‌های فضاسازی هم‌پوشان است (۲×Flash → ۱×فالبک)
  const llmP = orChatResilient(L.prompts.dailySystem, L.prompts.dailyContext({
    name: user.name, focusFa: L.focusFa[user.focus_area] || '-', card: info, reversed: card.reversed,
  }), { maxTokens: DAILY.maxTokens }, [FLASH, FLASH, FALLBACK_MODEL])
    .then(r => r?.out || null).catch(e => { logErr('daily LLM:', e.message); return null; });

  await typing(ctx, PACE_M);
  await ctx.reply(L.daily.drawing);
  await typing(ctx, PACE_M, 'upload_photo');
  await sendCardPhoto(ctx, card.key, L.daily.caption(info, card.reversed));
  await typing(ctx, PACE_REVEAL);
  const text = await llmP;
  if (text) await ctx.reply(text);
  await sleep(PACE_M);
  const paidCount = stmts.countPaidDelivered.get(uid).c;
  const canGift = getBalance(uid) >= SPREAD_BY_ID.three.price && paidCount === 0;
  await ctx.reply(L.daily.upsell, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.startThree(SPREAD_BY_ID.three.price, canGift), 'spread:three')],
  ]));
}
bot.hears(L.buttons.daily, dailyCard);
bot.action('daily_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return dailyCard(ctx); });

/* ---------- فال پولی: کاتالوگ → تمرکز → سؤال ---------- */
async function showCatalog(ctx) {
  const uid = ctx.from.id;
  upsertUser(ctx);
  setState(uid, 'choose_spread');
  setSession(uid, null);
  const lines = SPREADS.map(s => L.reading.spreadLine(s)).join('\n\n');
  await ctx.reply(`${L.reading.catalog}\n\n${lines}`, Markup.inlineKeyboard(
    SPREADS.map(s => [Markup.button.callback(L.buttons.spread(s), `spread:${s.id}`)])
  ));
}
bot.hears(L.buttons.reading, showCatalog);

bot.action(/^spread:(\w+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  upsertUser(ctx);
  const spread = SPREAD_BY_ID[ctx.match[1]];
  if (!spread) return;
  patchSession(uid, { spreadId: spread.id, picks: [] });
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  const user = getUser(uid);
  if (user.focus_area) {
    setState(uid, 'confirm_focus');
    await ctx.reply(L.reading.confirmFocus(L.focusFa[user.focus_area] || user.focus_area), Markup.inlineKeyboard([
      [Markup.button.callback(L.reading.keepFocus(L.focusFa[user.focus_area] || user.focus_area), 'keepfocus')],
      ...L.buttons.focusOptions.filter(([k]) => k !== user.focus_area)
        .map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)]),
    ]));
  } else {
    setState(uid, 'confirm_focus');
    await ctx.reply(L.onboarding.askFocus, Markup.inlineKeyboard(
      L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
    ));
  }
});

bot.action('keepfocus', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  const spread = SPREAD_BY_ID[getSession(uid).spreadId];
  if (!spread) return ctx.reply(L.errors.stateLost, mainKeyboard());
  setState(uid, 'await_question');
  await ctx.reply(L.reading.askQuestion());
});

/* ---------- دریافت سؤال → فضاسازی → تنفس ---------- */
async function handleQuestion(ctx, question) {
  const uid = ctx.from.id;
  const spread = SPREAD_BY_ID[getSession(uid).spreadId];
  if (!spread) { setState(uid, 'idle'); return ctx.reply(L.errors.stateLost, mainKeyboard()); }
  patchSession(uid, { question: question.slice(0, 1500) });
  setState(uid, 'breathing');
  await typing(ctx, PACE_S);
  await ctx.reply(L.reading.atmosphere1);
  await typing(ctx, PACE_M);
  await ctx.reply(L.reading.atmosphere2);
  await typing(ctx, PACE_M);
  await ctx.reply(L.reading.breathing, Markup.inlineKeyboard([[Markup.button.callback(L.buttons.ready, 'ready_breath')]]));
}

/* ---------- بُر زدن با توقف کاربر ---------- */
bot.action('ready_breath', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'breathing') return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  setState(uid, 'shuffling');
  await typing(ctx, PACE_S, 'upload_photo');
  await sendCardPhoto(ctx, 'back', L.reading.shuffleCaption, { spoiler: false });
  const m = await ctx.reply(L.reading.shuffleFrames[0], Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.stopShuffle, 'shuffle_stop')],
  ]));
  patchSession(uid, { shuffleMsgId: m.message_id });
  // انیمیشن شافل: بُر زدن ادامه دارد تا خودِ کاربر «نگه‌دار» را بزند — هرگز خودکار جلو نمی‌رویم.
  // بعد از ~۲ دقیقه فقط ادیت‌کردن متوقف می‌شود (ریت‌لیمیت تلگرام) ولی دکمه سر جایش می‌ماند.
  (async () => {
    for (let i = 1; i < 90; i++) {
      await sleep(1300);
      if (getState(uid) !== 'shuffling' || getSession(uid).shuffleMsgId !== m.message_id) return;
      const frame = L.reading.shuffleFrames[i % L.reading.shuffleFrames.length];
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, m.message_id, undefined, frame, {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback(L.buttons.stopShuffle, 'shuffle_stop')]]).reply_markup,
        });
      } catch {}
    }
  })().catch(e => logErr('shuffle anim:', e.message));
});

bot.action('shuffle_stop', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery('✋').catch(() => {});
  if (getState(uid) !== 'shuffling') return;
  await startPicking(ctx, uid, getSession(uid).shuffleMsgId);
});

function pickGridKb(picks) {
  const rows = [];
  for (let r = 0; r < 6; r++) {
    rows.push(Array.from({ length: 4 }, (_, c) => {
      const i = r * 4 + c;
      return Markup.button.callback(picks.includes(i) ? '✨' : '🂠', `pick:${i}`);
    }));
  }
  return Markup.inlineKeyboard(rows);
}

async function startPicking(ctx, uid, shuffleMsgId) {
  // seed قطعی: بعد از این لحظه شافل و جهت کارت‌ها ثابت است (حتی بعد از ری‌استارت)
  const seed = `r:${uid}:${shuffleMsgId}:${Date.now()}`;
  const spread = SPREAD_BY_ID[getSession(uid).spreadId];
  // فال‌های کوچک‌تر (مثل آری/نه ۲کارتی) به تعداد خودشان انتخاب می‌خواهند
  const need = Math.min(USER_PICKS, spread?.size || USER_PICKS);
  setState(uid, 'picking'); // قبل از هر await — گارد برابر دوباره‌کاری
  patchSession(uid, { seed, picks: [], need });
  if (shuffleMsgId) {
    try { await ctx.telegram.editMessageText(ctx.chat.id, shuffleMsgId, undefined, '🂠 ✋'); } catch {}
  }
  await ctx.reply(L.reading.pickPrompt(need), pickGridKb([]));
}

bot.action(/^pick:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  const i = parseInt(ctx.match[1], 10);
  if (getState(uid) !== 'picking') return ctx.answerCbQuery().catch(() => {});
  // ثبت همگام قبل از هر await — ضد race در کلیک‌های پشت‌سرهم
  const s = getSession(uid);
  const need = s.need || USER_PICKS;
  if (!s.picks || s.picks.includes(i) || s.picks.length >= need) {
    return ctx.answerCbQuery().catch(() => {});
  }
  s.picks.push(i);
  const done = s.picks.length >= need;
  if (done) setState(uid, 'confirm_pay'); // قفل فوری قبل از await
  setSession(uid, s);

  await ctx.answerCbQuery('✨').catch(() => {});
  try { await ctx.editMessageReplyMarkup(pickGridKb(s.picks).reply_markup); } catch {}
  if (!done) return;
  await finishPicking(ctx, uid, s);
});

async function finishPicking(ctx, uid, s) {
  const spread = SPREAD_BY_ID[s.spreadId];
  const user = getUser(uid);
  const cards = drawCards(s.seed, s.picks, spread.size);
  const readingId = Number(stmts.insertReading.run(
    uid, spread.id, spread.price, user.focus_area, s.question || '', s.seed, JSON.stringify(cards)
  ).lastInsertRowid);
  patchSession(uid, { readingId });

  // پیش‌فراخوانی LLM فقط وقتی کاربر توان پرداخت دارد (هزینه‌ی قبل از پرداخت = صفر برای کاربرِ بدون موجودی)
  // + سقف روزانه ضد حلقه‌ی «انتخاب کن، لغو کن». در غیر این صورت فراخوانی موقع unlock انجام می‌شود.
  const readingsToday = stmts.countReadingsToday.get(uid).c;
  if (getBalance(uid) >= spread.price && readingsToday <= MAX_PREFETCH_PER_DAY) {
    startPrefetch(uid, readingId);
  }

  await typing(ctx, PACE_M);
  if (spread.size > s.picks.length) await ctx.reply(L.reading.extraCardsNote(spread.size - s.picks.length));

  const balance = getBalance(uid);
  if (balance >= spread.price) {
    await ctx.reply(L.reading.paywall(spread.price), Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.openCards(spread.price), `unlock:${readingId}`)],
      [Markup.button.callback(L.buttons.cancel, `rcancel:${readingId}`)],
    ]));
  } else {
    await ctx.reply(L.reading.paywall(spread.price));
    await sleep(PACE_S);
    await ctx.reply(L.reading.paywallShort(spread.price, balance), Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.recharge, 'recharge')],
      [Markup.button.callback(L.buttons.cancel, `rcancel:${readingId}`)],
    ]));
  }
}

bot.action(/^rcancel:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const readingId = parseInt(ctx.match[1], 10);
  const r = stmts.getReading.get(readingId);
  if (r && r.user_id === uid && r.status === 'pending_payment') stmts.setReadingStatus.run('canceled', readingId);
  prefetches.delete(uid);
  setState(uid, 'idle');
  setSession(uid, null);
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.canceled, mainKeyboard());
});

/* ---------- پی‌وال → کسر → افشای مرحله‌ای ---------- */
bot.action(/^unlock:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  const readingId = parseInt(ctx.match[1], 10);
  const r = stmts.getReading.get(readingId);
  if (!r || r.user_id !== uid) return ctx.answerCbQuery().catch(() => {});
  if (r.status !== 'pending_payment') return ctx.answerCbQuery('✅').catch(() => {});
  // کسر اتمیک (WHERE balance >= price) — قبل از هر await وضعیت را قفل می‌کنیم
  if (r.price > 0) {
    const res = stmts.deduct.run(r.price, uid, r.price);
    if (res.changes === 0) {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.reply(L.reading.paywallShort(r.price, getBalance(uid)), Markup.inlineKeyboard([
        [Markup.button.callback(L.buttons.recharge, 'recharge')],
      ]));
    }
  }
  stmts.setReadingStatus.run('started', readingId);
  setState(uid, 'revealing');
  patchSession(uid, { readingId, revealIdx: 0, fbDone: false });
  await ctx.answerCbQuery('🔮').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await startReveal(ctx, uid, readingId);
});

// پیام لودینگ پویا تا آماده‌شدن LLM (اگر پیش‌فراخوانی هنوز نرسیده باشد)
async function waitLLMWithLoading(ctx, uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (r?.llm_json) { try { return JSON.parse(r.llm_json); } catch {} }
  const msg = await ctx.reply(L.reading.loading[0]);
  let i = 1, done = false;
  (async () => { // پیام لودینگ پویا؛ بدون await تا افشا معطل نماند
    while (!done) {
      await sleep(5000);
      if (done) break;
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, L.reading.loading[i % L.reading.loading.length]);
      } catch {}
      i++;
    }
  })().catch(() => {});
  const result = await awaitReadingLLM(uid, readingId);
  done = true;
  try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch {}
  return result;
}

async function startReveal(ctx, uid, readingId) {
  const llm = await waitLLMWithLoading(ctx, uid, readingId);
  const r = stmts.getReading.get(readingId);
  if (!llm) {
    // شکست نهایی (بعد از ۳×Flash + ۲×فالبک) → برگشت کامل مبلغ + دکمه‌ی تلاش مجدد از همان نقطه
    if (r && r.status === 'started') {
      if (r.price > 0) stmts.credit.run(r.price, uid);
      stmts.setReadingStatus.run('refunded', readingId);
    }
    setState(uid, 'idle');
    setSession(uid, null);
    return ctx.reply(L.reading.refunded, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.retry, `retryr:${readingId}`)],
    ]));
  }
  await revealNext(ctx, uid, readingId);
}

// تلاش مجدد بعد از refund: همان کارت‌ها و همان سؤال — فقط فراخوانی LLM از نو
bot.action(/^retryr:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  const readingId = parseInt(ctx.match[1], 10);
  const r = stmts.getReading.get(readingId);
  if (!r || r.user_id !== uid) return ctx.answerCbQuery().catch(() => {});
  if (r.status !== 'refunded') return ctx.answerCbQuery('✅').catch(() => {});
  if (r.price > 0) {
    const res = stmts.deduct.run(r.price, uid, r.price);
    if (res.changes === 0) {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.reply(L.reading.paywallShort(r.price, getBalance(uid)), Markup.inlineKeyboard([
        [Markup.button.callback(L.buttons.recharge, 'recharge')],
      ]));
    }
  }
  stmts.setReadingStatus.run('started', readingId);
  setState(uid, 'revealing');
  setSession(uid, { spreadId: r.type, readingId, revealIdx: 0, fbDone: false });
  await ctx.answerCbQuery('🔮').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await startReveal(ctx, uid, readingId);
});

async function revealNext(ctx, uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (!r || !r.llm_json) return;
  const llm = JSON.parse(r.llm_json);
  const cards = JSON.parse(r.cards_json);
  const spread = SPREAD_BY_ID[r.type];
  const s = getSession(uid);
  const idx = s.revealIdx || 0;
  if (idx >= cards.length) return finishReading(ctx, uid, readingId);

  const card = cards[idx];
  const info = CARD_BY_KEY[card.key];
  patchSession(uid, { revealIdx: idx + 1 }); // قبل از await — دکمه‌ی تکراری دوباره همین کارت را نفرستد

  await typing(ctx, PACE_S, 'upload_photo');
  await sendCardPhoto(ctx, card.key, L.reading.revealCaption(spread.positions[idx]?.fa || `کارت ${idx + 1}`, info, card.reversed));
  await sleep(PACE_REVEAL);
  await typing(ctx, PACE_S);

  const interp = llm.cards[idx]?.text || '';
  const isLast = idx === cards.length - 1;
  const midIdx = Math.floor((cards.length - 1) / 2);
  const askFeedback = idx === midIdx && !s.fbDone && llm.confirmation_question;

  if (askFeedback) {
    await ctx.reply(esc(interp), { parse_mode: 'HTML' });
    await sleep(PACE_M);
    setState(uid, 'feedback');
    await ctx.reply(llm.confirmation_question, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.fbYes, `fb:yes:${readingId}`)],
      [Markup.button.callback(L.buttons.fbSomewhat, `fb:some:${readingId}`)],
      [Markup.button.callback(L.buttons.fbNo, `fb:no:${readingId}`)],
    ]));
    return;
  }

  await ctx.reply(esc(interp), {
    parse_mode: 'HTML',
    // دکمه شماره‌ی کارتِ بعدی را حمل می‌کند تا دابل‌تاچ/دکمه‌ی کهنه هرگز کارت تکراری یا پرشی نفرستد
    ...(isLast ? {} : Markup.inlineKeyboard([[Markup.button.callback(L.buttons.nextCard, `next:${readingId}:${idx + 1}`)]])),
  });
  if (isLast) await finishReading(ctx, uid, readingId);
}

bot.action(/^next:(\d+):(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery('🎴').catch(() => {});
  const readingId = parseInt(ctx.match[1], 10);
  const expectIdx = parseInt(ctx.match[2], 10);
  const s = getSession(uid);
  if (getState(uid) !== 'revealing' || s.readingId !== readingId || (s.revealIdx || 0) !== expectIdx) return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await revealNext(ctx, uid, readingId);
});

/* ---------- حلقه‌ی بازخورد وسط خوانش ---------- */
async function handleFeedback(ctx, uid, readingId, kind, freeText) {
  const r = stmts.getReading.get(readingId);
  if (!r) return;
  const llm = r.llm_json ? JSON.parse(r.llm_json) : null;
  stmts.setReadingFeedback.run(freeText ? `text: ${freeText.slice(0, 300)}` : kind, readingId);
  patchSession(uid, { fbDone: true });
  setState(uid, 'revealing');

  if (kind === 'no' || freeText) {
    // مثل فالگیر واقعی: زاویه‌ی تفسیر با یک فراخوانی کوچک تصحیح می‌شود (فالبک: جمله‌ی همدلانه‌ی آماده)
    await typing(ctx, PACE_M);
    const s = getSession(uid);
    const midIdx = (s.revealIdx || 1) - 1;
    const cards = JSON.parse(r.cards_json);
    const recal = await orChatResilient(L.prompts.feedbackSystem, L.prompts.feedbackContext({
      confirmationQuestion: llm?.confirmation_question || '',
      userAnswer: freeText || 'نه دقیقاً',
      card: CARD_BY_KEY[cards[midIdx]?.key]?.fa || '',
      cardText: llm?.cards?.[midIdx]?.text || '',
      question: r.question,
    }), { maxTokens: 300 }, [FLASH, FALLBACK_MODEL])
      .then(res => res?.out || null).catch(e => { logErr('feedback LLM:', e.message); return null; });
    await ctx.reply(recal || L.reading.recalFallback);
  } else {
    const bridges = L.reading.positiveBridges;
    await ctx.reply(bridges[Math.floor((readingId + (kind === 'yes' ? 0 : 1)) % bridges.length)]);
  }
  await sleep(PACE_M);
  await revealNext(ctx, uid, readingId);
}

bot.action(/^fb:(yes|some|no):(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'feedback') return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await handleFeedback(ctx, uid, parseInt(ctx.match[2], 10), ctx.match[1], null);
});

/* ---------- پایان‌بندی + قلاب بازگشت ---------- */
// پیشنهاد شخصی‌سازی‌شده‌ی فال بعدی: بر اساس حوزه‌ی تمرکز کاربر + آنچه هنوز تجربه نکرده
const FOCUS_SUGGEST = {
  love:     ['love', 'choice', 'inner', 'celtic'],
  career:   ['career', 'money', 'choice', 'celtic'],
  money:    ['money', 'career', 'choice', 'celtic'],
  inner:    ['inner', 'three', 'love', 'celtic'],
  question: ['choice', 'yesno', 'three', 'celtic'],
};
function suggestSpreads(uid, currentType) {
  const focus = getUser(uid)?.focus_area || 'question';
  const tried = new Set(stmts.lastDelivered.all(uid, 10).map(x => x.type));
  const pool = [...(FOCUS_SUGGEST[focus] || []), ...SPREADS.map(s => s.id)];
  const fresh = pool.filter(id => id !== currentType && SPREAD_BY_ID[id] && !tried.has(id));
  const any   = pool.filter(id => id !== currentType && SPREAD_BY_ID[id]);
  const ids = [...new Set([...fresh, ...any])].slice(0, 2);
  return ids.map(id => SPREAD_BY_ID[id]);
}
async function finishReading(ctx, uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (!r || r.status !== 'started') return;
  const llm = JSON.parse(r.llm_json);
  const cards = JSON.parse(r.cards_json);

  // روایت پیوندی
  await typing(ctx, PACE_M);
  await replyLong(ctx, `🧵 ${llm.narrative}`);

  // سه قدم عملی + توانمندسازی
  await sleep(PACE_M);
  const items = (llm.action_items || []).slice(0, 3).map((a, i) => `${fmt(i + 1)}. ${a}`).join('\n');
  await ctx.reply(`${L.reading.actionHeader}\n\n${items}`);
  await sleep(PACE_M);
  await ctx.reply(L.reading.empowerClose);

  stmts.setReadingStatus.run('delivered', readingId);
  setState(uid, 'idle');
  setSession(uid, null);

  // پاداش رفرال: بعد از اولین فال کاملِ دعوت‌شده، دعوت‌کننده هم هدیه می‌گیرد
  try {
    const ref = stmts.getReferralByReferee.get(uid);
    if (ref && !ref.rewarded && stmts.countDelivered.get(uid).c === 1) {
      stmts.setReferralRewarded.run(ref.id);
      stmts.credit.run(REFERRAL_BONUS, ref.referrer_id);
      const referee = getUser(uid);
      await bot.telegram.sendMessage(ref.referrer_id, L.share.referralReward(referee?.name, REFERRAL_BONUS)).catch(() => {});
    }
  } catch (e) { logErr('referral reward:', e.message); }

  // یادگاری: مدیاگروپ کارت‌ها (file_id کش‌شده) با خلاصه
  await typing(ctx, PACE_M, 'upload_photo');
  try {
    const media = cards.map((c, i) => ({
      type: 'photo',
      media: stmts.getCardFile.get(c.key)?.file_id || { source: `./assets/cards/${CARD_BY_KEY[c.key].file}` },
      ...(i === 0 ? { caption: L.reading.deliverableCaption(llm.summary || '') } : {}),
    }));
    await ctx.replyWithMediaGroup(media);
  } catch (e) { logErr('media group:', e.message); }

  // milestone ۱۴روزه بی‌صدا ذخیره می‌شود (فقط برای قلاب /start و پوش چک‌این) —
  // پیام «بعداً برگرد» ضد ریتنشن فوری است؛ به‌جایش پیشنهاد شخصی‌سازی‌شده‌ی فال بعدی:
  await sleep(PACE_M);
  const days = Math.min(Math.max(parseInt(llm.next_milestone?.days, 10) || MILESTONE_DAYS, 7), 90);
  stmts.setMilestone.run(Math.floor(Date.now() / 1000) + days * 86400, uid);
  const offers = suggestSpreads(uid, r.type);
  await ctx.reply(L.reading.nextOffers, Markup.inlineKeyboard([
    ...offers.map(sp => [Markup.button.callback(L.buttons.spread(sp), `spread:${sp.id}`)]),
    [Markup.button.switchToChat(L.buttons.share, '')],
  ]));

  // کد تخفیف شخصی بعد از اولین فال کامل (کاربر ارزش را چشیده — بهترین لحظه‌ی آفر خوانش دوم)
  try {
    const paidCount = stmts.countPaidDelivered.get(uid).c;
    if (r.price > 0 && paidCount === 1) {
      const code = `TAR${String(readingId).padStart(4, '0')}${Math.abs(seedToInt(r.seed) % 100)}`;
      stmts.insertDiscountCode.run(code, FIRST_PAID_DISCOUNT.percent,
        Math.floor(Date.now() / 1000) + FIRST_PAID_DISCOUNT.hours * 3600, 1, uid, 0);
      await sleep(PACE_S);
      await ctx.reply(L.reading.firstPaidGift(code, FIRST_PAID_DISCOUNT.percent, FIRST_PAID_DISCOUNT.hours));
    }
  } catch (e) { logErr('first-paid gift:', e.message); }

  await ctx.reply('🌙', mainKeyboard());
}

/* ---------- کیف پول و شارژ (کارت‌به‌کارت + تأیید ادمین) ---------- */
async function showWallet(ctx) {
  upsertUser(ctx);
  await ctx.reply(L.wallet.info(getBalance(ctx.from.id)), {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback(L.buttons.recharge, 'recharge')]]).reply_markup,
  });
}
bot.hears(L.buttons.wallet, showWallet);

bot.action('recharge', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  upsertUser(ctx);
  const paymentId = Number(stmts.insertPayment.run(uid).lastInsertRowid);
  setState(uid, 'pay_amount');
  patchSession(uid, { paymentId });
  const s = getSession(uid);
  // مبلغ پیشنهادی: اگر وسط فال گیر کرده، دقیقاً کسری + رند به بالا
  let amounts = QUICK_AMOUNTS;
  if (s.readingId) {
    const r = stmts.getReading.get(s.readingId);
    if (r && r.status === 'pending_payment') {
      const shortfall = Math.max(r.price - getBalance(uid), 0);
      const suggested = Math.max(MIN_RECHARGE, Math.ceil(shortfall / 10000) * 10000);
      amounts = [...new Set([suggested, ...QUICK_AMOUNTS])].sort((a, b) => a - b).slice(0, 4);
    }
  }
  await ctx.reply(L.wallet.askAmount(MIN_RECHARGE), Markup.inlineKeyboard([
    ...amounts.map(a => [Markup.button.callback(L.buttons.rechargeAmount(a), `ramt:${a}`)]),
    [Markup.button.callback(L.buttons.customAmount, 'rcustom')],
    [Markup.button.callback(L.buttons.cancel, `pay_cancel:${paymentId}`)],
  ]));
});

async function setRechargeAmount(ctx, uid, amount) {
  const s = getSession(uid);
  if (!s.paymentId) return ctx.reply(L.errors.stateLost, mainKeyboard());
  stmts.setPaymentAmount.run(amount, 'receipt', s.paymentId);
  setState(uid, 'pay_receipt');
  await ctx.reply(L.wallet.invoice(amount, CARD_NUMBER, CARD_OWNER), {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.discountHave, `disc:${s.paymentId}`)],
      [Markup.button.callback(L.buttons.cancel, `pay_cancel:${s.paymentId}`)],
    ]).reply_markup,
  });
}

bot.action(/^ramt:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (getState(ctx.from.id) !== 'pay_amount') return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await setRechargeAmount(ctx, ctx.from.id, parseInt(ctx.match[1], 10));
});
bot.action('rcustom', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (getState(ctx.from.id) !== 'pay_amount') return;
  await ctx.reply(L.wallet.askAmount(MIN_RECHARGE));
});
bot.action(/^disc:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'pay_receipt') return;
  setState(uid, 'pay_discount');
  await ctx.reply(L.wallet.askDiscount);
});
bot.action(/^pay_cancel:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const p = stmts.getPayment.get(parseInt(ctx.match[1], 10));
  if (p && p.user_id === uid && ['pending'].includes(p.status)) stmts.setPaymentStatus.run('canceled', p.id);
  const s = getSession(uid);
  delete s.paymentId;
  setSession(uid, s);
  setState(uid, s.readingId ? 'confirm_pay' : 'idle');
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.canceled, mainKeyboard());
  // اگر فال رزروشده‌ای منتظر است، دکمه‌هایش را دوباره جلوی کاربر بگذار تا سرگردان نماند
  await offerPendingReading(ctx, uid);
});

function validateDiscount(code, userId, amount) {
  const dc = stmts.getDiscountCode.get(normalizeDigits(code).trim().toUpperCase());
  if (!dc) return { ok: false };
  if (dc.expires_at && dc.expires_at < Date.now() / 1000) return { ok: false };
  if (dc.only_user_id && dc.only_user_id !== userId) return { ok: false };
  const uses = stmts.getUserDiscountUses.get(dc.id, userId).c + stmts.countPendingDiscount.get(dc.id, userId).c;
  if (uses >= dc.max_uses_per_user) return { ok: false };
  const disc = Math.round(amount * dc.discount_percent / 100);
  return { ok: true, dc, finalAmount: Math.max(0, amount - disc) };
}

async function applyDiscount(ctx, uid, codeText) {
  const s = getSession(uid);
  const p = s.paymentId && stmts.getPayment.get(s.paymentId);
  if (!p) { setState(uid, 'idle'); return ctx.reply(L.errors.stateLost, mainKeyboard()); }
  const v = validateDiscount(codeText, uid, p.original_amount || p.amount);
  if (!v.ok) { setState(uid, 'pay_receipt'); return ctx.reply(L.wallet.badDiscount); }
  stmts.setPaymentDiscount.run(v.dc.id, v.finalAmount, p.id);
  setState(uid, 'pay_receipt');
  await ctx.reply(L.wallet.invoiceDiscounted(p.original_amount || p.amount, v.finalAmount, v.dc.code), { parse_mode: 'Markdown' });
  if (v.finalAmount === 0) {
    // کد ۱۰۰٪ → تأیید خودکار بدون رسید
    await approvePayment(p.id, null);
    await ctx.reply(L.wallet.freeApproved);
    await afterApproval(uid);
  } else {
    await ctx.reply(L.wallet.invoice(v.finalAmount, CARD_NUMBER, CARD_OWNER), { parse_mode: 'Markdown' });
  }
}

async function sendReceiptToAdmin(ctx, uid, paymentId, photoFileId, textBody) {
  const user = getUser(uid);
  const p = stmts.getPayment.get(paymentId);
  const caption = L.wallet.adminNotify(p, user) + (textBody ? `\n\n📋 ${textBody.slice(0, 500)}` : '');
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback(L.buttons.approve(paymentId), `approve:${paymentId}`),
    Markup.button.callback(L.buttons.reject(paymentId), `reject:${paymentId}`),
  ]]).reply_markup;
  let adminMsg;
  for (const adminId of ADMIN_IDS) {
    try {
      const sent = photoFileId
        ? await ctx.telegram.sendPhoto(adminId, photoFileId, { caption, reply_markup: kb })
        : await ctx.telegram.sendMessage(adminId, caption, { reply_markup: kb });
      if (!adminMsg) adminMsg = sent;
    } catch {}
  }
  stmts.setPaymentReceipt.run(photoFileId || null, adminMsg?.message_id || null, 'waiting_review', paymentId);
}

function approvePayment(paymentId) {
  const p = stmts.getPayment.get(paymentId);
  if (!p || !['pending', 'waiting_review'].includes(p.status)) return null;
  const creditAmount = p.original_amount || p.amount;
  stmts.setPaymentStatus.run('approved', paymentId);
  stmts.credit.run(creditAmount, p.user_id);
  if (p.discount_code_id) {
    stmts.incDiscountUses.run(p.discount_code_id);
    stmts.insertDiscountUse.run(p.discount_code_id, p.user_id, paymentId, (p.original_amount || p.amount) - p.amount);
  }
  return { p, creditAmount };
}

// پیشنهاد دوباره‌ی فال رزروشده (بعد از انصراف پرداخت، پیام متنی وسط پی‌وال و…)
async function offerPendingReading(ctx, uid) {
  const s = getSession(uid);
  const r = s.readingId && stmts.getReading.get(s.readingId);
  if (!r || r.status !== 'pending_payment') return false;
  const balance = getBalance(uid);
  if (balance >= r.price) {
    await ctx.reply(L.reading.paywall(r.price), Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.openCards(r.price), `unlock:${r.id}`)],
      [Markup.button.callback(L.buttons.cancel, `rcancel:${r.id}`)],
    ]));
  } else {
    await ctx.reply(L.reading.paywallShort(r.price, balance), Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.recharge, 'recharge')],
      [Markup.button.callback(L.buttons.cancel, `rcancel:${r.id}`)],
    ]));
  }
  return true;
}

// مهم‌ترین اهرم کانورژن: بعد از تأیید شارژ، فالِ رزروشده خودکار ادامه پیدا می‌کند
async function afterApproval(uid) {
  const s = getSession(uid);
  delete s.paymentId;
  setSession(uid, s);
  if (s.readingId) {
    const r = stmts.getReading.get(s.readingId);
    if (r && r.status === 'pending_payment') {
      setState(uid, 'confirm_pay');
      await bot.telegram.sendMessage(uid, L.reading.resumeAfterRecharge, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(L.buttons.openCards(r.price), `unlock:${r.id}`)],
        ]).reply_markup,
      }).catch(() => {});
      return;
    }
  }
  setState(uid, 'idle');
}

bot.action(/^approve:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  const done = approvePayment(parseInt(ctx.match[1], 10));
  if (!done) return ctx.answerCbQuery('قبلاً پردازش شده').catch(() => {});
  await ctx.answerCbQuery('✅').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  const { p, creditAmount } = done;
  await bot.telegram.sendMessage(p.user_id, L.wallet.approved(creditAmount, getBalance(p.user_id))).catch(() => {});
  await afterApproval(p.user_id);
});
bot.action(/^reject:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  const p = stmts.getPayment.get(parseInt(ctx.match[1], 10));
  if (!p || p.status !== 'waiting_review') return ctx.answerCbQuery('قبلاً پردازش شده').catch(() => {});
  stmts.setPaymentStatus.run('rejected', p.id);
  await ctx.answerCbQuery('❌').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await bot.telegram.sendMessage(p.user_id, L.wallet.rejected).catch(() => {});
});

/* ---------- ادمین: /stats و /newcode ---------- */
bot.command('stats', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const types = stmts.readingsByType.all().map(t => `  ${t.type}: ${fmt(t.c)} فال / ${fmt(t.s)} تومان`).join('\n') || '  —';
  return ctx.reply(
    `📊 آمار\n\n👥 کاربران: ${fmt(stmts.countUsers.get().c)}\n` +
    `💰 درآمد ۲۴س: ${fmt(stmts.dailyRevenue.get().s)}\n💰 درآمد ۳۰روز: ${fmt(stmts.monthlyRevenue.get().s)}\n💰 کل: ${fmt(stmts.totalRevenue.get().s)}\n\n🔮 فال‌ها:\n${types}`
  );
});
// /newcode CODE PERCENT DAYS [USER_ID]
bot.command('newcode', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  const [code, percent, days, onlyUser] = parts;
  const pct = parseInt(normalizeDigits(percent || ''), 10);
  const d = parseInt(normalizeDigits(days || ''), 10);
  if (!code || !pct || !d) return ctx.reply('فرمت: /newcode CODE PERCENT DAYS [USER_ID]');
  try {
    stmts.insertDiscountCode.run(code.toUpperCase(), pct, Math.floor(Date.now() / 1000) + d * 86400,
      1, onlyUser ? parseInt(normalizeDigits(onlyUser), 10) : null, ctx.from.id);
    return ctx.reply(`✅ کد ${code.toUpperCase()} (${pct}٪، ${d} روز) ساخته شد.`);
  } catch (e) { return ctx.reply(`❌ ${e.message}`); }
});

/* ---------- اشتراک‌گذاری (inline mode) ---------- */
bot.on('inline_query', async (ctx) => {
  const uid = ctx.from.id;
  try {
    await ctx.answerInlineQuery([{
      type: 'article',
      id: 'invite',
      title: L.share.inlineTitle,
      description: L.share.inlineDesc,
      input_message_content: { message_text: L.share.message(BOT_USERNAME, uid) },
    }], { cache_time: 0, is_personal: true });
  } catch (e) { logErr('inline query:', e.message); }
});

/* ---------- ریست تست (قرارداد ریپو §۶ب — فاز تست: همه‌ی کاربران) ---------- */
async function doReset(ctx) {
  wipeUser(ctx.from.id);
  await ctx.reply(L.reset.done, mainKeyboard());
  return handleStart(ctx); // مثل کاربر تازه: آنبوردینگ از نو
}
if (TEST_PHASE) bot.hears(L.buttons.resetTest, doReset);
bot.command('reset', (ctx) => {
  if (!TEST_PHASE && ctx.from.id !== OWNER_ID) return;
  return doReset(ctx);
});

/* ---------- هندلر متن (state machine) ---------- */
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  const state = getState(uid);
  try {
    if (state === 'await_question') return await handleQuestion(ctx, text.trim());
    if (state === 'pay_amount') {
      const amount = parseInt(normalizeDigits(text).replace(/[,،\s]/g, ''), 10);
      if (!amount || amount < MIN_RECHARGE) return ctx.reply(L.wallet.invalidAmount(MIN_RECHARGE));
      return await setRechargeAmount(ctx, uid, amount);
    }
    if (state === 'pay_discount') return await applyDiscount(ctx, uid, text);
    if (state === 'pay_receipt') {
      // رسید متنی
      const s = getSession(uid);
      if (!s.paymentId) return ctx.reply(L.errors.stateLost, mainKeyboard());
      await sendReceiptToAdmin(ctx, uid, s.paymentId, null, text);
      setState(uid, s.readingId ? 'confirm_pay' : 'idle');
      return ctx.reply(L.wallet.receiptReceived);
    }
    if (state === 'feedback') {
      const s = getSession(uid);
      if (s.readingId) return await handleFeedback(ctx, uid, s.readingId, 'text', text.trim());
    }
    // وسط فلوی فال: به‌جای پیام خوش‌آمدِ گیج‌کننده، نرم به دکمه‌ها برگردان
    if (state === 'confirm_pay') {
      if (await offerPendingReading(ctx, uid)) return;
    }
    if (['choose_spread', 'confirm_focus', 'breathing', 'shuffling', 'picking', 'revealing'].includes(state)) {
      return ctx.reply(L.errors.useButtons);
    }
    // پیش‌فرض: کاربر جدید → آنبوردینگ؛ بقیه → منوی اصلی
    if (!getUser(uid).welcomed) return handleStart(ctx);
    return ctx.reply(L.returning.greeting(ctx.from.first_name, getBalance(uid)), mainKeyboard());
  } catch (e) {
    logErr('text handler:', e.message);
    return ctx.reply(L.errors.generic).catch(() => {});
  }
});

/* ---------- ویس (سؤال فال با ویس) ---------- */
bot.on(['voice', 'audio'], async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (getState(uid) !== 'await_question') return;
  try {
    const media = ctx.message.voice || ctx.message.audio;
    // سقف طول/حجم — رونویسی قبل از پرداخت انجام می‌شود و نباید هزینه‌ی بی‌سقف بسازد
    if ((media.duration && media.duration > MAX_VOICE_SEC) || (media.file_size && media.file_size > MAX_VOICE_BYTES)) {
      return ctx.reply(L.errors.voiceTooLong(MAX_VOICE_SEC));
    }
    await typing(ctx, PACE_S);
    const link = await ctx.telegram.getFileLink(media.file_id);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = media.mime_type || 'audio/ogg';
    let txt = null;
    for (let attempt = 0; attempt < 2 && !txt; attempt++) {
      txt = await orTranscribe(buf, /wav/i.test(mime) ? 'wav' : 'mp3').catch(e => { logErr('transcribe:', e.message); return null; });
    }
    if (!txt?.trim()) return ctx.reply(L.errors.generic);
    return await handleQuestion(ctx, txt.trim());
  } catch (e) {
    logErr('voice handler:', e.message);
    return ctx.reply(L.errors.generic).catch(() => {});
  }
});

/* ---------- عکس (رسید پرداخت) ---------- */
bot.on('photo', async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (getState(uid) !== 'pay_receipt') return;
  const s = getSession(uid);
  if (!s.paymentId) return;
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  await sendReceiptToAdmin(ctx, uid, s.paymentId, fileId, null);
  setState(uid, s.readingId ? 'confirm_pay' : 'idle');
  await ctx.reply(L.wallet.receiptReceived);
});

/* ---------- sweep ساعتی milestone (پوش پیشگیرانه، سقف ۱/هفته) ---------- */
setInterval(async () => {
  try {
    for (const { telegram_id } of stmts.dueMilestones.all()) {
      const last = stmts.lastDelivered.all(telegram_id, 1)[0];
      stmts.setPush.run(telegram_id);
      if (!last?.summary) continue;
      await bot.telegram.sendMessage(telegram_id, L.milestone.checkin(last.summary), {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(L.buttons.daily, 'daily_go')],
          [Markup.button.callback(L.buttons.startThree(SPREAD_BY_ID.three.price, false), 'spread:three')],
        ]).reply_markup,
      }).catch(() => {});
      await sleep(300);
    }
  } catch (e) { logErr('milestone sweep:', e.message); }
}, 3600 * 1000);

/* ===== Launch ===== */
if (!existsSync('./assets/cards/back.jpg')) logErr('⚠️ assets/cards ناقص است — تصاویر کارت‌ها را کامیت/دانلود کن');
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => log(`✅ tarot bot started (long polling, locale=${LOCALE})`))
    .catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
bot.telegram.getMe().then(me => { BOT_USERNAME = me.username; }).catch(() => {});
launch();
process.once('SIGINT',  () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
