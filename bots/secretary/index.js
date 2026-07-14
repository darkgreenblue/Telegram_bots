// index.js — secretary: منشیِ شخصیِ صوتی.
// ویس/متن می‌گیرد، نیت‌ها را درمی‌آورد، و هرکدام را جای درستش می‌فرستد: جلسه به Google Calendar،
// بقیه (کار/خواندنی/فکر) به لیست «منشی» در TickTick. فاز ۱: تک‌کاربره (فقط ادمین)، بدون یادآوریِ داخلی.
// معماری: هر مرحله در SQLite ثبت می‌شود؛ جابِ پردازش جدا از هندلر تلگراف اجرا می‌شود (مصون از handlerTimeout)
// و در بوت/جارو، captureهای ناتمام از همان مرحله ادامه می‌یابند.
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import { Telegraf, Markup } from 'telegraf';
import crypto from 'crypto';
import { log, logErr } from '../../shared/logger.js';
import { createOpenRouter } from '../../shared/llm.js';
import { RESET_TEST_BTN, registerTestReset } from '../../shared/reset.js';
import { registerGlobalErrorHandlers, makeBotCatch } from '../../shared/errors.js';
import { EVENTS, track, trackOnce, captureStart } from '../../shared/analytics.js';
import { setupDb, getSetting, setSetting, wipeUser, CAPTURE_TERMINAL } from './db.js';
import * as C from './copy.js';
import {
  downloadFile, probeDurationSec, planChunks, sliceToMp3, transcribeResilient, mergeTranscripts,
  TELEGRAM_MAX_DOWNLOAD, MAX_VOICE_SEC,
} from './audio.js';
import { extractItems, patchItem, KINDS } from './extract.js';
import { gcalEnabled, createEvent, deleteEvent } from './gcal.js';
import {
  ticktickConfigured, getAuthUrl, exchangeCode, parseCode, hasToken, tokenAgeDays,
  createTask, updateTask, deleteTask, TicktickAuthError,
} from './ticktick.js';
import { updateMemory } from './memory.js';

/* ===== ENV و ثابت‌ها ===== */
const BOT_TOKEN = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN) { logErr('❌ BOT_TOKEN خالی است'); process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const ADMIN_IDS = (process.env.ADMIN_IDS || '100257975')
  .split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
const OWNER_ID = ADMIN_IDS[0] || 100257975;
const isAdmin = (uid) => ADMIN_IDS.includes(uid);
const TEST_PHASE = true;              // ⚠️ قبل از خروج از فاز شخصی false شود (بند ۶ب ریشه)
const PRODUCT_VERSION = '1.0.0';

const MAX_CONCURRENT_JOBS = 2;
const DAILY_AUDIO_SEC = 120 * 60;     // سقف نرمِ صوت روزانه (owner-only، سخاوتمند)
const PROGRESS_MIN_MS = 4000;         // فاصله‌ی حداقلیِ ویرایشِ پیام پیشرفت

// رویدادهای اختصاصی (snake_case؛ خارج از واژه‌نامه‌ی هسته)
const EV_CAPTURE = 'capture_received';
const EV_EXTRACTED = 'items_extracted';
const EV_DELIVERED = 'item_delivered';
const EV_UNDONE = 'item_undone';
const EV_CONFIRM = 'item_confirm_shown';

const or = createOpenRouter({
  apiKey: OPENROUTER_API_KEY,
  defaultModel: 'google/gemini-2.5-flash',
  fallbackModel: 'deepseek/deepseek-v3.2',
});

const db = setupDb();

/* ===== helperهای DB ===== */
const getCapture = (id) => db.prepare('SELECT * FROM captures WHERE id=?').get(id);
const getItem = (id) => db.prepare('SELECT * FROM items WHERE id=?').get(id);
const getMemory = (uid) => db.prepare('SELECT memory_json FROM users WHERE telegram_id=?').get(uid)?.memory_json || '';

function setCaptureStatus(id, status, error = null) {
  db.prepare('UPDATE captures SET status=?, error=?, updated_at=unixepoch() WHERE id=?').run(status, error, id);
}
function setCaptureField(id, field, value) {
  db.prepare(`UPDATE captures SET ${field}=?, updated_at=unixepoch() WHERE id=?`).run(value, id);
}
function upsertUser(ctx) {
  db.prepare(`INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
              ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()`)
    .run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
}

function tehranDayStartUnix() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return Math.floor(Date.parse(`${ymd}T00:00:00+03:30`) / 1000);
}
function sumTodayAudioSec(uid) {
  const r = db.prepare("SELECT COALESCE(SUM(duration_sec),0) s FROM captures WHERE user_id=? AND created_at>=? AND source IN ('voice','audio')")
    .get(uid, tehranDayStartUnix());
  return r?.s || 0;
}

