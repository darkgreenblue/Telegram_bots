#!/usr/bin/env node
// ناظرِ سلامتِ روی خودِ سرور — جایگزینِ پایشِ هر ۳۰ دقیقه‌ای از GitHub Actions.
//
// چرا منتقل شد (۱۴۰۵/۰۵/۲۹): جابِ Health هر ۳۰ دقیقه روی رانرِ گیت‌هاب بالا می‌آمد، یعنی
// ۴۸ اجرا در روز. گیت‌هاب هر جاب را حتی اگر ۱۷ ثانیه طول بکشد **یک دقیقه‌ی کامل** حساب
// می‌کند، پس این پایش به‌تنهایی ~۱۴۴۰ دقیقه در ماه می‌خورد: ۷۲٪ کلِ سهمیه‌ی حساب. و بدترین
// بخشش این بود که همان زمان‌بندی هم تضمینی نبود (روی همین ریپو ۱ تا ۴ ساعت تأخیر دیده شد)،
// یعنی گران‌ترین چیزِ حساب، دیرترین هشدار را می‌داد.
//
// این‌جا همان چک‌ها **روی خودِ سرور** و **هر ۵ دقیقه** اجرا می‌شوند: صفر دقیقه‌ی Actions،
// و تشخیص شش برابر سریع‌تر از قبل.
//
// ⚠️ ناظری که داخلِ همان چیزی است که می‌پاید، خودش را نمی‌پاید: اگر pm2 یا کلِ سرور بمیرد
// این پروسه هم با آن می‌میرد و هیچ‌کس خبردار نمی‌شود. برای همین جابِ Health روی گیت‌هاب
// **حذف نشد**، فقط به هر ۶ ساعت رفت و نقشش عوض شد: ناظرِ بیرونیِ «اصلاً سرور زنده است؟».
// این دو مکمل‌اند و حذفِ هرکدام یک نقطه‌ی کور می‌سازد.
//
// سه تفاوتِ رفتاری با نسخه‌ی گیت‌هابی (هر سه عمدی):
//   ۱) هشدار فقط روی **تغییرِ حالت** می‌رود، نه هر دور. مشکلِ پابرجا هر ۶ ساعت یک‌بار
//      یادآوری می‌شود. هشدارِ تکراریِ هر نیم‌ساعت مالک را به هشدارها بی‌حس می‌کند.
//   ۲) وقتی مشکل **رفع** شد هم یک پیام می‌رود. تا امروز فقط خرابی خبر داشت و مالک باید
//      خودش حدس می‌زد که درست شده یا نه.
//   ۳) موجودیِ OpenRouter هر ۶ ساعت چک می‌شود نه هر دور: هر ۵ دقیقه یعنی روزی ۵۷۶
//      درخواستِ بی‌فایده به سرویسی که عددش ساعتی تکان می‌خورد.
//
// اجرا: به‌عنوان یک اپِ pm2 (`ecosystem.config.cjs`). هیچ وابستگیِ npm ندارد.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { heartbeatAgeSec } from '../shared/heartbeat.js';
import { stuckCycle } from './stuck-detect.mjs';
import { checkDashboard } from './dashboard-health.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = join(ROOT, 'data', 'health-watch.json');

const CHECK_EVERY_MS = 5 * 60 * 1000;
const REMIND_EVERY_MS = 6 * 60 * 60 * 1000;   // یادآوریِ مشکلِ پابرجا
const CREDITS_EVERY_MS = 6 * 60 * 60 * 1000;  // چکِ موجودیِ OpenRouter
/* 🔁 تشخیصِ «چند کاربر در یک صفحه حلقه می‌زنند». هر ۳۰ دقیقه، نه هر دور: پنجره‌ی
 * رفتاری‌اش ۶ ساعت است، پس اسکنِ هر ۵ دقیقه ۸۸٪ همان ردیف‌ها را دوباره می‌خواند و
 * هیچ یافته‌ای را زودتر پیدا نمی‌کند. */
const STUCK_EVERY_MS = 30 * 60 * 1000;
const CREDITS_MIN_USD = 5;
const DISK_FULL_PCT = 92;
const CRASHLOOP_WINDOW_MS = 10 * 60 * 1000;
const CRASHLOOP_RESTARTS = 5;

