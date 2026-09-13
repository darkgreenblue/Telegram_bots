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
import DB from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

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
/* ⚠️ کامنت‌ها **قبل از** هر ادعای ترتیبی حذف می‌شوند. این دقیقاً همان تله‌ای است که
   v3.30.0 روی «قفل قبل از await» ثبت کرد و این‌جا دوباره شلیک کرد: کامنتی که نامِ
   `setNightReminded` را توضیحی برده بود، `indexOf` را صدها کاراکتر جلوتر انداخت و یک
   ادعای کاملاً سالم را قرمز کرد. سنجه‌ای که خودش را روی متنِ کامنت می‌سنجد، سنجه نیست.
   جداکننده‌ی `(^|\s)` عمداً هست تا `https://` را کامنت نبیند. */
const decomment = (s) => s.replace(/(^|\s)\/\/[^\n]*/g, '$1');
const sweep = decomment(
  SRC.slice(SRC.indexOf('const REMINDER_HOUR'), SRC.indexOf("}, 15 * 60 * 1000);", SRC.indexOf('const REMINDER_HOUR'))));
/* 🌍 ساعتِ جارو باید به وقتِ **همان ربات** باشد، نه تهرانِ هاردکد.
 * 🐛 چرا: همین کد سه رباتِ زبانِ دیگر را هم اجرا می‌کند. ساعت ۲۲ تهران برای کاربرِ
 * برزیلی ۱۵:۳۰ بعدازظهر است، یعنی «یادآوریِ شبانه» نه شبانه بود نه یادآوری —
 * فقط یک پیامِ ناخواسته وسطِ روز، که خودش دلیلِ بلاک شدن است (درسِ v3.9.0).
 * منطقه‌ی زمانی این‌جا **اجرا** می‌شود، نه اینکه شکلش خوانده شود. */
ok('جارو ساعت را به وقتِ همان ربات می‌سنجد، نه تهرانِ هاردکد',
   /botHour\(\)/.test(sweep) && !/Asia\/Tehran/.test(sweep));
{
  const core = readFileSync(new URL('../bots/tarot/reading-core.js', import.meta.url), 'utf8');
  const src = [
    core.match(/const TZ_BY_LOCALE = \{[\s\S]*?\n\};/)?.[0],
    core.match(/^export const BOT_TZ = .*$/m)?.[0]?.replace('export ', ''),
  ];
  ok('جدولِ منطقه‌ی زمانیِ per زبان پیدا شد', src.every(Boolean));
  const tzOf = (locale) => {
    try {
      return new Function('LOCALE', 'process', `${src.join('\n')}; return BOT_TZ;`)(locale, { env: {} });
    } catch { return null; }
  };
  ok('فارسی همان Asia/Tehran می‌ماند (رباتِ زنده دست‌نخورده)', tzOf('fa') === 'Asia/Tehran');
  for (const [l, tz] of [['ru', 'Europe/Moscow'], ['pt', 'America/Sao_Paulo'], ['es', 'America/Mexico_City']])
    ok(`«${l}» منطقه‌ی زمانیِ خودش را دارد (${tz})`, tzOf(l) === tz);
  ok('هیچ زبانی بی‌صدا منطقه‌ی زمانیِ فارسی را به ارث نمی‌برد',
     ['ru', 'pt', 'es'].every((l) => tzOf(l) !== 'Asia/Tehran'));
  // مرزِ روز واقعاً با منطقه‌ی زمانی عوض می‌شود، وگرنه جدول تزئینی است
  const at = (tz, iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  ok('مرزِ روز واقعاً per زبان فرق می‌کند (۲۱:۰۰ UTC)',
     at('Asia/Tehran', '2026-03-10T21:00:00Z') !== at('America/Sao_Paulo', '2026-03-10T21:00:00Z'));
}
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
/* ⚠️ ادعاهای **ترتیبی** روی بدنه‌ی خودِ حلقه می‌نشینند، نه روی `sweep` که کلِ ناحیه است
   (از `REMINDER_HOUR` تا انتهای `setInterval`، شاملِ همه‌ی توابعِ کمکیِ بالای آن).
   v3.57.0 دو تابعِ کمکیِ تازه به آن ناحیه اضافه کرد که خودشان `sendMessage` و
   `setNightReminded` دارند، و همان باعث شد `indexOf` دو ادعای کاملاً سالم را قرمز کند —
   همان کلاسِ خطای کامنتِ بالا، این‌بار از سمتِ **دامنه** به‌جای سمتِ متن. */
const loop = decomment(block(SRC, 'setInterval(async () => {\n  try {\n    const hour = botHour();') || '');
ok('بدنه‌ی حلقه‌ی جارو استخراج شد', !!loop);
const iFree = loop.indexOf('if (!expOn) {');
const freePath = iFree < 0 ? '' : loop.slice(iFree, loop.indexOf('\n      }', iFree));
const expPath = iFree < 0 ? loop : loop.slice(0, iFree) + loop.slice(loop.indexOf('\n      }', iFree));
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
/* ⚠️ این ادعا در v3.85.0 **تیزتر شد، نه خفه**: تا آن روز خطِ **متقارنِ**
   `if (on) …On else …Off` را پین می‌کرد، یعنی دقیقاً همان باگی را محافظت می‌کرد که
   v3.82.0 ساخته بود (هم‌خانواده‌ی «تست داشت رفتارِ غلط را نگه می‌داشت» در v3.67.0).
   حالا فقط نیمه‌ی درستش پین است و سنجشِ رفتاریِ هر دو جهت در بلوکِ ۱۲ است. */
ok('دکمه‌ی lremind:0 هم opt-outِ شبانه را ست می‌کند', /if \(!on\) stmts\.setDailyReminderOff\.run\(uid\);/.test(SRC));
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
   !!offer && /lucky_date === botToday\(\)\) return/.test(offer));
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
  /* از v3.82.0 یک مصرف‌کننده‌ی دومِ **مجاز** هست: `chainDailyReminder`، یعنی یادآوریِ
   * کارتِ روز که به پایانِ فلوی کارتِ شانس زنجیر می‌شود. نیتِ این ادعا عوض نشد — همان
   * «فقط زیرِ پیامِ ناخواسته» — و پیامِ زنجیره‌ای هم ناخواسته است (کاربر آن را نخواسته،
   * از روی کلیدِ روشنش می‌آید). پس دامنه **صریح** پهن شد، نه اینکه شمارش خفه شود. */
  const chainBody = (() => {
    const i = SRC.indexOf('async function chainDailyReminder');
    if (i < 0) return '';
    const s = SRC.indexOf('{', i);
    let d = 0;
    for (let j = s; j < SRC.length; j++) {
      if (SRC[j] === '{') d++;
      else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); }
    }
    return '';
  })();
  const chain = chainBody;
  ok('تابعِ زنجیره‌ی یادآوریِ کارتِ روز پیدا شد', !!chain);
  ok('«دیگه یادآوری نکن» فقط در جارو و زنجیره ساخته می‌شود',
     (SRC.match(/nightRemindOff/g) || []).length
       === (sweep.match(/nightRemindOff/g) || []).length + (chain.match(/nightRemindOff/g) || []).length);
  ok('و در هر دو مسیرِ جارو هست', (sweep.match(/nightRemindOff/g) || []).length === 2);
  ok('و دقیقاً یک بار در زنجیره', (chain.match(/nightRemindOff/g) || []).length === 1);
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