const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|amr|3gp|aiff|mp4|m4b|mka|weba|webm)$/i;
function isAudioDocument(doc) {
  if (!doc) return false;
  if (doc.mime_type && (/^audio\//i.test(doc.mime_type) || doc.mime_type === 'application/ogg')) return true;
  if (doc.file_name && AUDIO_EXT_RE.test(doc.file_name)) return true;
  return false;
}

// ارسال امن (خطا فلو را نشکند)
async function sendMsg(chatId, text, extra) {
  try { return await bot.telegram.sendMessage(chatId, text, extra); } catch (e) { logErr('sendMsg:', e.message); return null; }
}
async function editMsg(chatId, msgId, text, extra) {
  if (!msgId) return;
  try { await bot.telegram.editMessageText(chatId, msgId, undefined, text, extra); } catch { /* پیام قدیمی/بدون‌تغییر */ }
}

class SoftStop extends Error {} // پایان زودهنگامِ پایپ‌لاین که پیامش را خودش قبلاً به کاربر داده

/* ===== Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 10 * 60 * 1000 });
bot.catch(makeBotCatch());
registerGlobalErrorHandlers('secretary');

// گیت تک‌کاربره: هرکس جز ادمین‌ها یک پیام مودبانه می‌گیرد و هیچ LLM ای صدا زده نمی‌شود.
bot.use(async (ctx, next) => {
  if (ctx.from && !isAdmin(ctx.from.id)) {
    if (ctx.updateType === 'message') { try { await ctx.reply(C.NOT_ALLOWED); } catch {} }
    return;
  }
  return next();
});

async function handleStart(ctx) {
  const before = db.prepare('SELECT 1 FROM users WHERE telegram_id=?').get(ctx.from.id);
  upsertUser(ctx);
  captureStart(db, ctx.from.id, ctx.startPayload, !before, PRODUCT_VERSION);
  const kb = TEST_PHASE ? Markup.keyboard([[RESET_TEST_BTN]]).resize() : undefined;
  await ctx.reply(C.WELCOME, kb);
}
bot.start(handleStart);

// اتصال TickTick (یک‌بار، داخل خود ربات)
bot.command('ticktick', async (ctx) => {
  if (!ticktickConfigured()) return ctx.reply(C.TICKTICK_NOT_CONFIGURED);
  const state = crypto.randomBytes(8).toString('hex');
  setSetting(db, 'ticktick_state', state);
  await ctx.reply(C.ticktickAuthMsg(getAuthUrl(state)), { disable_web_page_preview: true });
});
bot.command('ticktick_code', async (ctx) => {
  if (!ticktickConfigured()) return ctx.reply(C.TICKTICK_NOT_CONFIGURED);
  const code = parseCode(ctx.message.text.replace(/^\/ticktick_code(@\S+)?/, '').trim());
  if (!code) return ctx.reply(C.TICKTICK_CODE_MISSING);
  const ok = await exchangeCode(db, code);
  return ctx.reply(ok ? C.TICKTICK_CONNECTED : C.TICKTICK_CODE_FAIL);
});
bot.command('memory', (ctx) => ctx.reply(C.memoryText(getMemory(ctx.from.id))));

registerTestReset(bot, { ownerId: OWNER_ID, ownerOnly: false, testPhase: TEST_PHASE, wipe: (uid) => wipeUser(db, uid), after: handleStart });

/* ===== ورودی: متن ===== */
const editStates = new Map(); // uid → itemId (در حال ویرایش)؛ حافظه‌ای و بازسازی‌پذیر (گم شد، دوباره «اصلاح» بزن)

bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const text = (ctx.message.text || '').trim();
  if (!text) return;

  // در حال ویرایش؟ این پیام دستورِ اصلاح است.
  if (editStates.has(uid)) {
    const itemId = editStates.get(uid);
    editStates.delete(uid);
    return applyEdit(ctx.chat.id, uid, itemId, text);
  }

  // فقط-لینک → مستقیم «بعداً بخوانم» بدون LLM
  if (/^https?:\/\/\S+$/.test(text)) return directReadLater(ctx, text);

  const isForward = !!(ctx.message.forward_origin || ctx.message.forward_from || ctx.message.forward_from_chat || ctx.message.forward_date);
  const transcript = (isForward ? 'متن فوروارد شده:\n' : '') + text.slice(0, 8000);
  const ack = await ctx.reply(C.ACK_TEXT);
  const id = insertCapture(ctx, isForward ? 'forward' : 'text', { transcript, status_msg_id: ack?.message_id });
  track(db, uid, EV_CAPTURE, { source: isForward ? 'forward' : 'text' });
  trackOnce(db, uid, EVENTS.ONBOARD_DONE, {});
  startCapture(id);
});