/* آستانه‌ی کهنگیِ ضربان. ربات هر ۲۰ ثانیه می‌نویسد، پس ۵ دقیقه یعنی ۱۵ ضربانِ پشتِ‌سرهم
 * از دست رفته — به‌قدرِ کافی بزرگ که کندیِ لحظه‌ای یا دیسکِ شلوغ هشدارِ کاذب نسازد، و
 * به‌قدرِ کافی کوچک که خرابی قبل از رسیدنِ تیکتِ کاربر دیده شود. همین عدد برای «چقدر
 * بعد از بوت شروع به سنجیدن کنیم» هم استفاده می‌شود تا اپِ تازه‌reload شده مهلت داشته باشد. */
const HEARTBEAT_STALE_SEC = 5 * 60;
/* نگاشتِ نامِ اپِ pm2 ⟵ locale. چهار اپِ تاروت `cwd` مشترک دارند و فقط LOCALE فرقشان
 * است، پس هرکدام فایلِ ضربانِ خودش را دارد؛ یک فایلِ مشترک باعث می‌شد یک اپِ سالم مرگِ
 * سه‌تای دیگر را بپوشاند. */
const HEARTBEAT_APPS = [['tarot', 'fa'], ['tarot-ru', 'ru'], ['tarot-pt', 'pt'], ['tarot-es', 'es']];
// ربات‌هایی که کلیدِ OpenRouterشان تمام‌شدنش یعنی قطعیِ کاملِ محصول.
const CREDIT_BOTS = ['voice2text', 'tarot'];
// سرویس‌های systemd که خارج از pm2 اند (استثناهای مستندِ مونوریپو).
const UNITS = [
  { name: 'tabir-khab', fa: 'تعبیر خواب' },
  { name: 'dash-tunnel', fa: 'تونل داشبورد', extra: 'داشبورد از بیرون در دسترس نیست' },
];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const logErr = (...a) => console.error(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** خواندنِ یک کلید از `.env` یک ربات. برمی‌گرداند '' اگر نبود (هیچ‌وقت throw نمی‌کند). */
function envOf(bot, key) {
  try {
    const f = join(ROOT, 'bots', bot, '.env');
    if (!existsSync(f)) return '';
    const m = readFileSync(f, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch { return ''; }
}

// توکنِ فرستنده: همان ترتیبِ اولویتِ جابِ گیت‌هابی، تا پیام از همان رباتی برسد که مالک
// عادت دارد. اگر هیچ‌کدام نبود، هشدار بی‌صدا رد می‌شود (هرگز کرش).
const senderToken = () => CREDIT_BOTS.concat('daily-brief').map((b) => envOf(b, 'BOT_TOKEN')).find(Boolean) || '';
const adminIds = () => (['tarot', 'voice2text', 'daily-brief'].map((b) => envOf(b, 'ADMIN_IDS')).find(Boolean) || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function tg(text) {
  const token = senderToken();
  const ids = adminIds();
  if (!token || !ids.length) { logErr('❌ HEALTH_WATCH توکن یا ADMIN_IDS پیدا نشد، هشدار ارسال نشد'); return; }
  for (const id of ids) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text, disable_web_page_preview: true }),
      });
    } catch (e) { logErr('❌ HEALTH_WATCH ارسال تلگرام:', e.message); }
  }
}

/* ═══════════════ چک‌ها ═══════════════ */
// هر چک آرایه‌ای از «مشکل» برمی‌گرداند: { key, text }.
// `key` شناسه‌ی پایدارِ همان مشکل است تا بشود فهمید مشکلِ تازه است یا همان قبلی.

