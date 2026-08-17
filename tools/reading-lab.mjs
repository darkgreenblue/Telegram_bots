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
const ONLY = (val('only', '') || '').split(',').filter(Boolean);
const OUT = val('out', '');

const SCEN = JSON.parse(fs.readFileSync(path.join(HERE, 'reading-lab', 'scenarios.json'), 'utf8'));

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
  const res = await orChatResilient(system, userMsg, {
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
    spread, cards, ctx, inputChars, llm: parsed, rendered, check,
    model: res?.model, attempts: res?.attempts,
    usage: (res?.usages || []).reduce((a, u) => ({
      in: a.in + (u?.prompt_tokens || 0), out: a.out + (u?.completion_tokens || 0),
    }), { in: 0, out: 0 }),
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
    all.push({ persona: persona.id, i, step, ...r });

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
    console.log(`\n   📏 ${stats.chars} کاراکتر | ${stats.perCard} کاراکتر per کارت | ${stats.named}/${stats.cards} کارت با نامِ خودش صدا زده شد`);
    if (issues.length) { console.log('   ❌ ایرادها:'); issues.forEach(x => console.log(`      - ${x}`)); }
    else console.log('   ✅ همه‌ی سنجه‌های قطعی سبز');
    if (notes.length) { console.log('   ⚠️ نکته‌ها:'); notes.forEach(x => console.log(`      - ${x}`)); }
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
  const seen = new Map();
  for (const r of done) {
    for (const g of new Set(ngrams(modelText(r.llm), 6))) {
      if (!seen.has(g)) seen.set(g, new Set());
      seen.get(g).add(`${r.persona}.${r.i + 1}`);
    }
  }
  const repeats = [...seen.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size);
  if (!repeats.length) console.log('   ✅ هیچ ۶کلمه‌ای در دو فالِ متفاوت تکرار نشده');
  else {
    console.log(`   ❌ ${repeats.length} تکرار:`);
    for (const [g, s] of repeats.slice(0, 25)) console.log(`      [${[...s].join(', ')}] «${g}»`);
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log('📊 جمع‌بندی');
  console.log('═'.repeat(72));
  const tokIn = done.reduce((a, r) => a + r.usage.in, 0), tokOut = done.reduce((a, r) => a + r.usage.out, 0);
  const bad = done.filter(r => r.check.issues.length);
  console.log(`   فال‌ها: ${done.length} | با ایراد: ${bad.length} | تلاشِ اضافه: ${done.reduce((a, r) => a + (r.attempts - 1), 0)}`);
  console.log(`   توکن: ${tokIn} ورودی + ${tokOut} خروجی ≈ $${(tokIn / 1e6 * 0.30 + tokOut / 1e6 * 2.50).toFixed(4)}`);
  for (const r of done) {
    const n = r.check.issues.length;
    console.log(`   ${n ? '❌' : '✅'} ${r.persona}.${r.i + 1} ${r.spread.fa}${n ? ` — ${n} ایراد` : ''}`);
  }
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(all.map(r => ({
    persona: r.persona, step: r.i, spread: r.spread?.id, question: r.step?.question,
    cards: r.cards?.map(c => c.key + (c.reversed ? '↕' : '')),
    inputChars: r.inputChars, llm: r.llm, rendered: r.rendered, check: r.check,
  })), null, 2));
  console.log(`\n💾 خروجیِ خام: ${OUT}`);
}
