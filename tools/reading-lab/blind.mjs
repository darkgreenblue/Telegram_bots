#!/usr/bin/env node
/* 🙈 نمره‌دهیِ **کور** به خروجیِ آزمایشگاه.
 *
 * چرا لازم شد: بلوکِ رونوشتِ لاگ، بازوی هر فال را بالای متن چاپ می‌کند
 * (`▓ openai/gpt-5.6-luna | P1.1 | …`). داورِ کیفیت خودِ سشن است (مسیرِ داوریِ خودکار
 * با تصمیمِ صریحِ مالک حذف شده و برنمی‌گردد)، ولی داوری روی متنِ **برچسب‌دار** یعنی
 * داور می‌داند کدام «مدلِ گرانِ فعلی» است و کدام «رایگان». آن یک سوگیریِ **جهت‌دار**
 * است، نه نویز: میانگین‌گیری پاکش نمی‌کند. همان درسِ بند ۰ب، این‌بار روی خودِ داور.
 *
 * دو حالت:
 *   split  لاگِ یک دور را می‌گیرد، متن‌ها را بی‌برچسب و با ترتیبِ تصادفی بیرون می‌دهد
 *          (`*.blind.md`) و کلیدِ بازگشایی را جدا می‌نویسد (`*.key.json`).
 *   score  نمره‌های داور را با کلید و با `scoreOf` (راستی‌آزماییِ نقلِ قول) به
 *          میانگینِ per بازو تبدیل می‌کند.
 *
 * ⚠️ کلید تا **بعد از** قفل‌شدنِ نمره‌ها خوانده نمی‌شود. این یک قاعده‌ی رفتاری است و
 * ابزار نمی‌تواند اجبارش کند؛ چیزی که ابزار تضمین می‌کند این است که خروجیِ کور
 * **هیچ ردی از بازو** نداشته باشد (گارد: `tools/check-blind.mjs`).
 */
import fs from 'node:fs';
import { RUBRIC, MAX, scoreOf } from './rubric.mjs';

/* خطوطِ لاگِ گیت‌هاب با مهرِ زمانِ ISO شروع می‌شوند؛ رونوشتِ محلی ندارد. هر دو باید
 * کار کنند، وگرنه ابزار فقط روی یکی از دو منبعِ واقعی جواب می‌دهد. */
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;
const stripTs = (s) => s.replace(TS, '');

/** هدرِ هر فال در بلوکِ رونوشت: `▓ <arm> | <persona>.<step>[ پN] | <spread>` */
const HEAD = /^▓\s*(.+?)\s*\|\s*([A-Za-z0-9]+)\.(\d+)(?:\s*پ(\d+))?\s*\|\s*(.+?)\s*$/;

/** رونوشت‌ها را از متنِ لاگ بیرون می‌کشد. */
export function parseTranscripts(raw) {
  const lines = raw.split('\n').map(stripTs);
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = HEAD.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { arm: m[1], persona: m[2], step: Number(m[3]), rep: m[4] ? Number(m[4]) : 1,
              spread: m[5], question: '', cards: '', body: [] };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('؟ ') && !cur.question) { cur.question = line.slice(2).trim(); continue; }
    if (line.startsWith('🃏 ') && !cur.cards) { cur.cards = line.slice(3).trim(); continue; }
    // پایانِ بلوک: خطِ جداکننده‌ی گزارش یا شروعِ بخشِ دیگری از لاگ
    if (/^[═▓█┄]{10,}/.test(line)) { out.push(cur); cur = null; continue; }
    cur.body.push(line);
  }
  if (cur) out.push(cur);
  // فالِ بی‌متن یعنی پارس خراب بوده؛ بی‌صدا نگهش نداریم
  return out.filter(r => r.question && r.body.join('').trim());
}

