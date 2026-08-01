#!/usr/bin/env node
// کارنامه‌ی محتوای کانالِ خودمان: «چه چیزی بیشتر منتشر شود؟»
//
//   node tools/marketing/perf.mjs --self benchmark/data/self-2026-08-01.json
//   node tools/marketing/perf.mjs --self <json> --starts starts.json --posts marketing/tarot/posts --out marketing/tarot
//
// سه منبعِ داده را به هم می‌دوزد و برای هر پست و هر «ستونِ محتوایی» (pillar) کارنامه می‌سازد:
//   ۱) خروجیِ tools/benchmark/collect.mjs روی کانالِ خودمان (ویو، ری‌اکشن، تاریخ)  ← --self
//   ۲) فایل‌های پستِ marketing/<bot>/posts/*.json (ستون، اسلات، موضوع، دکمه‌ی CTA)   ← --posts
//   ۳) تعدادِ startِ ربات per پست (خروجیِ یک db-query از Ops)                        ← --starts
//
// دو قاعده‌ی آهنین (همان قواعدِ ابزارِ بنچمارک):
//   • ویو تجمعی است، پس فقط پست‌های «رسیده» (سنِ ≥ ۴۸ ساعت) در میانه/امتیاز می‌آیند.
//   • ویوِ مطلق ملاک نیست؛ ویو همیشه نسبت به میانه‌ی همان کانال سنجیده می‌شود.
// و یک قاعده‌ی صداقت: ستونی با کمتر از ۳ پستِ رسیده «کم‌نمونه» است و امتیازش تصمیم‌پذیر نیست.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToText } from '../benchmark/tme.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MATURE_HOURS = 48;

// اهدافِ نرمال‌سازیِ امتیاز (از marketing/tarot/strategy.md بخش ۲):
const ER_TARGET = 0.02; // ری‌اکشن/ویو هدف: ۲٪
const START_TARGET = 0.01; // استارت/ویو هدف: ۱٪
const REACH_TARGET = 1.5; // ویوِ نسبیِ سقف: ۱.۵ برابرِ میانه‌ی کانال
const MIN_SAMPLE = 3; // زیر این تعداد پستِ رسیده = کم‌نمونه

function args() {
  const a = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = a.indexOf(`--${k}`);
    return i === -1 || i === a.length - 1 ? d : a[i + 1];
  };
  return {
    self: get('self', ''),
    starts: get('starts', ''),
    postsDir: get('posts', 'marketing/tarot/posts'),
    outDir: get('out', 'marketing/tarot'),
    channel: (get('channel', '') || '').replace(/^@/, ''),
    topN: Number(get('top', 8)) || 8,
  };
}

/* ── کمکی‌های عددی و نمایشی (هم‌سبکِ tools/benchmark/collect.mjs) ─────────── */

const median = (xs) => {
  const s = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (xs) => xs.filter((n) => Number.isFinite(n)).reduce((a, n) => a + n, 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const fmt = (n) =>
  n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
const pctStr = (x) => (x == null ? '—' : (x * 100).toFixed(2) + '٪');
const ratioStr = (x) => (x == null ? '—' : x.toFixed(2) + '×');
const round3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const rel = (p) => String(p).replace(ROOT + '/', '');

/* ── نرمال‌سازیِ متن برای تطبیق ─────────────────────────────────────────────
 * پیام‌های اسکرپ‌شده هیچ postref ای ندارند، پس تنها پلِ ما «خودِ متن» است.
 * دو طرف (HTMLِ فایلِ پست و متنِ رندرشده‌ی t.me) باید به یک شکلِ کانونی برسند:
 * تگ حذف، انتیتی دیکد، ایموجی و نویسه‌های نامرئی حذف، ارقام و «ی/ک» یکسان،
 * و هر چیزی که حرف یا رقم نیست → فاصله. یعنی تفاوتِ نگارشی تطبیق را نمی‌شکند. */
function normText(raw) {
  let s = htmlToText(String(raw ?? ''));
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ''); // نامرئی‌ها و کنترل‌های جهت
  s = s.replace(/[0-9]?[\uFE0E\uFE0F]?\u20E3/gu, ''); // کی‌کپ (۱️⃣) — قبل از حذفِ ایموجی
  s = s.replace(/\p{Extended_Pictographic}[\uFE0E\uFE0F]?/gu, ''); // ایموجی
  s = s.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ''); // پرچم‌ها
  s = s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه').replace(/[أإآ]/g, 'ا');
  s = s.replace(/[\u064B-\u0652]/g, ''); // اعراب
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' '); // هر نویسه‌ی غیرِ حرف/رقم → فاصله
  return s.trim().toLowerCase();
}