/* ===== ورودی: صوت ===== */
bot.on(['voice', 'audio', 'document'], async (ctx) => {
  const uid = ctx.from.id;
  const msg = ctx.message;
  let media = msg.voice || msg.audio || null;
  let source = msg.voice ? 'voice' : 'audio';
  if (!media && msg.document) {
    if (!isAudioDocument(msg.document)) return; // فایل غیرصوتی: بی‌صدا رد
    media = msg.document; source = 'audio';
  }
  if (!media) return;

  if (media.file_size && media.file_size > TELEGRAM_MAX_DOWNLOAD) return ctx.reply(C.FILE_TOO_BIG);
  const dur = media.duration || 0;
  if (dur && dur > MAX_VOICE_SEC) return ctx.reply(C.TOO_LONG);
  if (dur && sumTodayAudioSec(uid) + dur > DAILY_AUDIO_SEC) return ctx.reply(C.DAILY_LIMIT);

  const ack = await ctx.reply(C.ACK_VOICE);
  const id = insertCapture(ctx, source, {
    file_id: media.file_id, duration_sec: dur, size_bytes: media.file_size || 0, status_msg_id: ack?.message_id,
  });
  track(db, uid, EV_CAPTURE, { source, dur });
  trackOnce(db, uid, EVENTS.ONBOARD_DONE, {});
  startCapture(id);
});

function insertCapture(ctx, source, fields = {}) {
  const info = db.prepare(`INSERT INTO captures (user_id, chat_id, tg_message_id, source, file_id, duration_sec, size_bytes, transcript, status, status_msg_id)
    VALUES (@user_id, @chat_id, @tg_message_id, @source, @file_id, @duration_sec, @size_bytes, @transcript, 'captured', @status_msg_id)`)
    .run({
      user_id: ctx.from.id, chat_id: ctx.chat.id, tg_message_id: ctx.message.message_id, source,
      file_id: fields.file_id || null, duration_sec: fields.duration_sec || 0, size_bytes: fields.size_bytes || 0,
      transcript: fields.transcript || null, status_msg_id: fields.status_msg_id || null,
    });
  return info.lastInsertRowid;
}

