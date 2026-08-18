#!/usr/bin/env node
// 🧪 آزمایشگاهِ خوانش — شبیه‌سازیِ کاملِ کاربر بدونِ تلگرام و بدونِ دیتابیس.
//
// چرا هست: تا امروز تنها راهِ سنجیدنِ کیفیتِ خوانش، طی‌کردنِ دستیِ فلو در خودِ ربات بود
// (انتخابِ کارت، انتظار، و بعد کپیِ ده‌ها پیام). این یعنی هر دورِ بهبود ساعت‌ها کارِ دستی
// می‌خواست و عملاً بیشتر از دو سه فال تست نمی‌شد. حالا کلِ مسیرِ «کاربرِ جدید → چند فالِ
// پشتِ سرِ هم با حافظه‌ی انباشته» آفلاین اجرا می‌شود و خروجی با معیارهای مکانیکی سنجیده
// می‌شود، در چند دقیقه و با چند سنت.
//
// ⚠️ این کپیِ ربات نیست: پرامپت از `locales/fa.js`، کلاینتِ OpenRouter و موتورِ دک و
// کانتکست و رندر از `bots/tarot/reading-core.js`، و شرطِ پذیرش از همان‌جا + `verdict.js`
// می‌آید. یعنی هر چیزی که این‌جا می‌بینی دقیقاً همان چیزی است که کاربر می‌بیند.
//
// ⚠️ هزینه: هر فال یک فراخوانیِ واقعیِ OpenRouter است و روی **کلیدِ خودِ تاروت** می‌نشیند
// (همان `OPENROUTER_API_KEY`). یک فالِ سه‌کارتی حدود ۰.۶ سنت و صلیب سلتی حدود ۱.۳ سنت.
//
// اجرا:
//   node tools/reading-lab.mjs --dry              # بدونِ فراخوانی: فقط اندازه‌ی ورودی و سلامتِ خطِ لوله
//   node tools/reading-lab.mjs                    # اجرای کاملِ همه‌ی پرسوناها
//   node tools/reading-lab.mjs --only P1,P2       # فقط چند پرسونا
//   node tools/reading-lab.mjs --out out.json     # ذخیره‌ی خامِ همه‌چیز برای مقایسه‌ی دورِ بعد
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPREAD_BY_ID } from '../bots/tarot/spreads.js';
import { CARD_BY_KEY } from '../bots/tarot/cards.js';
// ⚠️ سنجه‌ها که به checks.mjs منتقل شدند، این import با آن‌ها رفت — ولی خودِ آزمایشگاه
// هنوز در شرطِ پذیرشِ ریکوئست و در probe از آن استفاده می‌کند. نتیجه: ReferenceError
// داخلِ callbackِ validate که orChatResilient به‌عنوان «خطای LLM» می‌بلعید، پس هر ۴۵
// تلاش شکست خورد و کلِ دور با صفر فال تمام شد (درسِ decideReceipt، بارِ دوم).
import { headlineOk } from '../bots/tarot/verdict.js';
import { repairEvasion } from '../bots/tarot/repair.js';
import {
  drawCards, buildReadingCtx, renderV4, checkV4Shape,
  orChat, orChatResilient, parseJsonLoose,
} from '../bots/tarot/reading-core.js';
// سنجه‌ها در ماژولِ خالصِ جدا هستند تا بدونِ اجرای پولی تست شوند
import { checkReading, modelText, ngrams } from './reading-lab/checks.mjs';

const L = (await import('../bots/tarot/locales/fa.js')).default;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag('dry');
// حالتِ fake: کلِ خطِ لوله **واقعاً** اجرا می‌شود (ساختِ پرامپت، callbackِ validate،
// رندر، همه‌ی سنجه‌ها، گزارش) ولی پاسخ از یک استابِ محلی می‌آید نه از شبکه.
// چرا لازم شد: `--dry` قبل از validate برمی‌گردد، پس مسیرِ پذیرش/رندر/سنجش را اصلاً
// لمس نمی‌کند. یک importِ جامانده (`headlineOk`) دقیقاً همان‌جا پنهان ماند، داخلِ
// try/catch به‌عنوان «خطای LLM» بلعیده شد، و کلِ دورِ چهارم با ۴۵ ریکوئستِ هدررفته و
// صفر فال تمام شد. با `--fake` همان باگ در دو ثانیه و با صفر هزینه پیدا می‌شود.
const FAKE = flag('fake');
const ONLY = (val('only', '') || '').split(',').filter(Boolean);
const OUT = val('out', '');