/** کلیدِ پیگیریِ پست: `2026-08-01-s3.json` → `260801s3` (هم‌شکلِ کلیدهای فایلِ starts).
 *  شکلِ بلندِ تاریخ (`20260801s3` یا `2026-08-01-s3`) هم به همان کلیدِ کوتاه می‌رسد،
 *  تا نوشتارِ متفاوتِ فایلِ starts باعثِ گم‌شدنِ خاموشِ استارت‌ها نشود. */
const normRef = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^20(\d{6})/, '$1');
function refFromFile(fileName, post) {
  if (post && post.postref) return normRef(post.postref);
  const base = basename(String(fileName)).replace(/\.json$/i, '');
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})[-_]?(.*)$/);
  return m ? normRef(m[1].slice(2) + m[2] + m[3] + m[4]) : normRef(base);
}

/* ── خواندنِ ورودی‌ها (همه دفاعی: نبودن/خرابیِ فایل نباید کرش بدهد) ───────── */

function readJson(path, label) {
  try {
    return { ok: true, data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { ok: false, error: `${label}: ${e?.message || e}` };
  }
}

function loadPostFiles(dir, warn) {
  let names = [];
  try {
    names = readdirSync(dir).filter((f) => /\.json$/i.test(f)).sort();
  } catch (e) {
    warn(`پوشه‌ی پست‌ها خوانده نشد (${rel(dir)}): ${e?.message || e}`);
    return { posts: [], badFiles: [] };
  }
  const posts = [];
  const badFiles = [];
  for (const name of names) {
    const r = readJson(join(dir, name), name);
    if (!r.ok || !r.data || typeof r.data !== 'object') {
      badFiles.push({ file: name, error: r.error || 'ساختارِ نامعتبر' });
      continue;
    }
    const p = r.data;
    const norm = normText(p.text);
    posts.push({
      file: name,
      ref: refFromFile(name, p),
      chat: String(p.chat || '').replace(/^@/, ''),
      date: p.date || null,
      pillar: p.pillar || 'unknown',
      slot: p.slot ?? null,
      topic: p.topic || '',
      hasCta: Boolean(p.button_url),
      textLen: String(p.text || '').length,
      norm,
    });
    if (!norm) badFiles.push({ file: name, error: 'متنِ خالی — قابلِ تطبیق نیست' });
  }
  return { posts, badFiles };
}

function loadStarts(path, warn) {
  if (!path) return { map: null, keys: 0 };
  const r = readJson(path, rel(path));
  if (!r.ok) {
    warn(`فایلِ استارت خوانده نشد (${rel(path)}): ${r.error}`);
    return { map: null, keys: 0 };
  }
  const src = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
  const map = new Map();
  for (const [k, v] of Object.entries(src)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    map.set(normRef(k), (map.get(normRef(k)) || 0) + n);
  }
  if (!map.size) warn(`فایلِ استارت (${rel(path)}) هیچ کلیدِ عددیِ معتبری نداشت؛ کانورژن عملاً سنجیده نمی‌شود.`);
  return { map, keys: map.size };
}

/** کانالِ هدف را از خروجیِ collect.mjs انتخاب می‌کند (فلگ → تک‌کانال → chatِ پست‌ها → اولی) */
function pickChannel(selfData, wanted, postFiles) {
  const list = Array.isArray(selfData?.channels) ? selfData.channels.filter((c) => c && c.username) : [];
  if (!list.length) return null;
  if (wanted) return list.find((c) => c.username.toLowerCase() === wanted.toLowerCase()) || null;
  if (list.length === 1) return list[0];
  const chats = new Set(postFiles.map((p) => p.chat.toLowerCase()).filter(Boolean));
  return list.find((c) => chats.has(c.username.toLowerCase())) || list[0];
}

/* ── تطبیقِ پیامِ اسکرپ‌شده با فایلِ پست ────────────────────────────────────
 * چند پست می‌توانند شروعِ یکسان داشته باشند (مثلاً همه با «کارت امروز کانال»)،
 * پس اگر پیشوندِ ۶۰ نویسه مبهم بود پیشوندهای بلندتر امتحان می‌شوند و اگر باز هم
 * مبهم ماند **حدس نمی‌زنیم**؛ پست «مبهم» علامت می‌خورد تا در گزارش دیده شود. */
const PREFIX_LEVELS = [60, 120, 240, 400];

function matchOne(scrapedNorm, candidates) {
  if (!scrapedNorm) return { status: 'no-text' };
  let pool = candidates;
  let level = null;
  for (const n of PREFIX_LEVELS) {
    const next = pool.filter((c) => c.norm.slice(0, n) === scrapedNorm.slice(0, n));
    // هیچ کاندیدایی در این سطح نماند: یا از اول شبیهی نبود، یا کاندیداهای هم‌پیشوند
    // بعد از n نویسه واگرا شدند؛ در هر دو حالت تطبیقِ مطمئنی نداریم.
    if (next.length === 0) return { status: 'none', near: pool === candidates ? [] : pool.map((c) => c.file) };
    pool = next;
    level = n;
    if (pool.length === 1) return { status: 'ok', post: pool[0], level };
  }
  const exact = pool.filter((c) => c.norm === scrapedNorm);
  if (exact.length === 1) return { status: 'ok', post: exact[0], level: 'full' };
  return { status: 'ambiguous', candidates: pool };
}

/* ── امتیازِ ترکیبیِ شفاف (نه جعبه‌سیاه) ─────────────────────────────────────
 * سه جزء، هرکدام صفر تا یک:
 *   رسایی (reach)      ۳۵٪ — میانه‌ی ویوِ نسبی ÷ ۱.۵ (یعنی ۱.۵ برابرِ میانه‌ی کانال = سقف)
 *   درگیری (engagement) ۳۵٪ — میانه‌ی ER ÷ ۰.۰۲ (هدفِ استراتژی)
 *   کانورژن (conversion) ۳۰٪ — میانه‌ی نرخِ استارت ÷ ۰.۰۱ (هدفِ استراتژی)
 * اگر ستونی **هیچ پستِ CTA داری** ندارد (یا اصلاً دیتای استارت نداریم)، وزنِ کانورژن
 * حذف و بین دو جزءِ دیگر بازتوزیع می‌شود؛ وگرنه ستون‌های محضِ محتوایی ناعادلانه صفر
 * می‌گیرند. اگر ستون CTA دارد ولی استارت نگرفته، صفر گرفتنش دیتای واقعی است، نه جریمه. */
function composite({ reach, er, startRate, conversionApplicable }) {
  const parts = [
    { key: 'reach', w: 0.35, s: reach == null ? null : clamp01(reach / REACH_TARGET) },
    { key: 'engagement', w: 0.35, s: er == null ? null : clamp01(er / ER_TARGET) },
    {
      key: 'conversion',
      w: 0.3,
      s: !conversionApplicable ? null : clamp01((startRate || 0) / START_TARGET),
    },
  ];
  const used = parts.filter((p) => p.s != null);
  const wSum = used.reduce((a, p) => a + p.w, 0);
  const score = wSum ? Math.round((used.reduce((a, p) => a + p.w * p.s, 0) / wSum) * 100) : 0;
  const detail = {};
  for (const p of parts) detail[p.key] = p.s == null ? null : { score: round3(p.s), weight: round3(p.w / (wSum || 1)) };
  return { score, detail, weightedOver: round3(wSum) };
}

/* ── ساختِ کارنامه ─────────────────────────────────────────────────────────── */

function build(opt, warn) {
  const postsDir = resolve(ROOT, opt.postsDir);
  const { posts: postFiles, badFiles } = loadPostFiles(postsDir, warn);
  const { map: startsMap, keys: startKeys } = loadStarts(opt.starts ? resolve(ROOT, opt.starts) : '', warn);

  const selfRead = readJson(resolve(ROOT, opt.self), rel(opt.self));
  if (!selfRead.ok) warn(`فایلِ --self خوانده نشد: ${selfRead.error}`);
  const ch = selfRead.ok ? pickChannel(selfRead.data, opt.channel, postFiles) : null;
  if (selfRead.ok && !ch) warn('در فایلِ --self هیچ کانالی پیدا نشد (یا نامِ --channel اشتباه است).');

  const chatName = ch?.username || opt.channel || null;
  // اگر نامِ کانال را می‌دانیم، فقط پست‌های همان کانال کاندیدای تطبیق‌اند
  const candidates = chatName
    ? postFiles.filter((p) => !p.chat || p.chat.toLowerCase() === chatName.toLowerCase())
    : postFiles;

  const now = Date.now();
  const scraped = (ch?.posts || []).filter((p) => p && !p.isService);
  const matureAll = scraped.filter((p) => p.date && now - new Date(p.date).getTime() >= MATURE_HOURS * 3600e3);
  const medianViews = median(matureAll.map((p) => p.views).filter((v) => Number.isFinite(v) && v > 0));

  const rows = [];
  const unmatchedScraped = [];
  const ambiguous = [];
  const duplicates = [];

  // گامِ ۱: تطبیقِ همه‌ی پیام‌ها (بدون قضاوت درباره‌ی تکراری‌ها)
  const briefOf = (m) => ({
    id: m.id ?? null,
    date: m.date || null,
    views: Number.isFinite(m.views) ? m.views : null,
    preview: (m.text || '').replace(/\n/g, ' ⏎ ').slice(0, 90),
  });
  const hits = [];
  for (const m of scraped) {
    const res = matchOne(normText(m.text), candidates);
    if (res.status === 'ok') {
      hits.push({ m, post: res.post, level: res.level });
    } else if (res.status === 'ambiguous') {
      ambiguous.push({ ...briefOf(m), candidates: res.candidates.map((c) => c.file) });
    } else {
      unmatchedScraped.push({
        ...briefOf(m),
        reason: res.status === 'no-text' ? 'بدونِ متن (فقط مدیا)' : 'هیچ فایلِ پستی مشابهش نیست',
        near: res.near || [],
      });
    }
  }

  // گامِ ۲: اگر یک فایلِ پست چند بار در کانال دیده شد (بازنشر)، **انتشارِ اول** ملاک است
  // (ویو روی همان جمع شده)؛ بقیه به‌عنوان «تکراری» گزارش می‌شوند، نه دوبار شمرده.
  const byRef = new Map();
  for (const h of hits) {
    const cur = byRef.get(h.post.ref);
    const t = h.m.date ? new Date(h.m.date).getTime() : Infinity;
    if (!cur || t < cur.t) byRef.set(h.post.ref, { ...h, t });
  }
  const usedFiles = new Map(); // ref → id پیامِ برنده
  for (const [ref, w] of byRef) usedFiles.set(ref, w.m.id ?? null);
  for (const h of hits) {
    if (byRef.get(h.post.ref)?.m !== h.m) duplicates.push({ ...briefOf(h.m), file: h.post.file, counted: usedFiles.get(h.post.ref) });
  }

  for (const { m, post, level } of byRef.values()) {
    const views = Number.isFinite(m.views) ? m.views : null;
    const ageH = m.date ? (now - new Date(m.date).getTime()) / 3600e3 : null;
    const mature = ageH != null && ageH >= MATURE_HOURS;
    const reactionTotal = Number.isFinite(m.reactionTotal) ? m.reactionTotal : 0;
    const starts = startsMap ? startsMap.get(post.ref) ?? 0 : null;

    rows.push({
      ref: post.ref,
      file: post.file,
      messageId: m.id ?? null,
      date: post.date || (m.date ? m.date.slice(0, 10) : null),
      publishedAt: m.date || null,
      ageH: ageH == null ? null : +ageH.toFixed(1),
      mature,
      pillar: post.pillar,
      slot: post.slot,
      topic: post.topic,
      hasCta: post.hasCta,
      textLen: post.textLen,
      views,
      viewRatio: views && medianViews ? round3(views / medianViews) : null,
      reactionTotal,
      er: views ? round3(reactionTotal / views) : null,
      starts,
      startRate: views && starts != null ? round3(starts / views) : null,
      matchLevel: level,
    });
  }

  // امتیازِ هر پست با همان فرمولِ ستون‌ها (برای جدولِ بهترین/ضعیف‌ترین)
  const hasStartsData = Boolean(startsMap);
  for (const r of rows) {
    const c = composite({
      reach: r.viewRatio,
      er: r.er,
      startRate: r.startRate,
      conversionApplicable: hasStartsData && r.hasCta,
    });
    r.score = r.mature ? c.score : null;
    r.scoreParts = r.mature ? c.detail : null;
  }

  const matureRows = rows.filter((r) => r.mature);
  const immatureRows = rows.filter((r) => !r.mature);

  // تجمیعِ ستون‌ها
  const byPillar = new Map();
  for (const r of rows) {
    if (!byPillar.has(r.pillar)) byPillar.set(r.pillar, []);
    byPillar.get(r.pillar).push(r);
  }
  const pillars = [];
  for (const [pillar, all] of byPillar) {
    const mat = all.filter((r) => r.mature);
    const medViewRatio = median(mat.map((r) => r.viewRatio));
    const medEr = median(mat.map((r) => r.er));
    const ctaRows = mat.filter((r) => r.hasCta);
    const medStartRate = hasStartsData ? median(ctaRows.map((r) => r.startRate)) : null;
    const totalStarts = hasStartsData ? sum(mat.map((r) => r.starts)) : null;
    const conversionApplicable = hasStartsData && ctaRows.length > 0;
    const c = composite({ reach: medViewRatio, er: medEr, startRate: medStartRate, conversionApplicable });
    pillars.push({
      pillar,
      n: mat.length,
      nAll: all.length,
      immature: all.length - mat.length,
      ctaPosts: ctaRows.length,
      medianViews: median(mat.map((r) => r.views)),
      medianViewRatio: round3(medViewRatio),
      medianEr: round3(medEr),
      totalStarts,
      medianStartRate: round3(medStartRate),
      score: c.score,
      scoreParts: c.detail,
      conversionCounted: conversionApplicable,
      lowSample: mat.length < MIN_SAMPLE,
      decisionGrade: mat.length >= MIN_SAMPLE,
    });
  }
  pillars.sort((a, b) => b.score - a.score || b.n - a.n);

  const unmatchedFiles = candidates
    .filter((p) => !usedFiles.has(p.ref))
    .map((p) => ({ file: p.file, ref: p.ref, date: p.date, slot: p.slot, pillar: p.pillar, topic: p.topic }));

  // کلیدهای فایلِ starts که به هیچ پستی نچسبیدند (اشتباهِ خاموشِ رایج)
  const orphanStarts = [];
  if (startsMap) {
    const known = new Set(candidates.map((p) => p.ref));
    for (const [k, v] of startsMap) if (!known.has(k)) orphanStarts.push({ ref: k, starts: v });
  }

  return {
    generatedAt: new Date().toISOString(),
    channel: chatName,
    subscribers: ch?.header?.subscribers ?? null,
    maturityHours: MATURE_HOURS,
    medianViews,
    hasStartsData,
    startKeys,
    targets: { erTarget: ER_TARGET, startTarget: START_TARGET, reachTarget: REACH_TARGET, minSample: MIN_SAMPLE },
    counts: {
      scraped: scraped.length,
      matched: rows.length,
      mature: matureRows.length,
      immature: immatureRows.length,
      postFiles: candidates.length,
    },
    posts: rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    pillars,
    unmatched: {
      scraped: unmatchedScraped,
      ambiguous,
      duplicates,
      postFiles: unmatchedFiles,
      badFiles,
      orphanStarts,
    },
  };
}

/* ── توصیه‌ها: مستقیم از امتیازها، فقط روی ستون‌های تصمیم‌پذیر ─────────────── */
function recommend(report) {
  const grade = report.pillars.filter((p) => p.decisionGrade);
  const weak = report.pillars.filter((p) => !p.decisionGrade);
  if (grade.length < 2) {
    return { more: [], less: [], needData: weak.concat(grade), mid: null };
  }
  const mid = median(grade.map((p) => p.score));
  const more = grade.filter((p) => p.score >= mid + 5);
  const less = grade.filter((p) => p.score <= mid - 5);
  return { more, less, needData: weak, mid };
}

const midStr = (x) => (x == null ? '—' : String(Math.round(x)));

const reasonOf = (p) =>
  [
    `ویوِ نسبی ${ratioStr(p.medianViewRatio)}`,
    `ER ${pctStr(p.medianEr)}`,
    p.conversionCounted ? `نرخِ استارت ${pctStr(p.medianStartRate)}` : 'بدونِ CTA (کانورژن شمرده نشد)',
  ].join('، ');

/* ── خروجیِ Markdown ────────────────────────────────────────────────────────── */
function toMarkdown(report, rec, opt) {
  const L = [];
  const ch = report.channel ? '@' + report.channel : '(کانالِ نامشخص)';
  L.push(`# کارنامه‌ی محتوای ${ch}`);
  L.push('');
  L.push(
    `> تولید: ${report.generatedAt} | میانه‌ی ویوِ کانال: ${fmt(report.medianViews)} | ممبر: ${fmt(report.subscribers)}`
  );
  L.push(
    `> پستِ اسکرپ‌شده: ${report.counts.scraped} | تطبیق‌خورده: ${report.counts.matched} (رسیده: ${report.counts.mature}، نارس: ${report.counts.immature}) | فایلِ پست: ${report.counts.postFiles}`
  );
  L.push(
    `> دیتای استارت: ${report.hasStartsData ? `دارد (${report.startKeys} کلید)` : 'ندارد؛ وزنِ کانورژن بین رسایی و درگیری بازتوزیع شد'}`
  );
  L.push('');
  L.push(
    `**فرمولِ امتیاز (شفاف):** رسایی ۳۵٪ (میانه‌ی ویوِ نسبی ÷ ${REACH_TARGET}) + درگیری ۳۵٪ (میانه‌ی ER ÷ ${pctStr(ER_TARGET)}) + کانورژن ۳۰٪ (میانه‌ی نرخِ استارت ÷ ${pctStr(START_TARGET)}). ` +
      `ستونی که هیچ پستِ CTA داری ندارد، وزنِ کانورژنش بین دو جزءِ دیگر پخش می‌شود تا ستون‌های محضِ محتوایی ناعادلانه صفر نگیرند. فقط پست‌های با سنِ ≥ ${MATURE_HOURS} ساعت در میانه‌ها و امتیاز می‌آیند.`
  );
  L.push('');

  L.push('## ۱) رتبه‌بندی ستون‌های محتوایی');
  L.push('');
  L.push('| # | ستون | پستِ رسیده | میانه‌ی ویو | ویوِ نسبی | ER | استارت | نرخِ استارت | امتیاز | وضعیت |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  if (!report.pillars.length) L.push('| — | (هیچ پستی تطبیق نخورد) | — | — | — | — | — | — | — | — |');
  report.pillars.forEach((p, i) => {
    L.push(
      `| ${i + 1} | ${p.pillar} | ${p.n}${p.immature ? ` (+${p.immature} نارس)` : ''} | ${fmt(p.medianViews)} | ${ratioStr(
        p.medianViewRatio
      )} | ${pctStr(p.medianEr)} | ${p.totalStarts == null ? '—' : p.totalStarts} | ${pctStr(p.medianStartRate)} | **${
        p.score
      }** | ${p.lowSample ? '⚠️ کم‌نمونه' : '✅ تصمیم‌پذیر'} |`
    );
  });
  L.push('');
  if (report.pillars.some((p) => p.lowSample)) {
    L.push(
      `> ⚠️ ستون‌های «کم‌نمونه» کمتر از ${MIN_SAMPLE} پستِ رسیده دارند؛ **امتیازشان هنوز تصمیم‌پذیر نیست** و نباید مبنای تغییرِ استراتژی شود. فقط داده‌ی بیشتر لازم دارند.`
    );
    L.push('');
  }

  const mature = report.posts.filter((p) => p.mature);
  const tbl = (rowsIn) => {
    const out = ['| پست | ستون | اسلات | ویو | ویوِ نسبی | ری‌اکشن | ER | استارت | امتیاز |', '|---|---|---|---|---|---|---|---|---|'];
    if (!rowsIn.length) out.push('| (خالی) | — | — | — | — | — | — | — | — |');
    for (const r of rowsIn) {
      out.push(
        `| ${r.date || '—'} ${r.topic ? '— ' + r.topic.slice(0, 40) : r.file} | ${r.pillar} | ${r.slot ?? '—'} | ${fmt(
          r.views
        )} | ${ratioStr(r.viewRatio)} | ${r.reactionTotal} | ${pctStr(r.er)} | ${r.starts == null ? '—' : r.starts} | **${
          r.score ?? '—'
        }** |`
      );
    }
    return out;
  };

  L.push('## ۲) بهترین پست‌ها');
  L.push('');
  L.push(...tbl(mature.slice(0, opt.topN)));
  L.push('');
  L.push('## ۳) ضعیف‌ترین پست‌ها');
  L.push('');
  L.push(...tbl(mature.slice(-Math.min(opt.topN, mature.length)).reverse()));
  if (mature.length && mature.length <= opt.topN)
    L.push('', `> کلِ پست‌های رسیده ${mature.length} تاست (کمتر از سقفِ جدول)، پس دو جدولِ بالا هم‌پوشانی دارند.`);
  L.push('');

  L.push('## ۴) چه چیزی بیشتر منتشر شود / چه چیزی کمتر');
  L.push('');
  if (rec.mid == null) {
    L.push(
      '- هنوز دیتای کافی برای مقایسه‌ی ستون‌ها نیست (کمتر از دو ستونِ تصمیم‌پذیر). تا رسیدنِ حداقل ' +
        `${MIN_SAMPLE} پستِ رسیده در چند ستون، استراتژی را عوض نکن.`
    );
  } else {
    L.push(`> قاعده‌ی تصمیم: امتیازِ ستون نسبت به میانه‌ی امتیازِ ستون‌های تصمیم‌پذیر (${midStr(rec.mid)}) با حاشیه‌ی ۵ واحد.`);
    L.push('');
    L.push('**بیشتر منتشر شود:**');
    if (!rec.more.length) L.push('- هیچ ستونی به‌روشنی بالاتر از میانه نیست؛ ترکیبِ فعلی را نگه دار و داده جمع کن.');
    for (const p of rec.more) L.push(`- **${p.pillar}** (امتیاز ${p.score}، ${p.n} پستِ رسیده): ${reasonOf(p)}`);
    L.push('');
    L.push('**کمتر منتشر شود (یا بازنویسی شود):**');
    if (!rec.less.length) L.push('- هیچ ستونی به‌روشنی پایین‌تر از میانه نیست.');
    for (const p of rec.less) L.push(`- **${p.pillar}** (امتیاز ${p.score}، ${p.n} پستِ رسیده): ${reasonOf(p)}`);
  }
  if (rec.needData.length) {
    L.push('');
    L.push('**هنوز قضاوت نکن (کم‌نمونه):**');
    for (const p of rec.needData) L.push(`- ${p.pillar}: فقط ${p.n} پستِ رسیده (امتیازِ فعلی ${p.score}، غیرقابلِ استناد)`);
  }
  L.push('');

  L.push('## ۵) محدودیت‌های این تحلیل');
  L.push('');
  const lim = [];
  const low = report.pillars.filter((p) => p.lowSample);
  if (low.length) lim.push(`ستون‌های کم‌نمونه: ${low.map((p) => `${p.pillar} (n=${p.n})`).join('، ')}`);
  const imm = report.posts.filter((p) => !p.mature);
  if (imm.length)
    lim.push(
      `هنوز نارس (سن < ${MATURE_HOURS} ساعت، از امتیازدهی کنار گذاشته شد): ` +
        imm.map((p) => `${p.file} (${p.ageH}h، ویو ${fmt(p.views)})`).join('، ')
    );
  if (report.unmatched.scraped.length)
    lim.push(
      `پیامِ کانال که به هیچ فایلِ پستی نچسبید (${report.unmatched.scraped.length}): ` +
        report.unmatched.scraped
          .map((s) => `#${s.id} (${s.reason})${s.preview ? ` «${s.preview.slice(0, 40)}»` : ''}`)
          .join('؛ ')
    );
  if (report.unmatched.ambiguous.length)
    lim.push(
      `تطبیقِ مبهم (چند فایل با متنِ نزدیک؛ عمداً حدس نزدیم): ` +
        report.unmatched.ambiguous.map((s) => `#${s.id} → ${s.candidates.join(' | ')}`).join('؛ ')
    );
  if (report.unmatched.duplicates.length)
    lim.push(
      `بازنشر (یک فایلِ پست بیش از یک‌بار در کانال دیده شد؛ فقط انتشارِ اول شمرده شد): ` +
        report.unmatched.duplicates.map((s) => `#${s.id} → ${s.file}`).join('؛ ')
    );
  if (report.unmatched.postFiles.length)
    lim.push(
      `فایلِ پستی که در کانال پیدا نشد (${report.unmatched.postFiles.length}): ` +
        report.unmatched.postFiles.map((f) => f.file).join('، ')
    );
  if (report.unmatched.badFiles.length)
    lim.push(`فایلِ خراب/بی‌متن: ${report.unmatched.badFiles.map((f) => `${f.file} (${f.error})`).join('، ')}`);
  if (report.unmatched.orphanStarts.length)
    lim.push(
      `کلیدِ فایلِ starts بدونِ پستِ متناظر: ${report.unmatched.orphanStarts.map((o) => `${o.ref}=${o.starts}`).join('، ')}`
    );
  if (!report.hasStartsData) lim.push('فایلِ starts داده نشد، پس کانورژن اصلاً سنجیده نشده و امتیازها فقط رسایی و درگیری‌اند.');
  if (!report.medianViews) lim.push('میانه‌ی ویوِ کانال صفر یا نامعلوم است، پس ویوِ نسبی محاسبه نشد.');
  lim.push('ویوِ صفحه‌ی t.me خلاصه‌شده است (مثلاً «1.2K»)، پس اعداد تا سه رقمِ معنادار دقیق‌اند.');
  lim.push('تطبیقِ پست با متن انجام می‌شود؛ اگر متنِ پستی بعد از انتشار ادیت شود ممکن است نامتطبق بماند.');
  for (const x of lim) L.push(`- ${x}`);
  L.push('');
  return L.join('\n');
}

/* ── خلاصه‌ی stdout ─────────────────────────────────────────────────────────── */
function printSummary(report, rec, files, warnings) {
  const ch = report.channel ? '@' + report.channel : '(نامشخص)';
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`📊 کارنامه‌ی محتوا ${ch} | میانه‌ی ویو ${fmt(report.medianViews)} | ممبر ${fmt(report.subscribers)}`);
  console.log(
    `   تطبیق: ${report.counts.matched}/${report.counts.scraped} پیام (رسیده ${report.counts.mature}، نارس ${report.counts.immature}) از ${report.counts.postFiles} فایلِ پست`
  );
  console.log(`${'═'.repeat(72)}`);
  console.log('ستون                 n   ویوِنسبی      ER    استارت  نرخ‌استارت  امتیاز');
  for (const p of report.pillars) {
    console.log(
      `${p.pillar.padEnd(18)} ${String(p.n).padStart(3)} ${ratioStr(p.medianViewRatio).padStart(9)} ${pctStr(p.medianEr).padStart(8)} ${String(
        p.totalStarts ?? '—'
      ).padStart(8)} ${pctStr(p.medianStartRate).padStart(10)} ${String(p.score).padStart(6)}${p.lowSample ? '  ⚠️ کم‌نمونه' : ''}`
    );
  }
  if (rec.more.length) console.log(`\n⬆️  بیشتر: ${rec.more.map((p) => `${p.pillar}(${p.score})`).join('، ')}`);
  if (rec.less.length) console.log(`⬇️  کمتر: ${rec.less.map((p) => `${p.pillar}(${p.score})`).join('، ')}`);
  if (rec.needData.length) console.log(`⏳ کم‌نمونه: ${rec.needData.map((p) => p.pillar).join('، ')}`);
  const u = report.unmatched;
  if (u.scraped.length || u.postFiles.length || u.ambiguous.length || u.badFiles.length || u.orphanStarts.length) {
    console.log(
      `\n⚠️ نامتطبق: ${u.scraped.length} پیامِ کانال، ${u.postFiles.length} فایلِ پست، ${u.ambiguous.length} مبهم، ${u.badFiles.length} فایلِ خراب، ${u.orphanStarts.length} کلیدِ استارتِ یتیم`
    );
  }
  for (const w of warnings) console.log(`⚠️ ${w}`);
  console.log(`\n💾 ${files.join('\n💾 ')}`);
}

/* ── main ──────────────────────────────────────────────────────────────────── */
function main() {
  const opt = args();
  if (!opt.self) {
    console.error(
      'استفاده: node tools/marketing/perf.mjs --self <benchmark/data/self-*.json> [--starts <starts.json>] [--posts marketing/tarot/posts] [--out marketing/tarot] [--channel taroot_fa] [--top 8]'
    );
    process.exit(1);
  }
  const warnings = [];
  const warn = (m) => warnings.push(m);

  const report = build(opt, warn);
  const rec = recommend(report);

  const outDir = resolve(ROOT, opt.outDir);
  const files = [];
  try {
    mkdirSync(outDir, { recursive: true });
    const jsonPath = join(outDir, 'performance.json');
    const mdPath = join(outDir, 'performance.md');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(mdPath, toMarkdown(report, rec, opt));
    files.push(rel(jsonPath), rel(mdPath));
  } catch (e) {
    warn(`نوشتنِ خروجی ناموفق در ${rel(outDir)}: ${e?.message || e}`);
  }

  printSummary(report, rec, files, warnings);
}

main();