/* ═══════ ۹) گاردِ «روزِ اول» و «وسطِ فلوی زنده» (v3.56.0) ═══════
   هر دو از مشاهده‌ی مستقیمِ مالک آمدند: ساعت ۲۲ وسطِ نوشتنِ سؤالِ فالِ **پول‌داده** پیامِ
   «فرصت کارت امروزت داره تموم می‌شه» گرفت. بلوک عمداً **رفتاری** است: خودِ
   `reminderBlocked` از سورس بریده و اجرا می‌شود، نه یک کپیِ محلی. */
{
  const src = block(SRC, 'function reminderBlocked(u, today)');
  ok('reminderBlocked از سورس استخراج شد', !!src);
  // ⚠️ عمداً با `block` گرفته نمی‌شود: آن helper اولین `{` را می‌گیرد و این یک آرایه‌ی
  // `[...]` است، پس تا آکولادِ بی‌ربطِ بعدیِ فایل جلو می‌رفت.
  const iSet = SRC.indexOf('const OPEN_FLOW_STATES = new Set([');
  const OPEN = iSet > -1 ? SRC.slice(SRC.indexOf('[', iSet), SRC.indexOf(']);', iSet) + 1) : null;
  ok('OPEN_FLOW_STATES از سورس استخراج شد', !!OPEN);
  const TZ = 'Asia/Tehran';
  const botToday = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const openSet = new Function('ONBOARDING_STATES', `return new Set(${OPEN});`)(
    ['onboard_name', 'onboard_focus', 'onboard_month']);
  const blocked = new Function('OPEN_FLOW_STATES', 'FLOW_STALE_HOURS', 'botToday',
    `return function reminderBlocked(u, today)${src};`)(openSet, 24, botToday);

  const today = botToday();
  const NOW = Math.floor(Date.now() / 1000);
  const older = NOW - 5 * 86400;   // کاربرِ پنج‌روزه
  const U = (o) => ({ created_at: older, state: 'idle', last_seen_at: NOW, ...o });

  // ۱) روزِ اول
  ok('کاربری که همین امروز ثبت‌نام کرده پیام نمی‌گیرد',
    blocked(U({ created_at: NOW }), today) === 'day1');
  ok('کاربرِ دیروزی پیام می‌گیرد (از روز دوم)',
    blocked(U({ created_at: NOW - 86400 * 1.5 }), today) === '');
  ok('created_at خالی محافظه‌کارانه بلاک می‌شود', blocked(U({ created_at: 0 }), today) === 'day1');

  // ۲) وسطِ فلوی زنده — همان استیتی که مالک در اسکرین‌شات داشت
  ok('وسطِ «سؤالت رو بنویس» پیام نمی‌رود',
    blocked(U({ state: 'await_question' }), today) === 'flow');
  ok('وسطِ فرستادنِ رسیدِ پرداخت هم پیام نمی‌رود',
    blocked(U({ state: 'pay_receipt' }), today) === 'flow');
  ok('وسطِ افشای فال هم پیام نمی‌رود', blocked(U({ state: 'revealing' }), today) === 'flow');
  ok('کاربرِ idle پیام می‌گیرد', blocked(U({ state: 'idle' }), today) === '');
  // کاتالوگِ باز فلوی باز **نیست** (هیچ فالی رزرو نشده) — همان تفکیکِ v3.17.0
  ok('کاتالوگِ باز مانع نیست', blocked(U({ state: 'choose_spread' }), today) === '');

  // ۳) فلوی رهاشده بعد از ۲۴ ساعت دیگر مانع نیست (خواسته‌ی صریحِ مالک)
  ok('فلوی رهاشده‌ی ۲۵ساعته دیگر مانع نیست',
    blocked(U({ state: 'await_question', last_seen_at: NOW - 25 * 3600 }), today) === '');
  ok('فلوی ۲۳ساعته هنوز زنده حساب می‌شود',
    blocked(U({ state: 'await_question', last_seen_at: NOW - 23 * 3600 }), today) === 'flow');
  ok('ردیفِ قدیمیِ بدونِ last_seen_at مانع نیست (مهاجرتِ نرم)',
    blocked(U({ state: 'await_question', last_seen_at: null }), today) === '');

  // ۴) هر استیتِ آنبوردینگ هم فلوی باز است: `welcomed=1` از `onboard_month` به بعد ست
  //    می‌شود، پس بدونِ این کاربرِ وسطِ آنبوردینگ یادآوری می‌گرفت.
  for (const st of ['onboard_name', 'onboard_month', 'onboard_focus', 'gate_join'])
    ok(`استیتِ «${st}» فلوی باز حساب می‌شود`, blocked(U({ state: st }), today) === 'flow');

  // ۵) ترتیب و بی‌مهر بودن: گارد قبل از هر شاخه‌ای، و **بدونِ** setNightReminded
  const sweep = decomment(block(SRC, 'setInterval(async () => {\n  try {\n    const hour = botHour();') || '');
  ok('گارد داخلِ جاروی شبانه صدا زده می‌شود', !!sweep && /if \(reminderBlocked\(u, today\)\) continue;/.test(sweep));
  ok('گارد قبل از peekVariant است (کاربرِ ردشده exposure نمی‌گیرد)',
    !!sweep && sweep.indexOf('reminderBlocked(') < sweep.indexOf('peekVariant('));
  ok('گارد قبل از هر دو رژیمِ آزمایش است',
    !!sweep && sweep.indexOf('reminderBlocked(') < sweep.indexOf('if (!expOn)'));
  {
    // ⚠️ مهم: ردشدن نباید مهرِ ۱۸ساعته بخورد، وگرنه کاربری که فقط امروز وسطِ فلو بود
    // فردا شبش را هم از دست می‌داد.
    const i = sweep ? sweep.indexOf('if (reminderBlocked(u, today)) continue;') : -1;
    const before = i > -1 ? sweep.slice(sweep.indexOf('for (const u of'), i) : 'x';
    ok('ردشدن بدونِ مهرِ زمان انجام می‌شود', !/setNightReminded/.test(before));
  }
  // ۶) هر دو کوئری ستون‌های لازم را برمی‌دارند، وگرنه گارد روی undefined کار می‌کند و
  //    بی‌صدا همه را رد می‌کند (کلاسِ «گاردی که با نبودِ داده سبز می‌ماند»).
  for (const q of ['dueNightReminder', 'dueNightReminderFree']) {
    const sql = SRC.slice(SRC.indexOf(`${q}: db.prepare(`), SRC.indexOf('LIMIT 400', SRC.indexOf(`${q}: db.prepare(`)));
    ok(`${q} ستونِ state را برمی‌دارد`, /\bstate\b/.test(sql));
    ok(`${q} ستونِ last_seen_at را برمی‌دارد`, /last_seen_at/.test(sql));
    ok(`${q} ستونِ created_at را برمی‌دارد`, /created_at/.test(sql));
  }
  // ۷) گارد باید **مستقل از شاخه** باشد، وگرنه مخرجِ آزمایش نامتقارن کوچک می‌شود و
  //    نتیجه سوگیری می‌گیرد (درسِ ثبت‌شده‌ی بند ۲الف ریشه).
  ok('گارد به شاخه‌ی A/B نگاه نمی‌کند',
    !!src && !/variant|arm|NIGHT_ARMS|lucky_date|last_daily_date/.test(src));
}

