#!/usr/bin/env node
// probe.mjs — سنجشِ واقعیِ منابعِ خبری از روی همان ماشینی که قرار است ربات روی آن اجرا شود.
//
// چرا وجود دارد: هیچ سرچی این دو سؤال را جواب نمی‌دهد و هر دو تعیین‌کننده‌اند:
//   ۱. آیا این فید از **آی‌پیِ ما** در دسترس است؟ سایت‌های ایرانی به‌طورِ فزاینده‌ای
//      geo-block دارند (دسترسی از خارج بسته) و بعضی سایت‌های خارجی هم برعکس.
//   ۲. آیا فید **تازه** است؟ خیلی از فیدهایی که در لیست‌های اینترنتی معرفی می‌شوند
//      سال‌هاست آپدیت نشده‌اند یا آخرین آیتمشان چند روز قبل است. فیدِ بیات برای
//      پادکستِ روزانه بی‌ارزش است، حتی اگر HTTP 200 بدهد.
//
// خروجی: یک جدولِ خوانا در لاگ + یک JSON برای ماشین. هیچ چیزی را جایی نمی‌نویسد
// (فقط می‌خواند)، پس اجرای دوباره‌اش کاملاً بی‌خطر است.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { sources } = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));

const TIMEOUT_MS = 20000;
const only = process.argv[2] || '';   // فیلترِ اختیاری روی دسته یا شناسه

// تاریخِ آخرین آیتم. سه فرمتِ رایج پوشش داده می‌شود (RSS/Atom/JSON) و اگر هیچ‌کدام
// پیدا نشد null برمی‌گردد — «نمی‌دانم» صادقانه‌تر از عددِ ساختگی است.
function latestDate(body, kind) {
  if (kind === 'html') {
    // صفحه‌ی پیش‌نمایشِ تلگرام تاریخ را در datetime می‌گذارد
    const all = [...body.matchAll(/datetime="([^"]+)"/g)].map((m) => Date.parse(m[1]));
    const ok = all.filter(Number.isFinite);
    return ok.length ? new Date(Math.max(...ok)) : null;
  }
  const dates = [
    ...body.matchAll(/<pubDate>([^<]+)<\/pubDate>/gi),
    ...body.matchAll(/<updated>([^<]+)<\/updated>/gi),
    ...body.matchAll(/<published>([^<]+)<\/published>/gi),
    ...body.matchAll(/<dc:date>([^<]+)<\/dc:date>/gi),
    ...body.matchAll(/"seendate"\s*:\s*"([^"]+)"/gi),
  ].map((m) => Date.parse(m[1].trim().replace(/^(\d{8})T/, '$1T')));
  const ok = dates.filter(Number.isFinite);
  return ok.length ? new Date(Math.max(...ok)) : null;
}

function itemCount(body, kind) {
  if (kind === 'html') return (body.match(/tgme_widget_message\b/g) || []).length;
  if (kind === 'json') {
    const arr = body.trim().startsWith('[') ? body.match(/,/g)?.length + 1 : null;
    return arr || (body.match(/"url"\s*:/g) || []).length;
  }
  return (body.match(/<item[\s>]/gi) || []).length || (body.match(/<entry[\s>]/gi) || []).length;
}

const hours = (d) => (d ? Math.round((Date.now() - d.getTime()) / 36e5) : null);

async function probe(src) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      signal: ctrl.signal,
      redirect: 'follow',
      // بعضی سایت‌ها به user-agent خالی ۴۰۳ می‌دهند. هویتِ خودمان را صادقانه اعلام
      // می‌کنیم (نه جعلِ مرورگر) تا اگر صاحبِ سایت نخواست، بتواند ما را ببندد.
      headers: { 'User-Agent': 'daily-brief-newsbot/0.1 (+personal daily digest; contact via telegram)' },
    });
    const body = await res.text();
    const d = latestDate(body, src.kind);
    return {
      id: src.id, cat: src.cat, ok: res.ok, status: res.status,
      ms: Date.now() - t0, bytes: body.length,
      items: itemCount(body, src.kind),
      ageH: hours(d),
      note: res.ok ? '' : body.slice(0, 80).replace(/\s+/g, ' '),
    };
  } catch (e) {
    return {
      id: src.id, cat: src.cat, ok: false, status: 0, ms: Date.now() - t0,
      bytes: 0, items: 0, ageH: null,
      note: e.name === 'AbortError' ? 'timeout' : String(e.cause?.code || e.message).slice(0, 60),
    };
  }
}

const list = sources.filter((s) => !only || s.cat === only || s.id === only);
console.log(`🔎 سنجشِ ${list.length} منبع (timeout ${TIMEOUT_MS / 1000}s)\n`);

const results = [];
// ترتیبی و نه موازی: نمی‌خواهیم به هیچ سایتی رگبارِ درخواست بزنیم.
for (const s of list) {
  const r = await probe(s);
  results.push(r);
  const health = !r.ok ? '❌'
    : r.items === 0 ? '⚠️'
    : r.ageH === null ? '❓'
    : r.ageH <= 24 ? '✅'
    : r.ageH <= 72 ? '🟡' : '🥶';
  console.log(
    health,
    r.id.padEnd(20),
    String(r.status).padStart(3),
    `${String(r.items).padStart(3)} آیتم`,
    r.ageH === null ? ' سنِ نامعلوم' : `${String(r.ageH).padStart(4)} ساعت پیش`,
    `${String(r.ms).padStart(5)}ms`,
    r.note,
  );
}

const fresh = results.filter((r) => r.ok && r.items > 0 && (r.ageH === null || r.ageH <= 24));
const stale = results.filter((r) => r.ok && r.items > 0 && r.ageH !== null && r.ageH > 24);
const dead = results.filter((r) => !r.ok || r.items === 0);
console.log(`\n📊 تازه (زیرِ ۲۴ ساعت): ${fresh.length} | بیات: ${stale.length} | ناموفق: ${dead.length}`);
console.log(`\nقابلِ استفاده: ${fresh.map((r) => r.id).join(', ') || '—'}`);
if (dead.length) console.log(`ناموفق: ${dead.map((r) => `${r.id}(${r.status || r.note})`).join(', ')}`);
console.log(`\n--- JSON ---\n${JSON.stringify(results)}`);
