#!/usr/bin/env node
// جمع‌آوری + تحلیلِ بنچمارکِ کانال‌های یک حوزه.
//
//   node tools/benchmark/collect.mjs --domain fal --pages 6
//   node tools/benchmark/collect.mjs --channels a,b,c --pages 3 --probe
//
// خروجی: گزارشِ خوانا در stdout (لاگِ جاب) + فایل JSON کامل در benchmark/data/.
// قاعده‌ی حیاتیِ تحلیل: عددِ ممبر ملاک نیست (خریدنی است)، ویو ملاک است؛
// و ویو فقط روی پست‌های «رسیده» (سنِ ≥ ۴۸ ساعت) سنجیده می‌شود چون ویو تجمعی است.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectChannel, sleep } from './tme.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MATURE_HOURS = 48;
const TEHRAN_OFFSET_MIN = 210; // +03:30 ثابت (ایران از ۲۰۲۲ ساعت تابستانی ندارد)

function args() {
  const a = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = a.indexOf(`--${k}`);
    return i === -1 ? d : a[i + 1];
  };
  return {
    domain: get('domain', 'fal'),
    channels: get('channels', ''),
    pages: Number(get('pages', 5)),
    delayMs: Number(get('delay', 1200)),
    probe: a.includes('--probe'),
    topN: Number(get('top', 5)),
  };
}

const median = (xs) => {
  const s = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (xs, p) => {
  const s = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const fmt = (n) =>
  n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const pctStr = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '٪');

function tehranHour(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + TEHRAN_OFFSET_MIN * 60000).getUTCHours();
}

function analyze(ch) {
  const now = Date.now();
  const posts = ch.posts.filter((p) => !p.isService && p.date);
  const mature = posts.filter((p) => now - new Date(p.date).getTime() >= MATURE_HOURS * 3600e3);
  const withViews = mature.filter((p) => Number.isFinite(p.views));
  const views = withViews.map((p) => p.views);

  const med = median(views);
  const subs = ch.header?.subscribers ?? null;
  const viewRate = med != null && subs ? med / subs : null; // شاخصِ اصلیِ سلامتِ فالوور

  const withReactions = withViews.filter((p) => p.reactionTotal > 0);
  const erList = withReactions.filter((p) => p.views > 0).map((p) => p.reactionTotal / p.views);
  const er = erList.length ? erList.sort((a, b) => a - b)[erList.length >> 1] : null;

  // تواتر انتشار
  const dates = posts.map((p) => new Date(p.date).getTime()).filter((t) => !isNaN(t));
  const spanDays = dates.length > 1 ? (Math.max(...dates) - Math.min(...dates)) / 86400e3 : null;
  const perDay = spanDays && spanDays > 0 ? posts.length / spanDays : null;
  const lastPostAgeH = dates.length ? (now - Math.max(...dates)) / 3600e3 : null;

  // بخش‌بندی: چه چیزی بیشتر ویو می‌گیرد؟
  const segMed = (filterFn) => median(withViews.filter(filterFn).map((p) => p.views));
  const segments = {
    withPhoto: { n: withViews.filter((p) => p.media.includes('photo')).length, med: segMed((p) => p.media.includes('photo')) },
    textOnly: { n: withViews.filter((p) => p.media.length === 0).length, med: segMed((p) => p.media.length === 0) },
    withVideo: { n: withViews.filter((p) => p.media.includes('video')).length, med: segMed((p) => p.media.includes('video')) },
    withLink: { n: withViews.filter((p) => p.hasLink).length, med: segMed((p) => p.hasLink) },
    short: { n: withViews.filter((p) => p.textLen < 200).length, med: segMed((p) => p.textLen < 200) },
    medium: { n: withViews.filter((p) => p.textLen >= 200 && p.textLen < 700).length, med: segMed((p) => p.textLen >= 200 && p.textLen < 700) },
    long: { n: withViews.filter((p) => p.textLen >= 700).length, med: segMed((p) => p.textLen >= 700) },
    forwarded: { n: withViews.filter((p) => p.forwarded).length, med: segMed((p) => p.forwarded) },
  };

  // ساعتِ انتشار (تهران) → میانه‌ی ویو
  const byHour = {};
  for (const p of withViews) {
    const h = tehranHour(p.date);
    if (h == null) continue;
    (byHour[h] ||= []).push(p.views);
  }
  const hourStats = Object.entries(byHour)
    .map(([h, vs]) => ({ hour: Number(h), n: vs.length, med: median(vs) }))
    .filter((x) => x.n >= 3)
    .sort((a, b) => b.med - a.med);

  // امتیازِ کیفیت (شفاف و قابل‌بحث، نه جعبه‌سیاه)
  const reachScore = med != null ? clamp01(Math.log10(Math.max(med, 1) / 100) / Math.log10(500)) : 0;
  const authScore = viewRate != null ? clamp01(viewRate / 0.35) : null;
  const erScore = er != null ? clamp01(er / 0.02) : null;
  const cadenceScore = perDay == null ? 0 : clamp01(perDay / 3) * (lastPostAgeH != null && lastPostAgeH < 72 ? 1 : 0.4);

  const parts = [
    { w: 0.4, s: reachScore },
    { w: 0.25, s: authScore },
    { w: 0.2, s: erScore },
    { w: 0.15, s: cadenceScore },
  ].filter((p) => p.s != null);
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  const quality = wSum ? Math.round((parts.reduce((a, p) => a + p.w * p.s, 0) / wSum) * 100) : 0;

  const sortedByViews = [...withViews].sort((a, b) => b.views - a.views);

  return {
    username: ch.username,
    title: ch.header?.title || null,
    subscribers: subs,
    postsCollected: posts.length,
    maturePosts: mature.length,
    medianViews: med,
    p90Views: pct(views, 90),
    p10Views: pct(views, 10),
    viralRatio: med && pct(views, 90) ? +(pct(views, 90) / med).toFixed(2) : null,
    viewRate,
    er,
    reactionsSeen: withReactions.length,
    perDay: perDay ? +perDay.toFixed(2) : null,
    lastPostAgeH: lastPostAgeH != null ? +lastPostAgeH.toFixed(1) : null,
    spanDays: spanDays != null ? +spanDays.toFixed(1) : null,
    medianTextLen: median(posts.map((p) => p.textLen)),
    segments,
    bestHours: hourStats.slice(0, 3),
    worstHours: hourStats.slice(-2).reverse(),
    quality,
    scoreParts: { reachScore, authScore, erScore, cadenceScore },
    top: sortedByViews.slice(0, 8),
    bottom: sortedByViews.slice(-3).reverse(),
  };
}

