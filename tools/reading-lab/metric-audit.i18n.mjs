#!/usr/bin/env node
/* 🔬 ممیزیِ سنجه‌ی «شرطِ پایانی نامِ کارت را می‌برد» برای چهار زبانِ غیرانگلیسی.
 *
 * چرا جدا از `metric-audit.en.mjs`: آن یکی وقتی نوشته شد که `closingCond` فقط برای
 * انگلیسی اعلام شده بود. این فایل همان قرارداد را برای fa/ru/pt/es پین می‌کند.
 *
 * 🐛 و دلیلِ وجودش یک باگِ واقعی است که **قبل از خرجِ یک سنت** گرفته شد: نسخه‌ی اولِ
 * `closingAnchor` (نوشته‌شده در دورِ ۵ برای انگلیسی) نامِ کارت را فقط **عیناً** تطبیق
 * می‌داد. روسی نام را صرف می‌کند («Тройка Кубков» ⟵ «Тройку Кубков»)، پس سنجه روی
 * روسی ساختاراً کم‌شمار می‌کرد و قاعده‌ی دورِ ۵ را **بی‌اثر** نشان می‌داد در حالی که
 * شاید کار می‌کرد. همان کلاسِ باگی که یک بار برای `anchorScore` ثبت و رفع شده بود.
 *
 * اجرا: `node tools/reading-lab/metric-audit.i18n.mjs`
 */
import { spawnSync } from 'child_process';

const CARDS = ['m00', 'c03', 's02'];   // دیوانه · سه جام · دو شمشیر

/* هر ردیف: [برچسب، متنِ جمع‌بندی، انتظار]. هر زبان **هر دو جهت** را دارد:
 * نامِ کارت در **شرط** (باید گرفته شود) و در **نتیجه‌ی** شرط (نباید). بدونِ جهتِ دوم،
 * یک سنجه‌ی همیشه-true هم سبز رد می‌شد. */
const CASES = {
  fa: [
    ['نامِ کارت در شرط', 'در کل: آره. اگر به دیوانه اعتماد کنی، آن‌وقت راه باز می‌شود.', { cond: true, named: true }],
    ['نامِ کارت در نتیجه، نه شرط', 'در کل: آره. اگر صبر کنی، آن‌وقت دیوانه راه را باز می‌کند.', { cond: true, named: false }],
    ['بدونِ شرط', 'در کل: آره. همین مسیر را ادامه بده.', { cond: false, named: false }],
    ['دو شرط، آخری ملاک', 'اگر دیوانه بیاید خوب است. اگر صبر کنی، آن‌وقت جواب می‌گیری.', { cond: true, named: false }],
    ['شکلِ محاوره‌ای «اگه/اونوقت»', 'در کل: آره. اگه سه جام رو ببینی، اونوقت جواب می‌گیری.', { cond: true, named: true }],
    /* کنترلِ قیدِ «فقط نامِ چندواژه‌ای»، و **تنها جایی که آن قید بار دارد**: فارسی حرفِ
     * بزرگ ندارد، پس تفکیکِ حساس-به-حرف این‌جا بی‌اثر است و فقط همین قید می‌ماند.
     * «قدرت» هم نامِ m08 است هم اسمِ عامِ پرتکرار. برداشتنِ قید این ردیف را قرمز می‌کند
     * (تستِ جهش قبلاً همین شکاف را لو داد: با کنترلِ اسپانیایی تنها، جهش زنده می‌ماند). */
    ['اسمِ عامِ تک‌واژه‌ای نامِ کارت شمرده نمی‌شود',
      'در کل: آره. اگر سه جام را با قدرت نگه داری، آن‌وقت راه باز می‌شود.',
      { cond: true, named: true, alien: '' }],
  ],
  ru: [
    ['نامِ کارت در شرط', 'В целом: да. Если ты доверишься Шуту, тогда путь откроется.', { cond: true, named: true }],
    ['نامِ کارت در نتیجه، نه شرط', 'В целом: да. Если подождёшь, тогда Шут откроет путь.', { cond: true, named: false }],
    ['بدونِ شرط', 'В целом: да. Продолжай в том же духе.', { cond: false, named: false }],
    // ⚠️ همان موردی که باگِ تطبیقِ عینی را لو داد: نام در حالتِ مفعولی صرف شده.
    ['نامِ صرف‌شده در شرط', 'Если ты примешь Тройку Кубков, то всё сдвинется.', { cond: true, named: true }],
  ],
  pt: [
    ['نامِ کارت در شرط', 'No geral: sim. Se você confiar em O Louco, então o caminho abre.', { cond: true, named: true }],
    ['نامِ کارت در نتیجه، نه شرط', 'No geral: sim. Se você esperar, então O Louco abre o caminho.', { cond: true, named: false }],
    ['بدونِ شرط', 'No geral: sim. Continue assim.', { cond: false, named: false }],
    // ⚠️ حیاتی‌ترین موردِ پرتغالی: «se»ِ انعکاسیِ بعد از «então» نباید شرط را بدزدد.
    ['se انعکاسی بعد از então', 'Se você aceitar Três de Copas, então tudo se resolve.', { cond: true, named: true }],
  ],
  es: [
    ['نامِ کارت در شرط', 'En general: sí. Si confías en El Loco, entonces el camino se abre.', { cond: true, named: true }],
    ['نامِ کارت در نتیجه، نه شرط', 'En general: sí. Si esperas, entonces El Loco abre el camino.', { cond: true, named: false }],
    ['بدونِ شرط', 'En general: sí. Todo se resuelve solo.', { cond: false, named: false }],
    // «sí»ِ تأکیدی نویسه‌ی دیگری است و نباید شرط حساب شود.
    ['«sí» تأکیدی شرط نیست', 'En general: sí. Nada se mueve por ahora.', { cond: false, named: false }],
    /* ⚠️ حیاتی‌ترین موردِ اسپانیایی، و شکلِ **واقعیِ** خروجیِ دورِ ۱۴۰۵/۰۶/۲۸: «si» در
     * این زبان «آیا» هم معنی می‌دهد و نتیجه‌ی شرط تقریباً همیشه «entonces sabrás
     * si …» می‌شود. سنجه که آخرین «si» را می‌گیرد، بدونِ قیدِ ابتدای بند بندِ
     * اشتباه را نمره می‌داد و دو فال از نُه را ❌ می‌کرد. برداشتنِ آن قید این ردیف
     * را قرمز می‌کند. */
    ['«si»ِ «آیا» در نتیجه شرط را نمی‌دزدد',
      'En general: sí. Si usas El Loco para decir lo que necesitas, entonces sabrás si ambos pueden construir eso.',
      { cond: true, named: true }],
    /* 🚨 شکلِ **واقعیِ** دو فال از نُهِ همان دور: الزامِ «نامِ کارت را ببر» با کارتی
     * برآورده شد که در این فال کشیده نشده بود. `named` صفر می‌شود ولی علتش را
     * نمی‌گوید؛ `alien` می‌گوید. برداشتنِ سنجه این ردیف را قرمز می‌کند. */
    ['کارتِ بیگانه در شرط', 'En general: sí. Si el Ocho de Oros deja claro el pago, entonces avanzas.',
      { cond: true, named: false, alien: 'Ocho de Oros' }],
    ['کارتِ خودِ فال بیگانه شمرده نمی‌شود',
      'En general: sí. Si aceptas Tres de Copas, entonces avanzas.', { cond: true, named: true, alien: '' }],
    /* کنترلِ قیدِ «فقط نامِ چندواژه‌ای» (بند ۶ب-۲): «la fuerza» اسمِ عامِ اسپانیایی است و
     * اتفاقاً نامِ کارتِ m08 هم هست. بدونِ آن قید، همین جمله‌ی سالم «کارتِ بیگانه» اعلام
     * می‌شد — و اسکنِ اولیه‌ی دورِ ۱۴۰۵/۰۶/۲۸ دقیقاً پنج هشدارِ کاذب از هشت ضربه از
     * همین کلاس داشت. برداشتنِ قید این ردیف را قرمز می‌کند. */
    ['اسمِ عام نامِ کارت شمرده نمی‌شود',
      'En general: sí. Si usas la fuerza de Tres de Copas sin pelear, entonces avanzas.',
      { cond: true, named: true, alien: '' }],
  ],
};