/* ===== زمان‌بندی جاب‌ها ===== */
const running = new Set();
function startCapture(id) {
  if (running.has(id) || running.size >= MAX_CONCURRENT_JOBS) return; // مازاد در DB می‌ماند؛ جارو برمی‌دارد
  running.add(id);
  runCapture(id).catch((e) => logErr('runCapture top:', e.message)).finally(() => { running.delete(id); kick(); });
}
function kick() {
  const rows = db.prepare("SELECT id FROM captures WHERE status NOT IN ('routed','partial','failed') ORDER BY id LIMIT 10").all();
  for (const r of rows) { if (running.size >= MAX_CONCURRENT_JOBS) break; startCapture(r.id); }
}

/* ===== پایپ‌لاین ===== */
async function runCapture(id) {
  let cap = getCapture(id);
  if (!cap || CAPTURE_TERMINAL.has(cap.status)) return;
  try {
    // ۱) رونویسی (متن/فوروارد این مرحله را رد می‌کنند)
    if (cap.status === 'captured') {
      if (cap.source === 'text' || cap.source === 'forward') {
        setCaptureStatus(id, 'transcribed');
      } else {
        setCaptureStatus(id, 'transcribing');
        await transcribeCapture(cap);
        setCaptureStatus(id, 'transcribed');
      }
      cap = getCapture(id);
    }

    // ۲) استخراج نیت
    if (cap.status === 'transcribed' || cap.status === 'extracting') {
      setCaptureStatus(id, 'extracting');
      await editMsg(cap.chat_id, cap.status_msg_id, C.EXTRACTING);
      const already = db.prepare('SELECT COUNT(*) n FROM items WHERE capture_id=?').get(id).n;
      if (already === 0) {
        const result = await extractItems(or, cap.transcript || '', getMemory(cap.user_id));
        if (!result) throw new Error('extraction failed');
        insertItems(cap, result.items);
        updateMemory(or, db, cap.user_id, result.observations).catch(() => {});
        const counts = countByKind(result.items);
        track(db, cap.user_id, EV_EXTRACTED, { total: result.items.length, ...counts });
      }
      setCaptureStatus(id, 'extracted');
      cap = getCapture(id);
    }

    // ۳) مسیریابی
    if (cap.status === 'extracted') {
      await routeCapture(cap);
    }
  } catch (e) {
    if (e instanceof SoftStop) { setCaptureStatus(id, 'failed', e.message); return; }
    logErr('runCapture:', id, e.message);
    setCaptureStatus(id, 'failed', e.message);
    await sendMsg(cap?.chat_id, C.CAPTURE_FAILED, C.retryCaptureKb(id));
  }
}