/* ═══════ ۱۰) یادآوریِ فالِ نیمه‌کاره (v3.57.0) ═══════
   تصمیمِ صریحِ مالک: فلوی رهاشده‌ی بیش از ۲۴ ساعت هر شب یادآوریِ **مخصوصِ خودش** را با
   دکمه‌ی انصراف می‌گیرد؛ انصراف = بازگشت به حالت طبیعی، بی‌تفاوتی = تکرارِ هر شب.
   بلوک عمداً **رفتاری** است: هر دو تابع از سورس بریده و اجرا می‌شوند. */
{
  const bodyOfFn = (marker) => {
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
  const iSet = SRC.indexOf('const STUCK_READING_STATES = new Set([');
  const setSrc = iSet > -1 ? SRC.slice(SRC.indexOf('[', iSet), SRC.indexOf(']);', iSet) + 1) : null;
  ok('STUCK_READING_STATES از سورس استخراج شد', !!setSrc);
  const stuckSet = new Function(`return new Set(${setSrc});`)();
  ok('استیت‌های فالِ ناتمام پوشش داده شده‌اند',
    ['await_question', 'breathing', 'shuffling', 'picking', 'confirm_pay', 'revealing', 'confirm_focus']
      .every((s) => stuckSet.has(s)));
  // ⚠️ `feedback` عمداً نیست: فال **تحویل شده** و کاربر فقط نمره نداده؛ چیزی برای «ادامه»
  // یا «انصراف» نمانده. `idle` هم طبعاً نه.
  ok('استیتِ feedback یادآوریِ فالِ ناتمام نمی‌گیرد', !stuckSet.has('feedback'));
  ok('استیتِ idle یادآوریِ فالِ ناتمام نمی‌گیرد', !stuckSet.has('idle'));

  const forSrc = bodyOfFn('function stuckReadingFor(u)');
  ok('stuckReadingFor از سورس استخراج شد', !!forSrc);
  const mkFor = (row) => new Function('STUCK_READING_STATES', 'stmts',
    `return function stuckReadingFor(u)${forSrc};`)(stuckSet, { latestOpenReading: { get: () => row } });

  ok('استیتِ غیرِ فلو هیچ یادآوریِ ناتمام نمی‌گیرد',
    mkFor({ id: 1, status: 'paid' })({ telegram_id: 7, state: 'idle' }) === null);
  ok('استیتِ فلو ولی بدونِ هیچ فالِ ناتمام → یادآوری ندارد',
    mkFor(undefined)({ telegram_id: 7, state: 'await_question' }) === null);
  {
    const paid = mkFor({ id: 9, status: 'paid' })({ telegram_id: 7, state: 'await_question' });
    ok('فالِ paid یادآوری و دکمه‌ی انصراف می‌گیرد', !!paid && paid.canCancel === true && paid.r.id === 9);
    const pend = mkFor({ id: 4, status: 'pending_payment' })({ telegram_id: 7, state: 'confirm_pay' });
    ok('فالِ pending_payment هم انصراف می‌گیرد', !!pend && pend.canCancel === true);
    // 🔑 محصول دارد تحویل می‌شود: انصراف یعنی پس‌گرفتنِ چیزی که کاربر همین حالا دارد
    // می‌گیرد (همان تصمیمِ blockDuringDelivering در v3.17.0).
    const started = mkFor({ id: 5, status: 'started' })({ telegram_id: 7, state: 'revealing' });
    ok('فالِ در حالِ افشا (started) دکمه‌ی انصراف نمی‌گیرد', !!started && started.canCancel === false);
  }

  // ── SQL: فقط فالِ واقعاً ناتمام ──────────────────────────────────────────
  {
    const i = SRC.indexOf('latestOpenReading: db.prepare(');
    const sql = i > -1 ? SRC.slice(i, SRC.indexOf('`)', i)) : '';
    ok('کوئری هر سه وضعیتِ ناتمام را می‌گیرد',
      /'pending_payment','paid','started'/.test(sql.replace(/\s+/g, '')));
    for (const bad of ['delivered', 'canceled', 'refunded'])
      ok(`کوئری وضعیتِ ${bad} را نمی‌گیرد`, !sql.includes(`'${bad}'`));
    ok('تازه‌ترین فال برداشته می‌شود', /ORDER BY id DESC LIMIT 1/.test(sql));
    ok('کوئری به کاربرِ خودش محدود است (مالکیتِ رکورد)', /user_id=\?/.test(sql));
  }

  // ── رفتارِ ارسال ─────────────────────────────────────────────────────────
  const sendSrc = bodyOfFn('async function sendStuckReadingReminder(u)');
  ok('sendStuckReadingReminder از سورس استخراج شد', !!sendSrc);
  const runSend = (row, state, revealRow = ['REVEAL']) => {
    const log = { text: null, kb: null, stamped: 0, tracked: null, kbEnsured: 0, sent: 0 };
    const fn = new Function('deps', `
      const { stuckReadingFor, revealResumeRow, Markup, L, stmts, bot, track, db, ensureKeyboard } = deps;
      return async function sendStuckReadingReminder(u)${sendSrc};`)({
      stuckReadingFor: mkFor(row), revealResumeRow: () => revealRow,
      Markup: { button: { callback: (t, d) => ({ t, d }) }, inlineKeyboard: (r) => ({ reply_markup: r }) },
      L: { buttons: { resumeReading: 'RESUME', stuckCancel: 'CANCEL' },
           reading: { stuckReading: (c) => `MSG:${c}` } },
      stmts: { setNightReminded: { run: () => { log.stamped++; } } },
      bot: { telegram: { sendMessage: (_i, t, o) => { log.sent++; log.text = t; log.kb = o.reply_markup; return Promise.resolve({}); } } },
      track: (_d, _u, name, props) => { log.tracked = { name, props }; }, db: {},
      ensureKeyboard: () => { log.kbEnsured++; return Promise.resolve(); },
    });
    return fn({ telegram_id: 7, state }).then((r) => ({ ...log, ret: r }));
  };

  {
    const r = await runSend({ id: 9, status: 'paid' }, 'await_question');
    ok('فالِ ناتمام پیامِ مخصوصِ خودش را می‌گیرد', r.ret === true && r.sent === 1);
    ok('متن حالتِ «انصراف ممکن است» را می‌گیرد', r.text === 'MSG:true');
    ok('دو دکمه: ادامه و انصراف', r.kb.length === 2);
    ok('دکمه‌ی ادامه از مسیرِ موجودِ reading:resume می‌رود', r.kb[0][0].d === 'reading:resume');
    // انصراف عمداً `rcancel:` است: هندلرِ موجود که مالکیتِ رکورد را چک می‌کند و طبقِ
    // v3.54.0 رکورد را terminal می‌کند. هیچ مسیرِ لغوِ دومی ساخته نشد.
    ok('دکمه‌ی انصراف از هندلرِ موجودِ rcancel می‌رود', r.kb[1][0].d === 'rcancel:9');
    ok('مهرِ شبانه قبل از ارسال زده می‌شود (یک پیام در شب)', r.stamped === 1);
    ok('رویدادِ افزایشیِ stuck_reading_reminder ثبت می‌شود', r.tracked?.name === 'stuck_reading_reminder');
    ok('رویداد فال و استیت را ثبت می‌کند', r.tracked?.props?.reading_id === 9 && r.tracked?.props?.state === 'await_question');
    ok('منوی گم‌شده‌ی همین کاربر هم ترمیم می‌شود', r.kbEnsured === 1);
  }
  {
    const r = await runSend({ id: 5, status: 'started' }, 'revealing');
    ok('وسطِ افشا فقط دکمه‌ی ادامه می‌آید (بدونِ انصراف)', r.kb.length === 1);
    ok('دکمه‌ی ادامه‌ی افشا از revealResumeRow می‌آید', r.kb[0][0] === 'REVEAL');
    ok('متنِ وسطِ افشا جمله‌ی انصراف را ندارد', r.text === 'MSG:false');
  }
  {
    const r = await runSend({ id: 5, status: 'started' }, 'revealing', null);
    ok('اگر چیزی برای ادامه نمانده، یادآوریِ ناتمام نمی‌رود', r.ret === false && r.sent === 0);
    ok('و مهرِ شبانه هم نمی‌خورد (یادآوریِ عادی سرِ جایش)', r.stamped === 0);
  }
  {
    const r = await runSend(undefined, 'idle');
    ok('کاربرِ بدونِ فالِ ناتمام به مسیرِ یادآوریِ عادی می‌رود', r.ret === false && r.stamped === 0);
  }

  // ── جای فراخوانی در جارو ─────────────────────────────────────────────────
  {
    const sw = decomment(bodyOfFn('setInterval(async () => {\n  try {\n    const hour = botHour();') || '');
    const iCall = sw.indexOf('sendStuckReadingReminder(u)');
    ok('جارو یادآوریِ فالِ ناتمام را صدا می‌زند', iCall > -1);
    ok('بعد از گاردِ فلوی زنده است (فلوی تازه هنوز ساکت می‌ماند)',
      sw.indexOf('reminderBlocked(u, today)') < iCall);
    ok('قبل از peekVariant است (این کاربر exposure نمی‌گیرد)', iCall < sw.indexOf('peekVariant('));
    ok('قبل از هر دو رژیمِ آزمایش است', iCall < sw.indexOf('if (!expOn)'));
    ok('بعد از ارسالِ ناتمام، یادآوریِ عادی فرستاده نمی‌شود (continue)',
      /sendStuckReadingReminder\(u\)\) \{ await sleep\(\d+\); continue; \}/.test(sw));
  }

  // ── کپی در هر چهار زبان ──────────────────────────────────────────────────
  for (const loc of ['fa', 'ru', 'pt', 'es']) {
    const M = (await import(`../bots/tarot/locales/${loc}.js`)).default;
    const withC = M.reading?.stuckReading?.(true), noC = M.reading?.stuckReading?.(false);
    ok(`${loc}: متنِ فالِ ناتمام وجود دارد`, typeof withC === 'string' && withC.length > 20);
    ok(`${loc}: برچسبِ دکمه‌ی انصراف وجود دارد`, typeof M.buttons?.stuckCancel === 'string');
    // جمله‌ی هشدارِ الماس فقط وقتی می‌آید که انصراف واقعاً ممکن باشد.
    ok(`${loc}: نسخه‌ی بدونِ انصراف کوتاه‌تر است`, noC.length < withC.length);
    ok(`${loc}: نسخه‌ی بدونِ انصراف پیشوندِ همان متن است`, withC.startsWith(noC));
    // 🔑 صداقت: کاربر باید **قبل** از تپ بداند انصراف الماس را برنمی‌گرداند (v3.54.0
    // خودش این را کم‌هزینه‌ترین درمانِ «دکمه‌ی انصرافِ مخرب» نامیده بود).
    ok(`${loc}: نسخه‌ی انصراف‌دار درباره‌ی الماس صریح است`, /💎/.test(withC));
    for (const t of [withC, noC, M.buttons.stuckCancel])
      ok(`${loc}: بدونِ خط تیره‌ی بلند (بند ۱۰)`, !t.includes('—') && !t.includes('--'));
  }
}