const SCEN = JSON.parse(fs.readFileSync(path.join(HERE, 'reading-lab', 'scenarios.json'), 'utf8'));

/* ═══════════════ استابِ پاسخِ مدل (حالتِ fake) ═══════════════ */
// خروجیِ ساختگی ولی **معتبر**: باید از checkV4Shape و headlineOk رد شود تا مسیرِ
// «پذیرش» اجرا شود. متنش عمداً به کارت‌ها و سؤال لنگر می‌خورد تا سنجه‌ها هم کار کنند.
function fakeOut(spread, cards, ctx) {
  const names = cards.map(c => CARD_BY_KEY[c.key].fa);
  const q = String(ctx.question || '').split(/\s+/).slice(0, 3).join(' ');
  return JSON.stringify({
    cards: names.map(n => ({ teaser: `کارتِ ${n}، کارتِ نمونه است. تصویرش یک صحنه‌ی ساختگی دارد.` })),
    headline: `بله با احتمالِ زیاد پیش می‌ره، ولی باید بهای صبر رو بدی.`,
    pattern: `ترکیبِ ${names[0]} و ${names[names.length - 1]} درباره‌ی «${q}» یک جهت نشان می‌دهد.`,
    reads: names.map(n => ({ text: `${n} می‌گه این بخش از «${q}» دارد جابه‌جا می‌شود.` })),
    callback: (ctx.previous || []).length ? `دفعه‌ی قبل هم حولِ همین موضوع بودی.` : '',
    // ⚠️ عمداً در **یک** چیدمانِ مشخص طفره‌رفتن تزریق می‌شود تا حالتِ fake کلِ مسیرِ
    // تعمیر را واقعاً اجرا کند (تشخیص، فراخوانی، اعتبارسنجی، جایگذاری). بدونِ این،
    // `--fake` سبز رد می‌شد در حالی که آن مسیر هرگز لمس نشده بود — همان اشتباهی که
    // یک بار با `--dry` تکرار شد و یک دورِ ۹ فالی را سوزاند.
    closing: spread.id === 'yesno'
      ? `در کل، «${q}» بستگی داره به خودت، ولی ${names[0]} می‌گه صبر کن.`
      : `در کل، «${q}» تو این چند هفته روشن‌تر می‌شه، ولی به شرطی که ${names[0]} را جدی بگیری.`,
    summary: 'خلاصه‌ی ساختگی', memory: 'حافظه‌ی ساختگی',
  });
}

// استابِ تعمیر در حالتِ fake: خروجیِ معتبر می‌دهد تا کلِ مسیرِ تعمیر (پارس، اعتبارسنجی،
// جایگذاری) واقعاً اجرا شود، بدونِ شبکه. تعدادِ fixes از خودِ ورودی شمرده می‌شود.
function fakeRepair(sys, usr, opts) {
  const n = (usr.match(/^\d+\)/gm) || []).length || 1;
  const out = JSON.stringify({ fixes: Array.from({ length: n }, () => 'بیشتر به این سمت می‌خوره که پیش بره، ولی صبر می‌خواد.') });
  return opts.validate(out) ? { out, model: 'fake', attempts: 1, usages: [{ prompt_tokens: 0, completion_tokens: 0 }] } : null;
}

