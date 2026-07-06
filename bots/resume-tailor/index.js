// index.js — Resume Tailor Telegram bot (multi-agent)
//
// فلو:
//  1) آنبوردینگ: «رزومه داری؟» → (اختیاری) یک فایل رزومه → جمع‌آوریِ چندفایلیِ سوابق
//     با تأیید هر فایل و دکمه‌ی «همه را فرستادم».
//  2) ساماندهیِ چندایجنتی (Gemini Pro): لایه۱ تفکیک شرکت‌ها، لایه۲ ساختارمندکردنِ هر شرکت.
//     خروجی: یک «پروفایل ساختاریافته» که کاربر می‌تواند ببیند و با متن/ویس ویرایش کند.
//  3) تولیدِ چندایجنتی رزومه برای هر آگهی: ایجنت‌های جدا برای Summary / Experience / Skills
//     که موازی اجرا و سپس به‌صورت برنامه‌نویسی‌شده ترکیب می‌شوند.
//
// ویس→متن: google/gemini-2.5-flash | کارهای دقیق: google/gemini-2.5-pro (همه از OpenRouter)
import 'dotenv/config';
import { mkdirSync } from 'fs';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { RESUME_KNOWLEDGE } from './resume-knowledge.js';
import { log, logErr } from '../../shared/logger.js';
import { registerGlobalErrorHandlers, makeBotCatch } from '../../shared/errors.js';

/* ===== 1) ENV ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { logErr('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

// بهینه‌سازی هزینه: Pro فقط برای بزرگ‌ترین و مهم‌ترین بخش (شرح شغلیِ رزومه).
// بقیه‌ی کارها (ویس→متن، ساماندهی پروفایل، ویرایش، Summary، Skills) با Flash.
const FLASH = 'google/gemini-2.5-flash';
const PRO   = 'google/gemini-2.5-pro';
const TRANSCRIBE_MODEL = FLASH; // ویس → متن
const OR_TIMEOUT_MS    = 10 * 60 * 1000;
const MIN_JOB_TEXT_LEN = 400;
const TELEGRAM_MAX_DOWNLOAD = 20 * 1024 * 1024;

/* ===== 2) Database ===== */
mkdirSync('./data', { recursive: true });
const db = new Database('./data/bot.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id      INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL DEFAULT '',
    username         TEXT    NOT NULL DEFAULT '',
    state            TEXT    NOT NULL DEFAULT 'new',
    pending_job_url  TEXT    NOT NULL DEFAULT '',
    pending_job_text TEXT    NOT NULL DEFAULT '',
    edit_company_idx INTEGER NOT NULL DEFAULT -1,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen        INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS profiles (
    user_id            INTEGER PRIMARY KEY,
    has_resume         INTEGER NOT NULL DEFAULT 0,
    main_resume        TEXT NOT NULL DEFAULT '',
    contact_info       TEXT NOT NULL DEFAULT '',
    structured_profile TEXT NOT NULL DEFAULT '',
    updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS history_chunks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    kind       TEXT    NOT NULL DEFAULT 'text',
    source     TEXT    NOT NULL DEFAULT '',
    content    TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS generations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    job_url     TEXT,
    job_text    TEXT,
    extra_notes TEXT,
    output      TEXT,
    model       TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const qUpsertUser = db.prepare(`
  INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()
`);
const qGetUser   = db.prepare('SELECT * FROM users WHERE telegram_id=?');
const qSetState  = db.prepare('UPDATE users SET state=?, last_seen=unixepoch() WHERE telegram_id=?');
const qSetEditIdx = db.prepare('UPDATE users SET edit_company_idx=? WHERE telegram_id=?');

const qGetProfile = db.prepare('SELECT * FROM profiles WHERE user_id=?');
const qEnsureProfile = db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)');
const qSetResume = db.prepare('UPDATE profiles SET has_resume=1, main_resume=?, contact_info=?, updated_at=unixepoch() WHERE user_id=?');
const qSetStructured = db.prepare('UPDATE profiles SET structured_profile=?, updated_at=unixepoch() WHERE user_id=?');

const qAddChunk   = db.prepare('INSERT INTO history_chunks (user_id, kind, source, content) VALUES (?, ?, ?, ?)');
const qCountChunks = db.prepare('SELECT COUNT(*) AS n FROM history_chunks WHERE user_id=?');
const qGetChunks  = db.prepare('SELECT * FROM history_chunks WHERE user_id=? ORDER BY id');
const qDelChunks  = db.prepare('DELETE FROM history_chunks WHERE user_id=?');

const qSetPending   = db.prepare('UPDATE users SET pending_job_url=?, pending_job_text=?, last_seen=unixepoch() WHERE telegram_id=?');
const qClearPending = db.prepare("UPDATE users SET pending_job_url='', pending_job_text='' WHERE telegram_id=?");
const qInsertGen = db.prepare('INSERT INTO generations (user_id, job_url, job_text, extra_notes, output, model) VALUES (?, ?, ?, ?, ?, ?)');

function upsertUser(ctx) { qUpsertUser.run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || ''); qEnsureProfile.run(ctx.from.id); }
function getState(uid)   { return qGetUser.get(uid)?.state || 'new'; }
function setState(uid, s) { qSetState.run(s, uid); }
function setPending(uid, url, text) { qSetPending.run(url || '', text || '', uid); }
function getPending(uid) { const u = qGetUser.get(uid); return u ? { jobUrl: u.pending_job_url || null, jobText: u.pending_job_text || '' } : null; }
// پاک‌سازی کاملِ یک کاربر — انگار کاربر جدید آمده (برای فاز تست)
function wipeUser(uid) {
  db.prepare('DELETE FROM profiles WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM history_chunks WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM generations WHERE user_id=?').run(uid);
  qClearPending.run(uid);
  qSetEditIdx.run(-1, uid);
  setState(uid, 'new');
  qEnsureProfile.run(uid);
}

