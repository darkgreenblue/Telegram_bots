#!/usr/bin/env node
// انتخابِ کارتِ روز برای هر دوازده ماهِ تولد، با اجرای **مکانیکیِ** قواعدِ ضدتکرار.
//
//   node tools/marketing/pick-cards.mjs --date 2026-08-02
//   node tools/marketing/pick-cards.mjs --date 2026-08-02 --log marketing/tarot/log.jsonl
//
// چرا ابزار و نه قضاوتِ ایجنت: «کارت تکراری نباشد» یک قاعده‌ی قطعی است؛ اگر به عهده‌ی
// مدل بماند دیر یا زود نقض می‌شود. اینجا قاعده کد است و نقضش ممکن نیست.
//
// قواعد (هر سه از خواسته‌ی مالک):
//   ۱) در یک روز، هیچ کارتی برای دو ماه تکرار نمی‌شود (دوازده کارتِ یکتا).
//   ۲) برای هر ماه، کارتِ امروز نباید در ۱۴ روزِ اخیرِ همان ماه آمده باشد.
//   ۳) جهتِ کارت (مستقیم/معکوس) هم متغیر است تا حتی کارتِ تکراریِ بعد از ۱۴ روز،
//      نقطه‌ی شروعِ تفسیرِ متفاوتی داشته باشد. (تفاوتِ خودِ متن با ایجنت است.)
//
// انتخاب قطعی و بازتولیدپذیر است: بذر = خودِ تاریخ. یعنی اجرای دوباره برای همان روز
// همان کارت‌ها را می‌دهد (بدون Math.random که خروجی را غیرقابل‌بازتولید می‌کند).

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import CARDS from '../../bots/tarot/cards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const LOOKBACK_DAYS = 14;

function args() {
  const a = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = a.indexOf(`--${k}`);
    return i === -1 ? d : a[i + 1];
  };
  return {
    date: get('date', new Date(Date.now() + 210 * 60000).toISOString().slice(0, 10)),
    log: get('log', 'marketing/tarot/log.jsonl'),
    json: a.includes('--json'),
  };
}

/** بذرِ عددی از یک رشته (FNV-1a) — قطعی و بدون وابستگی */
function seedFrom(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** مولدِ شبه‌تصادفیِ قطعی (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** تاریخچه‌ی کارت‌های هر ماه در N روز اخیر، از log.jsonl */
export function recentCards(logPath, today, days = LOOKBACK_DAYS) {
  const used = Object.fromEntries(MONTHS.map((m) => [m, new Set()]));
  const abs = logPath.startsWith('/') ? logPath : join(ROOT, logPath);
  if (!existsSync(abs)) return used;
  const cutoff = new Date(today).getTime() - days * 86400e3;
  for (const line of readFileSync(abs, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec?.cards || !rec?.date) continue;
    const t = new Date(rec.date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    for (const [month, val] of Object.entries(rec.cards)) {
      if (!used[month]) continue;
      // مقدار می‌تواند کلیدِ کارت باشد یا آبجکتِ {key,...} یا نامِ فارسی
      const key = typeof val === 'string' ? val : val?.key || val?.card;
      if (key) used[month].add(String(key));
    }
  }
  return used;
}

/**
 * انتخابِ دوازده کارتِ یکتا برای امروز، با احترام به تاریخچه‌ی هر ماه.
 * اگر برای ماهی همه‌ی گزینه‌ها ممنوع باشند (عملاً غیرممکن با ۷۸ کارت)، قید
 * تاریخچه برای همان ماه شل می‌شود ولی یکتاییِ همان‌روز هرگز شکسته نمی‌شود.
 */
export function pickDay(date, used) {
  const rand = rng(seedFrom(`taroot|${date}`));
  const takenToday = new Set();
  const out = [];
  for (let i = 0; i < MONTHS.length; i++) {
    const month = MONTHS[i];
    const banned = used[month] || new Set();
    let pool = CARDS.filter((c) => !takenToday.has(c.key) && !banned.has(c.key));
    let relaxed = false;
    if (!pool.length) {
      pool = CARDS.filter((c) => !takenToday.has(c.key));
      relaxed = true;
    }
    const card = pool[Math.floor(rand() * pool.length)];
    takenToday.add(card.key);
    // جهتِ کارت هم قطعی ولی متغیر: ~۳۰٪ معکوس
    const orientation = rand() < 0.3 ? 'down' : 'up';
    out.push({
      month,
      monthIndex: i + 1,
      key: card.key,
      cardFa: card.fa,
      cardEn: card.en,
      file: card.file,
      orientation,
      keywords: orientation === 'up' ? card.up : card.down,
      relaxed,
    });
  }
  return out;
}

function main() {
  const opt = args();
  const used = recentCards(opt.log, opt.date);
  const picks = pickDay(opt.date, used);

  const keys = picks.map((p) => p.key);
  if (new Set(keys).size !== 12) throw new Error('نقضِ قاعده‌ی یکتاییِ روز');

  if (opt.json) {
    console.log(JSON.stringify({ date: opt.date, picks }, null, 2));
    return;
  }
  console.log(`🃏 کارت‌های ${opt.date} (دوازده کارتِ یکتا، با احترام به ${LOOKBACK_DAYS} روز اخیر)\n`);
  for (const p of picks) {
    const dir = p.orientation === 'up' ? 'مستقیم' : 'معکوس';
    const hist = used[p.month]?.size || 0;
    console.log(
      `${String(p.monthIndex).padStart(2)}. #${p.month.padEnd(9)} ${p.cardFa.padEnd(16)} (${p.key}) ${dir.padEnd(6)}` +
        ` | ${p.file} | تاریخچه‌ی این ماه: ${hist} کارت${p.relaxed ? ' | ⚠️ قید شل شد' : ''}`
    );
    console.log(`    کلیدواژه‌ها: ${p.keywords.join('، ')}`);
  }
  console.log(`\nهیچ کارتی بین دوازده ماهِ امروز تکرار نشده ✅`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