async function checkPm2() {
  const out = [];
  let list;
  try {
    const { stdout } = await run('pm2', ['jlist'], { maxBuffer: 8 * 1024 * 1024 });
    list = JSON.parse(stdout);
  } catch (e) {
    // خودِ pm2 جواب نداد: یا نصب نیست یا داغان است. هر دو خرابیِ واقعی‌اند.
    return [{ key: 'pm2:down', text: `🔴 pm2 جواب نمی‌دهد (${String(e.message).slice(0, 120)})` }];
  }
  const now = Date.now();
  for (const p of list) {
    const env = p.pm2_env || {};
    // کرش‌لوپ با unstable_restarts سنجیده می‌شود نه restart_time: دومی تجمعی است و هر
    // reloadِ دیپلوی بالایش می‌برد، یعنی بعد از چند دیپلوی هشدارِ کاذب می‌داد.
    const unstable = env.unstable_restarts || 0;
    if (env.status !== 'online') {
      out.push({ key: `pm2:offline:${p.name}`, text: `🔴 ربات «${p.name}» آفلاین است (وضعیت=${env.status})` });
    } else if (now - env.pm_uptime < CRASHLOOP_WINDOW_MS && unstable > CRASHLOOP_RESTARTS) {
      out.push({ key: `pm2:loop:${p.name}`, text: `🔴 ربات «${p.name}» در کرش‌لوپ است (کرشِ ناپایدار=${unstable})` });
    }
  }
  // اپِ گم‌شده: لیستِ خالیِ pm2 بعد از ریبوت یعنی همه‌چیز داون است ولی حلقه‌ی بالا ساکت می‌ماند.
  try {
    // pathToFileURL لازم است: import پویا با مسیرِ خام روی بعضی پلتفرم‌ها رد می‌شود.
    const eco = (await import(pathToFileURL(join(ROOT, 'ecosystem.config.cjs')).href)).default;
    const up = new Set(list.map((p) => p.name));
    for (const app of eco.apps || []) {
      /* اپی که هنوز فایلِ envش ساخته نشده یعنی سکرتش ست نشده و انتظارِ اجرا نداریم.
       *
       * ⚠️ نامِ فایل از خودِ `ENV_FILE` می‌آید، نه `.env` ثابت.
       * 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۱۱: سه اپِ زبانیِ تاروت `cwd` مشترکِ `bots/tarot` دارند و
       * فقط `ENV_FILE` فرقشان است. گارد `.env` **فارسی** را می‌دید که همیشه وجود دارد،
       * پس هر سه «ست‌شده» حساب می‌شدند و چون سکرت نداشتند و دیپلوی ردشان می‌کرد، هر
       * ۵ دقیقه سه هشدارِ کاذب می‌رفت. ضررش خودِ پیام نیست، بی‌معنا شدنِ هشدار است:
       * خرابیِ واقعی لای این نویز گم می‌شود (همان درسِ پینگ‌پنگِ chmod). */
      const needsEnv = String(app.cwd || '').startsWith('bots/');
      const envName = app.env?.ENV_FILE || '.env';
      if (needsEnv && !existsSync(join(ROOT, app.cwd, envName))) continue;
      if (!up.has(app.name)) {
        out.push({ key: `pm2:missing:${app.name}`, text: `🔴 «${app.name}» اصلاً در pm2 نیست (ریبوتِ سرور بدونِ resurrect؟ با Ops restart یا دیپلوی برگردان)` });
      }
    }
  } catch (e) { logErr('❌ HEALTH_WATCH خواندنِ ecosystem:', e.message); }

  /* 💓 ضربان: «online» و «ری‌استارت نشده» هیچ‌کدام ثابت نمی‌کنند ربات کار می‌کند.
   * هر اپِ تاروت هر ۲۰ ثانیه فایلِ ضربانش را می‌نویسد؛ ضربانِ کهنه یعنی حلقه‌ی
   * رویداد نمی‌چرخد، فارغ از این‌که pm2 چه می‌گوید.
   *
   * ⚠️ فقط برای اپی که **در pm2 آنلاین است** سنجیده می‌شود. اپِ آفلاین/گم‌شده از
   * قبل هشدارِ خودش را دارد و دو هشدار برای یک خرابی یعنی نویز — و نویز همان چیزی
   * است که هشدارِ واقعی را بی‌معنا می‌کند (درسِ پینگ‌پنگِ chmod و گاردِ ENV_FILE).
   * ضربانِ **نبود** هم برای اپی که تازه بالا آمده طبیعی است، پس مثل کهنه‌بودن با
   * همان آستانه سنجیده می‌شود نه فوری. */
  try {
    const online = new Map(list.filter((p) => (p.pm2_env || {}).status === 'online').map((p) => [p.name, p]));
    for (const [name, loc] of HEARTBEAT_APPS) {
      const p = online.get(name);
      if (!p) continue;                                   // آفلاین/نبود ⇒ هشدارش بالا آمده
      const upSec = (Date.now() - (p.pm2_env.pm_uptime || 0)) / 1000;
      if (upSec < HEARTBEAT_STALE_SEC) continue;          // تازه بوت شده، هنوز فرصت دارد
      const age = heartbeatAgeSec(join(ROOT, 'bots/tarot/data', `heartbeat-${loc}.txt`));
      if (age === null) {
        out.push({ key: `hb:none:${name}`, text: `🔴 «${name}» در pm2 online است ولی هیچ ضربانی ندارد (بوت نشده؟)` });
      } else if (age > HEARTBEAT_STALE_SEC) {
        out.push({ key: `hb:stale:${name}`, text: `🔴 «${name}» online است ولی ${Math.round(age / 60)} دقیقه است ضربان نزده (حلقه‌ی رویداد نمی‌چرخد)` });
      }
    }
  } catch (e) { logErr('❌ HEALTH_WATCH ضربان:', e.message); }
  return out;
}

