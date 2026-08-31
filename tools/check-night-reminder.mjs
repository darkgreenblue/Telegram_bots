#!/usr/bin/env node
// 🌙 چکِ «یادآوریِ شبانه‌ی A/B» + دو اصلاحِ هم‌خانواده‌اش (دکمه‌ی دعوت، خبرِ پاداشِ رفرال).
//
// روشِ کار مثلِ بقیه‌ی چک‌های رفتاریِ این ریپو: قطعه‌های حساس **از خودِ سورس بریده و
// اجرا** می‌شوند، نه اینکه منطق در تست بازنویسی شود. درسِ `check-lucky`: تستی که کدِ
// محصول را اجرا نکند، جهش را نمی‌بیند.
//
// اجرا: node tools/check-night-reminder.mjs
import { readFileSync } from 'fs';
// ⚠️ `L` پایین‌تر یک **stub** است (فقط شکلِ فراخوانی را نگه می‌دارد). هرجا مقدارِ
// واقعیِ متن لازم است باید از `REAL` خوانده شود، نه از آن stub.
import REAL from '../bots/tarot/locales/fa.js';

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const LOC = readFileSync('bots/tarot/locales/fa.js', 'utf8');

let pass = 0;
const fails = [];
const ok = (name, cond) => { if (cond) pass++; else fails.push(name); };

/** یک بلوکِ متوازنِ `{...}` را از سورس درمی‌آورد (از اولین `{` بعد از نشانه). */
function block(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) return null;
  const s = src.indexOf('{', i);
  if (s === -1) return null;
  let d = 0;
  for (let j = s; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
  return null;
}

/* ═══════ ۱) شاخه‌های A/B: شرطِ «امروز انجام نشده» واقعاً اجرا می‌شود ═══════ */
const armsSrc = block(SRC, 'const NIGHT_ARMS =');
ok('جدولِ NIGHT_ARMS در سورس هست', !!armsSrc);

// stubهایی که فقط شکلِ فراخوانی را نگه می‌دارند؛ هدف سنجشِ `due` است.
const L = { daily: { nightReminder: 'D' }, lucky: { nightReminder: 'K' },
            buttons: { nightDaily: 'BD', nightLucky: 'BL' } };
const Markup = { button: { callback: (t, d) => ({ t, d }) } };
const ARMS = new Function('L', 'Markup', `return (${armsSrc});`)(L, Markup);

ok('دو شاخه دارد: control و lucky',
   !!ARMS.control && !!ARMS.lucky && Object.keys(ARMS).length === 2);
// `cta()` یک **ردیف** برمی‌گرداند (آرایه‌ی دکمه)، چون مستقیم داخلِ inlineKeyboard می‌نشیند.
ok('هر شاخه یک ردیفِ تک‌دکمه‌ای می‌دهد',
   Array.isArray(ARMS.control.cta()) && ARMS.control.cta().length === 1
   && Array.isArray(ARMS.lucky.cta()) && ARMS.lucky.cta().length === 1);
ok('control همان کارتِ روز است (کنترل = رفتارِ قبلی)', ARMS.control.cta()[0].d === 'daily_go');
ok('شاخه‌ی دوم کارتِ شانس است', ARMS.lucky.cta()[0].d === 'lucky_go');

const TODAY = '2026-08-26', OTHER = '2026-08-25';
// control فقط وقتی که کارتِ روزِ امروز کشیده **نشده**
ok('control: کارتِ روزِ نکشیده → یادآوری می‌گیرد',
   ARMS.control.due({ last_daily_date: OTHER }, TODAY) === true);
ok('control: کارتِ روزِ امروز کشیده‌شده → یادآوری نمی‌گیرد',
   ARMS.control.due({ last_daily_date: TODAY }, TODAY) === false);
ok('control: کاربرِ بدونِ سابقه → یادآوری می‌گیرد',
   ARMS.control.due({}, TODAY) === true);
// lucky قرینه‌ی همان، روی ستونِ خودش
ok('lucky: سهمیه‌ی دست‌نخورده → یادآوری می‌گیرد',
   ARMS.lucky.due({ lucky_date: OTHER }, TODAY) === true);
