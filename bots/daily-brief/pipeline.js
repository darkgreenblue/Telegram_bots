// pipeline.js — ماشینِ حالتِ یک قسمتِ پادکست.
//
// چرخه:  pending → scripted → synthesized → delivered
// ‌       (هر مرحله در صورتِ خطا → failed، با دکمه‌ی تلاشِ دوباره برای ادمین)
//
// چرا سه حالتِ میانی و نه یکی: تفکیکِ `scripted` از `synthesized` عمدی است. اگر ساختِ صدا
// شکست بخورد، متنِ ساخته‌شده روی همان ردیف باقی است و تلاشِ دوباره پولِ LLM را دوباره خرج
// نمی‌کند. `synthesized` هم‌زمان یعنی «آماده‌ی ارسال» و همان چیزی است که bake-ahead لازم دارد:
// زمان‌بند صبح زودتر می‌سازد و رأسِ ساعتِ تنظیم‌شده فقط می‌فرستد.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { log, logErr } from '../../shared/logger.js';
import { fetchRoadmap, syncLessons, pickNextLesson, fetchLessonBody, notionErrorFa } from './notion.js';
import { writeScript } from './script.js';
import { synthesize, engineLabel } from './tts.js';
import { tagScript, STYLE_DIRECTIVE } from './tagger.js';

// تعدادِ جلسه‌های قبلی که به‌عنوان حافظه به مدل داده می‌شود (یادآوریِ ابتدای قسمت).
const RECENT_LESSONS = 3;
// قسمتی که بیش از این مدت در یک مرحله‌ی میانی مانده، یتیمِ ری‌استارت است.
export const STUCK_MINUTES = 30;

export class PipelineError extends Error {
  constructor(stage, message) { super(message); this.stage = stage; }
}

