// چکِ CI برای «اولین فالِ کاربرِ تازه» (tarot v3.71.0).
//
// دو تغییرِ به‌هم‌وابسته را با هم قفل می‌کند، و همین وابستگی دلیلِ وجودِ این فایل است:
//
//   ۱) هدیه‌ی خوش‌آمد از ۵ به **۳** الماس آمد.
//   ۲) صفحه‌ی انتخابِ اندازه در **آنبوردینگ** تک‌گزینه‌ای شد (فقط ۳ کارتی).
//
// اگر فقط اولی برود، کاربرِ تازه منویی می‌بیند که دو گزینه از سه‌تایش **نشدنی** است —
// اولین برخوردش با محصول یک بن‌بست. اگر فقط دومی برود، صفحه‌ی تک‌گزینه‌ای بی‌دلیل است.
// پس این چک هر دو را می‌سنجد **و رابطه‌شان را**: هدیه باید دقیقاً کفافِ همان یک گزینه
// را بدهد.
//
// و مهم‌ترین ادعا از جنسِ **صداقت** است: متنِ آن صفحه صریحاً می‌گوید «موجودیت کافیه».
// پس کد فقط وقتی حق دارد آن متن را بسازد که واقعاً کافی باشد؛ وگرنه به کاربر دروغ
// می‌گوییم (بند ۲و/۶ج ریشه: ادعا هرگز از دیتا جلو نمی‌زند).
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const { SPREAD_BY_ID, SIZES_V3, spreadIdOf, TOPIC_BY_KEY } =
  await import('../bots/tarot/spreads.js');

function bodyOf(marker, end) {
  const a = SRC.indexOf(marker);
  if (a < 0) return null;
  const b = SRC.indexOf(end, a);
  return b < 0 ? null : SRC.slice(a, b + end.length);
}

console.log('\n🎁 هدیه‌ی خوش‌آمد و اولین انتخابِ فال\n');

/* ══ ۱) هدیه، و رابطه‌ی اجباری‌اش با فالِ آنبوردینگ ═══════════════════════ */
console.log('۱) هدیه‌ی خوش‌آمد');
const bonus = Number(CODE.match(/const WELCOME_BONUS_COINS_V2 = (\d+);/)?.[1] || 0);
const onbSize = Number(CODE.match(/const ONBOARD_FIRST_SIZE = (\d+);/)?.[1] || 0);
ok(bonus === 3, `هدیه‌ی خوش‌آمد ۳ الماس است (دیدم: ${bonus})`);
ok(SIZES_V3.includes(onbSize), `اندازه‌ی فالِ آنبوردینگ (${onbSize}) یکی از اندازه‌های واقعیِ کاتالوگ است`);

const onbSpread = SPREAD_BY_ID[spreadIdOf('personal', onbSize)];
ok(!!onbSpread, `چیدمانِ ${onbSize} کارتی در spreads.js وجود دارد`);
// 🔗 ادعای مرکزیِ این بلوک: هدیه باید **دقیقاً** کفافِ همان یک گزینه را بدهد.
ok(onbSpread && onbSpread.price === bonus,
  `هدیه دقیقاً بهای همان فال است (فال: ${onbSpread?.price}💎، هدیه: ${bonus}💎)`);
// و اینکه بقیه‌ی اندازه‌ها واقعاً نشدنی‌اند — یعنی تک‌گزینه‌ای کردن یک تصمیمِ سلیقه‌ای
// نیست، جوابِ یک واقعیتِ عددی است.
for (const size of SIZES_V3.filter(s => s !== onbSize)) {
  const sp = SPREAD_BY_ID[spreadIdOf('personal', size)];
  ok(sp && sp.price > bonus,
    `فالِ ${size} کارتی با هدیه‌ی تنها شدنی **نیست** (${sp?.price}💎 > ${bonus}💎)`);
}