const lastProgress = new Map();
async function transcribeCapture(cap) {
  const buf = await downloadFile(bot.telegram, cap.file_id);
  if (buf.length > TELEGRAM_MAX_DOWNLOAD) { await sendMsg(cap.chat_id, C.FILE_TOO_BIG); throw new SoftStop('too big'); }
  let dur = cap.duration_sec || 0;
  if (!dur) { dur = (await probeDurationSec(buf)) || 0; if (dur) setCaptureField(cap.id, 'duration_sec', Math.round(dur)); }
  if (dur > MAX_VOICE_SEC) { await sendMsg(cap.chat_id, C.TOO_LONG); throw new SoftStop('too long'); }
  // بودجه‌ی روزانه (duration_sec خودِ این capture ممکن است قبلاً شمرده شده باشد؛ کسرش کن)
  if (dur && sumTodayAudioSec(cap.user_id) - (cap.duration_sec || 0) + dur > DAILY_AUDIO_SEC) {
    await sendMsg(cap.chat_id, C.DAILY_LIMIT); throw new SoftStop('daily limit');
  }

  const plan = planChunks(dur);
  const insChunk = db.prepare("INSERT OR IGNORE INTO chunks (capture_id, idx, start_sec, dur_sec, status) VALUES (?, ?, ?, ?, 'pending')");
  for (const p of plan) insChunk.run(cap.id, p.idx, p.start, p.dur);

  const total = plan.length;
  let done = db.prepare("SELECT COUNT(*) n FROM chunks WHERE capture_id=? AND status='done'").get(cap.id).n;
  for (const p of plan) {
    const row = db.prepare('SELECT status FROM chunks WHERE capture_id=? AND idx=?').get(cap.id, p.idx);
    if (row.status === 'done') continue;
    const mp3 = await sliceToMp3(buf, p.start, p.dur);
    const text = await transcribeResilient(or, mp3);
    if (text == null) throw new Error(`transcription failed at chunk ${p.idx}`);
    db.prepare("UPDATE chunks SET transcript=?, status='done' WHERE capture_id=? AND idx=?").run(text, cap.id, p.idx);
    done++;
    if (total > 1) {
      const last = lastProgress.get(cap.id) || 0;
      if (Date.now() - last >= PROGRESS_MIN_MS) {
        lastProgress.set(cap.id, Date.now());
        await editMsg(cap.chat_id, cap.status_msg_id, C.ackChunkProgress(done, total));
      }
    }
  }
  const parts = db.prepare('SELECT transcript FROM chunks WHERE capture_id=? ORDER BY idx').all(cap.id).map((r) => r.transcript);
  setCaptureField(cap.id, 'transcript', mergeTranscripts(parts));
}

function insertItems(cap, items) {
  const insert = db.prepare(`INSERT INTO items (capture_id, user_id, kind, title, body, url, due_at, end_at, all_day, confidence, risk, status, dest, quote)
    VALUES (@capture_id, @user_id, @kind, @title, @body, @url, @due_at, @end_at, @all_day, @confidence, @risk, 'proposed', @dest, @quote)`);
  const tx = db.transaction((rows) => { for (const r of rows) insert.run(r); });
  tx(items.map((it) => ({
    capture_id: cap.id, user_id: cap.user_id, kind: it.kind, title: it.title, body: it.body || '', url: it.url || '',
    due_at: it.due_at ?? null, end_at: it.end_at ?? null, all_day: it.all_day || 0, confidence: it.confidence ?? 1,
    risk: it.risk || 'low', dest: it.dest, quote: it.quote || '',
  })));
}
function countByKind(items) {
  const c = {};
  for (const k of KINDS) c[k] = 0;
  for (const it of items) if (c[it.kind] != null) c[it.kind]++;
  return c;
}

async function routeCapture(cap) {
  const items = db.prepare("SELECT * FROM items WHERE capture_id=? AND status='proposed' ORDER BY id").all(cap.id);
  if (items.length === 0) {
    await sendMsg(cap.chat_id, C.NOTHING);
    setCaptureStatus(cap.id, 'routed');
    return;
  }
  if (items.length > 2) await sendMsg(cap.chat_id, C.summaryLine(countByKind(items)));

  let anyFail = false;
  for (const item of items) {
    if (item.risk === 'high') {
      await sendConfirmCard(cap.chat_id, item);
      track(db, cap.user_id, EV_CONFIRM, { kind: item.kind });
    } else {
      const ok = await deliverLowRisk(cap.chat_id, item);
      if (!ok) anyFail = true;
    }
  }
  setCaptureStatus(cap.id, anyFail ? 'partial' : 'routed');
  track(db, cap.user_id, EVENTS.PRODUCT_DELIVERED, { items: items.length });
}

/* ===== تحویل / کارت تأیید / undo ===== */
function ticktickContent(item) {
  const tag = item.kind === 'read_later' ? '#خواندنی' : item.kind === 'thought' ? '#فکر' : '';
  return [item.body, item.url, tag].filter(Boolean).join('\n');
}

