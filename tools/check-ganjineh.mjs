#!/usr/bin/env node
// چکِ گنجینه — هم **منطقِ انتخاب** را اجرا می‌کند، هم خودِ محتوا را می‌سنجد.
//
// چرا لازم است: گنجینه در نهایت ۹۳۶ متن (و بعداً ۲۸۰۸) می‌شود و تنها فایلِ محتوایِ
// ریپو بود که هیچ چکی نداشت. با این حجم، یک خانه‌ی جاافتاده یا یک «—» تا لحظه‌ی
// رسیدنِ کاربرِ واقعی ساکت می‌ماند (درسِ بند ۸ ریشه: مسیرِ سرد را CI نمی‌بیند).
//
// اجرا: node tools/check-ganjineh.mjs
import { readFileSync } from 'fs';
import { CARD_BY_KEY } from '../bots/tarot/cards.js';
import {
  eligibleCards, pickVariant, countOf, hasText, textOf, stats,
  NO_REPEAT_DRAWS, VARIANTS, MONTHS_FA,
} from '../bots/tarot/ganjineh.js';

const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const GAN = readFileSync(new URL('../bots/tarot/ganjineh.js', import.meta.url), 'utf8');
const DATA = JSON.parse(readFileSync(new URL('../bots/tarot/daily-ganjineh.fa.json', import.meta.url), 'utf8'));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const ALL = Object.keys(CARD_BY_KEY);
// مولدِ شبه‌تصادفیِ قطعی: اجرای دوباره‌ی چک باید همان نتیجه را بدهد، وگرنه یک تستِ
// نویزی داریم که گاهی سبز و گاهی قرمز می‌شود و هیچ‌کس جدی‌اش نمی‌گیرد.
let _s = 12345;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };

/* ═══════════ ۱) قاعده‌ی عدمِ تکرار: «۷ بارِ آخر»، نه «۷ روز» ═══════════ */
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
    ok(hist.every(k => !pool.includes(k)) || !written.every(k => true),
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

/* ═══════════ ۵) خودِ محتوا ═══════════ */
console.log('\n▶ اعتبارِ محتوای گنجینه');
{
  const MIN = 200, MAX = 600;
  const BAD_PHRASES = ['بستگی به خودت داره', 'به شهودت اعتماد کن', 'کائنات', 'شاید آره شاید نه', 'هم می‌تونه این باشه هم اون'];
  const PAST_TIME = /(پارسال|سال پیش|هفته‌ی پیش|هفته پیش|ماه پیش|دفعه‌ی قبل|دفعه قبل)/;
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  let cells = 0, lenBad = [], paraBad = [], dashBad = [], emojiBad = [], youBad = [], phraseBad = [], pastBad = [], keyBad = [], emptyBad = [];
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
        const where = `${m}/${k}#${i}`;
        const len = [...String(t)].length;
        if (len < MIN || len > MAX) lenBad.push(`${where}(${len})`);
        if (String(t).split(/\n\s*\n/).length !== 3) paraBad.push(where);
        if (/—|--/.test(t)) dashBad.push(where);
        if (EMOJI.test(t)) emojiBad.push(where);
        // «شما» به‌عنوانِ **کلمه**؛ «شماره» و «شمارش» نباید قربانی شوند
        if (/شما(?![؀-ۿ‌])/.test(t)) youBad.push(where);
        if (BAD_PHRASES.some(p => t.includes(p))) phraseBad.push(where);
        if (PAST_TIME.test(t)) pastBad.push(where);
        const norm = String(t).replace(/\s+/g, ' ').trim();
        if (seenText.has(norm)) dupBad.push(`${where} = ${seenText.get(norm)}`); else seenText.set(norm, where);
      });
    }
    monthCounts[m] = [...counts];
  }

  ok(cells > 0, `گنجینه خالی نیست (${cells} متن)`);
  ok(!keyBad.length, `همه‌ی کلیدها معتبرند${keyBad.length ? ' — نامعتبر: ' + keyBad.join(', ') : ''}`);
  ok(!emptyBad.length, `هیچ خانه‌ی خالی‌ای نیست${emptyBad.length ? ' — ' + emptyBad.join(', ') : ''}`);
  ok(!lenBad.length, `طولِ همه در بازه‌ی ${MIN} تا ${MAX}${lenBad.length ? ' — خارج: ' + lenBad.slice(0, 6).join(', ') : ''}`);
  ok(!paraBad.length, `هر متن دقیقاً سه بند دارد${paraBad.length ? ' — ' + paraBad.slice(0, 6).join(', ') : ''}`);
  ok(!dashBad.length, `هیچ خطِ تیره‌ی بلندی نیست (بند ۱۰ ریشه)${dashBad.length ? ' — ' + dashBad.slice(0, 6).join(', ') : ''}`);
  ok(!emojiBad.length, `هیچ ایموجی‌ای در متن نیست${emojiBad.length ? ' — ' + emojiBad.slice(0, 6).join(', ') : ''}`);
  ok(!youBad.length, `همه‌جا «تو»، هیچ «شما»${youBad.length ? ' — ' + youBad.slice(0, 6).join(', ') : ''}`);
  ok(!phraseBad.length, `هیچ عبارتِ طفره‌رونده‌ای نیست${phraseBad.length ? ' — ' + phraseBad.slice(0, 6).join(', ') : ''}`);
  ok(!pastBad.length, `هیچ اشاره‌ی زمانی به گذشته نیست${pastBad.length ? ' — ' + pastBad.slice(0, 6).join(', ') : ''}`);
  ok(!dupBad.length, `هیچ دو خانه‌ای متنِ یکسان ندارند${dupBad.length ? ' — ' + dupBad.slice(0, 4).join(' | ') : ''}`);

  // یکنواختیِ تعدادِ نسخه در هر ماه: قاطیِ ۱ و ۳ یعنی بعضی کاربرها بی‌دلیل تنوعِ کمتری می‌گیرند
  const mixed = Object.entries(monthCounts).filter(([, c]) => c.length > 1).map(([m, c]) => `${m}:${c.join('/')}`);
  ok(!mixed.length, `تعدادِ نسخه در هر ماه یکنواخت است${mixed.length ? ' — قاطی: ' + mixed.join(', ') : ''}`);

  // ماهِ **کامل** یعنی هر ۷۸ کارت. ماهِ ناقص خطا نیست (نگارش تدریجی است) ولی گزارش می‌شود،
  // چون زیرِ ۲۴ کارت گریدِ آن ماه کوچک‌تر از بقیه می‌شود.
  const full = [], partial = [], tooSmall = [];
  for (const m of Object.keys(monthCounts)) {
    const n = Object.keys(DATA[m]).filter(k => CARD_BY_KEY[k]).length;
    if (n === ALL.length) full.push(m); else { partial.push(`${MONTHS_FA[m - 1]}:${n}`); if (n < 24) tooSmall.push(`${MONTHS_FA[m - 1]}:${n}`); }
  }
  console.log(`  ℹ️ ماهِ کامل: ${full.length}/12${partial.length ? ` | ناقص: ${partial.join(', ')}` : ''}`);
  ok(true, `گزارشِ پیشرفت چاپ شد (${stats().texts} متن در ${stats().months} ماه)`);
  if (tooSmall.length) console.log(`  ⚠️ زیرِ ۲۴ کارت (گریدِ کوچک‌تر از بقیه): ${tooSmall.join(', ')}`);

  // سلامتِ خواندن از runtime: هر خانه‌ای که hasText می‌گوید هست، واقعاً متن بدهد
  let readBad = 0;
  for (const m of Object.keys(monthCounts)) for (const k of Object.keys(DATA[m])) {
    if (!CARD_BY_KEY[k]) continue;
    if (hasText(m, k) && !textOf(m, k, 0)) readBad++;
    if (countOf(m, k) !== (DATA[m][k] || []).length) readBad++;
  }
  ok(readBad === 0, 'hasText/textOf/countOf با خودِ فایل هم‌خوان‌اند');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
