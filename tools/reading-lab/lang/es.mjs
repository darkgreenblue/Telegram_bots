// 🇪🇸 دادهٔ زبانیِ سنجه‌های آزمایشگاه — اسپانیاییِ آمریکای لاتین.
//
// الگوهای «رجیستر» و «جنسیت» از **همان فایلی** خوانده می‌شوند که گاردِ محصول
// (`repair.js`) از آن می‌خواند، وگرنه سنجه چیزی را می‌شمارد که گارد نمی‌بیند.
const LANG_DATA = (await import('../../../bots/tarot/langdata.es.json', { with: { type: 'json' } })).default;
const defectOf = (id) => (LANG_DATA.defects || []).find((d) => d.id === id) || {};
const reOf = (id) => { const d = defectOf(id); return d.pattern ? new RegExp(d.pattern, d.flags || '') : null; };
const exceptOf = (id) => { const d = defectOf(id); return d.except ? new RegExp(d.except, `${(d.flags || '').replace('i', '')}i`) : null; };

export default {
  // 🏷 همان نشتِ برچسب، به اسپانیایی
  tarotWord: /(cartas?|lectura|tirada|tarot)/i,
  labelLeak: /sentimiento no dicho|tu se[ñn]al es|lo que no dijiste/i,
  /* 🗣 ⚠️ همان محدودیتِ پرتغالی: اسپانیایی مرزِ صرفیِ گفتاری/کتابی ندارد، پس فقط
   * اداری‌نویسیِ آشکار گرفته می‌شود. آستانه ۲. */
  bookish: { min: 2, re: /se encuentra|resulta necesario|asimismo|por ende|no obstante|cabe (?:destacar|se[ñn]alar)|debe considerarse|en virtud de/gi },
  formal: reOf('formal'),
  pluralCouple: exceptOf('formal'),
  register: ['universo', 'energía del universo', 'vibración del universo'],
  stop: ['que','esto','esa','ese','esta','este','para','con','sin','una','unos','unas',
    'tú','tu','tus','sus','pero','porque','cuando','donde','como','más','menos',
    'mucho','poco','ahora','todavía','también','siempre','nunca','todo','nada','sobre','entre',
    'está','están','ser','estar','tiene','tienen','fue','era','vas','van','puede','pueden','hacer'],
  minWordLen: 4,
  /* ریشه‌یابیِ سبک. اسپانیایی هم مثل پرتغالی اسم را صرفِ حالت نمی‌کند، پس فقط جمع
   * یکدست می‌شود تا «Copas» و «Copa» یا «Oros» و «Oro» به هم برسند. کفِ ریشه ۳. */
  stem: (w) => {
    const x = String(w).toLowerCase();
    for (const e of ['ciones', 'ción', 'es', 's']) {
      if (x.length - e.length >= 3 && x.endsWith(e)) return x.slice(0, -e.length);
    }
    return x;
  },
  // ⚠️ باید با `ctxKeys.summary` در `langdata.es.json` یکی بماند (چکِ CI قفلش کرده).
  summaryKey: 'resumen',
  genderedPast: reOf('genero'),
  alien: [
    { id: 'fa', re: /[؀-ۿ]/u, label: 'نویسه‌ی فارسی/عربی در متنِ اسپانیایی' },
    { id: 'cjk', re: /[　-鿿＀-￯]/u, label: 'نویسه‌ی CJK در متنِ اسپانیایی' },
    { id: 'cyr', re: /[Ѐ-ӿ]/u, label: 'نویسه‌ی سیریلیک در متنِ اسپانیایی' },
    /* ⚠️ گاردِ «واژه‌ی لاتین» روسی این‌جا **پورت نمی‌شود**: اسپانیایی خودش لاتین‌نویس
     * است، پس «هر حرفِ لاتین» بی‌معنی است. به‌جایش لیستِ کوتاهِ واژه‌های انگلیسی. */
    { id: 'ingles', re: reOf('ingles'), label: 'واژه‌ی انگلیسی در متنِ اسپانیایی' },
    /* نشتِ پرتغالی. `ã` و `õ` و `ç` در اسپانیایی **اصلاً وجود ندارند**، پس تطبیق
     * قطعی است. ریسکش با وجودِ locale پرتغالی در همین ریپو واقعی است. */
    { id: 'pt', re: /[ãõç]/u, label: 'نویسه‌ی پرتغالی در متنِ اسپانیایی' },
  ],
  fake: {
    teaser: (n) => `Carta ${n}, es un ejemplo. En ella aparece una escena cualquiera.`,
    headline: 'Sí, probablemente sale bien, pero va a costar tiempo.',
    pattern: (a, b, q) => `La combinación de ${a} y ${b} sobre «${q}» apunta a un solo lado.`,
    read: (n, q) => `${n} dice que esa parte de «${q}» se está moviendo ahora.`,
    callback: 'La vez pasada el tema era más o menos este.',
    closingEvasive: (n, q) => `En general «${q}» depende de ti, pero ${n} pide esperar.`,
    closing: (n, q) => `En general «${q}» se aclara en unas semanas, pero solo si tomas a ${n} en serio.`,
    summary: 'resumen de ejemplo',
    memory: 'memoria de ejemplo',
    repairFix: 'Todo indica que sale bien, pero pide paciencia.',
  },
};