/* ===== 3) OpenRouter ===== */
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
      logErr(`❌ OpenRouter ${res.status} (${body.model}) after ${Date.now()-t0}ms:`, errBody.slice(0, 300));
      throw new Error(`OpenRouter error ${res.status}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    const u = data.usage || {};
    log(`✅ ${body.model} in ${Date.now()-t0}ms | tok(in/out)=${u.prompt_tokens ?? '?'}/${u.completion_tokens ?? '?'} | ${text.length} chars`);
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`TIMEOUT: ${body.model} در ۱۰ دقیقه پاسخ نداد`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function orChat(model, system, user) {
  return orRequest({ model, messages: [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ] });
}
function orTranscribe(audioBuffer, format) {
  return orRequest({
    model: TRANSCRIBE_MODEL,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.' },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ] }],
  });
}
// استخراج امنِ JSON از خروجی مدل (با حذف code fence و گرفتن اولین {..})
function parseJsonLoose(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch (e) { logErr('JSON parse failed:', e.message, '| head:', t.slice(0, 120)); return null; }
}

/* ===== 4) استخراج متن از فایل/ویس تلگرام ===== */
async function downloadTelegramFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function extractTextFromDocument(ctx, doc) {
  if (doc.file_size && doc.file_size > TELEGRAM_MAX_DOWNLOAD) throw new Error('TOO_BIG');
  const buf = await downloadTelegramFile(ctx, doc.file_id);
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  if (name.endsWith('.pdf')  || mime.includes('pdf'))  return (await pdfParse(buf)).text || '';
  if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) return (await mammoth.extractRawText({ buffer: buf })).value || '';
  if (name.endsWith('.txt')  || name.endsWith('.md') || mime.startsWith('text/')) return buf.toString('utf8');
  throw new Error('UNSUPPORTED');
}
async function transcribeVoiceMessage(ctx, media, mime) {
  const buf = await downloadTelegramFile(ctx, media.file_id);
  let fmt = /wav/i.test(mime || '') ? 'wav' : 'mp3';
  if (/ogg|opus|oga/i.test(mime || '')) fmt = 'mp3'; // gemini فایل ogg را با برچسب mp3 هم می‌پذیرد
  return orTranscribe(buf, fmt);
}

/* ===== 5) کرال آگهی شغلی ===== */
function looksLikeUrl(t) { return /^https?:\/\/\S+$/i.test(t.trim()); }
async function fetchJobPosting(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml' },
      signal: ctrl.signal, redirect: 'follow',
    });
    if (!res.ok) return null;
    return htmlToText(await res.text());
  } catch (err) { logErr('crawl error:', err.message); return null; }
  finally { clearTimeout(timer); }
}
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/* ===== 6) ایجنت‌ها و پرامپت‌ها ===== */
const NO_HALLUCINATION =
`CRITICAL ANTI-HALLUCINATION RULE: Use ONLY information explicitly present in the provided user data. Never invent, infer, embellish, or add employers, titles, dates, metrics, skills, achievements, or any fact that is not literally supported by the input. If something is not present, leave it out or mark it null/empty. Do not "improve" reality.`;

// ---- ساماندهی: لایه ۱ — تفکیک شرکت‌ها ----
const AGENT_SPLIT_COMPANIES =
`You are a meticulous data-partitioning engine. From the candidate's resume and raw history documents, identify the distinct COMPANIES/employers the person worked at, and route every piece of source text to the right company verbatim (no rewriting, no invention).

${NO_HALLUCINATION}

Output ONLY valid minified JSON with this exact shape:
{"companies":[{"company":"<employer name as written>","raw":"<all source text relevant to this employer, copied verbatim and concatenated>"}],"education":"<verbatim education-related text or ''>","certifications":"<verbatim certifications text or ''>","other":"<any other relevant verbatim text or ''>"}

Rules:
- One entry per distinct employer. If the same employer appears in multiple documents, merge their raw text under one entry.
- Keep raw text faithful; you may concatenate but must not summarize or invent.
- If you truly cannot attribute a chunk to a company, put it in "other".
- No markdown, no commentary — JSON only.`;

// ---- ساماندهی: لایه ۲ — ساختارمندکردنِ یک شرکت ----
const AGENT_ORGANIZE_COMPANY =
`You are a career-data structuring specialist. You receive the raw text for ONE employer. Organize it into a clean structure. Crucially, separate "what work was done" (work items / scopes) from "what positions/titles were held" — these are different axes. Different kinds of work must be partitioned with correct boundaries (one company may contain many distinct work items, another may contain only the one or two lines from the resume — that is fine, keep whatever the data supports).

${NO_HALLUCINATION}

Output ONLY valid minified JSON with this exact shape:
{"company":"<name>","location":"<or null>","overall_dates":"<or null>","positions":[{"title":"<title>","dates":"<or null>"}],"work_items":[{"scope":"<short label of a distinct area/project of work>","summary":"<what was done, only from data>","skills":["<skill>"],"timeline":[{"date":"<date or period>","change":"<what changed at that date: promotion, scope change, milestone>"}],"impact":"<results/impact from data, or null>"}],"skills":["<company-level skills found in data>"],"notes":"<anything else present in data, or null>"}

Rules:
- positions = job titles only. work_items = the actual work, scopes, projects, responsibilities.
- timeline captures dated changes (promotions, scope shifts, milestones) when dates exist in the data.
- If the company only has a one/two-line mention, produce a minimal structure from exactly that — do not pad it.
- No markdown, no commentary — JSON only.`;

// ---- ویرایش یک شرکت با دستور کاربر ----
const AGENT_EDIT_COMPANY =
`You apply a user's edit instruction to ONE company's structured JSON. Return the FULL updated JSON for that company, in the same schema. Apply only what the instruction asks. You may reorganize, relabel, move, or remove items per the instruction.

${NO_HALLUCINATION}
(The instruction may reorganize or correct existing data, but you must not fabricate new factual content that the user did not provide in the instruction or the existing structure.)

Output ONLY the updated company JSON (same shape as input), minified. No commentary.`;

// ---- دانش رزومه‌نویسی: از فایل resume-knowledge.js (عصاره‌ی Deep Research) تزریق می‌شود ----

// ---- ایجنت‌های تولید (هر بخش جدا) ----
const AGENT_SUMMARY = (knowledge) =>
`You are a professional resume writer producing ONLY the "Professional Summary" section: 4–5 lines, tailored to the TARGET JOB, drawn strictly from the candidate's STRUCTURED PROFILE.
${knowledge}
${NO_HALLUCINATION}
Output ONLY the summary text (4–5 lines), no header, no commentary.`;

const AGENT_EXPERIENCE = (knowledge) =>
`You are a professional resume writer producing ONLY the "Professional Experience" section, tailored to the TARGET JOB, drawn strictly from the candidate's STRUCTURED PROFILE.
${knowledge}
${NO_HALLUCINATION}
Hard rules:
- Reverse-chronological. For each company: "Title — Company | Dates" then 3–6 tailored achievement bullets.
- Job TITLES, company names, and dates must match the structured profile exactly (do not invent or alter), UNLESS the EXTRA NOTES explicitly allow flexibility for a specific role.
- Emphasize work items relevant to the target job; de-emphasize or drop unrelated ones. Mirror the posting's keywords naturally.
Output ONLY the experience section as Markdown bullets, no top-level header, no commentary.`;

const AGENT_SKILLS = (knowledge) =>
`You are a professional resume writer producing ONLY the "Skills" section, tailored to the TARGET JOB, drawn strictly from the candidate's STRUCTURED PROFILE.
${knowledge}
${NO_HALLUCINATION}
- Group skills sensibly (e.g., by domain/tooling). Prioritize skills relevant to the target job. Include only skills present in the profile.
Output ONLY the skills section (compact), no top-level header, no commentary.`;

// ---- ایجنت عمومیِ یک بخش دلخواه (هر بخشی غیر از Summary/Skills/Experience) ----
const AGENT_SECTION = (title, knowledge) =>
`You are a professional resume writer producing ONLY the "${title}" section of a resume, tailored to the TARGET JOB, drawn strictly from the candidate's data (STRUCTURED_PROFILE and MAIN_RESUME).
${knowledge}
${NO_HALLUCINATION}
- Include only content actually present in the data. If there is NO supporting data for this section, output exactly: __EMPTY__
- Do NOT print the section title/header; output only the section body as clean Markdown.`;

// ---- مغزِ ساختار (Flash): تصمیم می‌گیرد رزومه شامل چه بخش‌هایی باشد ----
const AGENT_STRUCTURE_PLANNER =
`You are a resume STRUCTURE planner. Decide which sections the final resume should contain and in what order, based on ALL of: the TARGET JOB, the candidate's MAIN_RESUME (their latest version), their STRUCTURED_PROFILE, the EXTRA_NOTES (explicit user requests), and the RESUME KNOWLEDGE.

${NO_HALLUCINATION}

Rules:
- ALWAYS include these three (use exactly these ids): "summary", "skills", "experience".
- Add OTHER sections (e.g. education, certifications, projects, languages, awards, publications, volunteer) ONLY when they are supported by the candidate's data OR explicitly requested in EXTRA_NOTES.
- Respect explicit user requests in EXTRA_NOTES about which sections to include/exclude/order.
- Choose a sensible professional order (commonly: summary, skills, experience, then extras; education/certifications usually near the end).

Output ONLY valid minified JSON: {"sections":[{"id":"summary","title":"Professional Summary"},{"id":"skills","title":"Core Skills"},{"id":"experience","title":"Professional Experience"}]}
- id is a short lowercase key; title is the display heading. No commentary.`;

const CONTACT_EXTRACT_PROMPT =
`Extract ONLY the fixed contact/header block from the resume text as plain lines (do not invent anything): Full name, Email, Phone, Location/City, LinkedIn/GitHub/Portfolio URLs, and any headline/title shown in the header. Omit missing fields. Output only these lines.`;

/* ===== 7) ساخت پروفایل ساختاریافته ===== */
function collectSourcesText(uid) {
  const p = qGetProfile.get(uid);
  const chunks = qGetChunks.all(uid);
  const parts = [];
  if (p?.main_resume?.trim()) parts.push(`### CURRENT RESUME (may be incomplete)\n${p.main_resume}`);
  chunks.forEach((c, i) => parts.push(`### HISTORY DOCUMENT ${i + 1} (${c.source || c.kind})\n${c.content}`));
  return parts.join('\n\n');
}

