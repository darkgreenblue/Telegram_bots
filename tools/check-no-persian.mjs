#!/usr/bin/env node
/* گاردِ «هیچ فارسی‌ای به کاربرِ غیرفارسی نمی‌رسد» — قراردادِ بند ۲و ریشه.
 *
 * 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۱۱ که این چک از دلش درآمد (مالک با اسکرین‌شات گرفتش):
 *   منوی فالِ رباتِ **روسی** دکمه‌های «🌀 سؤال شخصی خودم»، «⚖️ بله و خیر قطعی» و
 *   «💞 عشق و رابطه» را نشان می‌داد، کنارِ دکمه‌ی روسیِ «🗂 Все расклады».
 *
 * و درسِ اصلی این بود که **ترجمه گم نشده بود، فقط صدا زده نمی‌شد**: هر ۳۶ ترجمه
 * (۱۲ موضوع × ۳ زبان) از قبل در `langdata.<locale>.json` بودند و کیفیتشان هم خوب بود
 * (حتی معادل‌سازیِ فرهنگی: «درس و کنکور» → «Учёба и экзамены»). تنها ایراد یک
 * فراخوانیِ جاافتاده بود: `L.buttons.topic(t)` مستقیم `t.fa` را می‌خواند به‌جای
 * اینکه از `spreadName()` رد شود. یعنی دقیقاً همان الگوی `check-locale-data`:
 * **«ترجمه شده» با «وصل شده» یکی نیست.**
 *
 * پس این چک عمداً **رفتاری** است نه متنی: locale و دیتای هر زبان را واقعاً بار
 * می‌کند و همان چیزی را رندر می‌کند که کاربر می‌بیند. اسکنِ متنیِ سورس این باگ را
 * **نمی‌گرفت**، چون رشته‌ی فارسی در `spreads.js` بود و آن فایل درست هم هست: مشکل
 * جای رشته نبود، مسیرِ رسیدنش به کاربر بود.
 *
 * ⚠️ چرا فارسی داخلِ خودِ فایلِ locale ممنوع نیست: کامنت‌های این فایل‌ها عمداً فارسی
 *‌اند (مستنداتِ مالک). پس معیار «کاراکترِ فارسی در فایل» نیست، «کاراکترِ فارسی در
 * چیزی که رندر می‌شود» است.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LOCALES = ['ru', 'pt', 'es'];
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

/* ── ۱) رندرِ واقعی per زبان، در یک پروسه‌ی جدا ────────────────────────────────
 * پروسه‌ی جدا لازم است چون `LOCALE` سرِ import خوانده می‌شود و ESM ماژول را کش
 * می‌کند؛ سه زبان در یک پروسه یعنی هر سه دیتای اولی را می‌گیرند. */
const PROBE = String.raw`
const FA = /[؀-ۿ]/;
const S  = await import('./bots/tarot/spreads.js');
const RC = await import('./bots/tarot/reading-core.js');
const L  = (await import('./bots/tarot/locales/' + process.env.LOCALE + '.js')).default;
const bad = [];
const check = (where, s) => { if (typeof s === 'string' && FA.test(s)) bad.push(where + ' → ' + s); };

// همان فراخوانی‌ای که index.js می‌کند
for (const t of S.TOPICS_V3) check('buttons.topic(' + t.key + ')', L.buttons.topic(t, RC.spreadName(t.fa)));
for (const sp of Object.values(S.SPREAD_BY_ID)) {
  check('spreadName(' + sp.id + ')', RC.spreadName(sp.fa));
  check('spreadFaOf(' + sp.id + ')', RC.spreadName(S.faOf(sp, true)));
  (sp.positions || []).forEach((p, i) => check('positionName(' + sp.id + '[' + i + '])', RC.positionName(p && p.fa, i)));
  const cl = RC.choiceLabelsFor(sp);
  if (cl) cl.forEach((l, i) => check('choiceLabel(' + sp.id + '[' + i + '])', l));
}
for (const k of Object.keys(RC.CARD_BY_KEY || {})) check('cardName(' + k + ')', RC.cardName(k));

/* هر رشته‌ی ایستا و هر تابعِ locale. آرگومان‌های ساختگی عمداً **هیچ فارسی‌ای ندارند**،
 * پس هر فارسیِ خروجی حتماً از خودِ locale آمده و قرمزِ کاذب نمی‌سازد. */
const D = { key:'love', id:'love3', emoji:'X', fa:'FA', faV2:'FA2', faV3:'FA3', desc:'D', descV3:'D3',
            size:3, price:30000, coins:10, toman:30000, stars:50, on:true, value:3000, name:'N',
            code:'C', pct:10, days:3, count:2, balance:5, bonus:1 };
const ARGS = [[D,D,D,D],[3,3,3,3],['s','s','s','s'],[D,3,D,3],[3,D,3,D],[[],[],[],[]],[null,null,null,null]];
const walk = (o, path) => {
  for (const [k, v] of Object.entries(o || {})) {
    const p = path ? path + '.' + k : k;
    if (typeof v === 'string') check(p, v);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'string' ? check(p+'['+i+']', x) : (x && typeof x === 'object' && walk(x, p+'['+i+']'))));
    else if (typeof v === 'function') { for (const a of ARGS) { try { const r = v(...a); if (typeof r === 'string') check(p+'()', r); } catch {} } }
    else if (v && typeof v === 'object') walk(v, p);
  }
};
walk(L, '');
console.log(JSON.stringify(bad));
`;