/* ═══════════════ اجرای یک فال ═══════════════ */
async function runStep(persona, step, i, state) {
  const spread = SPREAD_BY_ID[step.spread];
  if (!spread) throw new Error(`چیدمانِ ناشناخته: ${step.spread}`);
  // seed ثابت per قدم: اجرای دوباره **همان کارت‌ها** را می‌کشد، پس وقتی پرامپت را عوض
  // می‌کنیم تفاوتِ خروجی فقط از پرامپت می‌آید نه از شانسِ کارت. این ستونِ فقراتِ مقایسه است.
  const seed = `lab:${persona.id}:${i}`;
  const cards = drawCards(seed, step.picks || [0, 1, 2], spread.size);

  state.nowSec += (step.afterMinutes || 0) * 60;
  const user = { telegram_id: 900000 + i, memory_json: state.memory, focus_area: persona.focus };
  const ctx = buildReadingCtx({
    user, spread, question: step.question, cards, focusKey: persona.focus, L,
    name: persona.name,
    kbOn: true,                 // لحنِ جدید برای همه روشن است (toneV2)
    prev: state.prev.slice(0, 4),
  });

  const labels = L.prompts.cardLabels(cards.length);
  const system = L.prompts.readerSystemV4(spread, labels);
  const userMsg = L.prompts.readingContext(ctx);
  const inputChars = system.length + userMsg.length;

  if (DRY) return { spread, cards, ctx, inputChars, dry: true };

  let parsed = null, fallback = null;
  // در حالتِ fake همان callbackِ validate اجرا می‌شود، فقط ورودی‌اش از استاب می‌آید.
  const call = FAKE
    ? (sys, usr, opts) => {
        const out = fakeOut(spread, cards, ctx);
        return opts.validate(out)
          ? { out, model: 'fake', attempts: 1, usages: [{ prompt_tokens: 0, completion_tokens: 0 }] }
          : null;
      }
    : orChatResilient;
  const res = await call(system, userMsg, {
    maxTokens: spread.maxTokens,
    validate: (out) => {
      const obj = parseJsonLoose(out);
      if (!checkV4Shape(obj, cards.length)) return false;
      if (!headlineOk(obj.headline)) { fallback = obj; return false; }
      parsed = obj;
      return true;
    },
  });
  if (!parsed && fallback) parsed = fallback;
  if (!parsed) return { spread, cards, ctx, inputChars, failed: true };

  // تعمیرِ نقطه‌ای — **همان کدِ ربات**. اینجا اجرا می‌شود تا آزمایشگاه دقیقاً همان
  // چیزی را بسنجد که کاربر می‌گیرد، و هزینه/تأخیرِ واقعیِ این مسیر اندازه گرفته شود.
  const t0 = Date.now();
  const rep = await repairEvasion(parsed, FAKE ? fakeRepair : orChatResilient,
    { tag: `${persona.id}.${i + 1}` });
  parsed = rep.llm;
  const repair = { fired: rep.repaired || !!rep.usage, ms: Date.now() - t0, usage: rep.usage || null };

  const rendered = renderV4(parsed, cards, labels);
  // اگر خودِ سنجه خطا داد، اجرا نباید بمیرد: فال‌های قبلی پول خرج کرده‌اند و نتیجه‌شان
  // نباید بابتِ یک باگِ ابزار از بین برود (درسِ کرشِ اجرای دوم).
  let check;
  try {
    check = checkReading({ llm: parsed, rendered, spread, cards, ctx, L });
  } catch (e) {
    check = { issues: [`خطای خودِ سنجه: ${e.message}`], notes: [], stats: { chars: 0, perCard: 0, named: 0, cards: cards.length } };
  }

  // حافظه و تاریخچه دقیقاً مثل ربات به قدمِ بعد منتقل می‌شوند
  if (typeof parsed.memory === 'string' && parsed.memory.trim()) state.memory = parsed.memory.trim().slice(0, 1200);
  state.prev.unshift({
    created_at: state.nowSec, type: spread.id,
    summary: String(parsed.summary || '').slice(0, 300), feedback: '-',
  });

  return {
    spread, cards, ctx, inputChars, llm: parsed, rendered, check, repair,
    model: res?.model, attempts: res?.attempts,
    usage: (res?.usages || []).reduce((a, u) => ({
      in: a.in + (u?.prompt_tokens || 0), out: a.out + (u?.completion_tokens || 0),
    }), { in: 0, out: 0 }),
    // هزینه‌ی تعمیر **جدا** شمرده می‌شود، وگرنه در هزینه‌ی کلی گم می‌شود و
    // نمی‌فهمیم این مسیر واقعاً ارزان است یا فقط ادعا کرده‌ایم.
    repairUsage: { in: rep.usage?.prompt_tokens || 0, out: rep.usage?.completion_tokens || 0 },
  };
}

