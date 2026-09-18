// 🇧🇷 دادهٔ زبانیِ سنجه‌های آزمایشگاه — پرتغالیِ برزیل.
//
// مثل روسی، الگوهای «رجیستر» و «جنسیت» از **همان فایلی** خوانده می‌شوند که گاردِ
// محصول (`repair.js`) از آن می‌خواند. دو کپیِ جدا دیر یا زود واگرا می‌شوند و آن‌وقت
// سنجه چیزی را می‌شمارد که گارد نمی‌بیند.
const LANG_DATA = (await import('../../../bots/tarot/langdata.pt.json', { with: { type: 'json' } })).default;
const defectOf = (id) => (LANG_DATA.defects || []).find((d) => d.id === id) || {};
const reOf = (id) => { const d = defectOf(id); return d.pattern ? new RegExp(d.pattern, d.flags || '') : null; };
const exceptOf = (id) => { const d = defectOf(id); return d.except ? new RegExp(d.except, `${(d.flags || '').replace('i', '')}i`) : null; };

export default {
  // 🏷 همان نشتِ برچسب، به پرتغالی
  tarotWord: /(cartas?|leitura|tiragem|tar[oô])/i,
  labelLeak: /sentimento n[ãa]o dito|seu sinal [ée]|o que voc[êe] n[ãa]o disse/i,
  /* 🗣 ⚠️ پرتغالی مرزِ گفتاری/کتابیِ تمیز **ندارد** («está» هر دو است)، پس این الگو
   * عمداً فقط اداری‌نویسیِ آشکار را می‌گیرد. آستانه ۲ است چون این فرم‌ها نادرند و
   * حتی دو تایشان یعنی متن از لحنِ محاوره‌ای بیرون زده. سیگنالش ضعیف‌تر از فارسی
   * است و هر مقایسه‌ی بین‌زبانی روی این ستون باید همین را بداند. */
  bookish: { min: 2, re: /encontra-se|faz-se necess[áa]rio|outrossim|por conseguinte|deve-se|h[áa] de se|no tocante a|cumpre (?:ressaltar|notar)/gi },
  formal: reOf('formal'),
  pluralCouple: exceptOf('formal'),
  register: ['universo', 'energia do universo', 'vibração do universo'],
  stop: ['que','isso','esse','essa','este','esta','para','pra','pro','com','sem','uma','uns','umas',
    'você','voce','seu','sua','seus','suas','mas','porque','quando','onde','como','mais','menos',
    'muito','pouco','agora','ainda','já','também','sempre','nunca','tudo','nada','sobre','entre',
    'está','estão','ser','estar','tem','têm','foi','era','vai','vão','pode','podem','faz','fazer'],
  minWordLen: 4,
  /* ریشه‌یابیِ سبک. پرتغالی اسم را **صرفِ حالت** نمی‌کند (برخلافِ روسی)، پس تطبیقِ
   * عینی تقریباً همیشه کار می‌کند و این تابع فقط جمع و جنسیت را یکدست می‌کند تا
   * «Copas» و «Copa» یا «Ouros» و «Ouro» به هم برسند. عمداً محافظه‌کار: کفِ ریشه ۳. */
  stem: (w) => {
    const x = String(w).toLowerCase();
    for (const e of ['ções', 'ção', 'es', 's']) {
      if (x.length - e.length >= 3 && x.endsWith(e)) return x.slice(0, -e.length);
    }
    return x;
  },
  // ⚠️ باید با `ctxKeys.summary` در `langdata.pt.json` یکی بماند (چکِ CI قفلش کرده).
  summaryKey: 'resumo',
  genderedPast: reOf('genero'),
  alien: [
    { id: 'fa', re: /[؀-ۿ]/u, label: 'نویسه‌ی فارسی/عربی در متنِ پرتغالی' },
    { id: 'cjk', re: /[　-鿿＀-￯]/u, label: 'نویسه‌ی CJK در متنِ پرتغالی' },
    { id: 'cyr', re: /[Ѐ-ӿ]/u, label: 'نویسه‌ی سیریلیک در متنِ پرتغالی' },
    /* پرتغالی و اسپانیایی آن‌قدر نزدیک‌اند که مدل قاطیشان می‌کند، و این ریسک با
     * اضافه‌شدنِ locale اسپانیایی در همین ریپو بیشتر هم می‌شود. `ñ` و `¿` و `¡` در
     * پرتغالی **اصلاً وجود ندارند**، پس تطبیقشان قطعی است و false-positive نمی‌دهد. */
    { id: 'es', re: /[ñ¿¡]/u, label: 'نویسه‌ی اسپانیایی در متنِ پرتغالی' },
    { id: 'europeu', re: reOf('europeu'), label: 'پرتغالیِ اروپا در متنِ برزیلی' },
  ],
  /* استابِ `--fake` به پرتغالی. اگر فارسی می‌ماند، هر اجرای `--fake` روی pt قرمزِ
   * دروغین می‌داد و ساعت‌ها دنبالِ باگی می‌گشتیم که فقط در خودِ استاب بود. */
  /* 🕯 الگوی «شرطِ پایانی»، برای سنجه‌ی `closingAnchor` (دورِ ۵ انگلیسی).
   * ⚠️ پرتغالی تنها زبانی است که این‌جا مقیدِ **ابتدای بند** شده، و این اجباری است نه
   * سلیقه‌ای: «se» هم حرفِ شرط است هم ضمیرِ انعکاسیِ پرتکرار («você se sente»). چون
   * سنجه **آخرین** «se» را می‌گیرد، یک انعکاسیِ بعد از «então» کلِ اندازه‌گیری را
   * جابه‌جا می‌کرد. انعکاسی همیشه بعد از یک کلمه می‌آید، شرط بعد از نقطه یا ویرگول. */
  closingCond: { open: /(?:^|[.;:!?\n]\s*|,\s+)se(?=\s)/gi, sep: /,?\s*então\s/i },
  fake: {
    teaser: (n) => `Carta ${n}, é um exemplo. Nela aparece uma cena qualquer.`,
    headline: 'Sim, provavelmente dá certo, mas vai custar tempo.',
    pattern: (a, b, q) => `A combinação de ${a} e ${b} sobre «${q}» aponta para um lado só.`,
    read: (n, q) => `${n} diz que essa parte de «${q}» está se movendo agora.`,
    callback: 'Da última vez o assunto era mais ou menos esse.',
    closingEvasive: (n, q) => `No geral «${q}» depende de você, mas ${n} pede para esperar.`,
    closing: (n, q) => `No geral «${q}» clareia em algumas semanas, mas só se você levar ${n} a sério.`,
    summary: 'resumo de exemplo',
    memory: 'memória de exemplo',
    repairFix: 'Tudo indica que dá certo, mas exige paciência.',
  },
};
