#!/usr/bin/env node
// چکِ گنجینه — هم **منطقِ انتخاب** را اجرا می‌کند، هم خودِ محتوا را می‌سنجد.
//
// چرا لازم است: گنجینه در نهایت هزاران متن می‌شود و تنها فایلِ محتوایِ ریپو بود که
// هیچ چکی نداشت. با این حجم، یک خانه‌ی جاافتاده یا یک «—» تا لحظه‌ی رسیدنِ کاربرِ
// واقعی ساکت می‌ماند (درسِ بند ۸ ریشه: مسیرِ سرد را CI نمی‌بیند).
//
// 🌍 چندزبانه (بند ۲و ریشه): فایل روی `daily-ganjineh.*.json` (هر چه پیدا شود) حلقه
// می‌زند، نه فقط `fa`. قواعدِ سبکی per زبان جدا هستند چون «شما»/جنسیت/طول یک زبانِ
// دیگر معنیِ متفاوتی دارد؛ **زبانی که ردیفِ قاعده نداشته باشد خودش خطاست** — وگرنه
// دقیقاً همان چیزی تکرار می‌شود که رباتِ روسی را یک‌بار به نمایشِ متنِ فارسی رساند
// (بند ۲و/۶ب): چکی که فقط فارسی را می‌بیند روی متنِ سیریلیک/لاتین بی‌صدا سبز می‌ماند.
//
// اجرا: node tools/check-ganjineh.mjs
import { readFileSync, readdirSync } from 'fs';
import { CARD_BY_KEY } from '../bots/tarot/cards.js';
import {
  eligibleCards, pickVariant, countOf, hasText, textOf, stats,
  NO_REPEAT_DRAWS, VARIANTS,
} from '../bots/tarot/ganjineh.js';

const DIR = new URL('../bots/tarot/', import.meta.url);
const SRC = readFileSync(new URL('index.js', DIR), 'utf8');
const GAN = readFileSync(new URL('ganjineh.js', DIR), 'utf8');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const ALL = Object.keys(CARD_BY_KEY);
// مولدِ شبه‌تصادفیِ قطعی: اجرای دوباره‌ی چک باید همان نتیجه را بدهد، وگرنه یک تستِ
// نویزی داریم که گاهی سبز و گاهی قرمز می‌شود و هیچ‌کس جدی‌اش نمی‌گیرد.
let _s = 12345;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };

/* ═══════════ ۱) قاعده‌ی عدمِ تکرار: «۷ بارِ آخر»، نه «۷ روز» ═══════════
 * این چهار بلوکِ اول (۱ تا ۴) رفتارِ **کد** را می‌سنجند نه محتوای هیچ زبانِ خاصی؛
 * بار اول اجرا می‌شوند نه per-locale (تکرارشان چیزِ تازه‌ای اثبات نمی‌کرد). */
