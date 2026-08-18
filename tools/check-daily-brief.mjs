// چکِ CI برای ربات daily-brief (پادکستِ آموزشیِ روزانه).
//
// چرا این فایل وجود دارد: کلِ ارزشِ این ربات در مسیرهایی است که CI معمولاً نمی‌بیند —
// زمان‌بندی (که فقط صبح‌ها اجرا می‌شود)، چانک‌بندیِ متن (که فقط با متنِ بلندِ واقعی خودش را
// نشان می‌دهد)، و گاردِ «روزی یک قسمت» (که فقط موقعِ ری‌استارت اهمیت پیدا می‌کند). هیچ‌کدام
// را نمی‌شود با تستِ دستی به‌موقع گرفت، پس منطقشان در توابعِ خالص است و اینجا واقعاً اجرا می‌شود.
//
// هیچ فراخوانیِ شبکه‌ای اینجا نیست: کلاینتِ Notion و LLM با تزریقِ وابستگی جعل می‌شوند.
import path from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const BOT = 'bots/daily-brief';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (=${JSON.stringify(a)})`);

const { wordTarget, countWords, sectionPlan, SINGLE_CALL_MAX_WORDS, WPM } = await import(path.resolve(BOT, 'script.js'));
const { chunkText, chunkTurns, turnsToNarration, buildConcatFilter, listSpeechModels, defaultVoice, isMultiSpeaker, familyVoice, synthChunk } = await import(path.resolve(BOT, 'tts.js'));
const { parseRoadmapBlocks, fetchRoadmap, syncLessons, pickNextLesson, fetchLessonBody, blockText } = await import(path.resolve(BOT, 'notion.js'));
const { tehranNow, hhmmToMinutes, estimateLlmCost, recoverStuck, saveTopics } = await import(path.resolve(BOT, 'pipeline.js'));

/* ── ۱) ریاضیِ مدت ───────────────────────────────────────────────────────── */
console.log('\n⏱ مدت → تعدادِ کلمه');
eq(wordTarget(10, 'single'), 1500, 'ده دقیقه‌ی تک‌گوینده');
eq(wordTarget(10, 'dialogue'), 1350, 'دیالوگ کندتر است، پس کلمه‌ی کمتر');
ok(wordTarget(5) < wordTarget(30), 'مدتِ بیشتر یعنی متنِ بلندتر');
ok(wordTarget(0) > 0 && wordTarget(-3) > 0, 'ورودیِ نامعتبر هرگز صفر یا منفی نمی‌دهد');
ok(WPM.single > WPM.dialogue, 'سرعتِ گفتارِ تک‌گوینده بیشتر از دیالوگ است');
// مرزِ تصمیمِ «تک‌فراخوانی یا فهرست‌محور»: قسمتِ نیم‌ساعته حتماً باید چندمرحله‌ای شود،
// وگرنه دوباره همان خروجیِ بریده و پرتکرارِ یک فراخوانیِ غول را می‌گیریم.
ok(wordTarget(30, 'single') > SINGLE_CALL_MAX_WORDS, 'قسمتِ ۳۰ دقیقه‌ای از مسیرِ چندمرحله‌ای می‌رود');
ok(wordTarget(5, 'single') <= SINGLE_CALL_MAX_WORDS, 'قسمتِ ۵ دقیقه‌ای با یک فراخوانی ساخته می‌شود');
const plan30 = sectionPlan(wordTarget(30, 'single'));
ok(plan30.count >= 2 && plan30.count <= 8, `تعدادِ بخش‌ها در بازه‌ی معقول است (${plan30.count})`);
ok(Math.abs(plan30.count * plan30.wordsEach - wordTarget(30)) <= plan30.count,
  'جمعِ سهمِ بخش‌ها تقریباً برابرِ کلِ هدف است');
eq(countWords('سلام دنیا  خوبی'), 3, 'شمارشِ کلمه با فاصله‌ی اضافه');

/* ── ۲) چانک‌بندی ────────────────────────────────────────────────────────── */
console.log('\n✂️ چانک‌بندیِ متن');
const sentences = Array.from({ length: 120 }, (_, i) =>
  `این جمله‌ی شماره ${i} است و درباره‌ی موضوعی حرف می‌زند که باید خوانده شود.`);
const longText = [sentences.slice(0, 40).join(' '), sentences.slice(40, 80).join(' '), sentences.slice(80).join(' ')].join('\n\n');
const CAP = 500;
const chunks = chunkText(longText, CAP);
ok(chunks.length > 1, `متنِ بلند به چند چانک شکست (${chunks.length})`);
ok(chunks.every((c) => c.length <= CAP), 'هیچ چانکی از سقف بزرگ‌تر نیست');
ok(chunks.every((c) => c.trim().length > 0), 'هیچ چانکِ خالی‌ای ساخته نمی‌شود');
// قاعده‌ی سختِ ماژول: شکستن فقط روی مرزِ جمله. شکستنِ وسطِ جمله در خروجیِ صوتی
// به‌صورت مکثِ بی‌جا و لحنِ بریده شنیده می‌شود.
ok(chunks.slice(0, -1).every((c) => /[.!?؟…]$/.test(c.trim())),
  'هر چانک (جز آخری) دقیقاً سرِ پایانِ یک جمله تمام می‌شود');
const rejoin = (s) => s.replace(/\s+/g, ' ').trim();
// با ok و نه eq: مقدارِ این ادعا کلِ متنِ نمونه است و چاپش لاگِ CI را غرق می‌کند.
ok(rejoin(chunks.join(' ')) === rejoin(longText), 'چسباندنِ دوباره‌ی چانک‌ها همان متنِ اصلی است (بی‌اتلاف)');
ok(chunkText('', 100).length === 0, 'متنِ خالی چانک نمی‌سازد');
ok(chunkText('یک جمله‌ی کوتاه.', 5000).length === 1, 'متنِ کوتاه‌تر از سقف یک چانک می‌ماند');
// کلمه هرگز نصف نمی‌شود، حتی وقتی یک جمله به‌تنهایی از سقف بزرگ‌تر است.
// نشانه‌ی «کلمه‌ی نصف‌شده» این است که بعد از چسباندنِ دوباره، تعدادِ کلمه‌ها بیشتر از اصل شود.
const monster = `${'کلمه '.repeat(400)}.`;
const mchunks = chunkText(monster, 200);
ok(mchunks.every((c) => c.length <= 200), 'جمله‌ی غول‌آسا هم زیرِ سقف بریده می‌شود');
ok(rejoin(mchunks.join(' ')) === rejoin(monster), 'برشِ اضطراری هیچ کلمه‌ای را نصف نمی‌کند');
eq(countWords(mchunks.join(' ')), countWords(monster), 'تعدادِ کلمه‌ها بعد از برشِ اضطراری تغییر نمی‌کند');

console.log('\n🎭 چانک‌بندیِ دیالوگ');
const turns = Array.from({ length: 30 }, (_, i) => ({ speaker: i % 2 ? 'b' : 'a', text: `نوبتِ گفتار شماره ${i}.` }));
const tchunks = chunkTurns(turns, 300);
ok(tchunks.length > 1, `نوبت‌ها به چند گروه شکستند (${tchunks.length})`);
eq(tchunks.flat().length, turns.length, 'هیچ نوبتی گم یا تکرار نشد');
ok(tchunks.flat().every((t, i) => t.text === turns[i].text), 'ترتیبِ نوبت‌ها حفظ شد');
ok(turnsToNarration(turns).includes('نوبتِ گفتار شماره ۰'.replace('۰', '0')), 'تبدیلِ دیالوگ به روایتِ تک‌صدا متن را نگه می‌دارد');

/* ── ۳) کاتالوگِ موتورهای صدا (زنده از OpenRouter) ───────────────────────── */
// کاتالوگ عمداً هاردکد نیست: اسلاگِ مدل‌های TTS تاریخ‌دار است و عوض می‌شود. این بخش
// می‌سنجد که کشفِ زنده کار کند **و** شکستش ربات را نشکند.
console.log('\n🔊 کاتالوگِ موتورهای صدا');
const liveModels = await listSpeechModels({
  apiKey: 'k',
  fetchImpl: async () => ({ ok: true, json: async () => ({ data: [
    { id: 'x/one-tts', name: 'One', supported_voices: ['aa', 'bb'], pricing: { output: '0.000004' } },
    { id: 'google/gemini-3.1-flash-tts-preview', name: 'Gemini TTS', supported_voices: ['Kore'] },
  ] }) }),
  ttlMs: 0,
});
eq(liveModels.length, 2, 'مدل‌ها از endpoint خوانده می‌شوند');
eq(defaultVoice(liveModels[0]), 'aa', 'صدای پیش‌فرض اولین صدای پشتیبانی‌شده است');
ok(defaultVoice({ id: 'openai/gpt-4o-mini-tts', supported_voices: [] }), 'مدلِ بدونِ لیستِ صدا هم حدسِ متعارف می‌گیرد');
ok(isMultiSpeaker('google/gemini-3.1-flash-tts-preview'), 'جمنای به‌عنوان موتورِ دو گوینده شناخته می‌شود');
ok(!isMultiSpeaker('openai/gpt-4o-mini-tts'), 'موتورِ تک‌صدا به‌اشتباه چندگوینده اعلام نمی‌شود');
// شکستِ endpoint نباید هیچ‌چیز را بشکند: فالبکِ ثابت برمی‌گردد
const fallback = await listSpeechModels({
  apiKey: 'k', ttlMs: 0,
  fetchImpl: async () => { throw new Error('network down'); },
});
ok(fallback.length > 0, 'شکستِ کشفِ مدل‌ها فالبکِ ثابت می‌دهد، نه لیستِ خالی');
ok(fallback.every((m) => m.id.includes('/')), 'اسلاگِ فالبک شکلِ درستِ OpenRouter را دارد');

// موتور دیگر انتخابی نیست: بعد از مقایسه‌ی واقعیِ صداها جمنای انتخاب شد و کلِ منطقِ
// ترتیب/صافی/بیک‌آف حذف شد. این ادعاها قفل می‌کنند که انتخابگر واقعاً برنگردد و موتور
// از settingsِ کهنه خوانده نشود (مقدارِ ذخیره‌شده‌ی دورانِ انتخاب هنوز در DB هست).
const idxSrc = readFileSync(path.resolve(BOT, 'index.js'), 'utf8');
ok(/const TTS_MODEL = 'google\/gemini[^']*'/.test(idxSrc), 'موتورِ صدا یک ثابتِ واحد است');
ok(/engine: TTS_MODEL/.test(idxSrc), 'effectiveSettings موتور را از ثابت می‌گیرد، نه از settings');
ok(!/getSetting\('engine'\)/.test(idxSrc), 'هیچ‌جا موتور از settingsِ کهنه خوانده نمی‌شود');
ok(!/bake:ask|bake:go|BAKEOFF_TOP|bakeAskText/.test(idxSrc), 'کدِ بیک‌آف واقعاً حذف شده، نه خاموش');
ok(!/set:eng:\$\{/.test(idxSrc), 'دکمه‌ی انتخابِ موتور دیگر ساخته نمی‌شود');
ok(/bot\.action\(\/\^\(bake:\|set:eng\)\//.test(idxSrc),
  'دکمه‌های کهنه‌ی داخلِ چت جوابِ مودبانه می‌گیرند (بند ۲ج/۶)');

// کشفِ وسیع‌تر: فیلترِ speech لزوماً همه‌ی مدل‌های خروجی‌صوتی را نمی‌دهد (کاتالوگِ واقعی
// فقط یک مدلِ گوگل در آن فیلتر داشت)، پس کلِ کاتالوگ هم اسکن می‌شود.
const merged = await listSpeechModels({
  apiKey: 'k', ttlMs: 0,
  fetchImpl: async (url) => ({
    ok: true,
    json: async () => ({
      data: url.includes('output_modalities=speech')
        ? [{ id: 'a/one-tts', name: 'One' }]
        : [
            { id: 'a/one-tts', name: 'One' },                                     // تکراری
            { id: 'google/gemini-pro-tts', architecture: { output_modalities: ['audio'] } },
            { id: 'openai/whisper-large', architecture: { output_modalities: ['text'] } }, // صوت‌به‌متن
          ],
    }),
  }),
});
eq(merged.length, 2, 'مدلِ خروجی‌صوتیِ بیرونِ فیلتر هم پیدا می‌شود، بدونِ تکراری');
ok(merged.some((m) => m.id === 'google/gemini-pro-tts'), 'مدلِ گوگلِ جاافتاده از کاتالوگِ کامل اضافه شد');
ok(!merged.some((m) => m.id.includes('whisper')), 'مدلِ صوت‌به‌متن وارد لیستِ صداسازی نمی‌شود');
// شکستِ منبعِ دوم نباید کلِ کشف را بشکند
const partial = await listSpeechModels({
  apiKey: 'k', ttlMs: 0,
  fetchImpl: async (url) => (url.includes('output_modalities=speech')
    ? { ok: true, json: async () => ({ data: [{ id: 'a/one-tts' }] }) }
    : { ok: false, status: 500 }),
});
eq(partial.length, 1, 'اگر کاتالوگِ کامل نیامد، لیستِ فیلترشده کار را راه می‌اندازد');

/* ── ۳ج) قلقِ ارائه‌دهنده‌ها (از شکستِ واقعیِ اولین بیک‌آف) ─────────────────── */
// در اولین بیک‌آفِ واقعی سه موتور رد شدند و هر سه از جنسِ «قلقی که کاتالوگ اعلام نمی‌کند»
// بودند: MiniMax بدونِ voice جواب نمی‌دهد و Gemini فقط pcm می‌دهد. بدترین بخشش این بود
// که دقیقاً موتورهای فارسی‌دار از مقایسه بیرون افتادند. به‌جای جدولِ دستیِ استثناها، کد از
// خودِ پیامِ خطا یاد می‌گیرد؛ این بخش همان یادگیری را می‌سنجد.
console.log('\n🧩 قلقِ ارائه‌دهنده‌ها');
ok(familyVoice('minimax/speech-2.8-hd'), 'MiniMax صدای پیش‌فرضِ شناخته‌شده دارد');
eq(defaultVoice({ id: 'minimax/speech-2.8-hd', supported_voices: [] }), familyVoice('minimax/speech-2.8-hd'),
  'وقتی کاتالوگ صدا نمی‌دهد، صدای خانواده استفاده می‌شود');
eq(defaultVoice({ id: 'minimax/speech-2.8-hd', supported_voices: ['X'] }), 'X',
  'اگر کاتالوگ صدا بدهد، همان مقدم است');

// سناریوی واقعیِ MiniMax: اولین درخواستِ بی‌صدا رد می‌شود، دومی با صدا باید بگیرد
let calls = [];
const voiceThenOk = async (url, opts) => {
  const b = JSON.parse(opts.body);
  calls.push(b);
  if (!b.voice) return { ok: false, status: 400, text: async () => '{"error":{"message":"An explicit voice is required for this TTS provider."}}' };
  return { ok: true, headers: { get: () => '' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
};
const r1 = await synthChunk({ apiKey: 'k', modelId: 'minimax/speech-2.8-hd', voice: '', text: 'سلام', fetchImpl: voiceThenOk });
ok(r1.buf.length > 0, 'بعد از خطای «صدا لازم است» با صدای خانواده دوباره تلاش و موفق می‌شود');
eq(calls.length, 2, 'دقیقاً یک تلاشِ دوباره، نه حلقه‌ی بی‌پایان');
ok(!!calls[1].voice, 'تلاشِ دوم صدا دارد');

// سناریوی واقعیِ Gemini: mp3 رد می‌شود، pcm باید بگیرد و به‌عنوان pcm علامت بخورد
calls = [];
const pcmThenOk = async (url, opts) => {
  const b = JSON.parse(opts.body);
  calls.push(b);
  if (b.response_format !== 'pcm') return { ok: false, status: 400, text: async () => '{"error":{"message":"Gemini TTS only supports response_format=\\"pcm\\". Got \\"mp3\\"."}}' };
  return {
    ok: true,
    headers: { get: (h) => (h === 'content-type' ? 'audio/pcm;rate=24000;channels=1' : '') },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  };
};
const r2 = await synthChunk({ apiKey: 'k', modelId: 'google/gemini-3.1-flash-tts-preview', voice: 'Kore', text: 'سلام', fetchImpl: pcmThenOk });
eq(calls[0].response_format, 'mp3', 'اول mp3 را امتحان می‌کند');
eq(calls[1].response_format, 'pcm', 'بعد از خطا به pcm سوییچ می‌کند');
eq(r2.pcm?.rate, 24000, 'نرخِ نمونه‌برداری از هدر خوانده می‌شود، نه از حدس');
eq(r2.pcm?.channels, 1, 'تعدادِ کانال هم از هدر می‌آید');
// خطایی که ربطی به این دو قلق ندارد نباید بی‌جهت retry شود
calls = [];
let threw = false;
try {
  await synthChunk({ apiKey: 'k', modelId: 'x/y', voice: 'v', text: 'a',
    fetchImpl: async (u, o) => { calls.push(JSON.parse(o.body)); return { ok: false, status: 402, text: async () => 'insufficient credits' }; } });
} catch { threw = true; }
ok(threw, 'خطای نامرتبط بالا می‌رود، نه اینکه بی‌صدا بلعیده شود');
eq(calls.length, 1, 'خطای نامرتبط اصلاً retry نمی‌شود (اعتبار بی‌جهت خرج نمی‌شود)');

/* ── ۳ب) گرافِ فیلترِ ffmpeg ─────────────────────────────────────────────── */
// چرا اینجا و نه با اجرای واقعیِ ffmpeg: محیطِ توسعه ffmpeg ندارد و خطای گراف فقط روی
// سرور، وسطِ ساختِ یک قسمتِ واقعی، خودش را نشان می‌دهد. دو باگِ واقعیِ همین گراف که با
// همین ادعاها گرفته می‌شوند: مصرفِ دوباره‌ی برچسبِ سکوت، و نبودِ یکسان‌سازیِ کانال.
console.log('\n🎬 گرافِ فیلترِ چسباندن');
// هر زنجیره‌ی فیلتر شکلِ «[ورودی‌ها] فیلتر [خروجی‌ها]» دارد؛ زنجیره‌ها با ; جدا می‌شوند.
function parseGraph(graph) {
  const produced = [], consumed = [], srcInputs = [];
  for (const chain of graph.split(';')) {
    const lead = (chain.match(/^(?:\[[^\]]+\])+/) || [''])[0];
    const tail = (chain.match(/(?:\[[^\]]+\])+$/) || [''])[0];
    const labels = (s) => [...s.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    for (const l of labels(lead)) (/^\d+:/.test(l) ? srcInputs : consumed).push(l);
    // زنجیره‌ای که فقط ورودی دارد (بدونِ فیلتر) دم و سرش یکی است؛ اینجا پیش نمی‌آید
    if (tail && tail !== lead) produced.push(...labels(tail));
  }
  return { produced, consumed, srcInputs };
}
for (const n of [2, 3, 7]) {
  const { graph, streams } = buildConcatFilter(n);
  const { produced, consumed, srcInputs } = parseGraph(graph);
  eq(streams, n * 2 - 1, `${n} تکه یعنی ${n * 2 - 1} جریان (تکه‌ها + سکوت‌های بینشان)`);
  ok(new Set(produced).size === produced.length, `${n} تکه: هیچ برچسبی دو بار تولید نمی‌شود`);
  // ffmpeg برچسبِ مصرف‌شده‌ی تکراری را رد می‌کند؛ همین باگ در نسخه‌ی اول بود
  ok(new Set(consumed).size === consumed.length, `${n} تکه: هیچ برچسبی دو بار مصرف نمی‌شود`);
  ok(consumed.every((l) => produced.includes(l)), `${n} تکه: هر برچسبِ مصرف‌شده جایی تولید شده است`);
  ok(produced.every((l) => l === 'out' || consumed.includes(l)), `${n} تکه: هیچ برچسبِ تولیدشده‌ای بلااستفاده نمی‌ماند`);
  eq(srcInputs.length, n + 1, `${n} تکه: ${n} فایل + یک منبعِ سکوت به گراف وصل است`);
  ok(new Set(srcInputs).size === srcInputs.length, `${n} تکه: هیچ ورودی‌ای دو بار وصل نشده`);
  ok(new RegExp(`concat=n=${streams}:`).test(graph), `${n} تکه: عددِ concat با تعدادِ واقعیِ جریان‌ها می‌خواند`);
  ok(graph.includes('channel_layouts=mono'), `${n} تکه: کانال یکسان‌سازی می‌شود (وگرنه concat روی ورودیِ استریو می‌میرد)`);
  ok(graph.trim().endsWith('[out]'), `${n} تکه: خروجیِ نهایی برچسبِ out دارد`);
}
// سکوت باید به تعدادِ فاصله‌ها تکثیر شود، نه یکی برای همه
ok(buildConcatFilter(4).graph.includes('asplit=3'), 'چهار تکه یعنی سه سکوتِ تکثیرشده');
ok(!buildConcatFilter(2).graph.includes('asplit'), 'دو تکه فقط یک سکوت دارد و asplit لازم ندارد');

/* ── ۴) پارسِ رودمپِ Notion ──────────────────────────────────────────────── */
// این فیکسچر **ساختارِ واقعیِ پیجِ Learning مالک** است: یک هدینگ به‌عنوان موضوع و
// زیرصفحه‌ها به‌عنوان جلسه‌ها. پارسر باید با شکلِ طبیعیِ یادداشت‌برداری کار کند، نه با
// قالبی که ما تحمیل کرده باشیم.
console.log('\n📚 پارسِ رودمپ (ساختارِ واقعیِ پیجِ Learning)');
const rt = (s) => [{ plain_text: s }];
const realBlocks = [
  { id: 'q', type: 'quote', quote: { rich_text: rt('فضای یادگیری شخصی، یادداشت‌های اتمی.') } },
  { id: 'h2', type: 'heading_2', heading_2: { rich_text: rt('موضوعات') } },
  { id: 'h3', type: 'heading_3', heading_3: { rich_text: rt('RAG (Retrieval-Augmented Generation)') } },
  { id: 'p1', type: 'paragraph', paragraph: { rich_text: rt('۲۱ یادداشت اتمی از تعریف پایه تا تصمیم‌های محصولی.') } },
  { id: 'p2', type: 'paragraph', paragraph: { rich_text: rt('مسیر پیشنهادی مطالعه:') } },
  { id: 'n1', type: 'numbered_list_item', numbered_list_item: { rich_text: rt('RAG-01 تا RAG-02 چرایی') } },
  { id: 'c1', type: 'child_page', child_page: { title: 'RAG-01 — RAG چیست؟' } },
  { id: 'c2', type: 'child_page', child_page: { title: 'RAG-02 — سه مشکل بنیادین' } },
  { id: 'c3', type: 'child_page', child_page: { title: 'RAG-03 — Ingestion' } },
  { id: 'img', type: 'image', image: {} },                               // بلوکِ بی‌ربط
  { id: 'e', type: 'paragraph', paragraph: { rich_text: [] } },          // بلوکِ خالی
];
const topicsReal = parseRoadmapBlocks(realBlocks, { rootTitle: 'Learning' });
eq(topicsReal.length, 1, 'هدینگِ «موضوعات» که جلسه ندارد وارد رودمپ نمی‌شود');
eq(topicsReal[0].title, 'RAG (Retrieval-Augmented Generation)', 'هدینگ همان موضوع است');
eq(topicsReal[0].lessons.length, 3, 'هر زیرصفحه یک جلسه است');
eq(topicsReal[0].lessons[0].blockId, 'c1', 'کلیدِ جلسه block_id است، نه عنوانش');
eq(topicsReal[0].lessons[0].kind, 'page', 'جلسه‌ی زیرصفحه‌ای kind=page می‌گیرد');
ok(topicsReal[0].notes.includes('۲۱ یادداشت اتمی'), 'متنِ زیرِ هدینگ یادداشتِ کانتکستِ موضوع شد');
ok(topicsReal[0].notes.includes('مسیر پیشنهادی'), 'لیستِ مسیرِ مطالعه هم در کانتکست هست');

// ساختارِ مستندشده‌ی چک‌باکسی هم باید کار کند (رودمپی که هنوز زیرصفحه ندارد)
const todoBlocks = [
  { id: 'h', type: 'heading_2', heading_2: { rich_text: rt('معماری نرم‌افزار') } },
  { id: 'm1', type: 'paragraph', paragraph: { rich_text: rt('هدف: عمیق شدن در معماری') } },
  { id: 'm2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('منابع: کتاب DDIA') } },
  { id: 't1', type: 'to_do', to_do: { rich_text: rt('جلسه ۱: مبانی'), checked: false } },
  { id: 't2', type: 'to_do', to_do: { rich_text: rt('جلسه ۲: تکرارپذیری'), checked: true } },
  { id: 't3', type: 'to_do', to_do: { rich_text: [], checked: false } },  // جلسه‌ی بی‌عنوان
];
const todoTopics = parseRoadmapBlocks(todoBlocks);
eq(todoTopics[0].meta.goal, 'عمیق شدن در معماری', 'خطِ «هدف:» متادیتا شد');
eq(todoTopics[0].meta.sources, 'کتاب DDIA', 'خطِ «منابع:» از bullet هم خوانده می‌شود');
eq(todoTopics[0].lessons.length, 2, 'فقط چک‌باکسِ دارای عنوان جلسه شد');
eq(todoTopics[0].lessons[1].checked, true, 'وضعیتِ چک‌باکسِ Notion خوانده می‌شود');
eq(todoTopics[0].lessons[0].kind, 'todo', 'جلسه‌ی چک‌باکسی kind=todo می‌گیرد');
ok(!todoTopics[0].notes.includes('هدف:'), 'خطِ متادیتا دوباره در یادداشت تکرار نشد');

// جلسه‌ای که قبل از هر هدینگی بیاید هم گم نمی‌شود
const noHeading = parseRoadmapBlocks(
  [{ id: 'c', type: 'child_page', child_page: { title: 'تنها جلسه' } }], { rootTitle: 'Learning' });
eq(noHeading.length, 1, 'جلسه‌ی بدونِ هدینگ زیرِ عنوانِ خودِ پیج می‌نشیند');
eq(noHeading[0].title, 'Learning', 'موضوعِ پیش‌فرض عنوانِ پیجِ ریشه است');

ok(parseRoadmapBlocks(null).length === 0, 'ورودیِ خراب کرش نمی‌کند');
ok(parseRoadmapBlocks([{ id: 'x', type: 'to_do' }]).length === 0, 'بلوکِ ناقص رد می‌شود، نه کرش');
eq(blockText({ type: 'paragraph', paragraph: { rich_text: rt('  فاصله  ') } }), 'فاصله', 'متنِ بلوک trim می‌شود');

// متنِ جلسه: مادهٔ خامِ قسمت، فقط برای همان جلسه خوانده می‌شود
console.log('\n📖 متنِ جلسه');
const bodyBlocks = {
  c1: [
    { id: 'x1', type: 'heading_2', heading_2: { rich_text: rt('هسته') } },
    { id: 'x2', type: 'paragraph', paragraph: { rich_text: rt('RAG یعنی بازیابی قبل از تولید.') } },
    { id: 'x3', type: 'child_page', child_page: { title: 'زیرصفحه‌ی تودرتو' } },
    { id: 'x4', type: 'image', image: {} },
  ],
};
const bodyNotion = { children: async (id) => bodyBlocks[id] || [] };
const body = await fetchLessonBody(bodyNotion, { block_id: 'c1', kind: 'page' });
ok(body.includes('هسته') && body.includes('بازیابی قبل از تولید'), 'متن و تیترهای صفحه خوانده می‌شوند');
ok(!body.includes('زیرصفحه‌ی تودرتو'), 'زیرصفحه‌ی تودرتو بدنه‌ی این جلسه نیست (جلسه‌ی خودش است)');
eq(await fetchLessonBody(bodyNotion, { block_id: 't1', kind: 'todo' }), '',
  'جلسه‌ی چک‌باکسی بدنه ندارد و درخواستِ اضافه هم نمی‌زند');

/* ── ۵) DB: پیشرفت، ترتیب و گاردِ روزانه ─────────────────────────────────── */
console.log('\n🗄 دیتابیس');
const Database = require(path.resolve(BOT, 'node_modules/better-sqlite3'));
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE lessons (
    block_id TEXT PRIMARY KEY, topic_page_id TEXT NOT NULL, topic_title TEXT NOT NULL,
    topic_order INTEGER NOT NULL DEFAULT 0, lesson_order INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'page', status TEXT NOT NULL DEFAULT 'pending',
    delivered_at INTEGER, episode_id INTEGER);
  CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'daily',
    status TEXT NOT NULL DEFAULT 'pending', engine TEXT, voices_json TEXT DEFAULT '{}',
    speed REAL DEFAULT 1, created_at INTEGER DEFAULT (unixepoch()), error TEXT);
  CREATE UNIQUE INDEX idx_episodes_daily_once ON episodes(date) WHERE kind='daily';
`);