async function deliverLowRisk(chatId, item) {
  if (!ticktickConfigured()) { await sendMsg(chatId, C.TICKTICK_NOT_CONFIGURED); markItemFailed(item.id, 'not configured'); return false; }
  if (!hasToken(db)) { await promptTicktickConnect(chatId); markItemFailed(item.id, 'no token'); await sendFailedItem(chatId, item); return false; }
  db.prepare("UPDATE items SET status='delivering', updated_at=unixepoch() WHERE id=?").run(item.id);
  try {
    const ext = await createTask(db, { title: item.title, content: ticktickContent(item), dueAtUnix: item.due_at, allDay: !!item.all_day });
    markItemDelivered(item.id, ext);
    const it2 = getItem(item.id);
    const msg = await sendMsg(chatId, C.receiptText(it2), C.deliveredKb(item.id));
    if (msg) db.prepare('UPDATE items SET receipt_msg_id=? WHERE id=?').run(msg.message_id, item.id);
    track(db, item.user_id, EV_DELIVERED, { kind: item.kind, dest: item.dest });
    trackOnce(db, item.user_id, EVENTS.FIRST_VALUE, { via: item.kind });
    return true;
  } catch (e) {
    markItemFailed(item.id, e.message);
    if (e instanceof TicktickAuthError) { await promptTicktickConnect(chatId, true); }
    await sendFailedItem(chatId, item);
    return false;
  }
}

async function sendConfirmCard(chatId, item) {
  const msg = await sendMsg(chatId, C.confirmCardText(item), C.confirmKb(item.id));
  if (msg) db.prepare('UPDATE items SET receipt_msg_id=? WHERE id=?').run(msg.message_id, item.id);
}
async function sendFailedItem(chatId, item) {
  const msg = await sendMsg(chatId, C.deliverFailedText(item), C.retryItemKb(item.id));
  if (msg) db.prepare('UPDATE items SET receipt_msg_id=? WHERE id=?').run(msg.message_id, item.id);
}
function markItemDelivered(id, ext) {
  db.prepare("UPDATE items SET status='delivered', external_id=?, deliver_error=NULL, updated_at=unixepoch() WHERE id=?").run(ext, id);
}
function markItemFailed(id, err) {
  db.prepare("UPDATE items SET status='failed', deliver_error=?, updated_at=unixepoch() WHERE id=?").run(String(err || '').slice(0, 300), id);
}

async function promptTicktickConnect(chatId, reauth = false) {
  if (!ticktickConfigured()) return;
  const state = crypto.randomBytes(8).toString('hex');
  setSetting(db, 'ticktick_state', state);
  await sendMsg(chatId, reauth ? C.ticktickReauthMsg(getAuthUrl(state)) : C.ticktickAuthMsg(getAuthUrl(state)), { disable_web_page_preview: true });
}

/* ===== callbackها ===== */
// گذارِ گارددارِ سینکرون قبل از هر await (ضد دوبار-زدن و stale). changes===0 → قبلاً انجام شده.
function guard(id, from, to) {
  return db.prepare('UPDATE items SET status=?, updated_at=unixepoch() WHERE id=? AND status=?').run(to, id, from).changes > 0;
}