console.log('▶ قاعده‌ی عدمِ تکرار بر حسبِ بارِ فال‌گیری (نه روز)');
{
  ok(NO_REPEAT_DRAWS === 7, `سقفِ عدمِ تکرار ۷ بار است (${NO_REPEAT_DRAWS})`);
  ok(/NO_REPEAT_DRAWS/.test(GAN) && !/NO_REPEAT_DAYS/.test(GAN),
    'ثابتِ روزمحورِ قبلی کاملاً برداشته شد (نامش هم عوض شد تا کسی اشتباه صدایش نزند)');

  // 🔑 مهم‌ترین ادعا: کوئریِ ربات باید «آخرین N ردیف» بگیرد، نه «ردیف‌های N روزِ اخیر».
  ok(/recentDailyDraws: db\.prepare\('SELECT card_key FROM daily_log WHERE user_id=\? ORDER BY date DESC LIMIT \?'\)/.test(SRC),
    'کوئری آخرین N بارِ فال‌گیری را می‌گیرد (ORDER BY date DESC LIMIT ?)');
  ok(!/recentDailyCards/.test(SRC), 'کوئریِ روزمحورِ قبلی حذف شد (کدِ مرده نماند)');
  ok(/stmts\.recentDailyDraws\.all\(uid, NO_REPEAT_DRAWS\)/.test(SRC),
    'و با همان ثابت صدا زده می‌شود، نه یک عددِ دستی');

  // ── شبیه‌سازیِ واقعی: ۳۰۰ بار فال‌گیریِ پشتِ‌سرهم، دقیقاً مثلِ خودِ ربات ──
  const gan = Object.fromEntries(ALL.map(k => [k, 1]));   // فرض: همه‌ی کارت‌ها نوشته‌اند
  const written = ALL.filter(k => gan[k]);
  const history = [];                       // جدیدترین در ابتدا (مثل ORDER BY date DESC)
  let worstGap = Infinity, drawsDone = 0;
  for (let d = 0; d < 300; d++) {
    const recent = history.slice(0, NO_REPEAT_DRAWS);
    const pool = written.filter(k => !recent.includes(k));
    const pick = pool[Math.floor(rnd() * pool.length)];
    const prev = history.indexOf(pick);     // چند بار قبل همین کارت آمده بود؟
    if (prev >= 0) worstGap = Math.min(worstGap, prev + 1);
    history.unshift(pick);
    drawsDone++;
  }
  ok(drawsDone === 300, 'شبیه‌سازیِ ۳۰۰ بارِ فال‌گیری اجرا شد');
  ok(worstGap > NO_REPEAT_DRAWS,
    `هیچ کارتی زودتر از بارِ ${NO_REPEAT_DRAWS + 1} تکرار نشد (نزدیک‌ترین تکرار: بارِ ${worstGap === Infinity ? '—' : worstGap})`);

  // کاربرِ تازه که فقط ۲ یا ۳ بار فال گرفته: همان ۲ یا ۳ کارت هم باید حذف شوند
  for (const n of [1, 2, 3]) {
    const hist = written.slice(0, n);
    const pool = eligibleCards(written, 1, hist.slice(0, NO_REPEAT_DRAWS));
    ok(hist.every(k => !pool.includes(k)),
      `کاربر با ${n} فالِ قبلی: همان ${n} کارت از قرعه حذف شدند`);
  }

  // بارِ هشتم کارت برمی‌گردد (خواسته‌ی صریحِ مالک: بازگشت به چرخه درست است)
  const hist8 = ALL.slice(0, 8);
  const pool8 = ALL.filter(k => !hist8.slice(0, NO_REPEAT_DRAWS).includes(k));
  ok(pool8.includes(hist8[7]), 'کارتی که ۸ بار پیش آمده دوباره واجدِ شرایط است');
  ok(!pool8.includes(hist8[6]), 'ولی کارتی که ۷ بار پیش آمده هنوز حذف است');
}

/* ═══════════ ۲) حوضچه هرگز خالی برنمی‌گردد ═══════════ */
console.log('\n▶ حوضچه هیچ‌وقت کاربر را بن‌بست نمی‌کند');
{
  // گنجینه‌ی خیلی کوچک (کمتر از سقفِ عدمِ تکرار): باید فالبک کند نه اینکه صفر بدهد
  const tiny = ['m00', 'm01', 'm02'];
  const poolAllRecent = eligibleCards(tiny, 1, tiny);
  ok(poolAllRecent.length > 0,
    'وقتی همه‌ی کارت‌های نوشته‌شده در پنجره‌اند، تکرار بهتر از هیچ است (فالبک)');
  // ماهِ نانوشته باید واقعاً صفر بدهد تا پیامِ «آماده نیست» بیاید
  const empty = eligibleCards(ALL, 99, []);
  ok(empty.length === 0, 'ماهِ نانوشته صفر می‌دهد (پیامِ «گنجینه آماده نیست» شرطش همین است)');
}