ok('lucky: سهمیه‌ی مصرف‌شده‌ی امروز → یادآوری نمی‌گیرد',
   ARMS.lucky.due({ lucky_date: TODAY }, TODAY) === false);
// ⚠️ هر شاخه باید ستونِ **خودش** را ببیند، وگرنه آزمایش بی‌معنی می‌شود
ok('control به ستونِ کارتِ شانس کاری ندارد',
   ARMS.control.due({ last_daily_date: OTHER, lucky_date: TODAY }, TODAY) === true);
ok('lucky به ستونِ کارتِ روز کاری ندارد',
   ARMS.lucky.due({ lucky_date: OTHER, last_daily_date: TODAY }, TODAY) === true);

/* ═══════ ۲) دو CTA باید هم‌شکل باشند، وگرنه آزمایش دکمه را می‌سنجد نه قلاب را ═══════ */
const nd = (LOC.match(/nightDaily:\s*'([^']*)'/) || [])[1] || '';
const nl = (LOC.match(/nightLucky:\s*'([^']*)'/) || [])[1] || '';
ok('هر دو برچسبِ CTA تعریف شده‌اند', !!nd && !!nl);
ok(`طولِ دو CTA نزدیک است (${nd.length} و ${nl.length})`, Math.abs(nd.length - nl.length) <= 3);
ok('هر دو CTA با ایموجی شروع می‌شوند', /^\p{Extended_Pictographic}/u.test(nd) && /^\p{Extended_Pictographic}/u.test(nl));
ok('دو CTA یکی نیستند', nd !== nl);
const dTxt = (LOC.match(/nightReminder:\s*'([^']*)'/g) || []);
ok('هر دو متنِ یادآوری تعریف شده‌اند', dTxt.length === 2);

/* ═══════ ۳) خودِ جارو: ترتیب و گاردها ═══════ */
const sweep = SRC.slice(SRC.indexOf('const REMINDER_HOUR'), SRC.indexOf("}, 15 * 60 * 1000);", SRC.indexOf('const REMINDER_HOUR')));
ok('جارو ساعت را به وقتِ تهران می‌سنجد', /Asia\/Tehran/.test(sweep));
ok('جارو فقط در ساعتِ REMINDER_HOUR کار می‌کند', /hour !== REMINDER_HOUR\) return/.test(sweep));
ok('ساعتِ یادآوری ۲۲ است (۱۰ شب)', /const REMINDER_HOUR = 22;/.test(SRC));
ok('انتسابِ شاخه از peekVariant() می‌آید (نه شرطِ دستی)', /peekVariant\(db, uid, NIGHT_EXP\)/.test(sweep));
ok('شاخه‌ی ناشناخته به control فالبک می‌کند', /\|\| NIGHT_ARMS\.control/.test(sweep));
/* ⚠️ گران‌ترین اشتباهِ این جارو: ثبتِ exposure **قبل از** گاردِ `arm.due`.
   باگِ واقعیِ ۹ شهریور ۱۴۰۵ — از ۳۹۵ exposureِ ثبت‌شده، ۹۵ تا کاربرانی بودند که هیچ پیامی
   نگرفتند (یا گاردِ due ردشان کرد، یا ارسال شکست خورد چون ربات را بلاک کرده بودند). چون
   شرطِ `due` در دو شاخه دو ستونِ متفاوت را می‌خواند، این رقیق‌شدن **نامتقارن** بود: سوگیریِ
   سیستماتیک روی نتیجه‌ی آزمایش، نه نویز. پس این ترتیب قفل می‌شود. */
ok('جارو exposure را زودهنگام ثبت نمی‌کند (هیچ variant() خامی در جارو نیست)',
   !/[^k]variant\(db, uid, NIGHT_EXP\)/.test(sweep));
