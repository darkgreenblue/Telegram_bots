#!/usr/bin/env node
// چکِ «پشته‌ی بازگشت» (tarot v3.97.0) — قراردادِ ناوبریِ لایه‌ی ۱ و لایه‌ی ۲+ (بند ۹ب/۱ ریشه).
//
// قاعده‌ی مالک، در دو جمله:
//   • صفحه‌ای که مستقیم از **کیبوردِ ماندگار** باز می‌شود (لایه‌ی ۱) آخرین دکمه‌اش
//     «بازگشت به منوی اصلی» است.
//   • صفحه‌ای که از دلِ یک صفحه‌ی دیگر باز می‌شود (لایه‌ی ۲+) آخرین دکمه‌اش یک «بازگشت»ِ
//     ساده است که **یک قدم** به همان شاخه‌ای برمی‌گردد که از آن آمده.
//
// ⚠️ چرا این چک **رفتاری** است نه رجکسی: «کدام صفحه لایه‌ی ۱ است» یک خاصیتِ ایستا نیست.
// «ذخایر الماس» از کیبورد لایه‌ی ۱ است و از صفحه‌ی کم‌موجودی لایه‌ی ۲. تنها چیزی که این را
// می‌داند خودِ پشته است، پس همان توابع از سورس بریده و روی یک سشنِ واقعی **اجرا** می‌شوند.
//
// اجرا: node tools/check-nav-stack.mjs
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
/** بدنه‌ی یک تابع/هندلر از سورس. کامنت‌ها **نگه داشته** می‌شوند چون بعضی ادعاها روی کد
 *  می‌نشینند و کامنت‌زدایی خودش قبلاً چند قرمزِ کاذب ساخته؛ هر ادعای متنی جداگانه پاک می‌کند. */
