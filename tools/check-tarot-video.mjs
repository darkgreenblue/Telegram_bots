#!/usr/bin/env node
// چکِ CI برای پایپ‌لاینِ ویدیوی ریلِ تاروت (video/tarot-reel + tools/tarot-video).
//
// چرا این فایل وجود دارد: خروجیِ این فیچر یک **ویدیو** است. هیچ چکِ متعارفی آن را نمی‌بیند،
// و خرابی‌هایش دقیقاً از جنسی‌اند که فقط بعد از یک رندرِ چندده‌ثانیه‌ای روی رانرِ گیت‌هاب
// خودشان را نشان می‌دهند: کارتی که رفته پشتِ استیکرِ سوالِ اینستاگرام، ویدیویی که ۶۱ ثانیه
// شده و اینستاگرام بریده‌اش، جمله‌ای که وسطِ صفحه‌بندی گم شده. پس کلِ هندسه و زمان‌بندی در
// ماژول‌های **خالص** است و این‌جا واقعاً اجرا می‌شود، نه اینکه وجودِ متنش بررسی شود.
//
// صفر شبکه، صفر نصبِ پکیج: این چک روی جابِ `tarot` ماتریسِ CI می‌نشیند که
// `video/tarot-reel/node_modules` را ندارد. برای همین **ادعای ۱ (خلوص) اول است**؛ اگر
// ماژول‌های خالص روزی از remotion چیزی import کنند، این چک اصلاً بالا نمی‌آید و بهتر است
// دلیلش را صریح بگوید تا با یک `ERR_MODULE_NOT_FOUND` گنگ بمیرد.
//
// اجرا: node tools/check-tarot-video.mjs
import { readFileSync, readdirSync, existsSync } from 'fs';
import { builtinModules } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const src = (f) => readFileSync(f, 'utf8');

let pass = 0;
const errs = [];
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); }
};
const eq = (a, b, msg) => ok(a === b, `${msg} (=${JSON.stringify(a)})`);

/* ── ابزارِ خواندنِ سورس ───────────────────────────────────────────────────
   ادعای «روی متنِ کد» بدونِ تفکیکِ کامنت از رشته از کد بی‌معنی است: کامنتِ فارسیِ این ریپو
   پر از خط تیره‌ی توضیحی است، نامِ پرچم‌ها در کامنت‌ها هم می‌آید، و پرانتزِ داخلِ یک پیامِ
   فارسی می‌تواند برشِ بدنه‌ی یک دستور را وسطِ راه تمام کند.

   چرا یک توکنایزرِ واحد و نه سه اسکنرِ کوچک: هر سه به «رجکس یا تقسیم؟» می‌رسند. رجکسی مثل
   `/\(/` پرانتزِ نامتوازن دارد و رجکسی مثل `/['"]/` کوتیشن دارد؛ اسکنرِ ساده هر دو را
   اشتباه می‌خواند و ادعای وابسته‌اش **بی‌صدا** توخالی می‌شود. اینجا یک بار درست حل می‌شود. */
const RE_ALLOWED_BEFORE = new Set([...'=(,:[!&|?{};+-*%~^<>', undefined]);
const RE_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'new', 'delete', 'void'];

/** سورس → دنباله‌ی سگمنت‌ها: `code` | `string` | `comment` | `regex`. */
function tokenize(source) {
  const segs = [];
  let i = 0;
  let codeStart = 0;
  let lastCode = undefined; // آخرین نویسه‌ی معنادارِ کد، برای تشخیصِ رجکس از تقسیم
  const n = source.length;
  const flushCode = () => {
    if (i > codeStart) {
      const text = source.slice(codeStart, i);
      segs.push({ kind: 'code', text, start: codeStart, end: i });
      const trimmed = text.replace(/\s+$/, '');
      if (trimmed) lastCode = trimmed[trimmed.length - 1];
    }
  };
  const looksLikeRegex = () => {
    if (RE_ALLOWED_BEFORE.has(lastCode)) return true;
    const upto = source.slice(0, i).replace(/\s+$/, '');
    return RE_KEYWORDS.some((k) => upto.endsWith(k) && !/[\w$]/.test(upto[upto.length - k.length - 1] || ''));
  };
  while (i < n) {
    const c = source[i];
    const nx = source[i + 1];
    if (c === '/' && (nx === '/' || nx === '*')) {
      flushCode();
      const start = i;
      if (nx === '/') { while (i < n && source[i] !== '\n') i++; }
      else { i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i = Math.min(n, i + 2); }
      segs.push({ kind: 'comment', text: source.slice(start, i), start, end: i });
      codeStart = i;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      flushCode();
      const start = i;
      let buf = '';
      i++;
      while (i < n) {
        if (source[i] === '\\') { buf += source[i + 1] ?? ''; i += 2; continue; }
        if (source[i] === c) { i++; break; }
        buf += source[i++];
      }
      segs.push({ kind: 'string', text: buf, raw: source.slice(start, i), start, end: i });
      codeStart = i;
      lastCode = c;
      continue;
    }
    if (c === '/' && looksLikeRegex()) {
      flushCode();
      const start = i;
      i++;
      let inClass = false;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) { i++; break; }
        else if (source[i] === '\n') break; // رجکسِ ناتمام؛ محافظه‌کارانه رها می‌شود
        i++;
      }
      while (i < n && /[a-z]/.test(source[i])) i++; // فلگ‌ها
      segs.push({ kind: 'regex', text: source.slice(start, i), start, end: i });
      codeStart = i;
      lastCode = '/';
      continue;
    }
    i++;
  }
  flushCode();
  return segs;
}

/** فقط اسکلتِ کد: کامنت و **محتوای** رشته‌ها حذف می‌شوند (برای شمردنِ نامِ شناسه‌ها). */
function stripComments(source) {
  return tokenize(source)
    .map((s) => (s.kind === 'code' || s.kind === 'regex' ? s.text : s.kind === 'string' ? '""' : ''))
    .join('');
}

/** حذفِ **فقط** کامنت؛ رشته‌ها دست‌نخورده می‌مانند (specifierِ import داخلِ رشته است). */
function stripCommentsOnly(source) {
  return tokenize(source).map((s) => (s.kind === 'comment' ? '' : s.raw ?? s.text)).join('');
}

/**
 * بلوکِ متوازن بعد از یک نشانه، روی متنِ **خام** (مثلاً بدنه‌ی `bot.command('reel', ...)`).
 * عمق فقط داخلِ سگمنت‌های کد شمرده می‌شود.
 */
