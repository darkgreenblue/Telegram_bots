#!/usr/bin/env node
// 🌍 گاردِ زمینه‌ی زبانِ هر کاربر (`bots/tarot/locale-ctx.js`) — بند ۲و CLAUDE.md ریشه.
//
// چرا این چک وجود دارد: تا دیروز «زبان» یک ثابتِ سرِ boot بود و یک پروسه فقط یک زبان
// داشت. حالا یک پروسه هم‌زمان به چند زبان جواب می‌دهد، و هر خرابیِ این مکانیزم **بی‌صدا**
// است: کاربرِ روس یک پیامِ انگلیسی می‌گیرد، هیچ استثنایی پرتاب نمی‌شود، هیچ لاگی قرمز
// نمی‌شود، و تا وقتی کسی اسکرین‌شات نفرستد کسی خبردار نمی‌شود — دقیقاً همان کلاسی که
// بند ۲و/۶ب ریشه ثبتش کرده («ترجمه شده» با «رسیده» یکی نیست).
//
// پس این چک عمداً **رفتاری** است: زبان‌ها را واقعاً بار می‌کند، زمینه‌های موازی را
// واقعاً می‌دواند، و همان چیزی را می‌سنجد که به کاربر می‌رسد. کنارش چند ادعای
// **ساختاری** هم هست، چون یک چکِ رفتاری که خودش `withLang` را صدا می‌زند فقط آینه‌ی
// خودش را می‌سنجد و اگر فردا محصول فراموشش کند سبز می‌ماند (همان تله‌ی گاردِ آینه‌ای).
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const DIR = new URL('../bots/tarot/', import.meta.url);
const SRC = readFileSync(new URL('index.js', DIR), 'utf8');
// کامنت‌ها قبل از هر ادعای ساختاری حذف می‌شوند — تله‌ی ثبت‌شده‌ی ریپو (v3.56.0، v3.64.0،
// و چهار بارِ دیگر): سندنویسی خودش باگ تولید می‌کند وقتی چک متن را خام می‌خواند.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** یک اسنیپت را در یک پروسه‌ی جدا با محیطِ دلخواه اجرا می‌کند و stdout را برمی‌گرداند. */
function run(env, code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: new URL('.', DIR).pathname,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۱) پروسه‌ی تک‌زبانه بیت‌به‌بیت مثل دیروز است
 * ═══════════════════════════════════════════════════════════════════════════
 * مهم‌ترین ادعای این فایل. رباتِ فارسی 🟢 زنده و درآمدزاست و این کلِ زیرساختِ
 * چندزبانگی نباید ذره‌ای رفتارش را عوض کند. */
console.log('\n▶ ۱) پروسه‌ی تک‌زبانه');
{
  const { out } = run({ LOCALE: 'fa', LANGS: '' }, `
    const m = await import('./locale-ctx.js');
    console.log(JSON.stringify({
      langs: m.LANGS, def: m.DEFAULT_LANG, multi: m.MULTI_LANG,
      code: m.L.code, norm: m.normLang('zz'), isl: m.isLang('ru'),
    }));
  `);
  let j = {}; try { j = JSON.parse(out); } catch {}
  ok(Array.isArray(j.langs) && j.langs.length === 1 && j.langs[0] === 'fa', 'LANGS خالی = فقط زبانِ پیش‌فرض');
  ok(j.multi === false, 'پروسه‌ی تک‌زبانه `MULTI_LANG=false` است');
  ok(j.code === 'fa', 'بیرونِ هر زمینه‌ای، `L` همان زبانِ پروسه است (رفتارِ دیروز)');
  ok(j.norm === 'fa', 'زبانِ ناشناخته به پیش‌فرض می‌افتد، نه خطا');
  ok(j.isl === false, '`isLang` زبانی که این پروسه سرو نمی‌کند را رد می‌کند');

  // و هیچ هشداری نمی‌دهد: وقتی یک جواب بیشتر وجود ندارد، «زمینه نداریم» بی‌معنی است
  const { err } = run({ LOCALE: 'fa', LANGS: '' }, `
    const m = await import('./locale-ctx.js');
    for (let i = 0; i < 5; i++) void m.L.code;
  `);
  ok(!/LANG_UNSET/.test(err), 'پروسه‌ی تک‌زبانه هرگز هشدارِ LANG_UNSET نمی‌دهد (وگرنه هشدار بی‌معنا می‌شود)');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۲) زمینه‌های موازی به هم نشت نمی‌کنند — قلبِ این مکانیزم
 * ═══════════════════════════════════════════════════════════════════════════
 * تنها حالتِ خرابیِ واقعیِ ALS این است: دو کاربرِ هم‌زمان با دو زبان. اگر این ادعا
 * بشکند، کاربرِ روس وسطِ فالِ پولی‌اش متنِ پرتغالی می‌بیند. */
