#!/usr/bin/env node
// تولیدِ propsِ یک فالِ **ناشناس** برای ویدیوی ریل: سوال از صفِ نوشن، فال از همان کدی که
// ربات استفاده می‌کند، و خروجی یک فایلِ JSON که کامپوزیشنِ Remotion مصرفش می‌کند.
//
// ⚠️ فال عمداً ناشناس است: نه نامِ کسی به مدل می‌رود (`hideName`, `name: ''`)، نه حافظه‌ای
// (`memory_json: ''`, `prev: []`). خروجی قرار است در اینستاگرام **عمومی** منتشر شود و
// هیچ تکه‌ای از دیتای یک کاربرِ واقعی نباید داخلش باشد (بند ۹ ریشه). سوال‌ها را هم خودِ
// مالک در نوشن می‌نویسد، پس سوالِ واقعیِ هیچ کاربری منتشر نمی‌شود.
//
// ⚠️ علامت‌زدنِ ردیفِ نوشن **این‌جا انجام نمی‌شود**. اگر همین‌جا علامت می‌خورد، هر شکستِ
// رندر یک سوال را برای همیشه می‌سوزاند. آن کار فقط بعد از ارسالِ موفقِ ویدیو در
// `deliver.mjs` انجام می‌شود.
//
// اجرا:
//   node tools/tarot-video/generate.mjs --fake --out /tmp/props.json     صفر شبکه، صفر هزینه
//   node tools/tarot-video/generate.mjs --out props.json                 سوال از صفِ نوشن
//   node tools/tarot-video/generate.mjs --question "متن سوال" --out p.json
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPREAD_BY_ID } from '../../bots/tarot/spreads.js';
import { headlineOk } from '../../bots/tarot/verdict.js';
import { repairDefects } from '../../bots/tarot/repair.js';
import {
  drawCards, buildReadingCtx, checkV4Shape, orChatResilient, parseJsonLoose,
} from '../../bots/tarot/reading-core.js';
import { createNotion, notionErrorFa } from './notion.mjs';
import { buildProps, validateProps, BACKGROUNDS } from './props.mjs';
import { stageCards, REPO_ROOT } from './stage-assets.mjs';

const L = (await import('../../bots/tarot/locales/fa.js')).default;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(path.join(HERE, 'config.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? d) : d; };

const FAKE = flag('fake');
const OUT = val('out', 'props.json');
const Q_OVERRIDE = val('question', '').trim();
const SPREAD_ARG = val('spread', '').trim();
const BG_ARG = val('background', '').trim();
const DB_ARG = val('db', '').trim();

// سوالِ نمونه‌ی ثابت برای `--fake`: عمداً ثابت است تا خروجیِ حالتِ تست بینِ دو اجرا
// یکی بماند و مقایسه‌ی چشمیِ ویدیو معنی داشته باشد.
const FAKE_QUESTION = 'این مسیری که انتخاب کردم درست پیش می‌ره؟';

const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };
// نامِ فلگ از یک تابع می‌آید و نه مستقیم داخلِ متنِ فارسی. دلیل: قاعده‌ی بند ۱۰ ریشه
// خطِ تیره را در متنِ رو-به-کاربر ممنوع می‌کند و سنجه‌های خودکار نمی‌توانند «نشانه‌گذاری»
// را از «نامِ فلگ» تشخیص بدهند. این‌طوری پیام نامِ واقعیِ فلگ را می‌گوید بدونِ ابهام.
const cli = (n) => `--${n}`;

/** خروجیِ جاب برای گیت‌هاب اکشنز. بیرونِ اکشنز بی‌صدا رد می‌شود. */
function ghOutput(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { appendFileSync(f, `${key}=${value}\n`); }
  catch (e) { console.error(`⚠️ نوشتن در GITHUB_OUTPUT نشد: ${e.message}`); }
}

/* ═══════════════ اطلاع‌رسانی به ادمین‌ها ═══════════════ */
// صفِ خالی یک **خرابی نیست**، یک خبر است: جاب باید سبز بماند وگرنه هر روز یک هشدارِ
// کاذب می‌آید و کسی دیگر هشدارها را جدی نمی‌گیرد. پس فقط به مالک پیام می‌رود.
const admins = () => String(process.env.OWNER_TELEGRAM_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function tellAdmins(text) {
  const token = process.env.TAROT_BOT_TOKEN;
  const ids = admins();
  if (!token || !ids.length) { console.log('ℹ️ توکن یا آی‌دی ادمین ست نیست؛ پیام فرستاده نشد'); return; }
  for (const chatId of ids) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      const json = await res.json().catch(() => ({ ok: false, description: 'پاسخ غیر JSON' }));
      if (!json.ok) console.error(`⚠️ پیام به ${chatId} نرسید: ${json.description}`);
    } catch (e) {
      console.error(`⚠️ پیام به ${chatId} نرسید: ${e.message}`);
    }
  }
}