/* ===== کمکی‌های زمانِ تهران ===== */
// همه‌ی مرزهای روز با تقویمِ تهران است (قرارداد سراسریِ ریپو).
export const tehranNow = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  // en-CA ساعتِ نیمه‌شب را ۲۴ می‌دهد، نه ۰۰
  const hour = p.hour === '24' ? '00' : p.hour;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${hour}:${p.minute}`,
    minutes: parseInt(hour, 10) * 60 + parseInt(p.minute, 10),
    weekday: p.weekday.toLowerCase().slice(0, 3), // sat, sun, ...
  };
};

export const hhmmToMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10); const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/* ===== دسترسی به داده ===== */
function topicOf(db, lesson) {
  const row = db.prepare('SELECT meta_json, notes FROM topics WHERE page_id=?').get(lesson.topic_page_id);
  let meta = {};
  try { meta = row?.meta_json ? JSON.parse(row.meta_json) : {}; } catch {}
  return { title: lesson.topic_title, notes: row?.notes || '', ...meta };
}

function recentTitles(db, limit = RECENT_LESSONS) {
  return db.prepare(`SELECT title FROM lessons WHERE status='delivered'
                     ORDER BY delivered_at DESC LIMIT ?`).all(limit).map((r) => r.title);
}

function nextAfter(db, lesson) {
  return db.prepare(`SELECT title FROM lessons WHERE status='pending'
                     AND (topic_order > ? OR (topic_order = ? AND lesson_order > ?))
                     ORDER BY topic_order, lesson_order LIMIT 1`)
    .get(lesson.topic_order, lesson.topic_order, lesson.lesson_order)?.title || null;
}

export function saveTopics(db, topics) {
  const up = db.prepare(`
    INSERT INTO topics (page_id, title, topic_order, meta_json, notes, synced_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(page_id) DO UPDATE SET
      title=excluded.title, topic_order=excluded.topic_order,
      meta_json=excluded.meta_json, notes=excluded.notes, synced_at=unixepoch()
  `);
  // کلیدِ موضوع همان key ای است که syncLessons در lessons.topic_page_id می‌نویسد؛
  // اگر این دو از هم واگرا شوند، یادداشت‌های موضوع بی‌صدا به پرامپت نمی‌رسند.
  db.transaction(() => {
    for (const t of topics) up.run(t.key, t.title, t.order, JSON.stringify(t.meta || {}), t.notes || '');
  })();
}

/* ===== مراحل ===== */
// همگام‌سازیِ رودمپ. کشِ کوتاه فقط برای جلوگیری از دوبار-fetch وقتی چند مسیر پشت‌سرهم
// صدا می‌زنند (وضعیتِ رودمپ، بیک‌آف، ساختِ دستی)؛ زمان‌بند هرگز اینجا نمی‌آید.
export async function refreshRoadmap(deps, { force = false } = {}) {
  const { db, notion, cache, cacheTtlMs } = deps;
  if (!notion) throw new PipelineError('notion', 'NOTION_TOKEN ست نشده است');
  const now = Date.now();
  if (!force && cache.roadmapAt && now - cache.roadmapAt < cacheTtlMs) return cache.roadmap;

  let rootId = db.prepare("SELECT value FROM settings WHERE key='notion_page_id'").get()?.value;
  if (rootId) { try { rootId = JSON.parse(rootId); } catch {} }
  if (!rootId) {
    rootId = await notion.findRootPage();
    if (!rootId) throw new PipelineError('notion', 'پیج «دستیار آموزشی» پیدا نشد. مطمئن شو با Integration ربات share شده باشد.');
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('notion_page_id', JSON.stringify(rootId));
  }
  const topics = await fetchRoadmap(notion, rootId);
  saveTopics(db, topics);
  syncLessons(db, topics);
  cache.roadmap = topics;
  cache.roadmapAt = now;
  return topics;
}

async function stageScript(deps, ep) {
  const { db, llm, notion } = deps;
  try {
    await refreshRoadmap(deps);
  } catch (e) {
    // اگر نوشن در دسترس نیست ولی جلسه‌ای در DB داریم، با همان ادامه می‌دهیم:
    // کاربر صبح یک قسمت می‌خواهد، نه یک پیامِ خطا درباره‌ی سرویسِ جانبی.
    logErr('roadmap refresh failed, using cached lessons:', e.message);
    if (!pickNextLesson(db)) throw new PipelineError('notion', notionErrorFa(e));
  }
  const lesson = pickNextLesson(db);
  if (!lesson) throw new PipelineError('roadmap', 'هیچ جلسه‌ی باقی‌مانده‌ای در رودمپ نیست. به پیج Notion جلسه‌ی تازه اضافه کن.');

  // متنِ خودِ جلسه ماده‌ی اصلیِ قسمت است و فقط برای همین یک جلسه خوانده می‌شود
  // (نه در همگام‌سازی، وگرنه هر بار ده‌ها درخواستِ اضافه به نوشن می‌رفت).
  let body = '';
  if (notion) {
    try { body = await fetchLessonBody(notion, lesson); }
    catch (e) { logErr('lesson body fetch:', e.message); }
  }

  const res = await writeScript(llm, {
    topic: topicOf(db, lesson),
    lesson,
    body,
    recent: recentTitles(db),
    next: nextAfter(db, lesson),
    minutes: ep.duration_target,
    format: ep.format,
  });
  if (!res) throw new PipelineError('script', 'ساختِ متنِ قسمت بعد از چند تلاش شکست خورد.');

  // ایجنتِ دوم: کارگردانِ صدا. شکستش قسمت را نمی‌کشد (متنِ بی‌تگ خودش پخش‌شدنی است)،
  // پس عمداً بعد از ذخیره‌ی امنِ متن نمی‌آید بلکه در همین تراکنشِ منطقی جمع می‌شود تا
  // تلاشِ دوباره‌ی بعد از شکستِ TTS دوباره پولِ نویسنده را خرج نکند.
  const tagged = await tagScript(llm, res.script);

  db.prepare(`UPDATE episodes SET status='scripted', lesson_block_id=?, lesson_title=?, title=?,
              script=?, tts_input=?, tts_tags=?, script_words=?, llm_model=?,
              llm_tokens_in=?, llm_tokens_out=?, llm_gen_ids=? WHERE id=?`)
    .run(lesson.block_id, lesson.title, res.title, res.script, tagged.text, tagged.tags, res.words,
         [...res.models, ...tagged.models].join(','),
         res.usage.in + tagged.usage.in, res.usage.out + tagged.usage.out,
         [...res.ids, ...tagged.ids].join(','), ep.id);
  return db.prepare('SELECT * FROM episodes WHERE id=?').get(ep.id);
}

async function stageSynth(deps, ep) {
  const { db, keys, llm, audioDir } = deps;
  let turns = null;
  if (ep.format === 'dialogue' && ep.turns_json) {
    try { turns = JSON.parse(ep.turns_json); } catch {}
  }
  let voices = {};
  try { voices = ep.voices_json ? JSON.parse(ep.voices_json) : {}; } catch {}
  const out = await synthesize({
    engineKey: ep.engine,
    // متنِ تگ‌خورده اگر باشد، وگرنه متنِ خام. قسمت‌های قدیمی‌ترِ DB ستونش خالی است و
    // باید همان‌طور که بودند دوباره ساخته شوند (سازگاری با گذشته، بند ۲ج/۱).
    script: ep.tts_input || ep.script,
    stylePrefix: STYLE_DIRECTIVE,
    turns,
    speed: ep.speed || 1,
    voice: voices[ep.engine] || '',
    openrouterKey: keys.openrouter,
    generationCost: llm.generationCost,
  });
  // صدا روی دیسک می‌نشیند نه در حافظه: بینِ ساختِ زودهنگام و ارسالِ رأسِ ساعت ممکن است
  // یک دیپلوی پروسه را ری‌استارت کند، و آن‌وقت وضعیتِ `synthesized` بدونِ فایل یعنی دروغ.
  mkdirSync(audioDir, { recursive: true });
  const path = join(audioDir, `ep${ep.id}.mp3`);
  writeFileSync(path, out.buffer);
  // engine از خروجی نوشته می‌شود نه از ورودی: اگر مدلِ ذخیره‌شده دیگر در کاتالوگ نباشد،
  // synthesize روی مدلِ در دسترس می‌افتد و گزارشِ هزینه باید همان را نشان بدهد.
  db.prepare(`UPDATE episodes SET status='synthesized', engine=?, tts_chars=?, tts_cost_usd=?,
              audio_seconds=?, audio_bytes=?, audio_path=? WHERE id=?`)
    .run(out.engine, out.chars, out.costUsd, out.seconds, out.buffer.length, path, ep.id);
  return { ep: db.prepare('SELECT * FROM episodes WHERE id=?').get(ep.id), audio: out };
}

/* ===== هزینه ===== */
// هزینه‌ی LLM: عددِ واقعیِ OpenRouter اگر بدهد، وگرنه تخمینِ جدولِ قیمت.
const LLM_PRICES = { // دلار بر میلیون توکن
  'google/gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'google/gemini-2.5-pro': { in: 1.25, out: 10 },
  'deepseek/deepseek-v3.2': { in: 0.28, out: 0.42 },
};
export function estimateLlmCost(model, tokIn, tokOut) {
  const p = LLM_PRICES[String(model || '').split(',')[0]] || LLM_PRICES['google/gemini-2.5-flash'];
  return (tokIn / 1e6) * p.in + (tokOut / 1e6) * p.out;
}

export async function settleLlmCost(deps, ep) {
  const { db, llm } = deps;
  let cost = null;
  const ids = String(ep.llm_gen_ids || '').split(',').filter(Boolean);
  if (ids.length) {
    const real = (await Promise.all(ids.map((id) => llm.generationCost(id).catch(() => null))))
      .filter((c) => typeof c === 'number');
    if (real.length === ids.length) cost = real.reduce((a, b) => a + b, 0);
  }
  if (cost === null) cost = estimateLlmCost(ep.llm_model, ep.llm_tokens_in, ep.llm_tokens_out);
  db.prepare('UPDATE episodes SET llm_cost_usd=? WHERE id=?').run(cost, ep.id);
  return cost;
}

/* ===== اجرای مراحل ===== */
// تا `stopAfter` پیش می‌رود (bake-ahead: تا synthesized). ارسال مرحله‌ی جداست.
export async function bake(deps, episodeId, { stopAfter = 'synthesized' } = {}) {
  const { db } = deps;
  let ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(episodeId);
  if (!ep) throw new PipelineError('claim', 'قسمت پیدا نشد');
  try {
    if (ep.status === 'pending') ep = await stageScript(deps, ep);
    if (stopAfter === 'scripted') return { ep };
    if (ep.status === 'scripted') {
      const r = await stageSynth(deps, ep);
      await settleLlmCost(deps, r.ep).catch(() => {});
      return { ep: db.prepare('SELECT * FROM episodes WHERE id=?').get(episodeId), audio: r.audio };
    }
    return { ep };
  } catch (e) {
    const stage = e instanceof PipelineError ? e.stage : 'unknown';
    db.prepare("UPDATE episodes SET status='failed', error=? WHERE id=?")
      .run(`[${stage}] ${String(e.message || e).slice(0, 400)}`, episodeId);
    logErr(`❌ EPISODE_FAILED #${episodeId} [${stage}]:`, e.message);
    throw e;
  }
}