/* ═══════ ۱۱) دیفالتِ تازه‌ی یادآوری: کارتِ شانس برنده شد (v3.82.0) ═══════
   نتیجه‌ی آزمایشِ `night_reminder` روی دیتای زنده: فالِ تحویل‌شده در ۶ ساعتِ بعد از پیام
   ۵٫۸۷٪ (کارتِ روز) در برابرِ ۷٫۱۰٪ (کارتِ شانس)، CTW ۹۷٪ خام و ۹۳ تا ۹۶٪ بعد از تصحیحِ
   خوشه‌بندی، با گاردریلِ انصرافِ ۱٫۸۲٪ در برابرِ ۰٫۳۱٪.

   بلوک عمداً **رفتاری** است: SQLِ مهاجرت از خودِ سورس بریده و روی SQLite واقعی اجرا
   می‌شود، نه یک رجکس روی متن. */
{
  const fnBody = (marker) => {
    const i = SRC.indexOf(marker);
    if (i < 0) return '';
    const st = SRC.indexOf('{', i);
    let d = 0;
    for (let j = st; j < SRC.length; j++) {
      if (SRC[j] === '{') d++;
      else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(st, j + 1); }
    }
    return '';
  };
  const chainBody = fnBody('async function chainDailyReminder');
  const iMig = SRC.indexOf("const NIGHT_DEFAULT_KEY");
  const mig = iMig > -1 ? SRC.slice(iMig, SRC.indexOf('night default migration', iMig)) : '';
  ok('بلوکِ مهاجرتِ دیفالتِ یادآوری پیدا شد', !!mig);

  const luckySql = (mig.match(/UPDATE users SET lucky_reminder_on=1[\s\S]*?\)\s*`/) || [''])[0].replace(/`$/, '');
  ok('SQLِ روشن‌کردنِ کارتِ شانس از سورس استخراج شد', /NOT IN/.test(luckySql));

  /* ⚠️ مهم‌ترین ادعای این بلوک: **ترتیبِ** دو UPDATE.
     شرطِ «کارتِ شانس را رد کرده بود» روی `daily_reminder_off` می‌نشیند، پس باید قبل از
     خاموش‌کردنِ سراسریِ کارتِ روز خوانده شود. برعکسش یک باگِ کاملاً بی‌صداست: همه‌ی
     کاربران «انصراف‌داده» به نظر می‌رسند و کلِ شاخه‌ی lucky بی‌یادآوری می‌ماند. */
  const iL = mig.indexOf('lucky_reminder_on=1'), iD = mig.indexOf('SET daily_reminder_off=1');
  ok('کارتِ شانس **قبل از** خاموش‌کردنِ سراسریِ کارتِ روز نوشته می‌شود', iL > -1 && iD > -1 && iL < iD);

  const mkDb = () => {
    const d = new DB(':memory:');
    d.exec(`CREATE TABLE users(telegram_id INTEGER PRIMARY KEY, daily_reminder_off INT DEFAULT 0, lucky_reminder_on INT DEFAULT 0);
            CREATE TABLE ab_exposures(experiment_key TEXT, user_id INT, variant TEXT);`);
    let id = 1;
    const add = (off, arm) => {
      d.prepare('INSERT INTO users(telegram_id,daily_reminder_off) VALUES(?,?)').run(id, off);
      if (arm) d.prepare("INSERT INTO ab_exposures VALUES('night_reminder',?,?)").run(id, arm);
      id++;
    };
    for (let i = 0; i < 5; i++) add(1, 'lucky');    // کارتِ شانس را رد کرد → باید خاموش بماند
    for (let i = 0; i < 11; i++) add(1, 'control'); // کارتِ روز را رد کرد  → باید روشن شود
    for (let i = 0; i < 5; i++) add(1, null);       // انصرافِ قبل از آزمایش → باید روشن شود
    for (let i = 0; i < 20; i++) add(0, 'lucky');   // بدونِ انصراف          → باید روشن شود
    for (let i = 0; i < 30; i++) add(0, null);
    return d;
  };
  const dOn = mkDb();
  dOn.transaction(() => { dOn.prepare(luckySql).run(); dOn.prepare('UPDATE users SET daily_reminder_off=1').run(); })();
  const off = dOn.prepare('SELECT COUNT(*) c FROM users WHERE lucky_reminder_on=0').get().c;
  ok('فقط کسانی خاموش می‌مانند که خودِ کارتِ شانس را رد کرده بودند (۵ نفر)', off === 5);
  ok('بقیه کارتِ شانس روشن می‌گیرند', dOn.prepare('SELECT COUNT(*) c FROM users WHERE lucky_reminder_on=1').get().c === 66);
  ok('کارتِ روز برای همه خاموش می‌شود (از این به بعد opt-in)',
     dOn.prepare('SELECT COUNT(*) c FROM users WHERE daily_reminder_off=0').get().c === 0);

  // 🔬 کنترلِ منفی: با ترتیبِ برعکس، کلِ شاخه‌ی lucky بی‌یادآوری می‌ماند.
  const dBad = mkDb();
  dBad.transaction(() => { dBad.prepare('UPDATE users SET daily_reminder_off=1').run(); dBad.prepare(luckySql).run(); })();
  ok('کنترلِ منفی: ترتیبِ برعکس واقعاً کلِ شاخه‌ی lucky را خاموش می‌کند',
     dBad.prepare('SELECT COUNT(*) c FROM users WHERE lucky_reminder_on=0').get().c === 25);

  // کاربرِ تازه باید با همین دیفالت متولد شود، وگرنه مهاجرت فقط کوهورتِ امروز را می‌گیرد.
  ok('کاربرِ تازه با کارتِ شانسِ روشن و کارتِ روزِ خاموش ساخته می‌شود',
     /INSERT INTO users \(telegram_id, name, username, daily_reminder_off, lucky_reminder_on\) VALUES \(\?, \?, \?, 1, 1\)/.test(SRC));

  /* حداکثر یک پیام در ساعتِ ۲۲: شاخه‌ی بعد-از-آزمایش باید `else if` باشد نه دو `if`.
     نسخه‌ی قبلی هر دو یادآوریِ روشن را پشتِ سرِ هم می‌فرستاد — همان چیزی که v3.9.0
     دلیلِ بلاک‌شدن ثبتش کرده بود و چون آزمایش running بود هرگز اجرا نشده بود. */
  const post = sweep.slice(sweep.indexOf('const wanted = []'), sweep.indexOf('if (!wanted.length)'));
  ok('شاخه‌ی بعد-از-آزمایش پیدا شد', !!post);
  ok('کارتِ شانس اولویت دارد و کارتِ روز با else if می‌آید (حداکثر یک پیام در شب)',
     /lucky_reminder_on[\s\S]*?else if[\s\S]*?daily_reminder_off/.test(post));
  ok('و هرگز هر دو با هم push نمی‌شوند', (post.match(/wanted\.push/g) || []).length === 2 && /else if/.test(post));

  // زنجیره فقط وقتی شلیک می‌کند که کاربر واقعاً امشب یادآوری گرفته باشد.
  ok('زنجیره پنجره‌ی زمانی دارد (وگرنه پیامِ بی‌موقعِ بعدازظهر)', /REMIND_CHAIN_SEC/.test(chainBody || ''));
  ok('زنجیره fail-safe است و فلوی کارتِ شانس را نمی‌شکند', /catch \(e\)/.test(chainBody || ''));
}