async function buildStructuredProfile(uid) {
  const sources = collectSourcesText(uid);
  // لایه ۱: تفکیک شرکت‌ها (Flash)
  const splitRaw = await orChat(FLASH, AGENT_SPLIT_COMPANIES, sources);
  const split = parseJsonLoose(splitRaw) || { companies: [], education: '', certifications: '', other: '' };
  const companiesRaw = Array.isArray(split.companies) ? split.companies : [];
  // لایه ۲: ساختارمندکردنِ هر شرکت (موازی)
  const organized = await Promise.all(companiesRaw.map(async (c) => {
    try {
      const out = await orChat(FLASH, AGENT_ORGANIZE_COMPANY, `### EMPLOYER: ${c.company || ''}\n${c.raw || ''}`);
      const obj = parseJsonLoose(out);
      return obj || { company: c.company || 'Unknown', positions: [], work_items: [], skills: [], notes: c.raw || '' };
    } catch (e) {
      logErr('organize company failed:', e.message);
      return { company: c.company || 'Unknown', positions: [], work_items: [], skills: [], notes: c.raw || '' };
    }
  }));
  const structured = {
    companies: organized,
    education: split.education || '',
    certifications: split.certifications || '',
    other: split.other || '',
    built_at: Date.now(),
  };
  qSetStructured.run(JSON.stringify(structured), uid);
  return structured;
}
function getStructured(uid) {
  const p = qGetProfile.get(uid);
  if (!p?.structured_profile) return null;
  try { return JSON.parse(p.structured_profile); } catch { return null; }
}