bot.action(/^it:ok:(\d+)$/, async (ctx) => {
  const id = +ctx.match[1];
  const item = getItem(id);
  if (!item || item.user_id !== ctx.from.id) return ctx.answerCbQuery(C.BTN_EXPIRED);
  if (!guard(id, 'proposed', 'confirmed')) return ctx.answerCbQuery(C.ALREADY_DONE);
  await ctx.answerCbQuery();
  if (item.dest === 'gcal' && !gcalEnabled()) {
    db.prepare("UPDATE items SET status='failed', deliver_error='gcal disabled' WHERE id=?").run(id);
    return editMsg(ctx.chat.id, item.receipt_msg_id, C.GCAL_NOT_CONFIGURED, C.EMPTY_KB);
  }
  db.prepare("UPDATE items SET status='delivering', updated_at=unixepoch() WHERE id=?").run(id);
  try {
    let ext;
    if (item.dest === 'gcal') ext = await createEvent(item);
    else ext = await createTask(db, { title: item.title, content: ticktickContent(item), dueAtUnix: item.due_at, allDay: !!item.all_day });
    markItemDelivered(id, ext);
    const it2 = getItem(id);
    await editMsg(ctx.chat.id, item.receipt_msg_id, C.receiptText(it2), C.deliveredKb(id));
    track(db, item.user_id, EV_DELIVERED, { kind: item.kind, dest: item.dest });
    trackOnce(db, item.user_id, EVENTS.FIRST_VALUE, { via: item.kind });
  } catch (e) {
    markItemFailed(id, e.message);
    if (e instanceof TicktickAuthError) await promptTicktickConnect(ctx.chat.id, true);
    await editMsg(ctx.chat.id, item.receipt_msg_id, C.deliverFailedText(item), C.retryItemKb(id));
  }
});

bot.action(/^it:no:(\d+)$/, async (ctx) => {
  const id = +ctx.match[1];
  const item = getItem(id);
  if (!item || item.user_id !== ctx.from.id) return ctx.answerCbQuery(C.BTN_EXPIRED);
  if (!guard(id, 'proposed', 'dismissed')) return ctx.answerCbQuery(C.ALREADY_DONE);
  await ctx.answerCbQuery();
  await editMsg(ctx.chat.id, item.receipt_msg_id, C.DISMISSED, C.EMPTY_KB);
});

bot.action(/^it:edit:(\d+)$/, async (ctx) => {
  const id = +ctx.match[1];
  const item = getItem(id);
  if (!item || item.user_id !== ctx.from.id) return ctx.answerCbQuery(C.BTN_EXPIRED);
  editStates.set(ctx.from.id, id);
  await ctx.answerCbQuery();
  await ctx.reply(C.EDIT_PROMPT);
});

bot.action(/^it:undo:(\d+)$/, async (ctx) => {
  const id = +ctx.match[1];
  const item = getItem(id);
  if (!item || item.user_id !== ctx.from.id) return ctx.answerCbQuery(C.BTN_EXPIRED);
  if (!guard(id, 'delivered', 'undoing')) return ctx.answerCbQuery(C.ALREADY_DONE);
  await ctx.answerCbQuery();
  try {
    if (item.dest === 'gcal') await deleteEvent(item.external_id);
    else await deleteTask(db, item.external_id);
    db.prepare("UPDATE items SET status='undone', updated_at=unixepoch() WHERE id=?").run(id);
    track(db, item.user_id, EV_UNDONE, { kind: item.kind });
    await editMsg(ctx.chat.id, item.receipt_msg_id, C.UNDONE, C.EMPTY_KB);
  } catch (e) {
    db.prepare("UPDATE items SET status='delivered' WHERE id=?").run(id); // برگشت به حالت قبل
    logErr('undo:', e.message);
    await sendMsg(ctx.chat.id, C.UNDO_FAIL);
  }
});

bot.action(/^it:retry:(\d+)$/, async (ctx) => {
  const id = +ctx.match[1];
  const item = getItem(id);
  if (!item || item.user_id !== ctx.from.id) return ctx.answerCbQuery(C.BTN_EXPIRED);
  if (item.status !== 'failed') return ctx.answerCbQuery(C.ALREADY_DONE);
  await ctx.answerCbQuery();
  db.prepare("UPDATE items SET status='proposed' WHERE id=?").run(id);
  const fresh = getItem(id);
  if (fresh.risk === 'high') await sendConfirmCard(ctx.chat.id, fresh);
  else await deliverLowRisk(ctx.chat.id, fresh);
});