ok('exposure فقط داخلِ شاخه‌ی ارسالِ موفق ثبت می‌شود',
   /if \(ok\) \{[\s\S]{0,400}expose\(db, uid, NIGHT_EXP\)/.test(sweep));
/* از v3.38.0 جارو **دو مسیر** دارد: تا وقتی آزمایش فعال است مسیرِ A/B (دست‌نخورده)، و
   بعد از stop شدنش مسیرِ دو-یادآوریِ مستقل که کاربر از تنظیمات کنترلشان می‌کند.
   ⚠️ ادعاهای ترتیبیِ زیر باید روی **مسیرِ آزمایش** بنشینند، نه روی کلِ جارو: با indexOf
   روی کلِ متن، اولین تطابق از مسیرِ آزادِ بالاتر می‌آمد و ادعا بی‌آنکه چیزی خراب شده باشد
   قرمز می‌شد (و بدتر، می‌شد با یک تغییرِ ترتیب سبزِ دروغین گرفت). */
const iFree = sweep.indexOf('if (!expOn) {');
const freePath = iFree < 0 ? '' : sweep.slice(iFree, sweep.indexOf('\n      }', iFree));
const expPath = iFree < 0 ? sweep : sweep.slice(0, iFree) + sweep.slice(sweep.indexOf('\n      }', iFree));
ok('مسیرِ آزادِ بعد از آزمایش پیدا شد', !!freePath);
{
  const iPeek = expPath.indexOf('peekVariant(db, uid, NIGHT_EXP)');
  const iExpose = expPath.indexOf('expose(db, uid, NIGHT_EXP)');
  const iSend = expPath.indexOf('sendMessage');
  ok('ثبتِ exposure بعد از گاردِ due است', iExpose > expPath.indexOf('arm.due(u, today)'));
  ok('ثبتِ exposure بعد از خودِ ارسال است', iExpose > iSend && iPeek < iSend);
}
// ⚠️ مهم‌ترین ترتیب: اگر کاربر امروز کارش را کرده، **قبل از** مهرِ زمان رد می‌شود
const iDue = expPath.indexOf('arm.due(u, today)');
const iStamp = expPath.indexOf('setNightReminded');
ok('گاردِ «امروز انجام شده» قبل از مهرِ زمان است', iDue !== -1 && iStamp !== -1 && iDue < iStamp);

/* ── مسیرِ آزاد هم باید همان قواعد را نگه دارد ───────────────────────────── */
// اگر این‌جا exposure ثبت شود، آزمایشِ تمام‌شده با دیتای بعد از خودش آلوده می‌شود
ok('مسیرِ آزاد هیچ exposure ای ثبت نمی‌کند', !!freePath && !/expose\(/.test(freePath));
ok('مسیرِ آزاد شاخه‌ی A/B را هم نمی‌خواند', !!freePath && !/peekVariant/.test(freePath));
{
  const fDue = freePath.indexOf('.due(u, today)');
  const fStamp = freePath.indexOf('setNightReminded');
  ok('در مسیرِ آزاد هم گاردِ «امروز انجام شده» قبل از مهرِ زمان است',
     fDue !== -1 && fStamp !== -1 && fDue < fStamp);
  // مهر per **کاربر** است نه per یادآوری: اگر بعد از پیامِ اول ری‌استارت شود، دومی نباید
  // فردا شب دوباره شلیک کند. پس دقیقاً یک بار و قبل از حلقه‌ی ارسال زده می‌شود.
  ok('مهرِ زمان در مسیرِ آزاد دقیقاً یک بار زده می‌شود',
     (freePath.match(/setNightReminded/g) || []).length === 1);
  ok('مهرِ زمان قبل از حلقه‌ی ارسالِ مسیرِ آزاد است', fStamp < freePath.indexOf('sendMessage'));
}
// هر یادآوری فقط اگر کلیدِ خودش روشن باشد (کاربر از تنظیمات کنترلش می‌کند)
ok('کارتِ روز در مسیرِ آزاد به کلیدِ خودش بسته است', /!u\.daily_reminder_off/.test(freePath));
ok('کارتِ شانس در مسیرِ آزاد به کلیدِ خودش بسته است', /u\.lucky_reminder_on/.test(freePath));
// و رویداد فقط بعد از ارسالِ موفق (تا «مهرخورده بدونِ رویداد» = بلاک قابلِ شمارش بماند)
ok('رویداد فقط بعد از ارسالِ موفق ثبت می‌شود',
   /if \(ok\) \{[\s\S]{0,400}track\(db, uid, 'night_reminder_sent'/.test(sweep));
ok('مهرِ زمان قبل از ارسال زده می‌شود (ضدِ تکرار بعد از ری‌استارت)',
   iStamp < expPath.indexOf('sendMessage'));
ok('هر پیام دکمه‌ی «دیگه یادآوری نکن» دارد', /nightRemindOff/.test(sweep));
ok('دکمه‌ی انصراف به تأییدِ دومرحله‌ای می‌رود', /'dailyoff'\)/.test(sweep));

/* ═══════ ۴) opt-out: از همان ستونی می‌خواند که کاربر خاموشش کرده ═══════ */
ok('کوئریِ مخاطب فقط کاربرانِ خاموش‌نکرده را می‌گیرد', /daily_reminder_off=0/.test(SRC));
ok('کوئریِ مخاطب گاردِ ۱۸ساعته دارد', /last_daily_reminder_at < unixepoch\(\)-64800/.test(SRC));
ok('کوئری فقط کاربرِ آنبوردشده را می‌گیرد', /dueNightReminder[\s\S]{0,200}welcomed=1/.test(SRC));
ok('انصرافِ کاربر همان ستونِ جارو را می‌نویسد', /setDailyReminderOff: db\.prepare\('UPDATE users SET daily_reminder_off=1/.test(SRC));
ok('دکمه‌ی lremind:0 هم opt-outِ شبانه را ست می‌کند', /if \(on\) stmts\.setDailyReminderOn\.run\(uid\); else stmts\.setDailyReminderOff\.run\(uid\);/.test(SRC));
// جاروی opt-inِ قدیمی نباید بماند، وگرنه کاربرِ شاخه‌ی lucky دو پیام می‌گیرد
// نامش در یک کامنتِ توضیحی مانده؛ چیزی که نباید بماند **مصرفش** است.
ok('جاروی opt-inِ قدیمیِ کارتِ شانس حذف شده', !/stmts\.dueLuckyReminder/.test(SRC));
ok('مهرِ زمانِ جاروی قدیمی هم حذف شده', !/stmts\.setLuckyReminded/.test(SRC));
ok('ستونِ lucky_reminder_on هنوز روی DB هست (بند ۲ج/۱)', /ADD COLUMN lucky_reminder_on/.test(SRC));

/* ═══════ ۴ب) seedِ آزمایش: با دیپلوی فعال می‌شود، ولی داشبورد همچنان ارباب است ═══════ */
{
  // بلوکِ seedِ همین آزمایش (نه آزمایشِ همسایه‌ی intro_order)
  const nightSeedAt = SRC.indexOf('    NIGHT_EXP,');
  const seed = SRC.slice(SRC.lastIndexOf('db.prepare(', nightSeedAt), SRC.indexOf('  );', nightSeedAt) + 4);
  ok('آزمایش با INSERT OR IGNORE ساخته می‌شود، نه upsert', /INSERT OR IGNORE INTO experiments/.test(seed));
  // ربات مشروعاً آزمایش‌های **بازنشسته** را stop می‌کند (نامِ واحد، gate_intro_ai)؛ چیزی
  // که نباید باشد یک UPDATE روی همین آزمایش است، وگرنه stopِ مالک از داشبورد را نقض می‌کند.
  ok('هیچ UPDATE ای این آزمایش را دستکاری نمی‌کند (stopِ داشبورد باید دوام بیاورد)',
     !/UPDATE experiments[\s\S]{0,300}night_reminder/.test(SRC)
     && !/UPDATE experiments[\s\S]{0,300}NIGHT_EXP/.test(SRC));
  // TDZ: بلوکِ seed لحظه‌ی بارگذاریِ ماژول اجرا می‌شود، پس کلید باید **قبلش** تعریف شده باشد
  ok('کلیدِ آزمایش قبل از بلوکِ seed تعریف شده (وگرنه بوت می‌میرد)',
     SRC.indexOf("const NIGHT_EXP = 'night_reminder';") < SRC.indexOf('INSERT OR IGNORE INTO experiments'));
  ok('مستقیم running ساخته می‌شود (خواسته‌ی مالک)', /'running'/.test(seed));
  ok('متریکِ اصلی مشترک است، نه اقدامِ خودِ یک شاخه',
     /EVENTS\.PRODUCT_DELIVERED/.test(seed) && !/night_reminder_sent/.test(seed));
  ok('گاردریلِ انصراف از یادآوری هست', /daily_reminder_off/.test(seed));
  ok('وزن‌ها ۵۰/۵۰ اند',
     /\{ key: 'control', weight: 50 \}, \{ key: 'lucky', weight: 50 \}/.test(seed));
  ok('کلیدِ آزمایش همان ثابتی است که جارو می‌خواند (نه رشته‌ی کپی‌شده)',
     /NIGHT_EXP,/.test(seed) && /const NIGHT_EXP = 'night_reminder';/.test(SRC));
  // نامِ واریانت باید دقیقاً با کلیدِ شاخه در NIGHT_ARMS یکی باشد، وگرنه انتساب به
  // شاخه‌ی ناموجود می‌افتد و فالبکِ control همه را می‌بلعد (آزمایشِ مرده‌ی بی‌صدا).
  ok('نامِ واریانتِ دوم دقیقاً کلیدِ همان شاخه است', !!ARMS.lucky && /'lucky', weight: 50/.test(seed));
  ok('seed در try/catch است (خرابیِ آزمایش نباید بوتِ ربات را بشکند)',
     /catch \(e\) \{ logErr\('ab seed:'/.test(SRC));
}

/* ═══════ ۵) پیشنهادِ کارتِ شانس در پایانِ فلوِ کارتِ روز ═══════ */
const offer = block(SRC, 'async function offerLuckyAfterDaily');
ok('تابعِ offerLuckyAfterDaily وجود دارد', !!offer);
ok('فقط وقتی سهمیه‌ی امروز دست‌نخورده است پیشنهاد می‌دهد',
   !!offer && /lucky_date === tehranToday\(\)\) return/.test(offer));
ok('دنیای قدیم دست‌نخورده می‌ماند', !!offer && /if \(!uxV2For\(uid\)\) return/.test(offer));
ok('دکمه‌اش همان ورودیِ کارتِ شانس است', !!offer && /'lucky_go'/.test(offer));
ok('در **هر دو** مسیرِ کارتِ روز صدا زده می‌شود',
   (SRC.match(/await offerLuckyAfterDaily\(ctx, uid\);/g) || []).length === 2);
ok('متنِ پیشنهاد در locale است، نه در index', /alsoLucky:/.test(LOC) && !/کارتِ شانسِ امروزت رو هم/.test(SRC));

/* ═══════ ۶) دکمه‌ی دعوت: هیچ‌جا جز خودِ صفحه‌ی دعوت مستقیم به مخاطبین نمی‌رود ═══════ */
// خطی می‌سنجیم نه با رجکسِ تودرتو: آرگومانِ اولِ این دکمه خودش دو سطح پرانتز دارد
// (`L.buttons.share(referralBonusFor(uid), curOf(uid))`) و هر رجکسِ «پرانتزِ متوازن» روی
// آن شکننده است. سؤالِ واقعی ساده است: کدام خط‌ها هم `button.url` دارند هم `shareUrlFor`؟
const urlInviteLines = SRC.split('\n')
  .filter(l => l.includes('Markup.button.url') && l.includes('shareUrlFor('));
ok(`فقط یک دکمه‌ی url به اشتراک‌گذاری مانده (شد: ${urlInviteLines.length})`, urlInviteLines.length === 1);
const inviteScreen = block(SRC, 'const inviteScreen = (uid) =>');
ok('و آن یکی داخلِ رندرِ خودِ صفحه‌ی دعوت است (پیامِ توضیحی)',
   !!inviteScreen && urlInviteLines.length === 1 && inviteScreen.includes(urlInviteLines[0].trim()));
// و خودِ showInvite باید از همان تک‌منبع بخواند، نه یک کیبوردِ دستِ دوم بسازد.
const showInvite = block(SRC, 'async function showInvite');
ok('showInvite از همان تک‌منبع رندر می‌کند', !!showInvite && /inviteScreen\(uid\)/.test(showInvite));
ok('ردیفِ دعوت تک‌منبع است', /const inviteRow = \(uid\) => \[Markup\.button\.callback\(/.test(SRC));
ok('ردیفِ دعوت به invite_go می‌رود (پیامِ توضیحی)', /inviteRow[\s\S]{0,160}'invite_go'/.test(SRC));
const inviteUses = (SRC.match(/inviteRow\(/g) || []).length;
ok(`هر سه نقطه‌ی دعوت از تک‌منبع می‌خوانند (تعریف + ${inviteUses - 1} مصرف)`, inviteUses >= 4);

/* ═══════ ۷) خبرِ پاداشِ رفرال: مبلغ، موجودی، و دکمه‌های ادامه ═══════ */
const reward = SRC.slice(SRC.indexOf('پاداش رفرال:'), SRC.indexOf('یادگاری: مدیاگروپ'));
ok('پاداش فقط یک بار واریز می‌شود', (reward.match(/stmts\.credit\.run/g) || []).length === 1);
ok('گیرنده‌ی پاداش دعوت‌کننده است', /stmts\.credit\.run\(refAmt, ref\.referrer_id\)/.test(reward));
ok('خبر به چتِ خودِ دعوت‌کننده می‌رود', /sendMessage\(\s*ref\.referrer_id/.test(reward));
ok('موجودیِ تازه در پیام می‌آید', /getBalance\(ref\.referrer_id\)/.test(reward));
ok('پیام دکمه‌های ادامه دارد', /reply_markup: refKb\.reply_markup/.test(reward));
ok('دکمه‌ها همان پیشنهادهای پایانِ فال‌اند', /recoRows\(ref\.referrer_id, null\)/.test(reward));
ok('و دکمه‌ی دعوت هم دارد', /inviteRow\(ref\.referrer_id\)/.test(reward));
// متنِ locale واقعاً موجودی را چاپ می‌کند
ok('متنِ پاداش پارامترِ موجودی می‌گیرد', /referralReward:\s*\(name, bonus, cur, balance/.test(LOC));

const USERS = {
  1: { daily_reminder_off: 0, lucky_reminder_on: 0 }, // پیش‌فرض، بدونِ exposure
  2: { daily_reminder_off: 0, lucky_reminder_on: 0 }, // شاخه‌ی lucky
  3: { daily_reminder_off: 0, lucky_reminder_on: 0 }, // شاخه‌ی control
  4: { daily_reminder_off: 1, lucky_reminder_on: 0 }, // خودش خاموش کرده
  5: { daily_reminder_off: 0, lucky_reminder_on: 1 }, // قبلاً opt-in کرده (شاخه‌ی control)
  6: { daily_reminder_off: 1, lucky_reminder_on: 1 }, // حالتِ متناقضِ قدیمی
};
const ARM_BY_UID = { 2: 'lucky', 3: 'control', 5: 'control', 6: 'control' };

/* ═══════ ۷.۵) «🔕 دیگه یادآوری نکن» فقط زیرِ یادآوریِ شبانه ═══════
   قاعده‌ی صریحِ مالک (۱۴۰۵/۰۶/۰۵). پیشنهادِ خاموشی زیرِ پیامی که خودِ کاربر بازش کرده،
   دعوت به انصراف است؛ فقط جایی مجاز است که کاربر یک پیامِ **ناخواسته** گرفته باشد. */
{
  // ردیفِ کارت شانس از سورس بریده و **اجرا** می‌شود، نه رجکس روی نامش.
  // ⚠️ تا انتهای **همان دستور** بریده می‌شود (اولین `;` در پایانِ خط)، نه تا یک الگوی
  // نقطه‌ایِ `]]);`: نسخه‌ی اول به علامت‌گذاریِ دقیق گره خورده بود و یک تغییرِ بی‌ضررِ
  // شکلِ کد به‌جای شکستِ تمیزِ ادعا، کلِ چک را با خطای سینتکس می‌ترکاند.
  const rowSrc = (SRC.match(/const luckyReminderRow = [\s\S]*?;\n/) || [])[0] || '';
  ok('ردیفِ یادآوریِ کارت شانس از سورس استخراج شد', !!rowSrc);
  let row = null;
  try {
    row = new Function('L', 'Markup', `${rowSrc} return luckyReminderRow;`)(
      REAL, { button: { callback: (t, d) => ({ t, d }) } });
  } catch { /* پایین به‌صورتِ ادعای شکست‌خورده گزارش می‌شود، نه کرش */ }
  ok('ردیفِ استخراج‌شده اجرا شد', typeof row === 'function');
  const off = row ? row(false) : null, on = row ? row(true) : null;

  /* «پوشیده بودن» خودش هم از سورس بریده و روی هر پنج حالت اجرا می‌شود. این منطق تعیین
     می‌کند دکمه به چه کسی نشان داده شود، و باگی که مالک دید دقیقاً همین‌جا بود. */
  const covSrc = (SRC.match(/const stAssignedArm = [\s\S]*?\n\}\n/) || [])[0] || '';
  ok('منطقِ «پوشیده بودن» از سورس استخراج شد', /function luckyReminderCovered/.test(covSrc));
  let covered = null;
  try {
    covered = new Function('db', 'NIGHT_EXP', 'getUser', `${covSrc} return luckyReminderCovered;`)(
      { prepare: () => ({ get: (_k, uid) => (ARM_BY_UID[uid] ? { variant: ARM_BY_UID[uid] } : undefined) }) },
      'night_reminder', (uid) => USERS[uid]);
  } catch { /* پایین ادعای شکست‌خورده می‌شود */ }
  ok('منطقِ «پوشیده بودن» اجرا شد', typeof covered === 'function');
  if (covered) {
    // ۱) پیش‌فرض: یادآوری روشن، هنوز هیچ پیامی نگرفته → دکمه **نباید** دیده شود (خودِ باگ)
    ok('کاربرِ پیش‌فرضِ بدونِ exposure دکمه نمی‌بیند', covered(1) === true);
    // ۲) شاخه‌ی lucky: همان یادآوری را می‌گیرد → دکمه لازم نیست
    ok('کاربرِ شاخه‌ی lucky دکمه نمی‌بیند', covered(2) === true);
    // ۳) شاخه‌ی control: یادآوریِ کارتِ روز می‌گیرد نه کارتِ شانس → دکمه می‌بیند (دیتای تحلیل)
    ok('کاربرِ شاخه‌ی control دکمه می‌بیند', covered(3) === false);
    // ۴) خودش خاموش کرده → دکمه می‌بیند (راهِ برگشت)
    ok('کاربرِ خاموش‌کرده دکمه می‌بیند', covered(4) === false);
    // ۵) قبلاً opt-in کرده → دیگر پرسیده نمی‌شود، حتی در شاخه‌ی control
    ok('کاربرِ opt-in‌کرده دیگر دکمه نمی‌بیند', covered(5) === true);
    // ۶) خاموش‌بودنِ کلی بر opt-inِ قدیمی مقدم است
    ok('خاموشیِ کلی بر opt-inِ قدیمی مقدم است', covered(6) === false);
  }
  // ⚠️ مهم‌ترین ادعا: این مسیر نباید کسی را وارد آزمایش کند
  ok('مسیرِ کارت شانس هیچ exposure تازه‌ای نمی‌سازد (variant صدا زده نمی‌شود)',
     !/variant\(db, uid, NIGHT_EXP\)/.test(covSrc));
  ok('فقط انتسابِ ثبت‌شده خوانده می‌شود', /SELECT variant FROM ab_exposures/.test(covSrc));
  // دیتای تحلیل: مخرج (چند نفر دکمه را دیدند) و صورت (چه کسی زد، در کدام شاخه)
  ok('رویدادِ lucky_card مخرجِ دکمه را ثبت می‌کند', /remind_btn: luckyReminderCovered\(uid\) \? 0 : 1/.test(SRC));
  ok('رویدادِ lucky_reminder شاخه را ثبت می‌کند', /'lucky_reminder', \{ on: on \? 1 : 0, arm:/.test(SRC));
  ok('کاربرِ opt-in‌نکرده دکمه‌ی «فردا یادآوری کن» می‌بیند',
     !!off && off.length === 1 && off[0][0].d === 'lremind:1'
     && off[0][0].t === REAL.buttons.luckyRemindOn);
  ok('بعد از opt-in هیچ دکمه‌ای نمی‌ماند (حذف، نه تبدیل)', Array.isArray(on) && on.length === 0);
  ok('این ردیف هرگز دکمه‌ی خاموشی نمی‌سازد',
     !JSON.stringify([off, on]).includes('lremind:0'));

  // تنها مصرف‌کننده‌ی مجازِ nightRemindOff همان جاروی شبانه است.
  // نیتِ این ادعا «یک بار» نبود، «فقط زیرِ پیامِ ناخواسته‌ی شبانه» بود. از v3.38.0 جارو دو
  // مسیر دارد پس دو بار ساخته می‌شود؛ چیزی که باید قفل بماند این است که **هیچ مصرفی بیرون
  // از خودِ جارو** نداشته باشد، وگرنه دکمه‌ی خاموشی زیرِ پیامی می‌رود که کاربر خودش خواسته.
  ok('«دیگه یادآوری نکن» فقط داخلِ جاروی شبانه ساخته می‌شود',
     (SRC.match(/nightRemindOff/g) || []).length === (sweep.match(/nightRemindOff/g) || []).length);
  ok('و در هر دو مسیرِ جارو هست', (sweep.match(/nightRemindOff/g) || []).length === 2);
  ok('برچسبِ تکراریِ luckyRemindOff از locale حذف شده', !/luckyRemindOff/.test(LOC));

  // پیامِ «امروز استفاده کردی» هیچ کیبوردی ندارد.
  const already = (SRC.match(/if \(user\.lucky_date === today\) \{[\s\S]*?\n  \}/) || [])[0] || '';
  ok('شاخه‌ی «امروز استفاده کردی» پیدا شد', !!already);
  ok('پیامِ «امروز استفاده کردی» هیچ دکمه‌ای ندارد',
     /ctx\.reply\(L\.lucky\.already\);/.test(already) && !/Markup/.test(already));

  // تپِ «فردا یادآوری کن» هیچ پیامی نمی‌فرستد.
  const lrem = (SRC.match(/bot\.action\(\/\^lremind:[\s\S]*?\n\}\);/) || [])[0] || '';
  ok('هندلرِ lremind پیدا شد', !!lrem);
  ok('تپِ یادآوری هیچ پیامی نمی‌فرستد', !/ctx\.reply\(/.test(lrem));
  ok('به‌جایش روی خودِ دکمه toast می‌دهد', /answerCbQuery\(on \? L\.lucky\.remindOnToast/.test(lrem));
  ok('و کیبورد را با همان تک‌منبعِ «پوشیده بودن» بازرندر می‌کند',
     /editMessageReplyMarkup\(\s*Markup\.inlineKeyboard\(luckyReminderRow\(luckyReminderCovered\(uid\)\)\)/.test(lrem));
}

/* ═══════ ۷.۶) CTAی شبانه = همان برچسبِ کیبورد ═══════
   عمدی است (کاربر همان دکمه‌ی آشنا را می‌بیند)، ولی چون تغییرِ برچسبِ کیبورد می‌تواند
   **یک شاخه** را عوض کند و آزمایش را آلوده کند (درسِ intro_order)، برابری قفل می‌شود. */
ok('CTAی شاخه‌ی control = برچسبِ کیبوردِ فال تک کارت', REAL.buttons.nightDaily === REAL.buttons.dailyOneCard);
ok('CTAی شاخه‌ی lucky = برچسبِ کیبوردِ کارت شانس', REAL.buttons.nightLucky === REAL.buttons.luckyMain);

/* ═══════ ۸) قواعدِ کپیِ ریشه (بند ۱۰) ═══════ */
for (const [k, v] of Object.entries({ nightDaily: nd, nightLucky: nl })) {
  ok(`${k} خط تیره‌ی بلند ندارد`, !v.includes('—') && !v.includes('--'));
}
const newTexts = [...LOC.matchAll(/(?:nightReminder|alsoLucky):\s*'([^']*)'/g)].map(m => m[1]);
ok('هر سه متنِ تازه در locale پیدا شدند', newTexts.length === 3);
for (const t of newTexts) ok('متنِ تازه خط تیره‌ی بلند ندارد', !t.includes('—') && !t.includes('--'));

/* ═══════ نتیجه ═══════ */
if (fails.length) {
  console.error(`❌ چکِ یادآوریِ شبانه: ${fails.length} ادعا شکست خورد`);
  for (const f of fails) console.error(`   • ${f}`);
  process.exit(1);
}
console.log(`✅ چکِ یادآوریِ شبانه و دعوت و پاداشِ رفرال: ${pass} ادعا سبز.`);
