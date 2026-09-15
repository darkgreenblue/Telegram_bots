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
  'استیتِ ورودی هنوز گاردِ خودش را دارد (قراردادِ v3.16.0 نمی‌شکند)');
ok(fn ? /!u\?\.welcomed/.test(fn) : false, 'کاربرِ آنبوردنشده هم نمی‌گیرد');
// 🔒 گاردِ ساختاریِ بند ۹ب-۳: گاردِ استیتِ ورودی **نباید** بی‌قید باشد، وگرنه کاربری که
// هیچ کیبوردی ندارد داخلِ یک استیتِ ورودی برای همیشه بی‌منو می‌ماند (باگِ ۱۴۰۵/۰۶/۱۵).
ok(fn ? /if \(!neverHadKb && KB_QUIET_STATES\.has\(getState\(uid\)\)\) return;/.test(fn) : false,
  'گاردِ استیتِ ورودی فقط برای کسی است که از قبل کیبورد دارد، نه برای کسی که هیچ ندارد');
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
  /* ⚠️ لیستِ استیت‌های ساکت از **خودِ سورس** ساخته می‌شود، نه یک کپیِ محلی. نسخه‌ی قبلیِ
     همین تست سه استیت را دستی نوشته بود، پس `pay_amount`/`pay_discount`/`settings_name`
     اصلاً سنجیده نمی‌شدند و اضافه شدنِ یک استیتِ ساکتِ تازه هم بی‌صدا از پوشش بیرون
     می‌ماند (همان تله‌ی ثبت‌شده‌ی «کپیِ منطق در تست»). */
  const listOf = (name) => (SRC.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] || '')
    .match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) || [];
  const ONB = listOf('ONBOARDING_STATES');
  const quietTail = (SRC.match(/const KB_QUIET_STATES = new Set\(\[([\s\S]*?)\]\)/)?.[1] || '')
    .match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) || [];
  const REAL_QUIET = new Set([...ONB, ...quietTail]);
  ok(ONB.length === 3, `ONBOARDING_STATES از سورس خوانده شد (${ONB.join(', ')})`);
  ok(REAL_QUIET.size >= 8, `KB_QUIET_STATES از سورس خوانده شد (${[...REAL_QUIET].join(', ')})`);
  for (const st of ['await_question', 'pay_amount', 'pay_receipt', 'pay_discount', 'settings_name']) {
    ok(REAL_QUIET.has(st), `«${st}» واقعاً یک استیتِ ساکت است (وگرنه ادعای زیرش پوچ می‌شد)`);
  }

  const src = bodyOf('const KB_ENSURE_HOURS =');
  const run = src ? new Function('deps', `
    const { getUser, getState, stmts, mainKeyboard, L, KB_REV, KB_QUIET_STATES, logErr } = deps;
    ${src}}
    return ensureKeyboard;`) : null;
  const NOW = Math.floor(Date.now() / 1000);
  const scenario = async (u, state, sendFails = false) => {
    const log = {
      sent: 0, deleted: 0, silent: null, revClaims: 0, shownClaims: 0,
      restoredShown: null, restoredRev: null,
    };
    const fnR = run({
      getUser: () => u, getState: () => state, mainKeyboard: () => ({ reply_markup: 'KB' }),
      L: { onboarding: { kbRefresh: 'x' } }, KB_REV: 1,
      KB_QUIET_STATES: REAL_QUIET, logErr: () => {},
      stmts: {
        claimKbRev: { run: () => { log.revClaims++; return { changes: (u.kb_rev || 0) < 1 ? 1 : 0 }; } },
        claimKbShown: { run: (_uid, cut) => { log.shownClaims++; return { changes: (u.kb_shown_at || 0) < cut ? 1 : 0 }; } },
        // ⏪ همان stubهایی که رول‌بکِ v3.93.0 صدا می‌زند؛ فقط آرگومان‌هایشان را ضبط می‌کنند.
        restoreKbShown: { run: (val, _uid) => { log.restoredShown = val; } },
        restoreKbRev: { run: (val, _uid) => { log.restoredRev = val; } },
      },
    });
    await fnR({
      sendMessage: (_id, _t, o) => {
        log.sent++; log.silent = o.disable_notification;
        return sendFails ? Promise.reject(new Error('blocked')) : Promise.resolve({ message_id: 5 });
      },
      deleteMessage: () => { log.deleted++; return Promise.resolve(); },
    }, 7).catch(() => {});
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
  /* 🔑 دو ادعای **مخالفِ هم** روی استیت‌های ورودی — و تفاوتشان کلِ فیکسِ بند ۹ب-۳ است.
     الف) کسی که کیبورد **دارد**: وسطِ «سؤالت رو بنویس» چیزی نمی‌گیرد، چون فرستادنش
          ناحیه‌ی ورودی را از کیبوردِ تایپ به کیبوردِ سفارشی سوییچ می‌کند (قاعده‌ی قدیمی).
     ب) کسی که **هیچ** کیبوردی ندارد: همان‌جا می‌گیرد، چون بدونش هیچ راهی برای دستور
          دادن به ربات ندارد و آن بن‌بست از یک سوییچِ یک‌باره‌ی کیبورد بدتر است. */
  for (const st of ['await_question', 'pay_receipt', 'pay_amount', 'pay_discount', 'settings_name']) {
    ok((await scenario({ ...base, kb_shown_at: NOW - 40 * 86400 }, st)).sent === 0,
      `استیتِ ورودیِ «${st}»: کاربرِ کیبورددار تازه‌سازی نمی‌گیرد (کیبوردِ تایپش نمی‌پرد)`);
  }
  for (const st of ['await_question', 'pay_receipt', 'pay_amount', 'pay_discount', 'settings_name']) {
    ok((await scenario({ ...base, kb_shown_at: 0 }, st)).sent === 1,
      `استیتِ ورودیِ «${st}»: کاربرِ بی‌کیبورد همان‌جا کیبورد می‌گیرد (بن‌بستِ بند ۹ب-۳)`);
  }
  // تنها استثنای مجازِ بند ۹ب-۳: خودِ آنبوردینگ. استیت‌های آنبوردینگ هم welcomed=0 دارند
  // هم در KB_QUIET_STATES اند، پس با **هر دو** گارد باید ساکت بمانند.
  for (const st of ['onboard_name', 'onboard_month', 'idle']) {
    ok((await scenario({ welcomed: 0, kb_rev: 1, kb_shown_at: 0 }, st)).sent === 0,
      `کاربرِ آنبوردنشده در «${st}» هیچ‌وقت نمی‌گیرد (تنها استثنای مجاز)`);
  }
  ok((await scenario({ welcomed: 1, kb_rev: 0, kb_shown_at: NOW - 60 }, 'idle')).sent === 1,
    'نسخه‌ی عقبِ کیبورد هنوز مثل قبل حامل می‌فرستد (رفتارِ v3.39.0 نشکسته)');
  // 🔙 رول‌بکِ ادعاشده باید واقعاً کار کند. با صفر، `cutoff` همین لحظه می‌شود و بدونِ
  // گاردِ صریح، تور به‌جای خاموش شدن روی **هر** اقدام شلیک می‌کرد.
  {
    const src0 = bodyOf('const KB_ENSURE_HOURS =');
    const offFor = (u) => new Function('deps', `
      const { getUser, getState, stmts, mainKeyboard, L, KB_REV, KB_QUIET_STATES, logErr } = deps;
      ${src0.replace(/const KB_ENSURE_HOURS = \d+;/, 'const KB_ENSURE_HOURS = 0;')}}
      return ensureKeyboard;`)({
      getUser: () => u,
      getState: () => 'idle', mainKeyboard: () => ({}), L: { onboarding: { kbRefresh: 'x' } },
      KB_REV: 1, KB_QUIET_STATES: REAL_QUIET, logErr: () => {},
      stmts: {
        claimKbRev: { run: () => ({ changes: 0 }) },
        claimKbShown: { run: (_uid, cut) => ({ changes: (u.kb_shown_at || 0) < cut ? 1 : 0 }) },
      },
    });
    const countSends = async (u) => {
      let sent = 0;
      await offFor(u)({
        sendMessage: () => { sent++; return Promise.resolve({ message_id: 1 }); },
        deleteMessage: () => Promise.resolve(),
      }, 7);
      return sent;
    };
    ok(await countSends({ welcomed: 1, kb_rev: 1, kb_shown_at: NOW - 40 * 86400 }) === 0,
      'رول‌بکِ KB_ENSURE_HOURS=0 تازه‌سازیِ دوره‌ای را واقعاً خاموش می‌کند (نه اینکه شلیکش کند)');
    // 🔒 ولی رول‌بکِ یک بهینه‌سازی نباید خودِ تضمینِ بند ۹ب-۳ را هم ببرد.
    ok(await countSends({ welcomed: 1, kb_rev: 1, kb_shown_at: 0 }) === 1,
      'همان رول‌بک، کاربرِ **بی‌کیبورد** را همچنان ترمیم می‌کند (تضمین رول‌بک‌پذیر نیست)');
  }
  // شکستِ ارسال نباید استثنا بیرون بدهد (اقدامِ کاربر را می‌شکست).
  {
    const fnR = run({
      getUser: () => ({ welcomed: 1, kb_rev: 1, kb_shown_at: 0 }), getState: () => 'idle',
      mainKeyboard: () => ({}), L: { onboarding: { kbRefresh: 'x' } }, KB_REV: 1,
      KB_QUIET_STATES: new Set(), logErr: () => {},
      stmts: {
        claimKbRev: { run: () => ({ changes: 0 }) }, claimKbShown: { run: () => ({ changes: 1 }) },
        restoreKbShown: { run: () => {} }, restoreKbRev: { run: () => {} },
      },
    });
    let threw = false;
    await fnR({ sendMessage: () => Promise.reject(new Error('blocked')) }, 7).catch(() => { threw = true; });
    ok(!threw, 'شکستِ ارسال (کاربرِ بلاک‌کرده) استثنا بیرون نمی‌دهد');
  }

  /* ══ ۳ه) باگِ زنده‌ی v3.93.0: مهر فقط بعد از ارسالِ **تأییدشده** واقعی می‌ماند ══
     🐛 مالک با اسکرین‌شاتِ زنده گرفتش: به‌عنوانِ ادمین نه در آنبوردینگ بود نه هیچ منویی
     می‌دید. لاگِ سرور همان روز پر بود از `403 Forbidden: bot was blocked` و
     `ECONNRESET` دقیقاً روی همین `sendMessage`. تا این نسخه، مهرِ `kb_shown_at`/`kb_rev`
     **قبل از تأییدِ ارسال** می‌خورد؛ اگر ارسال شکست می‌خورد، ادعای «کیبورد رفت» دروغ
     می‌ماند و کاربر تا ۲۴ ساعتِ بعد (یا تا وقتی خودش `/start` بزند) هیچ راهِ ترمیمی
     نداشت. حالا شکستِ ارسال هر دو مهر را به مقدارِ **دقیقاً قبلی** برمی‌گرداند. */
  console.log('\n  — 🩹 رول‌بکِ مهر روی شکستِ ارسال (v3.93.0):');
  {
    const prevShown = NOW - 40 * 86400;   // مقدارِ واقعیِ قبل از claim، نه صفر
    const okUser = { welcomed: 1, kb_rev: 0, kb_shown_at: prevShown };
    const failLog = await scenario(okUser, 'idle', /* sendFails */ true);
    ok(failLog.sent === 1, 'با شکستِ ارسال هم تلاشِ واقعی برای فرستادن انجام می‌شود');
    ok(failLog.restoredShown === prevShown,
      `مهرِ kb_shown_at به مقدارِ دقیقِ قبلی برمی‌گردد (بود: ${failLog.restoredShown}, انتظار: ${prevShown})`);
    ok(failLog.restoredRev === 0,
      `مهرِ kb_rev هم به مقدارِ دقیقِ قبلی (۰) برمی‌گردد، چون این کاربر بمپِ رول‌بکِ نسخه هم داشت (بود: ${failLog.restoredRev})`);

    // 🔎 کنترلِ مثبت (بند ۶ب-۲ ریشه): وقتی ارسال **موفق** است، رول‌بک اصلاً صدا زده
    // نمی‌شود — وگرنه یک هارنسی که همیشه رول‌بک می‌کند هم همان ادعاهای بالا را پاس می‌داد.
    const okLog = await scenario({ ...okUser }, 'idle', /* sendFails */ false);
    ok(okLog.restoredShown === null && okLog.restoredRev === null,
      'با ارسالِ موفق، هیچ رول‌بکی صدا زده نمی‌شود');

    // و ترتیب: رول‌بک باید **بعد از** تلاشِ ارسال باشد (وگرنه یعنی همیشه رول‌بک می‌کند)
    const iTry = fn ? fn.indexOf('await tg.sendMessage(') : -1;
    const iCatch = fn ? fn.indexOf('catch (sendErr)') : -1;
    const iRestore = fn ? fn.indexOf('restoreKbShown') : -1;
    ok(iTry > -1 && iCatch > iTry && iRestore > iCatch,
      'رول‌بک فقط داخلِ catchِ خودِ ارسال است، نه قبل یا مستقل از آن');
  }
}

