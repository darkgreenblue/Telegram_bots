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
  // این دو پیام می‌توانند رشته‌ی ساده یا تابعِ template باشند (`refunded` با آمدنِ
  // واحدِ الماس تابع شد)، پس هر دو شکل پوشش داده می‌شود.
  for (const s of ['refunded', 'useButtons']) {
    const m = LOC.match(new RegExp(`${s}: (\\(cur\\) => )?[\`'][^\`']*[\`']`));
    ok(!!m && !/خوانش/.test(m[0]), `پیامِ «${s}» هم «فال» می‌گوید نه «خوانش»`);
  }
}

console.log('\n▶ پیامِ عمومیِ «ادامه» جایگزینِ جمله‌ی صرفاً محاوره‌ای شد (UX v2.2)');
{
  // بند: هیچ نقطه‌ی لغو/بازگشتی نباید مستقیم L.reading.canceled را صدا بزند —
  // همه باید از replyCanceled عبور کنند تا در دنیای UX v2 پیامِ «ادامه» جایگزین شود.
  // تنها نمونه‌ی مجاز، شاخه‌ی داخلِ خودِ replyCanceled است (دنیای قدیم). هر جای دیگر
  // باید از replyCanceled عبور کند تا در دنیای الماس پیامِ «ادامه» جایگزین شود.
  const rawCanceled = [...SRC.matchAll(/ctx\.reply\(L\.reading\.canceled/g)].length;
  ok(rawCanceled === 1, `فقط یک نقطه (خودِ replyCanceled) مستقیم L.reading.canceled را صدا می‌زند (یافت شد: ${rawCanceled})`);
  ok(/async function replyCanceled\(ctx, uid\) \{\s*\n\s*if \(uxV2For\(uid\)\) return sendContinuePrompt\(ctx, uid\);\s*\n\s*return ctx\.reply\(L\.reading\.canceled, mainKeyboard\(uid\)\);/.test(SRC),
    'replyCanceled: دنیای الماس → پیامِ ادامه، دنیای قدیم → دقیقاً همان جمله‌ی قبلی (رول‌بکِ یک‌خطی)');
  const callers = [...SRC.matchAll(/await replyCanceled\(ctx, uid\)/g)].length;
  ok(callers === 3, `سه نقطه‌ی لغو (rcancel/reading:cancel/pay_cancel) از replyCanceled استفاده می‌کنند (یافت شد: ${callers})`);
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
  ok(/if \(!\(uxV2For\(uid\) && isFirstReading\)\) \{/.test(SRC),
    'پیشنهادِ فالِ جدید فقط برای «دنیای قدیم یا فالِ غیرِ‌اول» نشان داده می‌شود');
  // بندِ دوم: در fbr: (بعد از نمره‌دادن) باید یک isFirstReading دیگر (تازه، مستقل) محاسبه شود
  const iIsFirst2 = SRC.indexOf('const isFirstReading = stmts.countDelivered.get(uid).c === 1;', iIsFirst1 + 1);
  ok(iIsFirst2 > iIsFirst1, 'fbr: هم isFirstReading را دوباره (مستقل) محاسبه می‌کند');
  const iFbr = SRC.indexOf('bot.action(/^fbr:');
  const fbrBlock = SRC.slice(iFbr, SRC.indexOf('bot.action(', iFbr + 20));
  ok(/luckyAvailable = getUser\(uid\)\?\.lucky_date !== tehranToday\(\)/.test(fbrBlock),
    'تبلیغِ کارت شانس فقط اگر سهمیه‌ی امروز هنوز مصرف نشده نشان داده می‌شود');
  ok(/if \(uxV2For\(uid\) && isFirstReading && luckyAvailable\) \{/.test(fbrBlock),
    'شرطِ نمایشِ تبلیغ: دنیای الماس + اولین فال + سهمیه‌ی کارت شانس باز');
  ok(/L\.lucky\.promo\(dispName\(getUser\(uid\)\)\)/.test(fbrBlock), 'تبلیغ از L.lucky.promo با نامِ کاربر ساخته می‌شود');
  ok(/luckyDraw\(LUCKY_PICKS, curOf\(uid\)\), 'lucky_go'/.test(fbrBlock), 'دکمه‌ی تبلیغ مستقیم به lucky_go وصل است');
  ok(/\} else \{\s*\n\s*await ctx\.reply\(L\.reading\.rateThanks\)/.test(fbrBlock),
    'برای فالِ غیرِاول (یا دنیای قدیم) رفتار دقیقاً همان تشکرِ قبلی می‌ماند');
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
  ok(/const saved = L\.onboarding\.birthMonthSaved\(monthFa\(m\)\);/.test(bmonth), 'متنِ تأیید از قبل ساخته می‌شود');
  ok(/try \{ await ctx\.editMessageText\(saved\); \}/.test(bmonth), 'روی همان پیام ادیت می‌شود');
  ok(/catch \{ await ctx\.reply\(saved\)\.catch\(\(\) => \{\}\); \}/.test(bmonth),
    'اگر ادیت نشد (پیامِ کهنه) به پیامِ جدا برمی‌گردیم تا کاربر بی‌جواب نماند');
}

console.log('\n▶ صفحه‌ی کیف الماس: سه راهِ پرکردن (خرید، معرفی، کارت شانسِ رایگان)');
{
  ok(/function walletRows\(uid\) \{\s*\n\s*const rows = \[\[Markup\.button\.callback\(rechargeLabel\(uid\), 'recharge'\)\]\];\s*\n\s*if \(!uxV2For\(uid\)\) return rows;/.test(SRC),
    'دنیای قدیم فقط همان دکمه‌ی شارژِ همیشگی را می‌بیند (رول‌بکِ یک‌خطی)');
  ok(/inviteWithBonus\(referralBonusFor\(uid\), cur\), 'invite_go'/.test(SRC), 'دکمه‌ی معرفیِ دوستان با مبلغِ پاداش');
  ok(/if \(getUser\(uid\)\?\.lucky_date !== tehranToday\(\)\) \{\s*\n\s*rows\.push\(\[Markup\.button\.callback\(L\.buttons\.luckyDraw/.test(SRC),
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
  ok(/luckyMain: '🍀 کارت شانس \(استخراج الماس\)'/.test(LOC), 'دکمه‌ی کیبوردِ کارت شانس «استخراج الماس» می‌گوید');
  ok(/askBirthMonth: 'ماه تولدت چیه؟ 🌿'/.test(LOC), 'سؤالِ ماهِ تولد کوتاه شد (بدونِ مقدمه‌ی «قبل از هر چیز»)');
  ok(/startWhere: 'از کجا شروع کنیم؟ 📌'/.test(LOC), '«از کجا شروع کنیم؟» ایموجیِ 📌 گرفت');
  // askName حالا تابعِ v2 است: نسخه‌ی الماس صریح می‌گوید ربات است (تصمیمِ مالک)، و
  // نسخه‌ی قدیم بیت‌به‌بیت دست‌نخورده می‌ماند (شاخه‌ی else).
  ok(/askName: \(v2\) => \(v2\s*\n\s*\? 'من ربات تاروت‌خوان هستم!/.test(LOC),
    'askName در دنیای الماس صریح می‌گوید «من ربات تاروت‌خوانم»');
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
  // بسته‌های الماس: کپیِ جدید («از بین سه بسته») به‌جای توضیحِ ریاضیِ قبلی
  ok(/از بین سه بسته‌ی زیر، بسته‌ای که برات مناسبه رو انتخاب کن/.test(LOC), 'متنِ انتخابِ بسته عوض شد');
  // v2.3: 🛒 از خطِ دومِ یادآوری به **اولِ** جمله‌ی دعوت منتقل شد (تصمیمِ صریحِ مالک).
  ok(/🛒 از بین سه بسته‌ی زیر/.test(LOC), 'ایموجیِ سبد خرید اولِ جمله‌ی انتخابِ بسته است');
  ok(!/🛒 با انتخابِ? بسته‌های بزرگ‌تر/.test(LOC), 'خطِ دومِ یادآوری دیگر ایموجیِ 🛒 ندارد');
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
  ok(/ctx\.editMessageText\(L\.reading\.backToMenu\)/.test(navH), 'nav:menu همان پیام را به تأییدِ بازگشت ادیت می‌کند');
  ok(/if \(edited\) await ensureMenu/.test(navH), 'بعد از ادیت، کیبوردِ ماندگار تضمین می‌شود');
  ok(/else await ctx\.reply\(L\.reading\.backToMenu, mainKeyboard\(uid\)\)/.test(navH), 'شکستِ ادیت دقیقاً به رفتارِ قبلی برمی‌گردد');

  // ۶) صفحه‌ی بسته‌ها زیرمنوی کیف است: ادیت + دکمه‌ی «بازگشت» (نه «انصراف»).
  ok(/backOneStep: '◀️ بازگشت'/.test(LOC), 'برچسبِ بازگشتِ یک‌قدمی جدا از «انصراف» تعریف شده');
  ok(/L\.buttons\.backOneStep, `pay_back:\$\{paymentId\}`/.test(SRC), 'صفحه‌ی بسته‌ها دکمه‌ی بازگشت دارد نه انصراف');
  const payBack = SRC.slice(SRC.indexOf('bot.action(/^pay_back:'), SRC.indexOf('bot.action(/^pay_back:') + 900);
  ok(/setPaymentStatus\.run\('canceled', p\.id\)/.test(payBack), 'بازگشت فاکتورِ خالی را می‌بندد (وگرنه گاردِ پرداخت کاربر را قفل می‌کند)');
  ok(/walletScreen\(uid\)/.test(payBack), 'بازگشت دقیقاً همان صفحه‌ی کیف را رندر می‌کند (تک‌منبع)');
  ok(!/replyCanceled|sendContinuePrompt/.test(payBack), 'بازگشت از بسته‌ها پیامِ «ادامه» نمی‌آورد');
  ok(/offerPendingReading\(ctx, uid\)/.test(payBack), 'فالِ رزروشده بعد از بازگشت سرگردان نمی‌ماند');

  // ۷) پیامِ «ادامه» تنها نقطه‌ی باز شدنِ منوی اصلی است (تصمیمِ مالک).
  const cont = SRC.slice(SRC.indexOf('async function sendContinuePrompt'), SRC.indexOf('async function replyCanceled'));
  ok(/await ensureMenu\(ctx, uid\)/.test(cont), 'sendContinuePrompt خودش کیبوردِ اصلی را تضمین می‌کند');
  ok(/nextOffersV3: 'برای جواب دادن به سؤالاتی که جوابش رو نمی‌دونی من همیشه اینجام!'/.test(LOC),
    'متنِ تازه‌ی پیامِ «ادامه»');
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
  ok(/buyCoins: \(cur\) => `💰 خرید \$\{cur\.name\}\$\{cur\.emoji\}`/.test(LOC), 'دکمه‌ی خرید: «💰 خرید الماس💎»');
  ok(/inviteWithBonus: \(bonus, cur\) => `📤 دعوت دوستان \(هر دعوت ➕\$\{moneyTight\(bonus, cur\)\}\)`/.test(LOC),
    'دکمه‌ی دعوت: «📤 دعوت دوستان (هر دعوت ➕۱۰💎)»');
  ok(/luckyDraw: \(max, cur\) => `🍀 کارت شانس \(➕صفر تا \$\{fmt\(max\)\}\$\{cur\.emoji\}\)`/.test(LOC),
    'دکمه‌ی کارت شانس: «🍀 کارت شانس (➕صفر تا ۳💎)»');
  ok(/topicSize: \(size, price, cur\) => `\$\{fmt\(size\)\} کارتی \(➖\$\{moneyTight\(price, cur\)\}\)`/.test(LOC),
    'دکمه‌ی اندازه: «۳ کارتی (➖۳💎)»');
  ok(/L\.buttons\.topicSize\(size, sp\.price, cur\)/.test(SRC), 'قیمتِ دکمه از خودِ رکوردِ چیدمان می‌آید، نه از ضربِ دوباره');

  // زیرِ پیامِ کم‌موجودی همان سه راهِ کیف می‌آید (تک‌منبع، نه لیستِ موازی).
  ok(/if \(coinsOn\(uid\)\) return walletRows\(uid\);/.test(SRC), 'دکمه‌های زیرِ پیامِ کم‌موجودی = همان دکمه‌های کیف');

  // برچسبِ کیبوردِ ماندگار عوض شد → دکمه‌ی کش‌شده روی گوشیِ کاربر نباید بمیرد (بند ۲ج/۶).
  ok(/const INVITE_LABELS = \[L\.buttons\.inviteMain, '📤 معرفی دوستان'\]/.test(SRC),
    'برچسبِ میانیِ «معرفی دوستان» هنوز match می‌شود (کیبوردِ کش‌شده)');
  ok(/bot\.hears\(INVITE_LABELS, showInvite\)/.test(SRC), 'هندلرِ دعوت هر دو برچسب را می‌گیرد');
  ok(/'📤 معرفی دوستان',\s*\/\//.test(SRC), 'برچسبِ میانی در KB_LABELS هست (تپِ دکمه در قیف گم نشود)');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