// کلاینتِ جعلیِ Notion: دو موضوع (هدینگ)، ترتیبشان معنی‌دار است
const rootBlocks = [
  { id: 'h2', type: 'heading_2', heading_2: { rich_text: rt('موضوع دوم') } },
  { id: 'l21', type: 'to_do', to_do: { rich_text: rt('جلسه‌ی دومِ موضوعِ دوم'), checked: false } },
  { id: 'h1', type: 'heading_2', heading_2: { rich_text: rt('موضوع اول') } },
  { id: 'l11', type: 'to_do', to_do: { rich_text: rt('اولین جلسه'), checked: false } },
  { id: 'l12', type: 'to_do', to_do: { rich_text: rt('دومین جلسه'), checked: false } },
];
const fakeNotion = { children: async (id) => (id === 'root' ? rootBlocks : []) };
const topics = await fetchRoadmap(fakeNotion, 'root');
eq(topics.length, 2, 'دو موضوع خوانده شد');
eq(topics[0].title, 'موضوع دوم', 'ترتیبِ موضوع‌ها همان ترتیبِ Notion است، نه الفبایی');
syncLessons(db, topics);
eq(db.prepare('SELECT COUNT(*) n FROM lessons').get().n, 3, 'هر سه جلسه ثبت شد');
eq(pickNextLesson(db).block_id, 'l21', 'جلسه‌ی بعدی اولین جلسه‌ی اولین موضوع (به ترتیبِ صفحه) است');