/* ===== 8) رندرِ خواناىِ پروفایل ===== */
function renderCompany(c, idx) {
  const lines = [`🏢 *${idx + 1}. ${c.company || 'Unknown'}*${c.overall_dates ? ` (${c.overall_dates})` : ''}`];
  if (Array.isArray(c.positions) && c.positions.length)
    lines.push('• عناوین: ' + c.positions.map(p => `${p.title}${p.dates ? ` (${p.dates})` : ''}`).join(' / '));
  if (Array.isArray(c.work_items))
    c.work_items.forEach((w) => {
      lines.push(`  ▸ ${w.scope || ''}${w.impact ? ` — اثر: ${w.impact}` : ''}`);
      if (w.skills?.length) lines.push(`     skills: ${w.skills.join(', ')}`);
      if (w.timeline?.length) w.timeline.forEach(t => lines.push(`     ${t.date}: ${t.change}`));
    });
  if (c.skills?.length) lines.push('• مهارت‌ها: ' + c.skills.join(', '));
  return lines.join('\n');
}
function renderStructured(s) {
  if (!s) return 'پروفایل ساختاریافته‌ای موجود نیست.';
  const blocks = (s.companies || []).map(renderCompany);
  if (s.education)      blocks.push(`🎓 تحصیلات:\n${s.education}`);
  if (s.certifications) blocks.push(`📜 گواهی‌ها:\n${s.certifications}`);
  return blocks.join('\n\n');
}

/* ===== 9) تولید رزومه (چندایجنتی) ===== */
function profileForGeneration(s) {
  // فشرده‌سازیِ پروفایل ساختاریافته به متن برای ایجنت‌های تولید
  return JSON.stringify(s);
}
function buildGenContext(p, s, jobText, jobUrl, notes) {
  return [
    `### CONTACT_INFO\n${p.contact_info || '(derive from profile)'}`,
    `### MAIN_RESUME (candidate's latest version, may be incomplete)\n${p.main_resume || '(none)'}`,
    `### STRUCTURED_PROFILE\n${profileForGeneration(s)}`,
    `### TARGET_JOB${jobUrl ? ` (source: ${jobUrl})` : ''}\n${jobText}`,
    `### EXTRA_NOTES\n${notes && notes.trim() ? notes.trim() : '(none — keep titles fixed, tailor the rest.)'}`,
  ].join('\n\n');
}