console.log('\n▶ ۲) زمینه‌های موازی (رفتاری، روی مسیرِ واقعیِ محصول)');
{
  const { out, err } = run({ LOCALE: 'ru', LANGS: 'ru,pt,es' }, `
    const { withLang, L } = await import('./locale-ctx.js');
    const { configureAllLocales } = await import('./locale-boot.js');
    const rc = await import('./reading-core.js');
    const cc = await import('./chat-core.js');
    const rp = await import('./repair.js');
    configureAllLocales();
    // ترتیبِ تصادفیِ بیدار شدن: اگر زمینه نشت کند، این دقیقاً جایی است که لو می‌رود
    const probe = (lg, ms) => withLang(lg, async () => {
      await new Promise(r => setTimeout(r, ms));
      return { lg,
        code: L.code,
        card: rc.cardName('m00'),
        tz:   rc.botTz(),
        chat: cc.chatLocale(),
        kb:   String(rc.CARD_KB.m00?.image || '').slice(0, 10),
        def:  rp.DEFECTS.map(d => d.id).join(','),
        btn:  L.buttons.reading,
      };
    });
    const rows = await Promise.all([probe('ru', 30), probe('pt', 5), probe('es', 18), probe('ru', 1), probe('es', 25)]);
    console.log(JSON.stringify(rows));
  `);
  let rows = []; try { rows = JSON.parse(out); } catch { console.log(err.slice(0, 400)); }
  ok(rows.length === 5, 'پنج زمینه‌ی موازی اجرا شدند');
  ok(rows.every(r => r.code === r.lg), 'هر زمینه بسته‌ی locale خودش را می‌بیند');
  const uniq = (k) => new Set(rows.map(r => r[k])).size;
  ok(uniq('card') === 3, 'نامِ کارت per زبان است (سه مقدارِ متمایز)');
  ok(uniq('tz') === 3, 'منطقه‌ی زمانی per زبان است — مرزِ روزِ استریک و کارتِ روز');
  ok(uniq('kb') === 3, 'جدولِ دانشِ کارت per زبان است (ماده‌ی خامِ پرامپت)');
  ok(uniq('btn') === 3, 'برچسبِ دکمه per زبان است');
  ok(rows.every(r => r.chat === r.lg), 'گاردهای گفتگو per زبان‌اند');
  // ⚠️ حساس‌ترینِ این جدول: الگوهای ضعفِ زبانی. یک آرایه‌ی مشترک یعنی الگوی اسپانیایی
  // روی متنِ روسی اجرا شود — هم قرمزِ کاذب (تعمیرِ بی‌دلیل) و هم گاردِ غایب.
  ok(uniq('def') === 3, 'فهرستِ ضعف‌های زبانی per زبان است');
  const ru = rows.find(r => r.lg === 'ru') || {};
  const es = rows.find(r => r.lg === 'es') || {};
  ok(/genderedPast/.test(ru.def || '') && !/genderedPast/.test(es.def || ''),
     'ضعفِ مخصوصِ روسی فقط در زمینه‌ی روسی است');
  ok(/genero/.test(es.def || '') && !/genero/.test(ru.def || ''),
     'ضعفِ مخصوصِ اسپانیایی فقط در زمینه‌ی اسپانیایی است');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۳) زمینه از هر مرزِ async رد می‌شود
 * ═══════════════════════════════════════════════════════════════════════════
 * هندلرهای این ربات پر از await و setTimeout و promiseِ await‌نشده‌اند (پیش‌فراخوانیِ
 * خوانش، انیمیشنِ لودینگ، تأخیرِ عمدیِ رسید). اگر زمینه از یکی از این مرزها رد نشود،
 * نیمی از پیام‌های همان فال به زبانِ اشتباه می‌روند. */
console.log('\n▶ ۳) عبور از مرزهای async');
{
  const { out } = run({ LOCALE: 'ru', LANGS: 'ru,pt' }, `
    const { withLang, L, currentLang } = await import('./locale-ctx.js');
    const seen = await withLang('pt', async () => {
      const a = L.code;
      await new Promise(r => setTimeout(r, 5));
      const b = L.code;
      const c = await Promise.resolve().then(() => currentLang());
      const d = await new Promise(r => setImmediate(() => r(currentLang())));
      return [a, b, c, d];
    });
    console.log(JSON.stringify(seen));
  `);
  let j = []; try { j = JSON.parse(out); } catch {}
  ok(j.length === 4 && j.every(v => v === 'pt'),
     'زمینه از await و setTimeout و then و setImmediate رد می‌شود');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۴) نبودِ زمینه **بی‌صدا نیست**
 * ═══════════════════════════════════════════════════════════════════════════
 * ۲۸ نقطه‌ی این ربات بیرونِ هر آپدیتی پیام می‌فرستند (جاروهای شبانه، صفِ ادمین،
 * بازیابیِ فلوهای یتیم). آن‌ها `ctx` ندارند و باید صریح `withLang` بپیچند. این ادعا
 * تضمین می‌کند جاافتادنِ آن wrap به یک لاگِ greppable تبدیل شود، نه به یک پیامِ
 * انگلیسی برای کاربرِ روس که هیچ‌کس نمی‌بیندش. */
