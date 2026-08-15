#!/usr/bin/env node
// ساختِ **جدولِ دانشِ کارت** به فارسی: card-source.en.json → bots/tarot/card-knowledge.fa.json
//
// چرا جدولِ دانش و نه RAG (تصمیمِ ۱۴۰۵/۰۵/۲۴):
//   کلیدِ بازیابی این‌جا **قطعی** است — دقیقاً می‌دانیم کدام کارت‌ها کشیده شده‌اند. جست‌وجوی
//   برداری برای چیزی که یک lookup جوابش را می‌دهد، یک لایه‌ی حدس روی یک جوابِ قطعی است:
//   گران‌تر، کندتر (یک رفت‌وبرگشتِ شبکه‌ی اضافه وسطِ فالِ پول‌داده‌شده)، و بی‌دقت‌تر.
//   ضمناً چون این‌جا آفلاین به فارسی ترجمه می‌شود، **هیچ متنِ انگلیسی‌ای وارد runtime نمی‌شود**
//   و ریسکِ «مدل به زبانِ کانتکست بلغزد» صفر می‌شود.
//
// چرا آفلاین: یک‌بار ~۰.۰۵ دلار خرج می‌شود و برای همیشه رایگان است. در runtime فقط سه ردیف
// از یک فایلِ JSON خوانده می‌شود (زیر یک میلی‌ثانیه، بدونِ هیچ شبکه‌ای).
//
// اجرا (از workflow با سکرت، چون کلید فقط آن‌جاست):
//   OPENROUTER_API_KEY=... node tools/build-card-knowledge.mjs [--only m00,m01]
import { readFileSync, writeFileSync, existsSync } from 'fs';

const KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!KEY) { console.error('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const MODEL = process.env.KNOWLEDGE_MODEL?.trim() || 'google/gemini-2.5-pro';
const SRC  = new URL('../bots/tarot/card-source.en.json', import.meta.url);
const DEST = new URL('../bots/tarot/card-knowledge.fa.json', import.meta.url);

// ⚠️ سقفِ اندازه — مهم‌ترین قیدِ این فایل. هر فال سه ردیف از این جدول را به پرامپت اضافه
// می‌کند، پس هر کاراکترِ اضافه در **هر فال** هزینه دارد و پرامپت را متورم می‌کند (که روی
// Flash هم گران است هم کیفیت را پایین می‌آورد). این سقف‌ها در چکِ CI هم قفل شده‌اند.
const LIMITS = { image: 150, up: 110, down: 110, love: 90, work: 90 };

const src = JSON.parse(readFileSync(SRC, 'utf8'));
const out = existsSync(DEST) ? JSON.parse(readFileSync(DEST, 'utf8')) : {};
const only = (process.argv.find(a => a.startsWith('--only='))?.split('=')[1] || '').split(',').filter(Boolean);

const SYSTEM = `تو یک مترجم و ویراستارِ فارسی هستی که دانشِ تاروت را برای یک رباتِ فارسی‌زبان فشرده می‌کند.

از متنِ انگلیسیِ داده‌شده یک JSON کوتاهِ فارسی بساز. **فشردگی مهم‌ترین قید است** — این متن در هر فال به پرامپت اضافه می‌شود، پس هر کلمه‌ی اضافه هزینه دارد.

قواعد:
- فارسیِ روان و ساده. نه ترجمه‌ی تحت‌اللفظی، نه لحنِ دانشنامه‌ای.
- «image» مهم‌ترین فیلد است: **آن‌چه واقعاً روی کارت کشیده شده**، به‌صورت تصویری و ملموس. این چیزی است که تاروت‌خوان بتواند به آن اشاره کند. بدونِ تفسیر، فقط تصویر.
- «up» و «down» معنیِ هسته‌ایِ مستقیم و معکوس، هر کدام یک جمله.
- «love» و «work» معنیِ همان کارت در رابطه و در کار، هر کدام حداکثر یک عبارتِ کوتاه (نه جمله‌ی کامل).
- هرگز از خط تیره‌ی بلند (—) استفاده نکن.
- هیچ کلمه‌ی انگلیسی‌ای در خروجی نباشد.
- سقفِ کاراکتر را جدی بگیر: image ≤${LIMITS.image}، up ≤${LIMITS.up}، down ≤${LIMITS.down}، love ≤${LIMITS.love}، work ≤${LIMITS.work}.

خروجی فقط یک JSON معتبر، بدونِ code fence:
{"image":"…","up":"…","down":"…","love":"…","work":"…"}`;

const parseLoose = (t) => {
  const m = String(t).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const trim = (s, n) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').replace(/[—–]/g, '،').trim();
  return v.length > n ? `${v.slice(0, n).trimEnd()}…` : v;
};

async function callOR(user) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, temperature: 0.3, max_tokens: 700,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const obj = parseLoose(j.choices?.[0]?.message?.content);
      if (obj?.image && obj?.up && obj?.down) return obj;
      throw new Error('خروجیِ ناقص');
    } catch (e) {
      if (i === 3) throw e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

const keys = Object.keys(src).filter(k => (only.length ? only.includes(k) : !out[k]));
console.log(`▶ ${keys.length} کارت برای ساخت (مدل: ${MODEL})`);

let done = 0;
for (const key of keys) {
  const c = src[key];
  const user = JSON.stringify({
    card: c.en, persian_name: c.fa,
    description: c.image, upright: c.upright, reversed: c.reversed,
    upright_love: c.upLove, upright_career: c.upCareer,
    reversed_love: c.revLove, reversed_career: c.revCareer,
  });
  const o = await callOR(user);
  out[key] = {
    fa: c.fa,
    image: trim(o.image, LIMITS.image),
    up: trim(o.up, LIMITS.up),
    down: trim(o.down, LIMITS.down),
    love: trim(o.love, LIMITS.love),
    work: trim(o.work, LIMITS.work),
  };
  done++;
  if (done % 10 === 0 || done === keys.length) {
    writeFileSync(DEST, JSON.stringify(out, null, 1));   // ذخیره‌ی تدریجی: قطعِ وسطِ کار کلِ کار را هدر نمی‌دهد
    console.log(`  … ${done}/${keys.length}`);
  }
}

writeFileSync(DEST, JSON.stringify(out, null, 1));
const total = Object.keys(out).length;
const avg = Math.round(Object.values(out).reduce((a, v) => a + JSON.stringify(v).length, 0) / Math.max(total, 1));
console.log(`✅ ${total} کارت در card-knowledge.fa.json (میانگین ${avg} کاراکتر per کارت)`);