async function checkUnits() {
  const out = [];
  for (const u of UNITS) {
    try {
      // `is-active` و `list-unit-files` بدونِ sudo هم کار می‌کنند؛ عمداً sudo صدا زده نمی‌شود
      // تا این پروسه هیچ‌وقت به دسترسیِ ریشه نیاز نداشته باشد.
      const { stdout: files } = await run('systemctl', ['list-unit-files', `${u.name}.service`]).catch(() => ({ stdout: '' }));
      if (!files.includes(u.name)) continue; // روی این سرور نصب نیست
      const state = await run('systemctl', ['is-active', u.name])
        .then((r) => r.stdout.trim())
        .catch((e) => String(e.stdout || '').trim() || 'unknown');
      if (state !== 'active') {
        out.push({ key: `unit:${u.name}`, text: `🔴 سرویس «${u.name}» (${u.fa}) فعال نیست (وضعیت=${state})${u.extra ? ` — ${u.extra}` : ''}` });
      }
    } catch (e) { logErr('❌ HEALTH_WATCH systemd:', u.name, e.message); }
  }
  return out;
}

async function checkDisk() {
  try {
    const { stdout } = await run('df', ['--output=pcent', '/']);
    const pct = parseInt(String(stdout).split('\n')[1]?.replace(/\D/g, ''), 10);
    if (Number.isFinite(pct) && pct >= DISK_FULL_PCT) {
      return [{ key: 'disk', text: `🔴 دیسکِ سرور ${pct}٪ پر است، نوشتنِ دیتابیس‌ها (پول) ممکن است شکست بخورد. لاگ و بکاپِ قدیمی را پاک کن.` }];
    }
  } catch (e) { logErr('❌ HEALTH_WATCH df:', e.message); }
  return [];
}

async function checkCredits() {
  const out = [];
  for (const bot of CREDIT_BOTS) {
    const key = envOf(bot, 'OPENROUTER_API_KEY');
    if (!key) continue;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (!res.ok) continue;
      const j = await res.json();
      const remain = Number(j?.data?.total_credits) - Number(j?.data?.total_usage);
      if (Number.isFinite(remain) && remain < CREDITS_MIN_USD) {
        out.push({ key: `credits:${bot}`, text: `🔴 موجودیِ OpenRouterِ «${bot}» فقط $${remain.toFixed(2)} مانده، قبل از تمام‌شدن شارژ کن (وگرنه محصول کامل می‌خوابد).` });
      }
    } catch (e) { logErr('❌ HEALTH_WATCH credits:', bot, e.message); }
  }
  return out;
}

/* 🔁 «چند کاربر در یک صفحه گیر کرده‌اند» — تشخیصِ رفتاری از جدولِ journey.
 *
 * ⚠️ عمداً **جزوِ `problems` نیست** و مسیرِ باز/رفع‌شده را نمی‌رود. آن ماشین برای
 * خرابیِ پایدار است که یک روز برطرف می‌شود؛ این یک **مشاهده‌ی لحظه‌ای** است. اگر
 * داخلش می‌رفت، هر بار که حلقه‌ی کاربران تمام می‌شد یک «✅ رفع شد» می‌رفت که هیچ‌کس
 * رفعش نکرده بود، و کول‌داونِ خودش هم با یادآوریِ ۶ساعته تداخل می‌کرد.
 *
 * و طبقِ بند ۹ب-۴ ریشه، این مسیر **هیچ پیامی به کاربر نمی‌فرستد** — فقط به مالک. */
async function checkStuck(state, now = Date.now()) {
  if (now - (state.stuckAt || 0) < STUCK_EVERY_MS) return;
  state.stuckAt = now;
  let Database;
  try {
    // better-sqlite3 وابستگیِ خودِ این ناظر نیست (هیچ package.json ای ندارد)؛ از نصبِ
    // تاروت قرض گرفته می‌شود. نبودنش یعنی این قابلیت بی‌صدا خاموش است، نه کرشِ ناظر.
    Database = (await import(pathToFileURL(
      join(ROOT, 'bots/tarot/node_modules/better-sqlite3/lib/index.js')).href)).default;
  } catch (e) { logErr('❌ HEALTH_WATCH better-sqlite3 در دسترس نیست:', e.message); return; }

  for (const [name, loc] of HEARTBEAT_APPS) {
    const file = join(ROOT, 'bots/tarot/data', `bot-${loc}.db`);
    if (!existsSync(file)) continue;
    let db;
    try {
      // readonly اجباری است: این ناظر هرگز نباید روی دیتابیسِ رباتِ زنده بنویسد.
      db = new Database(file, { readonly: true, fileMustExist: true });
      const found = stuckCycle(db, name, state, { now: Math.floor(now / 1000) });
      if (found) await tg(found.text);
    } catch (e) { logErr('❌ HEALTH_WATCH تشخیصِ گیر افتادن:', name, e.message); }
    finally { try { db?.close(); } catch { /* بی‌اهمیت */ } }
  }
}