function bodyOf(marker, end = '\n}') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to + end.length);
}
const noComments = (s) => String(s || '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

console.log('\n🧭 پشته‌ی بازگشت (لایه‌ی ۱ و ۲)\n');

/* ══ ۱) ساختار: رجیستری، سقفِ پشته، و تک‌منبع بودنِ ردیفِ بازگشت ═════════════ */
console.log('▶ ساختار');

const MAXV = Number((SRC.match(/const NAV_STACK_MAX = (\d+);/) || [])[1]);
ok(Number.isInteger(MAXV) && MAXV >= 2 && MAXV <= 20,
  `سقفِ پشته یک ثابتِ نام‌دار است (NAV_STACK_MAX = ${MAXV})`);

const regBlock = bodyOf('const NAV_SCREENS = {', '\n};');
ok(!!regBlock, 'رجیستریِ NAV_SCREENS در سورس هست');
const regKeys = [...noComments(regBlock || '').matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
ok(regKeys.length >= 5, `رجیستری ${regKeys.length} صفحه دارد (${regKeys.join('، ')})`);

/* ⚠️ دو جهت، نه یکی (همان درسِ رجیستریِ `admin_actions` در بند ۲الف ریشه): صفحه‌ای که
 * `navGo`/`navEnter` صدایش می‌زند باید در رجیستری باشد (وگرنه «بازگشت» به منوی اصلی
 * می‌پرد به‌جای یک قدم عقب)، و ردیفِ رجیستری‌ای که هیچ صداکننده‌ای ندارد کدِ مرده است. */
const SRC_NC = noComments(SRC);
const used = new Set([...SRC_NC.matchAll(/nav(?:Go|Enter)\([^,]+,\s*(?:'(\w+)'|[^,)]*\?\s*'(\w+)'\s*:\s*'(\w+)')/g)]
  .flatMap(m => [m[1], m[2], m[3]]).filter(Boolean));
const missing = [...used].filter(k => !regKeys.includes(k));
const orphan = regKeys.filter(k => !used.has(k));
ok(missing.length === 0, 'هر صفحه‌ای که navGo/navEnter صدا می‌زند در رجیستری اعلام شده',
  missing.length ? `اعلام‌نشده: ${missing.join('، ')}` : '');
ok(orphan.length === 0, 'هیچ ردیفِ رجیستریِ بی‌صداکننده‌ای نمانده (کدِ مرده)',
  orphan.length ? `بی‌مصرف: ${orphan.join('، ')}` : '');

const backRowSrc = bodyOf('function navBackRow(uid, legacy = []) {');
ok(backRowSrc ? /NAV_GUARD_ENABLED/.test(backRowSrc) : false,
  'ردیفِ بازگشت پشتِ همان پرچمِ رول‌بکِ ناوبری است (NAV_GUARD_ENABLED)');
ok(backRowSrc ? /navMenuRow\(\)/.test(backRowSrc) : false,
  'و در لایه‌ی ۱ به همان `navMenuRow()`ِ همیشگی برمی‌گردد، نه یک دکمه‌ی دومِ موازی');
ok(backRowSrc ? /navV2For\(uid\)/.test(backRowSrc) : false,
  'و پشتِ گیتِ انتشارِ مرحله‌ای است (navV2For) — کاربرِ خارج از دامنه `legacy` را می‌گیرد');

/* ══ ۲) رفتار: همان توابع، روی یک سشنِ واقعی ════════════════════════════════ */
console.log('\n▶ رفتار (توابعِ بریده‌شده از سورس، اجرا روی سشنِ واقعی)');

const stateSrc = bodyOf('function navState(uid) {');
const enterSrc = bodyOf('function navEnter(uid, s, a = \'\') {');
const goSrc = bodyOf('function navGo(uid, s, a = \'\') {');
ok(!!(stateSrc && enterSrc && goSrc && backRowSrc), 'هر چهار تابعِ پشته از سورس بریده شدند');

/** `inScope` = کاربر داخلِ دامنه‌ی انتشارِ مرحله‌ای است یا نه (بند ۲ج-۲ ریشه). */
function harness(guardOn, inScope = true) {
  const store = new Map();
  const env = {
    NAV_GUARD_ENABLED: guardOn,
    NAV_STACK_MAX: MAXV,
    navV2For: () => inScope,
    L: { buttons: { backOneStep: '◀️ بازگشت' } },
    Markup: { button: { callback: (t, d) => ({ text: t, callback_data: d }) } },
    navMenuRow: () => [[{ text: '◀️ بازگشت به منوی اصلی', callback_data: 'nav:menu' }]],
    logErr: () => {},
    getSession: (uid) => store.get(uid) ?? null,
    patchSession: (uid, p) => store.set(uid, { ...(store.get(uid) || {}), ...p }),
  };
  const fn = new Function(...Object.keys(env),
    `${stateSrc}\n${enterSrc}\n${goSrc}\n${backRowSrc}\n` +
    'return { navState, navEnter, navGo, navBackRow };');
  return { ...fn(...Object.values(env)), store };
}

const H = harness(true);
const UID = 7;
const dataOf = (row) => (row && row[0] && row[0][0] && row[0][0].callback_data) || null;

// لایه‌ی ۱: صفحه‌ای که مستقیم از کیبورد باز می‌شود.
H.navEnter(UID, 'w');
ok(dataOf(H.navBackRow(UID)) === 'nav:menu',
  '⭐ لایه‌ی ۱ (ورود از کیبورد) دکمه‌ی «بازگشت به منوی اصلی» می‌گیرد');

// لایه‌ی ۲: یک قدم جلوتر.
H.navGo(UID, 'i');
ok(dataOf(H.navBackRow(UID)) === 'nav:back',
  '⭐ لایه‌ی ۲ دکمه‌ی «بازگشت»ِ یک‌قدمی می‌گیرد، نه بازگشت به منوی اصلی');
ok(H.navState(UID).stack.length === 1 && H.navState(UID).stack[0].s === 'w',
  'و صفحه‌ی قبلی روی پشته نشسته (مقصدِ همان یک قدم)');
ok(H.navState(UID).cur.s === 'i', 'صفحه‌ی جاری همان صفحه‌ی تازه است');

// پاپ کردن (همان کاری که هندلرِ nav:back می‌کند) باید به لایه‌ی ۱ برگرداند.
const st = H.navState(UID);
H.navEnter(UID, st.stack[st.stack.length - 1].s, st.stack[st.stack.length - 1].a);
ok(dataOf(H.navBackRow(UID)) === 'nav:menu',
  'با برگشتن به همان ریشه، دکمه دوباره «بازگشت به منوی اصلی» می‌شود');

// navEnter پشته را ریست می‌کند (ورودِ تازه از کیبورد = ریشه‌ی تازه).
H.navEnter(UID, 'fm'); H.navGo(UID, 'ps', 'love:m'); H.navGo(UID, 'nb', 'love3');
ok(H.navState(UID).stack.length === 2, 'زنجیره‌ی سه‌مرحله‌ای پشته‌ی دوتایی می‌سازد');
H.navEnter(UID, 'w');
ok(H.navState(UID).stack.length === 0 && dataOf(H.navBackRow(UID)) === 'nav:menu',
  'ورودِ تازه از کیبورد پشته را ریست می‌کند (ریشه، نه ادامه‌ی زنجیره‌ی قبلی)');

// سقفِ پشته
H.navEnter(UID, 'fm');
for (let i = 0; i < MAXV + 5; i++) H.navGo(UID, 'ps', `t${i}:m`);
ok(H.navState(UID).stack.length === MAXV,
  `پشته از NAV_STACK_MAX رد نمی‌شود (${H.navState(UID).stack.length} ≤ ${MAXV})`);

// fail-safe: سشنِ خالی/خراب هیچ‌وقت نمی‌ترکد و دقیقاً یعنی «لایه‌ی ۱».
const H2 = harness(true);
ok(dataOf(H2.navBackRow(99)) === 'nav:menu',
  'کاربرِ بدونِ سشن (دکمه‌ی کهنه، بعد از setSession(null)) به منوی اصلی می‌رسد، نه بن‌بست');
H2.store.set(98, { nav: 'خراب', navCur: 5 });
let threw = false;
try { H2.navBackRow(98); } catch { threw = true; }
ok(!threw && dataOf(H2.navBackRow(98)) === 'nav:menu',
  'سشنِ بدشکل هم fail-safe است (نه استثنا، نه دکمه‌ی مرده)');

// رول‌بکِ یک‌خطی
const H3 = harness(false);
H3.navEnter(UID, 'fm'); H3.navGo(UID, 'ps', 'love:m');
ok(H3.navBackRow(UID).length === 0,
  'با NAV_GUARD_ENABLED=false هیچ ردیفِ بازگشتی ساخته نمی‌شود (رول‌بکِ یک‌خطی)');
const LEGACY = [[{ text: 'قدیمی', callback_data: 'legacy' }]];
ok(dataOf(H3.navBackRow(UID, LEGACY)) === 'legacy',
  'و همان ردیفِ v3.96.0 (`legacy`) جایش می‌نشیند، نه هیچ‌چیز');

/* ══ ۲ب) گیتِ انتشارِ مرحله‌ای: کاربرِ خارج از دامنه = بیت‌به‌بیت v3.96.0 ════════ */
console.log('\n▶ گیتِ فقط-ادمین (بند ۲ج-۲ ریشه)');

const HOUT = harness(true, false);   // پرچمِ ناوبری روشن، ولی کاربر خارج از دامنه
HOUT.navEnter(UID, 'fm'); HOUT.navGo(UID, 'ps', 'love:m');
ok(HOUT.navBackRow(UID).length === 0,
  '⭐ کاربرِ خارج از دامنه هیچ ردیفِ بازگشتِ تازه‌ای نمی‌گیرد (پیش‌فرضِ legacy خالی است)');
ok(dataOf(HOUT.navBackRow(UID, LEGACY)) === 'legacy',
  '⭐ و هرجا v3.96.0 دکمه‌ای داشت، دقیقاً همان دکمه می‌آید (هیچ صفحه‌ای بن‌بست نمی‌شود)');
ok(HOUT.store.size === 0,
  'و هیچ چیزی در سشنش نوشته نمی‌شود (navEnter/navGo برایش no-op اند)');
// کنترلِ مثبت: همان هارنس با دامنه‌ی باز واقعاً می‌نویسد و دکمه‌ی تازه می‌دهد.
const HIN = harness(true, true);
HIN.navEnter(UID, 'fm'); HIN.navGo(UID, 'ps', 'love:m');
ok(HIN.store.size === 1 && dataOf(HIN.navBackRow(UID, LEGACY)) === 'nav:back',
  'کنترلِ مثبت: کاربرِ داخلِ دامنه پشته می‌سازد و «بازگشت»ِ یک‌قدمی می‌گیرد');

/* ══ ۳) هندلرِ nav:back — ترتیبِ پاپ و رندر، و بی‌ضرر بودنش ══════════════════ */
console.log('\n▶ هندلرِ nav:back');

const handler = bodyOf("bot.action('nav:back', async (ctx) => {", '\n});');
ok(!!handler, 'هندلرِ nav:back در سورس هست');
const hNC = noComments(handler || '');

const iPop = hNC.indexOf('nav: stack.slice(0, -1)');
const iRender = hNC.indexOf('NAV_SCREENS[prev.s](uid');
ok(iPop > -1 && iRender > -1 && iPop < iRender,
  '⭐ پاپ **قبل از** رندر است (وگرنه صفحه‌ی مقصد که حالا ریشه است هنوز «بازگشت» نشان می‌دهد)');
ok(/if \(!page\) \{[\s\S]*?nav: stack[\s\S]*?navCur: cur/.test(hNC),
  'شکستِ رندر پشته را دقیقاً به حالتِ قبل برمی‌گرداند (نه به خالی)');
ok(/if \(!page\) return navToMenu\(ctx\);/.test(hNC),
  'پشته‌ی خالی یا صفحه‌ی ناشناخته به منوی اصلی می‌رسد، نه سکوت (بند ۹ب/۱)');
ok(/editMessageText\(text, extra\)/.test(hNC) && /catch \{[\s\S]*?ctx\.reply\(text, extra\)/.test(hNC),
  'ادیت-در-جا با فالبکِ پیامِ تازه (پیامِ کهنه‌ی غیرقابلِ‌ادیت بن‌بست نمی‌شود)');

/* بی‌ضرر بودن: این فقط یک رندرِ دوباره است. اگر روزی استیت بنویسد یا فلویی را بکشد،
 * دقیقاً همان کلاسِ باگِ تیکتِ #TRT-8976388520 برمی‌گردد (بند ۹ب/۶). */
ok(!/\bsetState\(/.test(hNC), 'nav:back هیچ استیتی نمی‌نویسد');
ok(!/setSession\(uid, null\)/.test(hNC), 'و سشن را پاک نمی‌کند');
ok(!/cancelReading\(|setPaymentStatus\(|dropInvoiceArtifacts\(/.test(hNC),
  'و هیچ فلوی پولی‌ای را نمی‌کشد (فقط رندرِ دوباره)');

/* ادعای **معکوس**: خودِ هارنس باید بتواند قرمز بدهد. اگر پاپ بعد از رندر بیفتد،
 * صفحه‌ی ریشه هنوز دکمه‌ی «بازگشت» می‌گیرد — یعنی کاربر یک قدمِ اضافه گیر می‌کند. */
const H4 = harness(true);
H4.navEnter(UID, 'fm'); H4.navGo(UID, 'ps', 'love:m');
const wrongOrder = (uid) => { const row = H4.navBackRow(uid); const s = H4.navState(uid);
  H4.navEnter(uid, s.stack[s.stack.length - 1].s, s.stack[s.stack.length - 1].a); return row; };
ok(dataOf(wrongOrder(UID)) === 'nav:back',
  'کنترلِ مثبت: با ترتیبِ برعکس، ریشه به‌غلط «بازگشت» می‌گیرد (پس ادعای ترتیب پوچ نیست)');

/* ══ ۴) سیم‌کشی: هر صفحه‌ی لایه‌ی ۱ و ۲ واقعاً ردیفِ بازگشت دارد ═══════════════ */
console.log('\n▶ سیم‌کشیِ صفحه‌ها');

// لایه‌ی ۱ — همان چهار صفحه‌ای که مالک به‌نام گفت خراب‌اند.
const walletScreen = noComments(bodyOf('const walletScreen = (uid) => [', '\n}];') || '');
ok(/navBackRow\(uid\)/.test(walletScreen), '«ذخایر الماس» ردیفِ بازگشت دارد');
const inviteScreen = noComments(bodyOf('const inviteScreen = (uid) => {', '\n};') || '');
ok(/navBackRow\(uid\)/.test(inviteScreen), '«دعوت دوستان» ردیفِ بازگشت دارد');
ok(/L\.lucky\.already[\s\S]{0,200}?navMenuRow\(\)|navMenuRow\(\)[\s\S]{0,200}?L\.lucky\.already/
  .test(SRC_NC), '«کارت شانسِ امروز استفاده‌شده» دیگر بن‌بست نیست');
ok(/registerSupport\([\s\S]{0,400}?extraRows/.test(SRC_NC),
  '«پشتیبانی» ردیفِ بازگشت می‌گیرد (پارامترِ افزایشیِ extraRows در shared/support.js)');

// لایه‌ی ۲ — صفحه‌هایی که از دلِ صفحه‌ی دیگر باز می‌شوند.
const pickSize = noComments(bodyOf('function pickSizeScreen(uid, t, from) {', '\n}') || '');
ok(/navBackRow\(uid[,)]/.test(pickSize), '«تاروت چند کارتی؟» ردیفِ بازگشت دارد');
ok(/tback:/.test(pickSize),
  'و فالبکِ `tback:`ِ نسلِ قبل سرِ جایش است (دکمه‌ی کهنه نمی‌میرد، بند ۲ج/۶)');
const needBal = noComments(bodyOf('const needBalanceScreen = (uid, spread) => [', '\n];') || '');
ok(/navBackRow\(uid\)/.test(needBal), 'صفحه‌ی کم‌موجودی ردیفِ بازگشت دارد');
/* ⚠️ ردیفِ بازگشت عمداً **بیرونِ** needBalanceAltRows است: آن تابع قراردادِ خودش را دارد
 * («افزایشِ ذخایر همیشه آخرین دکمه») و ریختنِ nav داخلش آن قرارداد را می‌شکست. */
ok(/needBalanceAltRows\(uid, spread\), \.\.\.navBackRow\(uid\)/.test(needBal),
  'و بعد از needBalanceAltRows می‌آید، نه داخلش (قراردادِ «افزایشِ ذخایر آخر» نمی‌شکند)');
const packMenu = noComments(bodyOf('function packMenuScreen(uid, paymentId = 0) {', '\n}') || '');
ok(/navBackRow\(uid[,)]/.test(packMenu), 'صفحه‌ی بسته‌ها ردیفِ بازگشت دارد');

/* ══ ۵) الگوی دو-ثابتیِ بند ۲ج-۲: فقط-ادمین، و هیچ پرچمِ خامی ══════════════════ */
console.log('\n▶ الگوی دو-ثابتیِ انتشارِ مرحله‌ای');

ok(/^const UX_NAV_V2 = true;$/m.test(SRC), 'کلیدِ خاموشیِ کلِ فیچر یک ثابتِ نام‌دار است (UX_NAV_V2)');
ok(/^const UX_NAV_V2_ADMIN_ONLY = true;$/m.test(SRC),
  '⭐ و دامنه برای **همه‌ی کاربران** باز است (UX_NAV_V2_ADMIN_ONLY = true)');
ok(/const navV2For = \(uid\) => UX_NAV_V2 && \(!UX_NAV_V2_ADMIN_ONLY \|\| isTester\(uid\)\);/.test(SRC),
  'helper هر دو ثابت را با هم می‌خواند و از isTester (نه isAdmin) می‌پرسد');

/* ⚠️ هیچ‌جا پرچمِ خام صدا زده نشود — مسیری که گیت را جا بیندازد یعنی کاربرِ واقعیِ
 * رباتِ زنده وسطِ فلو نسخه‌ی نیمه‌تمام می‌بیند (بند ۲ج-۲ ریشه). کامنت‌ها کنار می‌روند
 * تا خودِ سندنویسی قرمزِ کاذب نسازد (تله‌ی ثبت‌شده‌ی v3.56.0). */
const rawFlag = (SRC_NC.match(/\bUX_NAV_V2(?:_ADMIN_ONLY)?\b/g) || []).length;
ok(rawFlag === 4, `پرچمِ خام دقیقاً ۴ بار می‌آید (دو تعریف + دو بار داخلِ helper) — دیدم: ${rawFlag}`);

// و خودِ گیت واقعاً به مسیرهای رو-به-کاربر وصل است (نه فقط تعریف‌شده).
for (const [needle, msg] of [
  ['navV2For(uid) ? \'invite_edit\' : \'invite_go\'', 'دکمه‌ی دعوتِ صفحه‌ی ذخایر گیت دارد'],
  ['if (!navV2For(uid)) {', 'مسیرِ wallet_fresh برای کاربرِ خارج از دامنه همان v3.96.0 است'],
  ['navV2For(uid) && REFUND_ON_CANCEL === false', 'متنِ هشدارِ انصرافِ فالِ پول‌داده گیت دارد'],
  ['if (navV2For(uid)) {\n    trackRechargeStarted(uid);', 'ساخته‌نشدنِ ردیفِ پرداخت در recharge گیت دارد'],
]) ok(SRC.includes(needle), msg);

console.log(fail ? `\n❌ نتیجه: ${pass} پاس، ${fail} خطا` : `\n✅ نتیجه: ${pass} پاس، ۰ خطا`);
process.exit(fail ? 1 : 0);