const DEFAULT_SECTIONS = [
  { id: 'summary',    title: 'Professional Summary' },
  { id: 'skills',     title: 'Core Skills' },
  { id: 'experience', title: 'Professional Experience' },
];
// تضمین حضور سه بخشِ الزامی (در صورتی که planner جا انداخته باشد)
function ensureCoreSections(sections) {
  const out = Array.isArray(sections) ? sections.filter(x => x && x.id && x.title) : [];
  for (const core of DEFAULT_SECTIONS) {
    if (!out.some(x => x.id === core.id)) out.push(core);
  }
  return out;
}
// انتخاب مدل و پرامپتِ هر بخش: فقط experience با Pro، بقیه Flash.
function agentForSection(sec) {
  if (sec.id === 'experience') return { model: PRO,   system: AGENT_EXPERIENCE(RESUME_KNOWLEDGE) };
  if (sec.id === 'summary')    return { model: FLASH, system: AGENT_SUMMARY(RESUME_KNOWLEDGE) };
  if (sec.id === 'skills')     return { model: FLASH, system: AGENT_SKILLS(RESUME_KNOWLEDGE) };
  return { model: FLASH, system: AGENT_SECTION(sec.title, RESUME_KNOWLEDGE) };
}

async function generateResumeMultiAgent(p, s, jobText, jobUrl, notes) {
  const ctx = buildGenContext(p, s, jobText, jobUrl, notes);
  // ۱) مغزِ ساختار (Flash) تصمیم می‌گیرد رزومه چه بخش‌هایی داشته باشد
  let sections;
  try {
    const planRaw = await orChat(FLASH, `${AGENT_STRUCTURE_PLANNER}\n\n### RESUME KNOWLEDGE\n${RESUME_KNOWLEDGE}`, ctx);
    sections = ensureCoreSections(parseJsonLoose(planRaw)?.sections);
  } catch (e) { logErr('planner failed, using default sections:', e.message); sections = [...DEFAULT_SECTIONS]; }
  log(`🧩 sections: ${sections.map(x => x.id).join(', ')}`);

  // ۲) هر بخش با ایجنت خودش (موازی)؛ فقط experience با Pro
  const bodies = await Promise.all(sections.map(async (sec) => {
    const { model, system } = agentForSection(sec);
    try {
      const body = (await orChat(model, system, ctx)).trim();
      return { sec, body };
    } catch (e) { logErr(`section ${sec.id} failed:`, e.message); return { sec, body: '' }; }
  }));

  // ۳) ترکیب برنامه‌نویسی‌شده به ترتیبِ planner (بخش‌های خالی حذف می‌شوند)
  const header = (p.contact_info || '').trim();
  const parts = [];
  if (header) parts.push(header);
  for (const { sec, body } of bodies) {
    if (!body || body === '__EMPTY__') continue;
    parts.push(`## ${sec.title}\n${body}`);
  }
  return parts.join('\n\n');
}

/* ===== 10) Telegram helpers ===== */
const TG_LIMIT = 3800;
async function replyLong(ctx, text, extra) {
  for (let i = 0; i < text.length; i += TG_LIMIT) {
    const isLast = i + TG_LIMIT >= text.length;
    await ctx.reply(text.slice(i, i + TG_LIMIT), isLast ? extra : undefined);
  }
}
async function sendResumeFile(ctx, text) {
  await ctx.replyWithDocument({ source: Buffer.from(text, 'utf8'), filename: `resume_${Date.now()}.md` });
}
const kbHasResume = Markup.inlineKeyboard([
  [Markup.button.callback('✅ رزومه دارم', 'has_resume')],
  [Markup.button.callback('🚫 رزومه ندارم', 'no_resume')],
]);
const kbHistoryDone = Markup.inlineKeyboard([[Markup.button.callback('✅ همه را فرستادم', 'history_done')]]);
const PDF_HINT =
'📄 خروجی، متن استاندارد + فایل `.md` است. برای PDF حرفه‌ای: VS Code + افزونه‌ی «Markdown PDF»، یا Typora/Dillinger.io، یا کپی در Google Docs/Word و خروجی PDF.';

const HELP =
`🤖 ربات رزومه‌ساز چندایجنتی

۱) /start → می‌پرسم رزومه داری؟ اگر داری، آخرین نسخه (حتی ناقص) را بفرست.
۲) بعد، تمام فایل‌ها/پیام‌های شرح سوابقت را دانه‌دانه بفرست؛ هرکدام را تأیید می‌کنم و آخرش دکمه‌ی «همه را فرستادم» را بزن.
۳) من اطلاعاتت را با چند ایجنت ساختارمند می‌کنم (تفکیک شرکت‌ها و کارها). با /profile ببینش و با /edit ویرایشش کن (متن یا ویس).
۴) برای هر آگهی شغلی، لینک یا متن آگهی را بفرست تا رزومه‌ی کاستومایز (چندایجنتی) بسازم.

دستورها: /profile /edit /reset /help`;

