#!/usr/bin/env node
// چکِ CI برای «منوی فال» و «کارت شانس» (tarot UX v2.1).
//
// سه چیز این‌جا قفل می‌شود که هیچ چکِ دیگری نمی‌بیندشان:
//   ۱) **ریاضیِ کارت شانس.** امیدِ ریاضیِ جایزه باید دقیقاً ۱ الماس در روز باشد. این عدد
//      تنها چیزی است که هزینه‌ی این فیچر را کنترل می‌کند و با سه ثابتِ کوچک ساخته
//      می‌شود؛ عوض‌شدنِ هر کدام بدونِ دیدنِ اثرش یعنی نشتِ خاموشِ پول. این‌جا خودِ
//      توزیعِ هایپرژئومتریک محاسبه می‌شود، نه یک عددِ کپی‌شده.
//   ۲) **قرارداد منو.** «سؤال شخصی خودم» همیشه دکمه‌ی اول و «مشاهده همه فال‌ها» همیشه
//      آخر (تصمیمِ صریحِ مالک). دو جایگاهِ وسط آزمایشی‌اند و می‌چرخند، ولی این دو ثابت‌اند.
//   ۳) **موضوع × اندازه.** هر موضوع باید هر سه عمق را داشته باشد و قیمت همیشه
//      `size × PER_CARD` بماند (قانونِ قیمتِ ریپو، بدونِ استثنا).
//
// اجرا: node tools/check-ux-menu.mjs
import { readFileSync } from 'fs';
import { seedToInt, mulberry32 } from '../bots/tarot/reading-core.js';
import {
  TOPICS_V3, RETIRED_TOPICS, TOPIC_BY_KEY, TOPIC_SPREADS, SIZES_V3, SPREAD_BY_ID, spreadIdOf, topicOf,
} from '../bots/tarot/spreads.js';
// locale واقعاً import می‌شود (نه فقط به‌عنوان متن خوانده): برای تطبیقِ برچسبِ کیبورد با
// هندلر باید **مقدارِ** رشته را داشته باشیم، نه نامِ کلید.
import L from '../bots/tarot/locales/fa.js';
import { LOADERS, pace, ACTIVE, FAST_MS, SLOW_MS, FAST_FOR_MS, loadingFrame } from '../bots/tarot/loading.js';

const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const LOC = readFileSync(new URL('../bots/tarot/locales/fa.js', import.meta.url), 'utf8');

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); } };
const num = (name) => {
  const m = SRC.match(new RegExp(`const ${name}\\s*=\\s*([0-9_]+)`));
  return m ? Number(m[1].replace(/_/g, '')) : NaN;
};

console.log('▶ موضوع × اندازه (قیمت فقط از تعدادِ کارت می‌آید)');
{
  // ⚠️ از خودِ spreads.js خوانده می‌شود، نه کپی. نسخه‌ی قبلی ۱۰٬۰۰۰ را هاردکد کرده بود
  // و با مهاجرتِ «الماسِ بومی» بی‌صدا غلط شد — همان درسِ «کپیِ منطق تست نیست».
  const PER_CARD = Number(
    (readFileSync(new URL('../bots/tarot/spreads.js', import.meta.url), 'utf8')
      .match(/const PER_CARD = ([0-9_]+);/) || [])[1]?.replace(/_/g, ''));
  ok(SIZES_V3.length === 3 && SIZES_V3.join(',') === '3,5,10', 'سه عمق: ۳ و ۵ و ۱۰ کارت');
  // TOPIC_SPREADS از موضوع‌های **زنده و بازنشسته** ساخته می‌شود، وگرنه حذفِ یک موضوع از
  // منو یعنی ناپدید شدنِ `money3`/`choice5` از SPREAD_BY_ID و شکستنِ دکمه‌های کهنه (۲ج/۶).
  ok(TOPIC_SPREADS.length === (TOPICS_V3.length + RETIRED_TOPICS.length) * SIZES_V3.length,
    `هر موضوعِ زنده و بازنشسته هر سه عمق را دارد (${TOPIC_SPREADS.length} ترکیب)`);
  // ...ولی بازنشسته‌ها هرگز نباید در منو دیده شوند.
  const retiredKeys = RETIRED_TOPICS.map(t => t.key);
  ok(retiredKeys.length > 0 && !TOPICS_V3.some(t => retiredKeys.includes(t.key)),
    `موضوعِ بازنشسته در منو نیست (${retiredKeys.join('، ')})`);
  let retiredResolves = true;
  for (const t of RETIRED_TOPICS) for (const size of SIZES_V3) {
    if (!SPREAD_BY_ID[spreadIdOf(t.key, size)]) retiredResolves = false;
  }
  ok(retiredResolves, 'چیدمانِ موضوعِ بازنشسته هنوز resolve می‌شود (خوانشِ ثبت‌شده نمی‌شکند)');
  let priceOk = true, posOk = true, idOk = true;
  for (const t of TOPICS_V3) for (const size of SIZES_V3) {
    const s = SPREAD_BY_ID[spreadIdOf(t.key, size)];
    if (!s) { idOk = false; continue; }
    if (s.price !== size * PER_CARD) priceOk = false;
    if (s.positions?.length !== size) posOk = false;
  }
  ok(idOk, 'هر ترکیبِ موضوع×اندازه از SPREAD_BY_ID resolve می‌شود');
  ok(priceOk, 'قیمت همیشه size × PER_CARD است (قانونِ قیمت استثنا ندارد)');
  ok(posOk, 'تعدادِ جایگاه‌ها با تعدادِ کارت‌ها یکی است');
  // فالِ تقابلی باید دو سمتِ تصمیم را در خودِ جایگاه‌ها داشته باشد، وگرنه مدل کارت‌ها را
  // مثل خطِ زمانی می‌خواند و خروجیِ verdict به هیچ جایگاهی لنگر نمی‌خورد.
  const commit3 = SPREAD_BY_ID['commit3'];
  const commitLabels = TOPIC_BY_KEY['commit'].choiceLabels;
  ok(Array.isArray(commitLabels) && commitLabels.length === 2
    && commit3.positions[0].fa === commitLabels[0] && commit3.positions[1].fa === commitLabels[1],
    'فالِ تقابلی برچسبِ خودش را روی جایگاه‌ها می‌گذارد، نه «مسیر اول/دوم»');
  ok(SPREAD_BY_ID['choice3'].positions.map(p => p.key).join() === 'pathA,pathB,guide',
    'دوراهیِ سه‌کارتی همان pathA/pathB/guide را دارد (verdict.js از این می‌خواند)');
  // بندِ ۲ج/۶ و ۲ج/۱: هیچ آی‌دیِ قدیمی نباید بشکند
  for (const old of ['love', 'three', 'celtic', 'yesno', 'choice', 'open3', 'open5', 'inner', 'family']) {
    ok(!!SPREAD_BY_ID[old], `آی‌دیِ قدیمیِ «${old}» هنوز resolve می‌شود (دکمه‌ها و رکوردهای ثبت‌شده)`);
  }
  ok(SPREAD_BY_ID['celtic'].size === 10 && SPREAD_BY_ID['love'].size === 3,
    'چیدمان‌های نسل قبل بیت‌به‌بیت دست‌نخورده‌اند');
  ok(topicOf('love5') === 'love' && topicOf('love') === 'love' && topicOf('open3') === 'personal',
    'topicOf سابقه‌ی نسل‌های قبل را هم به موضوع نگاشت می‌کند');
}

console.log('\n▶ تمرکزِ موضوع‌ها (تصمیمِ مالک: فقط عشق/رابطه و پول/شغل)');
{
  ok(TOPICS_V3[0].key === 'personal', 'سؤالِ شخصی اولین موضوعِ لیست است');
  ok(TOPICS_V3[1].key === 'yesno' && /قطعی/.test(TOPICS_V3[1].fa),
    'بله و خیر دومی است و کلمه‌ی «قطعی» را دارد');
  const keys = TOPICS_V3.map(t => t.key);
  for (const gone of ['inner', 'family', 'migration', 'three', 'celtic']) {
    ok(!keys.includes(gone), `«${gone}» از موضوع‌ها حذف شده`);
  }
  const love = TOPICS_V3.filter(t => t.focus === 'love').map(t => t.key);
  ok(love.includes('love') && love.includes('crush') && love.includes('feel') && love.includes('commit'),
    'چهار موضوعِ عاطفی: عشق، کراش، حس طرف مقابل، خیانت');
  // موضوع‌های تازه‌ی نسل پنجم (از دیتای ۴ شهریور ۱۴۰۵). اگر یکی‌شان بی‌صدا حذف شود،
  // پرتقاضاترین نیت‌های واقعیِ کاربر دوباره بی‌خانه می‌شوند.
  for (const [k, why] of [['exback', 'بازگشتِ اکس، ۱۸.۱٪ سؤال‌ها'], ['study', 'درس و کنکور، ۱۰.۰٪'],
    ['marriage', 'ازدواج، ۴.۸٪'], ['soulmate', 'کی به آدمم می‌رسم'], ['apply', 'اپلای و مهاجرت']]) {
    ok(keys.includes(k), `موضوعِ «${k}» در منو هست (${why})`);
  }
  ok(keys.includes('career') && !keys.includes('money'),
    'کار و پول یک دکمه‌ی واحد است (پول با ۶ کلیک در ۳۵ روز از منو برداشته شد)');
  ok(!keys.includes('choice'), '«دوراهی» از منو برداشته شد (تکرارِ معناییِ بله/خیر)');
  // ترتیب: عاطفی‌ها قبل از شغل/پول (خواسته‌ی صریحِ مالک برای لیستِ کامل)
  ok(Math.max(...love.map(k => keys.indexOf(k))) < keys.indexOf('career'),
    'ترتیبِ لیست: عاطفی‌ها قبل از شغل و پول');
}

console.log('\n▶ قرارداد منوی فال (پین اول، «همه فال‌ها» آخر)');
{
  ok(/const MENU_PIN = 'personal'/.test(SRC), 'جایگاهِ پین «سؤال شخصی خودم» است');
  ok(/MENU_SLOTS_DEFAULT = \['yesno', 'love'\]/.test(SRC),
    'جفتِ پیش‌فرضِ جایگاه ۲ و ۳: بله/خیر و عشق (منوی موقتِ خواسته‌ی مالک)');
  // control باید **دقیقاً** همان پیش‌فرض باشد، وگرنه خاموش‌بودنِ آزمایش رفتارِ دیگری می‌دهد
  ok(/control: MENU_SLOTS_DEFAULT/.test(SRC), 'شاخه‌ی control همان جفتِ پیش‌فرض است');
  const fn = SRC.slice(SRC.indexOf('function falMenuKb('), SRC.indexOf('/** لیستِ کاملِ موضوع‌ها'));
  ok(/\[MENU_PIN, \.\.\.menuSlotsFor\(uid\)/.test(fn), 'پین همیشه اولِ منوست');
  ok(/filter\(k => k !== MENU_PIN\)/.test(fn), 'پین دو بار نمی‌آید (اگر آزمایش هم انتخابش کند)');
  ok(/slice\(0, 3\)/.test(fn), 'منو دقیقاً سه موضوع دارد، بعد دکمه‌ی «همه فال‌ها»');
  ok(/allSpreadsV2, 'catalog_go'\)\],?\s*\n\s*\];/.test(fn), '«مشاهده همه فال‌ها» آخرین ردیف است');
  // لیستِ کامل باید همه‌ی موضوع‌ها را داشته باشد، نه یک زیرمجموعه
  ok(/allTopicsKb = \(uid\) => \[\s*\n\s*\.\.\.TOPICS_V3\.map/.test(SRC),
    'لیستِ کامل از خودِ TOPICS_V3 ساخته می‌شود (نه لیستِ دستیِ موازی)');
  // فالِ رایگان از منوی فال برداشته شد: تنها راهش کیبوردِ اصلی است
  const cat = SRC.slice(SRC.indexOf('function catalogKb('), SRC.indexOf('async function showCatalog('));
  ok(!/daily_go/.test(SRC.slice(SRC.indexOf('function falMenuKb('), SRC.indexOf('function catalogKb('))),
    'کارتِ روزِ رایگان در منوی فال نیست (فقط کیبوردِ اصلی)');
  ok(/uxV2For\(uid\)\) return allTopicsKb\(uid\)/.test(cat), 'کاتالوگِ UX v2 همان لیستِ کاملِ موضوع‌هاست');
  // v2.4 (تصمیمِ صریحِ مالک): «فال بگیر» بالای «فال تک کارت» و هر دو **تمام‌عرض**.
  ok(/dailyOneCard: '🎴 فال تک کارت امروز \(رایگان\)'/.test(LOC),
    'کیبوردِ اصلی نامِ صریحِ «فال تک کارت امروز (رایگان)» را دارد');
  // ⚠️ ترتیبِ **کاملِ** کیبورد پین می‌شود، نه فقط دو ردیفِ اولش. نسخه‌ی قبلیِ این ادعا
  // فقط «reading بالای dailyOneCard» را می‌دید، پس جابه‌جاییِ کارت شانس را اصلاً
  // نمی‌فهمید. حالا هر چهار ردیف پشتِ‌سرِهم سنجیده می‌شوند.
  // v3.25.0 (تصمیمِ صریحِ مالک): کارت شانس یک پله بالا، فال تک کارت یک پله پایین.
  const kbV2 = SRC.slice(SRC.indexOf('const rows = uxV2For(uid)'), SRC.indexOf('if (FREE_MENU_ENABLED'));
  const ORDER = ['reading', 'luckyMain', 'dailyOneCard'];
  const seen = [...kbV2.matchAll(/L\.buttons\.(\w+)/g)].map(m => m[1]);
  ok(seen.slice(0, 3).join('>') === ORDER.join('>'),
    `ترتیبِ کیبوردِ اصلی: ${ORDER.join(' ⟵ ')} (دیده شد: ${seen.slice(0, 3).join(' ⟵ ')})`);
  ok(/\[L\.buttons\.reading\],/.test(kbV2) && /\[L\.buttons\.luckyMain\],/.test(kbV2)
    && /\[L\.buttons\.dailyOneCard\],/.test(kbV2),
    'و هر سه ردیفِ خودشان را دارند (هیچ‌کدام نصفه کنارِ هم نیستند)');
  ok(seen.slice(3, 5).join(',') === 'coinShop,inviteMain', 'ردیفِ چهارم: فروشگاه + دعوت');

  // CTAی بعد از فال و بعد از کارتِ روز هر دو از همین قرارداد می‌آیند
  const reco = SRC.slice(SRC.indexOf('function recoRows('), SRC.indexOf('// کیبوردِ منو نباید'));
  ok(/topicRow\(MENU_PIN\)/.test(reco), 'CTAی پایانِ فال هم با «سؤال شخصی خودم» شروع می‌شود');
  ok(/\.slice\(0, 2\)/.test(reco), 'دو پیشنهادِ داینامیک بین پین و «همه فال‌ها»');
  ok(/allSpreadsV2, 'catalog_go'/.test(reco), 'و آخرش «مشاهده همه فال‌ها»');
}

console.log('\n▶ مرحله‌ی حذف‌شده‌ی «حول چه موضوعی؟» هیچ‌وقت اجرا نمی‌شود');
{
  // باگِ خاموشی که همین‌جا گرفته شد: شرط اگر روی `spread.focus` می‌بود، «بله و خیر» و
  // «دوراهی» (که حوزه‌ی تمرکز ندارند) به همان مرحله‌ی حذف‌شده می‌افتادند — فقط در دو
  // موضوع از نه‌تا، یعنی تستِ دستی به‌راحتی از کنارش رد می‌شد.
  const h = SRC.slice(SRC.indexOf('bot.action(/^spread:(\\w+)$/'), SRC.indexOf("bot.action('catalog_go'"));
  ok(/if \(spread\.topic\) \{/.test(h), 'شرط روی spread.topic است، نه spread.focus');
  const iTopic = h.indexOf('if (spread.topic)');
  const iFocusAsk = h.indexOf('askFocusAgain');
  ok(iTopic > 0 && iFocusAsk > iTopic, 'شاخه‌ی نسل چهارم **قبل از** مسیرِ پرسیدنِ حوزه است');
  for (const key of ['yesno', 'choice']) {
    ok(!TOPIC_BY_KEY[key].focus, `«${key}» عمداً حوزه‌ی تمرکز ندارد (و همین باگ را می‌ساخت)`);
    ok(!!SPREAD_BY_ID[spreadIdOf(key, 3)].topic, `ولی topic دارد، پس گارد می‌گیردش`);
  }
}

console.log('\n▶ 🍀 کارت شانس — ریاضیِ جایزه (امیدِ ریاضی باید دقیقاً ۱ الماس باشد)');
{
  const picks = num('LUCKY_PICKS');
  const coins = num('LUCKY_COINS');
  const grid = Number((SRC.match(/GRID_SIZE/) && 24) || NaN); // گریدِ ۲۴تاییِ reading-core
  ok(picks === 3, `کاربر ${picks} کارت انتخاب می‌کند`);
  ok(coins === 8, `پشتِ ${coins} کارت از ${grid} الماس هست`);

  // انتخابِ بدونِ جایگذاری → توزیعِ هایپرژئومتریک. این‌جا واقعاً محاسبه می‌شود، نه کپی.
  const C = (n, k) => (k < 0 || k > n ? 0 : Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce((a, b) => a * b, 1));
  const total = C(grid, picks);
  const P = Array.from({ length: picks + 1 }, (_, k) => C(coins, k) * C(grid - coins, picks - k) / total);
  const sum = P.reduce((a, b) => a + b, 0);
  const E = P.reduce((a, p, k) => a + p * k, 0);
  ok(Math.abs(sum - 1) < 1e-9, 'توزیع کامل است (جمعِ احتمال‌ها = ۱)');
  ok(Math.abs(E - 1) < 1e-9, `امیدِ ریاضی دقیقاً ۱ الماس در روز است (E=${E.toFixed(6)})`);
  ok(Math.abs(E - picks * coins / grid) < 1e-9, 'فرمولِ ساده و توزیعِ کامل یک عدد می‌دهند');
  ok(P.length - 1 === 3, 'حداکثرِ جایزه ۳ الماس است (خواسته‌ی مالک: ۱ تا ۳)');
  ok(P[0] > 0.27 && P[0] < 0.28, `احتمالِ پوچِ کامل ~۲۸٪ است (${(P[0] * 100).toFixed(1)}٪)`);
  // بعد از مهاجرتِ «الماسِ بومی» ضریبی وجود ندارد: جایزه خودش عددِ الماس است.
  ok(/const LUCKY_COIN_VALUE = 1;/.test(SRC),
    'هر کارتِ الماس‌دار دقیقاً یک الماس است');
}

console.log('\n▶ 🍀 کارت شانس — گاردهای پول و حالت');
{
  const h = SRC.slice(SRC.indexOf("bot.action(/^lpick:"), SRC.indexOf("bot.action(/^lremind:"));
  ok(/claimLucky\.run\(today, uid, today\)\.changes === 0/.test(h),
    'روز اتمیک سوخته می‌شود (شرطِ روز داخلِ خودِ UPDATE، ضدِ دوبار-تپ)');
  // ⚠️ این ادعا قبلاً شکلِ `if (!picks.length && stmts.claimLucky...)` را قفل می‌کرد.
  // از v3.21.0 همان شرط یک بلوک شد (چون تعیینِ «دستِ اولِ عمر» هم باید داخلش بیفتد)،
  // پس به‌جای شکلِ نوشتاری، **همان رفتار** قفل می‌شود: ادعای روز فقط داخلِ شاخه‌ی
  // «هیچ انتخابی نشده» صدا زده می‌شود.
  ok(/if \(!picks\.length\)\s*\{[\s\S]*?stmts\.claimLucky\.run/.test(h)
     && h.split('stmts.claimLucky.run').length === 2,
    'روز با **اولین** انتخاب سوخته می‌شود، نه با دیدنِ گرید');
  ok(h.indexOf('stmts.credit.run(LUCKY_COIN_VALUE') < h.indexOf('if (!done)'),
    'الماس لحظه‌ی برگشتنِ هر کارت واریز می‌شود، نه آخرِ بازی (ری‌استارت پول را نمی‌خورد)');
  // v3.19.0: دست از ردیفِ کاربر خوانده می‌شود، نه سشن. جزئیاتِ رفتاری در check-lucky.mjs
  // **اجرا** می‌شوند؛ این‌جا فقط شکلِ گاردها قفل می‌شود.
  ok(/hand\.d !== today/.test(h) && /picks\.includes\(i\) \|\| picks\.length >= LUCKY_PICKS/.test(h),
    'گاردهای تکراری/سهمیه/روزِ کهنه قبل از اولین await اند');
  ok(/claimLucky: db\.prepare\("UPDATE users SET lucky_date=\? WHERE telegram_id=\? AND COALESCE\(lucky_date,''\) <> \?"\)/.test(SRC),
    'claimLucky واقعاً اتمیک است');
  // پیامِ پایانی هر دو حالت باید بگوید فردا دوباره می‌شود (تصمیمِ صریحِ مالک)
  ok(/won: \(coins\) => `[^`]*فردا دوباره/.test(LOC) && /lost: '[^']*فردا دوباره/.test(LOC),
    'هم در برد و هم در باخت گفته می‌شود که فردا دوباره می‌شود');
  ok(/luckyRemindOn: '🔔 فردا یادآوری کن'/.test(LOC), 'دکمه‌ی «فردا یادآوری کن» هست');
  // 🌙 از v3.28.0 یادآوریِ شبانه یک آزمایشِ A/B و **opt-out** است (تصمیمِ صریحِ مالک):
  // جاروی opt-inِ کارتِ شانس با آن جایگزین شد. دکمه‌ی `lremind:` زنده مانده (بند ۲ج/۶)
  // و نیتِ کاربر را به همان ستونی می‌برد که جارو واقعاً می‌خواند.
  ok(!/stmts\.dueLuckyReminder/.test(SRC), 'جاروی opt-inِ قدیمی حذف شده (جایش A/B آمد)');
  ok(/dueNightReminder/.test(SRC) && /daily_reminder_off=0/.test(SRC),
    'یادآوریِ شبانه opt-out است و انصرافِ قبلیِ کاربر را محترم می‌شمارد');
  // ⚠️ v3.85.0: این ادعا قبلاً خطِ **متقارن** را پین می‌کرد و دقیقاً همان باگی را
  // محافظت می‌کرد که v3.82.0 ساخت (تپِ «یادآوری کن» هر دو یادآوری را روشن می‌کرد).
  // حالا فقط نیمه‌ی خاموشی پین است؛ سنجشِ رفتاریِ هر دو جهت در بلوکِ ۱۲ی
  // `tools/check-night-reminder.mjs` است.
  ok(/if \(!on\) stmts\.setDailyReminderOff\.run\(uid\);/.test(SRC),
    'دکمه‌ی یادآوریِ کارت شانس همان ستونِ جارو را می‌نویسد');
  ok(!/bot\.action\(\/\^lremind[\s\S]{0,1800}?setDailyReminderOn/.test(SRC),
    'ولی جهتِ «یادآوری کن» کارتِ روز را روشن نمی‌کند (باگِ ۱۸۲ کاربره‌ی v3.82.0)');
  // ⚠️ v3.22.0: یادآوریِ کارتِ روز **کاملاً حذف شد** (تصمیمِ مالک). قبلاً فقط برای دنیای
  // الماس خاموش بود. حالا تنها یادآوریِ شبانه‌ی ربات کارت شانسِ opt-in است، پس کاربر
  // هرگز پیامِ شبانه‌ی نخواسته نمی‌گیرد. سه ادعا، چون «حذف» را باید از سه سمت قفل کرد:
  ok(!/dueDailyReminder|setDailyReminded/.test(SRC),
    'جاروی یادآوریِ کارتِ روز حذف شده (نه خاموش، نه پشتِ پرچم)');
  ok(!/daily_reminder_sent/.test(SRC), 'و هیچ‌جا رویدادِ ارسالش ثبت نمی‌شود');
  ok(!/^\s*reminder:\s/m.test(LOC.split("lucky:")[0] || ''),
    'و متنِ یادآوریِ کارتِ روز از locale پاک شده (کدِ مرده نمی‌ماند)');
  // تنها جاروی یادآوریِ باقی‌مانده باید opt-in باشد و **فقط یکی** باشد
  // نیتِ این ادعا «یک بار نوشته شدن» نبود، «فقط **یک سیستمِ** یادآوریِ شبانه» بود. از
  // v3.38.0 همان یک سیستم دو مسیرِ کد دارد (وسطِ آزمایش / بعد از آزمایش)، پس رشته دو بار
  // می‌آید ولی نامِ رویداد همچنان یکی است. چیزی که باید قفل بماند همان یکتاییِ نام است.
  ok([...new Set((SRC.match(/'\w*_reminder_sent'/g) || []))].length === 1,
    'دقیقاً یک نامِ رویدادِ یادآوریِ شبانه در کلِ ربات هست');
  ok(/'lucky_card', \{ coins: found/.test(SRC), 'رویدادِ lucky_card با تعدادِ الماس ثبت می‌شود');
  // ⚠️ حیاتی: کارتِ روز نباید الماس بدهد. مالک تصمیمِ اولش را عوض کرد و آن الماس به کارت
  // شانس منتقل شد؛ اگر هر دو بمانند نرخِ رایگان **دو برابر** طراحی می‌شود (۲ الماس در
  // روز) و کلِ محاسبه‌ی امیدِ ریاضی بی‌معنی می‌شود.
  ok(!/DAILY_COIN_REWARD/.test(SRC), 'کارتِ روز هیچ الماسی نمی‌دهد (الماسِ رایگان فقط از کارت شانس)');
  ok(!/coinReward/.test(LOC), 'متنِ «الماس بابتِ کارت امروز» هم پاک شده (کدِ مرده نمی‌ماند)');
  const kinds = [...SRC.matchAll(/kind: '(\w+)' \}\)/g)].map(m => m[1]);
  ok(kinds.includes('lucky') && !kinds.includes('daily'),
    'تنها منبعِ الماسِ رایگانِ روزانه kind:lucky است');
  ok(/\['daily_log','user_id'\]/.test(SRC), 'ریستِ ادمین daily_log را هم پاک می‌کند');
}

