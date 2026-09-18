#!/usr/bin/env node
/* 🚻 گاردِ نشتِ جنسیت و لحنِ رسمی در **متن‌های خودمان** (نه خروجیِ مدل).
 *
 * چرا این چک ساخته شد: `langdata.<lang>.json → defects` از v3.4x وجود دارد و در
 * پروداکشن روی **خروجیِ مدل** اجرا می‌شود تا جنسیتِ خواننده را به او تحمیل نکند.
 * ولی هیچ‌کس همان الگو را روی **رشته‌های دستیِ خودمان** اجرا نکرده بود. جاروی
 * ۱۴۰۵/۰۶/۲۷ سه نقضِ واقعی پیدا کرد:
 *   • `ru chat.followUpGone`      «Этот вопрос ты уже задал»  (گذشته‌ی مذکر)
 *   • `ru wallet.receiptNoInvoice` «Если ты уже оплатил»       (گذشته‌ی مذکر)
 *   • `pt coffee.questions[1].q`  «como está consigo mesmo»   (صفتِ مذکر)
 * هر سه امروز خاموش‌اند (گفتگو fa-only، رسید روی ریلِ استارز بسته، منوی رایگان
 * `false`)، و دقیقاً به همین دلیل بی‌صدا بودند: هیچ کاربری نمی‌دیدشان که شکایت کند.
 *
 * ⚠️ کنایه‌ی کار این است که پرامپتِ روسی **خودش** همین را به مدل ممنوع می‌کند
 * («не навязывай человеку пол… избегай глаголов прошедшего времени»). یعنی قاعده را
 * می‌دانستیم و فقط روی متنِ خودمان اجرایش نکرده بودیم.
 *
 * 🔑 الگو از **خودِ مسیرِ محصول** می‌آید (`repair.js` → `DEFECTS` → `.find(t)`)، نه با
 * کامپایلِ دوباره در این فایل. کپیِ محلی همان drift ای را می‌سازد که این چک قرار است
 * جلویش را بگیرد (همان قاعده‌ی `check-langdata`).
 *
 * ⚠️ بلوکِ `prompts` عمداً بیرون است: آن متن‌ها خطابِ **مدل** اند و قانوناً مثالِ
 * جنسیت‌دار نقل می‌کنند («ты решил», «ты решила») تا مدل بفهمد چه نکند. سنجیدنشان
 * یعنی قرمزِ کاذب روی خودِ قاعده.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

const DIR = new URL('../bots/tarot/', import.meta.url);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fails++; };

/* فقط ضعف‌هایی که دربارهٔ **خطابِ خواننده**اند. `latin`/`ingles`/`europeu` عمداً بیرون‌اند:
 * آن‌ها دربارهٔ واژگانِ خروجیِ مدل‌اند و روی متنِ ما (که نامِ برند و «Telegram Stars»
 * دارد) قرمزِ کاذب می‌دهند. */
const GENDER_IDS = ['formal', 'genderedPast', 'genero'];
const LANGS = ['ru', 'pt', 'es'];

/* نمونه‌ی **نقضِ شناخته‌شده** per زبان. بدونِ این، یک walkِ خرابِ همیشه-خالی هر سه
 * ادعای منفی را بی‌صدا پاس می‌کرد (بند ۶ب-۲ ریشه: سبزیِ حاصل از نبودِ قرمز هیچ چیز
 * ثابت نمی‌کند). هر سه دقیقاً همان متنی‌اند که در واقعیت پیدا شدند. */
const KNOWN_BAD = {
  ru: 'Этот вопрос ты уже задал 🌙',
  pt: 'E você, como está consigo mesmo?',
  es: 'Tú estás cansado de esperar.',
};

const probe = (lang) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { DEFECTS } = await import('${new URL('repair.js', DIR).pathname}');
  const L = (await import('${new URL(`locales/${lang}.js`, DIR).pathname}')).default;
  const guards = DEFECTS.filter(d => ${JSON.stringify(GENDER_IDS)}.includes(d.id));

  /* آرگومان‌های بی‌ضرر: تابعِ locale باید متنِ خودش را بسازد و هیچ‌کدام از این‌ها
   * واژه‌ی جنسیت‌دار وارد نمی‌کنند، پس هر برخوردی مالِ خودِ قالب است نه ورودی. */
  const ARGS = [[], ['x'], ['x', 1], [1], [true], [{}],
                [{ on: true, name: 'x', emoji: '*' }], ['x', 'y'], [1, 2], ['x', 1, true]];
  const out = [];
  const walk = (v, p) => {
    if (p.split('.')[0] === 'prompts') return;
    if (typeof v === 'string') { out.push([p, v]); return; }
    if (typeof v === 'function') {
      for (const a of ARGS) {
        try { const r = v(...a); if (typeof r === 'string' && r.trim()) out.push([p, r]); } catch {}
      }
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, p + '[' + i + ']'));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, p ? p + '.' + k : k));
  };
  Object.entries(L).forEach(([k, v]) => walk(v, k));

  const hits = [];
  for (const [p, t] of out) for (const g of guards) {
    const m = g.find(t);
    if (m) hits.push({ path: p, id: g.id, m, t: t.slice(0, 90) });
  }
  const control = guards.map(g => !!g.find(${JSON.stringify(KNOWN_BAD[lang])})).some(Boolean);
  console.log(JSON.stringify({ ids: guards.map(g => g.id), n: out.length, hits, control }));
`], { encoding: 'utf8', env: { ...process.env, LOCALE: lang } });

console.log('🚻 نشتِ جنسیت/لحنِ رسمی در متن‌های رو-به-کاربر\n');
for (const lang of LANGS) {
  if (!existsSync(new URL(`locales/${lang}.js`, DIR))) { ok(false, `locales/${lang}.js وجود ندارد`); continue; }
  const r = probe(lang);
  let d = null;
  try { d = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  if (!d) { ok(false, `«${lang}»: اجرای گارد شکست خورد — ${(r.stderr || '').slice(0, 200)}`); continue; }

  ok(d.ids.length > 0, `«${lang}»: ${d.ids.length} گاردِ خطابی دارد (${d.ids.join(', ') || 'هیچ'})`);
  ok(d.n > 50, `«${lang}»: ${d.n} رشته‌ی رو-به-کاربر سنجیده شد`);
  // کنترلِ مثبت: ثابت می‌کند الگو و walk هر دو واقعاً کار می‌کنند.
  ok(d.control === true, `«${lang}»: کنترلِ مثبت — نقضِ شناخته‌شده گرفته می‌شود`);

  const uniq = [...new Map(d.hits.map(h => [h.path + h.id, h])).values()];
  ok(uniq.length === 0,
    `«${lang}»: هیچ رشته‌ای جنسیت یا لحنِ رسمی به کاربر تحمیل نمی‌کند` +
    (uniq.length ? ` — ${uniq.map(h => `${h.path} [${h.id}] «${h.m}»`).join(' | ')}` : ''));
}

console.log(fails ? `\n❌ ${fails} ادعا شکست خورد` : '\n✅ همه سبز');
process.exit(fails ? 1 : 0);