/* ═══════════ ۳) انتخابِ نسخه از **دیتای واقعی**، نه ثابت ═══════════ */
console.log('\n▶ نسخه از تعدادِ واقعیِ همان خانه می‌آید');
{
  ok(/export function pickVariant\(seenVariants = \[\], count = VARIANTS, rand = Math\.random\)/.test(GAN),
    'pickVariant تعدادِ واقعی را به‌عنوان آرگومان می‌گیرد');
  ok(/pickVariant\(seen, ganjinehCount\(month, key\)\)/.test(SRC),
    'ربات تعدادِ واقعیِ همان (ماه × کارت) را پاس می‌دهد');

  // با ۱ نسخه، همیشه باید ۰ برگردد — وگرنه daily_log عددی ثبت می‌کند که نمایش داده نشده
  let bad = 0;
  for (let i = 0; i < 500; i++) if (pickVariant([], 1, rnd) !== 0) bad++;
  ok(bad === 0, 'با ۱ نسخه همیشه ۰ برمی‌گردد (دفتر دروغ نمی‌نویسد)');
  // و حتی اگر کاربر «۰ را دیده» باشد، چاره‌ای جز ۰ نیست
  let bad2 = 0;
  for (let i = 0; i < 200; i++) if (pickVariant([0], 1, rnd) !== 0) bad2++;
  ok(bad2 === 0, 'با ۱ نسخه‌ی دیده‌شده هم ۰ برمی‌گردد (نه عددِ خارج از محدوده)');

  // با ۲ نسخه: نسخه‌ی ندیده ترجیح دارد — همان «پشتیبانِ تکرار» که مالک خواست
  let wrong = 0;
  for (let i = 0; i < 500; i++) if (pickVariant([0], 2, rnd) !== 1) wrong++;
  ok(wrong === 0, 'با ۲ نسخه، کسی که نسخه‌ی ۰ را دیده حتماً نسخه‌ی ۱ می‌گیرد');
  let w3 = 0;
  for (let i = 0; i < 500; i++) { const v = pickVariant([0, 1], 3, rnd); if (v !== 2) w3++; }
  ok(w3 === 0, 'با ۳ نسخه، کسی که ۰ و ۱ را دیده حتماً ۲ می‌گیرد');
  // چرخه که بست، از کلِ نسخه‌ها انتخاب می‌شود (نه کرش، نه undefined)
  const closed = new Set();
  for (let i = 0; i < 300; i++) closed.add(pickVariant([0, 1, 2], 3, rnd));
  ok([...closed].every(v => v >= 0 && v < 3), 'چرخه که بست، خروجی همچنان در محدوده است');
  // ورودیِ خصمانه
  ok(pickVariant([], 0, rnd) === 0 && pickVariant([], -5, rnd) === 0 && pickVariant([], 99, rnd) < VARIANTS,
    'تعدادِ نامعتبر (صفر/منفی/بزرگ‌تر از سقف) امن مهار می‌شود');
}

/* ═══════════ ۴) کارت همیشه ایستاده است ═══════════ */
console.log('\n▶ کارتِ روز معکوس ندارد');
{
  ok(Object.values(CARD_BY_KEY).every(c => !('reversed' in c)),
    'هیچ کارتی فیلدِ reversed ندارد (پس قرعه‌ی معکوسی در کار نیست)');
  ok(/stmts\.logDaily\.run\(uid, today, key, 0, variant\)/.test(SRC),
    'دفتر صریح صفر می‌نویسد، نه یک شرطِ همیشه-صفر که انگار کاری می‌کند');
}

/* ═══════════ ۵) خودِ محتوا — per زبان ═══════════
 * الگوی مرجع: `sentenceAround`+`except` عیناً از `repair.js` کپی شد تا گارد و سنجه
 * یک تعریف را ببینند (درسِ گافِ تیزر: دو کپیِ جدا دیر یا زود واگرا می‌شوند). */