console.log('\n▶ ۴) نبودِ زمینه در پروسه‌ی چندزبانه صدا می‌دهد');
{
  const { out, err } = run({ LOCALE: 'ru', LANGS: 'ru,pt' }, `
    const m = await import('./locale-ctx.js');
    console.log(JSON.stringify({ code: m.L.code, ctx: m.hasLangCtx() }));
  `);
  let j = {}; try { j = JSON.parse(out); } catch {}
  ok(/LANG_UNSET/.test(err), 'خواندنِ زبان بیرونِ زمینه مارکرِ LANG_UNSET چاپ می‌کند');
  ok(j.code === 'ru', 'و بعد به زبانِ پیش‌فرض برمی‌گردد (هرگز فلوی کاربر را نمی‌شکند)');
  ok(j.ctx === false, '`hasLangCtx` بیرونِ زمینه false است و خودش هشدار نمی‌دهد');

  // dedup: هشداری که در یک حلقه‌ی پرتکرار صدها بار چاپ شود، خودش لاگ را کور می‌کند
  const rep = run({ LOCALE: 'ru', LANGS: 'ru,pt' }, `
    const m = await import('./locale-ctx.js');
    for (let i = 0; i < 50; i++) void m.L.code;
  `);
  ok((rep.err.match(/LANG_UNSET/g) || []).length <= 3,
     'هشدار روی همان ردِ پشته dedup می‌شود (وگرنه لاگ غرق می‌شود)');

  // و در حالتِ سخت‌گیر (فقط چک‌های CI) اصلاً تحمل نمی‌شود
  const strict = run({ LOCALE: 'ru', LANGS: 'ru,pt', LANG_STRICT: '1' }, `
    const m = await import('./locale-ctx.js');
    try { void m.L.code; console.log('NO_THROW'); } catch (e) { console.log('THREW'); }
  `);
  ok(strict.out === 'THREW', '`LANG_STRICT=1` نبودِ زمینه را به خطا تبدیل می‌کند');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۵) `allLabels` — اتحادِ برچسب‌ها
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۵) اتحادِ برچسب‌های کیبورد');
{
  const { out } = run({ LOCALE: 'ru', LANGS: 'ru,pt,es' }, `
    const { allLabels } = await import('./locale-ctx.js');
    console.log(JSON.stringify({
      reading: allLabels(l => l.buttons.reading),
      missing: allLabels(l => l.buttons.__nope__),
      thrown:  allLabels(() => { throw new Error('x'); }),
    }));
  `);
  let j = {}; try { j = JSON.parse(out); } catch {}
  ok((j.reading || []).length === 3, 'برچسبِ یک دکمه در هر سه زبان جمع می‌شود');
  ok(new Set(j.reading || []).size === (j.reading || []).length, 'خروجی یکتاست (برچسبِ مشترک دوبار نمی‌آید)');
  ok((j.missing || []).length === 0, 'کلیدِ ناموجود آرایه‌ی خالی می‌دهد، نه undefined در فهرستِ hears');
  ok((j.thrown || []).length === 0, 'خطای انتخاب‌گر ثبتِ ربات را نمی‌شکند');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۶) ادعاهای ساختاری — گاردِ رفتاری به‌تنهایی کافی نیست
 * ═══════════════════════════════════════════════════════════════════════════
 * بخشِ بالا ثابت می‌کند مکانیزم کار می‌کند. این بخش ثابت می‌کند **محصول واقعاً از آن
 * استفاده می‌کند**. بدونِ این، فردا که کسی یک `bot.hears(L.buttons.X)` تازه بنویسد،
 * همه‌ی ادعاهای رفتاری سبز می‌مانند و تپِ کاربرِ آن زبان بی‌صدا گم می‌شود. */