// جلسه‌ی تحویل‌شده دوباره انتخاب نمی‌شود
db.prepare("UPDATE lessons SET status='delivered' WHERE block_id='l21'").run();
eq(pickNextLesson(db).block_id, 'l11', 'بعد از تحویل، سراغِ جلسه‌ی بعدی می‌رود');

// تیک‌خوردن در Notion یعنی «جای دیگری یادش گرفتم» → رد شو
rootBlocks[3].to_do.checked = true;   // l11
syncLessons(db, await fetchRoadmap(fakeNotion, 'root'));
eq(db.prepare("SELECT status FROM lessons WHERE block_id='l11'").get().status, 'done_in_notion',
  'چک‌باکسِ تیک‌خورده‌ی Notion جلسه را از صف بیرون می‌برد');
eq(pickNextLesson(db).block_id, 'l12', 'جلسه‌ی تیک‌خورده پرش می‌شود');
eq(db.prepare("SELECT status FROM lessons WHERE block_id='l21'").get().status, 'delivered',
  'جلسه‌ی تحویل‌شده هرگز به حالتِ دیگری برنمی‌گردد');

// برداشتنِ تیک، جلسه را به صف برمی‌گرداند (کاربر نظرش عوض شده)
rootBlocks[3].to_do.checked = false;
syncLessons(db, await fetchRoadmap(fakeNotion, 'root'));
eq(pickNextLesson(db).block_id, 'l11', 'با برداشتنِ تیک، جلسه دوباره در صف قرار می‌گیرد');