function sliceBalanced(source, fromIdx, open, close) {
  let depth = 0;
  let start = -1;
  for (const seg of tokenize(source)) {
    if (seg.kind !== 'code' || seg.end <= fromIdx) continue;
    for (let k = 0; k < seg.text.length; k++) {
      const pos = seg.start + k;
      if (pos < fromIdx) continue;
      const ch = seg.text[k];
      if (ch === open) { if (start < 0) start = pos; depth++; }
      else if (ch === close && start >= 0) {
        depth--;
        if (!depth) return source.slice(start, pos + 1);
      }
    }
  }
  return '';
}

/** همه‌ی specifierهای import/require یک فایل. */
function importsOf(source) {
  const noComments = stripCommentsOnly(source);
  const out = [];
  const pats = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];
  for (const p of pats) {
    let m;
    while ((m = p.exec(noComments))) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** رشته‌های رو-به-کاربر = رشته‌هایی که حرفِ فارسی دارند. `--fake` و URL از سنجه بیرون می‌مانند. */
const FA_LETTER = /[؀-ۿ]/;
function faStrings(source) {
  return tokenize(source).filter((s) => s.kind === 'string' && FA_LETTER.test(s.text)).map((s) => s.text);
}

const BUILTINS = new Set(builtinModules);
const isRelative = (s) => s.startsWith('./') || s.startsWith('../') || s.startsWith('/');
const isBuiltin = (s) => s.startsWith('node:') || BUILTINS.has(s.split('/')[0]);

/* بندهای ۱، ۷ و ۸ همه روی همین توکنایزر سوارند. اگر او اشتباه بخواند، آن ادعاها بی‌صدا
   توخالی می‌شوند (بدترین حالتِ ممکن برای یک چک). پس اول خودش سنجیده می‌شود. */
console.log('\n▶ ۰) صحتِ خودِ خوانشگرِ سورس');
ok(faStrings("const r = /['\"]/g; const m = 'پیام (با پرانتز)';").join('|') === 'پیام (با پرانتز)',
  'رجکسِ حاویِ کوتیشن با رشته اشتباه گرفته نمی‌شود');
ok(sliceBalanced("f(a, /\\(/, 'متن (پرانتزدار)');", 0, '(', ')') === "(a, /\\(/, 'متن (پرانتزدار)')",
  'برشِ متوازن، پرانتزِ داخلِ رجکس و رشته را نمی‌شمارد');
ok(faStrings("// کامنتِ فارسی — با خط تیره\nconst a = 1;").length === 0, 'کامنت رشته شمرده نمی‌شود');
ok((stripComments("const A = 1; // A A A\nconst s = 'A';").match(/\bA\b/g) || []).length === 1,
  'شمارشِ شناسه فقط روی کد است، نه کامنت و نه رشته');
// تلهٔ واقعی: ادعایی که به **مقدارِ** یک رشته کار دارد (مثل شماره‌ی نسخه) اگر روی نمای
// بی‌رشته بنشیند، هرگز match نمی‌کند و برای همیشه قرمز می‌ماند. دو نما عمداً جدا هستند.
ok(/= '3\.17\.0'/.test(stripCommentsOnly("const V = '3.17.0'; // نسخه")), 'نمای «فقط بی‌کامنت» مقدارِ رشته را نگه می‌دارد');
ok(!/= '3\.17\.0'/.test(stripComments("const V = '3.17.0';")), 'نمای «اسکلتِ کد» مقدارِ رشته را نگه نمی‌دارد');
ok(importsOf("import {x} from 'remotion';\nconst y = require('react');").join() === 'remotion,react',
  'سنجه‌ی خلوص واقعاً import پیدا می‌کند (متنِ ساختگی گرفته شد)');
ok(importsOf("// import {x} from 'remotion';\nimport a from './b.js';").join() === './b.js',
  'importِ داخلِ کامنت اشتباهاً شمرده نمی‌شود');
ok(faStrings("const a = '--fake'; const b = 'گزینه — دوم';").filter((s) => /[—–]|--/.test(s)).length === 1,
  'سنجه‌ی خط تیره فقط متنِ فارسی را می‌سنجد (فلگِ CLI اشتباهاً گرفته نمی‌شود)');

/* ══════════════════════════════════════════════════════════════════════════
   ۱) گاردِ خلوص
   این ادعا اولِ همه است چون **بقیه‌ی این چک را ممکن می‌کند**: جابِ tarot در CI هیچ‌وقت
   `video/tarot-reel/node_modules` را نصب نمی‌کند (نصبِ remotion چند صد مگابایت و چند
   دقیقه است، برای رباتی که اصلاً این کد را اجرا نمی‌کند). پس یک `import 'remotion'` که
   به‌اشتباه از JSX به ماژولِ خالص سُر بخورد، کلِ چک را کور می‌کند.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۱) خلوصِ ماژول‌ها (بدونِ react/remotion/npm)');
const PURE =['layout.js', 'motion.js', 'timing.js', 'text.js'].map((f) => rel('video/tarot-reel/src', f));
const TOOLS_DIR = rel('tools/tarot-video');
const TOOL_FILES = existsSync(TOOLS_DIR)
  ? readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.mjs')).sort().map((f) => path.join(TOOLS_DIR, f))
  : [];

ok(PURE.every(existsSync), `هر چهار ماژولِ خالص وجود دارند (${PURE.map((f) => path.basename(f)).join(', ')})`);
ok(TOOL_FILES.length > 0, `اسکریپت‌های پایپ‌لاین پیدا شدند (${TOOL_FILES.map((f) => path.basename(f)).join(', ') || 'هیچ'})`);

for (const f of PURE.filter(existsSync)) {
  const specs = importsOf(src(f));
  const bad = specs.filter((s) => !isRelative(s));
  ok(bad.length === 0, `${path.basename(f)}: هیچ پکیجی import نمی‌شود${bad.length ? ` (${bad.join(', ')})` : ''}`);
  // پسوندِ صریح قرارداد است: Node بدونِ آن ماژولِ ESM را پیدا نمی‌کند و همین چک اولین
  // جایی است که با Node خام اجرایشان می‌کند.
  const noExt = specs.filter((s) => isRelative(s) && !/\.(js|mjs|json)$/.test(s));
  ok(noExt.length === 0, `${path.basename(f)}: هر import پسوندِ صریح دارد${noExt.length ? ` (${noExt.join(', ')})` : ''}`);
}
for (const f of TOOL_FILES) {
  const specs = importsOf(src(f));
  const bad = specs.filter((s) => !isRelative(s) && !isBuiltin(s));
  ok(bad.length === 0, `${path.basename(f)}: فقط ماژولِ داخلیِ Node و مسیرِ نسبی${bad.length ? ` (${bad.join(', ')})` : ''}`);
}
if (errs.length) {
  console.log('\n❌ خلوص شکسته است؛ بقیه‌ی چک بدونِ node_modules قابلِ اجرا نیست.');
  errs.forEach((e) => console.log(`   - ${e}`));
  process.exit(1);
}

const layout = await import(rel('video/tarot-reel/src/layout.js'));
const motion = await import(rel('video/tarot-reel/src/motion.js'));
const timing = await import(rel('video/tarot-reel/src/timing.js'));
const text = await import(rel('video/tarot-reel/src/text.js'));

const {
  W, H, FPS, SAFE_BOX, CAPTION_BOX, VERDICT_BOX, TITLE_BOX, rowSlots, focusRect,
} = layout;
const { cardRectAt, deckRectAt, decorSlots, overlaps, safeBoxClear, lerp } = motion;
const { buildPlan, CAP_SEC, CAP_FRAMES, FLY_SEC, INTRO_SEC } = timing;
const { paginateToFit, fitFontSize, stripDash, normalizeWs } = text;

// propsِ نمونه هم اینجا لازم است (واقعی‌ترین ورودیِ موجود، برای بندهای ۳ و ۴) و هم در بندِ ۶.
// قرارداد آن را کنارِ کامپوزیشن گذاشته؛ مسیرِ دوم فقط شبکه‌ی ایمنی است.
const SAMPLE_PATHS = [
  rel('video/tarot-reel/fixtures/props.sample.json'),
  rel('tools/tarot-video/fixtures/props.sample.json'),
];
const samplePath = SAMPLE_PATHS.find(existsSync);
const sample = samplePath ? JSON.parse(src(samplePath)) : null;

/* ══════════════════════════════════════════════════════════════════════════
   ۲) گاردِ SAFE_BOX
   مهم‌ترین ادعای این فایل. استیکرِ سوالِ اینستاگرام یک مستطیلِ ثابت وسطِ قاب را می‌پوشاند؛
   هر پیکسلی که زیرش برود برای بیننده وجود ندارد. این‌جا کلِ برنامه‌ی صحنه‌ها ساخته می‌شود و
   **فریم‌به‌فریم** (نه با چند نمونه‌ی نمادین) مستطیلِ هر کارت گرفته و سنجیده می‌شود.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۲) هیچ‌چیز هرگز واردِ باکسِ سوال نمی‌شود');

const FILLER = 'این جمله‌ی نمونه است و درباره‌ی مسیری حرف می‌زند که پیش روی توست. ';
const txt = (n) => (n <= 0 ? '' : FILLER.repeat(Math.ceil(n / FILLER.length)).slice(0, n));
const CARD_KEYS = ['m00', 'c07', 'p03', 's11', 'w05'];
const sampleProps = (n = 3, { read = 320, closing = 700, headline = 60 } = {}) => ({
  v: 1,
  background: 'mystic',
  spreadId: 'personal3',
  spreadFa: 'سؤال شخصی خودم',
  question: 'این مسیری که انتخاب کردم درست است؟',
  cards: Array.from({ length: n }, (_, i) => ({
    key: CARD_KEYS[i % CARD_KEYS.length],
    file: `${CARD_KEYS[i % CARD_KEYS.length]}.jpg`,
    fa: 'کارتِ نمونه',
    reversed: i % 2 === 1,
    label: 'کارت اولت',
    read: txt(read),
  })),
  headline: txt(headline),
  pattern: 'الگویی که بین کارت‌ها تکرار می‌شود.',
  closing: txt(closing),
  meta: { pageId: '', seed: 'seed', model: '', generatedAt: '' },
});

const inFrame = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
// فاصله‌ی افقیِ مستطیل تا باکس، فقط وقتی از باندِ عمودیِ باکس رد می‌شود (وگرنه بی‌معنی است).
function gapToSafe(r) {
  const vOverlap = r.y < SAFE_BOX.y + SAFE_BOX.h && SAFE_BOX.y < r.y + r.h;
  if (!vOverlap) return Infinity;
  return Math.max(SAFE_BOX.x - (r.x + r.w), r.x - (SAFE_BOX.x + SAFE_BOX.w));
}

let rects = 0;
let hits = 0;
let stretched = 0;
let broken = 0;
let minGap = Infinity;
let crossedBand = false;
let firstHit = null;
const feed = (r, where) => {
  rects++;
  if (!safeBoxClear(r)) {
    hits++;
    if (!firstHit) firstHit = `${where} → ${JSON.stringify(r)}`;
  }
  if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) broken++;
  // نسبتِ کارت هرگز نباید بشکند: کشیده‌شدنِ تصویرِ کارت در ویدیو فوراً به چشم می‌آید و
  // هیچ راهی هم برای دیدنش قبل از رندر نیست.
  else if (r.h > 0 && Math.abs(r.w / r.h - layout.CARD_AR) > 1e-6) stretched++;
  const g = gapToSafe(r);
  if (g < minGap) minGap = g;
  if (Number.isFinite(g)) crossedBand = true;
};

// ۳ و ۵ کارتی (قراردادِ کد) به‌علاوه‌ی خودِ فیکسچرِ واقعی، تا سویپ فقط روی متنِ ساختگی نباشد.
const SWEEP = [[3, sampleProps(3)], [5, sampleProps(5)], ...(sample ? [[sample.cards.length, sample]] : [])];
for (const [n, props] of SWEEP) {
  const plan = buildPlan(props);
  for (const sc of plan.scenes) {
    // فریم‌به‌فریمِ واقعی، با کفِ ۹۰ نمونه برای صحنه‌های کوتاه.
    const steps = Math.max(90, sc.durationInFrames);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      for (let i = 0; i < n; i++) feed(cardRectAt({ scene: sc.motion, t, i, n }), `${sc.id}/card${i}/t=${t.toFixed(3)}`);
      if (sc.kind === 'intro') {
        for (const k2 of decorSlots(n)) feed(deckRectAt({ t, k: k2, n }), `${sc.id}/deck${k2}/t=${t.toFixed(3)}`);
      }
    }
  }
  // پرواز‌های حدی: `flyIn/flyOut` از طولِ صحنه ساخته می‌شوند و بعد از فشرده‌سازی هر مقداری
  // می‌گیرند. اگر امنیت به پنجره‌ی زمانی وابسته بود، همین سویپ لختش می‌کرد.
  for (const f of [0.02, 0.08, 0.2, 0.42, 0.6, 0.9]) {
    for (let card = 0; card < n; card++) {
      const scene = { kind: 'focus', card, flyIn: f, flyOut: f };
      for (let k = 0; k <= 220; k++) {
        const t = k / 220;
        for (let i = 0; i < n; i++) feed(cardRectAt({ scene, t, i, n }), `focus:${card}/fly=${f}/card${i}`);
      }
    }
  }
}

eq(hits, 0, `هیچ کارتی در هیچ فریمی واردِ باکس نشد (${rects} مستطیلِ سنجیده‌شده)`);
if (firstHit) console.log(`     اولین تخطی: ${firstHit}`);
ok(crossedBand, 'کارت‌ها واقعاً از باندِ عمودیِ باکس رد می‌شوند (وگرنه ادعای بالا توخالی بود)');
ok(minGap >= 1, `کمترین فاصله‌ی افقیِ کارت تا باکس هنگام عبور: ${minGap.toFixed(2)}px`);
eq(broken, 0, 'هیچ مستطیلی NaN یا بی‌نهایت ندارد');
eq(stretched, 0, 'نسبتِ کارت در هیچ فریمی نمی‌شکند (هیچ کشیدگی)');
// قطعی‌بودنِ موشن: Remotion فریم‌ها را موازی رندر می‌کند، پس دو فراخوانیِ یکسان باید یکی باشند.
ok(JSON.stringify(cardRectAt({ scene: { kind: 'focus', card: 1, flyIn: 0.2, flyOut: 0.2 }, t: 0.13, i: 1, n: 3 }))
  === JSON.stringify(cardRectAt({ scene: { kind: 'focus', card: 1, flyIn: 0.2, flyOut: 0.2 }, t: 0.13, i: 1, n: 3 })),
'cardRectAt قطعی است (هیچ Math.random یا Date.now در مسیر نیست)');

// صحتِ خودِ سنجه: همان نمونه‌بردار روی یک مسیرِ **مستقیم** (به‌جای دالان) باید قرمز کند.
// بدونِ این ادعا، یک باگ در `feed` کلِ بندِ ۲ را به یک «همیشه سبز» تبدیل می‌کرد.
{
  const from = rowSlots(3)[1];
  const to = focusRect();
  let straightHits = 0;
  for (let k = 0; k <= 200; k++) {
    const t = k / 200;
    const r = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), w: lerp(from.w, to.w, t), h: lerp(from.h, to.h, t) };
    if (!safeBoxClear(r)) straightHits++;
  }
  ok(straightHits > 0, `مسیرِ مستقیمِ ساختگی (بدونِ دالان) واقعاً گرفته می‌شود (${straightHits} فریمِ متخلف)`);
}
ok(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 'overlaps تقاطعِ واقعی را می‌گیرد');
ok(!overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 'مماس‌بودن تقاطع شمرده نمی‌شود');

// مستطیل‌های ثابتِ لایوت: هم بیرونِ باکس، هم کاملاً داخلِ قاب.
console.log('\n▶ ۲ب) مستطیل‌های ثابتِ لایوت');
const statics = [
  ['focusRect', focusRect()],
  ['CAPTION_BOX', CAPTION_BOX],
  ['VERDICT_BOX', VERDICT_BOX],
  ['TITLE_BOX', TITLE_BOX],
  // باکس‌های مشتق (بعد از کسرِ سطرِ سرآمد) هم باید همین قاعده را رعایت کنند، وگرنه یک
  // تیونِ بعدی روی ارتفاعِ سرآمد می‌تواند بی‌صدا متن را واردِ باکس کند.
  ...(typeof layout.titleTextBox === 'function' ? [['titleTextBox', layout.titleTextBox()]] : []),
  ...(typeof layout.captionTextBox === 'function' ? [['captionTextBox', layout.captionTextBox()]] : []),
  ...rowSlots(3).map((r, i) => [`rowSlots(3)[${i}]`, r]),
  ...rowSlots(5).map((r, i) => [`rowSlots(5)[${i}]`, r]),
];
for (const [name, r] of statics) {
  ok(safeBoxClear(r), `${name} با باکسِ سوال تقاطع ندارد`);
  ok(inFrame(r), `${name} کاملاً داخلِ ${W}×${H} است`);
}
// اسلات‌های ردیف نباید روی هم بیفتند (وگرنه کارت‌ها روی هم چاپ می‌شوند و کسی نمی‌بیندشان).
for (const n of [3, 5]) {
  const slots = rowSlots(n);
  let clash = false;
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) if (overlaps(slots[a], slots[b])) clash = true;
  ok(!clash, `اسلات‌های ردیفِ ${n} کارتی روی هم نمی‌افتند`);
  ok(slots.every((s, i) => i === 0 || s.x < slots[i - 1].x), `ترتیبِ اسلات‌های ${n} کارتی راست‌به‌چپ است`);
}

/* ══════════════════════════════════════════════════════════════════════════
   ۳) ریاضیِ مدت
   اینستاگرام ریلزِ بالای ۶۰ ثانیه را می‌بُرد. سقف نه یک آرزو، یک قرارداد است.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۳) مدتِ ویدیو زیرِ سقف می‌ماند');
const CASES = {
  // فیکسچرِ واقعی: تنها ورودی‌ای که شکل و طولش از یک فالِ واقعیِ همین ربات آمده.
  ...(sample ? { 'فالِ نمونه‌ی واقعی': sample } : {}),
  'متنِ خیلی کوتاه': sampleProps(3, { read: 12, closing: 20, headline: 8 }),
  'متنِ معمولی': sampleProps(3, { read: 320, closing: 700, headline: 60 }),
  'متنِ بلند': sampleProps(3, { read: 900, closing: 2400, headline: 120 }),
  'متنِ افراطی': sampleProps(5, { read: 1600, closing: 5000, headline: 300 }),
};
const plans = {};
for (const [name, props] of Object.entries(CASES)) {
  const plan = buildPlan(props);
  plans[name] = plan;
  const sum = plan.scenes.reduce((a, s) => a + s.durationInFrames, 0);
  ok(plan.totalFrames > 0, `${name}: طولِ ویدیو مثبت است (${(plan.totalFrames / FPS).toFixed(2)} ثانیه)`);
  ok(plan.totalFrames <= CAP_SEC * FPS, `${name}: زیرِ سقفِ ${CAP_SEC} ثانیه ماند`);
  // سقفِ ۶۰ ثانیه مالِ اینستاگرام است، نه مالِ ما. عمداً از `CAP_SEC` خودِ ماژول مستقل نوشته
  // شده تا بالا بردنِ آن ثابت هم این‌جا قرمز کند.
  ok(plan.totalFrames <= 60 * FPS, `${name}: زیرِ سقفِ سختِ ۶۰ ثانیه‌ی ریلز ماند`);
  eq(sum, plan.totalFrames, `${name}: جمعِ صحنه‌ها دقیقاً برابرِ کلِ ویدیوست`);
  ok(plan.scenes.every((s) => Number.isInteger(s.durationInFrames) && s.durationInFrames > 0),
    `${name}: هیچ صحنه‌ای صفر یا منفی فریم ندارد`);
  ok(plan.scenes.every((s, i) => s.from === (i ? plan.scenes[i - 1].from + plan.scenes[i - 1].durationInFrames : 0)),
    `${name}: صحنه‌ها بدونِ شکاف و بدونِ همپوشانی پشتِ سرِ هم‌اند`);
  // ترتیب قرارداد است: اینترو، بعد هر کارت، بعد جوابِ نهایی، بعد جمع‌بندی.
  const n = props.cards.length;
  const wanted = ['intro', ...Array.from({ length: n }, (_, i) => `focus:${i}`), 'headline'];
  const head = plan.scenes.slice(0, wanted.length).map((s) => s.id);
  eq(head.join(' '), wanted.join(' '), `${name}: ترتیبِ صحنه‌ها پایدار است`);
  ok(plan.scenes.slice(wanted.length).every((s, j) => s.id === `closing:${j}`), `${name}: جمع‌بندی آخر و شماره‌گذاری‌شده است`);
}
ok(CAP_FRAMES === Math.floor(CAP_SEC * FPS), `سقفِ فریم با سقفِ ثانیه می‌خواند (${CAP_FRAMES})`);

// فشرده‌سازی فقط نگه‌داشتِ متن را می‌خورد. اینترو (که اصلاً نگه‌داشت ندارد) و کفِ پروازِ
// کارت‌ها باید در همه‌ی حالت‌ها دست‌نخورده بمانند، وگرنه حرکت جویده و ارزان می‌شود.
const introOf = (p) => plans[p].scenes.find((s) => s.id === 'intro').durationInFrames;
const introFrames = Math.round(INTRO_SEC * FPS);
for (const name of Object.keys(CASES)) {
  eq(introOf(name), introFrames, `${name}: طولِ اینترو ثابت ماند`);
  const flyFloor = Math.round(FLY_SEC * 2 * FPS);
  ok(plans[name].scenes.filter((s) => s.kind === 'focus').every((s) => s.durationInFrames >= flyFloor),
    `${name}: هر صحنه‌ی کارت دستِ‌کم به‌اندازه‌ی رفت‌وبرگشتِ پرواز طول می‌کشد`);
  ok(plans[name].scenes.filter((s) => s.kind === 'focus')
    .every((s) => s.motion.flyIn > 0 && s.motion.flyIn <= 0.5 && s.motion.flyOut > 0 && s.motion.flyOut <= 0.5),
  `${name}: سهمِ پرواز از صحنه معقول است (کارت هرگز وسطِ راه برنمی‌گردد)`);
}
// همان کارت‌ها، متنِ بلندتر: فقط نگه‌داشت کوتاه‌تر می‌شود، نه انیمیشن.
ok(plans['متنِ بلند'].scenes[1].durationInFrames < plans['متنِ معمولی'].scenes[1].durationInFrames,
  'با متنِ بلندترِ جمع‌بندی، نگه‌داشتِ کارت‌ها کوتاه‌تر می‌شود (فشرده‌سازی واقعاً کار می‌کند)');
// ورودیِ پوچ نباید کرش کند: جابِ ویدیو نباید به‌خاطرِ یک ردیفِ خالیِ نوشن قرمز شود.
const empty = buildPlan({});
ok(empty.totalFrames > 0 && empty.scenes.length > 0, 'propsِ خالی هم یک برنامه‌ی معتبر می‌دهد، نه کرش');

/* ══════════════════════════════════════════════════════════════════════════
   ۴) صفحه‌بندی و فونت
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۴) صفحه‌بندیِ متن هیچ کاراکتری گم نمی‌کند');
const squash = (s) => String(s).replace(/\s+/g, '');
const REAL_TEXTS = [
  '',
  'یک جمله.',
  'جمله‌ی بدونِ علامتِ پایانی',
  txt(180),
  txt(700),
  txt(1200),
  txt(3000),
  txt(5000),
  'کارتِ اول می‌گوید صبر کن — کارتِ دوم می‌گوید حرکت کن -- و کارتِ سوم جواب را دارد.',
  Array.from({ length: 40 }, (_, i) => `این بندِ شماره ${i} است؟`).join('\n'),
];
for (const [i, t] of REAL_TEXTS.entries()) {
  const r = paginateToFit(t, VERDICT_BOX, { min: 30, max: 56, minPages: 2, maxPages: 3 });
  const label = `متنِ ${i} (${t.length} نویسه)`;
  // با ok و نه eq: مقدارِ این ادعا کلِ متنِ نمونه است و چاپش لاگِ CI را غرق می‌کند.
  ok(squash(r.pages.join('')) === squash(normalizeWs(stripDash(t))), `${label}: هیچ کاراکترِ غیرفضای‌سفیدی گم نشد`);
  ok(r.pages.every((p) => p && p.trim()), `${label}: هیچ صفحه‌ی خالی ساخته نشد`);
  ok(r.fontSize >= 30 && r.fontSize <= 56, `${label}: فونت در بازه‌ی مجاز است (${r.fontSize})`);
}
// سقفِ صفحه برای متنِ **واقعی** رعایت می‌شود. متنِ افراطی عمداً سقف را می‌شکند تا متن حذف
// نشود؛ این تصمیمِ ثبت‌شده است، پس هر دو سمتش این‌جا قفل می‌شود.
for (const t of [txt(180), txt(700), txt(1200)]) {
  ok(paginateToFit(t, VERDICT_BOX, { min: 30, max: 56, minPages: 2, maxPages: 3 }).pages.length <= 3,
    `متنِ ${t.length} نویسه‌ای در سقفِ سه صفحه جا می‌شود`);
}
{
  const monster = paginateToFit(txt(5000), VERDICT_BOX, { min: 30, max: 56, minPages: 2, maxPages: 3 });
  ok(monster.pages.length > 3, `متنِ غیرواقعیِ ۵۰۰۰ نویسه‌ای سقفِ صفحه را می‌شکند (${monster.pages.length} صفحه)`);
  ok(monster.fontSize === 30, 'ولی اول تا کوچک‌ترین فونت پایین می‌رود (شکستنِ سقف آخرین راه است)');
  ok(squash(monster.pages.join('')) === squash(normalizeWs(stripDash(txt(5000)))), 'و باز هم یک نویسه هم حذف نمی‌شود');
}
// قطعی‌بودن: Remotion ممکن است فریم‌ها را موازی و خارج از ترتیب رندر کند، پس دو فراخوانیِ
// یکسان باید بایت‌به‌بایت یکی باشند، وگرنه دو فریمِ پشتِ سرِ هم دو صفحه‌بندیِ متفاوت می‌بینند.
ok(JSON.stringify(paginateToFit(txt(1200), VERDICT_BOX, { minPages: 2, maxPages: 3 }))
  === JSON.stringify(paginateToFit(txt(1200), VERDICT_BOX, { minPages: 2, maxPages: 3 })),
'صفحه‌بندی قطعی است (دو فراخوانی، یک خروجیِ یکسان)');

console.log('\n▶ ۴ب) اندازه‌ی فونت و پاک‌سازیِ خط تیره');
for (const box of [CAPTION_BOX, VERDICT_BOX, TITLE_BOX]) {
  for (const t of ['', 'کوتاه', txt(400), txt(4000)]) {
    const s = fitFontSize(t, box, { min: 26, max: 66 });
    ok(s >= 26 && s <= 66, `fitFontSize همیشه در بازه می‌ماند (${s}) برای متنِ ${t.length} نویسه‌ای`);
  }
}
ok(fitFontSize('کوتاه', VERDICT_BOX, { min: 30, max: 56 }) >= fitFontSize(txt(3000), VERDICT_BOX, { min: 30, max: 56 }),
  'متنِ بلندتر فونتِ کوچک‌تر یا مساوی می‌گیرد');
ok(!/[—–]|--/.test(stripDash('الف — ب -- ج – د')), 'stripDash هر سه شکلِ خط تیره را برمی‌دارد');
ok(stripDash('الف — ب').includes('،'), 'جای خط تیره ویرگول می‌نشیند، نه اینکه متن بچسبد');
eq(stripDash(''), '', 'ورودیِ خالی همان خالی برمی‌گردد');
eq(stripDash(null), '', 'ورودیِ پوچ کرش نمی‌کند');

/* ۴ج) اتصالِ زمان‌بندی به لایوت. `buildPlan` اندازه‌ی فونت را حساب می‌کند و JSX همان عدد را
   مصرف می‌کند؛ اگر این دو روی **باکسِ متفاوتی** حساب کنند (مثلاً یکی کلِ کادر و دیگری کادرِ
   منهای سطرِ سرآمد)، متن دقیقاً به اندازه‌ی همان سطر سرریز می‌کند و هیچ‌کس تا رندر نمی‌فهمد. */
console.log('\n▶ ۴ج) اندازه‌ی فونتِ برنامه با باکسِ واقعیِ رندر می‌خواند');
{
  const capBox = typeof layout.captionTextBox === 'function' ? layout.captionTextBox() : CAPTION_BOX;
  const floorOf = (kind) => (kind === 'focus'
    ? layout.FONT.caption.min
    : Math.min(layout.FONT.headline.min, layout.FONT.verdict.min));
  const audit = (plan) => {
    let bad = 0;
    let atFloor = 0;
    for (const sc of plan.scenes) {
      if (!sc.text || !sc.fontSize) continue;
      if (text.fitsIn(sc.text, sc.kind === 'focus' ? capBox : VERDICT_BOX, sc.fontSize)) continue;
      if (sc.fontSize <= floorOf(sc.kind)) atFloor++;
      else bad++;
    }
    return { bad, atFloor };
  };
  // قاعده‌ی سختِ همه‌ی حالت‌ها: اگر متنی جا نشد، حتماً باید به کفِ فونت رسیده باشد. سرریزِ
  // «بی‌دلیل» (با فونتی بالاتر از کف) یعنی زمان‌بندی و رندر دو باکسِ متفاوت را می‌بینند.
  const all = Object.values(plans).reduce((a, p) => {
    const r = audit(p);
    return { bad: a.bad + r.bad, atFloor: a.atFloor + r.atFloor };
  }, { bad: 0, atFloor: 0 });
  eq(all.bad, 0, 'هیچ متنی با فونتی بالاتر از کف سرریز نمی‌کند');
  // قاعده‌ی محصولی: با **متنِ واقعیِ** یک فال هیچ اسلایدی نباید حتی به کف برسد. حالت‌های
  // استرسیِ بالا (تفسیرِ ۹۰۰ و ۱۶۰۰ نویسه‌ای) عمداً غیرواقعی‌اند و سرریزِ کنترل‌شده‌شان
  // پذیرفته است؛ ولی این حالت باید هشدار بدهد، نه اینکه بی‌صدا بماند.
  const realistic = ['فالِ نمونه‌ی واقعی', 'متنِ خیلی کوتاه', 'متنِ معمولی'].filter((k) => plans[k]);
  const realFloor = realistic.reduce((a, k) => a + audit(plans[k]).atFloor, 0);
  eq(realFloor, 0, 'با متنِ واقعیِ یک فال هیچ اسلایدی به کفِ فونت نمی‌رسد');
  const stress = Object.keys(CASES).filter((k) => !realistic.includes(k))
    .reduce((a, k) => a + audit(plans[k]).atFloor, 0);
  console.log(`     (در حالت‌های استرسیِ غیرواقعی ${stress} اسلاید به کفِ فونت می‌رسد و کنترل‌شده سرریز می‌کند)`);
}

/* ══════════════════════════════════════════════════════════════════════════
   ۵) پارسرِ Notion
   یک ردیفِ خرابِ نوشن نباید جابِ ویدیو را قرمز کند و نباید صف را دور بزند.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۵) صفِ سوال‌های Notion');
const notion = await import(rel('tools/tarot-video/notion.mjs'));
const { TOPIC_MAP, BG_MAP, DEFAULT_TOPIC, pickOldest, rowToQuestion } = notion;
const fixture = JSON.parse(src(rel('tools/tarot-video/fixtures/notion-query.json')));
const rows = fixture.results;

const oldest = pickOldest(rows);
ok(!!oldest, 'قدیمی‌ترین سوالِ قابلِ استفاده پیدا شد');
eq(oldest.pageId, '33333333-3333-4333-8333-333333333333', 'ردیفِ بدونِ سوال و ردیفِ آرشیوشده رد شدند');
eq(oldest.topicKey, 'career', 'برچسبِ کوتاهِ «شغل» هم به موضوعِ درست می‌رسد');
eq(oldest.background, 'mystic', 'پس‌زمینه از Select خوانده شد');
const first = rowToQuestion(rows[0]);
eq(first.question, 'این رابطه به کجا می‌رسه؟', 'متنِ سوال از پراپرتیِ title خوانده می‌شود');
eq(first.topicKey, 'love', 'برچسبِ بلندِ «عشق و رابطه» نگاشت می‌شود');
eq(first.background, 'nature', 'نگاشتِ پس‌زمینه کار می‌کند');
eq(rowToQuestion(rows[1]), null, 'ردیفِ بی‌سوال null می‌دهد (رد می‌شود، نه اینکه صف را بشکند)');
const unknown = rowToQuestion(rows[4]);
eq(unknown.topicKey, DEFAULT_TOPIC, 'مقدارِ ناشناخته‌ی «نوع فال» به موضوعِ پیش‌فرض می‌افتد');
eq(unknown.background, '', 'پس‌زمینه‌ی ناشناخته خالی می‌ماند تا config تصمیم بگیرد');
eq(pickOldest([]), null, 'صفِ خالی null می‌دهد');
eq(pickOldest(null), null, 'نتیجه‌ی خرابِ کوئری کرش نمی‌کند');
eq(pickOldest([{ id: 'x', properties: {} }]), null, 'ردیفی که هیچ سوالی ندارد انتخاب نمی‌شود');
eq(rowToQuestion(null), null, 'ورودیِ پوچ null می‌دهد');

// این‌جا نگاشتِ نوشن به کاتالوگِ واقعیِ ربات وصل می‌شود. اگر مالک روزی یک موضوع را در
// spreads.js حذف یا تغییرِ نام بدهد، جابِ ویدیو باید همین‌جا قرمز شود، نه وسطِ رندر.
const { SPREAD_BY_ID, TOPICS_V3 } = await import(rel('bots/tarot/spreads.js'));

// گزینه‌های **واقعیِ** Select در نوشن همان برچسب‌های خودِ ربات‌اند. اگر یکی‌شان در نگاشت
// نباشد، هیچ خطایی رخ نمی‌دهد: ردیف بی‌صدا به «سؤال شخصی» می‌افتد و مالک فقط وقتی
// می‌فهمد که ویدیوی «شغل» را ببیند و جوابِ عمومی بگیرد. پس هر برچسب این‌جا واقعاً
// از مسیرِ `rowToQuestion` رد می‌شود، نه از روی جدول خوانده می‌شود.
const rowWithTopic = (fa) => ({
  id: 'probe',
  properties: {
    'سوال': { title: [{ plain_text: 'سوالِ آزمون' }] },
    'نوع فال': { select: { name: fa } },
  },
});
for (const t of TOPICS_V3) {
  eq(rowToQuestion(rowWithTopic(t.fa))?.topicKey, t.key, `برچسبِ واقعیِ «${t.fa}» به موضوعِ خودش می‌رسد`);
}
for (const topic of [...new Set(Object.values(TOPIC_MAP))]) {
  const sp = SPREAD_BY_ID[`${topic}3`];
  ok(sp && sp.size === 3, `موضوعِ «${topic}» به چیدمانِ سه‌کارتیِ «${topic}3» می‌رسد`);
}
ok(SPREAD_BY_ID[`${DEFAULT_TOPIC}3`]?.size === 3, `موضوعِ پیش‌فرض («${DEFAULT_TOPIC}») هم چیدمانِ معتبر دارد`);
ok(new Set(Object.values(BG_MAP)).size === 3 && ['mystic', 'nature', 'minimal'].every((b) => Object.values(BG_MAP).includes(b)),
  'هر سه پس‌زمینه‌ی قرارداد در نگاشت هستند');

// `config.json` تنها جایی است که آی‌دیِ دیتابیس و پس‌زمینه‌ی پیش‌فرض می‌نشیند. پس‌زمینه‌ی
// تایپ‌غلط هیچ خطایی نمی‌دهد؛ فقط تمِ ویدیو بی‌صدا عوض می‌شود. آی‌دیِ خالی هم فقط موقعِ
// اجرای واقعیِ ورک‌فلو معلوم می‌شود، پس این‌جا هشدارِ زودهنگام می‌گیرد.
{
  const cfg = JSON.parse(src(rel('tools/tarot-video/config.json')));
  ok(['mystic', 'nature', 'minimal'].includes(cfg.defaultBackground),
    `پس‌زمینه‌ی پیش‌فرضِ config یکی از سه تمِ موجود است (${cfg.defaultBackground})`);
  ok(/^[0-9a-f]{32}$/.test(String(cfg.notionDatabaseId || '').replace(/-/g, '')),
    'آی‌دیِ دیتابیسِ Notion در config پر و به شکلِ معتبر است');
}

/* ══════════════════════════════════════════════════════════════════════════
   ۶) validateProps
   قراردادِ props تنها چیزی است که بینِ `generate.mjs` و کامپوزیشن ایستاده. اگر خرابیِ
   props تا رندر برسد، خطایش یک صفحه‌ی سفید در ویدیوست، نه یک پیامِ خطا.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۶) اعتبارسنجیِ props');
// importِ گاردشده: نبودِ این فایل نباید بقیه‌ی چک را نصفه بگذارد (بندهای ۷ و ۸ هم باید
// گزارش شوند تا با یک اجرا معلوم شود چه چیزی جا مانده).
let validateProps = null;
try {
  validateProps = (await import(rel('tools/tarot-video/props.mjs'))).validateProps;
} catch (e) {
  console.log(`  ⚠️ props.mjs بارگذاری نشد: ${String(e?.message || e).slice(0, 120)}`);
}
ok(typeof validateProps === 'function', 'props.mjs تابعِ validateProps را صادر می‌کند');

/** خروجیِ اعتبارسنج را به یک بولین نرمال می‌کند (throw، بولین، آرایه‌ی خطا یا {ok}). */
function isValid(p) {
  if (typeof validateProps !== 'function') return false;
  try {
    const r = validateProps(p);
    if (r === undefined || r === null) return true;
    if (typeof r === 'boolean') return r;
    if (Array.isArray(r)) return r.length === 0;
    if (typeof r === 'object') {
      if ('ok' in r) return Boolean(r.ok);
      if ('valid' in r) return Boolean(r.valid);
      if ('errors' in r) return !(r.errors || []).length;
    }
    return true;
  } catch {
    return false;
  }
}

ok(!!samplePath, `فایلِ نمونه‌ی props پیدا شد (${samplePath ? path.relative(ROOT, samplePath) : 'هیچ‌کدام از مسیرهای قرارداد'})`);
ok(sample && isValid(sample), 'propsِ نمونه از اعتبارسنجی رد می‌شود');

// جهش‌های عمدی. هر کدام یک خرابیِ واقعیِ ممکن است، نه یک ورودیِ خیالی.
const mutate = (fn) => {
  const copy = JSON.parse(JSON.stringify(sample));
  fn(copy);
  return copy;
};
const MUTANTS = sample ? [
  ['کارتِ ناشناخته', mutate((p) => { p.cards[0].key = 'zz99'; })],
  ['تفسیرِ خالیِ یک کارت', mutate((p) => { p.cards[0].read = ''; })],
  ['پس‌زمینه‌ی نامعتبر', mutate((p) => { p.background = 'neon'; })],
  ['تعدادِ کارتِ غلط', mutate((p) => { p.cards = p.cards.slice(0, 1); })],
  ['خط تیره‌ی بلند در متن', mutate((p) => { p.closing = `${p.closing} — و یک ادامه.`; })],
  ['جوابِ نهاییِ خالی', mutate((p) => { p.headline = ''; })],
] : [];
for (const [name, bad] of MUTANTS) ok(!isValid(bad), `جهشِ «${name}» رد می‌شود`);
ok(!isValid(null) && !isValid({}) && !isValid({ cards: [] }), 'propsِ پوچ/خالی هم رد می‌شود');

/* ══════════════════════════════════════════════════════════════════════════
   ۷) قفلِ پرچمِ ربات
   رباتِ tarot 🟢 زنده است. تنها چیزی که این فیچر آن‌جا اضافه می‌کند یک دستورِ ادمین است و
   باید دقیقاً همان بماند: یک پرچم، یک گارد، صفر متنِ فارسی در بدنه (بند ۱ قرارداد و ۱۰ ریشه).
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۷) دستورِ /reel در رباتِ زنده');
const IDX = src(rel('bots/tarot/index.js'));
// دو نمای متفاوت از یک فایل، و انتخابِ اشتباه بینشان ادعا را **همیشه** قرمز یا **همیشه**
// سبز می‌کند: `idxCode` محتوای رشته‌ها را هم خالی می‌کند (درست برای شمردنِ نامِ شناسه، تا
// نامِ پرچم داخلِ یک پیام شمرده نشود)، ولی هر ادعایی که به **مقدارِ** یک رشته کار دارد
// (شماره‌ی نسخه، نامِ ریپو) باید روی `idxText` بنشیند که رشته‌ها را دست‌نخورده نگه می‌دارد.
const idxCode = stripComments(IDX);
const idxText = stripCommentsOnly(IDX);
const flagUses = (idxCode.match(/\bVIDEO_REEL_ENABLED\b/g) || []).length;
eq(flagUses, 2, 'پرچمِ VIDEO_REEL_ENABLED دقیقاً دو بار استفاده شده (تعریف + گاردِ دستور)');
ok(/const\s+VIDEO_REEL_ENABLED\s*=\s*(true|false)\s*;/.test(idxCode), 'پرچم یک ثابتِ بولینِ یک‌خطی است (رول‌بکِ یک‌خطی)');
ok(/const\s+PRODUCT_VERSION\s*=\s*['"`]3\.17\.0['"`]/.test(idxText), 'PRODUCT_VERSION روی 3.17.0 بامپ شده (بند ۲ج/۴)');

const cmdIdx = IDX.indexOf("bot.command('reel'");
ok(cmdIdx >= 0, "دستور bot.command('reel', ...) ثبت شده است");
const cmdBody = cmdIdx >= 0 ? sliceBalanced(IDX, cmdIdx, '(', ')') : '';
ok(cmdBody.length > 0, 'بدنه‌ی دستور یک بلوکِ متوازن است');
ok(/\bisAdmin\s*\(/.test(stripComments(cmdBody)), 'گاردِ isAdmin در همان بدنه‌ی دستور است');
ok(/\bVIDEO_REEL_ENABLED\b/.test(stripComments(cmdBody)), 'پرچم هم در همان بدنه چک می‌شود');
ok(/\bL\.reel\b/.test(stripComments(cmdBody)), 'متنِ دستور از L.reel می‌آید');
{
  const inside = faStrings(cmdBody);
  ok(inside.length === 0, `هیچ رشته‌ی فارسی‌ای در بدنه‌ی دستور نیست${inside.length ? ` (${inside.slice(0, 3).join(' | ')})` : ''}`);
}
ok(/const\s+VIDEO_DISPATCH_REPO\s*=\s*(['"`])[^'"`]+\/[^'"`]+\1/.test(idxText), 'مقصدِ dispatch یک ثابتِ نام‌دار است، نه رشته‌ی درجا');

/* ══════════════════════════════════════════════════════════════════════════
   ۸) قاعده‌ی کپی (بند ۱۰ ریشه)
   «—» امضای متنِ ماشینی است. این ویدیو بیشترین متنی است که مخاطبِ اینستاگرام از ما می‌بیند.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n▶ ۸) هیچ خط تیره‌ی بلندی در متنِ رو-به-کاربر');
const LOC = src(rel('bots/tarot/locales/fa.js'));
const reelIdx = LOC.search(/^\s{2}reel:\s*\{/m) >= 0 ? LOC.search(/^\s{2}reel:\s*\{/m) : LOC.indexOf('reel:');
ok(reelIdx >= 0, 'بلوکِ reel در locales/fa.js هست');
{
  const block = reelIdx >= 0 ? sliceBalanced(LOC, reelIdx, '{', '}') : '';
  ok(block.length > 0, 'بلوکِ reel یک آبجکتِ متوازن است');
  const bad = faStrings(block).filter((s) => /[—–]|(?<!-)--(?!-)/.test(s));
  ok(bad.length === 0, `بلوکِ reel هیچ خط تیره‌ی بلندی ندارد${bad.length ? ` (${bad.slice(0, 2).join(' | ')})` : ''}`);
  ok(faStrings(block).length > 0, 'بلوکِ reel واقعاً متنِ فارسی دارد (سنجه‌ی بالا توخالی نیست)');
}
// ⚠️ در فایل‌های `tools/` نامِ فلگِ خط فرمان (`--props`, `--dry`) داخلِ همان پیام‌های فارسیِ
// راهنما می‌آید و با `--`ِ نگارشی یکی نیست. قاعده‌ی بند ۱۰ ریشه خطِ تیره را به‌عنوان
// **نشانه‌گذاری** ممنوع می‌کند، نه نامِ فلگ را. پس قبل از سنجش، فلگ‌ها از رشته حذف می‌شوند؛
// بدونِ این، تنها راهِ سبزکردنِ چک این بود که پیام‌های راهنما نامِ فلگ را نگویند.
const dropFlags = (s) => s.replace(/--[A-Za-z][\w-]*/g, '');
for (const f of TOOL_FILES) {
  const bad = faStrings(src(f)).filter((s) => /[—–]|(?<!-)--(?!-)/.test(dropFlags(s)));
  ok(bad.length === 0, `${path.basename(f)}: متنِ فارسی بدونِ خط تیره‌ی بلند${bad.length ? ` (${bad.slice(0, 2).join(' | ')})` : ''}`);
}

console.log(`\n${errs.length ? '❌' : '✅'} tarot-video: ${pass} ادعا سبز، ${errs.length} قرمز`);
if (errs.length) { errs.forEach((e) => console.log(`   - ${e}`)); process.exit(1); }