let pass = 0; const fails = [];
for (const [lang, cases] of Object.entries(CASES)) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { closingAnchor } = await import('${new URL('checks.mjs', import.meta.url).pathname}');
    const cards = ${JSON.stringify(CARDS.map(k => ({ key: k })))};
    const cases = ${JSON.stringify(cases)};
    console.log(JSON.stringify(cases.map(([, c]) => closingAnchor({ llm: { closing: c }, cards }))));
  `], { encoding: 'utf8', env: { ...process.env, LOCALE: lang } });
  let got = null;
  try { got = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  if (!got) { fails.push(`«${lang}»: اجرا نشد — ${(r.stderr || '').slice(0, 160)}`); continue; }
  cases.forEach(([label, , want], i) => {
    const g = got[i];
    /* `alien` فقط وقتی سنجیده می‌شود که ردیف اعلامش کرده باشد، تا ۱۶ ردیفِ قبلی
     * دست‌نخورده بمانند. ⚠️ ولی `undefined === undefined` یعنی سنجه‌ی حذف‌شده هم سبز
     * رد می‌شود، پس ردیفی که `alien` دارد صریح می‌خواهد که **رشته** برگردد. */
    const wantsAlien = Object.hasOwn(want, 'alien');
    const good = g && g.cond === want.cond && g.named === want.named
      && (!wantsAlien || (typeof g.alien === 'string' && g.alien === want.alien));
    if (good) pass++;
    else fails.push(`«${lang}» ${label}: انتظار cond=${want.cond}/named=${want.named}`
      + (wantsAlien ? `/alien=«${want.alien}»` : '')
      + `، گرفت ${g ? `cond=${g.cond}/named=${g.named}${wantsAlien ? `/alien=${JSON.stringify(g.alien)}` : ''}` : 'null'}`);
  });
}

console.log(JSON.stringify({ pass, fails }, null, fails.length ? 1 : 0));
process.exit(fails.length ? 1 : 0);