// ارسالِ قسمتِ آماده. صدا از دیسک خوانده می‌شود (یا اگر همین الان ساخته شده، از همان بافر).
export async function deliver(deps, episodeId, audioBuffer = null) {
  const { db, telegram, ownerId, texts } = deps;
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(episodeId);
  if (!ep) throw new PipelineError('deliver', 'قسمت پیدا نشد');
  if (ep.status === 'delivered') return ep; // ضدِ ارسالِ دوباره (دو تیکِ هم‌زمانِ زمان‌بند)
  if (!audioBuffer && ep.audio_path && existsSync(ep.audio_path)) {
    audioBuffer = readFileSync(ep.audio_path);
  }
  if (!audioBuffer) throw new PipelineError('deliver', 'فایلِ صوتیِ این قسمت در دسترس نیست، دوباره بساز.');

  const msg = await telegram.sendAudio(ownerId, {
    source: audioBuffer,
    filename: `daily-brief-${ep.date}.mp3`,
  }, {
    title: ep.title || ep.lesson_title || 'قسمت روزانه',
    performer: texts.performer,
    caption: texts.episodeCaption(ep),
    reply_markup: {
      inline_keyboard: [[
        { text: '👍 مفید بود', callback_data: `fb:${ep.id}:up` },
        { text: '👎 خوب نبود', callback_data: `fb:${ep.id}:down` },
      ]],
    },
  });

  db.transaction(() => {
    db.prepare(`UPDATE episodes SET status='delivered', delivered_at=unixepoch(), tg_file_id=?
                WHERE id=?`).run(msg?.audio?.file_id || '', ep.id);
    if (ep.lesson_block_id) {
      db.prepare(`UPDATE lessons SET status='delivered', delivered_at=unixepoch(), episode_id=?
                  WHERE block_id=? AND status='pending'`).run(ep.id, ep.lesson_block_id);
    }
  })();
  // فایلِ روی دیسک دیگر لازم نیست: تلگرام خودش نگهش می‌دارد و file_id ذخیره شده،
  // پس ارسالِ دوباره هم بدونِ ساختِ دوباره ممکن است. (سهمیه‌ی دیسکِ سرور محدود است.)
  if (ep.audio_path) {
    try { rmSync(ep.audio_path, { force: true }); } catch (e) { logErr('audio cleanup:', e.message); }
  }
  log(`🎧 episode #${ep.id} delivered (${ep.audio_seconds}s, ${ep.engine})`);
  return db.prepare('SELECT * FROM episodes WHERE id=?').get(ep.id);
}