/* ===== 11) Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: OR_TIMEOUT_MS });

// گارد خطای سراسری (بند ۸ CLAUDE.md): هیچ خطایی نباید بی‌صدا فلو را بکشد
bot.catch(makeBotCatch({ getState }));

// دکمه‌ی persistent «ریست» زیر محل تایپ (فاز تست)
const RESET_BTN = '🔄 ریست ربات (تست)';
const testKb = Markup.keyboard([[RESET_BTN]]).resize();

function profileReady(uid) { const s = getStructured(uid); return !!(s && s.companies); }

async function askHasResume(ctx) {
  setState(ctx.from.id, 'ask_has_resume');
  await ctx.reply(
    'سلام! 👋 برای شناختت شروع می‌کنیم.\n\nآیا آخرین نسخه از رزومه‌ات را داری؟ (حتی اگر ناقص باشد و آخرین موقعیت شغلی‌ات در آن نباشد هم اشکالی ندارد.)',
    kbHasResume
  );
}
async function startHistoryCollection(ctx) {
  setState(ctx.from.id, 'collect_history');
  await ctx.reply(
    'حالا شرح کامل سوابق کاری‌ات را بفرست. 📎\n\n' +
    'می‌توانی **چندین فایل یا پیام** (PDF/DOCX/TXT/متن/ویس) را دانه‌دانه بفرستی — مثل ارزیابی‌های شغلی، توضیح پروژه‌ها و... .\n' +
    'بعد از هر مورد تأیید می‌کنم. وقتی همه را فرستادی، دکمه‌ی «✅ همه را فرستادم» را بزن تا پردازش شروع شود.'
  );
}

bot.start(async (ctx) => {
  upsertUser(ctx);
  await ctx.reply('🧪 حالت تست فعال است. برای پاک‌سازی کاملِ اطلاعاتت و شروع از صفر، هر زمان دکمه‌ی «🔄 ریست ربات (تست)» پایین را بزن.', testKb);
  await askHasResume(ctx);
});
bot.command('help', (ctx) => ctx.reply(HELP, testKb));

// دکمه/کامند ریست تست — کاربر را کاملاً پاک می‌کند (انگار کاربر جدید)
async function doReset(ctx) {
  wipeUser(ctx.from.id);
  await ctx.reply('🔄 ربات ریست شد. تمام اطلاعاتت پاک شد و مثل کاربر جدید هستی.', testKb);
  return askHasResume(ctx);
}
bot.hears(RESET_BTN, (ctx) => { upsertUser(ctx); return doReset(ctx); });
bot.command('reset', (ctx) => { upsertUser(ctx); return doReset(ctx); });

bot.command('profile', (ctx) => {
  upsertUser(ctx);
  const s = getStructured(ctx.from.id);
  if (!s) return ctx.reply('هنوز پروفایل ساختاریافته‌ای نداری. با /start شروع کن.');
  return replyLong(ctx, '📋 پروفایل ساختاریافته‌ی تو:\n\n' + renderStructured(s));
});

bot.command('edit', (ctx) => {
  upsertUser(ctx);
  const s = getStructured(ctx.from.id);
  if (!s || !s.companies?.length) return ctx.reply('چیزی برای ویرایش نیست. اول با /start پروفایل بساز.');
  const rows = s.companies.map((c, i) => [Markup.button.callback(`✏️ ${c.company || ('شرکت ' + (i + 1))}`, `editco:${i}`)]);
  return ctx.reply('کدام شرکت را ویرایش کنم؟', Markup.inlineKeyboard(rows));
});

/* ---- دکمه‌ها ---- */
bot.action('has_resume', async (ctx) => {
  await ctx.answerCbQuery();
  setState(ctx.from.id, 'await_resume_file');
  await ctx.reply('باشه 👍 آخرین نسخه‌ی رزومه‌ات را بفرست (فایل PDF/DOCX/TXT یا متن).');
});
bot.action('no_resume', async (ctx) => {
  await ctx.answerCbQuery();
  upsertUser(ctx);
  await ctx.reply('باشه، بدون رزومه ادامه می‌دهیم.');
  await startHistoryCollection(ctx);
});
bot.action('history_done', async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const n = qCountChunks.get(uid).n;
  const hasResume = qGetProfile.get(uid)?.main_resume?.trim();
  if (n === 0 && !hasResume) return ctx.reply('هنوز چیزی نفرستادی. حداقل یک فایل/پیام از سوابقت بفرست، بعد این دکمه را بزن.');
  setState(uid, 'structuring');
  await ctx.reply('⏳ در حال ساماندهیِ اطلاعاتت با چند ایجنت... (تفکیک شرکت‌ها و کارها — ممکن است کمی طول بکشد)');
  try {
    const s = await buildStructuredProfile(uid);
    setState(uid, 'ready');
    await replyLong(ctx, '✅ پروفایلت ساختارمند شد:\n\n' + renderStructured(s));
    await ctx.reply('می‌توانی با /edit ویرایشش کنی. هر وقت آماده بودی، لینک یا متن یک آگهی شغلی بفرست تا رزومه‌ی کاستومایز بسازم.');
  } catch (e) {
    logErr('structuring failed:', e.message);
    setState(uid, 'collect_history');
    await ctx.reply('❌ در ساماندهی مشکلی پیش آمد. چند لحظه بعد دوباره دکمه‌ی «همه را فرستادم» را بزن.');
  }
});
bot.action(/^editco:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const idx = parseInt(ctx.match[1], 10);
  const s = getStructured(uid);
  if (!s || !s.companies?.[idx]) return ctx.reply('این شرکت پیدا نشد. /edit را دوباره بزن.');
  qSetEditIdx.run(idx, uid);
  setState(uid, 'edit_company');
  await ctx.reply(
    `ویرایش «${s.companies[idx].company}». وضعیت فعلی:\n\n${renderCompany(s.companies[idx], idx)}\n\n` +
    'حالا دستور تغییر را به‌صورت متن یا ویس بفرست (مثلاً «این دو کار را ادغام کن» یا «اسکیل X را اضافه کن»). برای انصراف /cancel.'
  );
});
bot.command('cancel', (ctx) => { setState(ctx.from.id, 'ready'); qSetEditIdx.run(-1, ctx.from.id); return ctx.reply('انصراف داده شد.'); });