/* ═══════════════ حالتِ probe: «چقدر متداول است و روی کدام فال؟» ═══════════════ */
// چرا لازم شد: اولین اجرا نشان داد در ۲ فال از ۹ بلوکِ کارت‌ها غایب می‌شود. سؤالِ درستِ
// بعدی «چطور وصله‌اش کنیم» نیست، «چند وقت یک‌بار و روی کدام چیدمان» است. بدونِ این عدد
// نمی‌شود تصمیم گرفت که آیا ارزشِ دو-ریکوئستی‌کردنِ چیدمانِ بزرگ را دارد یا نه.
//
// ⚠️ عمداً `orChat` را **خام** صدا می‌زند نه `orChatResilient`: رتراییِ خودکار دقیقاً همان
// چیزی را پنهان می‌کند که می‌خواهیم بشماریم. هر نمونه = یک تلاشِ اول، مثل چیزی که
// کاربر در بهترین حالت می‌گیرد.
const SHAPE = (obj, n) => {
  if (!obj) return 'JSON خراب';
  if (!Array.isArray(obj.reads)) return 'reads نیست';
  if (obj.reads.length < n) return `reads کوتاه (${obj.reads.length}/${n})`;
  const sample = obj.reads.slice(0, n);
  const withText = sample.filter(r => r && typeof r === 'object' && String(r.text || '').trim()).length;
  const strings = sample.filter(r => typeof r === 'string' && r.trim()).length;
  if (withText === n) return 'سالم: [{text}]';
  if (strings === n) return 'آرایه‌ی رشته';
  if (withText + strings === 0) return '🔴 همه خالی';
  return `مخلوط (${withText} شیء + ${strings} رشته)`;
};

async function probe(reps) {
  // چهار اندازه‌ی مختلف تا معلوم شود مسئله مالِ صلیب سلتی است یا سراسری
  const targets = ['yesno', 'three', 'open5', 'celtic'];
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`🔬 probe — هر چیدمان ${reps} بار، تلاشِ اول، بدونِ retry`);
  console.log('═'.repeat(72));
  const rows = [];
  for (const id of targets) {
    const spread = SPREAD_BY_ID[id];
    const tally = {}; let okShape = 0, okHeadline = 0, outTok = 0, trunc = 0;
    for (let k = 0; k < reps; k++) {
      const cards = drawCards(`probe:${id}:${k}`, [k % 24, (k + 7) % 24, (k + 13) % 24], spread.size);
      const ctx = buildReadingCtx({
        user: { telegram_id: 1, memory_json: '', focus_area: spread.focus || 'question' },
        spread, question: 'این روزها حس می‌کنم سرِ یه دوراهیِ مهمم و نمی‌دونم کدوم طرف برم.',
        cards, focusKey: spread.focus || 'question', L, name: 'آرش', kbOn: true, prev: [],
      });
      const labels = L.prompts.cardLabels(cards.length);
      let out = null, usage = {};
      try {
        const r = await orChat(L.prompts.readerSystemV4(spread, labels), L.prompts.readingContext(ctx),
          { maxTokens: spread.maxTokens });
        out = r.text; usage = r.usage || {};
      } catch (e) { tally['خطای شبکه'] = (tally['خطای شبکه'] || 0) + 1; continue; }
      const obj = parseJsonLoose(out);
      const shape = SHAPE(obj, spread.size);
      tally[shape] = (tally[shape] || 0) + 1;
      if (checkV4Shape(obj, spread.size)) okShape++;
      if (obj && headlineOk(obj.headline)) okHeadline++;
      outTok += usage.completion_tokens || 0;
      // بریدگیِ خروجی: اگر به سقفِ توکن خورده باشیم مسئله «شکلِ خروجی» نیست، «جا نشدن» است
      if ((usage.completion_tokens || 0) >= spread.maxTokens - 40) trunc++;
    }
    rows.push({ id, fa: spread.fa, size: spread.size, okShape, okHeadline, reps, tally,
      avgOut: Math.round(outTok / reps), max: spread.maxTokens, trunc });
  }
  console.log('\nچیدمان            کارت  شکلِ سالم  سرخطِ سالم  میانگینِ توکنِ خروجی (سقف)  بریدگی');
  for (const r of rows) {
    console.log(`${r.fa.padEnd(20)}${String(r.size).padEnd(6)}${`${r.okShape}/${r.reps}`.padEnd(11)}`
      + `${`${r.okHeadline}/${r.reps}`.padEnd(12)}${`${r.avgOut} (${r.max})`.padEnd(27)}${r.trunc}/${r.reps}`);
  }
  console.log('\nتوزیعِ شکلِ `reads`:');
  for (const r of rows) {
    const parts = Object.entries(r.tally).map(([k, v]) => `${k} ×${v}`).join('  |  ');
    console.log(`   ${r.fa}: ${parts}`);
  }
  const bad = rows.filter(r => r.okShape < r.reps);
  console.log(`\nحکم: ${bad.length ? bad.map(r => `${r.fa} (${r.reps - r.okShape} از ${r.reps} خراب)`).join('، ') : 'هیچ چیدمانی خرابی نداشت'}`);
  return rows;
}