/* ═══════════════ منبعِ سوال ═══════════════ */
/**
 * سه مسیر، به همین ترتیب: فلگِ دستی (بدونِ نوشن و بدونِ مصرفِ صف)، صفِ نوشن، و در
 * نبودِ هر دو فقط در حالتِ `--fake` یک سوالِ نمونه.
 */
async function pickQuestion() {
  if (Q_OVERRIDE) {
    console.log(`📝 سوال از فلگِ ${cli('question')}؛ نوشن اصلاً صدا زده نشد`);
    return { pageId: '', question: Q_OVERRIDE, topicKey: '', background: '' };
  }

  const token = process.env.NOTION_TOKEN || process.env.TAROT_VIDEO_NOTION_TOKEN || '';
  const notion = createNotion({ token });
  if (!notion) {
    if (FAKE) {
      console.log('🧪 حالتِ fake بدونِ توکنِ نوشن: سوالِ نمونه استفاده می‌شود');
      return { pageId: '', question: FAKE_QUESTION, topicKey: '', background: '' };
    }
    fail('توکنِ Notion ست نیست (NOTION_TOKEN). بدونِ آن صفِ سوال خوانده نمی‌شود.');
  }

  const dbId = DB_ARG || process.env.NOTION_DB_ID || CONFIG.notionDatabaseId || '';
  if (!dbId) fail('آی‌دیِ دیتابیسِ Notion نه در config.json هست نه در NOTION_DB_ID');

  let row = null;
  try {
    row = await notion.oldestUnused(dbId);
  } catch (e) {
    // پیامِ خامِ انگلیسیِ API به کسی کمک نمی‌کند؛ `notionErrorFa` می‌گوید دقیقاً چه کاری لازم است.
    fail(notionErrorFa(e));
  }

  if (!row) {
    // صف خالی: خبر می‌دهیم، به جاب می‌گوییم رد شود، و سبز تمام می‌کنیم.
    console.log('📭 صفِ سوال‌های نوشن خالی است');
    await tellAdmins('صفِ سوال‌های ویدیوی تاروت خالی شد. یک سوالِ تازه در نوشن اضافه کن تا ویدیوی بعدی ساخته شود.');
    ghOutput('skip', 'true');
    process.exit(0);
  }
  console.log(`📥 سوال از نوشن: «${row.question}» | موضوع: ${row.topicKey} | صفحه: ${row.pageId}`);
  return row;
}

/* ═══════════════ چیدمان و پس‌زمینه ═══════════════ */
/**
 * چیدمانِ این ویدیو.
 *
 * ⚠️ موضوعِ نوشن **همیشه** به آی‌دیِ نسل چهارم (`<topic>3`) می‌رود، نه به `SPREAD_BY_ID[topic]`.
 * دلیل: کلیدِ موضوع با آی‌دیِ یک چیدمانِ نسلِ قدیم هم‌نام است (`career`, `love`, `money`)
 * و آن رکوردهای قدیمی جایگاه و اندازه‌ی دیگری دارند. بدونِ این قاعده، «شغل» بی‌صدا به
 * چیدمانِ بازنشسته می‌افتاد و کسی تا دیدنِ خودِ ویدیو نمی‌فهمید.
 *
 * `--spread` عمداً بازتر است: هم آی‌دیِ کامل (`career3`) را می‌پذیرد هم کلیدِ موضوع.
 */