function printChannel(a, topN) {
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`@${a.username}  ${a.title ? '— ' + a.title : ''}`);
  console.log(
    `  ممبر: ${fmt(a.subscribers)} | میانه‌ی ویو: ${fmt(a.medianViews)} | ویو/ممبر: ${pctStr(a.viewRate)} | ER: ${pctStr(a.er)} (${a.reactionsSeen} پست با ری‌اکشن)`
  );
  console.log(
    `  پست‌ها: ${a.postsCollected} (رسیده: ${a.maturePosts}) در ${a.spanDays} روز | ${a.perDay}/روز | آخرین پست: ${a.lastPostAgeH}h پیش`
  );
  console.log(`  ویو p10/p50/p90: ${fmt(a.p10Views)} / ${fmt(a.medianViews)} / ${fmt(a.p90Views)} (نسبتِ وایرال: ${a.viralRatio})`);
  console.log(`  میانه‌ی طول متن: ${a.medianTextLen} کاراکتر | امتیاز کیفیت: ${a.quality}/100`);
  const segs = Object.entries(a.segments)
    .filter(([, v]) => v.n >= 3)
    .map(([k, v]) => `${k}=${fmt(v.med)}(n${v.n})`)
    .join('  ');
  if (segs) console.log(`  میانه‌ی ویو به تفکیک: ${segs}`);
  if (a.bestHours.length) {
    console.log(
      `  بهترین ساعت (تهران): ${a.bestHours.map((h) => `${h.hour}:00→${fmt(h.med)}(n${h.n})`).join('  ')}` +
        (a.worstHours.length ? ` | ضعیف‌ترین: ${a.worstHours.map((h) => `${h.hour}:00→${fmt(h.med)}`).join(' ')}` : '')
    );
  }
  console.log(`  ── پرویوترین پست‌ها ──`);
  for (const p of a.top.slice(0, topN)) {
    const ratio = a.medianViews ? (p.views / a.medianViews).toFixed(1) + '×' : '';
    console.log(
      `  [${fmt(p.views)} ${ratio}] ${p.date?.slice(0, 16)} media=${p.media.join('+') || 'none'} len=${p.textLen} react=${p.reactionTotal}${p.forwarded ? ' FWD' : ''}`
    );
    console.log(`      ${p.text.replace(/\n/g, ' ⏎ ').slice(0, 320)}`);
  }
  console.log(`  ── کم‌ویوترین ──`);
  for (const p of a.bottom.slice(0, 2)) {
    console.log(`  [${fmt(p.views)}] ${p.date?.slice(0, 16)} media=${p.media.join('+') || 'none'} len=${p.textLen}`);
    console.log(`      ${p.text.replace(/\n/g, ' ⏎ ').slice(0, 200)}`);
  }
}

