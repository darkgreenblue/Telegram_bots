#!/usr/bin/env node
// 💸 چکِ «اکشنِ اعتباری فقط برای رباتی صف می‌شود که واقعاً اجرایش می‌کند».
//
// 🐛 باگِ واقعی که این فایل را ساخت (۱۴۰۵/۰۶/۱۵، پیش از مرج گرفته شد):
// صفحه‌ی «پرداخت‌های سرگردان» دکمه‌ی «صاحبش پیدا شد → به پشتیبانی پیام داد» دارد که
// یک اکشنِ `credit_paid` در جدولِ `admin_actions` **همان ربات** صف می‌کند، و sweepِ
// خودِ ربات آن را اجرا می‌کند. تنها گاردش `hasTable(db,'admin_actions')` بود.
//
// ولی داشتنِ جدول با **فهمیدنِ اکشن** یکی نیست. sweepِ voice2text این شکل را دارد:
//     if (act.action === 'approve') …
//     else if (act.action === 'reject') …
//     stmts.markActionDone.run(act.id);   ← بی‌قید، بیرون از if/else
// یعنی هر اکشنِ ناشناخته **بی‌صدا done** می‌شود. زنجیره‌ی کامل:
//   مالک ردیفِ سرگردانِ voice2text را «به پشتیبانی پیام داد» می‌بندد
//   → داشبورد `credit_paid` صف می‌کند
//   → sweep بی‌صدا done علامتش می‌زند
//   → ردیف در داشبورد «حل‌شده» و در **درآمد** می‌ماند
//   → و کاربر هرگز یک الماس نمی‌گیرد.
// پول در سکوت ناپدید می‌شود، بدونِ هیچ خطا و هیچ ردی. دقیقاً چیزی که بند ۹ ریشه
// («هر ریالِ ورودی/خروجی ردپای DB دارد») و بند ۸ («هرگز فلو بی‌صدا نمیرد») ممنوع
// می‌کنند.
//
// این چک عمداً **دو طرفِ قرارداد** را می‌سنجد، نه فقط یکی:
//   ۱) داشبورد قبل از صف‌کردن `creditQueueSupported` را چک می‌کند.
//   ۲) هر رباتی که در رجیستری `creditQueue: true` دارد، آن اکشن‌ها را در سورسش
//      **واقعاً هندل می‌کند** — وگرنه پرچم دروغ می‌گوید و گارد بی‌فایده است.
// ادعای دوم مهم‌تر است: بدونش، کافی بود کسی `creditQueue: true` را به رباتی اضافه کند
// که آن را اجرا نمی‌کند و همان سیاه‌چاله برمی‌گشت، این بار با یک گاردِ سبز بالای سرش.
//
// اجرا: node tools/check-credit-queue.mjs   (بدون شبکه، بدون دیتابیس)
import { readFileSync, existsSync } from 'fs';
import path from 'path';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const read = (p) => readFileSync(path.resolve(p), 'utf8');
const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** اکشن‌های اعتباری‌ای که داشبورد می‌تواند صف کند. */
const CREDIT_ACTIONS = ['credit', 'credit_paid'];

console.log('\n💸 قرارداد اکشنِ اعتباریِ صف\n');

/* ══ ۱) سمتِ داشبورد: کورکورانه صف نمی‌کند ═══════════════════════════════ */
console.log('▶ ۱) داشبورد قبل از صف‌کردن، توانِ ربات را می‌سنجد');
{
  const bots = read('bots/dashboard/lib/bots.js');
  ok(/export const creditQueueSupported/.test(bots), 'پرچمِ creditQueueSupported وجود دارد');
  ok(/adminActionSupported\(bot, 'credit'\)[\s\S]{0,80}adminActionSupported\(bot, 'credit_paid'\)/.test(bots),
    'و از همان فهرستِ adminActions مشتق می‌شود (نه یک بولینِ موازی که drift کند)');

  const orph = read('bots/dashboard/routes/orphans.js');
  const code = strip(orph);
  ok(/creditQueueSupported\(r\.bot\)/.test(code),
    'orphanResolve قبل از INSERT، توانِ همان ربات را چک می‌کند');

  // و ترتیب مهم است: چک باید **قبل از** نوشتن باشد، نه بعدش
  const guardAt = code.indexOf('creditQueueSupported(r.bot)');
  const insertAt = code.indexOf('INSERT INTO admin_actions');
  ok(guardAt >= 0 && insertAt > guardAt,
    'و این چک **قبل از** INSERT است، نه بعد از آن');

  // دکمه هم نباید برای رباتِ ناتوان رندر شود (خطای صریح خوب است، ولی دکمه‌ی
  // بی‌اثر از اول نباید دیده شود)
  ok(/creditQueueSupported\(bot\)/.test(code),
    'و دکمه‌ی «به پشتیبانی پیام داد» برای رباتِ ناتوان اصلاً رندر نمی‌شود');
}