/* ---- پردازشِ ویرایش یک شرکت ---- */
async function applyCompanyEdit(ctx, instruction) {
  const uid = ctx.from.id;
  const idx = qGetUser.get(uid)?.edit_company_idx ?? -1;
  const s = getStructured(uid);
  if (idx < 0 || !s?.companies?.[idx]) { setState(uid, 'ready'); return ctx.reply('چیزی برای ویرایش نبود.'); }
  await ctx.reply('⏳ در حال اعمال تغییر...');
  try {
    const out = await orChat(FLASH, AGENT_EDIT_COMPANY,
      `### CURRENT COMPANY JSON\n${JSON.stringify(s.companies[idx])}\n\n### USER INSTRUCTION\n${instruction}`);
    const updated = parseJsonLoose(out);
    if (!updated) throw new Error('parse failed');
    s.companies[idx] = updated;
    qSetStructured.run(JSON.stringify(s), uid);
    setState(uid, 'ready'); qSetEditIdx.run(-1, uid);
    await replyLong(ctx, '✅ به‌روزرسانی شد:\n\n' + renderCompany(updated, idx));
  } catch (e) {
    logErr('edit failed:', e.message);
    await ctx.reply('❌ نتوانستم تغییر را اعمال کنم. دوباره با جمله‌ی دیگری امتحان کن یا /cancel.');
  }
}

/* ---- شروع تولید برای یک آگهی ---- */
async function startJob(ctx, jobText, jobUrl) {
  const uid = ctx.from.id;
  setPending(uid, jobUrl || '', jobText);
  setState(uid, 'await_notes');
  await ctx.reply('✅ آگهی دریافت شد.\n\nتوضیحات تکمیلی داری؟ (روی چه بخش‌هایی مانور بدم، انعطاف عنوان‌ها، یک‌صفحه‌بودن و...)\nمتن یا ویس بفرست، یا «رد شو».');
}
async function generateResume(ctx, notes) {
  const uid = ctx.from.id;
  const job = getPending(uid);
  if (!job || !job.jobText?.trim()) { setState(uid, 'ready'); return ctx.reply('آگهی‌ای پیدا نکردم. دوباره لینک/متن آگهی را بفرست.'); }
  const p = qGetProfile.get(uid);
  const s = getStructured(uid);
  if (!s) { setState(uid, 'new'); return ctx.reply('اول باید پروفایلت ساخته شود. /start را بزن.'); }
  await ctx.reply('⏳ در حال ساخت رزومه‌ی کاستومایز... (اول ساختار بخش‌ها تعیین می‌شود، بعد هر بخش با ایجنت خودش ساخته می‌شود)');
  try {
    const out = await generateResumeMultiAgent(p, s, job.jobText, job.jobUrl, notes);
    if (!out) throw new Error('empty output');
    qInsertGen.run(uid, job.jobUrl, job.jobText, notes || '', out, 'exp=pro;summary,skills=flash');
    await replyLong(ctx, out);
    await sendResumeFile(ctx, out);
    await ctx.reply(PDF_HINT);
    await ctx.reply('✅ آماده شد. برای آگهی بعدی، فقط لینک/متن آگهی جدید را بفرست.');
  } catch (e) {
    logErr('generate failed:', e.message);
    return ctx.reply('❌ مشکلی در ساخت رزومه پیش آمد. چند لحظه بعد یک «رد شو» یا توضیح بفرست تا دوباره بسازم.');
  }
  qClearPending.run(uid);
  setState(uid, 'ready');
}

/* ---- ذخیره‌ی یک ورودیِ سوابق (متن/فایل/ویس) ---- */
async function addHistory(ctx, content, kind, source) {
  const uid = ctx.from.id;
  if (!content || content.trim().length < 5) { await ctx.reply('محتوای قابل‌خواندنی نگرفتم. دوباره بفرست.'); return; }
  qAddChunk.run(uid, kind, source || '', content.trim());
  const n = qCountChunks.get(uid).n;
  await ctx.reply(`✔️ دریافت شد (${n} مورد تا الان). اگر مورد دیگری داری بفرست، وگرنه دکمه‌ی زیر را بزن.`, kbHistoryDone);
}

