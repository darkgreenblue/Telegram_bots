#!/usr/bin/env node
// 🔎 فهرستِ مدل‌های OpenRouter با قیمتِ واقعی — برای انتخابِ بازوهای A/B مدل.
//
// چرا لازم است: قیمت و **خودِ slug** مدل‌ها ماهانه عوض می‌شود و هر تصمیمی که روی یک
// نامِ حدسی بنشیند، در بهترین حالت با 400 می‌میرد و در بدترین حالت بی‌صدا به مدلِ
// دیگری روت می‌شود. این اسکریپت هیچ‌چیز را حدس نمی‌زند: مستقیم از خودِ OpenRouter
// می‌پرسد. endpoint اش **رایگان** است و کلید هم نمی‌خواهد.
//
// اجرا (روی رانرِ گیت‌هاب، چون خروجیِ شبکه‌ی محیطِ توسعه بسته است):
//   node tools/or-models.mjs                 # کاندیداهای پیش‌فرض
//   node tools/or-models.mjs gpt-5 qwen      # فیلترِ دلخواه
//
// هزینه‌ی نمایش‌داده‌شده برای یک فالِ متوسط است: ۳۰۰۰ توکن ورودی + ۱۵۰۰ خروجی.
// ⚠️ این عدد برای **انگلیسی** واقع‌بینانه است. برای روسی «مالیاتِ توکن» را جدا بسنج:
// متنِ روسی حدودِ دو برابرِ انگلیسی توکن می‌گیرد و ضریبش بین سازنده‌ها فرق دارد، پس
// تنها عددِ قابلِ استناد `llm_usage.cost_usd` از یک اجرای واقعی است.
const IN_TOK = 3000, OUT_TOK = 1500;

const NEEDLES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'gemini', 'gpt-5', 'deepseek', 'qwen', 'claude-haiku', 'mistral', 'llama',
];

const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) { console.error(`❌ OpenRouter جواب نداد: ${res.status}`); process.exit(1); }
const { data } = await res.json();
console.log(`مدل‌های در دسترس: ${data.length}\n`);

/* هر مدلی که **صدا می‌فهمد** بی‌قید می‌ماند، حتی اگر با هیچ needle نخواند: سؤالِ
 * محصولیِ «چه چیزی می‌تواند ویس را بشنود یا رونویسی کند» دقیقاً همین است، و اگر
 * جواب به یک لیستِ حدسیِ نام گره بخورد، همان حدس‌زدنی می‌شود که این ابزار برای
 * حذفش ساخته شد. */
const hearsAudio = (m) => (m.architecture?.input_modalities || []).includes('audio');
const rows = data
  .filter(m => hearsAudio(m) || NEEDLES.some(n => m.id.toLowerCase().includes(n.toLowerCase())))
  .map(m => {
    const p = m.pricing || {};
    const pin = Number(p.prompt) || 0, pout = Number(p.completion) || 0;
    return {
      id: m.id,
      inM: pin * 1e6, outM: pout * 1e6,
      per: pin * IN_TOK + pout * OUT_TOK,
      ctx: m.context_length || 0,
      mods: (m.architecture?.input_modalities || []).join('+'),
      /* ⚠️ مدلِ رونویسی (whisper و هم‌خانواده‌هایش) per **ثانیه‌ی صدا** قیمت دارد نه
       * per توکن، پس `prompt`/`completion` اش صفر است. فیلترِ قبلی دقیقاً همان‌ها را
       * دور می‌ریخت — یعنی ابزاری که برای «حدس نزن، بپرس» ساخته شده بود، در سؤالِ
       * «چه مدلِ رونویسی‌ای هست؟» ساکت می‌ماند. حالا قیمتِ خامِ صدا هم چاپ می‌شود. */
      aud: p.input_audio_tokens ?? p.audio ?? null,
    };
  })
  // مدلِ صداشنو حتی با قیمتِ توکنیِ صفر می‌ماند (قیمتش per ثانیه است)
  .filter(r => r.per > 0 || r.mods.includes('audio'))
  .sort((a, b) => a.per - b.per);

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('model id', 44)} ${pad('$/M in', 9)} ${pad('$/M out', 9)} ${pad('$/فال', 10)} ${pad('ctx', 9)} ورودی‌ها`);
console.log('─'.repeat(110));
for (const r of rows) {
  console.log(`${pad(r.id, 44)} ${pad(r.inM.toFixed(3), 9)} ${pad(r.outM.toFixed(3), 9)} ${pad(r.per.toFixed(5), 10)} ${pad(r.ctx, 9)} ${pad(r.mods, 22)} ${r.aud === null ? '' : `صدا: ${r.aud}`}`);
}
console.log(`\n(هزینه = ${IN_TOK} توکن ورودی + ${OUT_TOK} خروجی. «ورودی‌ها» می‌گوید مدل صدا می‌فهمد یا نه — مسیرِ ویسِ ما به image/audio نیاز دارد.)`);

/* 🎙 و در **انتها** یک بلوکِ فشرده فقط از مدل‌های صداشنو. جایش عمدی است: لاگِ
 * Actions از انتها خوانده می‌شود و این فهرست وسطِ صد ردیفِ دیگر گم می‌شد. سؤالی که
 * جواب می‌دهد یکی است و همیشه همان: «مسیرِ رونویسیِ ویس چه گزینه‌ای دارد؟» */
const audio = rows.filter(r => r.mods.includes('audio'));
console.log(`\n🎙 مدل‌هایی که صدا می‌فهمند (${audio.length}):`);
for (const r of audio) {
  console.log(`   ${pad(r.id, 44)} $/M in ${pad(r.inM.toFixed(3), 9)} $/M out ${pad(r.outM.toFixed(3), 9)} صدا/واحد ${r.aud ?? '—'}`);
}
if (!audio.length) console.log('   (هیچ‌کدام — یعنی رونویسی باید بیرون از OpenRouter انجام شود)');