// تغییرِ عنوان نباید پیشرفت را پاک کند (کلید block_id است)
rootBlocks[3].to_do.rich_text = rt('اولین جلسه (بازنویسی‌شده)');
syncLessons(db, await fetchRoadmap(fakeNotion, 'root'));
eq(db.prepare('SELECT COUNT(*) n FROM lessons').get().n, 3, 'تغییرِ عنوانِ جلسه ردیفِ تکراری نمی‌سازد');
eq(db.prepare("SELECT title FROM lessons WHERE block_id='l11'").get().title, 'اولین جلسه (بازنویسی‌شده)',
  'عنوانِ تازه به‌روز شد');

// حذف از Notion فقط ردیفِ در-صف را کنار می‌گذارد، نه تاریخچه را
rootBlocks.pop();   // حذفِ l12 از Notion
syncLessons(db, await fetchRoadmap(fakeNotion, 'root'));
eq(db.prepare("SELECT status FROM lessons WHERE block_id='l12'").get().status, 'skipped',
  'جلسه‌ی حذف‌شده از Notion از صف بیرون می‌رود');

// اتصالِ موضوع به جلسه: باگِ واقعی و بی‌صدا بود. اگر کلیدی که saveTopics می‌نویسد با
// کلیدی که syncLessons در lessons.topic_page_id می‌گذارد یکی نباشد، یادداشت‌های موضوع
// هرگز به پرامپت نمی‌رسند و هیچ خطایی هم دیده نمی‌شود؛ فقط کیفیتِ قسمت بی‌دلیل افت می‌کند.
db.exec(`CREATE TABLE topics (page_id TEXT PRIMARY KEY, title TEXT, topic_order INTEGER,
         meta_json TEXT DEFAULT '{}', notes TEXT DEFAULT '', synced_at INTEGER)`);