console.log('▶ رندرِ واقعیِ هر زبان (فارسی نباید در خروجی باشد)');
const found = {};
for (const loc of LOCALES) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE],
    { env: { ...process.env, LOCALE: loc }, encoding: 'utf8', cwd: process.cwd() });
  const bad = JSON.parse(out.trim().split('\n').pop());
  found[loc] = bad;
  ok(bad.length === 0, `«${loc}»: ${bad.length ? bad.length + ' رشته‌ی فارسی به کاربر می‌رسد' : 'هیچ فارسی‌ای به کاربر نمی‌رسد'}`);
  bad.slice(0, 12).forEach(b => console.log(`       ${b}`));
}

/* ── ۲) گاردِ ساختاریِ ضدِ drift ─────────────────────────────────────────────
 * چکِ رفتاری بالا `L.buttons.topic(t, spreadName(t.fa))` را صدا می‌زند، یعنی
 * **آینه‌ی** کاری که index.js می‌کند. اگر یک روز index.js دوباره تک‌آرگومان صدایش
 * بزند، آینه همچنان سبز می‌ماند و باگ برمی‌گردد. پس خودِ فراخوان هم سنجیده می‌شود. */
console.log('\n▶ هر فراخوانیِ topic در index.js نامِ ترجمه‌شده را پاس می‌دهد');
const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const calls = [...SRC.matchAll(/L\.buttons\.topic\(([^)]*)\)/g)].map(m => m[1]);
ok(calls.length > 0, `${calls.length} فراخوانیِ L.buttons.topic پیدا شد`);
const bare = calls.filter(a => !a.includes(','));
ok(bare.length === 0, bare.length ? `تک‌آرگومان (فارسی برمی‌گردد): ${bare.join(' | ')}` : 'هیچ فراخوانیِ تک‌آرگومانی نیست');
ok(/spreadName\(faOf\(/.test(SRC), 'spreadFaOf نامِ چیدمان را از جدولِ زبان می‌گیرد');

/* ── ۳) قیمتِ استارز: عددِ روی دکمه = عددی که کسر می‌شود ─────────────────────
 * 🐛 باگِ همان روز: دکمه `p.toman` را با برچسبِ «ستاره» چاپ می‌کرد («۳۰٬۰۰۰ ستاره»)
 * در حالی که فاکتور ۱۰۰ ستاره کسر می‌کرد. هم‌خانواده‌ی باگِ ریال/تومانِ رسید: عدد
 * درست، **واحد** دروغ. پس این‌جا عددِ دکمه با عددِ فاکتور مقایسه می‌شود، نه با خودش. */
console.log('\n▶ قیمتِ روی دکمه با کسرِ واقعی یکی است');
const MONEY = String.raw`
const SP = await import('./bots/tarot/starspay.js');
const L  = (await import('./bots/tarot/locales/' + process.env.LOCALE + '.js')).default;
const PACKS = [{key:'basic',emoji:'A',coins:10,toman:30000},{key:'gold',emoji:'B',coins:30,toman:60000},{key:'magic',emoji:'C',coins:100,toman:150000}];
const cur = { on:true, value:3000, name:'', emoji:'D' };
const out = [];
for (const v of Object.keys(SP.STAR_LADDERS)) {
  const ladder = SP.ladderFor(v);
  for (const p of PACKS) {
    const stars = SP.starsFor(p.key, ladder);
    const label = L.buttons.coinPack(p, cur, stars);
    const charged = SP.buildInvoice({ pack:p, stars, paymentId:1, userId:2, title:'t', description:'d' }).prices[0].amount;
    const nums = (label.match(/\d[\d\s  ,.]*/g) || []).map(x => Number(x.replace(/[^\d]/g,'')));
    out.push({ v, k:p.key, charged, hasCharged: nums.includes(charged), hasToman: nums.includes(p.toman), label });
  }
}
// و حالتِ «قیمت نداریم»: باید هیچ عددِ قیمتی چاپ نشود، نه اینکه به تومان برگردد
const noPrice = L.buttons.coinPack(PACKS[0], cur, null);
out.push({ v:'null', k:'basic', noPriceLeaksToman: (noPrice.match(/\d[\d\s  ,.]*/g)||[]).map(x=>Number(x.replace(/[^\d]/g,''))).includes(30000), label:noPrice });
console.log(JSON.stringify(out));
`;
for (const loc of LOCALES) {
  const rows = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', MONEY],
    { env: { ...process.env, LOCALE: loc }, encoding: 'utf8', cwd: process.cwd() }).trim().split('\n').pop());
  const priced = rows.filter(r => r.v !== 'null');
  ok(priced.every(r => r.hasCharged), `«${loc}»: عددِ دکمه = کسرِ فاکتور در هر ${priced.length} حالت`);
  const lying = priced.filter(r => r.hasToman && !r.hasCharged);
  ok(lying.length === 0, lying.length ? `«${loc}»: قیمتِ تومانی با برچسبِ ستاره: ${lying[0].label}` : `«${loc}»: هیچ‌جا عددِ تومانی به‌جای ستاره چاپ نمی‌شود`);
  const nul = rows.find(r => r.v === 'null');
  ok(!nul.noPriceLeaksToman, `«${loc}»: بی‌قیمت یعنی بی‌عدد، نه بازگشت به تومان («${nul.label}»)`);
}