function resolveSpread(topicKey) {
  // ترتیبِ ترجیح در فلگ هم عمدی است: اول `<arg>3` و بعد خودِ `arg`. اگر برعکس بود،
  // `--spread money` به همان چیدمانِ بازنشسته می‌رسید که بالا توضیح داده شد.
  const id = SPREAD_ARG
    ? (SPREAD_BY_ID[`${SPREAD_ARG}3`] ? `${SPREAD_ARG}3` : SPREAD_ARG)
    : `${topicKey || 'personal'}3`;
  const spread = SPREAD_BY_ID[id];
  if (!spread) fail(`چیدمانِ ناشناخته: «${SPREAD_ARG || topicKey}»`);
  return spread;
}

function resolveBackground(fromRow) {
  const wanted = BG_ARG || fromRow || CONFIG.defaultBackground || 'mystic';
  if (!BACKGROUNDS.includes(wanted)) fail(`پس‌زمینه‌ی نامعتبر: «${wanted}» (مجاز: ${BACKGROUNDS.join('، ')})`);
  return wanted;
}

/* ═══════════════ استابِ حالتِ fake ═══════════════ */
// خروجیِ ساختگی ولی **معتبر**: باید از `checkV4Shape` و `headlineOk` رد شود، وگرنه
// `--fake` مسیرِ پذیرش و ساختِ props را اصلاً لمس نمی‌کند و سبزِ دروغین می‌دهد (درسِ
// همان `--dry` که یک دورِ کاملِ آزمایشگاه را سوزاند).
function fakeOut(cards, ctx) {
  const names = cards.map((c, i) => ctx.cards[i]?.fa || c.key);
  const q = String(ctx.question || '').split(/\s+/).slice(0, 3).join(' ');
  return JSON.stringify({
    cards: names.map((n) => ({ teaser: `کارتِ ${n} روی میز نشست. تصویرش یک صحنه‌ی ساختگی دارد.` })),
    headline: 'بله با احتمالِ زیاد پیش می‌ره، ولی باید بهای صبر رو بدی.',
    pattern: `ترکیبِ ${names[0]} و ${names[names.length - 1]} درباره‌ی «${q}» یک جهت نشان می‌دهد.`,
    reads: names.map((n) => ({ text: `${n} می‌گه این بخش از «${q}» دارد جابه‌جا می‌شود و خودش را نشان می‌دهد.` })),
    callback: '',
    closing: `در کل، «${q}» تو این چند هفته روشن‌تر می‌شه، ولی به شرطی که پیامِ ${names[0]} را جدی بگیری.`,
    summary: 'خلاصه‌ی ساختگی',
    memory: 'حافظه‌ی ساختگی',
  });
}

/** استابِ تعمیرِ نقطه‌ای: خروجیِ معتبر می‌دهد تا آن مسیر هم بدونِ شبکه واقعاً اجرا شود. */
function fakeRepair(sys, usr, opts) {
  const n = (usr.match(/^\d+\)/gm) || []).length || 1;
  const out = JSON.stringify({ fixes: Array.from({ length: n }, () => 'بیشتر به این سمت می‌خوره که پیش بره، ولی صبر می‌خواد.') });
  return opts.validate(out) ? { out, model: 'fake', attempts: 1, usages: [] } : null;
}