/* ══ ۲) نشانه‌ی آنبوردینگ: کجا گذاشته می‌شود ══════════════════════════════ */
console.log('\n۲) نشانه‌ی مسیرِ آنبوردینگ');
const finish = bodyOf('async function finishOnboarding(ctx, uid, props) {', '\n}');
const finishCode = (finish || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
ok(!!finish, 'بدنه‌ی `finishOnboarding` پیدا شد');
ok(/patchSession\(uid, \{ onbFirst: 1 \}\)/.test(finishCode),
  'نشانه در پایانِ آنبوردینگ گذاشته می‌شود');
// در **سشن** است نه یک ستونِ تازه: هر مسیری که کاربر را از جریان بیرون می‌برد
// `setSession(uid, null)` می‌زند و نشانه با آن می‌رود. اگر روزی ستون شود، آن
// پاک‌شدنِ خودکار از بین می‌رود و کاربرِ خارج‌شده هم صفحه‌ی آنبوردینگ می‌بیند.
ok(!/users[\s\S]{0,40}onb_first/i.test(CODE) && !/ADD COLUMN onb_first/i.test(CODE),
  'و ستونِ دیتابیسی برایش ساخته نشده (پاک‌شدنش باید به سشن گره بخورد)');

/* ══ ۳) خودِ تصمیم، بریده از سورس و اجراشده ═══════════════════════════════ */
console.log('\n۳) رفتارِ `onboardFirstSpread`');
const decideSrc = bodyOf('const onboardFirstSpread = (uid, t) => {', '\n};');
ok(!!decideSrc, '`onboardFirstSpread` از سورس بریده شد');

const topic = TOPIC_BY_KEY.personal || Object.values(TOPIC_BY_KEY)[0];
const build = ({ v2 = true, session = { onbFirst: 1 }, balance = 3 } = {}) =>
  new Function('uxV2For', 'getSession', 'SPREAD_BY_ID', 'spreadIdOf', 'getBalance',
    'ONBOARD_FIRST_SIZE', 'logErr', `${decideSrc} return onboardFirstSpread;`)(
    () => v2, () => session, SPREAD_BY_ID, spreadIdOf, () => balance, onbSize, () => {});

ok(build()(1, topic)?.size === onbSize, 'نشانه + موجودیِ کافی ⟵ همان فالِ تک‌گزینه‌ای');
ok(build({ session: {} })(1, topic) === null, 'بدونِ نشانه ⟵ صفحه‌ی عادی');
ok(build({ session: null })(1, topic) === null, 'سشنِ پاک‌شده ⟵ صفحه‌ی عادی');
ok(build({ v2: false })(1, topic) === null, 'دنیای تومانی ⟵ صفحه‌ی عادی');
// 🔴 مهم‌ترین ادعای صداقت.
ok(build({ balance: 2 })(1, topic) === null,
  'موجودیِ ناکافی ⟵ صفحه‌ی عادی (وگرنه متن می‌گفت «کافیه» و دروغ بود)');
ok(build({ balance: 3 })(1, topic) !== null, 'موجودیِ دقیقاً برابر ⟵ کافی است');
ok(build({ balance: 99 })(1, topic) !== null, 'موجودیِ بیشتر هم مشکلی ندارد');
ok(build()(1, { key: 'nope_not_a_topic' }) === null, 'موضوعِ ناشناخته ⟵ صفحه‌ی عادی، نه کرش');
// fail-safe: هیچ خطایی نباید صفحه‌ی انتخابِ فال را بشکند.
{
  const boom = new Function('uxV2For', 'getSession', 'SPREAD_BY_ID', 'spreadIdOf', 'getBalance',
    'ONBOARD_FIRST_SIZE', 'logErr', `${decideSrc} return onboardFirstSpread;`)(
    () => true, () => { throw new Error('db down'); }, SPREAD_BY_ID, spreadIdOf,
    () => 3, onbSize, () => {});
  ok(boom(1, topic) === null, 'خطای خواندنِ سشن ⟵ صفحه‌ی عادی، نه استثنا');
}

/* ══ ۴) خودِ صفحه: چند دکمه، و کدام‌ها ════════════════════════════════════ */
console.log('\n۴) صفحه‌ی انتخابِ اندازه');
const screenSrc = bodyOf('function pickSizeScreen(uid, t, from) {', '\n}');
ok(!!screenSrc, '`pickSizeScreen` از سورس بریده شد');

const L = (await import('../bots/tarot/locales/fa.js')).default;
const cur = { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji };
const btn = (label, data) => ({ label, data });
const Markup = { button: { callback: btn }, inlineKeyboard: (rows) => ({ rows }) };
const runScreen = (first, balance = 3) =>
  new Function('L', 'Markup', 'curOf', 'getBalance', 'onboardFirstSpread',
    'SIZES_V3', 'SPREAD_BY_ID', 'spreadIdOf', `${screenSrc} return pickSizeScreen;`)(
    L, Markup, () => cur, () => balance, () => first, SIZES_V3, SPREAD_BY_ID, spreadIdOf)(
    1, topic, 'm');

{
  const [text, extra] = runScreen(onbSpread);
  const rows = extra.rows;
  ok(rows.length === 2, `حالتِ آنبوردینگ: دقیقاً دو ردیف (دیدم: ${rows.length})`);
  ok(rows[0][0].data === `spread:${onbSpread.id}`,
    'دکمه‌ی اول همان فالِ سه‌کارتیِ همان موضوع است', rows[0][0].data);
  ok(/tback:/.test(rows[1][0].data), 'و ردیفِ دوم راهِ برگشت است (هیچ صفحه‌ای بن‌بست نیست)');
  ok(text.includes('۳'), 'متن عددِ اندازه را می‌گوید');
  ok(/کافیه/.test(text), 'و صریح می‌گوید موجودی کافی است');
  ok(extra.parse_mode === 'HTML', 'با HTML می‌رود (خطِ موجودی داخلِ باکسِ نقل‌قول است)');
  ok(!/—|--/.test(text), 'بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)');
}
{
  const [text, extra] = runScreen(null);
  ok(extra.rows.length === SIZES_V3.length + 1,
    `حالتِ عادی: هر ${SIZES_V3.length} اندازه + بازگشت (دیدم: ${extra.rows.length})`);
  ok(!/کافیه/.test(text), 'و صفحه‌ی عادی آن ادعا را نمی‌کند');
}

/* ══ ۵) متن در هر چهار زبان ══════════════════════════════════════════════ */
console.log('\n۵) هر چهار زبان (بند ۲و/۱ ریشه)');
for (const loc of ['fa', 'ru', 'pt', 'es']) {
  const LL = (await import(`../bots/tarot/locales/${loc}.js`)).default;
  const c2 = { on: true, value: 1, name: LL.coinUnit.name, emoji: LL.coinUnit.emoji };
  let txt = '', lbl = '';
  try {
    txt = LL.reading.pickSizeOnboarding(3, c2, onbSize);
    lbl = LL.buttons.startSize(onbSize, onbSpread.price, c2);
  } catch (e) { /* پایین قرمز می‌شود */ }
  ok(!!txt && !!lbl, `«${loc}»: هر دو کلید هست و اجرا می‌شود`);
  ok(txt.includes('3') || txt.includes('۳'), `«${loc}»: عددِ اندازه در متن می‌آید`);
  ok(lbl.includes('3') || lbl.includes('۳'), `«${loc}»: دکمه عدد را نشان می‌دهد`);
  ok(!/—|--/.test(txt) && !/—|--/.test(lbl), `«${loc}»: بدونِ خط تیره‌ی بلند`);
}

/* ══ ۶) نسخه ═════════════════════════════════════════════════════════════ */
console.log('\n۶) نسخه');
// ⚠️ کف، نه عددِ دقیق (درسِ ثبت‌شده: پینِ دقیق اولین بامپِ بعدی را قرمز می‌کند).
const ver = SRC.match(/const PRODUCT_VERSION = '([\d.]+)'/)?.[1] || '0';
const cmpVer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};
ok(cmpVer(ver, '3.71.0') >= 0, `PRODUCT_VERSION برای این تغییرِ رفتاری بامپ شده (${ver})`);

console.log(`\n${fail ? '❌' : '✅'} ${pass} پاس، ${fail} خطا\n`);
if (fail) process.exit(1);