/* ══ ۲) سمتِ ربات: فهرست دروغ نمی‌گوید — در **هر دو جهت** ═══════════════════
   نامِ بی‌شاخه: داشبورد اکشنی را صف می‌کند که sweep نمی‌فهمد ← پول در سکوت گم می‌شود.
   شاخه‌ی بی‌نام: قابلیتی که ربات دارد، داشبورد بی‌دلیل می‌بندد ← باگ، فقط برعکس.
   ⚠️ و «نتوانستم بررسی کنم» هرگز سبز نیست: نسخه‌ی اولِ همین چک وقتی
   `bots/<key>/index.js` را پیدا نمی‌کرد بی‌صدا `continue` می‌زد، پس `tarot-intl` (که
   کدش در `bots/tarot/` است) اصلاً سنجیده نمی‌شد و «بررسی‌نشده» با «سالم» یکی به نظر
   می‌رسید — دقیقاً همان خطای «گاردی که با نبودِ قرمز سبز می‌شود» (بند ۶ب-۲ ریشه). */
console.log('\n▶ ۲) فهرستِ adminActions با شاخه‌های sweep مو‌به‌مو می‌خواند');
{
  const botsSrc = read('bots/dashboard/lib/bots.js');
  const entries = [...botsSrc.matchAll(/key:\s*'([a-z0-9-]+)'[\s\S]*?(?=\n  \{|\n\];)/g)];
  ok(entries.length > 0, `ردیف‌های رجیستری خوانده شدند (${entries.length})`);

  /* مسیرِ سورس از خودِ رجیستری مشتق می‌شود (`dataDir: '../tarot/data'` → `bots/tarot`)
     نه از کلید، چون چند ردیفِ رجیستری می‌توانند یک کدبیس داشته باشند (tarot و
     tarot-intl همین‌اند: یک `index.js`، چند دیتابیس). */
  const entryFile = (block, key) => {
    const dd = (block.match(/dataDir:\s*'\.\.\/([a-z0-9-]+)\/data'/) || [])[1];
    return `bots/${dd || key}/index.js`;
  };

  for (const m of entries) {
    const [block, key] = [m[0], m[1]];
    const listed = [...(block.match(/adminActions:\s*\[([\s\S]*?)\]/) || ['', ''])[1]
      .matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    const file = entryFile(block, key);

    if (!existsSync(path.resolve(file))) {
      // ربات پایتونی/بدونِ index.js: فقط وقتی مشکل است که ادعای اکشن داشته باشد
      ok(listed.length === 0,
        `${key}: سورسِ JS ندارد (${file})، پس نباید adminActions اعلام کند`);
      continue;
    }
    const src = strip(read(file));
    // هر `act.action === 'x'` که در sweep واقعاً هندل می‌شود
    const handled = [...src.matchAll(/act\.action === '([a-z_]+)'/g)].map((x) => x[1]);
    const uniq = [...new Set(handled)];

    for (const a of listed) {
      ok(uniq.includes(a), `${key}: «${a}» اعلام شده و در sweep هم هندل می‌شود`);
    }
    for (const a of uniq) {
      ok(listed.includes(a),
        `${key}: «${a}» در sweep هندل می‌شود و در adminActions هم اعلام شده`);
    }
    if (!listed.length && !uniq.length) ok(true, `${key}: نه اعلامی دارد نه شاخه‌ای (سازگار)`);
  }
}

/* ══ ۳) هیچ مسیرِ نوشتنِ داشبورد بی‌گارد نمانده ═══════════════════════════
   🐛 باگی که این بخش را ساخت: گاردِ نسخه‌ی اول فقط روی `orphans.js` بود، چون بولینِ
   `creditQueue` فقط دو اکشن را می‌شناخت. ولی `support.js` **شش** اکشن صف می‌کرد و
   هیچ گاردی نداشت؛ تنها چیزی که voice2text را نجات می‌داد این بود که ستون‌های
   user_id/amount/ref_id/note را ندارد و `assertColumns` خطا می‌داد — یک گاردِ
   **اتفاقی** که اولین مهاجرتِ افزایشیِ بعدی خاموشش می‌کرد. */
console.log('\n▶ ۳) هر مسیرِ enqueue قبل از INSERT گارد دارد');
{
  for (const [file, guard] of [
    ['bots/dashboard/routes/orphans.js', 'creditQueueSupported(r.bot)'],
    ['bots/dashboard/routes/support.js', 'adminActionSupported(inst.bot, act)'],
    ['bots/dashboard/routes/finance.js', 'receiptQueueSupported(inst.bot)'],
    ['bots/dashboard/routes/cards.js', 'cardsPageSupported(bot)'],
  ]) {
    const code = strip(read(file));
    const g = code.indexOf(guard);
    const ins = code.indexOf('INSERT INTO admin_actions');
    ok(g >= 0, `${file.split('/').pop()}: گاردِ «${guard}» هست`);
    ok(ins < 0 || (g >= 0 && g < ins),
      `${file.split('/').pop()}: و **قبل از** INSERT است`);
  }
  // و دکمه‌ی اکشنِ پشتیبانی برای رباتِ ناتوان اصلاً رندر نمی‌شود
  const sup = strip(read('bots/dashboard/routes/support.js'));
  ok(/adminActionSupported\(inst\.bot, a\)/.test(sup),
    'support: دکمه‌های اقدام از فیلترِ توانِ ربات رد می‌شوند');
  ok(/adminActionSupported\(inst\.bot, 'credit'\)/.test(sup),
    'support: فرمِ شارژ/کسرِ دستی هم گارد شده');
}

/* ══ ۴) لایه‌ی دوم: اکشنِ ناشناخته بی‌صدا دور ریخته نمی‌شود ═══════════════
   گاردِ سمتِ داشبورد کافی است تا این حالت پیش نیاید، ولی «پیش نیاید» با «اگر پیش
   آمد ردی بماند» یکی نیست. یک sweep که هر ردیفِ ناشناخته را بی‌صدا done کند، هر
   باگِ آینده را هم بی‌صدا می‌کند. */
console.log('\n▶ ۴) sweep اکشنِ ناشناخته را بی‌صدا دور نمی‌ریزد');
{
  for (const key of ['voice2text', 'tarot']) {
    const entry = `bots/${key}/index.js`;
    if (!existsSync(path.resolve(entry))) continue;
    const src = read(entry);
    /* ⚠️ لنگر عمداً `pendingActions.all()` است نه `pendingActions`: دومی اول به
       **تعریفِ statement** می‌خورد که صدها خط بالاتر از خودِ حلقه است، و بریدنِ ۶۰۰۰
       کاراکتر از آن‌جا اصلاً به sweep نمی‌رسید — ادعا قرمز می‌شد بدونِ اینکه باگی
       باشد. (همین اتفاق در اولین اجرای این چک افتاد.) */
    const at = src.indexOf('pendingActions.all()');
    const sweep = at < 0 ? '' : src.slice(at, at + 9000);
    /* ⚠️ الگو عمداً **فقط** مارکرِ صریح است. نسخه‌ی اولش
         /ADMIN_ACTION_UNKNOWN|logErr\(.{0,80}action/
       بود و با جهشِ حذفِ همان خط هم سبز می‌ماند، چون `logErr('admin_action exec:', …)`
       (لاگِ خطای اجرا، که چیزِ دیگری است) داخلِ همان بریده هست و الگو را راضی می‌کرد.
       یعنی ادعا چیزی را می‌سنجید که همیشه درست بود. مارکر باید **یکتا** باشد. */
    ok(/ADMIN_ACTION_UNKNOWN/.test(sweep),
      `${key}: اکشنِ ناشناخته مارکرِ صریحِ ADMIN_ACTION_UNKNOWN در لاگ می‌گذارد`);
  }
}

/* ══ ۵) هر پیامِ مالیِ sweep در تایم‌لاینِ کاربر می‌نشیند ═════════════════════
 *
 * 🐛 گپِ واقعی (۱۴۰۵/۰۶/۱۵): شاخه‌ی `unlock_reading` اعتبار می‌داد و به کاربر پیام
 * می‌فرستاد، ولی `logPush` نداشت — تنها شاخه‌ای از چهارتا که جا افتاده بود. یعنی
 * الماسِ داده‌شده در بازپخشِ مسیرِ کاربر **نامرئی** بود.
 *
 * چرا این‌جا خطرناک‌تر از جاهای دیگر است: میدل‌ورِ جرنی فقط `ctx.*` را رپ می‌کند، پس
 * هر پیامی که sweep با `bot.telegram.*` می‌فرستد ساختاراً از قیف بیرون است مگر
 * صریح ثبت شود. قاعده‌ی بند ۲الف ریشه: «پیامِ مالی هرگز نباید از تایم‌لاین غایب
 * باشد» — مالک یک بار فکر کرد پیامِ شارژ نرفته، در حالی که رفته بود و فقط ثبت نشده بود.
 * تا امروز این قاعده هیچ گاردی نداشت، فقط یک ردیف در مستندات؛ و دقیقاً همان‌طور که
 * انتظار می‌رفت، فراموش شد. */
console.log('\n▶ ۵) هیچ پیامِ مالیِ sweep بدونِ logPush نیست');
{
  const src = strip(read('bots/tarot/index.js'));
  const at = src.indexOf('pendingActions.all()');
  const sweep = at < 0 ? '' : src.slice(at, src.indexOf('markActionDone.run(act.id)', at));
  ok(sweep.length > 500, 'بدنه‌ی sweep پیدا شد');
  const sends = [...sweep.matchAll(/bot\.telegram\.sendMessage\(/g)].map((m) => m.index);
  ok(sends.length >= 4, `پیام‌های ctx-freeِ sweep شمرده شدند (${sends.length})`);
  for (const i of sends) {
    // متنِ پیام تا ۶۰۰ کاراکتر بعدش (کیبورد/آپشن‌ها) — logPush باید بلافاصله بیاید
    const near = sweep.slice(i, i + 600);
    const line = (sweep.slice(0, i).match(/[^\n]*$/) || [''])[0].trim().slice(0, 40);
    ok(/logPush\(/.test(near), `پیامِ «…${line}» با logPush ثبت می‌شود`);
  }
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