/* ═══════════════ تولیدِ فال ═══════════════ */
async function generateReading({ spread, question, seed }) {
  const cards = drawCards(seed, [0, 1, 2], spread.size);

  // ناشناسِ کامل: بدونِ نام، بدونِ حافظه، بدونِ سابقه.
  const ctx = buildReadingCtx({
    user: { telegram_id: 0, memory_json: '', focus_area: spread.focus || 'question' },
    spread,
    question,
    cards,
    focusKey: spread.focus || 'question',
    L,
    name: '',
    hideName: true,
    kbOn: true,
    prev: [],
  });

  const labels = L.prompts.cardLabels(cards.length);
  const system = L.prompts.readerSystemV4(spread, labels);
  const userMsg = L.prompts.readingContext(ctx);

  let parsed = null;
  let fallback = null;
  const call = FAKE
    ? (sys, usr, opts) => {
        const out = fakeOut(cards, ctx);
        return opts.validate(out) ? { out, model: 'fake', attempts: 1, usages: [] } : null;
      }
    : orChatResilient;

  const res = await call(system, userMsg, {
    maxTokens: spread.maxTokens,
    validate: (out) => {
      const obj = parseJsonLoose(out);
      if (!checkV4Shape(obj, cards.length)) return false;
      // سرخطِ خراب یعنی «دوباره تلاش کن»، نه «دور بریز»: آخرین خروجیِ سالم نگه داشته
      // می‌شود تا اگر همه‌ی تلاش‌ها هم سرخطِ خوب ندادند، فال از دست نرود.
      if (!headlineOk(obj.headline)) { fallback = obj; return false; }
      parsed = obj;
      return true;
    },
  });
  if (!parsed && fallback) parsed = fallback;
  if (!parsed) fail('مدل بعد از همه‌ی تلاش‌ها خروجیِ معتبر نداد');

  const rep = await repairDefects(parsed, FAKE ? fakeRepair : orChatResilient, { tag: 'reel' });
  return { cards, llm: rep.llm, model: res?.model || '', attempts: res?.attempts || 0, repaired: !!rep.repaired };
}

/* ═══════════════ main ═══════════════ */
async function main() {
  const row = await pickQuestion();
  const spread = resolveSpread(row.topicKey);
  const background = resolveBackground(row.background);

  // نسخه‌ی اول فقط سه‌کارتی می‌سازد. زمان‌بندی و هندسه برای پنج‌کارتی هم نوشته شده‌اند،
  // ولی تا وقتی یک ویدیوی پنج‌کارتی واقعاً دیده و تأیید نشده، ساختنش تصمیمِ ما نیست.
  if (spread.size !== 3) fail(`نسخه‌ی اول فقط چیدمانِ سه‌کارتی می‌سازد؛ «${spread.id}» ${spread.size} کارت دارد`);

  const seed = `video:${row.pageId || 'manual'}`;
  console.log(`🔮 چیدمان: ${spread.id} «${spread.fa}» | پس‌زمینه: ${background} | seed: ${seed}`);

  const { cards, llm, model, attempts, repaired } = await generateReading({ spread, question: row.question, seed });
  console.log(`🃏 کارت‌ها: ${cards.map((c) => c.key + (c.reversed ? '↕' : '')).join('، ')}`);
  console.log(`🤖 مدل: ${model || 'نامشخص'} | تلاش: ${attempts}${repaired ? ' | تعمیرِ نقطه‌ای انجام شد' : ''}`);

  const props = buildProps({
    spread,
    cards,
    llm,
    question: row.question,
    background,
    meta: { pageId: row.pageId || '', seed, model, generatedAt: new Date().toISOString() },
  });

  const errs = validateProps(props);
  if (errs.length) {
    console.error(`❌ propsِ ساخته‌شده معتبر نیست (${errs.length} ایراد):`);
    for (const e of errs) console.error(`   • ${e}`);
    fail('propsِ نامعتبر؛ رندر انجام نمی‌شود');
  }

  const outPath = path.isAbsolute(OUT) ? OUT : path.resolve(REPO_ROOT, OUT);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(props, null, 2)}\n`, 'utf8');

  const { copied } = stageCards(props, { root: REPO_ROOT });

  console.log('\n────────────────────────────────────');
  console.log(`✅ props نوشته شد: ${outPath}`);
  console.log(`🖼 تصاویرِ آماده‌شده: ${copied.join('، ')}`);
  console.log(`❓ سوال: ${props.question}`);
  console.log(`🔮 جواب: ${props.headline}`);
  props.cards.forEach((c, i) => {
    console.log(`   ${i + 1}) ${c.label}: ${c.fa}${c.reversed ? ' (برعکس)' : ''} | ${c.read.length} کاراکتر`);
  });
  console.log(`📜 جمع‌بندی: ${props.closing.length} کاراکتر`);
  console.log('────────────────────────────────────');

  ghOutput('skip', 'false');
  ghOutput('props', outPath);
  ghOutput('page_id', props.meta.pageId);
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));
