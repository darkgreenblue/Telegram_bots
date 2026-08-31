// چکِ CI برای قراردادِ «نسخه‌ی کیبوردِ ماندگار» (tarot) — بند ۹ب-۲ ریشه.
//
// مسئله‌ای که این فایل از آن آمد: کیبوردِ reply روی **گوشیِ کاربر** ذخیره است و هیچ متدی
// در Bot API از سمتِ سرور تازه‌اش نمی‌کند. پس یک دکمه‌ی تازه در منوی اصلی می‌تواند
// هفته‌ها به کاربرِ فعلی نرسد، **بدونِ اینکه هیچ خطایی بدهد**. مالک این را روی
// دکمه‌ی «تنظیمات» دید: تا ربات را بلاک و دوباره /start نزد، منو را ندید.
//
// دو چیزی که این‌جا قفل می‌شود:
//   ۱) هر تغییرِ شکلِ `mainKeyboard` باید `KB_REV` را بالا ببرد. چون فراموش‌کردنش بی‌صدا
//      است، به یادآوری در مستندات تکیه نمی‌کنیم: اثرانگشتِ شکلِ کیبورد این‌جا پین شده.
//   ۲) حاملِ تازه‌سازی نباید از `ctx.reply` برود. میدل‌ورِ جرنی آن را رپ می‌کند و یک
//      رویدادِ `view` و یک «صفحه»ی جعلی می‌سازد، یعنی دیتای جرنی از اعتبار می‌افتد.
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function bodyOf(marker, end = '\n}') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n⌨️ نسخه‌ی کیبوردِ ماندگار\n');

/* ══ ۱) اثرانگشتِ شکلِ کیبورد ══════════════════════════════════════════════ */
// عمداً روی **شکلِ رو-به-کاربر** حساب می‌شود نه کلِ متنِ تابع: ویرایشِ یک کامنت نباید
// بامپ بخواهد، ولی جابه‌جایی/افزودن/حذفِ یک دکمه باید.
const kbFn = bodyOf('function mainKeyboard(uid) {');
ok(!!kbFn, 'تابع mainKeyboard پیدا شد');
const shape = (kbFn || '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')   // کامنت‌ها حساب نمی‌شوند
  .match(/L\.buttons\.\w+|supportRow|SETTINGS_ENABLED|isTester|FREE_MENU_ENABLED|rows\.push|rows\.splice|uxV2For/g) || [];
const fp = createHash('sha256').update(shape.join('|')).digest('hex').slice(0, 12);

const pinned = SRC.match(/KB_SHAPE_FINGERPRINT\s*=\s*'([0-9a-f]{12})'/)?.[1];
const rev = Number(SRC.match(/const KB_REV = (\d+);/)?.[1]);
ok(Number.isInteger(rev) && rev >= 1, `KB_REV یک عددِ معتبر است (${rev})`);
ok(!!pinned, 'اثرانگشتِ شکلِ کیبورد در index.js پین شده');
ok(pinned === fp,
  'شکلِ کیبورد با اثرانگشتِ پین‌شده می‌خواند (اگر قرمز است: کیبورد عوض شده → KB_REV را بامپ کن و اثرانگشت را به‌روز)',
  `محاسبه‌شده: ${fp}  |  پین‌شده: ${pinned || '(هیچ)'}\n     شکل: ${shape.join(' ')}`);

