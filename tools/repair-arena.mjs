#!/usr/bin/env node
/* 🛠 آرِنای تعمیر — «اگر خودِ مسیرِ تعمیر را هم به مدلِ بهتر بدهیم چه می‌شود؟»
 *
 * ایده‌ی مالک (۱۴۰۵/۰۶/۱۰) و قیدِ صریحش: **فال از اول گرفته نشود.** پس این ابزار
 * عمداً هیچ خوانشی تولید نمی‌کند. خروجیِ خامِ دورهای قبل را می‌خواند، فال‌هایی را که
 * ایرادشان از تعمیر **جان سالم به در برده** جدا می‌کند، و فقط و فقط همان یک
 * فراخوانیِ تعمیر را روی چند مدل تکرار می‌کند.
 *
 * چرا این آزمایش ارزان است و آزمایشگاهِ کامل نیست: تولیدِ یک فال ~۳۰۰۰ توکنِ ورودی و
 * ~۱۵۰۰ خروجی دارد؛ یک تعمیر ~۴۰۰ ورودی و ~۱۵۰ خروجی. یعنی حدودِ **یک‌دهم**. و چون
 * ورودیِ هر دو بازو **عیناً یک متن** است، مقایسه جفت‌شده و بدونِ اثرِ سناریوست.
 *
 * ⚠️ محدودیتِ صادقانه‌ی جمعیتِ نمونه: فقط فال‌هایی وارد می‌شوند که `findDefects` روی
 * متنِ **نهایی**شان چیزی پیدا کند. فالی که تعمیرش موفق بوده متنِ تمیز دارد و اصلاً
 * ورودیِ معتبری نیست. پس این آزمایش دقیقاً همان جمعیتی را می‌سنجد که مالک پرسید:
 * «آن‌هایی که به کاربر رسیدند».
 *
 * ⚠️ و یک چیزی که این آزمایش **نمی‌تواند** جواب بدهد: «نشتِ برچسب» اصلاً یک ضعفِ
 * تعمیرشدنی نیست (در `defects[]` هیچ زبانی ردیف ندارد)، پس مسیرِ تعمیر هرگز رویش
 * شلیک نمی‌کند و عوض‌کردنِ مدلِ تعمیر کوچک‌ترین اثری روی آن ندارد. آن یکی فقط از
 * راهِ پرامپت یا افزودنِ یک ردیفِ تازه به `defects[]` درست می‌شود.
 *
 * اجرا:
 *   LOCALE=ru node tools/repair-arena.mjs --dir out/ --arms google/gemini-2.5-flash,openai/gpt-5.6-luna --reps 3
 *   node tools/repair-arena.mjs --dir t --fake        # بدونِ شبکه (چکِ CI)
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const DIR   = val('dir', '');
const FAKE  = flag('fake');
const REPS  = Math.max(1, Number(val('reps', '3')) || 3);
const ARMS  = (val('arms', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = Number(val('limit', '0')) || 0;

if (!DIR) { console.error('❌ --dir لازم است'); process.exit(1); }

const core = await import('../bots/tarot/reading-core.js');
const { repairDefects, findDefects } = await import('../bots/tarot/repair.js');
const arms = ARMS.length ? ARMS : [core.FLASH, core.LUNA];

/* ═══ خواندنِ خروجیِ خامِ دورهای قبل ═══ */
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const rows = [];
for (const f of files) {
  let a; try { a = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(a)) continue;
  for (const r of a) if (r?.llm) rows.push({ ...r, src: f });
}
console.log(`📂 ${files.length} فایل، ${rows.length} فال`);

/* فقط فال‌هایی که ایرادِ **تعمیرشدنی** دارند. `findDefects` همان چیزی است که خودِ
 * ربات اجرا می‌کند، پس جمعیتِ نمونه دقیقاً همان جمعیتِ محصول است، نه یک فیلترِ تازه. */
const cases = [];
for (const r of rows) {
  const hits = findDefects(r.llm);
  if (hits.length) cases.push({ ...r, hits });
}
const picked = LIMIT ? cases.slice(0, LIMIT) : cases;
console.log(`🎯 ${picked.length} فال ایرادِ تعمیرشدنی دارد (از ${rows.length})`);
if (!picked.length) {
  console.log('\n⚠️ هیچ ورودی‌ای نماند. یعنی یا تعمیر همه را گرفته، یا ایرادهای این دور');
  console.log('   از نوعی‌اند که مسیرِ تعمیر اصلاً نمی‌بیندشان (مثلِ نشتِ برچسب).');
  process.exit(0);
}
for (const c of picked)
  console.log(`   • ${c.arm || '?'} ${c.persona}.${(c.step ?? 0) + 1} — ${c.hits.map(h => `${h.kind}«${h.phrase}»`).join('، ')}`);

/* ═══ حسابداریِ واقعیِ هزینه ═══
 * از همان سینکِ محصول می‌آید، نه از یک جدولِ قیمتِ محلی که کهنه می‌شود. روی شکست هم
 * کار می‌کند، برخلافِ `usage` که `repairDefects` فقط در موفقیت برمی‌گرداند. */
let bill = { usd: 0, calls: 0, tokIn: 0, tokOut: 0 };
core.setUsageSink((u) => {
  bill.usd += Number(u.costUsd) || 0; bill.calls += 1;
  bill.tokIn += Number(u.promptTokens) || 0; bill.tokOut += Number(u.completionTokens) || 0;
});