/* ══ ۳د) بند ۹ب-۳: بعد از آنبوردینگ، منو هرگز از دسترس خارج نمی‌شود ══════
   🐛 باگِ ۱۴۰۵/۰۶/۱۵: آنبوردینگ **هیچ‌وقت** کیبورد را صادر نمی‌کرد. کامنتِ داخلِ
   `finishOnboarding` می‌گفت «روی پیامِ خوش اومدی تحویل شده»، ولی `finishNameOnboarding`
   صریحاً می‌گوید آن پیام عمداً هیچ reply_markup ای ندارد. یعنی هر کاربر با `kb_shown_at=0`
   و بدونِ منو از آنبوردینگ بیرون می‌آمد (۱۰۶ کاربرِ واقعی در دیتای زنده). */
console.log('\n  — 🔒 تضمینِ بند ۹ب-۳:');
{
  const fin = bodyOf('async function finishOnboarding(ctx, uid, props) {');
  ok(!!fin, 'تابع finishOnboarding پیدا شد');
  ok(fin ? /await ensureKeyboard\(ctx\.telegram, uid\)/.test(fin) : false,
    'آنبوردینگ در پایانش کیبورد را صادر می‌کند (تنها نقطه‌ای که تضمینش می‌کند)');
  // و **بعد** از پیامِ منو، تا آخرین چیزی که کاربر می‌بیند خودِ منو باشد.
  const iMenu = fin ? fin.lastIndexOf('ctx.reply(') : -1;
  const iKb = fin ? fin.indexOf('ensureKeyboard') : -1;
  ok(iMenu > -1 && iKb > iMenu, 'حاملِ کیبورد بعد از پیامِ منو می‌رود، نه قبلش');
  // هر دو نسلِ آنبوردینگ (دنیای الماس و مسیرِ رول‌بکِ تومانی) باید پوشش بگیرند، پس
  // فراخوانی بیرونِ هر دو شاخه است نه داخلِ یکی.
  ok(fin ? /\}\s*else\s*\{/.test(fin) && (fin.indexOf('ensureKeyboard') > fin.indexOf('} else {')) : false,
    'فراخوانی بیرونِ شاخه‌هاست، پس مسیرِ رول‌بک هم پوشش دارد');
}
console.log('\n  — 🧹 برداشتنِ کیبورد همیشه ثبت می‌شود:');
{
  // ⚠️ اگر جایی کیبورد را بردارد ولی مهرش را صفر نکند، `kb_shown_at` دروغ می‌گوید و تورِ
  // ترمیم کور می‌شود — دقیقاً حفره‌ای که `/resetprofile` داشت.
  /* ⚠️ کامنت‌ها **قبل** از شمارش حذف می‌شوند. نسخه‌ی اولِ همین ادعا با یک فیلترِ
     خط‌به‌خط نوشته شده بود و کامنتِ توضیحیِ خودِ `dropKeyboard` را (که همین عبارت را
     نقل می‌کند) به‌عنوان کدِ واقعی می‌شمرد: یک قرمزِ کاذب. همان تله‌ی ثبت‌شده‌ی کامنت
     در v3.56.0/v3.57.0، این‌بار روی شمارش. */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const raw = CODE.split('\n').filter((l) => /Markup\.removeKeyboard\(\)/.test(l));
  ok(raw.length === 1,
    'تنها یک نقطه در کلِ سورس `Markup.removeKeyboard()` خام دارد (خودِ dropKeyboard)',
    raw.join('\n     '));
  const drop = bodyOf('const dropKeyboard = (uid) => {');
  ok(drop ? /stmts\.clearKbShown\.run\(uid\)/.test(drop) : false,
    'dropKeyboard مهرِ کیبورد را صفر می‌کند');
  ok(drop ? /try \{[\s\S]*\} catch/.test(drop) : false,
    'شکستِ ثبت، خودِ برداشتنِ کیبورد را نمی‌شکند');
  const clear = SRC.match(/clearKbShown: db\.prepare\('([^']+)'\)/)?.[1] || '';
  ok(/SET kb_shown_at=0/.test(clear), 'clearKbShown واقعاً صفر می‌کند', clear);
  // و هر پنج نقطه‌ی برداشتن باید uid بدهند، وگرنه مهر برای کاربرِ اشتباهی صفر می‌شود.
  const calls = SRC.match(/dropKeyboard\(([^)]*)\)/g) || [];
  ok(calls.length >= 5, `همه‌ی نقاطِ برداشتنِ کیبورد از dropKeyboard می‌روند (${calls.length} فراخوانی)`);
  ok(calls.every((c) => !/dropKeyboard\(\)/.test(c)),
    'هیچ فراخوانی‌ای بدونِ uid نیست', calls.join(' '));
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