if (flag('probe')) {
  await probe(parseInt(val('reps', '5'), 10));
  process.exit(0);
}

/* ═══════════════ اجرا ═══════════════ */
const personas = SCEN.personas.filter(p => !ONLY.length || ONLY.includes(p.id));
const all = [];

// چند **پاسِ کامل** روی همان سناریوها با همان کارت‌ها. تنها متغیرِ بین پاس‌ها
// نمونه‌برداریِ خودِ مدل است، یعنی دقیقاً همان نویزی که می‌خواهیم اندازه بگیریم.
//
// چرا اضافه شد (یافته‌ی دورِ هفتم، ۱۴۰۵/۰۵/۲۷): دور ۶ و دور ۷ **پرامپتِ یکسان**
// داشتند و متریکِ جمله‌ی بی‌لنگر ۲۲٪ و ۲۸٪ شد. یعنی یک اجرای ۹ فالی حدودِ ۶ واحد
// نویز دارد و هر «بهبودِ» کوچک‌تر از آن بی‌معناست — همان‌طور که «بهبودِ» ۲۴٪→۲۲٪
// دورِ پنجم در واقع نویز بود. بدونِ این پرچم، لوپِ بهبود دارد به خودش دروغ می‌گوید.
const REPS = Math.max(1, parseInt(val('reps', '1'), 10));

for (let rep = 0; rep < REPS; rep++) {
if (REPS > 1) {
  console.log(`\n${'█'.repeat(72)}`);
  console.log(`🔁 پاسِ ${rep + 1} از ${REPS} (همان کارت‌ها، همان پرامپت)`);
  console.log('█'.repeat(72));
}
for (const persona of personas) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`👤 ${persona.id} — ${persona.name}  (تمرکز: ${persona.focus})`);
  console.log(`   ${persona.why}`);
  console.log('═'.repeat(72));

  // کاربرِ کاملاً جدید: حافظه‌ی خالی، بدونِ هیچ فالِ قبلی
  const state = { memory: '', prev: [], nowSec: Math.floor(Date.now() / 1000) };

  for (let i = 0; i < persona.steps.length; i++) {
    const step = persona.steps[i];
    const r = await runStep(persona, step, i, state);
    all.push({ persona: persona.id, i, rep, step, ...r });

    const head = `\n── ${persona.id}.${i + 1} «${r.spread.fa}» (${r.spread.size} کارت) ${step.afterMinutes ? `+${step.afterMinutes} دقیقه` : 'قدمِ اول'}`;
    console.log(head);
    console.log(`   سؤال: ${step.question}`);
    console.log(`   چالش: ${step.expect}`);
    console.log(`   کارت‌ها: ${r.cards.map(c => c.key + (c.reversed ? '↕' : '')).join(', ')}`);
    console.log(`   ورودیِ مدل: ${r.inputChars} کاراکتر ≈ ${Math.round(r.inputChars / 2.2)} توکن` +
      (r.ctx.previous.length ? ` | فال‌های قبلی: ${r.ctx.previous.map(p => p['چه‌وقت']).join(' / ')}` : ' | بدونِ سابقه'));
    if (r.dry) continue;
    if (r.failed) { console.log('   ❌ همه‌ی تلاش‌ها شکست خورد (مسیرِ REFUND)'); continue; }

    console.log(`   مدل: ${r.model} | تلاش: ${r.attempts} | توکن in/out: ${r.usage.in}/${r.usage.out}`);
    console.log('\n' + '┄'.repeat(72));
    console.log('🎴 تیزرها (چیزی که کاربر هنگام رو شدنِ هر کارت می‌بیند):');
    (r.llm.cards || []).slice(0, r.cards.length).forEach((c, k) => console.log(`   ${k + 1}) ${c?.teaser || '—'}`));
    console.log('\n📩 متنِ نهایی (عیناً همان سه پیامی که کاربر می‌گیرد):');
    console.log(r.rendered.headline);
    console.log('');
    console.log(r.rendered.body);
    console.log('');
    console.log(r.rendered.closing);
    console.log('┄'.repeat(72));

    const { issues, notes, stats } = r.check;
    const a = r.check.anchor || { loose: 0, total: 0, pct: 0, samples: [] };
    console.log(`\n   📏 ${stats.chars} کاراکتر | ${stats.perCard} کاراکتر per کارت | ${stats.named}/${stats.cards} کارت با نامِ خودش صدا زده شد`);
    console.log(`   🎯 جمله‌ی بی‌لنگر: ${a.loose}/${a.total} (${a.pct}٪)` + (a.samples.length ? ` — نمونه: «${a.samples[0]}»` : ''));
    if (issues.length) { console.log('   ❌ ایرادها:'); issues.forEach(x => console.log(`      - ${x}`)); }
    else console.log('   ✅ همه‌ی سنجه‌های قطعی سبز');
    if (notes.length) { console.log('   ⚠️ نکته‌ها:'); notes.forEach(x => console.log(`      - ${x}`)); }
  }
}
}