// استابِ آفلاین: هر ایراد را با یک عبارتِ خنثی جایگزین می‌کند تا کلِ خطِ لوله در CI
// واقعاً اجرا شود (درسِ `--dry` که یک دورِ پولی را سوزاند).
/* ⚠️ وقتی بیش از یک تکه هست، تکه‌ی **آخر** عمداً معیوب برمی‌گردد.
 * دلیلش تستِ جهش است: با پاسخِ همیشه-سالم، «تعمیرِ جزئی» هرگز در `--fake` رخ نمی‌داد و
 * شمارنده‌ی per نوع (که باید پرچمِ **خودِ تکه** را ببیند، نه نتیجه‌ی کلِ فراخوانی)
 * بی‌آزمون می‌ماند — دقیقاً همان بیش‌شماری‌ای که با سنجشِ تکه‌به‌تکه ممکن شد. */
const fakeRepair = async (_s, user) => {
  const n = (String(user).match(/\n\s*\d+[).]/g) || ['1']).length;
  const fixes = Array.from({ length: n }, () => 'متنِ تعمیرشده‌ی خنثی');
  if (n > 1) fixes[n - 1] = 'خب بستگی داره دیگه.';   // همچنان طفره → رد می‌شود
  return { out: JSON.stringify({ fixes }), usages: [{}] };
};

/* ═══ آرِنا ═══ */
/* ⚠️ ورودی عمداً **کلون نمی‌شود**، و این یک تصمیم است نه یک جااندازی: `applyFixes`
 * تابعِ خالصی است (`{...llm}`، `[...reads]`، `{...cur}`) و ورودی‌اش را دست نمی‌زند،
 * پس هر تلاش از همان متنِ اولیه شروع می‌کند. یک کلونِ دفاعی این‌جا گذاشته شده بود و
 * تستِ جهش نشانش داد که هیچ رفتاری را عوض نمی‌کند؛ بند ۹/۰ می‌گوید چنین چیزی نماند.
 * به‌جایش خودِ **خاصیت** در `check-repair-arena.mjs` ادعا شد: اگر روزی `applyFixes`
 * ورودی را عوض کند، آن ادعا قرمز می‌شود — وگرنه آرِنا بی‌صدا شروع می‌کرد به تقلب
 * (تلاشِ دوم روی متنِ تعمیرشده‌ی تلاشِ اول). */
/* ⚠️ `clean` و `some` عمداً جدا شمرده می‌شوند. با سنجشِ تکه‌به‌تکه (v3.43.0)
 * `repaired` یعنی «دستِ‌کم یک تکه تعمیر شد»، نه «فال تمیز شد». اگر گزارش فقط
 * یکی از این دو را چاپ کند، خواننده عددی می‌بیند که معنی‌اش عوض شده و نمی‌داند. */
const tally = new Map(arms.map(a => [a, { fired: 0, clean: 0, some: 0, dead: 0, ms: [], byKind: new Map() }]));

for (const c of picked) {
  for (const arm of arms) {
    const t = tally.get(arm);
    for (let r = 0; r < REPS; r++) {
      const t0 = Date.now();
      const before = bill.calls;
      const res = await repairDefects(c.llm, FAKE ? fakeRepair : core.orChatResilient,
        { tag: `${c.persona}.${(c.step ?? 0) + 1}`, plan: [arm] });
      t.ms.push(Date.now() - t0);
      if (res.fired) t.fired += 1;
      if (res.repaired) t.some += 1;
      if (res.repaired && !res.partial) t.clean += 1;
      if (!FAKE && bill.calls === before) t.dead += 1;   // به مدل نرسید
      /* هر تکه با پرچمِ **خودش** شمرده می‌شود، نه با نتیجه‌ی کلِ فراخوانی. */
      const flags = res.appliedFlags || [];
      (res.hits || c.hits).forEach((h, i) => {
        const k = t.byKind.get(h.kind) || { n: 0, ok: 0 };
        k.n += 1; if (flags[i]) k.ok += 1;
        t.byKind.set(h.kind, k);
      });
    }
  }
}

/* ═══ گزارش ═══ */
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
console.log(`\n═══ آرِنای تعمیر (${picked.length} فال × ${REPS} تکرار per بازو) ═══`);
for (const arm of arms) {
  const t = tally.get(arm);
  const n = picked.length * REPS;
  console.log(`\n── ${arm}`);
  console.log(`   شلیک: ${t.fired}/${n} | فالِ کاملاً تمیز: ${t.clean}/${n} (${Math.round(t.clean * 100 / n)}٪)` +
    ` | دستِ‌کم یک تکه: ${t.some}/${n} | تأخیرِ میانه: ${med(t.ms)}ms`);
  if (t.dead) console.log(`   ⚠️ ${t.dead} فراخوانی اصلاً به مدل نرسید — عددِ این بازو قابلِ مقایسه نیست`);
  for (const [kind, k] of t.byKind)
    console.log(`   • ${kind}: ${k.ok}/${k.n} (${Math.round(k.ok * 100 / k.n)}٪)`);
}
if (!FAKE) {
  console.log(`\n💵 هزینه‌ی واقعیِ کلِ آرِنا: $${bill.usd.toFixed(5)} در ${bill.calls} فراخوانی` +
    ` | توکن in/out: ${bill.tokIn}/${bill.tokOut}`);
  if (!bill.usd) console.log('   (OpenRouter هزینه‌ای برنگرداند — عددِ ساختگی چاپ نمی‌شود)');
}