/* ═══════ ۱۲) دکمه‌ی «🔔 فردا یادآوری کن» فقط **کارتِ شانس** را روشن می‌کند (v3.85.0) ═══════
   🐛 باگِ زنده‌ای که این بلوک برایش نوشته شد: خطِ نوشتن **متقارن** بود
   (`if (on) setDailyReminderOn else setDailyReminderOff`). آن خط از v3.28.0 درست بود،
   چون آن‌وقت `daily_reminder_off` تنها ستونِ یادآوریِ شبانه بود. ولی v3.82.0 معنیِ جفت
   را عوض کرد و از آن لحظه، تپ روی این دکمه بی‌صدا **هر دو** یادآوری را روشن می‌کرد:
   ساعتِ ۲۲ کارتِ شانس و بلافاصله زنجیره‌ی کارتِ روز. روی دیتای زنده ۱۸۲ کاربر این‌طور
   شده بودند، در برابرِ **یک** نفر که واقعاً از صفحه‌ی تنظیمات هر دو را خواسته بود.

   ادعا **رفتاری** است: خودِ بدنه‌ی هندلر از سورس بریده و روی SQLite واقعی با SQLِ
   استخراج‌شده از همان سورس اجرا می‌شود. و طبقِ بند ۶ب-۲ ریشه هر دو جهت سنجیده می‌شود
   (`on` نباید کارتِ روز را روشن کند، `off` باید خاموشش کند) به‌علاوه‌ی یک **کنترلِ
   مثبت** که ثابت می‌کند همین هارنس رفتارِ قدیم را قرمز می‌دهد — وگرنه یک هندلرِ
   همیشه-بی‌اثر هم هر دو ادعای منفی را پاس می‌کرد. */
{
  const iH = SRC.indexOf('bot.action(/^lremind:([01])$/');
  ok('هندلرِ lremind در سورس پیدا شد', iH > -1);
  const body = block(SRC, 'bot.action(/^lremind:([01])$/') || '';
  ok('بدنه‌ی هندلرِ lremind استخراج شد', body.includes('setLuckyReminder'));

  const sqlOf = (name) => {
    const m = SRC.match(new RegExp(`${name}:\\s*db\\.prepare\\('([^']+)'\\)`));
    return m ? m[1] : '';
  };
  const sqlLucky = sqlOf('setLuckyReminder');
  const sqlOff   = sqlOf('setDailyReminderOff');
  const sqlOn    = sqlOf('setDailyReminderOn');
  ok('هر سه SQL از سورس استخراج شدند (نه کپیِ دستی)', !!sqlLucky && !!sqlOff && !!sqlOn);

  const mkUser = (off, lucky) => {
    const d = new DB(':memory:');
    d.exec('CREATE TABLE users(telegram_id INTEGER PRIMARY KEY, daily_reminder_off INT, lucky_reminder_on INT)');
    d.prepare('INSERT INTO users VALUES(7,?,?)').run(off, lucky);
    return d;
  };
  const row = (d) => d.prepare('SELECT daily_reminder_off o, lucky_reminder_on l FROM users WHERE telegram_id=7').get();

  /** بدنه‌ی هندلر را با stubها اجرا می‌کند. `src` اجازه می‌دهد جهشِ کنترلِ مثبت هم بدود. */
  const run = async (d, on, src = body) => {
    const stmts = {
      setLuckyReminder:    d.prepare(sqlLucky),
      setDailyReminderOff: d.prepare(sqlOff),
      setDailyReminderOn:  d.prepare(sqlOn),
    };
    const ctx = {
      from: { id: 7 }, match: [null, on ? '1' : '0'],
      answerCbQuery: async () => {}, editMessageReplyMarkup: async () => {},
    };
    const fn = new Function('stmts', 'track', 'db', 'assignedNightArm',
      'luckyReminderRow', 'luckyReminderCovered', 'Markup', 'L',
      `return async (ctx) => ${src};`)(
      stmts, () => {}, null, () => 'lucky', () => [], () => true,
      { inlineKeyboard: () => ({ reply_markup: {} }) },
      { lucky: { remindOnToast: 'a', remindOffToast: 'b' } });
    await fn(ctx);
  };

  // جهتِ ۱ — «یادآوری کن»: فقط کارتِ شانس. کارتِ روز باید **دست‌نخورده** بماند.
  const dOn = mkUser(1, 0);
  await run(dOn, true);
  ok('on: کارتِ شانس روشن می‌شود', row(dOn).l === 1);
  ok('on: کارتِ روز دست‌نخورده می‌ماند (باگِ ۱۸۲ کاربره)', row(dOn).o === 1);

  // و اگر کاربر از صفحه‌ی تنظیمات واقعاً هر دو را خواسته باشد، این دکمه خاموشش نمی‌کند.
  const dBoth = mkUser(0, 0);
  await run(dBoth, true);
  ok('on: انتخابِ آگاهانه‌ی «هر دو» از تنظیمات لمس نمی‌شود', row(dBoth).o === 0 && row(dBoth).l === 1);

  // جهتِ ۲ — «دیگه یادآوری نکن»: نیتش کلِ یادآوریِ شبانه است، پس هر دو خاموش.
  const dOff = mkUser(0, 1);
  await run(dOff, false);
  ok('off: کارتِ شانس خاموش می‌شود', row(dOff).l === 0);
  ok('off: کارتِ روز هم خاموش می‌شود (نیت = کلِ یادآوریِ شبانه)', row(dOff).o === 1);

  /* 🔬 کنترلِ مثبت: همین هارنس با خطِ **متقارنِ** قبلی باید قرمز بدهد. بدونِ این،
     یک هندلرِ بی‌اثر (یا استخراجِ خرابِ بدنه) هر چهار ادعای بالا را سبز رد می‌کرد. */
  const oldLine = 'if (on) stmts.setDailyReminderOn.run(uid); else stmts.setDailyReminderOff.run(uid);';
  const mutated = body.replace('if (!on) stmts.setDailyReminderOff.run(uid);', oldLine);
  ok('کنترلِ مثبت: جهش واقعاً روی بدنه نشست', mutated !== body);
  const dCtl = mkUser(1, 0);
  await run(dCtl, true, mutated);
  ok('کنترلِ مثبت: رفتارِ قدیم واقعاً هر دو کلید را روشن می‌کرد', row(dCtl).o === 0 && row(dCtl).l === 1);

  // ادعای ساختاری کنارِ رفتاری (بند ۲و/۶ب): هندلر نباید اصلاً نویسنده‌ی کارتِ روز را
  // در جهتِ روشن‌کردن صدا بزند، حتی اگر روزی شکلِ شرط عوض شود.
  ok('هندلرِ lremind هرگز setDailyReminderOn را صدا نمی‌زند', !body.includes('setDailyReminderOn'));

  // و آن statement کدِ مرده نیست: صفحه‌ی تنظیمات تنها جایی است که «هر دو» را می‌سازد.
  const settings = block(SRC, "bot.action(/^set:rt:") || '';
  ok('صفحه‌ی تنظیمات همچنان تنها راهِ روشن‌کردنِ کارتِ روز است',
     settings.includes('setDailyReminderOn'));
}

/* ═══════ نتیجه ═══════ */
if (fails.length) {
  console.error(`❌ چکِ یادآوریِ شبانه: ${fails.length} ادعا شکست خورد`);
  for (const f of fails) console.error(`   • ${f}`);
  process.exit(1);
}
console.log(`✅ چکِ یادآوریِ شبانه و دعوت و پاداشِ رفرال: ${pass} ادعا سبز.`);