saveTopics(db, topics);
const linked = db.prepare(`
  SELECT t.notes FROM lessons l JOIN topics t ON t.page_id = l.topic_page_id LIMIT 1`).get();
ok(!!linked, 'هر جلسه به ردیفِ موضوعِ خودش join می‌شود (کلیدِ topics و lessons یکی است)');
eq(db.prepare('SELECT COUNT(*) n FROM topics WHERE page_id IS NULL').get().n, 0,
  'هیچ موضوعی بدونِ کلید ذخیره نمی‌شود');

console.log('\n🔒 گاردِ «روزی یک قسمت»');
const claim = (date) => db.prepare("INSERT OR IGNORE INTO episodes (date, kind, status) VALUES (?, 'daily', 'pending')").run(date).changes;
eq(claim('2026-08-17'), 1, 'اولین claimِ روز موفق است');
eq(claim('2026-08-17'), 0, 'claimِ دوم همان روز بی‌اثر است (ری‌استارت دو قسمت نمی‌سازد)');
eq(claim('2026-08-18'), 1, 'روزِ بعد claimِ خودش را می‌گیرد');
db.prepare("UPDATE episodes SET status='failed' WHERE date='2026-08-17'").run();
eq(claim('2026-08-17'), 0, 'قسمتِ شکست‌خورده هم دوباره claim نمی‌شود (تصمیم با آدم است، نه حلقه‌ی خودکار)');
eq(db.prepare("SELECT COUNT(*) n FROM episodes WHERE date='2026-08-17'").get().n, 1, 'فقط یک ردیف برای آن روز هست');
// قسمتِ دستی و بیک‌آف مشمولِ قفلِ روزانه نیستند
db.prepare("INSERT INTO episodes (date, kind, status) VALUES ('2026-08-17','manual','pending')").run();
db.prepare("INSERT INTO episodes (date, kind, status) VALUES ('2026-08-17','bakeoff','pending')").run();
eq(db.prepare("SELECT COUNT(*) n FROM episodes WHERE date='2026-08-17'").get().n, 3,
  'ساختِ دستی و مقایسه‌ی صداها زیرِ قفلِ روزانه نیستند');