/* ═══════════════ حالت و هشدار ═══════════════ */
// حالت روی دیسک می‌ماند نه در حافظه: هر دیپلوی این پروسه را ری‌استارت می‌کند و بدونِ آن،
// هر دیپلوی یک موجِ هشدارِ تکراری برای مشکلی می‌فرستاد که مالک از قبل خبر داشت.
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { open: {}, creditsAt: 0 }; }
}
function saveState(s) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch (e) { logErr('❌ HEALTH_WATCH ذخیره‌ی حالت:', e.message); }
}

async function cycle(state) {
  const now = Date.now();
  const problems = [
    ...(await checkPm2()),
    ...(await checkUnits()),
    ...(await checkDisk()),
    ...(await checkDashboard(run)),
  ];
  if (now - (state.creditsAt || 0) >= CREDITS_EVERY_MS) {
    problems.push(...(await checkCredits()));
    state.creditsAt = now;
  } else {
    // مشکلِ اعتبارِ بازِ قبلی نباید صرفاً به‌خاطرِ اینکه این دور چک نشده «رفع‌شده» گزارش شود.
    for (const k of Object.keys(state.open)) {
      if (k.startsWith('credits:')) problems.push({ key: k, text: state.open[k].text });
    }
  }

  const seen = new Set(problems.map((p) => p.key));
  const fresh = problems.filter((p) => !state.open[p.key]);
  const stale = Object.keys(state.open).filter((k) => !seen.has(k));
  const due = problems.filter((p) => state.open[p.key] && now - state.open[p.key].notifiedAt >= REMIND_EVERY_MS);

  if (fresh.length) {
    await tg(`🚨 پایشِ سلامت، مشکلِ تازه:\n\n${fresh.map((p) => p.text).join('\n')}\n\n`
      + 'برای دیباگ به Claude Code بگو: «ربات مشکل دارد، Health قرمز شده».');
  } else if (due.length) {
    await tg(`⏰ یادآوری، این مشکل هنوز پابرجاست:\n\n${due.map((p) => p.text).join('\n')}`);
  }
  if (stale.length) {
    await tg(`✅ رفع شد:\n\n${stale.map((k) => state.open[k].text).join('\n')}`);
  }

  const next = {};
  for (const p of problems) {
    const wasNotified = state.open[p.key]?.notifiedAt || 0;
    const renotified = fresh.includes(p) || due.includes(p);
    next[p.key] = { text: p.text, notifiedAt: renotified ? now : wasNotified };
  }
  state.open = next;
  // بعد از هشدارهای خرابی: یک مشاهده‌ی محصولی است، نه یک خرابی، و هرگز نباید جلوی
  // آن‌ها را بگیرد یا کلِ دور را با خطای خودش بشکند.
  try { await checkStuck(state, now); } catch (e) { logErr('❌ HEALTH_WATCH stuck:', e.message); }
  saveState(state);
  log(problems.length ? `⚠️ ${problems.length} مشکل: ${problems.map((p) => p.key).join(', ')}` : '✅ همه‌چیز سالم');
}

// هیچ خطایی نباید این پروسه را بکشد: ناظری که می‌میرد بدتر از ناظرِ نداشته است، چون
// مالک فکر می‌کند دارد پایش می‌شود.
process.on('unhandledRejection', (e) => logErr('❌ UNHANDLED_REJECTION', e));
process.on('uncaughtException', (e) => logErr('❌ UNCAUGHT_EXCEPTION', e?.stack || e));

const state = loadState();

// `--once` یک دور اجرا می‌کند و بیرون می‌آید: هم برای تستِ دستی، هم برای اینکه CI بتواند
// ثابت کند این مسیرِ سرد اصلاً بالا می‌آید (درسِ `decideReceipt`: مسیری که CI لمسش نمی‌کند
// تا لحظه‌ی خرابیِ واقعی ساکت می‌ماند).
if (process.argv.includes('--once')) {
  await cycle(state);
  process.exit(0);
}

log('🩺 ناظرِ سلامت شروع شد (هر ۵ دقیقه)');
for (;;) {
  try { await cycle(state); } catch (e) { logErr('❌ HEALTH_WATCH دورِ چک:', e?.stack || e.message); }
  await sleep(CHECK_EVERY_MS);
}