console.log('\n▶ ۶) سیم‌کشیِ محصول');
{
  // ترتیبِ میدل‌ورها در تلگراف معنادار است: هر چیزی که قبل از زمینه‌ی زبان بنشیند،
  // زبانِ پیش‌فرض را می‌بیند.
  const useAt = CODE.indexOf('bot.use((ctx, next) => withLang(');
  const jrnAt = CODE.indexOf('registerJourney(bot');
  ok(useAt !== -1, 'میدل‌ورِ زمینه‌ی زبان در `index.js` ثبت شده');
  ok(useAt !== -1 && jrnAt !== -1 && useAt < jrnAt,
     'میدل‌ورِ زبان **قبل از** میدل‌ورِ جرنی ثبت می‌شود');
  const catchAt = CODE.indexOf('bot.catch(');
  ok(catchAt === -1 || catchAt < useAt || useAt < jrnAt,
     'ترتیبِ ثبت با گاردِ خطای سراسری سازگار است');

  // 🔑 مهم‌ترین ادعای ساختاریِ این فایل. `bot.hears` لحظه‌ی **ثبت** ارزیابی می‌شود،
  // یعنی بیرونِ هر زمینه‌ای؛ یک `L.buttons.X` خام آن‌جا فقط برچسبِ زبانِ پیش‌فرض را
  // ثبت می‌کند و تپِ کاربرِ زبانِ دیگر به هیچ هندلری نمی‌رسد — بی‌صدا، چون تلگراف
  // چیزی که match نشود را به هندلرِ متنِ آزاد می‌دهد و کاربر یک جوابِ بی‌ربط می‌گیرد.
  const bare = [...CODE.matchAll(/bot\.hears\(\s*(L\.buttons\.\w+|L\.support\??\.\w+)/g)].map(m => m[1]);
  ok(bare.length === 0,
     `هیچ bot.hears ای برچسبِ خامِ تک‌زبانه ثبت نمی‌کند${bare.length ? ' — خام: ' + bare.join(' | ') : ''}`);
  // و کنترلِ مثبت: ادعای بالا وقتی معنی دارد که واقعاً hears هایی وجود داشته باشند
  ok((CODE.match(/bot\.hears\(/g) || []).length >= 5,
     'کنترلِ مثبت: چند `bot.hears` در سورس هست (وگرنه ادعای بالا پوچ بود)');
  ok(/allLabels\(l => l\.buttons\./.test(CODE), 'برچسب‌ها از `allLabels` می‌آیند');

  // `KB_LABELS` هم لحظه‌ی ثبت ساخته می‌شود و دو مصرف‌کننده‌ی حساس دارد: تفکیکِ
  // «دکمه» از «تایپِ آزاد» در جرنی، و گاردِ استیتِ گفتگو.
  const kb = /const KB_LABELS = new Set\(\[([\s\S]*?)\]\.filter/.exec(CODE);
  ok(!!kb, 'بلوکِ KB_LABELS پیدا شد');
  ok(!!kb && !/(?<!\.)\bL\.buttons\.\w+/.test(kb[1].replace(/l\.buttons\.\w+/g, '')),
     'KB_LABELS برچسبِ خامِ تک‌زبانه ندارد');

  // مهاجرتِ ستونِ زبان: افزایشی و با DEFAULT (بند ۲ج/۱ ریشه)
  ok(/ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT ''/.test(CODE),
     'ستونِ `users.lang` افزایشی و با DEFAULT اضافه می‌شود');
  ok(!/DROP COLUMN|RENAME COLUMN/.test(CODE), 'هیچ ستونی DROP یا RENAME نمی‌شود');

  // `fmt` نباید سرِ boot گرفته شود: هر زبان قالبِ عددیِ خودش را دارد
  ok(/const fmt = \(n\) => L\.fmt\(n\)/.test(CODE),
     '`fmt` در زمانِ فراخوانی resolve می‌شود، نه سرِ boot');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ۷) `configureAllLocales` همه‌ی زبان‌ها را می‌نشاند
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ کنترلِ منفی (بند ۶ب-۲): بدونِ این، یک `configureLocale` که فقط زبانِ پیش‌فرض را
 * پیکربندی کند همه‌ی ادعاهای بالا را پاس می‌کرد و فقط **جوابِ قاطعِ** زبان‌های دیگر
 * بی‌صدا از فال حذف می‌شد. */
console.log('\n▶ ۷) پیکربندیِ همه‌ی زبان‌ها');
{
  const { out } = run({ LOCALE: 'ru', LANGS: 'ru,pt,es' }, `
    const { withLang } = await import('./locale-ctx.js');
    const { configureAllLocales } = await import('./locale-boot.js');
    const v = await import('./verdict.js');
    configureAllLocales();
    const probe = (lg) => withLang(lg, () => v.BINARY_ANSWERS.YES);
    console.log(JSON.stringify(['ru', 'pt', 'es'].map(probe)));
  `);
  let j = []; try { j = JSON.parse(out); } catch {}
  ok(j.length === 3 && new Set(j).size === 3,
     'جوابِ قاطع در هر سه زبان پیکربندی شده (`configureAllLocales`)');
  ok(/export function configureAllLocales/.test(readFileSync(new URL('locale-boot.js', DIR), 'utf8')),
     'یک تابعِ واحد همه‌ی زبان‌ها را می‌نشاند (نه یک حلقه در صداکننده)');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
for (const e of errs) console.log(`   - ${e}`);
if (errs.length) process.exit(1);