bot.action(/^cap:retry:(\d+)$/, async (ctx) => {
  const id = +ctx.match[1];
  const cap = getCapture(id);
  if (!cap || cap.user_id !== ctx.from.id) return ctx.answerCbQuery(C.BTN_EXPIRED);
  await ctx.answerCbQuery();
  const hasItems = db.prepare('SELECT COUNT(*) n FROM items WHERE capture_id=?').get(id).n > 0;
  const resume = hasItems ? 'extracted' : (cap.transcript ? 'transcribed' : 'captured');
  setCaptureStatus(id, resume);
  startCapture(id);
});

/* ===== ویرایش ===== */
async function applyEdit(chatId, uid, itemId, instruction) {
  const item = getItem(itemId);
  if (!item || item.user_id !== uid) { await sendMsg(chatId, C.BTN_EXPIRED); return; }
  const patch = await patchItem(or, item, instruction);
  if (!patch) { await sendMsg(chatId, C.EDIT_FAIL); return; }
  db.prepare('UPDATE items SET title=?, body=?, url=?, due_at=?, end_at=?, all_day=?, updated_at=unixepoch() WHERE id=?')
    .run(patch.title, patch.body, patch.url, patch.due_at ?? null, patch.end_at ?? null, patch.all_day || 0, itemId);
  const it2 = getItem(itemId);
  try {
    if (it2.status === 'proposed') {
      await editMsg(chatId, it2.receipt_msg_id, C.confirmCardText(it2), C.confirmKb(itemId));
    } else if (it2.status === 'delivered') {
      if (it2.dest === 'gcal') await createEvent(it2);                       // id ثابت → PATCH می‌کند
      else await updateTask(db, it2.external_id, { title: it2.title, content: ticktickContent(it2), dueAtUnix: it2.due_at, allDay: !!it2.all_day });
      await editMsg(chatId, it2.receipt_msg_id, C.receiptText(it2), C.deliveredKb(itemId));
    }
    await sendMsg(chatId, C.EDIT_DONE);
  } catch (e) {
    logErr('applyEdit sync:', e.message);
    await sendMsg(chatId, C.EDIT_FAIL);
  }
}

/* ===== فقط-لینک ===== */
async function directReadLater(ctx, url) {
  let title = url;
  try { title = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const capId = insertCapture(ctx, 'text', { transcript: url, status_msg_id: null });
  setCaptureStatus(capId, 'routed');
  const info = db.prepare(`INSERT INTO items (capture_id, user_id, kind, title, url, confidence, risk, status, dest, quote)
    VALUES (?, ?, 'read_later', ?, ?, 1, 'low', 'proposed', 'ticktick', '')`).run(capId, ctx.from.id, title, url);
  track(db, ctx.from.id, EV_CAPTURE, { source: 'link' });
  trackOnce(db, ctx.from.id, EVENTS.ONBOARD_DONE, {});
  await deliverLowRisk(ctx.chat.id, getItem(info.lastInsertRowid));
}

/* ===== جارو ۶۰ثانیه‌ای ===== */
setInterval(() => {
  try {
    kick(); // captureهای صف‌مانده/کرش‌خورده را پیش می‌برد
    maybeWarnTicktickToken();
  } catch (e) { logErr('sweep:', e.message); }
}, 60_000);

function maybeWarnTicktickToken() {
  if (!ticktickConfigured() || !hasToken(db)) return;
  const age = tokenAgeDays(db);
  if (age == null || age < 170) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (getSetting(db, 'ticktick_warn_day') === today) return;
  setSetting(db, 'ticktick_warn_day', today);
  const state = crypto.randomBytes(8).toString('hex');
  setSetting(db, 'ticktick_state', state);
  for (const id of ADMIN_IDS) sendMsg(id, C.ticktickReauthMsg(getAuthUrl(state)), { disable_web_page_preview: true });
}

/* ===== Launch ===== */
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => { log('✅ secretary bot started (long polling)'); kick(); }) // بازیابی captureهای ناتمامِ قبل از ری‌استارت
    .catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
launch();
process.once('SIGINT', () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
