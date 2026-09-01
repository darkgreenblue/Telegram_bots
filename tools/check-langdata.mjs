#!/usr/bin/env node
// گاردِ دادهٔ زبانیِ ساختاری (`bots/tarot/langdata.<locale>.json`) — قراردادِ بند ۲و.
//
// چرا این چک وجود دارد: تا قبل از این، نامِ کارت و جایگاه و چیدمان **فارسیِ هاردکد**
// بودند و مستقیم وارد پرامپت و کپشنِ رو-به-کاربر می‌شدند. یک زبانِ تازه که این فایل را
// ناقص بیاورد، هیچ خطایی نمی‌دهد: فقط بی‌صدا به فارسی fallback می‌کند. دو ضرر:
//   ۱) کاربرِ آن زبان وسطِ فالِ پولی‌اش نامِ فارسی می‌بیند.
//   ۲) سنجه‌ی «لنگر» آزمایشگاه (مرکزی‌ترین متریکِ کیفیت) روی آن زبان بی‌معنی می‌شود،
//      چون خروجی را با نامی مقایسه می‌کند که مدل هرگز نمی‌نویسد.
// هیچ‌کدام سر و صدا نمی‌کنند، پس فقط یک چک می‌تواند بگیردشان.
//
// این چک درباره‌ی **کیفیتِ ترجمه** ادعایی ندارد؛ فقط پوشش و تک‌زبانه بودن را قفل می‌کند.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import CARDS from '../bots/tarot/cards.js';
import { SPREAD_BY_ID, DAILY } from '../bots/tarot/spreads.js';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const DIR = new URL('../bots/tarot/', import.meta.url);
const FILES = readdirSync(DIR).filter(f => /^langdata\.[a-z-]+\.json$/.test(f)).sort();
if (!FILES.length) {
  console.log('⏭ هیچ فایلِ زبانی نیست (فقط فارسی) — fail-safe است، رد می‌شویم.');
  process.exit(0);
}

/* مجموعه‌ی کاملِ رشته‌های فارسیِ canonical که **باید** ترجمه داشته باشند.
 * از خودِ ماژول‌ها استخراج می‌شود نه از یک لیستِ دستی، وگرنه افزودنِ یک چیدمانِ تازه
 * بی‌صدا از پوشش جا می‌ماند — دقیقاً همان چیزی که این چک برای گرفتنش هست. */
const spreadNames = new Set();
const positionNames = new Set();
for (const sp of Object.values(SPREAD_BY_ID)) {
  for (const f of ['fa', 'faV2', 'faV3']) if (sp[f]) spreadNames.add(sp[f]);
  for (const p of (sp.positions || [])) if (p.fa) positionNames.add(p.fa);
  // ⚠️ برچسبِ تقابلی هم جایگاه نیست هم چیدمان، ولی `verdict.js` عیناً به‌عنوانِ
  // **جوابِ نهایی** چاپش می‌کند. بدونِ ترجمه کاربر «Ответ: موندن» می‌گیرد.
  for (const l of (sp.choiceLabels || [])) positionNames.add(l);
}
if (DAILY?.fa) spreadNames.add(DAILY.fa);

const ALIEN = [
  [/[؀-ۿ]/, 'نویسه‌ی فارسی/عربی'],
  [/[　-鿿＀-￯]/, 'نویسه‌ی CJK'],
];