/** شافلِ قطعی با seed (Mulberry32) تا یک دور دوباره قابلِ ساختن باشد. */
function shuffle(arr, seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const pad = (n, w) => String(n).padStart(w, '0');

/**
 * متنی که نقلِ قولِ داور رویش راستی‌آزمایی می‌شود: **فقط خودِ فال**، بدونِ سرِ بلوک.
 *
 * ⚠️ چرا صادر می‌شود و چرا گارد باید همین را صدا بزند: سرِ بلوک سؤالِ کاربر را دارد، و
 * اگر داخلِ متنِ مرجع بماند نقلِ قولی از **سؤال** هم «اثبات‌شده» می‌شود، در حالی که
 * معیارها دربارهٔ چیزی‌اند که مدل نوشته. گاردی که خودش برش را دوباره پیاده کند فقط
 * آینه‌ی خودش را می‌سنجد و اگر فردا این تابع عوض شود سبز می‌ماند (تلهی گاردِ آینه‌ای).
 * تکه‌ی سر همیشه با خطِ `- کارت‌ها:` تمام می‌شود؛ نبودش = محافظه‌کارانه کلِ بلوک.
 */
export function refTextOf(chunk) {
  const at = String(chunk).indexOf('- کارت‌ها:');
  if (at < 0) return String(chunk);
  const nl = String(chunk).indexOf('\n', at);
  return nl > 0 ? String(chunk).slice(nl) : String(chunk);
}

/* ⚠️ `tag` (نامِ مجموعه‌ی سناریو) **اجباریِ درستی** است، نه تزئین.
 *
 * 🐛 باگی که قبل از اولین استفاده گرفته شد: شناسه‌ی سناریو per مجموعه یکتا **نیست**.
 * `P1.1` در هر سه مجموعه‌ی فارسی وجود دارد، با کارت و سؤالِ کاملاً متفاوت. اگر سه لاگ
 * با هم کور شوند و کلید فقط `persona.step` نگه دارد، تفاضلِ جفت‌شده سه سناریوی بی‌ربط
 * را یک سناریو می‌شمارد و `find` فقط اولی را برمی‌دارد: دو سومِ دیتا **بی‌صدا** دور
 * می‌ریزد و عددِ باقی‌مانده هم جفتِ اشتباه است. هیچ خطایی هم نمی‌داد. */
export function splitBlind(rows, seed) {
  const shuffled = shuffle(rows, seed);
  const key = {};
  const blocks = shuffled.map((r, i) => {
    const id = `R${pad(i + 1, 2)}`;
    key[id] = { arm: r.arm, persona: r.persona, step: r.step, rep: r.rep, spread: r.spread,
                set: r.set || '', scen: `${r.set ? `${r.set}/` : ''}${r.persona}.${r.step}` };
    /* ⚠️ چیدمان و سؤال و کارت‌ها **می‌مانند**: بدونشان معیارهای لنگرِ کارت و جوابِ
     * صریح قابلِ داوری نیستند. هیچ‌کدام بازو را لو نمی‌دهند. شناسه‌ی سناریو عمداً
     * حذف می‌شود، چون با ترتیبِ تصادفی هم دیدنِ «سه بارِ P1.1» می‌تواند به حدسِ
     * ترتیبِ بازوها وسوسه کند. */
    return `## ${id}\n\n- چیدمان: ${r.spread}\n- سؤال: ${r.question}\n- کارت‌ها: ${r.cards}\n\n`
      + r.body.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  });
  const header = `# رونوشتِ کور برای نمره‌دهی (${rows.length} فال)\n\n`
    + `معیارها: ${RUBRIC.map(r => `${r.id}(${r.w})`).join(' · ')} | سقف ${MAX}\n`;
  return { blind: `${header}\n${blocks.join('\n')}`, key };
}

/* ═══════════════ CLI ═══════════════ */
/* ⚠️ حلقه‌ی CLI پشتِ این گارد است چون گاردِ خودش (`tools/check-blind.mjs`) این ماژول را
 * **import** می‌کند. بدونش هر اجرای گارد یک متنِ راهنمای بی‌ربط هم چاپ می‌کرد. */
const RUN_CLI = /blind\.mjs$/.test(process.argv[1] || '');
const argv = RUN_CLI ? process.argv.slice(2) : [];
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

if (argv[0] === 'split') {
  /* `--logs a.txt:alef,b.txt:b` — چند لاگ در **یک** فایلِ کور، چون شافلِ بینِ
   * مجموعه‌ها کوری را قوی‌تر می‌کند (ترتیبِ مجموعه هم سرنخ نمی‌دهد). برچسب اجباری است
   * وگرنه شناسه‌ی سناریوها بینِ مجموعه‌ها قاطی می‌شود (کامنتِ `splitBlind`). */
  const many = (val('logs', '') || '').split(',').map(x => x.trim()).filter(Boolean);
  const single = val('log', '');
  const specs = many.length ? many : (single ? [single] : []);
  if (!specs.length) { console.error('❌ --log <فایل> یا --logs <فایل:برچسب,…> لازم است'); process.exit(1); }
  const rows = [];
  for (const spec of specs) {
    const i = spec.lastIndexOf(':');
    const file = i > 1 ? spec.slice(0, i) : spec;
    const tag = i > 1 ? spec.slice(i + 1) : '';
    if (!fs.existsSync(file)) { console.error(`❌ فایل نیست: ${file}`); process.exit(1); }
    if (specs.length > 1 && !tag) {
      console.error(`❌ با چند لاگ، برچسبِ مجموعه اجباری است: «${spec}» باید «فایل:برچسب» باشد.`);
      process.exit(1);
    }
    const part = parseTranscripts(fs.readFileSync(file, 'utf8'));
    if (!part.length) { console.error(`❌ هیچ رونوشتی در ${file} نبود (هدرِ ▓ عوض شده؟)`); process.exit(1); }
    for (const r of part) r.set = tag;
    console.log(`   ${file}${tag ? ` (${tag})` : ''}: ${part.length} فال`);
    rows.push(...part);
  }
  const out = val('out', (specs[0].split(':')[0]).replace(/\.[^.]+$/, ''));
  const { blind, key } = splitBlind(rows, val('seed', 'blind'));
  fs.writeFileSync(`${out}.blind.md`, blind);
  fs.writeFileSync(`${out}.key.json`, JSON.stringify(key, null, 1));
  const arms = [...new Set(rows.map(r => r.arm))];
  console.log(`✅ ${rows.length} فال از ${arms.length} بازو کور شد`);
  console.log(`   متنِ کور: ${out}.blind.md`);
  console.log(`   کلید:     ${out}.key.json  ⚠️ تا قفل‌شدنِ نمره‌ها بازش نکن`);
  // تعدادِ فالِ هر بازو چاپ می‌شود ولی **نه** نگاشتِ شناسه‌ها: مخرج لازم است، کلید نه.
  for (const a of arms) console.log(`   • ${a}: ${rows.filter(r => r.arm === a).length} فال`);
}

if (argv[0] === 'score') {
  const blindFile = val('blind', ''), keyFile = val('key', ''), scoreFile = val('scores', '');
  for (const [f, n] of [[blindFile, '--blind'], [keyFile, '--key'], [scoreFile, '--scores']]) {
    if (!f || !fs.existsSync(f)) { console.error(`❌ ${n} <فایل> لازم است`); process.exit(1); }
  }
  const blind = fs.readFileSync(blindFile, 'utf8');
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const scores = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
  // متنِ هر شناسه از خودِ فایلِ کور برداشته می‌شود تا `scoreOf` نقلِ قول را روی **همان
  // چیزی** بسنجد که داور خوانده، نه روی یک بازسازیِ دیگر.
  const textOf = {};
  for (const chunk of blind.split(/^## /m).slice(1)) {
    const id = chunk.split('\n', 1)[0].trim();
    textOf[id] = refTextOf(chunk);
  }
  const byArm = new Map(), perId = [];
  let faked = 0, missing = 0;
  for (const [id, meta] of Object.entries(key)) {
    const s = scores[id];
    if (!s) { missing++; continue; }
    const r = scoreOf(s, textOf[id] || '');
    faked += r.faked.length;
    /* ⚠️ سناریو از **خودِ کلید** خوانده می‌شود نه از `persona.step`: با چند مجموعه
     * آن بازسازی سناریوهای بی‌ربط را یکی می‌کند (کامنتِ `splitBlind`). */
    perId.push({ id, arm: meta.arm, scen: meta.scen || `${meta.persona}.${meta.step}`, got: r.got, pct: r.pct, faked: r.faked });
    const a = byArm.get(meta.arm) || { n: 0, got: 0, faked: 0 };
    a.n++; a.got += r.got; a.faked += r.faked.length; byArm.set(meta.arm, a);
  }
  if (missing) console.log(`⚠️ ${missing} فال نمره نگرفته (از میانگین بیرون است)`);
  if (faked) console.log(`🚨 ${faked} نقلِ قولِ اثبات‌نشده ⟵ آن معیارها صفر شدند`);
  console.log(`\n📊 نمره‌ی داور per بازو (سقف ${MAX})`);
  const rows = [...byArm.entries()].map(([arm, a]) => ({ arm, n: a.n, avg: a.got / a.n }));
  for (const r of rows) console.log(`   ${r.arm.padEnd(38)} ${r.avg.toFixed(2)}/${MAX}  (${Math.round(r.avg * 100 / MAX)}٪ سقف، ${r.n} فال)`);
  /* نسبت به **بازوی اول در کلید**، که همان کنترل است. عمداً از کلید و نه از ترتیبِ
   * الفبایی: ترتیبِ الفبایی می‌تواند کنترل را عوض کند و عددِ سرتیتر را وارونه بدهد. */
  const base = rows[0];
  console.log(`\n   🅰️ کنترل: ${base.arm}`);
  for (const r of rows.slice(1)) {
    const ratio = r.avg * 100 / base.avg;
    console.log(`   ${r.arm}: داور٪ = ${ratio.toFixed(1)}٪  ⟵  افت = ${(100 - ratio).toFixed(1)}٪`);
  }
  // تفاضلِ جفت‌شده per سناریو: همان چیزی که قاعده‌ی تصمیم رویش می‌نشیند
  const scens = [...new Set(perId.map(x => x.scen))];
  console.log(`\n   تفاضلِ جفت‌شده per سناریو (${scens.length} سناریو):`);
  for (const r of rows.slice(1)) {
    const d = [];
    for (const sc of scens) {
      const a = perId.find(x => x.scen === sc && x.arm === base.arm);
      const b = perId.find(x => x.scen === sc && x.arm === r.arm);
      if (a && b) d.push(b.got - a.got);
    }
    if (!d.length) { console.log(`   ${r.arm}: دادهٔ جفت‌شدنی نبود`); continue; }
    const mean = d.reduce((x, y) => x + y, 0) / d.length;
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, d.length - 1));
    const se = sd / Math.sqrt(d.length);
    console.log(`   ${r.arm}: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} نمره per سناریو`
      + ` (انحرافِ معیار ${sd.toFixed(2)}، خطای استاندارد ${se.toFixed(2)})`
      + ` | ${d.filter(x => x > 0).length} بهتر / ${d.filter(x => x < 0).length} بدتر / ${d.filter(x => !x).length} مساوی`);
  }
}

if (RUN_CLI && !['split', 'score'].includes(argv[0])) {
  console.log('حالت‌ها:\n  split --logs <فایل:برچسب,…> | --log <لاگ>  [--out <پیشوند>] [--seed <رشته>]\n'
    + '  score --blind <x.blind.md> --key <x.key.json> --scores <نمره‌ها.json>');
}