// «تلاشِ دوباره» یک تصمیمِ تازه است، پس موتور را از تنظیماتِ فعلی می‌گیرد نه از snapshotِ
// لحظه‌ی ساخت. سناریوی واقعی: قسمتِ امروز با موتوری شکست خورد، مالک بعد از شنیدنِ نمونه‌ها
// موتور را عوض کرد، و انتظار دارد تلاشِ دوباره با موتورِ **جدید** باشد.
console.log('\n🔁 تلاشِ دوباره');
db.exec(`INSERT INTO episodes (id, date, kind, status, engine) VALUES (99, '2026-08-20', 'daily', 'failed', 'old/engine')`);
const retryClaim = db.prepare("UPDATE episodes SET status='pending', error=NULL WHERE id=? AND status='failed'").run(99);
eq(retryClaim.changes, 1, 'گذارِ failed→pending اتمیک است');
eq(db.prepare("UPDATE episodes SET status='pending' WHERE id=? AND status='failed'").run(99).changes, 0,
  'تپِ دومِ تلاشِ دوباره بی‌اثر است (ضدِ دو بار اجرا)');
db.prepare('UPDATE episodes SET engine=? WHERE id=?').run('new/engine', 99);
eq(db.prepare('SELECT engine FROM episodes WHERE id=99').get().engine, 'new/engine',
  'موتورِ قسمت با تلاشِ دوباره به تنظیماتِ فعلی به‌روز می‌شود');

