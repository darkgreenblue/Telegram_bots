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

/* ══ ۲) سمتِ ربات: پرچم دروغ نمی‌گوید ════════════════════════════════════ */
console.log('\n▶ ۲) هر ربات با پرچمِ creditQueue، اکشن‌ها را واقعاً هندل می‌کند');
{
  const botsSrc = read('bots/dashboard/lib/bots.js');
  /* کلیدِ هر ربات و اینکه پرچم را دارد یا نه، از خودِ رجیستری استخراج می‌شود — نه از
     یک لیستِ هاردکد که با افزودنِ رباتِ بعدی کهنه شود. */
  const entries = [...botsSrc.matchAll(/key:\s*'([a-z0-9-]+)'[\s\S]*?(?=\n  \{|\n\];)/g)];
  ok(entries.length > 0, `ردیف‌های رجیستری خوانده شدند (${entries.length})`);

  const flagged = entries.filter((m) => /creditQueue:\s*true/.test(m[0])).map((m) => m[1]);
  ok(flagged.length > 0, `ربات‌های دارای پرچم: ${flagged.join(', ') || 'هیچ'}`);

  for (const key of flagged) {
    const entry = `bots/${key}/index.js`;
    if (!existsSync(path.resolve(entry))) {
      ok(false, `${key}: فایلِ ورودی پیدا نشد (${entry})`);
      continue;
    }
    const src = strip(read(entry));
    for (const act of CREDIT_ACTIONS) {
      ok(new RegExp(`action === '${act}'`).test(src),
        `${key} اکشنِ «${act}» را در سورسش هندل می‌کند`);
    }
  }
}

/* ══ ۳) ادعای معکوس: رباتِ بدونِ پرچم واقعاً آن را اجرا نمی‌کند ═══════════
   اگر رباتی اکشن را هندل کند ولی پرچمش خاموش باشد، گارد یک قابلیتِ موجود را
   بی‌دلیل می‌بندد. آن هم باگ است، فقط جهتش برعکس. */
console.log('\n▶ ۳) و رباتِ بدونِ پرچم واقعاً اجرایش نمی‌کند (پرچم بی‌دلیل خاموش نیست)');
{
  const botsSrc = read('bots/dashboard/lib/bots.js');
  const entries = [...botsSrc.matchAll(/key:\s*'([a-z0-9-]+)'[\s\S]*?(?=\n  \{|\n\];)/g)];
  const unflagged = entries.filter((m) => !/creditQueue:\s*true/.test(m[0])).map((m) => m[1]);
  let checked = 0;
  for (const key of unflagged) {
    const entry = `bots/${key}/index.js`;
    if (!existsSync(path.resolve(entry))) continue;
    checked++;
    const src = strip(read(entry));
    const handles = CREDIT_ACTIONS.filter((a) => new RegExp(`action === '${a}'`).test(src));
    ok(handles.length === 0,
      `${key} بدونِ پرچم است و اکشنِ اعتباری هم هندل نمی‌کند${handles.length ? ` (ولی ${handles.join(', ')} را دارد!)` : ''}`);
  }
  ok(checked > 0, `${checked} رباتِ بدونِ پرچم بررسی شد`);
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

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