for (const file of FILES) {
  const lang = file.replace(/^langdata\.|\.json$/g, '');
  console.log(`\n${'━'.repeat(60)}\n🌍 زبان: ${lang}  (${file})\n${'━'.repeat(60)}`);
  const d = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));

  console.log('\n▶ پوششِ کامل');
  {
    const missCards = CARDS.filter(c => !d.cardNames?.[c.key]).map(c => c.key);
    ok(missCards.length === 0, `هر ۷۸ کارت نام دارد${missCards.length ? ` (جامانده: ${missCards.slice(0, 8).join(',')})` : ''}`);
    const missKw = CARDS.filter(c => !d.cardKeywords?.[c.key]?.up?.length || !d.cardKeywords?.[c.key]?.down?.length).map(c => c.key);
    ok(missKw.length === 0, `هر ۷۸ کارت کلیدواژه‌ی مستقیم و معکوس دارد${missKw.length ? ` (جامانده: ${missKw.slice(0, 8).join(',')})` : ''}`);
    // تعدادِ کلیدواژه‌ها باید با فارسی بخواند: کم‌شدنشان یعنی معنیِ کارت لاغرتر رفته
    const wrong = CARDS.filter(c => {
      const k = d.cardKeywords?.[c.key]; if (!k) return false;
      return k.up.length !== c.up.length || k.down.length !== c.down.length;
    }).map(c => c.key);
    ok(wrong.length === 0, `تعدادِ کلیدواژه‌ها با فارسی یکی است${wrong.length ? ` (ناهم‌خوان: ${wrong.slice(0, 8).join(',')})` : ''}`);
    const missS = [...spreadNames].filter(n => !d.spreadNames?.[n]);
    ok(missS.length === 0, `هر ${spreadNames.size} نامِ چیدمان ترجمه دارد${missS.length ? ` (جامانده: ${missS.slice(0, 4).join(' | ')})` : ''}`);
    const missP = [...positionNames].filter(n => !d.positionNames?.[n]);
    ok(missP.length === 0, `هر ${positionNames.size} نامِ جایگاه و برچسبِ تقابلی ترجمه دارد${missP.length ? ` (جامانده: ${missP.slice(0, 4).join(' | ')})` : ''}`);
    ok(typeof d.positionFallback === 'string' && d.positionFallback.includes('%n'),
      'برچسبِ کارتِ بی‌جایگاه قالبِ %n دارد');
    /* 🌍 کلیدهای کانتکستِ «فال‌های قبلی» هم متنِ پرامپت‌اند و باید per زبان باشند.
     * 🐛 باگی که این را لازم کرد: این کلیدها فارسیِ هاردکد بودند، پس هر زبانِ دیگری
     * آبجکتی با کلیدِ فارسی می‌گرفت. علاوه بر نشتِ نویسه‌ی فارسی به پرامپتِ غیرفارسی،
     * سنجه‌ی «لنگرِ حافظه» آزمایشگاه با `summaryKey`ِ همان زبان دنبالِ خلاصه می‌گشت،
     * `undefined` می‌گرفت، و جمله‌ای که واقعاً به فالِ قبلی لنگر داشت «بی‌لنگر»
     * شمرده می‌شد. یعنی نرخِ زبانِ غیرفارسی الکی بالا می‌رفت. */
    /* 🐛 تله‌ی `\b` — دو بار در دو زبان گاز گرفت.
     * `\b` در جاوااسکریپت **فقط ASCII** است. پس `\bél\b` روی «él» کار نمی‌کند و
     * `\bвы\b` روی سیریلیک اصلاً match نمی‌شود. هر دو بار نتیجه یک گاردِ بی‌صدا بود
     * که فکر می‌کردیم کار می‌کند. مرزها باید صریح نوشته شوند:
     * `(?:^|[^A-Za-zÀ-ÖØ-öø-ÿ])` و `(?=$|[^…])`. */
    for (const df of (d.defects || [])) {
      for (const key of ['pattern', 'except']) {
        const src = df[key];
        if (!src) continue;
        const hasNonAscii = /[^\x00-\x7F]/.test(src);
        ok(!(hasNonAscii && /\\b/.test(src)),
          `ضعفِ «${df.id}» فیلدِ ${key}: از \\b کنارِ نویسه‌ی غیرASCII استفاده نمی‌کند`);
      }
    }

    const ck = d.ctxKeys || {};
    ok(!!ck.type && !!ck.summary && !!ck.feedback,
      'کلیدهای کانتکستِ فال‌های قبلی ترجمه دارند (`ctxKeys`)');
    ok(!/[؀-ۿ]/.test(`${ck.type}${ck.summary}${ck.feedback}`),
      'کلیدهای کانتکست نویسه‌ی فارسی ندارند (وگرنه فارسی وارد پرامپتِ این زبان می‌شود)');
    /* و ماژولِ سنجه‌ی آزمایشگاه باید **همان** کلید را بخواند. دو کپیِ جدا یعنی سنجه
     * دنبالِ کلیدی می‌گردد که در کانتکست نیست، و بی‌صدا صفر برمی‌گرداند. */
    if (existsSync(new URL(`../tools/reading-lab/lang/${lang}.mjs`, import.meta.url))) {
      const labSrc = readFileSync(new URL(`../tools/reading-lab/lang/${lang}.mjs`, import.meta.url), 'utf8');
      const m = /summaryKey:\s*'([^']+)'/.exec(labSrc);
      ok(!!m && m[1] === ck.summary,
        `summaryKeyِ آزمایشگاه با ctxKeys.summary یکی است (${m ? m[1] : 'نبود'} = ${ck.summary})`);
    }
    ok(!!d.repair?.system && !!d.repair?.hints?.evasion && !!d.repair?.hints?.pastTime && String(d.repair?.item || '').includes('%text'),
      'پرامپتِ تعمیر کامل است (system + دو hint + قالبِ item)');
  }

  console.log('\n▶ تک‌زبانه بودن (مقدارها، نه کلیدها)');
  {
    // ⚠️ فقط **مقدارها** سنجیده می‌شوند: کلیدها عمداً رشته‌ی فارسیِ canonical اند.
    const vals = [];
    const walk = (o) => {
      if (typeof o === 'string') { vals.push(o); return; }
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === 'object') { Object.values(o).forEach(walk); }
    };
    for (const [k, v] of Object.entries(d)) if (k !== '_note') walk(v);
    for (const [re, label] of ALIEN) {
      const hits = vals.filter(v => re.test(v));
      ok(hits.length === 0, `هیچ ${label}ی در مقدارها نیست${hits.length ? ` (${hits.slice(0, 3).join(' | ')})` : ''}`);
    }
    // بند ۱۰ ریشه: «—» امضای متنِ ماشینی است. در روسی این را خودِ خواننده تشخیص می‌دهد.
    const dash = vals.filter(v => /[—–]|--/.test(v));
    ok(dash.length === 0, `هیچ خط تیره‌ی بلندی نیست${dash.length ? ` (${dash.slice(0, 3).join(' | ')})` : ''}`);
    const dup = Object.values(d.cardNames || {});
    ok(new Set(dup).size === dup.length, `نامِ هر ۷۸ کارت یکتاست${new Set(dup).size !== dup.length ? ' (نامِ تکراری یعنی مدل دو کارت را یکی می‌بیند)' : ''}`);
  }

  console.log('\n▶ ضعف‌های زبانیِ مسیرِ تعمیر');
  {
    /* ⚠️ چرا این ادعاها لازم‌اند: پرامپتِ روسی از قبل صریحاً «ты» را اجباری و حدسِ
     * جنسیت را ممنوع می‌کند، و مدل هر دو را در ۵ فال از ۹ شکست. یعنی این گارد تنها
     * چیزی است که بینِ کاربر و آن خطا ایستاده. الگوی خراب یا استثنای غلط بی‌صدا
     * خاموشش می‌کند، پس خودِ الگو **اجرا** می‌شود نه فقط خوانده. */
    const defs = d.defects || [];
    ok(Array.isArray(defs) && defs.length > 0, `ضعف‌های زبانی تعریف شده‌اند (${defs.length})`);
    let allOk = true;
    for (const df of defs) {
      if (!df.id || !df.pattern || !df.hint) { allOk = false; continue; }
      try { new RegExp(df.pattern, df.flags || ''); if (df.except) new RegExp(df.except, 'i'); }
      catch { allOk = false; }
    }
    ok(allOk, 'هر ضعف id و الگوی معتبر و hint دارد');
    // hint به **زبانِ خودِ مدل** است، چون مستقیم داخلِ پرامپتِ تعمیر می‌نشیند؛
    // یک hintِ فارسی داخلِ پرامپتِ روسی همان باگی است که این PR بست.
    const faHint = defs.filter((df) => /[؀-ۿ]/.test(df.hint || '')).map((df) => df.id);
    ok(faHint.length === 0, `hintها به زبانِ همان locale اند${faHint.length ? ` (فارسی در: ${faHint.join(',')})` : ''}`);
  }

  console.log('\n▶ هم‌خوانی با جدولِ دانش');
  {
    // دو فایلِ per زبان هر دو نامِ کارت دارند. واگراییشان یعنی مدل در یک جای پرامپت
    // یک نام می‌بیند و در جای دیگر نامِ دیگری — همان کارت، دو هویت.
    const kbFile = new URL(`card-knowledge.${lang}.json`, DIR);
    if (!existsSync(kbFile)) { console.log('  ⏭ جدولِ دانشِ این زبان هنوز نیست'); }
    else {
      const kb = JSON.parse(readFileSync(kbFile, 'utf8'));
      const diff = Object.keys(kb).filter(k => kb[k].name && d.cardNames?.[k] && kb[k].name !== d.cardNames[k]);
      ok(diff.length === 0, `نامِ کارت در هر دو فایل یکی است${diff.length ? ` (ناهم‌خوان: ${diff.slice(0, 5).join(',')})` : ''}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ▶ گاردِ سرخط per زبان — «فهرست باید ریشه باشد، اگر زبان صرف می‌کند»

   🐛 باگی که دورِ ۵ آزمایشگاهِ روسی لو داد: `headlineOk` فهرستِ جهت را با
   `includes` روی کلمه‌ی **کامل** می‌سنجید. فارسی صرف نمی‌کند، پس درست بود؛ روسی
   می‌کند. فهرست «вероятно» داشت و مدل «вероятен» نوشت، «получится» داشت و مدل
   «решится». از ۱۰ تلاشِ ردشده‌ی آن دور، **۸ تا سرخطِ کاملاً درست** بودند.
   هزینه‌اش دو چیز بود که هیچ‌کدام سر و صدا نمی‌کنند: هر رد یک فالِ کاملِ
   دوباره‌تولیدشده (~$۰.۰۰۵) و دو فال تا مدلِ فالبکِ ضعیف‌تر عقب رفتند.

   پس این‌جا **رفتار** سنجیده می‌شود نه شکلِ فهرست: چند سرخطِ صرف‌شده باید پاس
   شوند و چند سرخطِ طفره‌رونده باید رد. و مهم‌تر از همه، ادعای آخر ثابت می‌کند
   فارسی از این تغییر **هیچ اثری نگرفته**.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ گاردِ سرخط per زبان');
{
  const { configureVerdict, headlineOk } = await import('../bots/tarot/verdict.js');

  // فارسی: خروجیِ قبل و بعدِ پیکربندی باید بیت‌به‌بیت یکی باشد (رباتِ زنده).
  const FA_CASES = [
    ['بله با احتمال نسبتا بالا، ولی به شرط اینکه مرز بذاری', true],
    ['نه به این شکل، اما مسیر دیگه‌ای باز می‌شه', true],
    ['محتمله که بشه، ولی هزینه‌اش زمانه', true],
    ['بستگی به خودت داره، ولی می‌تونی', false],
    ['به شهودت اعتماد کن، اما نترس', false],
    ['کائنات هواتو داره، ولی صبر لازمه', false],
    ['یه اتفاقی می‌افته', false],
  ];
  const faBefore = FA_CASES.map(([t]) => headlineOk(t));
  const fa = (await import('../bots/tarot/locales/fa.js')).default;
  configureVerdict(fa.verdict);
  const faAfter = FA_CASES.map(([t]) => headlineOk(t));
  ok(JSON.stringify(faBefore) === JSON.stringify(faAfter),
    'پیکربندیِ فارسی خروجیِ گارد را بیت‌به‌بیت عوض نمی‌کند');
  const faWrong = FA_CASES.filter(([, want], i) => faAfter[i] !== want).map(([t]) => t);
  ok(faWrong.length === 0, `گاردِ فارسی هر ${FA_CASES.length} نمونه را درست قضاوت می‌کند` +
    (faWrong.length ? ` (غلط: ${faWrong[0]})` : ''));
  ok(fa.verdict.directionStem !== true, 'فارسی ریشه‌گیری ندارد (فعل را برای این کار صرف نمی‌کند)');

  // روسی: همان سرخط‌هایی که در دورِ ۵ **به‌غلط** رد شدند، به‌علاوه‌ی طفره‌روها.
  const RU_PASS = [
    'Уход с работы безусловно возможен, однако цена этому твои личные ресурсы.',  // возмож+
    'Твой выход на новый уровень вероятен, однако цена этому отказ от привычного.', // вероят+
    'Личный вопрос решится положительно, однако цена этого отказ от иллюзий.',    // реш+
    'Да, но тебе придётся сказать вслух то, что ты молчишь.',
    'Скорее всего он вернётся, однако не таким, каким ты его помнишь.',
  ];
  const RU_FAIL = [
    'Всё зависит от тебя, но выбор за тобой.',      // طفره
    'Доверься интуиции, однако не спеши.',          // طفره
    'Вселенная поддержит тебя, но будь терпелив.',  // واژه‌ی ممنوع
    'Карты говорят о переменах.',                   // بدونِ «но» و بدونِ جهت
    // ⚠️ این یکی قبلاً **به‌غلط پاس** می‌شد: «когда» و «правда» و «даже» هر سه
    // زیررشته‌ی «да» دارند، پس گارد نه سخت بود نه شل، تصادفی بود.
    'Когда-то давно правда была даже проще, но всё меняется.',
  ];
  const ruFile = new URL('../bots/tarot/locales/ru.js', import.meta.url);
  if (!existsSync(ruFile)) { console.log('  ⏭ locale روسی نیست'); }
  else {
    const ru = (await import('../bots/tarot/locales/ru.js')).default;
    configureVerdict(ru.verdict);
    ok(ru.verdict.directionStem === true, 'روسی ریشه‌گیری دارد (زبانِ صرفی)');
    const badPass = RU_PASS.filter((t) => !headlineOk(t));
    ok(badPass.length === 0, `سرخطِ صرف‌شده‌ی درست پاس می‌شود (${RU_PASS.length} نمونه)` +
      (badPass.length ? ` — رد شد: ${badPass[0].slice(0, 50)}` : ''));
    const badFail = RU_FAIL.filter((t) => headlineOk(t));
    ok(badFail.length === 0, `سرخطِ بی‌جهت یا طفره‌رونده رد می‌شود (${RU_FAIL.length} نمونه)` +
      (badFail.length ? ` — پاس شد: ${badFail[0].slice(0, 50)}` : ''));
    configureVerdict(fa.verdict); // ماژول را برای بقیه‌ی چک به فارسی برگردان
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ▶ یک فیلد، همه‌ی ضعف‌هایش — تقارنِ hint و validate

   🐛 دورِ ۶ روسی: از ۵ تعمیرِ شلیک‌شده **۳ تا ناموفق**. علت یک عدمِ تقارن بود:
   `findDefects` روی **اولین** ضعفِ هر فیلد متوقف می‌شد، پس مدل فقط یک hint
   می‌دید؛ ولی `validate` متنِ تعمیرشده را در برابرِ **همه‌ی** انواع می‌سنجید.
   فیلدی با دو ضعف عملاً محکوم به شکست بود، و شکستش بی‌صداست (متنِ اصلی با هر
   دو ضعف تحویل می‌شود).
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ یک فیلد، همه‌ی ضعف‌هایش');
{
  const { findDefects, DEFECTS } = await import('../bots/tarot/repair.js');

  // فارسی (پیش‌فرضِ ماژول): طفره + زمانِ گذشته در یک جمله
  const faHits = findDefects({ headline: 'x', callback: '', pattern: '',
    reads: ['پارسال بستگی به خودت داره که چی می‌خوای'], closing: '' });
  ok(faHits.length === 1, `فیلدِ دوضعفی همچنان **یک** hit می‌دهد (applyFixes ایندکسی است) — شد ${faHits.length}`);
  ok(/evasion/.test(faHits[0]?.kind || '') && /pastTime/.test(faHits[0]?.kind || ''),
    `هر دو نوع گزارش می‌شوند (شد: ${faHits[0]?.kind})`);
  const faHint = faHits[0]?.hint || '';
  ok(DEFECTS.filter((d) => faHits[0].kind.includes(d.id)).every((d) => !d.hint || faHint.includes(d.hint)),
    'hintِ هر دو ضعف به مدل می‌رسد، نه فقط اولی');

  // ⚠️ جداکننده باید **خنثی** باشد: ویرگولِ فارسی این‌جا یعنی یک نویسه‌ی بیگانه که
  // مستقیم داخلِ پرامپتِ روسی می‌نشیند (همان کلاسِ باگِ `renderV4` با «، »).
  ok(faHits[0].phrase.includes(' / '),
    `عبارت‌ها با جداکننده‌ی خنثی به هم می‌چسبند (شد: ${faHits[0].phrase})`);

  /* روسی: همان جمله‌ی واقعیِ دورِ ۶ که تعمیرش شکست خورد. هر دو ضعف باید دیده شوند،
   * وگرنه مدل «вы» را برمی‌دارد و «Two of Cups» می‌ماند و کلِ تعمیر رد می‌شود. */
  const ruFile = new URL('../bots/tarot/langdata.ru.json', import.meta.url);
  if (existsSync(ruFile)) {
    const ruData = JSON.parse(readFileSync(ruFile, 'utf8'));
    const ids = (ruData.defects || []).map((d) => d.id);
    ok(ids.includes('latin'),
      `ضعفِ «لاتین در متنِ روسی» تعمیرشدنی است، نه فقط یک نکته‌ی گزارشی (${ids.join(', ')})`);
    // سنجه‌ی آزمایشگاه باید همان الگو را از همین فایل بردارد (قاعده‌ی تک‌منبع)
    const LAB_RU = readFileSync(new URL('../tools/reading-lab/lang/ru.mjs', import.meta.url), 'utf8');
    ok(/id: 'latin', re: reOf\('latin'\)/.test(LAB_RU),
      'سنجه‌ی لاتین الگو را از همان فایلِ گارد می‌خواند، نه یک کپیِ جدا');
  }
}

console.log('\n▶ سیم‌کشیِ runtime');
{
  const SRC = readFileSync(new URL('reading-core.js', DIR), 'utf8');
  ok(/langdata\.\$\{LOCALE\}\.json/.test(SRC), 'فایلِ زبان per locale بار می‌شود');
  ok(/catch\(\(\) => \(\{\}\)\)/.test(SRC), 'نبودنِ فایل چیزی را نمی‌شکند (fail-safe برای فارسی)');
  ok(/configureCardData\(LANG_DATA\)/.test(SRC), 'خودِ ماژول پیکربندی می‌شود، پس مصرف‌کننده نمی‌تواند جا بیندازد');
  const BOT = readFileSync(new URL('index.js', DIR), 'utf8');
  // ⚠️ اگر این دو جا برچسبِ خام را پاس بدهند، جوابِ قاطع به فارسی چاپ می‌شود
  ok(!/choiceLabels: spread\?\.choiceLabels/.test(BOT), 'برچسبِ تقابلی از مسیرِ ترجمه می‌رود، نه خام');
  ok((BOT.match(/choiceLabelsFor\(spread\)/g) || []).length === 2, 'هر دو نقطه‌ی verdict برچسبِ ترجمه‌شده می‌گیرند');
  const REP = readFileSync(new URL('repair.js', DIR), 'utf8');
  ok(/LANG_DATA\.defects/.test(REP), 'مسیرِ تعمیر ضعف‌های زبانی را از فایلِ زبان می‌خواند');
  // استثنا باید بی‌توجه به بزرگیِ حرف کامپایل شود، وگرنه «Вы оба» در ابتدای جمله
  // به‌عنوان خطابِ رسمی تعمیر می‌شود در حالی که جمعِ درستِ دو نفره است.
  ok(/replace\('i', ''\)\}i`/.test(REP), 'استثنای ضعف case-insensitive کامپایل می‌شود');
  // سنجه‌ی آزمایشگاه باید از **همان** فایل بخواند، وگرنه گارد و سنجه واگرا می‌شوند
  const LAB = readFileSync(new URL('../../tools/reading-lab/lang/ru.mjs', DIR), 'utf8');
  ok(/langdata\.ru\.json/.test(LAB), 'سنجه‌ی آزمایشگاه الگوها را از همان فایلِ گارد می‌خواند');
}

/* ══════════════════════════════════════════════════════════════════════════
   ▶ گاردِ جنسیت: **تصمیم** سنجیده می‌شود، نه اینکه الگو کامپایل می‌شود

   🐛 شکافی که این بلوک از آن ساخته شد: تا امروز تنها ادعای این چک درباره‌ی
   `defects` این بود که «id و hint دارد و رجکسش کامپایل می‌شود». یعنی یک الگو
   می‌توانست کاملاً معتبر باشد و همچنان جمله‌ی درست را ایراد بگیرد یا جمله‌ی
   غلط را رد کند، و هیچ‌کس نمی‌فهمید.

   و همین شد: در دورِ تأییدِ اسپانیایی، **۲ تا از ۴ ایرادِ گزارش‌شده غلط بودند**
   («te cobra demasiado»، «puedes abrir ingresos rápido»). هر دو قید بودند نه
   صفتِ جنسیت‌دار — `demasiado` و `rápido` صرفاً به `-ado/-ido` ختم می‌شوند و
   قاعده‌ی عمومیِ اسمِ مفعول بلعیده بودشان. پرتغالی هم همین را داشت
   («te paga rápido»). ضررش دوتاست: عددِ ایرادِ هر مدل قابلِ اتکا نیست، و در
   محصول یک فراخوانیِ تعمیر روی متنِ **سالم** شلیک می‌شود.

   قاعده‌ی زبانیِ فیکس: بعد از فعلِ ربطی («eres rápido») همان کلمه صفتِ
   جنسیت‌دارِ واقعی است، ولی بعد از فعلِ غیرربطی («abrir ingresos rápido») قید
   است. پس استثنا per **شاخه** گذاشته شد، نه یک لیستِ سراسری.

   ⚠️ محدودیتِ صادقانه: این پیکره از جمله‌های **واقعیِ** فلگ‌شده‌ی دورهای اخیر
   به‌علاوه‌ی چند نمونه‌ی ساخته‌شده است، نه یک نمونه‌گیریِ تصادفی از کلِ خروجی.
   یعنی نبودِ خطا این‌جا یعنی «این کلاس‌ها درست‌اند»، نه «هیچ کلاسِ ناشناخته‌ای
   نمانده». هر کلاسِ تازه‌ای که در دورهای بعد دیده شد باید همین‌جا ردیف بگیرد.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ گاردِ جنسیت: تصمیمِ واقعی روی جمله‌های واقعی');
{
  /* شناسه‌ی ضعفِ جنسیت per زبان — روسی «genderedPast» است چون آن‌جا جنسیت فقط در
   * زمانِ گذشته صرف می‌شود. ⚠️ صریح نوشته شده و وجودش هم ادعا دارد: نسخه‌ی اولِ همین
   * بلوک `genero` را در هر سه زبان می‌گشت، برای روسی `undefined` می‌گرفت و همه‌ی
   * جمله‌ها را «بی‌ایراد» می‌دید. اگر فقط نمونه‌ی منفی داشتم، **سبزِ دروغین** می‌داد. */
  const DEFECT_ID = { ru: 'genderedPast', es: 'genero', pt: 'genero' };
  const CASES = {
    ru: [
      ['Ты получил то, что просил.', true],
      ['Ты спрашивал об этом раньше.', true],
      ['Ты застряла на одном месте.', true],
      ['Тебе казалось, что всё решено.', false],
      ['У тебя не получалось отпустить.', false],
      ['Тебя не отпускало это чувство.', false],
      ['Вы оба ждали слишком долго.', false],
    ],
    es: [
      // سه‌تای اول عیناً از خروجیِ دورهای واقعی
      ['Ahora te tiene trabado en el mismo punto.', true],
      ['Hace meses que estás quieto ahí.', true],
      ['Antes te sentías estancada con eso.', true],
      ['Ya te has ocupado de todo sin ayuda.', true],
      ['Estás sosteniendo sola la esperanza.', true],
      ['Eres rápido para decidir.', true],           // بعد از فعلِ ربطی = صفت
      ['Estás demasiado cansado para insistir.', true],
      // دو موردِ زیر ایرادهای **کاذبِ** واقعیِ همان دور بودند
      ['Ese vínculo te cobra demasiado.', false],
      ['Puedes abrir ingresos rápido.', false],       // بعد از فعلِ غیرربطی = قید
      ['Sales seguido con esa persona.', false],
      ['Tienes un buen resultado por delante.', false],
      ['Esa persona está cansada de esperar.', false],
      /* ⚠️ کلاسِ کاذبِ سومِ اسپانیایی، از دورِ ۱۴۰۵/۰۶/۱۰ و **عیناً** از خروجیِ واقعی:
       * کمّی‌ساز با **اسمِ بعدش** می‌خواند، نه با خواننده. `demasiada` مؤنث است چون
       * `energía` مؤنث است؛ هیچ چیزی درباره‌ی جنسیتِ مخاطب نمی‌گوید. */
      ['Estás poniendo demasiada energía en eso.', false],
      /* و ادعای معکوس: خودِ صفتِ جنسیت‌دار بعد از همان ساختار باید همچنان گرفته شود،
       * وگرنه «رفعِ ایرادِ کاذب» بی‌صدا به یک **منفیِ کاذب** تبدیل می‌شود. */
      ['Te habían dejado sola con todo.', true],
    ],
    pt: [
      ['Você tá carregando muita coisa sozinha.', true],   // از خروجیِ دورِ واقعی
      ['Você está cansada disso.', true],
      ['Você se sente perdido no meio.', true],
      ['Isso te deixa cansado.', true],
      ['Você já está preparada pra isso.', true],
      ['Esse trabalho te paga rápido.', false],            // همان کلاسِ کاذبِ اسپانیایی
      ['Você resolve rápido quando quer.', false],
      ['Você tem um bom resultado pela frente.', false],
      ['A outra pessoa está cansada de esperar.', false],
    ],
  };
  for (const [lang, cases] of Object.entries(CASES)) {
    // ⚠️ از **خودِ مسیرِ محصول** خوانده می‌شود (`repair.js` → `DEFECTS`)، نه با
    // کامپایلِ دوباره‌ی الگو در همین فایل. یک کپیِ محلی دقیقاً همان drift ای را
    // می‌سازد که این چک قرار است جلویش را بگیرد.
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { DEFECTS } = await import('${new URL('repair.js', DIR).pathname}');
      const g = DEFECTS.find(d => d.id === '${DEFECT_ID[lang]}');
      if (!g) { console.log('MISSING'); process.exit(0); }
      const cases = ${JSON.stringify(cases)};
      console.log(JSON.stringify(cases.map(([t]) => !!(g && g.find(t)))));
    `], { encoding: 'utf8', env: { ...process.env, LOCALE: lang } });
    let got = [];
    try { got = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
    const wrong = cases.filter((c, i) => got[i] !== c[1]).map(c => `«${c[0]}» ${c[1] ? 'گرفته نشد' : 'ایرادِ کاذب'}`);
    ok(!/MISSING/.test(r.stdout), `ضعفِ «${DEFECT_ID[lang]}» در langdata.${lang} وجود دارد`);
    ok(got.length === cases.length && wrong.length === 0,
      `گاردِ جنسیتِ «${lang}» هر ${cases.length} جمله را درست تصمیم می‌گیرد` +
      (wrong.length ? ` — ${wrong.join(' | ')}` : got.length ? '' : ' (اجرا نشد)'));
  }
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ دادهٔ زبانی: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