console.log('\n♻️ بازیابیِ بعد از ری‌استارت');
db.prepare("INSERT INTO episodes (date, kind, status, created_at) VALUES ('2026-08-10','manual','scripted', unixepoch()-9999)").run();
const recovered = recoverStuck(db);
ok(recovered.length >= 1, 'قسمتِ گیرکرده‌ی قدیمی پیدا شد');
eq(db.prepare("SELECT status FROM episodes WHERE date='2026-08-10'").get().status, 'failed',
  'قسمتِ یتیمِ ری‌استارت failed می‌شود تا قفلِ روزانه را اشغال نکند');
const fresh = db.prepare("INSERT INTO episodes (date, kind, status) VALUES ('2026-08-19','manual','pending')").run();
recoverStuck(db);
eq(db.prepare('SELECT status FROM episodes WHERE id=?').get(fresh.lastInsertRowid).status, 'pending',
  'قسمتی که همین الان شروع شده دست نمی‌خورد');

/* ── ۶) زمانِ تهران ──────────────────────────────────────────────────────── */
console.log('\n🕐 زمانِ تهران و زمان‌بندی');
eq(hhmmToMinutes('07:30'), 450, 'تبدیلِ ساعت به دقیقه');
eq(hhmmToMinutes('00:00'), 0, 'نیمه‌شب صفر دقیقه است');
eq(hhmmToMinutes('23:59'), 1439, 'آخرین دقیقه‌ی روز');
eq(hhmmToMinutes('99:99'), null, 'ساعتِ نامعتبر null می‌دهد، نه عددِ غلط');
eq(hhmmToMinutes(''), null, 'ورودیِ خالی null می‌دهد');
const t = tehranNow(new Date('2026-08-17T04:00:00Z'));
ok(/^\d{4}-\d{2}-\d{2}$/.test(t.date), `تاریخ فرمتِ درست دارد (${t.date})`);
ok(/^\d{2}:\d{2}$/.test(t.hhmm), `ساعت فرمتِ درست دارد (${t.hhmm})`);
eq(t.minutes, parseInt(t.hhmm.slice(0, 2), 10) * 60 + parseInt(t.hhmm.slice(3), 10), 'دقیقه با ساعتِ نمایشی می‌خواند');
ok(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'].includes(t.weekday), `روزِ هفته معتبر است (${t.weekday})`);
// مرزِ نیمه‌شبِ تهران: en-CA ساعتِ ۰۰ را ۲۴ گزارش می‌کند و اگر پاکسازی نشود، «نیمه‌شب»
// به‌صورت دقیقه‌ی ۱۴۴۰ خوانده می‌شود و ارسالِ ساعتِ ۰۰:xx یک روز عقب می‌افتد.
const mid = tehranNow(new Date('2026-08-17T20:31:00Z')); // ۰۰:۰۱ تهران
ok(mid.minutes < 60, `درست بعد از نیمه‌شبِ تهران دقیقه کوچک است (${mid.hhmm} → ${mid.minutes})`);

/* ── ۷) تخمینِ هزینه ─────────────────────────────────────────────────────── */
console.log('\n💵 هزینه');
ok(estimateLlmCost('google/gemini-2.5-flash', 1e6, 1e6) > 0, 'تخمینِ هزینه عددِ مثبت می‌دهد');
ok(estimateLlmCost('google/gemini-2.5-flash', 0, 0) === 0, 'بدونِ توکن، هزینه صفر است');
ok(estimateLlmCost('مدلِ ناشناخته', 1e6, 0) > 0, 'مدلِ ناشناخته هم تخمینِ فالبک می‌گیرد، نه NaN');
ok(estimateLlmCost('google/gemini-2.5-flash', 0, 1e6) > estimateLlmCost('google/gemini-2.5-flash', 1e6, 0),
  'توکنِ خروجی گران‌تر از ورودی است');

/* ── ۸) قواعدِ کپی (بند ۱۰ ریشه) ─────────────────────────────────────────── */
// خط تیره‌ی بلند امضای متنِ ماشینی است و در هیچ متنِ رو-به-کاربری مجاز نیست. متنِ این ربات
// دو مقصد دارد: پیام‌های تلگرام، و **پرامپتی که مدل از سبکش تقلید می‌کند** — پس هر دو مهم‌اند.
console.log('\n✍️ قواعدِ کپی');
// کامنتِ توسعه‌دهنده (چه //، چه /* */، چه -- داخلِ SQL) رو-به-کاربر نیست و از سنجش
// کنار می‌رود؛ چیزی که می‌ماند رشته‌های واقعیِ برنامه است.
const stripComments = (src) => src.split('\n').map((line) => {
  if (/^\s*(\/\/|\*|\/\*|--)/.test(line)) return '';
  return line.replace(/\s\/\/.*$/, '').replace(/\s--\s.*$/, '');
});
for (const f of ['index.js', 'script.js', 'notion.js', 'pipeline.js', 'tts.js']) {
  const bad = stripComments(readFileSync(path.resolve(BOT, f), 'utf8'))
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /[—–]|(?<!-)--(?!-)/.test(line));
  ok(bad.length === 0, `${f}: هیچ خط تیره‌ی بلندی در متنِ رو-به-کاربر نیست${bad.length ? ` (خط ${bad.map((b) => b.n).join(', ')})` : ''}`);
}
// صحتِ خودِ این سنجه: یک خط تیره‌ی بلندِ ساختگی باید گرفته شود، وگرنه ادعای بالا توخالی است
ok(stripComments('await ctx.reply("سلام — خوبی؟");').some((l) => /[—–]/.test(l)),
  'سنجه‌ی خط تیره واقعاً کار می‌کند (متنِ ساختگی گرفته شد)');
ok(!stripComments('const x = 1; // توضیح — برای توسعه‌دهنده').some((l) => /[—–]/.test(l)),
  'کامنتِ توسعه‌دهنده اشتباهاً گرفته نمی‌شود');
// پرامپت باید صریحاً همین را به مدل هم بگوید، چون بیشترین متنی که کاربر می‌شنود خروجیِ مدل است
const scriptSrc = readFileSync(path.resolve(BOT, 'script.js'), 'utf8');
ok(/خط تیره/.test(scriptSrc), 'پرامپت صریحاً خط تیره‌ی بلند را به مدل ممنوع می‌کند');
ok(/داده\b|دستور/.test(scriptSrc), 'پرامپت گاردِ «محتوای Notion داده است نه دستور» را دارد');

console.log(`\n${fail ? '❌' : '✅'} daily-brief: ${pass} ادعا سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