/* ---- هندلر متن ---- */
bot.on('text', async (ctx) => {
  upsertUser(ctx);
  const uid = ctx.from.id;
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  const state = getState(uid);
  try {
    if (state === 'await_resume_file') {
      const contact = await orChat(TRANSCRIBE_MODEL, CONTACT_EXTRACT_PROMPT, text).catch(() => '');
      qSetResume.run(text.trim(), contact || '', uid);
      await ctx.reply('✔️ رزومه ذخیره شد.');
      return await startHistoryCollection(ctx);
    }
    if (state === 'collect_history')  return await addHistory(ctx, text, 'text', 'پیام متنی');
    if (state === 'edit_company')     return await applyCompanyEdit(ctx, text);

    if (state === 'await_notes') {
      const skip = /^(رد شو|ردشو|skip|نه|ندارم|خیر|no)$/i.test(text.trim());
      return await generateResume(ctx, skip ? '' : text);
    }
    if (state === 'await_job_text') {
      if (text.trim().length < MIN_JOB_TEXT_LEN) return ctx.reply(`متن آگهی خیلی کوتاه است (${text.trim().length} کاراکتر). کل متن آگهی را کامل بفرست.`);
      const savedUrl = getPending(uid)?.jobUrl || null;
      return await startJob(ctx, text.trim(), savedUrl);
    }

    // ready (یا هر حالت دیگر با پروفایل آماده): انتظار آگهی
    if (!profileReady(uid)) { await ctx.reply('بیا اول پروفایلت را بسازیم:'); return await askHasResume(ctx); }
    if (looksLikeUrl(text)) {
      await ctx.reply('🔎 در حال خواندن آگهی از لینک...');
      const crawled = await fetchJobPosting(text.trim());
      if (crawled && crawled.length >= MIN_JOB_TEXT_LEN) return await startJob(ctx, crawled, text.trim());
      setPending(uid, text.trim(), '');
      setState(uid, 'await_job_text');
      return ctx.reply('نتوانستم این آگهی را کرال کنم (احتمالاً ضدبات). کل متن آگهی را کپی و همین‌جا بفرست.');
    }
    if (text.trim().length >= MIN_JOB_TEXT_LEN) return await startJob(ctx, text.trim(), null);
    return ctx.reply('یک «لینک آگهی شغلی» بفرست یا کل متن آگهی را کپی کن. (/help)');
  } catch (e) {
    logErr('text handler error:', e.message);
    await ctx.reply('❌ خطایی رخ داد. دوباره تلاش کن.');
  }
});

/* ---- هندلر فایل ---- */
bot.on('document', async (ctx) => {
  upsertUser(ctx);
  const uid = ctx.from.id;
  const state = getState(uid);
  if (state !== 'await_resume_file' && state !== 'collect_history')
    return ctx.reply('فایل را فقط موقع ثبت رزومه یا سوابق می‌پذیرم. برای آگهی شغلی، لینک یا متن بفرست.');
  try {
    await ctx.reply('⏳ در حال خواندن فایل...');
    const txt = await extractTextFromDocument(ctx, ctx.message.document);
    const name = ctx.message.document.file_name || 'file';
    if (state === 'await_resume_file') {
      const contact = await orChat(TRANSCRIBE_MODEL, CONTACT_EXTRACT_PROMPT, txt).catch(() => '');
      qSetResume.run(txt.trim(), contact || '', uid);
      await ctx.reply('✔️ رزومه ذخیره شد.');
      return await startHistoryCollection(ctx);
    }
    return await addHistory(ctx, txt, 'document', name);
  } catch (e) {
    if (e.message === 'TOO_BIG')     return ctx.reply('فایل بزرگ‌تر از ۲۰ مگابایت است. نسخه‌ی کوچک‌تر یا متن بفرست.');
    if (e.message === 'UNSUPPORTED') return ctx.reply('فرمت پشتیبانی نمی‌شود. PDF/DOCX/TXT یا متن بفرست.');
    logErr('document error:', e.message);
    return ctx.reply('❌ نتوانستم فایل را بخوانم. متنش را مستقیم بفرست یا فرمت دیگری امتحان کن.');
  }
});

/* ---- هندلر ویس ---- */
bot.on(['voice', 'audio'], async (ctx) => {
  upsertUser(ctx);
  const uid = ctx.from.id;
  const state = getState(uid);
  const media = ctx.message.voice || ctx.message.audio;
  const mime = ctx.message.voice?.mime_type || ctx.message.audio?.mime_type || 'audio/ogg';
  if (!['await_notes', 'collect_history', 'edit_company', 'await_resume_file'].includes(state))
    return ctx.reply('ویس را در این مرحله نمی‌پذیرم. (/help)');
  try {
    await ctx.reply('⏳ در حال تبدیل ویس به متن (Gemini Flash)...');
    const txt = await transcribeVoiceMessage(ctx, media, mime);
    if (!txt?.trim()) return ctx.reply('چیزی از ویس استخراج نشد. دوباره بفرست یا متن بنویس.');
    if (state === 'await_resume_file') {
      const contact = await orChat(TRANSCRIBE_MODEL, CONTACT_EXTRACT_PROMPT, txt).catch(() => '');
      qSetResume.run(txt.trim(), contact || '', uid);
      await ctx.reply('✔️ رزومه (از روی ویس) ذخیره شد.');
      return await startHistoryCollection(ctx);
    }
    if (state === 'collect_history') return await addHistory(ctx, txt, 'voice', 'ویس');
    if (state === 'edit_company')    return await applyCompanyEdit(ctx, txt);
    if (state === 'await_notes') {
      await ctx.reply(`📝 توضیحاتت:\n${txt.slice(0, 800)}`);
      return await generateResume(ctx, txt);
    }
  } catch (e) {
    logErr('voice error:', e.message);
    return ctx.reply('❌ نتوانستم ویس را تبدیل کنم. متن بفرست.');
  }
});

/* ===== 12) Launch ===== */
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => log('✅ resume-tailor bot started (long polling)'))
    .catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
launch();
registerGlobalErrorHandlers('resume-tailor');
process.once('SIGINT',  () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