/* ===== ساختِ ردیفِ قسمت ===== */
// روزانه idempotent است: ایندکسِ یکتای (date) روی kind='daily' یعنی ری‌استارتِ وسطِ روز
// یا دو تیکِ هم‌زمانِ زمان‌بند هرگز دو قسمت نمی‌سازد.
export function claimDaily(deps, date, settings) {
  const { db } = deps;
  const info = db.prepare(`
    INSERT OR IGNORE INTO episodes (date, kind, status, duration_target, format, engine, voices_json, speed)
    VALUES (?, 'daily', 'pending', ?, ?, ?, ?, ?)
  `).run(date, settings.durationMin, settings.format, settings.engine,
         JSON.stringify(settings.voices || {}), settings.speed || 1);
  if (!info.changes) return null;
  return db.prepare('SELECT * FROM episodes WHERE id=?').get(info.lastInsertRowid);
}

export function createEpisode(deps, { date, kind, settings }) {
  const { db } = deps;
  const info = db.prepare(`
    INSERT INTO episodes (date, kind, status, duration_target, format, engine, voices_json, speed)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(date, kind, settings.durationMin, settings.format, settings.engine,
         JSON.stringify(settings.voices || {}), settings.speed || 1);
  return db.prepare('SELECT * FROM episodes WHERE id=?').get(info.lastInsertRowid);
}

/* ===== بازیابیِ بوت ===== */
// هر deploy یعنی restart؛ قسمتی که وسطِ ساخت بوده در حافظه مرده ولی ردیفش در DB مانده.
export function recoverStuck(db) {
  const rows = db.prepare(`SELECT id, status FROM episodes
    WHERE status IN ('pending','scripted','synthesized')
      AND created_at < unixepoch() - ? `).all(STUCK_MINUTES * 60);
  for (const r of rows) {
    db.prepare("UPDATE episodes SET status='failed', error=? WHERE id=?")
      .run(`[restart] ساختِ قسمت وسطِ مرحله‌ی ${r.status} با ری‌استارت قطع شد`, r.id);
  }
  return rows;
}

export { engineLabel };