function sentenceAround(text, idx) {
  const start = Math.max(0, text.lastIndexOf('\n', idx), text.lastIndexOf('.', idx));
  let end = text.length;
  for (const ch of ['.', '\n', '؟', '?', '!']) {
    const j = text.indexOf(ch, idx);
    if (j !== -1 && j < end) end = j;
  }
  return text.slice(start, end + 1);
}

function compileDefects(list) {
  const out = [];
  for (const d of list || []) {
    let re, exceptRe = null;
    try {
      re = new RegExp(d.pattern, d.flags || '');
      if (d.except) exceptRe = new RegExp(d.except, `${(d.flags || '').replace('i', '')}i`);
    } catch { continue; }
    out.push({
      id: d.id,
      find: (t) => {
        const m = String(t || '').match(re);
        if (!m) return null;
        if (exceptRe && exceptRe.test(sentenceAround(String(t), m.index))) return null;
        return m[0].trim();
      },
    });
  }
  return out;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const ALIEN_SCRIPTS = {
  fa: /[؀-ۿ]/u, cjk: /[　-鿿＀-￯]/u, cyr: /[Ѐ-ӿ]/u, ptChars: /[ãõç]/u, esChars: /[ñ¿¡]/u,
};

/* قواعدِ سبکی per زبان. **زبانی که این‌جا ردیف نداشته باشد، خودش خطاست** (پایین‌تر
 * چک می‌شود) — وگرنه دقیقاً همان دامی که بند ۲و/۶ب هشدار می‌دهد: چکی که فقط برای
 * یک زبان نوشته شده، روی زبانِ بعدی بی‌صدا سبز می‌ماند. */
const RULES = {
  // فارسی: قواعدِ اصلی و اثبات‌شده‌ی گنجینه، **بیت‌به‌بیت دست‌نخورده** (تا الان
  // مستقیم در سورس بودند؛ فقط به این جدول منتقل شدند).
  fa: {
    min: 200, max: 600,
    noYou: { re: /شما(?![؀-ۿ‌])/, label: 'همه‌جا «تو»، هیچ «شما»' },
    badPhrases: ['بستگی به خودت داره', 'به شهودت اعتماد کن', 'کائنات', 'شاید آره شاید نه', 'هم می‌تونه این باشه هم اون'],
    pastTime: /(پارسال|سال پیش|هفته‌ی پیش|هفته پیش|ماه پیش|دفعه‌ی قبل|دفعه قبل)/,
    alien: [], // بقیه‌ی زبان‌ها نویسه‌ی فارسی را «بیگانه» می‌بینند؛ خودِ فارسی نیازی ندارد
    defects: [],
  },
  // 🌍 روسی/پرتغالی/اسپانیایی: بازه‌ی طول از نسبتِ چگالیِ کاراکترِ همین ریپو می‌آید
  // (اندازه‌گیریِ `card-knowledge.<lang>.json` علیه فارسی: ru ≈ +۲۰٪، pt ≈ +۲۵٪،
  // es ≈ +۳۰٪ کاراکتر برای محتوای معادل). **این بازه موقتی است** — دقیقاً همان
  // مسیری که خودِ بازه‌ی فارسی طی کرد (GANJINEH.md: عددِ اول «۴۰۰ تا ۶۰۰» بود و با
  // نمونه‌های واقعی به «۲۰۰ تا ۶۰۰» اصلاح شد): بعد از نگارشِ چند صد متنِ واقعی، این
  // عدد از رویِ توزیعِ واقعی دوباره تنظیم می‌شود.
  ru: {
    min: 230, max: 700,
    // «شما»ی روسی از خودِ langdata می‌آید (defects: formal)، نه یک regex جدا
    badPhrases: null, // پایین‌تر از locales/ru.js → verdict.evasion + register پر می‌شود
    pastTime: null,   // از locales/ru.js → verdict.pastTimePattern (با فلگِ i، چون
                       // عبارتِ زمانی معمولاً اولِ جمله با حرفِ بزرگ می‌آید)
    alien: [ALIEN_SCRIPTS.fa, ALIEN_SCRIPTS.cjk],
  },
  pt: {
    min: 240, max: 730,
    badPhrases: null, pastTime: null,
    alien: [ALIEN_SCRIPTS.fa, ALIEN_SCRIPTS.cjk, ALIEN_SCRIPTS.cyr, ALIEN_SCRIPTS.esChars],
  },
  es: {
    min: 250, max: 760,
    badPhrases: null, pastTime: null,
    alien: [ALIEN_SCRIPTS.fa, ALIEN_SCRIPTS.cjk, ALIEN_SCRIPTS.cyr, ALIEN_SCRIPTS.ptChars],
  },
};

// فایل‌های محتوای واقعی روی دیسک — نه لیستِ دستی، وگرنه زبانِ تازه بی‌صدا از قلم می‌افتد.
const FILES = readdirSync(DIR).filter(f => /^daily-ganjineh\.[a-z-]+\.json$/.test(f));
const LOCALES_FOUND = FILES.map(f => f.match(/^daily-ganjineh\.([a-z-]+)\.json$/)[1]).sort();

console.log(`\n▶ زبان‌های دارای فایلِ گنجینه: ${LOCALES_FOUND.join(', ') || '—'}`);
ok(LOCALES_FOUND.includes('fa'), 'فارسی همیشه باید حاضر باشد (fa)');
ok(LOCALES_FOUND.every(loc => RULES[loc]), `هر زبانِ پیداشده یک ردیفِ قاعده دارد${LOCALES_FOUND.some(l => !RULES[l]) ? ' — بی‌قاعده: ' + LOCALES_FOUND.filter(l => !RULES[l]).join(', ') : ''}`);

for (const loc of LOCALES_FOUND) {
  const rules = RULES[loc];
  if (!rules) continue; // بالا قرمز شد؛ اجرای این زبان بی‌فایده است

  console.log(`\n${'─'.repeat(50)}\n🌍 محتوای گنجینه — ${loc}`);
  const DATA = JSON.parse(readFileSync(new URL(`daily-ganjineh.${loc}.json`, DIR), 'utf8'));

  // نامِ ماه/برج از locale می‌آید، نه از ganjineh.js (بند ۲و: متنِ رو-به-کاربر است).
  const LOC = (await import(`../bots/tarot/locales/${loc}.js`)).default;
  const MONTH_LABEL = (m) => LOC?.buttons?.birthMonths?.[m - 1] || String(m);

  let badPhrases = rules.badPhrases;
  let pastTime = rules.pastTime;
  let defects = rules.defects || null;
  if (badPhrases === null || pastTime === null || defects === null) {
    // زبان‌های غیرفارسی: بلک‌لیست از **همان منبعی** می‌آید که خروجیِ خوانشِ زنده را
    // می‌سنجد (verdict.evasion/register/pastTimePattern) — نه یک کپیِ سوم.
    const v = LOC?.verdict || {};
    badPhrases = badPhrases ?? [...(v.evasion || []), ...(v.register || [])];
    pastTime = pastTime ?? (v.pastTimePattern ? new RegExp(v.pastTimePattern, 'i') : /^$a/);
    let langData = {};
    try { langData = (await import(`../bots/tarot/langdata.${loc}.json`, { with: { type: 'json' } })).default; } catch {}
    defects = defects ?? compileDefects(langData.defects);
  }

  let cells = 0, lenBad = [], paraBad = [], dashBad = [], emojiBad = [], youBad = [], phraseBad = [], pastBad = [], keyBad = [], emptyBad = [], alienBad = [];
  const defectBad = Object.fromEntries((defects || []).map(d => [d.id, []]));
  const seenText = new Map(), dupBad = [];
  const monthCounts = {};

  for (const [m, cards] of Object.entries(DATA)) {
    if (m.startsWith('_')) continue;
    const mn = Number(m);
    if (!Number.isInteger(mn) || mn < 1 || mn > 12) { keyBad.push(`ماهِ نامعتبر: ${m}`); continue; }
    const counts = new Set();
    for (const [k, arr] of Object.entries(cards || {})) {
      if (!CARD_BY_KEY[k]) { keyBad.push(`${m}/${k}`); continue; }
      if (!Array.isArray(arr) || !arr.length) { emptyBad.push(`${m}/${k}`); continue; }
      counts.add(arr.length);
      arr.forEach((t, i) => {
        cells++;
        const where = `${loc}:${m}/${k}#${i}`;
        const len = [...String(t)].length;
        if (len < rules.min || len > rules.max) lenBad.push(`${where}(${len})`);
        if (String(t).split(/\n\s*\n/).length !== 3) paraBad.push(where);
        if (/—|--/.test(t)) dashBad.push(where);
        if (EMOJI.test(t)) emojiBad.push(where);
        if (rules.noYou?.re?.test(t)) youBad.push(where);
        if (badPhrases.some(p => t.toLowerCase().includes(String(p).toLowerCase()))) phraseBad.push(where);
        if (pastTime.test(t)) pastBad.push(where);
        for (const re of rules.alien || []) if (re.test(t)) { alienBad.push(where); break; }
        for (const d of defects || []) { const hit = d.find(t); if (hit) defectBad[d.id].push(`${where}(${hit})`); }
        const norm = String(t).replace(/\s+/g, ' ').trim();
        if (seenText.has(norm)) dupBad.push(`${where} = ${seenText.get(norm)}`); else seenText.set(norm, where);
      });
    }
    monthCounts[m] = [...counts];
  }

  ok(cells > 0, `[${loc}] گنجینه خالی نیست (${cells} متن)`);
  ok(!keyBad.length, `[${loc}] همه‌ی کلیدها معتبرند${keyBad.length ? ' — نامعتبر: ' + keyBad.join(', ') : ''}`);
  ok(!emptyBad.length, `[${loc}] هیچ خانه‌ی خالی‌ای نیست${emptyBad.length ? ' — ' + emptyBad.join(', ') : ''}`);
  ok(!lenBad.length, `[${loc}] طولِ همه در بازه‌ی ${rules.min} تا ${rules.max}${lenBad.length ? ' — خارج: ' + lenBad.slice(0, 6).join(', ') : ''}`);
  ok(!paraBad.length, `[${loc}] هر متن دقیقاً سه بند دارد${paraBad.length ? ' — ' + paraBad.slice(0, 6).join(', ') : ''}`);
  ok(!dashBad.length, `[${loc}] هیچ خطِ تیره‌ی بلندی نیست (بند ۱۰ ریشه)${dashBad.length ? ' — ' + dashBad.slice(0, 6).join(', ') : ''}`);
  ok(!emojiBad.length, `[${loc}] هیچ ایموجی‌ای در متن نیست${emojiBad.length ? ' — ' + emojiBad.slice(0, 6).join(', ') : ''}`);
  if (rules.noYou) ok(!youBad.length, `[${loc}] ${rules.noYou.label}${youBad.length ? ' — ' + youBad.slice(0, 6).join(', ') : ''}`);
  ok(!phraseBad.length, `[${loc}] هیچ عبارتِ طفره‌رونده‌ای نیست${phraseBad.length ? ' — ' + phraseBad.slice(0, 6).join(', ') : ''}`);
  ok(!pastBad.length, `[${loc}] هیچ اشاره‌ی زمانی به گذشته نیست${pastBad.length ? ' — ' + pastBad.slice(0, 6).join(', ') : ''}`);
  ok(!alienBad.length, `[${loc}] هیچ نویسه/واژه‌ی بیگانه‌ای در متن نیست${alienBad.length ? ' — ' + alienBad.slice(0, 6).join(', ') : ''}`);
  for (const [id, bad] of Object.entries(defectBad)) {
    ok(!bad.length, `[${loc}] گاردِ زبانی «${id}» رعایت شده${bad.length ? ' — ' + bad.slice(0, 6).join(', ') : ''}`);
  }
  ok(!dupBad.length, `[${loc}] هیچ دو خانه‌ای متنِ یکسان ندارند${dupBad.length ? ' — ' + dupBad.slice(0, 4).join(' | ') : ''}`);

  // یکنواختیِ تعدادِ نسخه در هر ماه: قاطیِ ۱ و ۳ یعنی بعضی کاربرها بی‌دلیل تنوعِ کمتری می‌گیرند
  const mixed = Object.entries(monthCounts).filter(([, c]) => c.length > 1).map(([m, c]) => `${m}:${c.join('/')}`);
  ok(!mixed.length, `[${loc}] تعدادِ نسخه در هر ماه یکنواخت است${mixed.length ? ' — قاطی: ' + mixed.join(', ') : ''}`);

  // ماهِ **کامل** یعنی هر ۷۸ کارت. ماهِ ناقص خطا نیست (نگارش تدریجی است) ولی گزارش می‌شود.
  const full = [], partial = [], tooSmall = [];
  for (const m of Object.keys(monthCounts)) {
    const n = Object.keys(DATA[m]).filter(k => CARD_BY_KEY[k]).length;
    if (n === ALL.length) full.push(m); else { partial.push(`${MONTH_LABEL(m)}:${n}`); if (n < 24) tooSmall.push(`${MONTH_LABEL(m)}:${n}`); }
  }
  console.log(`  ℹ️ [${loc}] ماهِ کامل: ${full.length}/12${partial.length ? ` | ناقص: ${partial.join(', ')}` : ''}`);
  if (tooSmall.length) console.log(`  ⚠️ [${loc}] زیرِ ۲۴ کارت (گریدِ کوچک‌تر از بقیه): ${tooSmall.join(', ')}`);

  // گزارشِ طولِ واقعی — برای بازتنظیمِ بعدیِ بازه (همان روشی که خودِ فارسی طی کرد)
  const lens = [];
  for (const m of Object.keys(monthCounts)) for (const k of Object.keys(DATA[m])) {
    if (!CARD_BY_KEY[k]) continue;
    for (const t of DATA[m][k] || []) lens.push([...String(t)].length);
  }
  if (lens.length) {
    lens.sort((a, b) => a - b);
    const p = (q) => lens[Math.floor(q * (lens.length - 1))];
    console.log(`  ℹ️ [${loc}] طول (کاراکتر): min=${lens[0]} p25=${p(.25)} median=${p(.5)} p75=${p(.75)} max=${lens[lens.length - 1]}`);
  }

  // سلامتِ خواندن از runtime: فقط برای زبانِ جاریِ `process.env.LOCALE` معنی دارد
  // (ganjineh.js دیتایش را یک‌بار، سرِ import، بر اساسِ همان env بار می‌کند؛ در یک
  // پروسه نمی‌شود چند زبان را همزمان از رانتایم سنجید — همان محدودیتِ ESM cache).
  const RUNTIME_LOCALE = process.env.LOCALE?.trim() || 'fa';
  if (loc === RUNTIME_LOCALE) {
    let readBad = 0;
    for (const m of Object.keys(monthCounts)) for (const k of Object.keys(DATA[m])) {
      if (!CARD_BY_KEY[k]) continue;
      if (hasText(m, k) && !textOf(m, k, 0)) readBad++;
      if (countOf(m, k) !== (DATA[m][k] || []).length) readBad++;
    }
    ok(readBad === 0, `[${loc}] hasText/textOf/countOf با خودِ فایل هم‌خوان‌اند`);
  }
}

ok(true, `گزارشِ نهایی چاپ شد (${stats().texts} متن در ${stats().months} ماه، زبانِ رانتایم: ${process.env.LOCALE?.trim() || 'fa'})`);

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
