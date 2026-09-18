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
    const good = g && g.cond === want.cond && g.named === want.named;
    if (good) pass++;
    else fails.push(`«${lang}» ${label}: انتظار cond=${want.cond}/named=${want.named}، گرفت ${g ? `cond=${g.cond}/named=${g.named}` : 'null'}`);
  });
}

console.log(JSON.stringify({ pass, fails }, null, fails.length ? 1 : 0));
process.exit(fails.length ? 1 : 0);