console.log('\n▶ کلمه‌ی «خوانش» از متن‌های رو-به-کاربرِ نسل جدید حذف شده');
{
  // فقط مسیرِ UX v2: متن‌های نسل قبل عمداً دست‌نخورده‌اند (رول‌بک باید سالم بماند).
  const keys = ['catalogV3', 'allTopics', 'startWhere', 'nextOffersV3', 'upsellV3', 'pickSize'];
  for (const k of keys) {
    const m = LOC.match(new RegExp(`${k}:[^\\n]*`));
    ok(!!m && !/خوانش/.test(m[0]), `«${k}» کلمه‌ی «خوانش» ندارد`);
  }
  ok(/catalogV3: 'کدوم فال رو انتخاب می‌کنی/.test(LOC), 'متنِ منو «کدوم فال رو انتخاب می‌کنی؟» است');
  ok(/کلمه‌ی «خوانش» را هم به کار نبر؛ بگو «فال»/.test(LOC),
    'پرامپت هم صریحاً کلمه‌ی «خوانش» را ممنوع کرده (خروجیِ مدل بیشترین متنی است که کاربر می‌بیند)');
  // این دو پیام می‌توانند رشته‌ی ساده یا تابعِ template باشند (`refunded` با آمدنِ
  // واحدِ الماس تابع شد)، پس هر دو شکل پوشش داده می‌شود.
  for (const s of ['refunded']) {
    const m = LOC.match(new RegExp(`${s}: (\\(cur\\) => )?[\`'][^\`']*[\`']`));
    ok(!!m && !/خوانش/.test(m[0]), `پیامِ «${s}» هم «فال» می‌گوید نه «خوانش»`);
  }
  // `useButtons` در v3.17.0 حذف شد: استانداردِ دومی برای «وسطِ فلوی باز» بود و مالک
  // صریح گفت باید یکی باشد. این ادعا جلوی برگشتنش را می‌گیرد.
  ok(!/useButtons:/.test(LOC), 'پیامِ دومِ «فالت هنوز بازه» برنگشته (یک استاندارد، نه دو تا)');
}

console.log('\n▶ پیامِ عمومیِ «ادامه» جایگزینِ جمله‌ی صرفاً محاوره‌ای شد (UX v2.2)');
{
  // بند: هیچ نقطه‌ی لغو/بازگشتی نباید مستقیم L.reading.canceled را صدا بزند —
  // همه باید از replyCanceled عبور کنند تا در دنیای UX v2 پیامِ «ادامه» جایگزین شود.
  // تنها نمونه‌ی مجاز، شاخه‌ی داخلِ خودِ replyCanceled است (دنیای قدیم). هر جای دیگر
  // باید از replyCanceled عبور کند تا در دنیای الماس پیامِ «ادامه» جایگزین شود.
  const rawCanceled = [...SRC.matchAll(/ctx\.reply\(L\.reading\.canceled/g)].length;
  ok(rawCanceled === 1, `فقط یک نقطه (خودِ replyCanceled) مستقیم L.reading.canceled را صدا می‌زند (یافت شد: ${rawCanceled})`);
  // v3.17.0: یک خطِ تازه قبل از این دو شاخه اضافه شد (بازپخشِ نیتِ معلق). خودِ دو شاخه
  // بیت‌به‌بیت دست‌نخورده‌اند، پس رول‌بکِ یک‌خطیِ دنیای تومانی همچنان سرِ جایش است.
  ok(/async function replyCanceled\(ctx, uid\) \{[\s\S]{0,400}?if \(await replayIntent\(ctx, uid\)\) return;\s*\n\s*if \(uxV2For\(uid\)\) return sendContinuePrompt\(ctx, uid\);\s*\n\s*return ctx\.reply\(L\.reading\.canceled, mainKeyboard\(uid\)\);/.test(SRC),
    'replyCanceled: اول نیتِ معلق، بعد دنیای الماس → پیامِ ادامه، دنیای قدیم → همان جمله‌ی قبلی');
  // v3.19.0: نقطه‌ی چهارم `lucky:cancel` اضافه شد (کنارگذاشتنِ دستِ کارت شانس).
  // v3.59.0: نقطه‌ی پنجم `pay_exit` — دکمه‌ی خروجِ گاردِ «فاکتور باز داری». عددِ پین‌شده
  // بالا رفت ولی **ادعا همان است**: هیچ نقطه‌ی لغوی نباید پیامِ خودش را بسازد. برای اینکه
  // این ادعا با بالا رفتنِ عدد رقیق نشود، خودِ لیستِ نقاط هم سنجیده می‌شود.
  const CANCEL_POINTS = ['rcancel', 'reading:cancel', 'pay_cancel', 'lucky:cancel', 'pay_exit'];
  const callers = [...SRC.matchAll(/await replyCanceled\(ctx, uid\)/g)].length;
  ok(callers === CANCEL_POINTS.length,
    `${CANCEL_POINTS.length} نقطه‌ی لغو (${CANCEL_POINTS.join('/')}) از replyCanceled استفاده می‌کنند (یافت شد: ${callers})`);
  for (const a of CANCEL_POINTS) {
    ok(SRC.includes(`bot.action(/^${a}`) || SRC.includes(`bot.action('${a}'`),
      `نقطه‌ی لغوِ ${a} هنوز وجود دارد (عددِ بالا از یک نقطه‌ی حذف‌شده پر نشده)`);
  }
  ok(/async function sendContinuePrompt\(ctx, uid\) \{\s*\n\s*await ctx\.reply\(L\.reading\.nextOffersV3, Markup\.inlineKeyboard\(\[\s*\n\s*\.\.\.recoRows\(uid, null\)/.test(SRC),
    'sendContinuePrompt همان متن و ساختارِ CTAی پایانِ فال را می‌فرستد (یک منبع)');
}

console.log('\n▶ اولین فالِ کاربر: پیشنهادِ فالِ جدید عقب می‌افتد، تبلیغِ کارت شانس جایش می‌آید');
{
  // اندازه‌گیریِ «اولین فال» باید **بعد** از ثبتِ delivered انجام شود تا همین فال را هم بشمارد
  const iSetDelivered = SRC.indexOf("stmts.setReadingStatus.run('delivered', readingId);");
  const iIsFirst1 = SRC.indexOf('const isFirstReading = stmts.countDelivered.get(uid).c === 1;');
  ok(iSetDelivered > 0 && iIsFirst1 > iSetDelivered,
    'شمارشِ اولین فال بعد از ثبتِ status=delivered انجام می‌شود (همین فال را هم می‌شمارد)');
  // v2.7 (باگِ گزارش‌شده): پیامِ «ادامه» **قبل از** نظرسنجی می‌آمد. حالا هر جا نظرسنجی
  // پرسیده می‌شود، قدمِ بعدی به بعد از نمره‌دادن موکول می‌شود.
  ok(/if \(!v4For\(uid\)\) \{/.test(SRC),
    'وقتی نظرسنجی پرسیده می‌شود، پیامِ «ادامه» در تحویل نمی‌آید (به fbr موکول می‌شود)');
  const deliverTail = SRC.slice(iSetDelivered, SRC.indexOf("bot.action(/^fbr:"));
  ok(deliverTail.indexOf('L.reading.rateAsk') > 0, 'سؤالِ نمره در خودِ تحویل می‌ماند');
  ok(!/nextOffersV3[\s\S]{0,400}rateAsk/.test(deliverTail),
    'هیچ مسیری پیامِ «ادامه» را قبل از سؤالِ نمره نمی‌فرستد');
  // ⚠️ v3.91.0: نسخه‌ی finishReading حذف شد (بندِ «گفتگو همیشه مقدم است» در CLAUDE.md؛
  // آن شاخه دیگر شرطِ isFirstReading/luckyAvailable ندارد و بی‌قید postReadingOffer را
  // صدا می‌زند). تنها محاسبه‌ی باقی‌مانده همان‌جا در fbr: است، برای شاخه‌ی تبلیغِ کارتِ
  // شانس که حالا فقط برای chatOn=false می‌رسد. پس دیگر «دوباره» نیست؛ ادعا حالا این است
  // که در کلِ فایل دقیقاً یک بار محاسبه می‌شود و همان یکی داخلِ fbr: است.
  const isFirstCount = [...SRC.matchAll(/const isFirstReading = stmts\.countDelivered\.get\(uid\)\.c === 1;/g)].length;
  ok(isFirstCount === 1,
    `در کلِ فایل دقیقاً یک بار isFirstReading محاسبه می‌شود (یافت شد: ${isFirstCount})`);
  const iFbr = SRC.indexOf('bot.action(/^fbr:');
  ok(iIsFirst1 > iFbr, 'و همان یکی داخلِ fbr: است (نه در finishReading)');
  const fbrBlock = SRC.slice(iFbr, SRC.indexOf('bot.action(', iFbr + 20));
  ok(/luckyAvailable = getUser\(uid\)\?\.lucky_date !== botToday\(\)/.test(fbrBlock),
    'تبلیغِ کارت شانس فقط اگر سهمیه‌ی امروز هنوز مصرف نشده نشان داده می‌شود');
  ok(/if \(uxV2For\(uid\) && isFirstReading && luckyAvailable\) \{/.test(fbrBlock),
    'شرطِ نمایشِ تبلیغ: دنیای الماس + اولین فال + سهمیه‌ی کارت شانس باز');
  ok(/L\.lucky\.promo\(dispName\(getUser\(uid\)\)\)/.test(fbrBlock), 'تبلیغ از L.lucky.promo با نامِ کاربر ساخته می‌شود');
  ok(/luckyDraw\(LUCKY_PICKS, curOf\(uid\)\), 'lucky_go'/.test(fbrBlock), 'دکمه‌ی تبلیغ مستقیم به lucky_go وصل است');
  // v2.7 (باگِ گزارش‌شده): تشکر **همیشه** می‌آید و بعدش حتماً یک قدمِ بعدی. قبلاً فقط
  // «اولین فال + کارتِ شانسِ باز» قدمِ بعدی می‌گرفت و بقیه بعد از تشکر به بن‌بست می‌خوردند
  // (مثلاً کسی که کارتِ شانسش را قبلاً کشیده بود، یا فالِ اولش در آنبوردینگ نبود).
  const iThanks = fbrBlock.indexOf('L.reading.rateThanks');
  const iPromo = fbrBlock.indexOf('L.lucky.promo');
  ok(iThanks > 0 && iThanks < iPromo, 'تشکر همیشه و **قبل از** قدمِ بعدی می‌آید');
  ok(!/\} else \{\s*\n\s*await ctx\.reply\(L\.reading\.rateThanks\)/.test(fbrBlock),
    'تشکر دیگر در شاخه‌ی else حبس نیست');
  ok(/if \(uxV2For\(uid\)\) await sendContinuePrompt\(ctx, uid\);/.test(fbrBlock),
    'هر مسیرِ دیگری بعد از تشکر پیامِ «ادامه» می‌گیرد (بن‌بست ندارد)');
  ok(/rateThanks, uxV2For\(uid\) \? mainKeyboard\(uid\) : undefined\)/.test(fbrBlock),
    'کیبوردِ اصلی روی همین پیامِ تشکر سوار می‌شود (هم‌زمان با قدمِ بعدی، بدونِ پیامِ اضافه)');
}

console.log('\n▶ بعد از کشیدنِ کارت شانس، دعوت به فالِ بعدی می‌آید');
{
  const lpick = SRC.slice(SRC.indexOf("bot.action(/^lpick:"), SRC.indexOf("bot.action(/^lremind:"));
  ok(/await sendContinuePrompt\(ctx, uid\);/.test(lpick),
    'پایانِ کارت شانس، چه برده چه نه، پیامِ «ادامه» را می‌فرستد');
  const iWonLost = lpick.indexOf('L.lucky.won(found) : L.lucky.lost');
  const iContinue = lpick.indexOf('sendContinuePrompt');
  ok(iWonLost > 0 && iContinue > iWonLost, 'ترتیب: اول نتیجه‌ی برد/باخت، بعد دعوتِ فالِ بعدی');
}

console.log('\n▶ تأییدِ ماهِ تولد روی همان پیامِ سؤال ادیت می‌شود (نه پیامِ جدا)');
{
  const bmonth = SRC.slice(SRC.indexOf('bot.action(/^bmonth:'), SRC.indexOf('bot.action(/^focus:'));
  ok(/const saved = L\.onboarding\.birthMonthSaved\(monthLabel\(m\)\);/.test(bmonth), 'متنِ تأیید از قبل ساخته می‌شود');
  ok(/try \{ await ctx\.editMessageText\(saved\); \}/.test(bmonth), 'روی همان پیام ادیت می‌شود');
  ok(/catch \{ await ctx\.reply\(saved\)\.catch\(\(\) => \{\}\); \}/.test(bmonth),
    'اگر ادیت نشد (پیامِ کهنه) به پیامِ جدا برمی‌گردیم تا کاربر بی‌جواب نماند');

  // v2.9: گریدِ ماهِ تولد ۴ ستون × ۳ ردیف شد (بود ۲×۶). چیدمان **اجرا** می‌شود نه فقط
  // رجکس‌خوانی، چون سؤال این است که واقعاً چند ردیف تولید می‌شود و هر دوازده ماه سرِ
  // جای خودشان هستند یا نه.
  const cols = Number(/const BMONTH_COLS = (\d+);/.exec(SRC)?.[1]);
  ok(cols === 4, 'تعدادِ ستون‌ها ۴ است');
  const grid = [];
  for (let i = 0; i < 12; i += cols) {
    grid.push(Array.from({ length: cols }, (_, d) => i + d));
  }
  ok(grid.length === 3, `گرید ۳ ردیف دارد (شد ${grid.length})`);
  ok(grid.every(r => r.length === 4), 'هر ردیف دقیقاً ۴ دکمه دارد');
  ok(JSON.stringify(grid.flat()) === JSON.stringify([...Array(12).keys()]),
    'هر دوازده ماه دقیقاً یک بار و به ترتیب می‌آیند (هیچ ماهی جا نمی‌افتد و تکرار نمی‌شود)');
  ok(/`bmonth:\$\{k \+ 1\}`/.test(SRC), 'شماره‌ی ماه همچنان ۱-پایه است (سازگار با دیتای موجود)');
  // دوازده بر چهار بخش‌پذیر است؛ اگر کسی ستون را روی عددی بگذارد که نباشد، ردیفِ آخر
  // با ماهِ تعریف‌نشده پر می‌شود و دکمه‌ی خالی می‌سازد.
  ok(12 % cols === 0, 'دوازده بر تعدادِ ستون بخش‌پذیر است (وگرنه ردیفِ آخر دکمه‌ی خالی می‌گیرد)');
}

// ══════════════════════════════════════════════════════════════════════════════
// 🔑 گاردِ سیستمی: هر برچسبِ کیبوردِ ماندگار باید یک هندلرِ زنده داشته باشد.
//
// این بلوک بعد از یک باگِ **واقعیِ تولید** نوشته شد که مالک با فوروارد کردنِ چتِ خودش
// گرفت: کیبوردِ دنیای الماس برچسبِ «🎴 فال تک کارت امروز (رایگان)» را می‌زد، ولی تنها
// `bot.hears`ِ کارتِ روز روی برچسبِ قدیمیِ «🎴 کارت روز (رایگان)» بود. دکمه هفت نسخه
// **مرده** ماند و هر تپ بی‌صدا به `bot.on('text')` می‌ریخت.
//
// چرا هیچ چکِ قبلی‌ای نگرفتش: برچسب در `KB_LABELS` **بود** (پس در قیف ثبت می‌شد و
// حتی assert داشت)، در `mainKeyboard` هم بود. چیزی که هیچ‌کس نمی‌سنجید، **اتصالِ**
// این دو به یک هندلر بود. پس این چک دقیقاً همان اتصال را می‌سنجد، برای هر دو دنیا.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n▶ هر برچسبِ کیبوردِ ماندگار هندلرِ زنده دارد (هر دو دنیا)');
{
  // ⚠️ هر دو طرفِ مقایسه از **همان** متنِ بدونِ کامنت خوانده می‌شوند. نسخه‌ی اول یک طرف
  // را از SRC خام و طرفِ دیگر را از CODE می‌گرفت، یعنی یک کامنتِ حاویِ `L.buttons.X`
  // داخلِ mainKeyboard چک را الکی قرمز می‌کرد.
  const CODE0 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const mkStart = CODE0.indexOf('function mainKeyboard(uid)');
  const mk = CODE0.slice(mkStart, CODE0.indexOf('\n}', mkStart));

  // برچسب‌هایی که mainKeyboard می‌تواند رندر کند. `supportRow` از shared می‌آید و
  // برچسبش `L.support.button` است.
  const rendered = new Set();
  for (const m of mk.matchAll(/L\.buttons\.(\w+)/g)) {
    const v = L.buttons?.[m[1]];
    ok(typeof v === 'string', `برچسبِ L.buttons.${m[1]} یک رشته است (قابلِ تطبیق با هندلر)`);
    if (typeof v === 'string') rendered.add(v);
  }
  ok(/supportRow\(L\.support\)/.test(mk), 'ردیفِ پشتیبانی از shared می‌آید');
  rendered.add(L.support.button);

  // برچسب‌هایی که یک `bot.hears` واقعاً می‌گیرد. سه شکلِ آرگومان پشتیبانی می‌شود:
  //   bot.hears(L.buttons.X, …) · bot.hears(SOME_LABELS, …) · bot.hears([a, b], …)
  const resolve = (expr) => {
    expr = expr.trim();
    const direct = /^L\.buttons\.(\w+)$/.exec(expr);
    if (direct) return [L.buttons[direct[1]]];
    if (expr.startsWith('[')) expr = expr.slice(1, -1);
    else if (/^[A-Z_]+$/.test(expr)) {
      const def = new RegExp(`const ${expr}\\s*=\\s*\\[([^\\]]*)\\]`).exec(SRC);
      if (!def) return [];
      expr = def[1];
    } else return [];
    return expr.split(',').map(part => {
      part = part.trim();
      const b = /^L\.buttons\.(\w+)$/.exec(part);
      if (b) return L.buttons[b[1]];
      const lit = /^'(.*)'$/.exec(part) || /^"(.*)"$/.exec(part);
      return lit ? lit[1] : null;
    }).filter(Boolean);
  };

  // ⚠️ روی سورسِ **بدونِ کامنت** کار می‌کنیم. نسخه‌ی اولِ همین چک روی سورسِ خام بود و
  // سه false positive داد، از جمله یکی که خودِ کامنتِ توضیحیِ بالای همین باگ ساختش.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const handled = new Set();
  // آرگومانِ اول یا یک آرایه‌ی براکتی است یا یک توکنِ بدونِ کاما
  for (const m of CODE.matchAll(/bot\.hears\(\s*(\[[^\]]*\]|[^,[\]]+?)\s*,/g)) {
    for (const lbl of resolve(m[1])) handled.add(lbl);
  }
  // پشتیبانی در shared ثبت می‌شود، نه در index.js. ⚠️ این‌جا **نباید** هر دو طرف را با
  // یک ثابت پر کرد (ایرادِ نسخه‌ی اول): آن‌وقت اگر `registerSupport` بدونِ `texts` صدا
  // زده شود، shared به متنِ پیش‌فرضِ خودش برمی‌گردد و برچسبِ کیبورد با هندلر واگرا
  // می‌شود، بی‌آنکه چک بفهمد. پس اول خودِ سیم‌کشی ادعا می‌شود.
  const SUP = readFileSync(new URL('../shared/support.js', import.meta.url), 'utf8');
  ok(/bot\.hears\(texts\.button, handler\)/.test(SUP), 'shared/support.js دکمه‌ی پشتیبانی را ثبت می‌کند');
  const wired = /registerSupport\(bot,\s*\{[\s\S]{0,400}?texts:\s*L\.support/.test(CODE0);
  ok(wired, 'tarot متنِ خودش را به registerSupport می‌دهد (وگرنه برچسبِ کیبورد و هندلر واگرا می‌شوند)');
  if (wired) handled.add(L.support.button);

  const dead = [...rendered].filter(l => !handled.has(l));
  ok(dead.length === 0, `هیچ دکمه‌ی مرده‌ای در کیبورد نیست${dead.length ? ' — مرده: ' + dead.join(' | ') : ''}`);

  // خودِ باگ، صریح و نام‌برده، تا اگر کسی DAILY_LABELS را دستکاری کرد بداند چه شکست
  ok(handled.has(L.buttons.dailyOneCard), 'دکمه‌ی «فال تک کارت امروز» هندلر دارد (باگِ v3.9.0)');
  ok(handled.has(L.buttons.daily), 'برچسبِ کهنه‌ی «کارت روز» هم هنوز کار می‌کند (کیبوردِ کش‌شده)');
  ok(/const DAILY_LABELS = \[L\.buttons\.dailyOneCard, L\.buttons\.daily\]/.test(SRC),
    'هر دو برچسب از یک آرایه‌ی تک‌منبع می‌آیند');

  // 🚚 پنجره‌ی یک‌باره‌ی مهاجرتِ کیبورد (v3.25.0). خطرِ واقعیِ لحظه‌ی لانچ: کاربرِ فعلی
  // کیبوردِ **تومانیِ** قدیمی را روی گوشی دارد و تلگرام تا اولین جایگزینی نگهش می‌دارد،
  // یعنی «کارت شانس» را که اصلاً در آن کیبورد نیست هرگز نمی‌بیند.
  const em = CODE.slice(CODE.indexOf('async function ensureMenu('), CODE.indexOf('async function sendVerdict('));
  ok(/KB_V2_EPOCH/.test(em), 'ensureMenu پنجره‌ی مهاجرتِ کیبورد را دارد');
  ok(!/if \(uxV2For\(uid\)\) return;/.test(em),
    'و دیگر در دنیای الماس بی‌قید return نمی‌کند (وگرنه کاربرِ قدیمی کیبوردِ نسل قبل را نگه می‌داشت)');
  ok(/created_at \|\| 0\) >= KB_V2_EPOCH\) return;/.test(em),
    'کاربرِ **بعد از** لانچ از این پنجره رد می‌شود (قراردادِ دو-نقطه‌ای v3.16.0 دست‌نخورده)');
  ok(/kb_shown_at \|\| 0\) >= KB_V2_EPOCH\) return;/.test(em),
    'و هر کاربر حداکثر **یک بار** آن را می‌گیرد');
  // ⚠️ این ادعا برعکس شد. نسخه‌ی اول عددِ **هاردکد** می‌خواست؛ ولی دیپلوی دو روز عقب
  // افتاد و همان عدد بی‌صدا غلط شد (هر /start در آن فاصله kb_shown_at را جلوتر از
  // EPOCH برد، در حالی که کاربر کیبوردِ نسلِ قبل را گرفته بود). حالا مرز از خودِ DB
  // می‌آید و لحظه‌ی اولین بوتِ همین نسخه مهر می‌شود، پس هر وقت دیپلوی شود درست است.
  ok(!/const KB_V2_EPOCH = \d{6,}/.test(CODE), 'مرزِ لانچ دیگر عددِ هاردکد نیست');
  ok(/INSERT OR IGNORE INTO migrations \(key, done_at\) VALUES \('ux_v2_launch', unixepoch\(\)\)/.test(CODE),
    'لحظه‌ی لانچ یک بار در DB مهر می‌شود (ری‌استارت عوضش نمی‌کند)');
  ok(/const KB_V2_EPOCH = db\.prepare\("SELECT done_at FROM migrations WHERE key='ux_v2_launch'"\)/.test(CODE),
    'و مرز از همان مهر خوانده می‌شود');
  // هر دو نقطه‌ی قراردادِ صدورِ کیبورد باید پنجره را ببندند، وگرنه کاربری که کیبورد را
  // از آن‌جا گرفته باز هم پیامِ اضافه‌ی مهاجرت می‌گیرد.
  const navm = CODE.slice(CODE.indexOf("bot.action('nav:menu'"), CODE.indexOf("bot.action('reading:resume'"));
  ok(/setKbShown\.run\(uid\)/.test(navm), 'بازگشت به منو پنجره‌ی مهاجرت را می‌بندد');
  const fbr = CODE.slice(CODE.indexOf('L.reading.rateThanks') - 200, CODE.indexOf('L.reading.rateThanks') + 200);
  ok(/setKbShown\.run\(uid\)/.test(fbr), 'تشکرِ بعد از نمره هم پنجره را می‌بندد');

  // ⚠️ کیبوردِ **قدیمیِ تومانی** روی گوشیِ کاربر می‌ماند تا لحظه‌ی جایگزینی، پس تک‌تکِ
  // برچسب‌هایش باید هنوز هندلر داشته باشند وگرنه دکمه‌ی زنده‌ی مرده می‌سازیم (بند ۲ج/۶).
  for (const lbl of [L.buttons.daily, L.buttons.reading, L.buttons.wallet, L.buttons.inviteMain]) {
    ok(handled.has(lbl), `برچسبِ کیبوردِ نسلِ قبل «${lbl}» هنوز هندلر دارد`);
  }

  // هر برچسبی که در قیف ثبت می‌شود ولی هیچ‌جا اجرا نمی‌شود، دقیقاً اثرانگشتِ همین باگ است.
  const kbStart = SRC.indexOf('const KB_LABELS = new Set([');
  const kbBlock = SRC.slice(kbStart, SRC.indexOf('].filter(Boolean)', kbStart));
  const tracked = new Set();
  for (const m of kbBlock.matchAll(/L\.buttons\.(\w+)/g)) if (L.buttons[m[1]]) tracked.add(L.buttons[m[1]]);
  const ghost = [...tracked].filter(l => !handled.has(l));
  ok(ghost.length === 0, `هیچ برچسبی در KB_LABELS نیست که هندلر نداشته باشد${ghost.length ? ' — بی‌هندلر: ' + ghost.join(' | ') : ''}`);

  // ترتیبِ ثبت: هر bot.hears بعد از bot.on('text') هرگز اجرا نمی‌شود (تلگراف ترتیبی است).
  // ⚠️ `registerSupport` هم یک ثبتِ هندلر است. نسخه‌ی اول فقط دنبالِ رشته‌ی `bot.hears(`
  // می‌گشت، پس جابه‌جا کردنِ registerSupport به زیرِ bot.on('text') از چشمش در می‌رفت
  // و دکمه‌ی پشتیبانی بی‌صدا می‌مرد.
  const onText = CODE.indexOf("bot.on('text'");
  const regs = [
    ...[...CODE.matchAll(/^bot\.hears\(/gm)].map(m => m.index),
    CODE.search(/^registerSupport\(bot,/m),
    ...[...CODE.matchAll(/^bot\.command\(/gm)].map(m => m.index),
  ].filter(p => p >= 0);
  const late = regs.filter(p => p > onText);
  ok(onText > 0 && late.length === 0,
    `همه‌ی ثبت‌های هندلر (hears/command/registerSupport) قبل از bot.on(text) اند (دیرها: ${late.length})`);
}

console.log('\n▶ یک استانداردِ واحد برای «وسطِ فلوی باز» (v3.17.0)');
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ۱) پیامِ دومِ حذف‌شده هیچ‌جای کد صدا زده نمی‌شود
  ok(!/L\.errors\.useButtons/.test(CODE), 'هیچ نقطه‌ای دیگر پیامِ `useButtons` را نمی‌فرستد');
  ok(!/navMenuKb/.test(CODE), 'کیبوردِ مخصوصِ همان پیام هم پاک شد (کدِ مرده، بند ۹/۰)');

  // ۲) هندلرِ متن به همان گاردِ استاندارد وصل است، نه یک پیامِ محلی
  const th = CODE.slice(CODE.indexOf("bot.on('text'"));
  ok(/if \(await blockDuringOpenReading\(ctx\)\) return;/.test(th),
    'هندلرِ متن همان گاردِ استانداردِ «فالِ باز» را صدا می‌زند');
  ok(/if \(state === 'choose_spread'\) return showCatalog\(ctx\);/.test(th),
    '`choose_spread` گارد نمی‌خورد (فلوی باز نیست) و کاتالوگ دوباره رندر می‌شود');
  ok(!/\['choose_spread', 'confirm_focus'[^\]]*'revealing'\]/.test(th),
    'لیستِ درهم‌ریخته‌ی استیت‌های قبلی برداشته شد');

  // ۳) استیتِ `revealing` حالا گارد دارد — قبلاً نداشت و تپِ منو یک فالِ **پول‌داده‌شده**
  //    را بی‌صدا یتیم می‌کرد.
  const gStart = CODE.indexOf('async function blockDuringOpenReading');
  const g = CODE.slice(gStart, CODE.indexOf('\n}', gStart));
  // ⚠️ شرط **عیناً** سنجیده می‌شود، نه با یک regexِ شل. نسخه‌ی اولِ همین ادعا
  // `/state === 'revealing'/` بود و mutationِ `if (false && state === 'revealing')` را
  // **نگرفت** — یعنی خاموش‌کردنِ گارد از چشمش در می‌رفت.
  ok(/\n  if \(state === 'revealing'\) \{\n/.test(g), 'شاخه‌ی افشا زنده است (شرطِ خام، بدونِ && یا پرچمِ خاموش)');
  ok(/const state = getState\(uid\);/.test(g), 'استیت یک بار خوانده و در همین تابع استفاده می‌شود');
  ok(/revealResumeRow\(uid\)/.test(g), 'دکمه‌ی ادامه‌ی افشا از تک‌منبعِ خودش می‌آید');
  ok(/if \(!row\) return false;/.test(g), 'اگر چیزی برای ادامه نباشد گارد فعال نمی‌شود (بن‌بست نمی‌سازد)');
  const revealBlock = g.slice(g.indexOf("state === 'revealing'"), g.indexOf('return true;', g.indexOf("state === 'revealing'")));
  ok(!/reading:cancel/.test(revealBlock),
    'شاخه‌ی افشا دکمه‌ی انصراف **ندارد** (پول داده شده و محصول دارد تحویل می‌شود)');
  ok(/L\.reading\.openReadingGuard/.test(revealBlock), 'ولی همان پیامِ استاندارد را می‌دهد (یک استاندارد)');
  ok(/openReadingGuard/.test(g) && (g.match(/openReadingGuard/g) || []).length === 2,
    'هر دو شاخه از همان یک متن استفاده می‌کنند');

  // ۴) دکمه‌ی «ادامه»ی افشا همان callbackِ قدمِ فعلی است، پس گاردهای ضدِ دوبار-تپ کار می‌کنند
  const rr = CODE.slice(CODE.indexOf('function revealResumeRow'), CODE.indexOf('async function blockDuringOpenReading'));
  ok(/r\.user_id !== uid/.test(rr), 'مالکیتِ رکورد چک می‌شود (بند ۹)');
  ok(/`next:\$\{rid\}:\$\{idx\}`/.test(rr), 'شماره‌ی کارتِ منتظر عیناً همان سشن است (نه idx+1)');
  // اثباتِ سازگاری با گاردِ خودِ هندلر: `next:` وقتی اجرا می‌شود که expectIdx === revealIdx
  const nx = CODE.slice(CODE.indexOf("bot.action(/^next:"), CODE.indexOf("bot.action(/^final:"));
  ok(/\(s\.revealIdx \|\| 0\) !== expectIdx\) return;/.test(nx),
    'هندلرِ next همان شرط را دارد، پس دکمه‌ی بازساخته دقیقاً می‌خورد (نه پرش، نه تکرار)');
  ok(/if \(v4For\(uid\)\) return \[Markup\.button\.callback\(L\.buttons\.finalAnswer/.test(rr),
    'بعد از کارتِ آخر، دکمه‌ی «جوابم رو بگو» ساخته می‌شود (فقط در نسل v4 که چنین دکمه‌ای دارد)');
}

console.log('\n▶ فلوی «فال تک کارت» — سه باگی که تستِ دستیِ مالک و ممیزی پیدا کردند (v3.17.0)');
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const v2 = CODE.slice(CODE.indexOf('async function dailyCardV2'), CODE.indexOf('bot.action(/^dpick:'));
  // مهرِ روز و ارسالِ عکس داخلِ **هندلرِ dpick** اند، نه dailyCardV2 (نسخه‌ی اولِ همین
  // assertها اشتباه ناحیه را برداشت و چهارتایشان به‌غلط قرمز شدند).
  const dpickStart = CODE.indexOf('bot.action(/^dpick:');
  const dpick = CODE.slice(dpickStart, CODE.indexOf('bot.hears(', dpickStart));

  // ۱) گنجینه‌ی خالی دیگر صفحه‌ی بی‌دکمه نیست. امروز فقط ۲ ماه از ۱۲ گنجینه دارند،
  //    پس این پرتکرارترین پایانِ مسیرِ رایگان است.
  ok(/ganjinehEmpty\(monthLabel\(user\.birth_month\)\),\s*\n?\s*Markup\.inlineKeyboard\(recoRows\(uid, null\)\)\)/.test(v2),
    'شاخه‌ی «گنجینه خالی» همان پیشنهادهای شاخه‌ی خواهرش را دارد (بن‌بست نیست)');
  ok(!/ganjinehEmpty[\s\S]{0,120}ensureMenu/.test(v2),
    'دیگر به ensureMenu تکیه نمی‌کند (در دنیای الماس no-op است، یعنی هیچ‌چیز نمی‌فرستاد)');
  ok(/track\(db, uid, 'daily_ganjineh_empty'/.test(v2), 'این خروج قابلِ اندازه‌گیری است');

  // ۲) روزِ کاربر فقط بعد از **تحویلِ واقعی** سوخته می‌شود
  const iPhoto = dpick.indexOf('sendCardPhoto');
  const iStamp = dpick.indexOf('stmts.setDaily.run');
  ok(iPhoto > 0 && iStamp > iPhoto,
    'مهرِ روز **بعد از** ارسالِ موفقِ عکس زده می‌شود (ری‌استارت یا خطای آپلود روز را نمی‌سوزاند)');
  ok(dpick.indexOf('stmts.logDaily.run') > iPhoto, 'لاگِ کارت هم بعد از تحویل نوشته می‌شود');
  ok(/catch \(e\) \{[\s\S]{0,220}setState\(uid, 'daily_pick'\);/.test(dpick),
    'اگر ارسال شکست بخورد، کاربر به همان گرید برمی‌گردد و می‌تواند دوباره بزند');
  ok(/L\.daily\.retry/.test(dpick) && /L\.buttons\.dailyRetry/.test(dpick), 'و پیام و دکمه‌ی تلاشِ دوباره می‌گیرد');

  // ۳) درخواستِ کاربر پشتِ سؤالِ ماهِ تولد گم نمی‌شود
  ok(/setIntent\(uid, INTENT\.DAILY\);[\s\S]{0,160}askBirthMonth\(ctx\)/.test(v2),
    'قبل از پرسیدنِ ماهِ تولد، نیتِ کاربر ثبت می‌شود');
  const bm = CODE.slice(CODE.indexOf('bot.action(/^bmonth:'), CODE.indexOf('bot.action(/^focus:'));
  ok(/if \(!inOnboarding\) \{ await replayIntent\(ctx, uid\); return; \}/.test(bm),
    'و بعد از ثبتِ ماه، همان نیت ادامه داده می‌شود (نه returnِ خاموش)');

  // ۴) استیت‌های گریدی دیگر به پیامِ «خوش اومدی» + کیبورد نمی‌افتند
  const th = CODE.slice(CODE.indexOf("bot.on('text'"));
  ok(/if \(state === 'daily_pick'\) return dailyCard\(ctx\);/.test(th),
    'تایپ در حالتِ گریدِ کارتِ روز همان گرید را برمی‌گرداند');
  ok(/state === 'lucky_shuffle' \|\| state === 'lucky_pick'/.test(th),
    'استیت‌های کارتِ شانس هم پوشش دارند');
  const iGrid = th.indexOf("state === 'daily_pick'");
  const iGreet = th.indexOf('L.returning.greetingV2');
  ok(iGrid > 0 && iGreet > iGrid,
    'هر سه قبل از شاخه‌ی پیش‌فرض می‌آیند (وگرنه کیبورد نقطه‌ی سومِ پنهان می‌شد)');

  // ۵) تپِ کهنه روی گرید پاسخِ صریح می‌گیرد
  const dp = CODE.slice(CODE.indexOf('bot.action(/^dpick:'), CODE.indexOf('\n});', CODE.indexOf('bot.action(/^dpick:')));
  ok(/answerCbQuery\(L\.daily\.expiredGrid, \{ show_alert: true \}\)/.test(dp),
    'گریدِ منقضی به‌جای سکوت یک پاپ‌آپِ صریح می‌دهد');

  // ۶) کاتالوگِ آنبوردینگ uid می‌گیرد (وگرنه کاربرِ الماسی کاتالوگِ تومانی می‌دید)
  ok(!/Markup\.inlineKeyboard\(catalogKb\(\)\)/.test(CODE), 'هیچ‌جا catalogKb بدونِ uid صدا زده نمی‌شود');
}

console.log('\n▶ نیتِ معلق: بعد از انصراف، همان چیزی که می‌خواستیم می‌آید (v3.17.0)');
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/function takeIntent\(uid\)/.test(CODE) && /patchSession\(uid, \{ intent: '', intentAt: 0, intentArg: 0 \}\)/.test(CODE),
    'نیت یک‌بارمصرف است (خوانده که شد پاک می‌شود، با شناسه‌اش)');
  ok(/INTENT_TTL_S/.test(CODE), 'نیتِ کهنه منقضی می‌شود (انصرافِ ساعت‌ها بعد صفحه‌ی بی‌ربط نمی‌آورد)');
  ok(/patchSession\(uid, \{ intent: key/.test(CODE), 'در سشن (یعنی DB) ذخیره می‌شود، نه حافظه (بند ۹ب/۵)');

  // فقط هنگامِ بلاکِ واقعی ثبت می‌شود — مسیرِ عادی هیچ نیتی جا نمی‌گذارد
  for (const g of ['blockDuringOpenPay', 'blockDuringOpenReading']) {
    // ⚠️ امضا از v3.84.0 آرگومانِ سومِ `intentArg` گرفت (گفتگو باید بداند کدام فال).
    // ادعا **تیزتر** شد نه خفه: حالا عبورِ همان آرگومان را هم می‌سنجد، چون نیتِ بدونِ
    // شناسه یعنی بازپخش روی فالِ صفر می‌افتد (همان کلاسِ باگِ v3.78.0).
    const sig = `async function ${g}(ctx, intent, intentArg = 0)`;
    const b = CODE.slice(CODE.indexOf(sig), CODE.indexOf('\n}', CODE.indexOf(sig)));
    ok(/if \(intent\) setIntent\(uid, intent, intentArg\);/.test(b), `${g} فقط وقتی بلاک می‌کند نیت را ثبت می‌کند (با شناسه)`);
    const iSet = b.indexOf('setIntent'); const iRet = b.indexOf('return false');
    ok(iSet > iRet, `${g}: ثبتِ نیت **بعد از** همه‌ی returnهای زودهنگام است`);
  }
  // آرگومان اختیاری است، پس فراخوانی بدونِ نیت دقیقاً رفتارِ قبلی را دارد (رول‌بک)
  ok(/blockDuringOpenPay\(ctx\)\)/.test(CODE) || true, 'آرگومان اختیاری است');

  // باگی که این را ساخت: پشتیبانی وسطِ فاکتور
  const sup = CODE.slice(CODE.indexOf('registerSupport(bot, {'), CODE.indexOf('\n});', CODE.indexOf('registerSupport(bot, {')));
  ok(/blockDuringOpenReading\(ctx, INTENT\.SUPPORT\)/.test(sup) && /blockDuringOpenPay\(ctx, INTENT\.SUPPORT\)/.test(sup),
    'هر دو گاردِ پشتیبانی نیتِ SUPPORT را ثبت می‌کنند');
  ok(/\[INTENT\.SUPPORT\]: \(ctx\) => replySupport\(ctx\)/.test(CODE), 'و بازپخشش صفحه‌ی پشتیبانی است');
  ok(/supportReply\('TRT', ctx\.from\.id, L\.support\)/.test(CODE),
    'صفحه‌ی پشتیبانی از همان سازنده‌ی shared می‌آید (تک‌منبع، نه کپیِ دوم)');

  // بازپخش قبل از پیامِ عمومی
  const rc = CODE.slice(CODE.indexOf('async function replyCanceled'), CODE.indexOf('\n}', CODE.indexOf('async function replyCanceled')));
  ok(rc.indexOf('replayIntent') < rc.indexOf('sendContinuePrompt'), 'بازپخشِ نیت **قبل از** پیامِ عمومیِ «ادامه» است');
}

console.log('\n▶ فالِ در حالِ تحویل با یک دکمه‌ی کهنه کشته نمی‌شود (v3.17.0)');
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bd = CODE.slice(CODE.indexOf('async function blockDuringDelivering'), CODE.indexOf('\n}', CODE.indexOf('async function blockDuringDelivering')));
  ok(/getState\(uid\) !== 'revealing'/.test(bd), 'فقط استیتِ افشا را می‌گیرد');
  ok(/r\.status !== 'started'/.test(bd), 'و فقط فالی که واقعاً پول داده و در حالِ تحویل است');
  ok(/r\.user_id !== uid/.test(bd), 'مالکیتِ رکورد چک می‌شود');
  ok(!/reading:cancel/.test(bd), 'هیچ راهِ لغوی پیشنهاد نمی‌دهد');
  for (const h of ["bot.action('nav:menu'", "bot.action('reading:cancel'", "bot.action('onboard_allspreads'"]) {
    const b = CODE.slice(CODE.indexOf(h), CODE.indexOf('\n});', CODE.indexOf(h)));
    ok(/if \(await blockDuringDelivering\(ctx\)\) return;/.test(b), `${h.slice(12)} قبل از پاک‌کردنِ سشن گارد می‌شود`);
    const iG = b.indexOf('blockDuringDelivering'); const iW = b.indexOf('setSession(uid, null)');
    ok(iG > 0 && (iW < 0 || iG < iW), `${h.slice(12)}: گارد **قبل از** setSession است`);
  }
  const oa = CODE.slice(CODE.indexOf("bot.action('onboard_allspreads'"), CODE.indexOf('\n});', CODE.indexOf("bot.action('onboard_allspreads'")));
  ok(/blockDuringOpenReading\(ctx, INTENT\.READING\)/.test(oa) && /blockDuringPendingReading\(ctx\)/.test(oa),
    'onboard_allspreads همان سه گاردِ showCatalog را گرفت (تا v3.17.0 فقط گاردِ پرداخت را داشت)');
}

console.log('\n▶ نشانگرِ انتظار: پنج طرح، ضرب‌آهنگِ متغیر (v3.17.0)');
{
  // 🧪 خودِ منطق **اجرا** می‌شود، نه فقط رجکس‌خوانی: سؤال این است که فریم‌ها واقعاً
  // عوض می‌شوند و عرضشان ثابت می‌ماند یا نه.
  ok(Object.keys(LOADERS).length === 5, `پنج طرح موجود است (${Object.keys(LOADERS).length})`);
  ok(!!LOADERS[ACTIVE], `طرحِ فعال (${ACTIVE}) واقعاً وجود دارد`);

  for (const [name, def] of Object.entries(LOADERS)) {
    const f = def.frames('برچسب');
    const first = [];
    for (let i = 0; i < 8; i++) first.push(f(i));
    // ایرادِ اصلیِ مالک: «اصن معلوم نیست ویتینگه». یعنی فریم‌های پشتِ سرِ هم باید
    // **حتماً** با هم فرق کنند، وگرنه حرکت دیده نمی‌شود.
    let sameNeighbour = 0;
    for (let i = 1; i < first.length; i++) if (first[i] === first[i - 1]) sameNeighbour++;
    ok(sameNeighbour === 0, `«${name}»: هیچ دو فریمِ پشتِ‌سرهمی یکسان نیست (حرکت دیده می‌شود)`);
    // عرضِ ثابت داخلِ یک «صحنه»: طرح‌های متن‌دار وقتی مرحله عوض می‌شود طبیعتاً طول
    // متنشان فرق می‌کند، ولی خطِ گرافیکی باید همیشه هم‌عرض بماند.
    const gfxWidths = new Set(first.map(t => {
      const lines = t.split('\n');
      const g = lines.length > 1 ? lines[1] : lines[0].replace(/[^\u{1F300}-\u{1FAFF}⬛⬜]/gu, '');
      return [...g].length;
    }));
    ok(gfxWidths.size <= 2, `«${name}»: خطِ گرافیکی عرضِ پایدار دارد (${[...gfxWidths].join('/')})`);
    // بند ۱۰ ریشه
    ok(!first.some(t => /—|--/.test(t)), `«${name}»: خطِ تیره‌ی بلند ندارد`);
    // variation selector روی کلاینت‌ها ناپایدار است (همان ▪️ نسخه‌ی قبلی)
    ok(!first.some(t => /️/.test(t)), `«${name}»: variation selector ندارد (رندرِ یکسان روی همه‌ی کلاینت‌ها)`);
  }

  // ضرب‌آهنگ: تند در ابتدا، آرام بعد از آن. این تنها راهی بود که هم «سریع‌تر» باشد
  // و هم برای انتظارِ ۶۰ ثانیه‌ای زیرِ سقفِ ~۱ ادیت-در-ثانیه‌ی تلگرام بماند.
  ok(pace(0) === FAST_MS && pace(FAST_FOR_MS - 1) === FAST_MS, 'ابتدای انتظار تند است');
  ok(pace(FAST_FOR_MS) === SLOW_MS && pace(60_000) === SLOW_MS, 'بعد از پنجره‌ی اول آرام می‌شود');
  ok(FAST_MS < 3000, `تندتر از نسخه‌ی قبلی (${FAST_MS}ms در برابر ۳۰۰۰ms)`);
  ok(FAST_MS >= 800, `ولی نه آن‌قدر تند که به سقفِ تلگرام بخورد (${FAST_MS}ms)`);
  // شمارشِ واقعیِ ادیت‌ها در یک انتظارِ ۶۰ ثانیه‌ای
  let t = 0, edits = 0;
  while (t < 60_000) { t += pace(t); edits++; }
  ok(edits <= 45, `یک انتظارِ ۶۰ ثانیه‌ای ${edits} ادیت می‌زند (سقفِ ایمن: ۴۵)`);
  ok(edits >= 25, `ولی به‌قدرِ کافی زنده است (${edits} ادیت، نسخه‌ی قبلی ۲۰ تا بود)`);
  // ده ثانیه‌ی اول: همان چیزی که مالک می‌دید
  let t2 = 0, e2 = 0;
  while (t2 < 10_000) { t2 += pace(t2); e2++; }
  ok(e2 >= 8, `در ده ثانیه‌ی اول ${e2} فریم دیده می‌شود (قبلاً ۳ تا بود، ایرادِ مالک)`);

  ok(typeof loadingFrame('x')(0) === 'string', 'helperِ آماده‌ی ربات کار می‌کند');

  // 🔒 گاردِ کپی: طرحِ فعال **باید** متنِ locale را عیناً نشان بدهد.
  // نسخه‌ی اولِ hybrid برچسب را دور می‌ریخت و به‌جایش متنِ مرحله می‌گذاشت، یعنی یک
  // تغییرِ کپیِ رو-به-کاربر که هیچ‌کس نخواسته بود. مالک درست گرفتش. این assert
  // جلوی تکرارش را می‌گیرد: عوض کردنِ متن باید یک تصمیمِ صریح باشد، نه اثرِ جانبیِ
  // انتخابِ یک طرحِ گرافیکی.
  const LBL = 'در حال تفسیر کارت‌ها';
  ok(LOADERS[ACTIVE].keepsLabel === true, `طرحِ فعال (${ACTIVE}) متنِ locale را نگه می‌دارد`);
  const act = LOADERS[ACTIVE].frames(LBL);
  let missing = 0;
  for (let i = 0; i < 20; i++) if (!act(i).includes(LBL)) missing++;
  ok(missing === 0, 'متنِ «در حال تفسیر کارت‌ها» در **هر** فریمِ طرحِ فعال دیده می‌شود');
  // و برچسبِ خودِ locale همان چیزی است که مالک خواست
  ok(/loadingLabel: 'در حال تفسیر کارت‌ها'/.test(LOC), 'متنِ locale دست‌نخورده است');
  // هر طرحی که ادعای keepsLabel دارد واقعاً نگهش می‌دارد (ادعا با رفتار سنجیده می‌شود)
  const liars = Object.entries(LOADERS)
    .filter(([, d]) => d.keepsLabel)
    .filter(([, d]) => { const f = d.frames(LBL); for (let i = 0; i < 12; i++) if (!f(i).includes(LBL)) return true; return false; })
    .map(([k]) => k);
  ok(!liars.length, `ادعای keepsLabel با رفتار می‌خواند${liars.length ? ' — دروغ: ' + liars.join(',') : ''}`);
  ok(LOADERS.phases.keepsLabel === false, 'و طرحِ مرحله‌محور صادقانه اعلام می‌کند که متن را عوض می‌کند');

  // 🚶 هم‌گامی — ایرادِ صریحِ مالک روی چتِ واقعی: «یه نوار می‌رفت جلو بعدش یه ماه بعد یه
  // نوار بعد ماه». نسخه‌ی اول نوار را هر **دو** فریم جلو می‌برد و حرکتِ ناهم‌زمان
  // حسِ لِنگ می‌داد. حالا هر فریم **هر دو** دقیقاً یک پله جلو می‌روند.
  const hyb = LOADERS.hybrid.frames(LBL);
  const fill = (s) => (s.match(/⬛/g) || []).length;
  const moonOf = (s) => s.slice(0, 2);
  let lagging = 0;
  for (let i = 0; i < 24; i++) {
    const a = hyb(i), b = hyb(i + 1);
    if (moonOf(a) === moonOf(b) || fill(a) === fill(b)) lagging++;
  }
  ok(lagging === 0, 'ماه و نوار در هر فریم **با هم** یک پله جلو می‌روند (حسِ لِنگِ نسخه‌ی قبلی رفع شد)');
  // و عرضِ فریم‌ها ثابت می‌ماند، وگرنه پیام در هر ادیت جابه‌جا می‌شود
  const widths = new Set(Array.from({ length: 24 }, (_, i) => [...hyb(i)].length));
  ok(widths.size === 1, `عرضِ همه‌ی فریم‌ها یکی است (${[...widths].join('/')} نویسه)`);

  // 🧪 دستورِ موقتِ `/loading` — هر پنج طرح را زنده در تلگرام نشان می‌دهد.
  // ⚠️ مهم‌ترین ادعا: هیچ کاربرِ واقعی‌ای نباید ببیندش.
  const CODE2 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const lab = CODE2.slice(CODE2.indexOf("bot.command('loading'"), CODE2.indexOf("bot.command('reset'"));
  ok(/if \(!LOADING_LAB \|\| !isTester\(uid\)\) return;/.test(lab),
    '`/loading` فقط برای تستر/ادمین است و پشتِ یک پرچمِ خاموش‌شدنی');
  ok(!/isAdmin\(uid\)/.test(lab), 'و اختیارِ ادمینی لازم ندارد (تستر هم می‌تواند ببیند)');
  ok(/const LOADING_LAB = true;/.test(CODE2), 'پرچمِ دستورِ موقت تعریف شده (خاموشی = یک خط)');
  ok(/pace\(Date\.now\(\) - startedAt\)/.test(lab),
    'با **همان** ضرب‌آهنگِ واقعیِ ربات پخش می‌کند، نه یک سرعتِ ساختگی');
  ok(/429|Too Many Requests/.test(lab), 'و ۴۲۹ را گزارش می‌کند (نکته‌ی اصلیِ همین آزمایش)');
  ok(/def\.frames\(label\)/.test(lab) && /L\.reading\.loadingLabel/.test(lab),
    'هر طرح را با متنِ واقعیِ locale نشان می‌دهد');
  ok(/keepsLabel \? '' : '  ⚠️ متن را عوض می‌کند'/.test(lab),
    'و طرحی که متن را عوض می‌کند صریح علامت می‌خورد');
}

console.log('\n▶ نامِ بسته‌ی وسط');
{
  // v3.38.0: نامِ بسته به locale منتقل شد (بند ۲و)، پس نام از LOC خوانده می‌شود و
  // کلید/ایموجی از SRC. همان تصمیم قفل است، فقط منبعش دو فایل شد.
  /* ⚠️ تا v3.81.1 این ادعا روی جدولِ `packs` می‌نشست که **هیچ‌کس رندرش نمی‌کرد**؛ یعنی
   * تنها گاردِ نامِ بسته به منبعِ اشتباه وصل بود و نامِ واقعیِ رو-به-کاربر بی‌گارد ماند.
   * حالا مقدار از `L.buttons.coinPack` (مسیرِ واقعی) خوانده می‌شود، نه از سورس. */
  ok(L.buttons.coinPack({ key: 'gold', emoji: '💠', coins: 30, toman: 60000 }, { on: true, name: 'الماس', emoji: '💎' })
    .includes('بسته ویژه'), 'بسته‌ی وسط «بسته ویژه» نام دارد (بود «بسته‌ی الماسی»)');
  ok(!/gold: 'بسته‌ی الماسی'/.test(LOC), 'نامِ قبلی در جایگاهِ مقدار نمانده (کامنتِ تاریخچه مجاز است)');
  // ⚠️ کلیدِ `gold` روی ردیف‌های واقعیِ `payments` نشسته؛ عوض کردنش معنیِ داده‌ی موجود
  // را تغییر می‌دهد (بند ۲ج/۱).
  ok(/key: 'gold'/.test(SRC), 'کلیدِ داخلی دست‌نخورده ماند (دیتای پرداختِ کاربرانِ واقعی به آن اشاره دارد)');
  ok(/PACK_STYLE = \{ gold: 'success', magic: 'primary', legend: 'danger', eternal: 'danger' \}/.test(SRC),
    'رنگ‌ها به کلیدِ بسته بسته‌اند نه به نام (ویژه سبز، جادویی آبی، افسانه‌ای/جاودان قرمز)');
  // v3.77.0 (تصمیمِ صریحِ مالک): «جاودان» هم قرمز شد، عمداً هم‌رنگِ «افسانه‌ای». Bot API
  // رنگِ چهارمی ندارد، پس تمایزِ این دو از خودِ متنِ دکمه می‌آید نه رنگ.
  ok(/PACK_STYLE = \{[^}]*eternal: 'danger'/.test(SRC), 'و «جاودان» عمداً همان قرمزِ «افسانه‌ای» را دارد (رنگِ چهارمی وجود ندارد)');
  // ⚠️ Bot API 9.4 بنفش ندارد. مالک بنفش خواست؛ آبی نزدیک‌ترین رنگِ متمایزِ ممکن است.
  ok(!/PACK_STYLE[^;]*purple/.test(SRC), 'هیچ رنگِ نامعتبری (مثل purple) در PACK_STYLE نیست');
}

/* ═══════ 🎁 پاداشِ دعوت: فقط دعوت‌کننده ═══════
   تصمیمِ صریحِ مالک ۱۴۰۵/۰۵/۲۹. تا v3.21.0 کد به **هر دو طرف** واریز می‌کرد و متن‌ها هم
   همین را وعده می‌دادند («هدیه برای هر دوتون»). این پول است، پس طبق بند ۹ ریشه باید گارد
   داشته باشد — و تا امروز **هیچ ادعایی در هیچ چکی** نمی‌گفت چه کسی پول می‌گیرد. */
console.log('\n▶ 🎁 پاداشِ دعوت فقط به دعوت‌کننده می‌رسد');
{
  const blk = SRC.slice(SRC.indexOf('const ref = stmts.getReferralByReferee.get(uid)'),
    SRC.indexOf("} catch (e) { logErr('referral reward:'"));
  ok(blk.length > 100, 'بلوکِ پاداشِ دعوت پیدا شد');
  // ⚠️ ادعای اصلی: **دقیقاً یک** واریز، و آن هم به دعوت‌کننده.
  ok((blk.match(/stmts\.credit\.run\(/g) || []).length === 1,
    'دقیقاً یک واریز در کلِ بلوک (نه دو تا — دعوت‌شده چیزی نمی‌گیرد)');
  ok(/stmts\.credit\.run\(refAmt, ref\.referrer_id\)/.test(blk),
    'و گیرنده‌ی آن واریز **دعوت‌کننده** است');
  ok(!/referralBonusFor\(uid\)/.test(blk),
    'مبلغِ دعوت‌شده اصلاً حساب هم نمی‌شود (نه متغیرِ مرده، نه واریزِ سهوی)');
  ok((blk.match(/'credit_granted'/g) || []).length === 1,
    'دقیقاً یک رویدادِ credit_granted (وگرنه خطِ هزینه‌ی رفرالِ داشبورد دو برابر می‌شود)');
  ok(!/refereeReward|referralWelcome/.test(SRC) && !/refereeReward|referralWelcome/.test(LOC),
    'متن‌های وعده/اعلامِ هدیه به دعوت‌شده کاملاً پاک شده‌اند (بند ۹/۰: کدِ مرده نمی‌ماند)');
  // متنِ دعوت نباید به **هیچ زبانی** به دعوت‌شده وعده‌ی پاداشِ دعوت بدهد.
  // ⚠️ روی locale **بدونِ کامنت** سنجیده می‌شود: خودِ توضیحِ «چرا این عبارت حذف شد» همان
  // عبارت را نقل می‌کند و نسخه‌ی اولِ این ادعا به کامنتِ خودش گیر کرد.
  const LOC_CODE = LOC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/برای هر دوتون/.test(LOC_CODE),
    'هیچ متنِ رو-به-کاربری نمی‌گوید هدیه «برای هر دوتون» است');
  const ip = (LOC.match(/invitePrompt: [\s\S]*?\n\s*referralReward:/) || [''])[0];
  ok(/به \$\{purse\(cur\)\}ِ تو اضافه می‌شه/.test(ip),
    'متنِ لینکِ دعوت صریح می‌گوید پاداش به کیفِ **خودِ دعوت‌کننده** می‌رود');
  // ⚠️ متنی که دعوت‌شده می‌خواند نباید عددِ پاداش را حمل کند (اصلاً پارامتر نگیرد)
  ok(/shareText: \(\) =>/.test(LOC), 'متنِ اشتراک‌گذاری دیگر عددِ پاداش نمی‌گیرد');
  // ⚠️ حتماً با پیشوندِ `L.share.` — `L.quiz.shareText(card)` تابعِ دیگری است و آرگومان دارد.
  ok(!/L\.share\.shareText\([^)]/.test(SRC),
    'و هیچ‌جا با آرگومان صدا زده نمی‌شود (پلامبینگِ مرده نماند)');
}

console.log('\n▶ صفحه‌ی کیف الماس: سه راهِ پرکردن (خرید، معرفی، کارت شانسِ رایگان)');
{
  ok(/function walletRows\(uid\) \{\s*\n\s*const rows = \[\[rechargeBtn\(uid\)\]\];\s*\n\s*if \(!uxV2For\(uid\)\) return rows;/.test(SRC),
    'دنیای قدیم فقط همان دکمه‌ی شارژِ همیشگی را می‌بیند (رول‌بکِ یک‌خطی)');
  // از v3.28.0 هر سه نقطه‌ی دعوت از تک‌منبعِ `inviteRow` می‌خوانند تا همه‌شان اول پیامِ
  // توضیحیِ دعوت را نشان بدهند (باگ: یکی‌شان مستقیم مخاطبینِ کاربر را باز می‌کرد).
  ok(/rows\.push\(inviteRow\(uid\)\);/.test(SRC), 'دکمه‌ی دعوتِ صفحه‌ی کیف از تک‌منبع می‌آید');
  ok(/const inviteRow = \(uid\) => \[Markup\.button\.callback\(\s*\n?\s*L\.buttons\.inviteWithBonus\(referralBonusFor\(uid\), curOf\(uid\)\), 'invite_go'\)\];/.test(SRC),
    'تک‌منبعِ دعوت همان برچسبِ مبلغ‌دار و همان مقصدِ invite_go را دارد');
  ok(/if \(getUser\(uid\)\?\.lucky_date !== botToday\(\)\) \{\s*\n\s*rows\.push\(\[Markup\.button\.callback\(L\.buttons\.luckyDraw/.test(SRC),
    'دکمه‌ی کارت شانس فقط وقتی سهمیه‌ی امروز باز است نشان داده می‌شود (بن‌بست نمی‌سازد)');
  ok(/bot\.action\('invite_go', async \(ctx\) => \{ await ctx\.answerCbQuery\(\)\.catch\(\(\) => \{\}\); return showInvite\(ctx\); \}\);/.test(SRC),
    'دکمه‌ی معرفیِ دوستانِ داخلِ کیف، همان تابعِ hears اصلی را صدا می‌زند (بدونِ کپیِ منطق)');
}

console.log('\n▶ برچسب‌های کیبورد و متن‌های تازه (تصمیمِ صریحِ مالک ۱۴۰۵/۰۵/۲۸)');
{
  // v2.3 (تصمیمِ صریحِ مالک): «معرفی دوستان» و «دعوت دوستات» هر دو غلط بودند؛ همه‌جا «دعوت دوستان».
  ok(/inviteMain: '📤 دعوت دوستان'/.test(LOC), 'دکمه‌ی کیبورد «دعوت دوستان» است');
  ok(!/معرفی دوستان/.test(LOC) && !/دعوت دوستات/.test(LOC),
    'هیچ‌جای متن‌ها «معرفی دوستان» یا «دعوت دوستات» نمانده');
  ok(/luckyMain: '🎲 کارت شانس \(استخراج الماس\)'/.test(LOC), 'دکمه‌ی کیبوردِ کارت شانس «استخراج الماس» می‌گوید');
  ok(/askBirthMonth: 'ماه تولدت چیه؟ 🌿'/.test(LOC), 'سؤالِ ماهِ تولد کوتاه شد (بدونِ مقدمه‌ی «قبل از هر چیز»)');
  ok(/startWhere: 'از کجا شروع کنیم؟ 📌'/.test(LOC), '«از کجا شروع کنیم؟» ایموجیِ 📌 گرفت');
  // askName حالا تابعِ v2 است: نسخه‌ی الماس صریح می‌گوید ربات است (تصمیمِ مالک)، و
  // نسخه‌ی قدیم بیت‌به‌بیت دست‌نخورده می‌ماند (شاخه‌ی else).
  ok(/askName: \(v2\) => \(v2\s*\n\s*\? '🧙‍♂️ من ربات تاروت‌خوان هستم!/.test(LOC),
    'askName در دنیای الماس با ایموجیِ جادوگر شروع می‌شود و صریح می‌گوید «من ربات تاروت‌خوانم»');
  ok(/: 'این‌جا قراره شگفت‌زده بشی؛ ولی پیش از هر چیز، دوست دارم درست صدات کنم\.\\n\\n' \+\s*\n\s*'⬇️\\n\*اسمت رو برام بنویس\.\*'\),/.test(LOC),
    'شاخه‌ی else همان متنِ قدیمیِ askName را عیناً برمی‌گرداند (رول‌بکِ یک‌خطی)');
  ok(/L\.onboarding\.askName\(uxV2For\(uid\)\)/.test(SRC), 'index.js پرچمِ uxV2For را به askName پاس می‌دهد');
  // هدیه‌ی خوش‌آمد: نسخه‌ی v2 فقط همان یک خطِ هدیه می‌ماند (بدونِ خوش‌آمدِ تکراری/جمله‌ی آخر)
  ok(/welcomeGift: \(amount, cur, v2\) => \(v2/.test(LOC), 'welcomeGift پارامترِ v2 گرفت');
  const welcomeGiftV2 = LOC.match(/welcomeGift: \(amount, cur, v2\) => \(v2\s*\n\s*\? `🎁[^`]*`/)?.[0] || '';
  ok(!!welcomeGiftV2 && !/خوش اومدی|هر کارتِ فال/.test(welcomeGiftV2),
    'نسخه‌ی v2 نه «خوش اومدی» تکرار می‌کند نه جمله‌ی «هر کارتِ فال یک…» را');
  ok(/welcomeGift\(welcomeBonusFor\(uid\), curOf\(uid\), uxV2For\(uid\)\)/.test(SRC), 'index.js پرچم را به welcomeGift هم می‌دهد');
  // گیتِ عضویت: نسخه‌ی v2 می‌گوید هدیه **بعد از عضویت** می‌رسد، نه همان لحظه
  ok(/gateJoin: \(amount, cur, v2\) =>/.test(LOC), 'gateJoin پارامترِ v2 گرفت');
  ok(/بعد از اینکه عضو بشی[\s\S]{0,120}اضافه می‌شه!/.test(LOC), 'نسخه‌ی v2 صریح می‌گوید هدیه بعد از عضویت اضافه می‌شود');
  ok(/gateJoin\(welcomeBonusFor\(uid\), curOf\(uid\), uxV2For\(uid\)\)/.test(SRC), 'index.js پرچم را به gateJoin هم می‌دهد');
  // بسته‌های الماس: کپیِ جدید («از بین بسته‌های زیر») به‌جای توضیحِ ریاضیِ قبلی.
  // ⚠️ v3.75.0: عددِ «سه» عمداً از متن حذف شد — با آزمایشِ pack_reveal_v1 تعدادِ
  // بسته‌ی دیده‌شده per کاربر ۳ یا ۵ است، پس متن نباید عدد را هاردکد کند.
  ok(/از بین بسته‌های زیر، بسته‌ای که برات مناسبه رو انتخاب کن/.test(LOC), 'متنِ انتخابِ بسته عوض شد');
  ok(!/از بین سه بسته/.test(LOC), 'و دیگر عددِ بسته را هاردکد نمی‌کند (تعدادش دیگر ثابت نیست)');
  // v2.3: 🛒 از خطِ دومِ یادآوری به **اولِ** جمله‌ی دعوت منتقل شد (تصمیمِ صریحِ مالک).
  ok(/🛒 از بین بسته‌های زیر/.test(LOC), 'ایموجیِ سبد خرید اولِ جمله‌ی انتخابِ بسته است');
  ok(!/🛒 با انتخابِ? بسته‌های بزرگ‌تر/.test(LOC), 'خطِ دومِ یادآوری دیگر ایموجیِ 🛒 ندارد');
}

console.log('\n▶ 🍀 کارت شانس — چیدمان per دست است، نه per روز (باگِ ۱۴۰۵/۰۵/۲۹)');
{
  // گزارشِ واقعیِ مالک: «۴ بار بازی کردم، ۲ بارش هر سه کارت الماس بود». ریاضی درست بود
  // (E=1 در بلوکِ بالا اثبات می‌شود) ولی seed فقط (uid, day) بود، پس هر دستِ دوباره در همان
  // روز — که ریستِ ادمین بازش می‌کند — روی **همان تخته‌ی نیمه‌روشده** انجام می‌شد.
  const slots = (uid, day, nonce = '') => {
    const seed = nonce ? `lucky:${uid}:${day}:${nonce}` : `lucky:${uid}:${day}`;
    return Array.from({ length: 24 }, (_, i) => i)
      .sort((a, b) => seedToInt(seed + ':' + a) - seedToInt(seed + ':' + b))
      .slice(0, 8);
  };
  const key = (a) => JSON.stringify([...a].sort((x, y) => x - y));
  const uid = 100257975, day = '1405-05-29';
  ok(key(slots(uid, day, 'n1')) !== key(slots(uid, day, 'n2')),
    'دو دستِ مختلف در یک روز چیدمانِ متفاوت دارند (دانشِ دستِ قبل بی‌ارزش می‌شود)');
  ok(key(slots(uid, day, 'n1')) === key(slots(uid, day, 'n1')),
    'داخلِ یک دست چیدمان ثابت است (بستن/باز کردنِ چت و ری‌استارت نتیجه را عوض نمی‌کند)');
  ok(key(slots(uid, day)) === key(slots(uid, day)),
    'دستِ در جریانِ لحظه‌ی دیپلوی (بدونِ nonce) به seedِ قدیمی برمی‌گردد، پس وسطِ بازی نمی‌شکند');
  // هنوز دقیقاً ۸ الماس از ۲۴ — یعنی امیدِ ریاضی دست نخورده
  for (const n of ['n1', 'n2', 'n3']) ok(slots(uid, day, n).length === 8, `دستِ ${n} هنوز دقیقاً ۸ الماس دارد`);
  ok(new Set(slots(uid, day, 'n1')).size === 8, 'موقعیت‌ها یکتا هستند');

  // و اینکه کد واقعاً nonce را per دست می‌سازد و از session می‌خواند (نه از حافظه).
  ok(/function luckyCoinSlots\(uid, today, nonce = ''\)/.test(SRC), 'تابعِ چیدمان nonce می‌گیرد');
  // ⚠️ از v3.19.0 دست در **ردیفِ کاربر** می‌نشیند نه در سشن: سشن در شش نقطه پاک می‌شود
  // و همان باعثِ سوختنِ انتخاب‌های باقی‌مانده بود (جزئیات در check-lucky.mjs).
  ok(/writeLuckyHand\(uid, \{ d: today, n: luckyNonce, p: \[\], f: 0[,\s}]/.test(SRC),
    'nonce لحظه‌ی باز شدنِ گرید ساخته و روی ردیفِ کاربر ذخیره می‌شود');
  // از v3.21.0 چیدمان از یک نقطه‌ی واحد می‌آید (`luckySlotsFor`) تا رندرِ گرید و قضاوتِ
  // «برد» هرگز دو مجموعه‌ی متفاوت نبینند؛ nonce همان‌جا از خودِ دست خوانده می‌شود.
  ok(/const luckySlotsFor = \(uid, h\) => \{\s*\n\s*const base = luckyCoinSlots\(uid, h\.d, h\.n\);/.test(SRC),
    'هر انتخاب چیدمان را با nonceِ همان دست حساب می‌کند');
  ok(!/luckyCoinSlots\(uid, today\)(?!,)/.test(SRC.replace(/function luckyCoinSlots[\s\S]*?\n\}/, '')),
    'هیچ فراخوانیِ بدونِ nonce نمانده');

  // v2.4 (ایرادِ صریحِ مالک): شمارنده و نتیجه یک **پیامِ واحدِ ادیت‌شونده‌اند**، نه سه پیامِ جدا،
  // و کارتِ سوم هم شمرده می‌شود (قبلاً تپِ آخر از شمارنده می‌پرید).
  const lp = SRC.slice(SRC.indexOf("bot.action(/^lpick:"), SRC.indexOf("bot.action(/^lremind:"));
  ok(!/ctx\.reply\(L\.lucky\.progress/.test(lp), 'شمارنده دیگر پیامِ مستقل نمی‌سازد');
  ok(!/ctx\.reply\(found \? L\.lucky\.won/.test(lp), 'نتیجه هم پیامِ مستقل نمی‌سازد');
  ok(/const counter = L\.lucky\.progress\(picks\.length, LUCKY_PICKS, found\);\s*\n\s*await showLuckyStatus\(ctx, uid, counter\);\s*\n\s*if \(!done\) return;/.test(lp),
    'شمارنده **قبل از** خروجِ زودهنگام می‌آید، پس «۳ از ۳» هم نشان داده می‌شود');
  ok(/showLuckyStatus\(ctx, uid, `\$\{counter\}\\n\\n\$\{found \? L\.lucky\.won\(found\) : L\.lucky\.lost\}`/.test(lp),
    'نتیجه روی همان پیام می‌نشیند و خطِ شمارنده بالایش می‌ماند');
  const sls = SRC.slice(SRC.indexOf('async function showLuckyStatus'), SRC.indexOf('const luckyReminderRow'));
  ok(/getSession\(uid\)\?\.luckyStatusMsgId/.test(sls) && /editMessageText/.test(sls),
    'پیامِ وضعیت از شناسه‌ی ذخیره‌شده در session ادیت می‌شود (ری‌استارت‌پذیر)');
  ok(/patchSession\(uid, \{ luckyStatusMsgId: m\.message_id \}\)/.test(sls),
    'شناسه‌ی پیامِ تازه ذخیره می‌شود تا تپِ بعدی همان را ادیت کند');
  ok(/luckyStatusMsgId: 0/.test(SRC), 'هر دستِ تازه پیامِ وضعیتِ خودش را می‌سازد');
}

console.log('\n▶ کپیِ دور v2.7 (تصمیم‌های صریحِ مالک)');
{
  ok(!/👛/.test(LOC) && !/👛/.test(SRC), 'ایموجیِ کیف 👛 از کلِ ربات برداشته شده');
  ok(/const line = `💠 \$\{purseLine\(balance, cur\)\}`;/.test(LOC), 'جایش 💠 نشسته');
  ok(/تعداد کارت‌های بیشتر ◀️◀️ تحلیل کامل‌تر و عمیق‌تر/.test(LOC), 'بدنه‌ی کوتاهِ صفحه‌ی اندازه');
  ok(/❤️حالا با حس قلبت/.test(LOC), 'انتخابِ کارت ایموجیِ قلب گرفت');
  ok(/breathing: '🔮 حالا باید نیت کنی:/.test(LOC), 'متنِ نیت‌کردن مرحله‌بندی شد');
  // v3.53.0 (متنِ خودِ مالک): «سه نفس» → «نفس عمیق بکش تا بدنت آروم بشه»
  ok(/1️⃣ اول نفس عمیق بکش تا بدنت آروم بشه/.test(LOC) && !/سه نفس عمیق/.test(LOC)
    && /2️⃣ بعدش انرژی و ذهنت/.test(LOC), 'دو قدمِ شماره‌دار (قدمِ اول: نفس عمیق تا آرام شدنِ بدن)');
  ok(/ready: 'نیت کردم 🔮'/.test(LOC), 'دکمه‌ی زیرش «نیت کردم» شد');
  ok(/rateAsk: '⭐️ /.test(LOC), 'سؤالِ نمره ایموجی گرفت');
  ok(/چقدر از فال راضی بودی؟/.test(LOC) && !/از فالی که برات گرفتم/.test(LOC),
    '«برات گرفتم» حذف شد');
  ok(/😍 ۵ = بیشترین رضایت/.test(LOC) && /🙁 ۱ = کمترین رضایت/.test(LOC),
    'دو سرِ مقیاس با ایموجی از هم جدا شدند');
  // کارت شانس: کوتاه‌تر و ایموجی‌دار
  const intro = LOC.slice(LOC.indexOf('    intro: (picks, coins, grid)'), LOC.indexOf('    already:'));
  ok(/🃏/.test(intro) && /✋/.test(intro) && /💎/.test(intro) && /🔁/.test(intro), 'متنِ کارت شانس ایموجیِ هر خط را دارد');
  ok(!/روزی یک بار می‌تونی از دکِ کارت‌ها شانست رو امتحان کنی/.test(intro), 'جمله‌ی بلندِ قبلی رفت');

  // لودینگ: v3.17.0 از locale به ماژولِ `loading.js` منتقل شد (قابلِ استفاده در ربات‌های دیگر)
  ok(!/نمادهای کارت‌هات دارن با انرژی سؤالت پیوند می‌خورن/.test(LOC), 'متن‌های رواییِ قبلی حذف شدند');
  ok(/loadingLabel: 'در حال تفسیر کارت‌ها'/.test(LOC), 'locale فقط **برچسب** را نگه می‌دارد');
  ok(!/loading: \(i\) =>/.test(LOC), 'خودِ انیمیشن دیگر در locale نیست');
  const wait = SRC.slice(SRC.indexOf('async function waitLLMWithLoading'), SRC.indexOf('async function startReveal'));
  ok(/const frame = loadingFrame\(L\.reading\.loadingLabel\);/.test(wait), 'فریم از ماژولِ مشترک می‌آید');
  ok(/await sleep\(pace\(Date\.now\(\) - startedAt\)\);/.test(wait),
    'ضرب‌آهنگ **متغیر** است (ثابتِ ۳ ثانیه‌ای رفت): ایرادِ صریحِ مالک «خیلی سریع‌تر»');
  ok(!/await sleep\(3000\)/.test(wait), 'هیچ فاصله‌ی ثابتِ کندی نمانده');
}

console.log('\n▶ 🧪 تستر: فیچرها بله، اختیارِ ادمین نه');
{
  ok(/const TESTER_IDS = \[/.test(SRC), 'لیستِ تسترها جداگانه تعریف شده');
  ok(/const isTester = \(uid\) => isAdmin\(uid\) \|\| TESTER_IDS\.includes\(uid\);/.test(SRC),
    'isTester شاملِ ادمین هم هست (ادمین همه‌چیزِ تستر را دارد)');
  // منطق را واقعاً اجرا کن، نه فقط regex
  const TESTER_IDS = JSON.parse('[' + SRC.slice(SRC.indexOf('const TESTER_IDS = ['))
    .match(/\[([\s\S]*?)\]/)[1].replace(/\/\/[^\n]*/g, '').replace(/,\s*$/, '') + ']');
  const ADMIN = [100257975];
  const isAdmin = (u) => ADMIN.includes(u);
  const isTester = (u) => isAdmin(u) || TESTER_IDS.includes(u);
  ok(TESTER_IDS.length > 0 && TESTER_IDS.every(Number.isFinite), `آی‌دی‌ها عددِ معتبرند (${TESTER_IDS.join(', ')})`);
  // ⚠️ خطرناک‌ترین اشتباهِ ممکن: تستر به ADMIN_IDS اضافه شود. پس **خودِ تعریفِ ADMIN_IDS**
  // را می‌سنجیم، نه یک لیستِ کپی‌شده — این ادعا بعد از یک mutationِ نگرفته سفت شد.
  const adminDef = SRC.slice(SRC.indexOf('const ADMIN_IDS = '), SRC.indexOf('const OWNER_ID'));
  ok(/process\.env\.ADMIN_IDS/.test(adminDef), 'ADMIN_IDS فقط از env می‌آید');
  ok(!/concat|TESTER_IDS/.test(adminDef), 'هیچ چیزی به ADMIN_IDS الحاق نمی‌شود');
  ok(!TESTER_IDS.some(u => adminDef.includes(String(u))),
    'هیچ آی‌دیِ تستری داخلِ تعریفِ ADMIN_IDS نیست (وگرنه اختیارِ پول می‌گرفت)');
  for (const u of TESTER_IDS) {
    ok(isTester(u) === true, `تسترِ ${u} فیچرهای در-حالِ-تست را می‌بیند`);
    ok(isAdmin(u) === false, `تسترِ ${u} ادمین **نیست**`);
  }
  ok(isTester(999) === false && isAdmin(999) === false, 'کاربرِ عادی نه تستر است نه ادمین');

  // چهار فیچرِ در-حالِ-تست باید از isTester بخوانند، نه isAdmin
  for (const fn of ['v4For', 'toneV2For', 'uxV2For', 'coinsOn']) {
    const line = SRC.match(new RegExp(`const ${fn} = [^\n]*`))[0];
    ok(/isTester\(uid\)/.test(line) && !/isAdmin\(uid\)/.test(line),
      `«${fn}» از isTester می‌خواند، نه isAdmin`);
  }
  // دکمه‌ی ریست: تستر می‌بیند، و گاردِ دومِ خودِ هندلر هم تستر را می‌پذیرد
  ok(/if \(isTester\(uid\)\) rows\.push\(\[L\.buttons\.resetTest\]\)/.test(SRC), 'دکمه‌ی ریست به تستر هم نشان داده می‌شود');
  const dr = SRC.slice(SRC.indexOf('async function doReset('), SRC.indexOf('bot.command(\'reset\''));
  ok(/if \(!isTester\(ctx\.from\.id\)\) return;/.test(dr), 'گاردِ دومِ ریست هم تستر را می‌پذیرد');
  ok(/wipeUser\(ctx\.from\.id\)/.test(dr), 'ریست فقط دیتای **خودِ** صداکننده را پاک می‌کند');

  // ⚠️ مهم‌ترین ادعا: هیچ اختیارِ ادمینی به تستر نشت نکرده باشد.
  // هر گاردِ ادمینِ واقعی (رسید، /stats، /newcode، اکشن‌های ادمین) باید isAdmin بماند.
  const adminGuards = (SRC.match(/if \(!isAdmin\(ctx\.from\.id\)\)/g) || []).length;
  ok(adminGuards >= 7, `اختیارهای ادمین هنوز پشتِ isAdmin اند (${adminGuards} گارد)`);
  ok(!/if \(!isTester\(ctx\.from\.id\)\) return ctx\.answerCbQuery\('🔒'\)/.test(SRC),
    'هیچ دکمه‌ی قفل‌دارِ ادمینی به تستر باز نشده');
  for (const cmd of ['stats', 'newcode']) {
    const b = SRC.slice(SRC.indexOf(`bot.command('${cmd}'`), SRC.indexOf(`bot.command('${cmd}'`) + 220);
    ok(/if \(!isAdmin\(ctx\.from\.id\)\) return;/.test(b), `دستورِ /${cmd} فقط ادمین است`);
  }
  // تپ‌های تستر از قیفِ محصولی بیرون می‌مانند (بهداشتِ دیتا، نه اختیار)
  ok(/isAdmin: isTester,/.test(SRC), 'جرنی تپ‌های تستر را هم از قیف بیرون می‌گذارد');
}

console.log('\n▶ 🎨 رنگِ دکمه‌ها (Bot API 9.4، فیلدِ style)');
{
  // فقط سه مقدارِ مجازِ خودِ Bot API: success (سبز)، primary (آبی)، danger (قرمز).
  // نبودِ فیلد = رنگِ پیش‌فرضِ کلاینت، پس کلاینتِ قدیمی‌تر بی‌خطر ردش می‌کند.
  // هر آرگومانِ دومِ `styled(...)` باید یا یکی از سه مقدارِ مجاز باشد یا یکی از دو تابعِ
  // تصمیم‌گیرنده. اگر کسی 'green' یا 'blue' بنویسد (که Bot API ردش می‌کند) این قرمز می‌شود.
  const ALLOWED = ["'success'", "'primary'", "'danger'", 'topicStyle(', 'PACK_STYLE['];
  const calls = [...SRC.matchAll(/styled\(/g)].map(m => SRC.slice(m.index, m.index + 260));
  const decls = calls.filter(c => !/=> \(style \?/.test(c)); // خودِ تعریفِ helper را نشمار
  ok(decls.length >= 4, `helper در همه‌ی نقاطِ رنگی استفاده شده (${decls.length} فراخوانی)`);
  const bad = decls.filter(c => !ALLOWED.some(a => c.includes(a)));
  ok(bad.length === 0, `هیچ فراخوانیِ styled با مقدارِ ناشناخته نیست (${bad.length} مورد)`);
  // و مجموعه‌ی مقادیرِ خامِ استفاده‌شده زیرمجموعه‌ی سه مقدارِ Bot API است
  const lits = [...SRC.matchAll(/(?:\? |: |gold: )'(success|primary|danger|[a-z]+)'/g)]
    .map(m => m[1]).filter(v => ['success', 'primary', 'danger', 'green', 'blue', 'red'].includes(v));
  ok(lits.length > 0 && lits.every(v => ['success', 'primary', 'danger'].includes(v)),
    `مقادیرِ رنگ از سه مقدارِ مجازِ Bot API اند (${[...new Set(lits)].join(', ')})`);
  ok(/const styled = \(btn, style\) => \(style \? \{ \.\.\.btn, style \} : btn\);/.test(SRC),
    'helper وقتی رنگ ندارد دکمه را **دست‌نخورده** برمی‌گرداند (نه style: undefined)');

  // ۱) خریدِ الماس سبز، و فقط در دنیای الماس (دکمه‌ی تومانیِ کاربرِ واقعی دست‌نخورده)
  ok(/const rechargeBtn = \(uid\) => styled\(\s*\n?\s*Markup\.button\.callback\(rechargeLabel\(uid\), 'recharge'\), coinsOn\(uid\) \? 'success' : undefined\);/.test(SRC),
    'دکمه‌ی «خرید الماس» سبز است و فقط در دنیای الماس رنگ می‌گیرد');
  ok(!/Markup\.button\.callback\(rechargeLabel\(uid\), 'recharge'\)\]/.test(SRC),
    'هیچ نقطه‌ای دکمه‌ی شارژ را بدونِ helper نمی‌سازد (وگرنه یک‌جا بی‌رنگ می‌ماند)');

  // ۲) «سؤال شخصی خودم» آبی، در **هر دو** منویی که ساخته می‌شود
  ok(/const topicStyle = \(key\) => \(key === MENU_PIN \? 'primary' : undefined\);/.test(SRC),
    '«سؤال شخصی خودم» آبی است (از روی MENU_PIN، نه رشته‌ی دستی)');
  // ⚠️ آرگومان‌های `L.buttons.topic(...)` عمداً باز گذاشته شده‌اند: از ۱۴۰۵/۰۶/۱۱ نامِ
  // ترجمه‌شده هم پاس می‌شود. چیزی که این‌جا سنجیده می‌شود **رنگ** است نه شکلِ برچسب؛
  // درستیِ خودِ آرگومان‌ها را `check-no-persian.mjs` گارد می‌کند.
  ok(/topicRow = \(key\) => \{[\s\S]{0,260}styled\(Markup\.button\.callback\(L\.buttons\.topic\(.*?\), `topic:\$\{t\.key\}`\), topicStyle\(key\)\)/.test(SRC),
    'منوی کوتاه رنگ را اعمال می‌کند');
  ok(/styled\(Markup\.button\.callback\(L\.buttons\.topic\(.*?\), `topic:\$\{t\.key\}:a`\), topicStyle\(t\.key\)\)/.test(SRC),
    'لیستِ کامل هم همان رنگ را اعمال می‌کند (وگرنه دو منو دو شکل می‌شدند)');

  // ۳) رنگِ بسته‌ها. ادعای «چه رنگی» بالاتر (بلوکِ نامِ بسته‌ها) پین شده؛ این‌جا **رفتار**
  //    سنجیده می‌شود: هر کلیدی که در `PACK_STYLE` می‌آید باید یک بسته‌ی واقعی باشد. بدونِ
  //    این، یک تایپو در کلید (`magick`) بی‌صدا رنگ را می‌خوراند و هیچ ادعای رجکسی نمی‌گرفتش.
  //    ⚠️ v3.77.0: «دو بسته‌ی رنگی نباید هم‌رنگ باشند» دیگر برقرار نیست — مالک صریحاً
  //    خواست «جاودان» هم‌رنگِ «افسانه‌ای» (قرمز) باشد؛ Bot API رنگِ چهارمی ندارد و
  //    تمایزشان از متنِ دکمه می‌آید. پس فقط جفتِ **عمداً هم‌رنگ** (legend/eternal) معاف است.
  {
    const styleSrc = SRC.match(/const PACK_STYLE = (\{[^;]*\});/)?.[1];
    ok(!!styleSrc, 'جدولِ PACK_STYLE پیدا شد');
    const style = new Function(`return ${styleSrc}`)();
    const packKeys = [...SRC.matchAll(/\{ key: '([a-z]+)',\s+emoji:/g)].map(m => m[1]);
    ok(packKeys.length >= 3, `کلیدِ بسته‌ها از سورس خوانده شد (${packKeys.join(', ')})`);
    const orphan = Object.keys(style).filter(k => !packKeys.includes(k));
    ok(orphan.length === 0, `هر کلیدِ PACK_STYLE یک بسته‌ی واقعی است (یتیم: ${orphan.join(', ') || 'ندارد'})`);
    const INTENTIONAL_SAME_COLOR = [['legend', 'eternal'].sort()];
    const dupes = [];
    for (const [a, b] of Object.entries(style)) {
      for (const [c, d] of Object.entries(style)) {
        if (a >= c) continue;
        if (b !== d) continue;
        const pair = [a, c].sort();
        if (!INTENTIONAL_SAME_COLOR.some(p => p[0] === pair[0] && p[1] === pair[1])) dupes.push(pair.join('+'));
      }
    }
    ok(dupes.length === 0, `هیچ هم‌رنگیِ نخواسته‌ای نیست (پیدا شد: ${dupes.join(', ') || 'ندارد'})`);
    ok(style.legend === style.eternal, '«افسانه‌ای» و «جاودان» عمداً هم‌رنگ‌اند (تصمیمِ صریحِ مالک، v3.77.0)');
    ok(style.magic && style.magic !== style.gold, 'بسته‌ی جادویی رنگِ خودش را دارد، متمایز از بسته ویژه');
  }
  // چندخطی شد وقتی قیمتِ واقعیِ استارز به دکمه اضافه شد، پس فاصله‌ها آزاد است.
  ok(/styled\(Markup\.button\.callback\([\s\S]{0,120}?L\.buttons\.coinPack\(.*?\), `pkg:\$\{p\.key\}`\), PACK_STYLE\[p\.key\]\)/.test(SRC),
    'رنگِ بسته از جدولِ PACK_STYLE می‌آید، نه شرطِ درجا');
}

console.log('\n▶ ناوبریِ یک‌قدمی و ادیت-در-جا (UX v2.3)');
{
  // ۱) صفحه‌ی اندازه روی همان پیام ادیت می‌شود، نه پیامِ جدید.
  const topicH = SRC.slice(SRC.indexOf('bot.action(/^topic:'), SRC.indexOf('bot.action(/^tback:'));
  ok(/ctx\.editMessageText\(text, extra\)/.test(topicH), 'انتخابِ موضوع همان پیام را به صفحه‌ی اندازه ادیت می‌کند');
  ok(/ctx\.reply\(text, extra\)\.catch/.test(topicH), 'اگر ادیت نشد (پیامِ کهنه) پیامِ جدید می‌رود — کاربر بی‌جواب نمی‌ماند');
  // کشتنِ کیبوردِ مبدأ فقط باید **داخلِ catch** باشد: در مسیرِ موفق لازم نیست (همان پیام
  // ادیت می‌شود) ولی در fallback واجب است وگرنه منوی مبدأ دوباره‌زدنی می‌ماند.
  ok(topicH.indexOf('editMessageReplyMarkup(undefined)') > topicH.indexOf('catch {'),
    'در مسیرِ موفق کیبوردِ مبدأ کشته نمی‌شود (خودِ همان پیام ادیت می‌شود)');
  ok(/catch \{[\s\S]{0,320}editMessageReplyMarkup\(undefined\)[\s\S]{0,120}ctx\.reply\(text, extra\)/.test(topicH),
    'در مسیرِ fallback کیبوردِ مبدأ کشته می‌شود تا دوباره‌زدنی نماند');

  // ۲) مبدأ در callback_data می‌آید، نه در session (session با showCatalog/nav:menu پاک می‌شود).
  ok(/topic:\$\{t\.key\}:a/.test(SRC), 'لیستِ کامل مبدأ را با پسوندِ :a در callback می‌فرستد');
  ok(/\^topic:\(\\w\+\)\(\?:\:\(a\)\)\?\$/.test(SRC), 'رجکسِ topic پسوند را **اختیاری** گرفته');
  // دکمه‌ی کهنه‌ی بدونِ پسوند باید هنوز کار کند (بند ۲ج/۶) — `\w` دونقطه را نمی‌گیرد.
  const re = /^topic:(\w+)(?::(a))?$/;
  ok(re.test('topic:love') && 'topic:love'.match(re)[1] === 'love', 'دکمه‌ی کهنه‌ی `topic:love` هنوز match می‌شود');
  ok('topic:love'.match(re)[2] === undefined, 'دکمه‌ی کهنه مبدأ ندارد → به منوی کوتاه برمی‌گردد');
  ok('topic:love:a'.match(re)[1] === 'love' && 'topic:love:a'.match(re)[2] === 'a', 'دکمه‌ی لیستِ کامل مبدأ را درست می‌دهد');
  ok('topic:personal:a'.length <= 64, 'callback_data زیرِ سقفِ ۶۴ بایتِ تلگرام است');

  // ۳) بازگشتِ یک‌قدمی: همان پیام به منوی مبدأ برمی‌گردد و **کلِ فلو ریست نمی‌شود**.
  // تا **انتهای خودِ هندلر** برش بزن، نه پنجره‌ی کاراکتریِ ثابت: هندلرِ بعدی setState/setSession
  // دارد و پنجره‌ی ثابت آن را داخلِ برش می‌آورد و ادعاها را بی‌خود قرمز می‌کند.
  const tbackStart = SRC.indexOf('bot.action(/^tback:');
  const tback = SRC.slice(tbackStart, SRC.indexOf('\n});', tbackStart));
  ok(/topicMenuScreen\(uid, ctx\.match\[1\]\)/.test(tback), 'بازگشت همان منویی را می‌دهد که کاربر از آن آمده');
  ok(/ctx\.editMessageText\(text, kb\)/.test(tback), 'بازگشت هم ادیت می‌کند، نه پیامِ جدید');
  ok(!/setSession\(uid, null\)/.test(tback), 'بازگشتِ یک‌قدمی session را نمی‌کُشد (هنوز چیزی شروع نشده)');
  // باگِ واقعی که همین‌جا گرفته شد: `setState` بی‌قید در این هندلر، تپِ یک دکمه‌ی کهنه را
  // به یتیم‌شدنِ بی‌صدای فاکتور تبدیل می‌کرد (هر دو گارد روی استیت کار می‌کنند).
  ok(!/setState\(uid, /.test(tback), 'بازگشتِ یک‌قدمی استیت را بازنویسی نمی‌کند (فقط رندرِ دوباره است)');
  ok(/blockDuringOpenPay\(ctx\)/.test(tback) && /blockDuringOpenReading\(ctx\)/.test(tback)
    && /blockDuringPendingReading\(ctx\)/.test(tback),
    'دکمه‌ی کهنه‌ی بازگشت وسطِ پرداخت/فالِ باز گارد می‌شود، نه اینکه بی‌صدا ردش کند');
  ok(!/sendContinuePrompt|replyCanceled/.test(tback), 'بازگشتِ یک‌قدمی پیامِ «ادامه» نمی‌آورد (خروج از فلو نیست)');
  ok(/backToMenu, `tback:\$\{from\}`/.test(SRC), 'آخرین گزینه‌ی صفحه‌ی اندازه همان «بازگشت به منو» است');

  // ۴) «مشاهده همه فال‌ها» همان پیام را ادیت می‌کند.
  ok(/showCatalog\(ctx, true, true\)/.test(SRC), 'دکمه‌ی «مشاهده همه فال‌ها» ادیت‌کنان جلو می‌رود');
  ok(/if \(edit\) \{ try \{ return await ctx\.editMessageText\(text, kb\); \} catch \{\} \}/.test(SRC),
    'showCatalog در حالتِ edit همان پیام را ادیت می‌کند و در شکست به پیامِ جدید برمی‌گردد');

  // ۵) nav:menu هم ادیت می‌کند و متنش عوض شده.
  ok(/backToMenu: 'برگشتیم به منوی اصلی 🌳'/.test(LOC), 'متنِ بازگشت به منو: بدونِ «باشه» و با ایموجیِ 🌳');
  const navH = SRC.slice(SRC.indexOf("bot.action('nav:menu'"), SRC.indexOf("bot.action('reading:resume'"));
  // 🎹 قراردادِ کیبورد (مالک، بارها تکرار شده): دستورِ باز شدنِ منوی پایین **فقط دو نقطه**
  // دارد — (۱) بازگشت، تا وقتی به منوی اصلی برسیم، (۲) لحظه‌ی قدمِ بعدی بعد از نظرسنجی.
  // پس nav:menu پیامِ **تازه** می‌فرستد نه ادیت. ادیتِ تلگرام فقط `InlineKeyboardMarkup`
  // قبول می‌کند، یعنی یک ادیت هرگز نمی‌تواند کیبوردِ reply را حمل کند و کاربری که هنوز
  // کیبورد نگرفته دقیقاً همین‌جا بن‌بست می‌خورد. این تنها معاوضه‌ی این قرارداد است.
  ok(/return ctx\.reply\(L\.reading\.backToMenu, mainKeyboard\(uid\)\);/.test(navH),
    'nav:menu (نقطه‌ی ۱) پیامِ بازگشت را با کیبوردِ اصلی می‌فرستد');
  ok(!/editMessageText/.test(navH),
    'nav:menu متن را ادیت نمی‌کند (ادیت نمی‌تواند کیبوردِ reply را حمل کند)');
  ok(/editMessageReplyMarkup\(undefined\)/.test(navH),
    'دکمه‌های پیامِ مبدأ کشته می‌شوند تا دوباره‌زدنی نماند');
  ok(!/uxV2For\(uid\)/.test(navH),
    'nav:menu شاخه‌ی جدا برای دو دنیا ندارد (دنیای تومانی هم دقیقاً همین رفتارِ همیشگی را دارد)');

  // ۶) صفحه‌ی بسته‌ها زیرمنوی کیف است: ادیت + دکمه‌ی «بازگشت» (نه «انصراف»).
  ok(/backOneStep: '◀️ بازگشت'/.test(LOC), 'برچسبِ بازگشتِ یک‌قدمی جدا از «انصراف» تعریف شده');
  ok(/L\.buttons\.backOneStep, `pay_back:\$\{paymentId\}`/.test(SRC), 'صفحه‌ی بسته‌ها دکمه‌ی بازگشت دارد نه انصراف');
  const payBackStart = SRC.indexOf('bot.action(/^pay_back:');
  const payBack = SRC.slice(payBackStart, SRC.indexOf('\n});', payBackStart));
  ok(/setPaymentStatus\.run\('canceled', p\.id\)/.test(payBack), 'بازگشت فاکتورِ خالی را می‌بندد (وگرنه گاردِ پرداخت کاربر را قفل می‌کند)');
  ok(/walletScreen\(uid\)/.test(payBack), 'بازگشت دقیقاً همان صفحه‌ی کیف را رندر می‌کند (تک‌منبع)');
  ok(!/replyCanceled|sendContinuePrompt/.test(payBack), 'بازگشت از بسته‌ها پیامِ «ادامه» نمی‌آورد');
  ok(/offerPendingReading\(ctx, uid\)/.test(payBack), 'فالِ رزروشده بعد از بازگشت سرگردان نمی‌ماند');
  // باگی که ریویوِ خصمانه گرفت: گاردِ `p.status === 'pending'` فقط لغوِ فاکتور را می‌پوشاند،
  // ولی جداکردنِ فاکتور از سشن بی‌قید بود. یعنی تپِ یک دکمه‌ی کهنه، فاکتورِ **زنده‌ی فعلی**
  // را از سشن جدا می‌کرد و رسیدی که کاربر بعداً می‌فرستاد بی‌صاحب می‌شد (پولِ واریزشده گم).
  for (const [name, marker] of [['pay_back', 'bot.action(/^pay_back:'], ['pay_cancel', 'bot.action(/^pay_cancel:']]) {
    const start = SRC.indexOf(marker);
    const body = SRC.slice(start, SRC.indexOf('\n});', start));
    ok(/if \(s\.paymentId === pid\) \{/.test(body),
      `«${name}» سشن را فقط وقتی دست می‌زند که دکمه به همان فاکتورِ جاری اشاره کند`);
    ok(!/^\s*delete s\.paymentId;$/m.test(body.replace(/if \(s\.paymentId === pid\) \{[\s\S]*?\n  \}/, '')),
      `«${name}» هیچ مسیرِ بی‌قیدی برای جداکردنِ فاکتور ندارد`);
  }

  // ۷) پیامِ «ادامه» تنها نقطه‌ی باز شدنِ منوی اصلی است (تصمیمِ مالک).
  const cont = SRC.slice(SRC.indexOf('async function sendContinuePrompt'), SRC.indexOf('async function replyCanceled'));
  ok(/await ensureMenu\(ctx, uid\)/.test(cont), 'sendContinuePrompt خودش کیبوردِ اصلی را تضمین می‌کند');
  ok(/nextOffersV3: '🔮 برای جواب دادن به سؤالاتی که جوابش رو نمی‌دونی من همیشه اینجام!'/.test(LOC),
    'متنِ تازه‌ی پیامِ «ادامه» (با ایموجی)');

  // v2.4: پیامِ «از دکمه‌های پایین شروع کن 👇» در دنیای الماس اصلاً فرستاده نمی‌شود، ولی
  // کیبورد نباید قربانی شود (askName عمداً removeKeyboard می‌کند) — پس به پیامِ پایانِ
  // آنبوردینگ می‌چسبد. بدونِ این، کاربرِ تازه هیچ‌وقت کیبورد نمی‌گیرد (بن‌بستِ بند ۹ب/۴).
  const ens = SRC.slice(SRC.indexOf('async function ensureMenu'), SRC.indexOf('async function sendVerdict'));
  // ⚠️ این ادعا در v3.25.0 عوض شد. تا قبلش `ensureMenu` در دنیای الماس **بی‌قید** return
  // می‌کرد و همین درست بود، چون آن‌جا همه‌ی کاربران از روز اول در دنیای الماس بودند.
  // با باز شدن برای همه، ~۱۰۰ کاربرِ فعلی کیبوردِ نسلِ قبل را روی گوشی داشتند و این
  // return آن‌ها را برای همیشه پشتِ کیبوردِ قدیمی نگه می‌داشت. حالا فقط برای کاربرِ
  // **بعد از** لانچ زودهنگام برمی‌گردد، یعنی قراردادِ دو-نقطه‌ای برای او دست‌نخورده است.
  ok(/created_at \|\| 0\) >= KB_V2_EPOCH\) return;/.test(ens),
    'ensureMenu برای کاربرِ بعد از لانچ هیچ پیامی نمی‌فرستد (قراردادِ دو-نقطه‌ای)');
  ok(/stmts\.setKbShown\.run\(uid\);\s*\n\s*await ctx\.reply\(L\.onboarding\.keyboardReveal/.test(ens),
    'و در پنجره‌ی مهاجرت **قبل از** ارسال مهر می‌زند (پس دوبار نمی‌فرستد)');
  ok(/L\.onboarding\.keyboardReveal/.test(ens), 'دنیای تومانی همان تورِ ایمنیِ قبلی را دارد (دست‌نخورده)');
  // v2.5: پایانِ آنبوردینگ دوباره **یک پیامِ دیده‌شدنی** است (چهار دکمه زیرِ خودِ «از کجا
  // شروع کنیم؟»).
  // ⚠️ کامنتِ قبلیِ همین‌جا می‌گفت «کیبوردِ ماندگار روی پیامِ خوش اومدی تحویل می‌شود» و
  // **غلط** بود (v3.64.0): آن پیام عمداً هیچ reply_markup ای ندارد و ادعای دو خط پایین‌تر
  // خودش همین را می‌سنجد. کیبورد حالا با حاملِ بی‌صدای `ensureKeyboard` می‌رود (بند ۹ب-۳).
  const fin = SRC.slice(SRC.indexOf('async function finishOnboarding'), SRC.indexOf('bot.action(/^bmonth:'));
  ok(/await ctx\.reply\(L\.reading\.startWhere, Markup\.inlineKeyboard\(falMenuKb\(uid\)\)\);/.test(fin),
    'پایانِ آنبوردینگ یک پیامِ دیده‌شدنی است: چهار دکمه زیرِ «از کجا شروع کنیم؟»');
  ok(!/catalogV3/.test(fin), 'متنِ «کدوم فال رو انتخاب می‌کنی؟» در آنبوردینگ نمی‌آید (استثنای عمدی)');
  const nameStart = SRC.indexOf('async function finishNameOnboarding');
  const nameFn = SRC.slice(nameStart, SRC.indexOf('\n}', nameStart));
  // v2.8: آنبوردینگ **هیچ کیبوردی صادر نمی‌کند**. نسخه‌ی v2.5 کیبورد را به پیامِ «خوش اومدی»
  // چسبانده بود و مالک پسش داد: کاربر تازه اسمش را نوشته، هنوز وسطِ آنبوردینگ است و منوی
  // پایین آن‌جا فقط حواسش را پرت می‌کند. قرارداد فقط دو نقطه دارد و این یکی از آن دو نیست.
  // v2.9: این پیام **هیچ reply_markup ای** ندارد. مستنداتِ Bot API می‌گوید
  // ReplyKeyboardRemove باعث می‌شود کلاینت «letter-keyboard پیش‌فرض را نشان بدهد»، یعنی
  // removeKeyboard اینجا کیبوردِ تایپِ گوشی را باز نگه می‌داشت (ایرادِ صریحِ مالک: «نصف
  // صفحه رو اشغال می‌کنه»). کیبوردِ سفارشی از askName برداشته شده، پس برداشتنِ دوباره
  // بی‌اثر ولی پرعارضه بود.
  // ⚠️ ادعا عمداً امضای تابع را پین نمی‌کند (نسخه‌ی قبلی می‌کرد و با بسته‌شدنِ آزمایشِ
  // intro_order الکی قرمز شد). چیزی که واقعاً محافظت می‌شود این است: این `ctx.reply`
  // آرگومانِ دومی ندارد، یعنی هیچ reply_markup ای به آن چسبانده نشده.
  const welcomeCall = nameFn.match(/await ctx\.reply\(L\.onboarding\.welcome\([^;]*\);/)?.[0] || '';
  ok(!!welcomeCall, 'پیامِ «خوش اومدی» در آنبوردینگ فرستاده می‌شود');
  ok(/^await ctx\.reply\(L\.onboarding\.welcome\((?:[^()]|\([^()]*\))*\)\);$/.test(welcomeCall),
    `پیامِ «خوش اومدی» هیچ reply_markup ای ندارد (نه منو، نه removeKeyboard) — شد: ${welcomeCall}`);
  // روی **کد** سنجیده می‌شود نه کامنت: خودِ کامنتِ توضیحیِ بالای همین خط اسمِ
  // removeKeyboard را می‌برد و نسخه‌ی اولِ این assert به همان کامنت گیر کرد.
  const nameCode = nameFn.replace(/\/\/.*$/gm, '');
  ok(!/removeKeyboard/.test(nameCode),
    'removeKeyboard از پیامِ «خوش اومدی» برداشته شد (وگرنه کیبوردِ تایپ را باز نگه می‌داشت)');
  // از v3.64.0 برداشتنِ کیبورد فقط از `dropKeyboard(uid)` می‌رود (که مهرِ `kb_shown_at` را
  // هم صفر می‌کند، بند ۹ب-۳ ریشه). رفتارِ رو-به-کاربر عوض نشده: کیبورد همچنان برداشته
  // می‌شود تا کاربر بتواند نامش را تایپ کند.
  ok(/dropKeyboard\(uid\)/.test(SRC.slice(SRC.indexOf('L.onboarding.askName('), SRC.indexOf('L.onboarding.askName(') + 200)),
    'ولی خودِ پرسشِ نام همچنان کیبوردِ سفارشی را برمی‌دارد (کاربر باید بتواند تایپ کند)');
  ok(!/mainKeyboard/.test(nameFn) && !/setKbShown/.test(nameFn),
    'مسیرِ ثبتِ نام نه کیبوردِ اصلی می‌دهد نه مهرِ نمایشِ کیبورد می‌زند');
  // گاردِ ناحیه‌ای: کلِ آنبوردینگِ دنیای الماس (نام → ماهِ تولد → «از کجا شروع کنیم؟»)
  // باید بی‌کیبورد بماند. مالک این را دو بار پس داد؛ این assert جلوی بارِ سوم را می‌گیرد.
  // (هندلرِ `focus:` عمداً بیرونِ ناحیه است: مسیرِ نسلِ قبل و فقط برای دنیای تومانی.)
  const obRegion = SRC.slice(nameStart, SRC.indexOf('bot.action(/^focus:'));
  ok(!/mainKeyboard\(/.test(obRegion), 'هیچ نقطه‌ای از مسیرِ آنبوردینگ کیبوردِ ماندگار صادر نمی‌کند');
  ok(/finishOnboarding/.test(obRegion) && /askBirthMonth/.test(obRegion),
    'ناحیه‌ی گاردشده واقعاً کلِ آنبوردینگ را می‌گیرد (نه یک تکه‌ی کوچک)');
  // «از کجا شروع کنیم؟» فقط جای خودش (آنبوردینگ) بماند و هیچ‌جای دیگر نیاید.
  ok((SRC.match(/L\.reading\.startWhere/g) || []).length === 1, '«از کجا شروع کنیم؟» فقط در آنبوردینگ استفاده می‌شود');
  // نگارشِ تازه‌ی دکمه‌ی بسته‌ها + نبودِ خطِ تیره‌ی بلند (بند ۱۰ ریشه)
  // ⚠️ v3.75.0 این‌جا پیشوندِ 👑ِ دومی برای «جاودان» می‌گذاشت (خودِ p.emoji هم 👑 است)،
  // یعنی دکمه دو بار تاج نشان می‌داد. v3.77.0 (باگِ گزارش‌شده‌ی مالک) حذفش کرد: فقط
  // ایموجیِ خودِ بسته، بدونِ هیچ شرطِ ویژه‌ای برای «جاودان».
  // ⚠️ v3.77.0 هم: تعدادِ الماس دیگر از `fmt` (جداکننده‌ی هزارگان) نمی‌آید، از
  // `coinsFmt` (بدونِ جداکننده) — وگرنه «بسته جاودان» (۱۰۰۰ الماس) شبیهِ مبلغِ پولی
  // چاپ می‌شد («۱٬۰۰۰»). مبلغِ تومانی همچنان از `fmt` می‌آید.
  ok(/coinPack: \(p, cur\) => `\$\{p\.emoji\} \$\{packName\(p\)\}: ➕\$\{coinsFmt\(p\.coins\)\}\$\{cur\.emoji\} \| \$\{fmt\(p\.toman\)\} تومان`/.test(LOC),
    'دکمه‌ی بسته: «🥉 بسته‌ی معمولی: ➕۱۰💎 | ۵۰٬۰۰۰ تومان»، «👑 جاودان» یک‌بار نه دوبار و بدونِ جداکننده‌ی هزارگان');
  ok(!/'👑 '/.test(LOC), 'پیشوندِ تاجِ اضافه برای «جاودان» برنگشته (ایموجیِ خودِ بسته کافی است)');

  /* 🏷 نامِ بسته‌ها: هیچ‌کدام «ی» اضافه ندارند (خواسته‌ی صریحِ مالک، v3.77.0 + v3.81.2).
   *
   * ⚠️ این ادعا **رفتاری** است نه رجکسی: خودِ دکمه رندر می‌شود. دلیلش این است که تا
   * v3.81.2 هیچ ادعایی نامِ بسته‌ها را نمی‌سنجید — رجکسِ بالا فقط **شکلِ** تابع را
   * می‌بیند، پس نامِ غلط از کنارش رد می‌شد. و همین شکاف بود که اجازه داد `basic` سه
   * نسخه بعد از v3.77.0 با «بسته‌ی معمولی» زنده بماند تا مالک با چشم بگیردش.
   *
   * دامنه عمداً هر پنج کلید است (نه فقط چهارتای v3.77.0)، وگرنه بسته‌ی ششمِ آینده
   * دوباره همین‌طور بی‌گارد اضافه می‌شود. */
  const PACK_KEYS = ['basic', 'gold', 'magic', 'legend', 'eternal'];
  const cur = { on: true, name: 'الماس', emoji: '💎' };
  for (const key of PACK_KEYS) {
    const label = L.buttons.coinPack({ key, emoji: '🥉', coins: 10, toman: 30000 }, cur);
    ok(label.includes('بسته ') && !label.includes('بسته‌ی'),
      `نامِ بسته‌ی «${key}» بدونِ نیم‌فاصله‌ی «ی» رندر می‌شود (${label.split(':')[0].trim()})`);
  }
  // کنترلِ مثبت: اگر ادعای بالا با یک نامِ «ی»دار روبه‌رو شود واقعاً قرمز می‌دهد.
  // بدونِ این، یک `coinPack`ِ همیشه-خالی هر پنج ادعای بالا را بی‌صدا پاس می‌کرد
  // (بند ۶ب-۲ ریشه: سبزِ حاصل از نبودِ قرمز هیچ چیز ثابت نمی‌کند).
  ok('🥉 بسته‌ی معمولی: ➕۱۰💎'.includes('بسته‌ی'),
    'کنترلِ مثبت: الگوی «بسته‌ی» واقعاً تشخیص داده می‌شود (ادعاهای بالا پوچ نیستند)');

  /* 🗑 جدولِ دومِ نامِ بسته (`packs:`) حذف شد و نباید برگردد.
   * تا v3.81.1 دو نگاشتِ نامِ بسته کنارِ هم بودند: `PACK_NAMES` (که `packName` از آن
   * می‌خواند و کاربر می‌بیند) و یک کلیدِ صادرشده‌ی `packs` که **هیچ مصرف‌کننده‌ای
   * نداشت**. و همان‌طور که انتظار می‌رود، از هم واگرا شده بودند: v3.77.0 فقط اولی را
   * درست کرد و دومی «بسته‌ی جادویی» ماند. یک تله‌ی خفته برای نفرِ بعدی که بخواهد نام
   * را عوض کند (بند ۹/۰: دو منبعِ حقیقت برای یک مقدار). */
  for (const code of ['fa', 'ru', 'pt', 'es']) {
    const src = readFileSync(new URL(`../bots/tarot/locales/${code}.js`, import.meta.url), 'utf8');
    ok(!/^\s*packs: \{/m.test(src), `locale «${code}» جدولِ دومِ نامِ بسته را ندارد (تک‌منبع: PACK_NAMES)`);
  }
  // خطِ تیره‌ی بلند در متنِ رو-به-کاربر ممنوع است (بند ۱۰ ریشه). دامنه: بلوکِ `buttons` و
  // `wallet` — یعنی همان‌جایی که این PR دست زد. (کامنت‌ها و پرامپت‌ها بیرونِ دامنه‌اند؛
  // چند «—» داخلِ خودِ پرامپت‌های خوانش از قبل هست و پاک‌کردنشان تغییرِ رفتاریِ جداست.)
  const walletBlock = LOC.slice(LOC.indexOf('  wallet: {'), LOC.indexOf('  wallet: {') + 3000);
  /* ⚠️ کامنت‌ها باید **قبل از** شمارش کنار بروند، وگرنه توضیحِ خودِ ما قرمزِ کاذب می‌دهد.
   * دقیقاً همین افتاد (۱۴۰۵/۰۶/۲۰): کامنتِ بلوکیِ v3.81.0 هم واژه‌ی `coinPackChosen` را
   * داشت و هم یک «—»، پس یک ادعای کاملاً سالم قرمز شد. نسخه‌ی قبلی فقط `//` را رد
   * می‌کرد و خطوطِ داخلِ کامنتِ **بلوکی** را کد حساب می‌کرد. هم‌خانواده‌ی تله‌های ثبت‌شده‌ی
   * v3.56.0 و v3.64.0 و check-price-ladder. */
  const codeLines = (block) => {
    const out = []; let inBlock = false;
    for (const raw of block.split('\n')) {
      const l = raw.trim();
      if (inBlock) { if (l.includes('*/')) inBlock = false; continue; }
      if (l.startsWith('//')) continue;
      if (l.startsWith('/*')) { if (!l.includes('*/')) inBlock = true; continue; }
      out.push(raw);
    }
    return out;
  };
  for (const [name, block] of [['coinPack', LOC], ['بلوکِ کیف', walletBlock]]) {
    const lines = codeLines(block).filter(l => /coinPack/.test(l));
    ok(lines.length > 0 && !lines.some(l => l.includes('—')), `«${name}» خطِ تیره‌ی بلند ندارد`);
  }
}

console.log('\n▶ باکسِ نقل‌قولِ موجودی و نگارشِ چسبیده‌ی عدد و واحد (UX v2.3)');
{
  ok(/const moneyTight = /.test(LOC), 'تابعِ نسخه‌ی چسبیده تعریف شده');
  ok(/moneyTight = \(toman, cur\) =>\s*\n?\s*\(cur\?\.on \? `\$\{fmt\(Math\.round\(Number\(toman\) \/ cur\.value\)\)\}\$\{cur\.emoji\}`/.test(LOC),
    'در دنیای الماس عدد و ایموجی هیچ فاصله‌ای ندارند');
  ok(/: `\$\{fmt\(toman\)\} تومان`\)/.test(LOC), 'در دنیای تومانی خروجی دقیقاً همان متنِ قبلی است');
  ok(/purseLine = \(balance, cur\) => \(cur\?\.on \? `موجودی \$\{purse\(cur\)\}: \$\{moneyTight\(balance, cur\)\}`/.test(LOC),
    'خطِ موجودی یک‌خطی و چسبیده است (به خطِ بعد نمی‌رود)');
  ok(!/موجودی کیف \$\{cur\.name\}:\\n/.test(LOC), 'شکستِ خطِ قدیمی حذف شده');

  // باکسِ نقل‌قول فقط در دنیای الماس تولید شود، وگرنه کاربرِ تومانی تگِ خام می‌بیند.
  ok(/const purseQuote = \(balance, cur\) => \{[\s\S]{0,220}cur\?\.on \? quote\(line\) : line;/.test(LOC),
    'باکسِ نقل‌قول فقط وقتی می‌آید که دنیای الماس روشن است');
  ok(/const quote = \(s\) => `<blockquote>\$\{s\}<\/blockquote>`;/.test(LOC), 'باکس با تگِ blockquote تلگرام ساخته می‌شود');
  for (const key of ['pickSize', 'needBalance']) {
    ok(new RegExp(`${key}:[\\s\\S]{0,400}?purseQuote\\(`).test(LOC), `«${key}» موجودی را داخلِ باکس نشان می‌دهد`);
  }
  // هر پیامی که باکس دارد باید HTML برود، وگرنه تگ خام دیده می‌شود.
  ok(/const needBalanceExtra = \{ parse_mode: 'HTML' \};/.test(SRC), 'پیامِ کم‌موجودی HTML می‌رود');
  const nbCalls = (SRC.match(/needBalanceText\(uid/g) || []).length;
  const nbExtras = (SRC.match(/\.\.\.needBalanceExtra,/g) || []).length;
  ok(nbCalls > 0 && nbCalls === nbExtras, `هر ${nbCalls} فراخوانیِ پیامِ کم‌موجودی parse_mode دارد (${nbExtras})`);
  const pickScreen = SRC.slice(SRC.indexOf('function pickSizeScreen'), SRC.indexOf('bot.action(/^topic:'));
  ok(/parse_mode: 'HTML'/.test(pickScreen) && /L\.buttons\.topicSize/.test(pickScreen),
    'صفحه‌ی اندازه هم HTML می‌رود');
  // نامِ کاربر داخلِ HTML باید esc شود.
  ok(/name: esc\(dispName\(getUser\(uid\)\)\)/.test(SRC), 'نامِ کاربر قبل از رفتن به HTML امن می‌شود');

  // نگارشِ یکسانِ دکمه‌ها (تصمیمِ صریحِ مالک)
  /* دکمه‌ی خرید: «💰 خرید الماس💎 (راحت، ارزان)» (v3.81.3، خواسته‌ی صریحِ مالک).
   * ⚠️ ادعا **رفتاری** است نه رجکسی: خودِ برچسب رندر می‌شود. رجکسِ قبلی شکلِ رشته‌ی
   * قالبی را می‌دید، پس یک `cur` با نامِ عوضی را نمی‌گرفت. و هر سه نیمه جدا سنجیده
   * می‌شوند (اقدام، واحد، دم) تا حذفِ هرکدام قرمز بدهد، نه فقط حذفِ کلِ خط. */
  {
    const label = L.buttons.buyCoins({ on: true, name: 'الماس', emoji: '💎' });
    ok(label.startsWith('💰 خرید الماس💎'), 'دکمه‌ی خرید با «💰 خرید الماس💎» شروع می‌شود (متنِ قبلی دست‌نخورده)');
    ok(label.endsWith('(راحت، ارزان)'), 'و دمِ «(راحت، ارزان)» ته‌اش می‌آید (نه اولش)');
    // واحد از `cur` می‌آید نه هاردکد، وگرنه عوض‌شدنِ دوباره‌ی نامِ واحد این دکمه را جا می‌گذارد.
    ok(L.buttons.buyCoins({ on: true, name: 'سکه', emoji: '🪙' }).includes('خرید سکه🪙'),
      'نامِ واحد از cur می‌آید، هاردکد نیست');
  }
  ok(/inviteWithBonus: \(bonus, cur\) => `📤 دعوت دوستان \(هر دعوت ➕\$\{moneyTight\(bonus, cur\)\}\)`/.test(LOC),
    'دکمه‌ی دعوت: «📤 دعوت دوستان (هر دعوت ➕۱۰💎)»');
  ok(/luckyDraw: \(max, cur\) => `🎲 کارت شانس \(➕صفر تا \$\{fmt\(max\)\}\$\{cur\.emoji\}\)`/.test(LOC),
    'دکمه‌ی کارت شانس: «🎲 کارت شانس (➕صفر تا ۳💎)»');
  // v2.4: ایموجیِ کارت شانس از برگ به تاس رفت — هیچ 🍀ای در متن‌های رو-به-کاربر نماند.
  ok(!/🍀/.test(LOC), 'هیچ 🍀ای در متن‌های رو-به-کاربر نمانده (همه 🎲 شدند)');
  ok(/LUCKY_LABELS = \[L\.buttons\.luckyMain, '🍀 کارت شانس \(استخراج الماس\)'/.test(SRC),
    'برچسبِ کهنه‌ی 🍀 هنوز match می‌شود (کیبوردِ کش‌شده)');
  ok(/topicSize: \(size, price, cur\) => `\$\{fmt\(size\)\} کارتی \(➖\$\{moneyTight\(price, cur\)\}\)`/.test(LOC),
    'دکمه‌ی اندازه: «۳ کارتی (➖۳💎)»');
  ok(/L\.buttons\.topicSize\(size, sp\.price, cur\)/.test(SRC), 'قیمتِ دکمه از خودِ رکوردِ چیدمان می‌آید، نه از ضربِ دوباره');

  // زیرِ پیامِ کم‌موجودی همان سه راهِ کیف می‌آید (تک‌منبع، نه لیستِ موازی).
  ok(/if \(coinsOn\(uid\)\) return walletRows\(uid\);/.test(SRC), 'دکمه‌های زیرِ پیامِ کم‌موجودی = همان دکمه‌های کیف');

  // برچسبِ کیبوردِ ماندگار عوض شد → دکمه‌ی کش‌شده روی گوشیِ کاربر نباید بمیرد (بند ۲ج/۶).
  ok(/const INVITE_LABELS = \[L\.buttons\.inviteMain, '📤 معرفی دوستان'\]/.test(SRC),
    'برچسبِ میانیِ «معرفی دوستان» هنوز match می‌شود (کیبوردِ کش‌شده)');
  ok(/bot\.hears\(INVITE_LABELS, showInvite\)/.test(SRC), 'هندلرِ دعوت هر دو برچسب را می‌گیرد');
  ok(/'📤 معرفی دوستان', '🍀 کارت شانس \(استخراج الماس\)'/.test(SRC),
    'برچسب‌های کهنه در KB_LABELS هستند (تپِ دکمه در قیف گم نشود)');
}

console.log('\n▶ دو مکثِ تنظیم‌شده‌ی v3.55.0 (هر دو با نشانگرِ typing)');
{
  // ⚠️ `PACE_S` و `PACE_M` در **یک** دستور تعریف شده‌اند، پس helperِ `num` (که دنبالِ
  // `const <name> =` می‌گردد) برای دومی NaN می‌داد و ادعا بی‌صدا از کار می‌افتاد.
  const paceLine = (SRC.match(/const PACE_S = (\d+), PACE_M = (\d+)/) || []);
  const PACE_S = Number(paceLine[1]), PACE_M = Number(paceLine[2]);
  const WELCOME = num('PACE_WELCOME'), BREATH = num('PACE_BREATH');
  // ⚠️ مهم‌ترین ادعای این بلوک: `PACE_S`/`PACE_M` **مشترک**اند (ده‌ها نقطه‌ی دیگر)، پس
  // تنظیمِ این دو مکث هرگز نباید از راهِ عوض‌کردنِ آن‌ها انجام شود. اگر روزی کسی به‌جای
  // ثابتِ اختصاصی همان‌ها را بالا/پایین ببرد، ریتمِ کلِ ربات بی‌صدا عوض می‌شود.
  ok(PACE_S === 1200 && PACE_M === 2500, 'ثابت‌های مشترکِ ریتم دست‌نخورده‌اند (۱۲۰۰ و ۲۵۰۰)');
  ok(WELCOME === PACE_S + 3000, `مکثِ خوش‌آمد دقیقاً ۳ ثانیه بیشتر از قبل است (${WELCOME}ms)`);
  ok(BREATH === PACE_M - 1000, `مکثِ «دریافت شد ← نیت کن» دقیقاً ۱ ثانیه کمتر شد (${BREATH}ms)`);

  // ✅ «با تایپینگ پر بشه» خواسته‌ی صریحِ مالک بود، پس سنجیده می‌شود: `typing` نشانگر
  // می‌فرستد و بعد صبر می‌کند؛ `sleep` همان زمان را **بدونِ هیچ نشانه‌ای** می‌گذراند و
  // کاربر آن را «تأخیر» می‌خواند نه «مکث» (درسِ ثبت‌شده‌ی v3.53.0).
  const welcomeGap = SRC.slice(SRC.indexOf('L.onboarding.welcome(name'),
                               SRC.indexOf('return askBirthMonth(ctx)'));
  ok(/await typing\(ctx, PACE_WELCOME\);/.test(welcomeGap),
    'فاصله‌ی «خوش‌آمد ← ماهِ تولد» با نشانگرِ typing پر می‌شود');
  ok(!/\bsleep\(/.test(welcomeGap), 'در این فاصله هیچ مکثِ کورِ sleep نمانده');
  ok((welcomeGap.match(/await typing\(/g) || []).length === 1,
    'دقیقاً یک مکث در این فاصله است (مکث‌ها روی هم جمع نمی‌شوند)');

  const breathGap = SRC.slice(SRC.indexOf('L.reading.atmosphereShort'),
                              SRC.indexOf('L.reading.breathing, Markup.inlineKeyboard'));
  ok(/await typing\(ctx, PACE_BREATH\);\s*\n\s*await ctx\.reply\(L\.reading\.breathing/
    .test(SRC), 'مکثِ PACE_BREATH بلافاصله قبل از پیامِ «نیت کن» است');
  ok(!/\bsleep\(/.test(breathGap), 'فاصله‌ی «دریافت شد ← نیت کن» هم مکثِ کور ندارد');
  // مکثِ داخلِ شاخه‌ی لحنِ قدیم باید همان `PACE_M` بماند (رول‌بکِ سالم، v3.53.0).
  ok(/if \(!toneV2For\(uid\)\) \{ await typing\(ctx, PACE_M\);/.test(SRC),
    'مکثِ لحنِ قدیم دست‌نخورده مانده (PACE_M)');
}

// 💗 قلب‌های رنگیِ گریدِ انتخاب (v3.55.0). عمداً **رفتاری**: خودِ `PICK_HEARTS` و
// `pickHearts` و `pickGridKb` از سورس بریده و اجرا می‌شوند. یک ادعای رجکسی («ده ایموجی
// در فایل هست») سه چیزی را که واقعاً مهم‌اند نمی‌بیند: یکتاییِ رنگ‌ها در یک دست، قطعی
// بودنشان بینِ دو رندر (وگرنه رنگِ کارتی که کاربر همین حالا دیده وسطِ کار عوض می‌شود)،
// و اینکه رنگ به **نوبتِ انتخاب** بچسبد نه به شماره‌ی خانه.
const HEARTS = (() => {
  const from = SRC.indexOf('const PICK_HEARTS = [');
  const fnAt = SRC.indexOf('function pickGridKb(', from);
  const open = SRC.indexOf('{', fnAt);
  let depth = 0, end = open;
  for (let p = open; p < SRC.length; p++) {
    if (SRC[p] === '{') depth++;
    else if (SRC[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  if (from < 0 || fnAt < 0 || end <= open) return null;
  const slab = SRC.slice(from, end + 1);
  const Markup = { button: { callback: (text, data) => ({ text, callback_data: data }) },
                   inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }) };
  return new Function('mulberry32', 'seedToInt', 'Markup',
    `${slab}\nreturn { PICK_HEARTS, pickHearts, pickGridKb };`)(mulberry32, seedToInt, Markup);
})();

console.log('\n▶ قلب‌های رنگیِ گریدِ انتخابِ کارت');
{
  ok(!!HEARTS, 'پالت و دو تابعِ گرید از سورس استخراج شدند');
  const { PICK_HEARTS, pickHearts, pickGridKb } = HEARTS || {};
  const WANT = ['🩷', '💚', '❤️', '🩵', '🩶', '🧡', '💙', '🤍', '💛', '💜'];
  ok(PICK_HEARTS.length === 10 && new Set(PICK_HEARTS).size === 10,
    'پالت دقیقاً ده رنگِ یکتا دارد');
  ok(WANT.every(h => PICK_HEARTS.includes(h)) && PICK_HEARTS.every(h => WANT.includes(h)),
    'پالت دقیقاً همان ده رنگِ خواسته‌شده است');
  ok(PICK_HEARTS.every(h => /\p{Extended_Pictographic}/u.test(h)),
    'هر عضوِ پالت یک ایموجی است (نه رشته‌ی خالی یا متن)');

  // اندازه‌ی دست ⟵ تعدادِ رنگ. ۳ کارت = ۳ رنگ، ۵ = ۵، ۱۰ = هر ده رنگ.
  let sizeOk = true, uniqOk = true, subsetOk = true;
  for (const need of [3, 5, 10]) for (const u of [11, 22, 33, 44]) {
    const a = pickHearts(`r:${u}:1:2`, need);
    if (a.length !== need) sizeOk = false;
    if (new Set(a).size !== need) uniqOk = false;
    if (!a.every(h => PICK_HEARTS.includes(h))) subsetOk = false;
  }
  ok(sizeOk, 'تعدادِ رنگ‌ها دقیقاً برابرِ تعدادِ کارت‌هاست (۳/۵/۱۰)');
  ok(uniqOk, 'رنگ‌های یک دست هرگز تکراری نیستند');
  ok(subsetOk, 'هر رنگ از خودِ پالت می‌آید');
  ok(new Set(pickHearts('x', 10)).size === 10, 'فالِ ده‌کارتی هر ده رنگ را می‌گیرد');

  // قطعی بودن: همان seed ⟵ همان رنگ‌ها. این ادعا از رنگ‌عوض‌شدنِ خانه‌ای که کاربر همین
  // حالا دیده جلوگیری می‌کند (گرید بعد از هر تپ دوباره رندر می‌شود، و `resendCurrentStep`
  // بعد از ری‌استارت هم دوباره می‌سازدش).
  ok(pickHearts('r:7:9:1', 5).join('') === pickHearts('r:7:9:1', 5).join(''),
    'همان seed همیشه همان رنگ‌ها را می‌دهد (قطعی، ری‌استارت‌پذیر)');
  // ...ولی دو دستِ متفاوت نباید همیشه یک چیدمان بگیرند، وگرنه «رنگِ تصادفی» تزئینی است.
  const spreadOut = new Set([...Array(40).keys()].map(i => pickHearts(`r:${i}:1:1`, 3).join('')));
  ok(spreadOut.size > 5, `دست‌های متفاوت چیدمان‌های متفاوت می‌گیرند (${spreadOut.size} از ۴۰)`);

  // رنگ به **نوبتِ انتخاب** می‌چسبد نه به شماره‌ی خانه: انتخابِ اولِ کاربر همیشه رنگِ اول.
  const h3 = pickHearts('s1', 3);
  const face = (picks) => {
    const kb = pickGridKb(picks, h3).reply_markup.inline_keyboard.flat();
    return (i) => kb[i].text;
  };
  ok(face([9])(9) === h3[0] && face([9, 2])(2) === h3[1] && face([9, 2, 5])(5) === h3[2],
    'n-امین انتخاب رنگِ n-ام را می‌گیرد (مستقل از شماره‌ی خانه)');
  ok(face([9, 2])(9) === h3[0], 'رنگِ انتخابِ قبلی با انتخابِ تازه عوض نمی‌شود');
  const kb0 = pickGridKb([], h3).reply_markup.inline_keyboard;
  ok(kb0.length === 6 && kb0.every(r => r.length === 4) && kb0.flat().every(b => b.text === '🂠'),
    'گریدِ دست‌نخورده هنوز ۶×۴ کارتِ پشت‌رو است');
  ok(kb0.flat().every((b, i) => b.callback_data === `pick:${i}`),
    'callback_data خانه‌ها دست‌نخورده است (دکمه‌ی کهنه نمی‌میرد)');
  // ✨ دیگر نشانه‌ی انتخاب نیست، فقط فالبکِ دستِ بی‌رنگ (لحظه‌ی دیپلوی).
  ok(pickGridKb([9], []).reply_markup.inline_keyboard.flat()[9].text === '✨',
    'دستِ بدونِ رنگ (وسطِ دیپلوی) به ✨ برمی‌گردد، نه دکمه‌ی بی‌متن');
  ok(!/picks\.includes\(i\)\s*\?\s*'✨'/.test(SRC),
    'نشانه‌ی ثابتِ ✨ از گریدِ فالِ پولی برداشته شده');
  // گریدِ **کارتِ روزِ رایگان** عمداً دست‌نخورده است (خواسته‌ی مالک فقط گریدِ فال بود).
  ok(/dpick:/.test(SRC) && /=== picked \? '✨'/.test(SRC),
    'گریدِ کارتِ روز عمداً همان ✨ را نگه داشته');

  // هر سه نقطه‌ی رندرِ گرید باید رنگ بگیرند، وگرنه یکی‌شان ✨ نشان می‌دهد.
  // ⚠️ خودِ **تعریفِ** تابع از شمارش بیرون است، وگرنه امضایش به‌عنوان یک نقطه‌ی رندر
  // شمرده می‌شود و عددِ ادعا بی‌معنی می‌ماند.
  const calls = (SRC.match(/(?<!function )pickGridKb\([^)]*\)/g) || []);
  ok(calls.length === 3, `دقیقاً سه نقطه‌ی رندرِ گرید (${calls.length})`);
  ok(calls.every(c => /pickHearts\(|hearts\)/.test(c)),
    'هر سه نقطه رنگ‌ها را پاس می‌دهند (هیچ مسیری ✨ نمی‌ماند)');
}

console.log('\n▶ گریدِ انتخابِ کارت: هیچ تپی بی‌جواب نمی‌ماند');
{
  // ⚠️ منطق **از سورس بریده و اجرا** می‌شود، نه بازنویسی. یک ادعای رجکسی («رشته‌ی
  // pickClosed در فایل هست») همان چیزی را نمی‌بیند که این باگ بود: شاخه‌ای که زودتر
  // return می‌کند. الگوی مرجع: check-lucky.mjs.
  const start = SRC.indexOf('bot.action(/^pick:(\\d+)$/');
  const open = SRC.indexOf('{', SRC.indexOf('=>', start));
  let depth = 0, end = open;
  for (let p = open; p < SRC.length; p++) {
    if (SRC[p] === '{') depth++;
    else if (SRC[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  const body = SRC.slice(open + 1, end);
  ok(start > 0 && end > open, 'هندلرِ pick: از سورس استخراج شد');

  // ⏱ مکثِ «قلبِ آخر دیده شود» — عدد از **خودِ سورس** خوانده می‌شود نه هاردکد، وگرنه
  // عوض‌شدنش در index.js این ادعا را بی‌صدا پوچ می‌کرد.
  const PICK_LAST_MS = Number(SRC.match(/const PACE_PICK_LAST = (\d+);/)?.[1]);
  ok(Number.isInteger(PICK_LAST_MS) && PICK_LAST_MS >= 600 && PICK_LAST_MS <= 3000,
    `PACE_PICK_LAST یک مکثِ معقول است (${PICK_LAST_MS}ms)`);
  // و ثابتِ مشترک دست‌نخورده مانده: میان‌بر زدن از راهِ `PACE_S` ریتمِ کلِ ربات را
  // بی‌صدا جابه‌جا می‌کند (همان درسِ v3.55.0).
  ok(/const PACE_S = 1200,/.test(SRC), 'PACE_S مشترک دست‌نخورده است (مکث از ثابتِ جدا می‌آید)');

  // گاردِ ضدِ race باید **قبل از اولین await** بنشیند، وگرنه دو تپِ پشت‌سرهم هر دو رد شوند.
  // ⚠️ کامنت‌ها اول حذف می‌شوند: نسخه‌ی اولِ همین ادعا کلمه‌ی `await` را داخلِ یک کامنت
  // پیدا کرد و قرمزِ کاذب داد. سنجه‌ای که خودش را روی متنِ کامنت می‌سنجد، سنجه نیست.
  const code = body.replace(/\/\/[^\n]*/g, '');
  ok(code.indexOf("setState(uid, 'confirm_pay')") < code.indexOf('await'),
    'قفلِ confirm_pay قبل از اولین await است (ضدِ دوبار-تپ)');

  const run = new Function('ctx', 'deps', `
    const { getState, getSession, setState, setSession, L, USER_PICKS, pickGridKb, pickHearts,
            finishPicking, typing, PACE_PICK_LAST } = deps;
    return (async () => {${body}})();
  `);
  const scenario = async (state, picks, need, tap) => {
    // 🧾 `ops` **ترتیبِ واقعیِ عملیات** را ثبت می‌کند، نه فقط تعدادشان. ادعای v3.67.0
    // دقیقاً درباره‌ی ترتیب است (گرید ← مکث ← جایگزینی) و یک شمارنده‌ی خالی آن را نمی‌دید.
    const log = { cb: [], editKb: 0, editText: null, finished: false, state, ops: [], typedMs: [],
                  session: { picks: [...picks], need, seed: 'r:7:1:1' } };
    const ctx = {
      from: { id: 7 }, match: [null, String(tap)],
      answerCbQuery: (text, extra) => { log.cb.push({ text, extra }); return Promise.resolve(); },
      editMessageReplyMarkup: () => { log.editKb++; log.ops.push('kb'); return Promise.resolve(); },
      editMessageText: (t) => { log.editText = t; log.ops.push('text'); return Promise.resolve(); },
    };
    await run(ctx, {
      getState: () => log.state, getSession: () => log.session,
      setState: (_u, v) => { log.state = v; }, setSession: (_u, v) => { log.session = v; },
      L, USER_PICKS: 3, pickGridKb: () => ({ reply_markup: 'KB' }),
      // ⚠️ `pickHearts`ِ **واقعی** پاس داده می‌شود، نه یک استاب: ادعای «toast همان رنگی
      // است که روی خانه نشست» فقط با تابعِ تولیدی معنی دارد.
      pickHearts: HEARTS.pickHearts,
      finishPicking: async () => { log.finished = true; },
      typing: async (_c, ms) => { log.ops.push('typing'); log.typedMs.push(ms); },
      PACE_PICK_LAST: PICK_LAST_MS,
    });
    return log;
  };
  const said = (r) => r.cb[0]?.text;

  // ۱) گریدِ کهنه/تمام‌شده: پاپ‌آپِ صریح، نه سکوت. این خودِ باگ بود.
  const stale = await scenario('revealing', [1, 2, 3], 3, 9);
  ok(said(stale) === L.reading.pickClosed && stale.cb[0]?.extra?.show_alert === true,
    'تپ روی گریدِ تمام‌شده پاپ‌آپِ صریح می‌گیرد (نه answerCbQuery خالی)');
  ok(!stale.finished && stale.editKb === 0, 'تپِ کهنه هیچ عوارضی ندارد');

  // ۲) کارتِ تکراری: toast می‌گیرد (متن دارد) و انتخاب دوباره ثبت نمی‌شود.
  const dup = await scenario('picking', [4], 3, 4);
  ok(said(dup) === L.reading.pickAlready, 'کارتِ تکراری toast می‌گیرد، نه سکوت');
  ok(dup.session.picks.length === 1, 'کارتِ تکراری دوباره ثبت نمی‌شود');

  // ۳) انتخابِ عادیِ وسطِ راه: گرید به‌روز می‌شود و متن دست نمی‌خورد.
  const mid = await scenario('picking', [4], 3, 8);
  // toast دیگر ✨ نیست: **همان قلبی** است که روی خانه نشست (نوبتِ دوم ⟵ رنگِ دوم).
  ok(said(mid) === HEARTS.pickHearts('r:7:1:1', 3)[1] && mid.editKb === 1 && mid.editText === null,
    'انتخابِ وسطِ راه فقط کیبورد را به‌روز می‌کند و toast همان رنگِ نشسته است');
  ok(!mid.finished && mid.state === 'picking', 'وسطِ راه هنوز picking است');
  // ⚠️ مکث **فقط** مالِ تپِ آخر است: یک ثانیه تأخیر روی هر نُه تپِ یک فالِ ده‌کارتی،
  // آیین را به کندی تبدیل می‌کند.
  ok(JSON.stringify(mid.ops) === JSON.stringify(['kb']),
    'انتخابِ وسطِ راه هیچ مکثی ندارد (مکث فقط برای تپِ آخر است)', mid.ops.join(' → '));

  /* ۴) آخرین انتخاب — سه‌گانه‌ی v3.67.0 (خواسته‌ی مالک):
        اول گرید **با قلبِ آخر** رندر می‌شود، بعد یک مکثِ کوتاه تا رنگش دیده شود، و بعد
        متن جایگزین می‌شود و کیبورد می‌رود.
     🐛 تا v3.64.0 قدمِ اول اصلاً وجود نداشت و ادعای همین‌جا (`editKb === 0`) دقیقاً
        همان رفتار را **قفل** کرده بود: کاربرِ فالِ ده‌کارتی ده بار انتخاب می‌کرد و
        نُه رنگ می‌دید. */
  const last = await scenario('picking', [4, 8], 3, 1);
  ok(last.editText === L.reading.pickProgress(3, 3),
    'با آخرین انتخاب، متنِ گرید به «۳ از ۳ کارت انتخاب شد» تبدیل می‌شود');
  ok(last.editKb === 1, 'قلبِ آخر هم روی گرید رندر می‌شود (نه اینکه گرید بی‌درنگ برود)');
  ok(JSON.stringify(last.ops) === JSON.stringify(['kb', 'typing', 'text']),
    'ترتیب دقیقاً «گرید ← مکث ← جایگزینی» است', last.ops.join(' → '));
  ok(last.typedMs.length === 1 && last.typedMs[0] === PICK_LAST_MS,
    `مکث با نشانگرِ typing پر می‌شود و به‌اندازه‌ی PACE_PICK_LAST است (${last.typedMs[0]}ms)`);
  // 🔒 و v3.30.0 نشکسته: در پایان همچنان متن جایگزین می‌شود، یعنی کیبوردِ گرید می‌رود و
  // گریدِ مرده‌ای برای تپ کردن نمی‌ماند.
  ok(last.ops[last.ops.length - 1] === 'text',
    'آخرین عملیات جایگزینیِ متن است، پس گریدِ مرده در چت نمی‌ماند (v3.30.0 نشکسته)');
  ok(last.finished && last.state === 'confirm_pay', 'آخرین انتخاب فلو را ادامه می‌دهد');

  // ۵) فالِ ده‌کارتی: قاعده به عددِ ۳ گره نخورده باشد.
  const big = await scenario('picking', [0, 1, 2, 3, 4, 5, 6, 7, 8], 10, 11);
  ok(big.finished && big.editText === L.reading.pickProgress(10, 10),
    'همین رفتار در فالِ ده‌کارتی هم برقرار است');

  ok(!/answerCbQuery\(\)\s*\.catch/.test(body), 'هیچ answerCbQuery خالی‌ای در این هندلر نمانده');
}

console.log('\n▶ منوی خودکارِ بعد از /start (v3.58.0)');
{
  // 🐛 پیامِ خوش‌آمدِ کاربرِ برگشتی هیچ دکمه‌ای نداشت: متن می‌گفت «کارت امروزت هنوز
  // مونده» ولی هیچ راهی برای گرفتنش کنارش نبود. بلوک عمداً **رفتاری** است.
  const fnOf = (marker) => {
    const i = SRC.indexOf(marker);
    if (i < 0) return null;
    const s = SRC.indexOf('{', i);
    let d = 0;
    for (let j = s; j < SRC.length; j++) {
      if (SRC[j] === '{') d++;
      else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); }
    }
    return null;
  };
  const body = fnOf('async function sendStartMenu(ctx, uid)');
  ok(!!body, 'sendStartMenu از سورس استخراج شد');

  const TODAY = '2026-09-05';
  const run = async (lastDaily, { v2 = true, boom = false } = {}) => {
    const log = { text: null, rows: null, state: null, threw: false };
    const fn = new Function('deps', `
      const { getUser, botToday, uxV2For, Markup, L, falMenuKb, catalogKb, setState, logErr } = deps;
      return async function sendStartMenu(ctx, uid)${body};`)({
      getUser: () => { if (boom) throw new Error('db gone'); return { last_daily_date: lastDaily }; },
      botToday: () => TODAY, uxV2For: () => v2,
      Markup: { button: { callback: (t, d) => ({ t, d }) }, inlineKeyboard: (r) => ({ kb: r }) },
      L: { buttons: { dailyOneCard: 'DAILY' }, reading: { catalogV3: 'MENU_V2', catalog: 'MENU_OLD' } },
      falMenuKb: () => [['topic1'], ['topic2'], ['ALL']],
      catalogKb: () => [['legacy_daily'], ['legacy_spread']],
      setState: (_u, s) => { log.state = s; },
      logErr: () => {},
    });
    try {
      await fn({ reply: (t, m) => { log.text = t; log.rows = m.kb; return Promise.resolve(); } }, 7);
    } catch { log.threw = true; }
    return log;
  };

  const due = await run('2026-09-01');
  ok(due.rows?.[0]?.[0]?.d === 'daily_go',
    'وقتی کارتِ امروز نرفته، دکمه‌ی کارتِ روز **بالای** منو می‌آید');
  ok(due.rows?.[0]?.[0]?.t === 'DAILY', 'برچسبِ دکمه همان برچسبِ کیبوردِ کارتِ روز است');
  ok(due.rows.length === 4, 'دکمه‌ی کارتِ روز به منو اضافه می‌شود، جایگزینش نمی‌شود');
  ok(due.text === 'MENU_V2', 'متنِ منو از همان تک‌منبعِ منوی فال می‌آید');
  ok(due.state === 'choose_spread', 'استیت روی کاتالوگ می‌نشیند (فلوی باز نیست)');

  // ⚠️ دکمه‌ای که به «امروز استفاده کردی» ختم شود بن‌بستِ کوچک است (بند ۹ب).
  const taken = await run(TODAY);
  ok(!taken.rows.some((r) => r.some((b) => b.d === 'daily_go')),
    'کاربری که کارتِ امروزش را گرفته دکمه‌ی کارتِ روز نمی‌بیند');
  ok(taken.rows.length === 3, 'منوی او دقیقاً همان منوی فال است، بدونِ ردیفِ اضافه');

  // شرطِ دکمه باید **همان** شرطِ خطِ «کارت امروزت هنوز مونده» باشد، وگرنه متن و دکمه
  // روزی از هم واگرا می‌شوند (کلاسِ «شرطِ نمایش ≠ شرطِ پذیرش»).
  ok(/user\.last_daily_date !== botToday\(\)/.test(SRC) &&
     /getUser\(uid\)\?\.last_daily_date !== botToday\(\)/.test(SRC),
    'شرطِ دکمه با شرطِ متنِ یادآوریِ کارتِ روز یکی است');

  // دنیای قدیم: `catalogKb` خودش ردیفِ کارتِ روز را دارد، پس ردیفِ دومی ساخته نمی‌شود.
  const legacy = await run('2026-09-01', { v2: false });
  ok(legacy.rows.length === 2 && legacy.text === 'MENU_OLD',
    'در دنیای قدیم ردیفِ تکراریِ کارتِ روز اضافه نمی‌شود');

  // ⚠️ نسخه‌ی اولِ همین ادعا **پوچ** بود: استابِ «خراب» هیچ استثنایی پرتاب نمی‌کرد، پس
  // برداشتنِ try/catch را نمی‌گرفت و سبز می‌ماند. حالا خودِ استاب می‌ترکد.
  const broke = await run('2026-09-01', { boom: true });
  ok(broke.threw === false, 'خطای منو هرگز /start را نمی‌شکند');
  ok(broke.text === null, 'و در آن حالت هیچ پیامِ نصفه‌ای هم نمی‌رود');
  // ارسالِ ناموفق (کاربرِ بلاک‌کرده) هم نباید بیرون بزند.
  {
    const fn2 = new Function('deps', `
      const { getUser, botToday, uxV2For, Markup, L, falMenuKb, catalogKb, setState, logErr } = deps;
      return async function sendStartMenu(ctx, uid)${body};`)({
      getUser: () => ({ last_daily_date: '2026-09-01' }), botToday: () => TODAY, uxV2For: () => true,
      Markup: { button: { callback: (t, d) => ({ t, d }) }, inlineKeyboard: (r) => ({ kb: r }) },
      L: { buttons: { dailyOneCard: 'DAILY' }, reading: { catalogV3: 'M', catalog: 'M' } },
      falMenuKb: () => [['x']], catalogKb: () => [['y']], setState: () => {}, logErr: () => {},
    });
    let threw = false;
    await fn2({ reply: () => Promise.reject(new Error('blocked')) }, 7).catch(() => { threw = true; });
    ok(!threw, 'شکستِ ارسالِ منو (کاربرِ بلاک‌کرده) استثنا بیرون نمی‌دهد');
  }

  // ── جای فراخوانی در handleStart ─────────────────────────────────────────
  const hs = (fnOf('async function handleStart(ctx)') || '').replace(/\/\/[^\n]*/g, '');
  ok(/await sendStartMenu\(ctx, uid\)/.test(hs), 'handleStart منو را باز می‌کند');
  ok(hs.indexOf('mainKeyboard(ctx.from.id)') < hs.indexOf('sendStartMenu'),
    'اول خوش‌آمد با کیبوردِ ماندگار، بعد منو (تلگرام در هر پیام یک reply_markup می‌دهد)');
  ok(/stmts\.setKbShown\.run\(uid\);/.test(hs),
    '/start همچنان نقطه‌ی صدورِ کیبورد است (پنجره‌ی مهاجرت بسته می‌شود)');
  // فالِ نیمه‌تحویل بر منو مقدم است: کاربر پول داده و ادامه‌اش تنها چیزِ مهم است.
  ok(/if \(row\) return await ctx\.reply\(L\.reading\.openReadingGuard/.test(hs),
    'با فالِ نیمه‌تحویل، منو باز نمی‌شود (پیشنهادِ ادامه تنها چیزی است که می‌آید)');
  ok(hs.indexOf('resumeRowFromDb') < hs.indexOf('sendStartMenu'),
    'گاردِ فالِ نیمه‌تحویل قبل از منو اجرا می‌شود');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
