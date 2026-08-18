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
import {
  TOPICS_V3, TOPIC_BY_KEY, TOPIC_SPREADS, SIZES_V3, SPREAD_BY_ID, spreadIdOf, topicOf,
} from '../bots/tarot/spreads.js';

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
  const PER_CARD = 10_000;
  ok(SIZES_V3.length === 3 && SIZES_V3.join(',') === '3,5,10', 'سه عمق: ۳ و ۵ و ۱۰ کارت');
  ok(TOPIC_SPREADS.length === TOPICS_V3.length * SIZES_V3.length,
    `هر موضوع هر سه عمق را دارد (${TOPIC_SPREADS.length} ترکیب)`);
  let priceOk = true, posOk = true, idOk = true;
  for (const t of TOPICS_V3) for (const size of SIZES_V3) {
    const s = SPREAD_BY_ID[spreadIdOf(t.key, size)];
    if (!s) { idOk = false; continue; }
    if (s.price !== size * PER_CARD) priceOk = false;
    if (s.positions?.length !== size) posOk = false;
  }
  ok(idOk, 'هر ترکیبِ موضوع×اندازه از SPREAD_BY_ID resolve می‌شود');
  ok(priceOk, 'قیمت همیشه size × ۱۰٬۰۰۰ است (قانونِ قیمت استثنا ندارد)');
  ok(posOk, 'تعدادِ جایگاه‌ها با تعدادِ کارت‌ها یکی است');
  // فالِ تقابلی باید دو سمتِ تصمیم را در خودِ جایگاه‌ها داشته باشد، وگرنه مدل کارت‌ها را
  // مثل خطِ زمانی می‌خواند و خروجیِ verdict به هیچ جایگاهی لنگر نمی‌خورد.
  const commit3 = SPREAD_BY_ID['commit3'];
  ok(commit3.positions[0].fa === 'تعهد' && commit3.positions[1].fa === 'خیانت',
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
    'چهار موضوعِ عاطفی: عشق، کراش، حس طرف مقابل، تعهد یا خیانت');
  ok(keys.includes('career') && keys.includes('money'), 'شغل و پول هر دو هستند');
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
  ok(/allTopicsKb = \(\) => \[\s*\n\s*\.\.\.TOPICS_V3\.map/.test(SRC),
    'لیستِ کامل از خودِ TOPICS_V3 ساخته می‌شود (نه لیستِ دستیِ موازی)');
  // فالِ رایگان از منوی فال برداشته شد: تنها راهش کیبوردِ اصلی است
  const cat = SRC.slice(SRC.indexOf('function catalogKb('), SRC.indexOf('async function showCatalog('));
  ok(!/daily_go/.test(SRC.slice(SRC.indexOf('function falMenuKb('), SRC.indexOf('function catalogKb('))),
    'کارتِ روزِ رایگان در منوی فال نیست (فقط کیبوردِ اصلی)');
  ok(/uxV2For\(uid\)\) return allTopicsKb\(\)/.test(cat), 'کاتالوگِ UX v2 همان لیستِ کاملِ موضوع‌هاست');
  ok(/L\.buttons\.dailyOneCard, L\.buttons\.reading/.test(SRC),
    'کیبوردِ اصلی نامِ صریحِ «فال تک کارت امروز (رایگان)» را دارد');
  ok(/L\.buttons\.luckyMain\]/.test(SRC), 'کارت شانس ردیفِ خودش را در کیبوردِ اصلی دارد');
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
  // ارزش از خودِ COIN_VALUE می‌آید، نه یک عددِ نوشته‌شده — وگرنه قیمت دو جا زندگی می‌کند.
  ok(/const LUCKY_COIN_VALUE = 1 \* COIN_VALUE;/.test(SRC),
    'هر کارتِ الماس‌دار دقیقاً یک الماس است و مقدارش از COIN_VALUE می‌آید');
}

console.log('\n▶ 🍀 کارت شانس — گاردهای پول و حالت');
{
  const h = SRC.slice(SRC.indexOf("bot.action(/^lpick:"), SRC.indexOf("bot.action(/^lremind:"));
  ok(/claimLucky\.run\(today, uid, today\)\.changes === 0/.test(h),
    'روز اتمیک سوخته می‌شود (شرطِ روز داخلِ خودِ UPDATE، ضدِ دوبار-تپ)');
  ok(/if \(!picks\.length && stmts\.claimLucky/.test(h),
    'روز با **اولین** انتخاب سوخته می‌شود، نه با دیدنِ گرید');
  ok(h.indexOf('stmts.credit.run(LUCKY_COIN_VALUE') < h.indexOf('if (!done)'),
    'الماس لحظه‌ی برگشتنِ هر کارت واریز می‌شود، نه آخرِ بازی (ری‌استارت پول را نمی‌خورد)');
  ok(/picks\.includes\(i\) \|\| picks\.length >= LUCKY_PICKS \|\| s\.luckyDay !== today/.test(h),
    'گاردهای تکراری/سهمیه/روزِ کهنه قبل از اولین await اند');
  ok(/claimLucky: db\.prepare\("UPDATE users SET lucky_date=\? WHERE telegram_id=\? AND COALESCE\(lucky_date,''\) <> \?"\)/.test(SRC),
    'claimLucky واقعاً اتمیک است');
  // پیامِ پایانی هر دو حالت باید بگوید فردا دوباره می‌شود (تصمیمِ صریحِ مالک)
  ok(/won: \(coins\) => `[^`]*فردا دوباره/.test(LOC) && /lost: '[^']*فردا دوباره/.test(LOC),
    'هم در برد و هم در باخت گفته می‌شود که فردا دوباره می‌شود');
  ok(/luckyRemindOn: '🔔 فردا یادآوری کن'/.test(LOC), 'دکمه‌ی «فردا یادآوری کن» هست');
  ok(/dueLuckyReminder/.test(SRC) && /lucky_reminder_on=1/.test(SRC),
    'یادآوریِ کارت شانس opt-in است (فقط کسی که دکمه را زده)');
  ok(/if \(uxV2For\(telegram_id\)\) continue;\n\s*stmts\.setDailyReminded/.test(SRC),
    'یادآوریِ کارتِ روز برای کاربرِ UX v2 متوقف شده (جایش را کارت شانس گرفت)');
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
  for (const s of ['refunded', 'useButtons']) {
    const m = LOC.match(new RegExp(`${s}: '[^']*'`));
    ok(!!m && !/خوانش/.test(m[0]), `پیامِ «${s}» هم «فال» می‌گوید نه «خوانش»`);
  }
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