/* ── ۴) ادعاهای معکوس ────────────────────────────────────────────────────────
 * چکی که هیچ‌وقت قرمز نشود از چکِ نبودن بدتر است: امنیتِ کاذب می‌دهد. پس ثابت
 * می‌کنیم هر سه گاردِ بالا واقعاً می‌گیرند. */
console.log('\n▶ ادعاهای معکوس (گارد باید واقعاً بگیرد)');
const FA_RE = /[؀-ۿ]/;
ok(FA_RE.test('سؤال شخصی خودم'), 'ردیابِ فارسی متنِ فارسی را می‌گیرد');
ok(!FA_RE.test('Мой личный вопрос') && !FA_RE.test('Minha pergunta pessoal'), 'ردیابِ فارسی روی روسی و پرتغالی قرمزِ کاذب نمی‌دهد');
const fakeBare = 'Markup.button.callback(L.buttons.topic(t), `topic:${t.key}`)';
ok([...fakeBare.matchAll(/L\.buttons\.topic\(([^)]*)\)/g)].map(m => m[1]).filter(a => !a.includes(',')).length === 1,
  'گاردِ ساختاری فراخوانیِ تک‌آرگومانِ قدیمی را می‌گیرد');
ok([...('L.buttons.topic(t, spreadName(t.fa))').matchAll(/L\.buttons\.topic\(([^)]*)\)/g)]
  .map(m => m[1]).filter(a => !a.includes(',')).length === 0, 'و فراخوانیِ درست را قرمز نمی‌کند');

console.log(`\n${errs.length ? '❌' : '✅'} ${pass} ادعا سبز${errs.length ? `، ${errs.length} قرمز` : ''}`);
if (errs.length) { errs.forEach(e => console.error('  • ' + e)); process.exit(1); }
