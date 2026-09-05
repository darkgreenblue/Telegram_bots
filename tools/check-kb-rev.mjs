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
const fn = bodyOf('async function ensureKeyboard(tg, uid) {');
ok(!!fn, 'تابعِ تازه‌سازی پیدا شد');
// ⚠️ مهم‌ترین ادعای این فایل. میدل‌ورِ جرنی `reply`/`replyWithPhoto`/`editMessageText` را
// روی ctx رپ می‌کند؛ `ctx.telegram.*` رپ نمی‌شود. از v3.56.0 خودِ آبجکتِ telegram پاس
// داده می‌شود (چون جاروی شبانه ctx ندارد)، پس ادعا روی همان است.
ok(fn ? /tg\.sendMessage\(/.test(fn) : false,
  'حامل از tg.sendMessage می‌رود (رپ نمی‌شود → صفر رویدادِ view)');
ok(fn ? !/ctx\./.test(fn) : false,
  'حامل هرگز به ctx دست نمی‌زند (وگرنه یک صفحه‌ی جعلی وارد قیف و کاتالوگِ screens می‌شد)');
ok(/await ensureKeyboard\(ctx\.telegram, ctx\.from\?\.id\)/.test(SRC),
  'میدل‌ور همان ctx.telegram را پاس می‌دهد، نه خودِ ctx');
ok(fn ? /tg\.deleteMessage\(/.test(fn) : false, 'حامل بلافاصله حذف می‌شود');
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
ok(fn ? /KB_QUIET_STATES\.has\(getState\(uid\)\)/.test(fn) : false,
  'کاربرِ وسطِ آنبوردینگ یا یک استیتِ ورودی کیبورد نمی‌گیرد (قراردادِ v3.16.0 نمی‌شکند)');
ok(fn ? /!u\?\.welcomed/.test(fn) : false, 'کاربرِ آنبوردنشده هم نمی‌گیرد');
ok(fn ? /catch \(e\)/.test(fn) : false, 'شکستِ ارسال اقدامِ کاربر را نمی‌شکند');

/* ══ ۳ب) تورِ کهنگی: منوی گم‌شده خودش برمی‌گردد (v3.56.0) ════════════════
   🐛 اکانتی که مدتی سر نزده بود **هیچ منوی پایینی نداشت** و هیچ مسیرِ ترمیمی هم وجود
   نداشت: `ensureMenu` در دنیای الماس no-op است و دو نقطه‌ی صدورِ قراردادی ممکن است
   هفته‌ها نرسند. حالا همان حاملِ بی‌صدا با شرطِ کهنگی هم شلیک می‌کند. */
console.log('\n  — 🩹 تورِ کهنگی:');
ok(fn ? /claimKbShown\.run\(uid, cutoff\)\.changes/.test(fn) : false,
  'مسیرِ کهنگی هم ادعای اتمیکِ خودش را دارد (ضدِ دو حاملِ هم‌زمان)');
const claimShown = SRC.match(/claimKbShown: db\.prepare\('([^']+)'\)/)?.[1] || '';
ok(/COALESCE\(kb_shown_at,0\)<\?/.test(claimShown),
  'شرطِ کهنگی داخلِ خودِ UPDATE است، نه در جاوااسکریپت', claimShown);
ok(/kb_shown_at=unixepoch\(\)/.test(claimShown), 'ادعا همان لحظه مهرِ تازه می‌زند');
{
  const hrs = Number(SRC.match(/const KB_ENSURE_HOURS = (\d+);/)?.[1]);
  ok(Number.isInteger(hrs) && hrs > 0 && hrs <= 48,
    `پنجره‌ی کهنگی یک عددِ معقول است (${hrs} ساعت)`);
  // ⚠️ `|` نه `||`: با short-circuit، وقتی نسخه عقب بود مهرِ کهنگی زده نمی‌شد و کاربر
  // بلافاصله دوباره کاندیدِ حامل می‌ماند.
  ok(fn ? /const bumpedStale = /.test(fn) && /if \(!bumpedRev && !bumpedStale\) return;/.test(fn) : false,
    'هر دو مسیر مستقل ادعا می‌کنند و ارسال فقط با یکی از آن دو انجام می‌شود');
}

/* ══ ۳ج) رفتاری: خودِ تابع از سورس اجرا می‌شود ═══════════════════════════ */
console.log('\n  — 🧪 رفتارِ واقعیِ تابع:');
{
  const src = bodyOf('const KB_ENSURE_HOURS =');
  const run = src ? new Function('deps', `
    const { getUser, getState, stmts, mainKeyboard, L, KB_REV, KB_QUIET_STATES, logErr } = deps;
    ${src}}
    return ensureKeyboard;`) : null;
  const NOW = Math.floor(Date.now() / 1000);
  const scenario = async (u, state) => {
    const log = { sent: 0, deleted: 0, silent: null, revClaims: 0, shownClaims: 0 };
    const fnR = run({
      getUser: () => u, getState: () => state, mainKeyboard: () => ({ reply_markup: 'KB' }),
      L: { onboarding: { kbRefresh: 'x' } }, KB_REV: 1,
      KB_QUIET_STATES: new Set(['onboard_name', 'await_question', 'pay_receipt']),
      logErr: () => {},
      stmts: {
        claimKbRev: { run: () => { log.revClaims++; return { changes: (u.kb_rev || 0) < 1 ? 1 : 0 }; } },
        claimKbShown: { run: (_uid, cut) => { log.shownClaims++; return { changes: (u.kb_shown_at || 0) < cut ? 1 : 0 }; } },
      },
    });
    await fnR({
      sendMessage: (_id, _t, o) => { log.sent++; log.silent = o.disable_notification; return Promise.resolve({ message_id: 5 }); },
      deleteMessage: () => { log.deleted++; return Promise.resolve(); },
    }, 7);
    return log;
  };
  const base = { welcomed: 1, kb_rev: 1 };
  ok((await scenario({ ...base, kb_shown_at: 0 }, 'idle')).sent === 1,
    'کاربری که **هرگز** کیبورد نگرفته، در اولین اقدام می‌گیردش (خودِ باگِ گزارش‌شده)');
  ok((await scenario({ ...base, kb_shown_at: NOW - 40 * 86400 }, 'idle')).sent === 1,
    'کاربرِ خوابیده‌ی چهل‌روزه هم می‌گیردش');
  ok((await scenario({ ...base, kb_shown_at: NOW - 60 }, 'idle')).sent === 0,
    'کاربری که همین الان گرفته دوباره نمی‌گیرد (تور اسپم نمی‌سازد)');
  const fresh = await scenario({ ...base, kb_shown_at: NOW - 40 * 86400 }, 'idle');
  ok(fresh.silent === true && fresh.deleted === 1, 'حامل بی‌صدا می‌رود و بلافاصله حذف می‌شود');
  // 🔑 ادعای مرکزیِ استیتِ ورودی: وسطِ «سؤالت رو بنویس» کیبورد نمی‌رود، چون فرستادنش
  // ناحیه‌ی ورودی را از کیبوردِ تایپ به کیبوردِ سفارشی سوییچ می‌کند.
  for (const st of ['await_question', 'pay_receipt', 'onboard_name']) {
    ok((await scenario({ ...base, kb_shown_at: 0 }, st)).sent === 0,
      `در استیتِ ورودیِ «${st}» هیچ کیبوردی فرستاده نمی‌شود`);
  }
  ok((await scenario({ welcomed: 0, kb_rev: 1, kb_shown_at: 0 }, 'idle')).sent === 0,
    'کاربرِ آنبوردنشده هیچ‌وقت نمی‌گیرد');
  ok((await scenario({ welcomed: 1, kb_rev: 0, kb_shown_at: NOW - 60 }, 'idle')).sent === 1,
    'نسخه‌ی عقبِ کیبورد هنوز مثل قبل حامل می‌فرستد (رفتارِ v3.39.0 نشکسته)');
  // 🔙 رول‌بکِ ادعاشده باید واقعاً کار کند. با صفر، `cutoff` همین لحظه می‌شود و بدونِ
  // گاردِ صریح، تور به‌جای خاموش شدن روی **هر** اقدام شلیک می‌کرد.
  {
    const src0 = bodyOf('const KB_ENSURE_HOURS =');
    const off = new Function('deps', `
      const { getUser, getState, stmts, mainKeyboard, L, KB_REV, KB_QUIET_STATES, logErr } = deps;
      ${src0.replace(/const KB_ENSURE_HOURS = \d+;/, 'const KB_ENSURE_HOURS = 0;')}}
      return ensureKeyboard;`)({
      getUser: () => ({ welcomed: 1, kb_rev: 1, kb_shown_at: NOW - 40 * 86400 }),
      getState: () => 'idle', mainKeyboard: () => ({}), L: { onboarding: { kbRefresh: 'x' } },
      KB_REV: 1, KB_QUIET_STATES: new Set(), logErr: () => {},
      stmts: { claimKbRev: { run: () => ({ changes: 0 }) }, claimKbShown: { run: () => ({ changes: 1 }) } },
    });
    let sent = 0;
    await off({ sendMessage: () => { sent++; return Promise.resolve({ message_id: 1 }); }, deleteMessage: () => Promise.resolve() }, 7);
    ok(sent === 0, 'رول‌بکِ KB_ENSURE_HOURS=0 واقعاً تور را خاموش می‌کند (نه اینکه شلیکش کند)');
  }
  // شکستِ ارسال نباید استثنا بیرون بدهد (اقدامِ کاربر را می‌شکست).
  {
    const fnR = run({
      getUser: () => ({ welcomed: 1, kb_rev: 1, kb_shown_at: 0 }), getState: () => 'idle',
      mainKeyboard: () => ({}), L: { onboarding: { kbRefresh: 'x' } }, KB_REV: 1,
      KB_QUIET_STATES: new Set(), logErr: () => {},
      stmts: { claimKbRev: { run: () => ({ changes: 0 }) }, claimKbShown: { run: () => ({ changes: 1 }) } },
    });
    let threw = false;
    await fnR({ sendMessage: () => Promise.reject(new Error('blocked')) }, 7).catch(() => { threw = true; });
    ok(!threw, 'شکستِ ارسال (کاربرِ بلاک‌کرده) استثنا بیرون نمی‌دهد');
  }
}

/* ══ ۴) میدل‌ور: بعد از جرنی، و بدونِ بلاک ═══════════════════════════════ */
console.log('\n  — 🧭 جای میدل‌ور:');
const iJourney = SRC.indexOf('registerJourney(bot,');
const iMw = SRC.indexOf('ensureKeyboard(ctx.telegram, ctx.from?.id)');
ok(iJourney > -1 && iMw > iJourney, 'میدل‌ورِ کیبورد بعد از میدل‌ورِ جرنی ثبت می‌شود (logAct عادی ثبت شود)');
const mw = bodyOf('bot.use(async (ctx, next) => {\n  if (ctx.message || ctx.callbackQuery) {', '\n});');
ok(mw ? /return next\(\)/.test(mw) : false, 'میدل‌ور همیشه next() را صدا می‌زند (هیچ فلویی بلاک نمی‌شود)');
ok(mw ? /stmts\.touchSeen\.run\(ctx\.from\.id\)/.test(mw) : false,
  'همان میدل‌ور مهرِ «آخرین اقدام» را هم می‌زند (تک‌نقطه، هیچ مسیری جا نمی‌ماند)');
ok(mw ? /try \{[^}]*touchSeen[^}]*\} catch/.test(mw) : false,
  'شکستِ مهرِ زمان اقدامِ کاربر را نمی‌شکند');
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