async function main() {
  const opt = args();
  let list = [];
  if (opt.channels) {
    list = opt.channels.split(',').map((s) => s.trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '')).filter(Boolean);
  } else {
    const reg = JSON.parse(readFileSync(join(ROOT, 'benchmark', 'registry.json'), 'utf8'));
    const dom = reg.domains.find((d) => d.key === opt.domain);
    if (!dom) throw new Error(`حوزه‌ی «${opt.domain}» در benchmark/registry.json نیست`);
    list = dom.channels.filter((c) => c.status !== 'disabled').map((c) => c.username);
  }

  console.log(`🔍 حوزه: ${opt.domain} | ${list.length} کانال | ${opt.pages} صفحه هر کدام\n`);
  const raw = [];
  const failed = [];
  for (const u of list) {
    try {
      const r = await collectChannel(u, { pages: opt.pages, delayMs: opt.delayMs, log: (m) => console.log(m) });
      if (!r.ok) {
        failed.push({ username: u, error: r.error, hints: r.sampleHints });
        console.log(`  ⚠️ ${u}: ${r.error}`);
      } else {
        raw.push(r);
        if (opt.probe && r.reactionHints?.length) console.log(`  🔬 ${u}: کلاس‌های شبیه ری‌اکشن: ${r.reactionHints.join(' | ')}`);
      }
    } catch (e) {
      failed.push({ username: u, error: String(e?.message || e) });
      console.log(`  ⚠️ ${u}: ${e?.message || e}`);
    }
    await sleep(opt.delayMs);
  }

  const analyses = raw.map(analyze).sort((a, b) => b.quality - a.quality);

  console.log(`\n\n${'═'.repeat(72)}\n📊 رتبه‌بندی کیفیت (ملاک: ویو، نه ممبر)\n${'═'.repeat(72)}`);
  console.log('رتبه  کانال                  ممبر    میانه‌ویو  ویو/ممبر   ER      پست/روز  امتیاز');
  analyses.forEach((a, i) => {
    console.log(
      `${String(i + 1).padStart(2)}.  @${a.username.padEnd(20)} ${fmt(a.subscribers).padStart(7)} ${fmt(a.medianViews).padStart(9)} ${pctStr(a.viewRate).padStart(9)} ${pctStr(a.er).padStart(7)} ${String(a.perDay ?? '—').padStart(8)} ${String(a.quality).padStart(6)}`
    );
  });
  if (failed.length) {
    console.log(`\n❌ ناموفق: ${failed.map((f) => `@${f.username} (${f.error})`).join(', ')}`);
    for (const f of failed) if (f.hints?.length) console.log(`   🔬 ${f.username} hints: ${f.hints.join(' | ')}`);
  }

  for (const a of analyses) printChannel(a, opt.topN);

  const outDir = join(ROOT, 'benchmark', 'data');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = join(outDir, `${opt.domain}-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      { domain: opt.domain, collectedAt: new Date().toISOString(), pages: opt.pages, failed, channels: raw, analyses },
      null,
      2
    )
  );
  console.log(`\n💾 دیتای کامل: ${outFile.replace(ROOT + '/', '')} (${raw.reduce((a, c) => a + c.posts.length, 0)} پست)`);

  console.log(`\n<<<BENCHMARK_JSON>>>`);
  console.log(
    JSON.stringify(
      analyses.map((a) => ({
        u: a.username, subs: a.subscribers, med: a.medianViews, p90: a.p90Views, vr: a.viewRate,
        er: a.er, perDay: a.perDay, q: a.quality, n: a.maturePosts, seg: a.segments, hours: a.bestHours,
      }))
    )
  );
  console.log(`<<<END_BENCHMARK_JSON>>>`);
}

main().catch((e) => {
  console.error('❌ خطا:', e?.stack || e);
  process.exit(1);
});
