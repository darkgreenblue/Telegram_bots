#!/usr/bin/env node
// 🌍 چکِ تفکیکِ «تاروت فارسی» از «تاروت زبان‌های دیگر» در داشبورد (بند ۲و/۷ ریشه).
//
// چرا این چک لازم است: هر سه خرابیِ ممکنِ این تفکیک **بی‌صدا**ند — صفحه رندر می‌شود،
// هیچ خطایی نمی‌آید، فقط عدد دروغ می‌گوید:
//   ۱) دو الگو اگر همپوشانی پیدا کنند، یک دیتابیس **دو بار** شمرده می‌شود.
//   ۲) دو الگو اگر با هم کلِ فایل‌ها را نپوشانند، زبانِ تازه **بی‌صدا ناپدید** می‌شود
//      (هیچ‌جا خطا نمی‌دهد؛ فقط ربات در داشبورد وجود ندارد).
//   ۳) اگر واحدِ پول per ریل نباشد، «۲۵۰ استارز» به‌عنوان «۲۵۰ تومان» چاپ می‌شود و
//      جمعِ درآمد یک عددِ بی‌معنی می‌شود.
//
// اجرا: node tools/check-dash-split.mjs   (بدون شبکه؛ فیکسچرِ فایل در پوشه‌ی موقت)
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// فیکسچر **قبل از** import ساخته می‌شود: `instances()` مسیر را از env می‌خواند.
const root = mkdtempSync(path.join(tmpdir(), 'dashsplit-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
process.env.TAROT_DB_DIR = dataDir;

const { BOTS, botByKey, instancesOf, moneyText, moneyOf, toToman, receiptQueueSupported, abSupported } =
  await import('../bots/dashboard/lib/bots.js');
const { MASTER_DASH_BOTS, DEFAULT_BOT } = await import('../bots/dashboard/lib/nav.js');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const FA = botByKey('tarot');
const INTL = botByKey('tarot-intl');

console.log('🌍 تفکیکِ تاروتِ فارسی و زبان‌های دیگر:');

// ── ۱) دو ردیف وجود دارند و کلیدِ فارسی عوض نشده ─────────────────────────────
ok(!!FA && !!INTL, 'هر دو ردیفِ `tarot` و `tarot-intl` در رجیستری هستند');
// کلیدِ `tarot` روی کوکیِ `dash_bot`، لینک‌های `?bot=tarot` و `MASTER_DASH_BOTS` نشسته؛
// عوض‌کردنش یعنی شکستنِ هر سه، بی‌صدا.
ok(DEFAULT_BOT === 'tarot', 'پیش‌فرضِ داشبورد هنوز `tarot` (فارسی) است');
ok(MASTER_DASH_BOTS.has('tarot') && MASTER_DASH_BOTS.has('tarot-intl'),
  'هر دو داشبوردِ اصلیِ BI را دارند (همان کدِ ربات، همان قراردادِ رویدادها)');

// ── ۲) الگوها: نه همپوشانی، نه شکاف ────────────────────────────────────────
const hit = (f) => BOTS.filter(b => b.pattern.test(f)).map(b => b.key);
const cases = [
  ['bot-fa.db', ['tarot']],
  ['bot-ru.db', ['tarot-intl']],
  ['bot-pt.db', ['tarot-intl']],
  ['bot-es.db', ['tarot-intl']],
  ['bot-pt-br.db', ['tarot-intl']],   // locale مرکب هم باید بیفتد داخل
  ['bot.db', ['voice2text', 'daily-brief']], // نامِ عمومی مالِ ربات‌های دیگر است، نه تاروت
];
for (const [file, want] of cases) {
  const got = hit(file);
  ok(JSON.stringify(got) === JSON.stringify(want), `«${file}» → ${want.join('+') || 'هیچ‌کدام'} (شد: ${got.join('+') || 'هیچ‌کدام'})`);
}

// ناوردای اصلی: **هر** نامِ `bot-<locale>.db` دقیقاً یکی از این دو را می‌گیرد.
// اگر روزی یکی از دو الگو دست بخورد، زبانِ تازه یا دوبار شمرده می‌شود یا ناپدید.
const locales = ['fa', 'ru', 'pt', 'es', 'de', 'tr', 'ar', 'pt-br', 'zh-hans', 'a'];
const bad = locales.filter(l => {
  const n = [FA, INTL].filter(b => b.pattern.test(`bot-${l}.db`)).length;
  return n !== 1;
});
ok(bad.length === 0, `هر locale دقیقاً یکی از دو ردیف را می‌گیرد (${locales.length} نمونه)`);
if (bad.length) console.log('     locale های مشکل‌دار: ' + bad.join(', '));

// ── ۳) کشفِ خودکارِ زبانِ تازه: افزودنِ locale نباید هیچ تغییری در این فایل بخواهد ──
ok(path.resolve(FA.dataDir) === path.resolve(INTL.dataDir) && FA.envDir === INTL.envDir,
  'هر دو ردیف به همان پوشه‌ی دیتای تاروت نگاه می‌کنند (فقط الگو تفکیکشان می‌کند)');
for (const f of ['bot-fa.db', 'bot-ru.db', 'bot-pt.db']) writeFileSync(path.join(dataDir, f), '');
const faInst = instancesOf('tarot').map(i => path.basename(i.file));
const intlInst = instancesOf('tarot-intl').map(i => path.basename(i.file));
ok(JSON.stringify(faInst) === JSON.stringify(['bot-fa.db']), `instance فارسی فقط bot-fa.db است (شد: ${faInst.join(',')})`);
ok(JSON.stringify(intlInst) === JSON.stringify(['bot-pt.db', 'bot-ru.db']), `instance غیرفارسی خودکار زبان‌های تازه را می‌گیرد (شد: ${intlInst.join(',')})`);
ok(instancesOf('tarot-intl').every(i => /\((ru|pt|es)\)$/.test(i.title)),
  'برچسبِ هر instance غیرفارسی خودِ locale است (فیلترِ per زبان رویش می‌نشیند)');

// ── ۴) واحدِ پول per ریل — جمع‌زدنِ استارز با تومان بی‌معنی است ────────────────
ok(moneyOf('tarot').unit === 'toman', 'ریلِ فارسی تومانی است');
ok(moneyOf('tarot-intl').unit === 'star', 'ریلِ غیرفارسی استارزی است');
const intlText = moneyText('tarot-intl', 250);
ok(!intlText.includes('تومان'), `درآمدِ استارزی هرگز «تومان» نمی‌گوید (شد: ${intlText})`);
ok(intlText.includes('⭐'), `درآمدِ استارزی با ⭐ نمایش داده می‌شود (شد: ${intlText})`);
ok(moneyText('tarot', 150000).includes('تومان'), 'درآمدِ فارسی بیت‌به‌بیت مثل قبل تومانی می‌ماند');
ok(moneyText('voice2text', 50000).includes('تومان') && moneyText('tabir-khab', 100000).includes('تومان'),
  'بقیه‌ی ربات‌ها دست‌نخورده‌اند');
// ⭐ ستونِ `amount` روی این ریل **خودِ تعدادِ استارز** است؛ هیچ تبدیلی نباید بخورد.
ok(toToman('tarot-intl', 250) === 250, 'هیچ تبدیلی روی عددِ استارز انجام نمی‌شود');

// ── ۵) صفِ رسید در ریلِ استارز اصلاً وجود ندارد ────────────────────────────
// تلگرام خودش قبل از کسر تأیید می‌گیرد؛ دکمه‌ی «تأیید رسید» این‌جا یعنی یک صفِ همیشه‌خالی
// که یک `admin_actions` بی‌مصرف را به کاربر وعده می‌دهد.
ok(receiptQueueSupported('tarot') === true, 'صفِ رسید برای فارسی روشن است');
ok(receiptQueueSupported('tarot-intl') === false, 'صفِ رسید برای زبان‌های دیگر خاموش است (استارز رسید ندارد)');
ok(abSupported('tarot-intl') === true, 'صفحه‌ی A/B برای زبان‌های دیگر هم فعال است (همان کدِ ربات)');

// ── ۶) واحدِ اعتبار در هر دو ریل الماس است ─────────────────────────────────
// پول فرق دارد، **الماس نه**: هر دو همان کاتالوگِ ۱۰/۳۰/۱۰۰ الماس را می‌فروشند.
ok(FA.coinValue === INTL.coinValue && FA.coinName === INTL.coinName,
  'واحدِ اعتبار در هر دو ریل یکی است (الماس)');

console.log(`\n${errs.length ? '❌' : '✅'} check-dash-split: ${pass} ادعا سبز، ${errs.length} خطا`);
if (errs.length) process.exit(1);