/* ══ ۲) حاملِ تازه‌سازی نباید جرنی را آلوده کند ═══════════════════════════ */
console.log('\n  — 🧪 سلامتِ دیتای جرنی:');
const fn = bodyOf('async function refreshKeyboardIfStale(ctx, uid) {');
ok(!!fn, 'تابعِ تازه‌سازی پیدا شد');
// ⚠️ مهم‌ترین ادعای این فایل. میدل‌ورِ جرنی `reply`/`replyWithPhoto`/`editMessageText` را
// روی ctx رپ می‌کند؛ `ctx.telegram.*` رپ نمی‌شود.
ok(fn ? /ctx\.telegram\.sendMessage\(/.test(fn) : false,
  'حامل از ctx.telegram.sendMessage می‌رود (رپ نمی‌شود → صفر رویدادِ view)');
ok(fn ? !/ctx\.reply\(/.test(fn) : false,
  'حامل هرگز از ctx.reply نمی‌رود (وگرنه یک صفحه‌ی جعلی وارد قیف و کاتالوگِ screens می‌شد)');
ok(fn ? /ctx\.telegram\.deleteMessage\(/.test(fn) : false, 'حامل بلافاصله حذف می‌شود');
ok(fn ? /disable_notification: true/.test(fn) : false, 'حامل بی‌صدا می‌رود');
// و همین ادعا روی کلِ سورس: هیچ‌جای دیگری نباید حاملِ دومی بسازد
ok((SRC.match(/kbRefresh/g) || []).length === 1, 'متنِ حامل فقط یک مصرف دارد');

/* ══ ۳) دقیقاً یک بار per کاربر per نسخه ═════════════════════════════════ */
console.log('\n  — 🔁 یک‌بار بودن:');
ok(fn ? /stmts\.claimKbRev\.run\(KB_REV, uid, KB_REV\)\.changes/.test(fn) : false,
  'گاردِ اتمیک قبل از ارسال ادعا می‌کند (ضدِ دو پیامِ هم‌زمان)');
const claim = SRC.match(/claimKbRev: db\.prepare\('([^']+)'\)/)?.[1] || '';
ok(/kb_rev<\?/.test(claim), 'شرطِ «نسخه‌ی عقب» داخلِ خودِ UPDATE است، نه در جاوااسکریپت', claim);
{
  const iClaim = fn ? fn.indexOf('claimKbRev') : -1;
  const iSend = fn ? fn.indexOf('sendMessage') : -1;
  ok(iClaim > -1 && iSend > -1 && iClaim < iSend, 'مهر قبل از ارسال زده می‌شود');
}
ok(fn ? /ONBOARDING_STATES\.includes\(getState\(uid\)\)/.test(fn) : false,
  'کاربرِ وسطِ آنبوردینگ کیبورد نمی‌گیرد (قراردادِ v3.16.0 نمی‌شکند)');
ok(fn ? /!u\?\.welcomed/.test(fn) : false, 'کاربرِ آنبوردنشده هم نمی‌گیرد');
ok(fn ? /catch \(e\)/.test(fn) : false, 'شکستِ ارسال اقدامِ کاربر را نمی‌شکند');

/* ══ ۴) میدل‌ور: بعد از جرنی، و بدونِ بلاک ═══════════════════════════════ */
console.log('\n  — 🧭 جای میدل‌ور:');
const iJourney = SRC.indexOf('registerJourney(bot,');
const iMw = SRC.indexOf('refreshKeyboardIfStale(ctx, ctx.from?.id)');
ok(iJourney > -1 && iMw > iJourney, 'میدل‌ورِ کیبورد بعد از میدل‌ورِ جرنی ثبت می‌شود (logAct عادی ثبت شود)');
const mw = bodyOf('  if (ctx.message || ctx.callbackQuery) await refreshKeyboardIfStale', '\n});');
ok(mw ? /return next\(\)/.test(mw) : false, 'میدل‌ور همیشه next() را صدا می‌زند (هیچ فلویی بلاک نمی‌شود)');
ok(/if \(ctx\.message \|\| ctx\.callbackQuery\)/.test(SRC),
  'فقط روی اقدامِ واقعیِ کاربر اجرا می‌شود، نه آپدیت‌های سرویسیِ تلگرام');

/* ══ ۵) پشتیبانی و تنظیمات کنارِ هم ══════════════════════════════════════ */
console.log('\n  — 📐 چیدمان:');
ok(kbFn ? /const tail = \[\.\.\.sup, \.\.\.\(SETTINGS_ENABLED \? \[L\.buttons\.settings\] : \[\]\)\]/.test(kbFn) : false,
  'پشتیبانی و تنظیمات در یک ردیف‌اند (نه دو ردیفِ جدا)');
ok(kbFn ? /if \(tail\.length\) rows\.push\(tail\)/.test(kbFn) : false,
  'اگر هر دو خاموش باشند ردیفِ خالی ساخته نمی‌شود');

console.log(`\n${fail ? '❌' : '✅'} نسخه‌ی کیبورد: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