/* ═══════════════ تکرارِ بین‌فالی: مهم‌ترین سنجه ═══════════════ */
// تحقیق ۱ دلیلِ شماره‌یکِ رهاکردنِ محصولاتِ AI را «تکراری و قالبی» می‌داند، و دو بار هم
// همین‌جا نشتِ few-shot دیدیم. یک فال به‌تنهایی هرگز این را لو نمی‌دهد؛ فقط کنارِ هم
// گذاشتنِ چند فال نشان می‌دهد کدام جمله دارد از پرامپت تکرار می‌شود.
if (!DRY) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log('🔁 تکرارِ بین‌فالی (متنی که در بیش از یک فال عیناً آمده)');
  console.log('═'.repeat(72));
  const done = all.filter(r => r.llm);
  // ⚠️ مقایسه فقط **داخلِ هر پاس**. اگر پاس‌ها با هم مخلوط شوند، همان سناریو با همان
  // کارت‌ها در دو پاس طبیعتاً شبیهِ خودش درمی‌آید و عددِ تکرار را الکی باد می‌کند.
  const repsSeen = [...new Set(done.map(r => r.rep))].sort();
  const perRep = [];
  for (const rp of repsSeen) {
    const seen = new Map();
    for (const r of done.filter(x => x.rep === rp)) {
      for (const g of new Set(ngrams(modelText(r.llm), 6))) {
        if (!seen.has(g)) seen.set(g, new Set());
        seen.get(g).add(`${r.persona}.${r.i + 1}`);
      }
    }
    const rr = [...seen.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size);
    perRep.push(rr);
    if (repsSeen.length > 1) console.log(`\n   ── پاسِ ${rp + 1}: ${rr.length} تکرار`);
    if (!rr.length) console.log('   ✅ هیچ ۶کلمه‌ای در دو فالِ متفاوت تکرار نشده');
    else for (const [g, s] of rr.slice(0, repsSeen.length > 1 ? 8 : 25)) console.log(`      [${[...s].join(', ')}] «${g}»`);
  }
  const repeatCounts = perRep.map(x => x.length);

  console.log(`\n${'═'.repeat(72)}`);
  console.log('📊 جمع‌بندی');
  console.log('═'.repeat(72));
  const tokIn = done.reduce((a, r) => a + r.usage.in, 0), tokOut = done.reduce((a, r) => a + r.usage.out, 0);
  const bad = done.filter(r => r.check.issues.length);
  console.log(`   فال‌ها: ${done.length} | با ایراد: ${bad.length} | تلاشِ اضافه: ${done.reduce((a, r) => a + (r.attempts - 1), 0)}`);
  // متریکِ کیفیِ اصلی برای مقایسه‌ی دورها: چند درصد از جمله‌ها به هیچ چیزِ مخصوصِ
  // همین فال گره نخورده‌اند. هرچه کمتر، خوانش شخصی‌تر و کمتر Barnum.
  const lo = done.reduce((s, r) => s + (r.check.anchor?.loose || 0), 0);
  const to = done.reduce((s, r) => s + (r.check.anchor?.total || 0), 0);
  console.log(`   🎯 جمله‌ی بی‌لنگر در کلِ دور: ${lo}/${to} (${to ? Math.round(lo * 100 / to) : 0}٪)`);
  // پراکندگیِ بین پاس‌ها = واحدِ سنجشِ نویز. بدونِ این عدد نمی‌شود فهمید یک تفاوتِ
  // چندواحدی «بهبود» است یا فقط شانسِ نمونه‌برداریِ مدل (یافته‌ی دورِ هفتم).
  if (repsSeen.length > 1) {
    const pcts = repsSeen.map(rp => {
      const d = done.filter(x => x.rep === rp);
      const l = d.reduce((s, r) => s + (r.check.anchor?.loose || 0), 0);
      const t = d.reduce((s, r) => s + (r.check.anchor?.total || 0), 0);
      return t ? Math.round(l * 100 / t) : 0;
    });
    const badPer = repsSeen.map(rp => done.filter(x => x.rep === rp && x.check.issues.length).length);
    console.log(`      per پاس: ${pcts.map(x => x + '٪').join(' , ')}  (دامنه ${Math.min(...pcts)} تا ${Math.max(...pcts)})`);
    console.log(`   🔁 تکرارِ بین‌فالی per پاس: ${repeatCounts.join(' , ')}`);
    console.log(`   ❌ فالِ ایرادناک per پاس: ${badPer.join(' , ')}`);
  }
  console.log(`   توکن: ${tokIn} ورودی + ${tokOut} خروجی ≈ $${(tokIn / 1e6 * 0.30 + tokOut / 1e6 * 2.50).toFixed(4)}`);
  // مسیرِ تعمیر جدا گزارش می‌شود: چند بار شلیک کرد، چقدر طول کشید، چقدر خرج برداشت.
  // هر سه عدد لازم است — «ارزان» بدونِ تأخیر بی‌معناست و برعکس.
  {
    const fired = done.filter(r => r.repair?.fired);
    const rin = done.reduce((a, r) => a + (r.repairUsage?.in || 0), 0);
    const rout = done.reduce((a, r) => a + (r.repairUsage?.out || 0), 0);
    const msList = fired.map(r => r.repair.ms).sort((a, b) => a - b);
    const cost = rin / 1e6 * 0.30 + rout / 1e6 * 2.50;
    console.log(`   🔧 تعمیرِ نقطه‌ای: ${fired.length}/${done.length} فال` +
      (fired.length ? ` | تأخیر ${msList[0]} تا ${msList[msList.length - 1]}ms` +
        ` | توکن ${rin}+${rout} ≈ $${cost.toFixed(5)} (per فالِ کلِ دور: $${(cost / done.length).toFixed(6)})` : ''));
  }
  // متنِ ایراد و درصدِ لنگرِ هر فال **همین‌جا** چاپ می‌شود، نه فقط بالاتر در بلوکِ خودش.
  // دلیلِ عملیاتی: خواندنِ لاگِ Actions فقط از **انتها** ممکن است و بلوکِ هر فال ده‌ها
  // خط است؛ بدونِ این خلاصه برای فهمیدنِ «کدام فال چه ایرادی داشت» باید کلِ لاگ خوانده
  // شود. با این خلاصه، ۳۰ خطِ آخر برای نتیجه‌گیریِ یک دور کافی است.
  for (const r of done) {
    const n = r.check.issues.length;
    const a = r.check.anchor;
    const pct = a?.total ? ` | بی‌لنگر ${a.loose}/${a.total}` : '';
    const tag = repsSeen.length > 1 ? `پ${r.rep + 1} ` : '';
    console.log(`   ${n ? '❌' : '✅'} ${tag}${r.persona}.${r.i + 1} ${r.spread.fa}${pct}`);
    r.check.issues.forEach(x => console.log(`        ↳ ${x}`));
  }
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(all.map(r => ({
    persona: r.persona, step: r.i, rep: r.rep, spread: r.spread?.id, question: r.step?.question,
    cards: r.cards?.map(c => c.key + (c.reversed ? '↕' : '')),
    inputChars: r.inputChars, llm: r.llm, rendered: r.rendered, check: r.check,
  })), null, 2));
  console.log(`\n💾 خروجیِ خام: ${OUT}`);
}
