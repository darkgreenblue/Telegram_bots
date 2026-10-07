/* 🛟 ایمنیِ فال (v3.153.0): موضوعِ حساس، حافظه‌ی پزشکی، و «فال برای آدمِ دیگر».
 *
 * از ممیزیِ کاربرِ واقعیِ ۷۲۵۸۷۴۳۱۰۱ (۱۴۰۵/۰۷/۱۴). سه تصمیمِ صریحِ مالک:
 *   ۱) فالِ موضوعِ حساس (خودکشی، آسیب به خود، بستری، درمان) **داده می‌شود**، ولی با یک
 *      بلوکِ ایمنی در پرامپت (بدونِ بله/نه و پیش‌بینیِ زمان، طرفِ پزشک، بدونِ سرزنش) و
 *      یک خطِ ثابتِ مراقبت که **کد** تهِ فال می‌گذارد.
 *   ۲) حافظه سابقه‌ی پزشکی و خودکشی را نگه نمی‌دارد؛ حداکثر یک برچسبِ کلی.
 *   ۳) اسمِ متفاوت یعنی شاید آدمِ متفاوت: اگر کاربر در سؤال خودش را با اسمِ دیگری معرفی
 *      کرد (یا گفت فال برای کسِ دیگری است)، مدل از الگوهای فال‌های قبلی استفاده نمی‌کند.
 *
 * ماژولِ **خالص** است (بدونِ DB و تلگرام) تا هم ربات و هم آزمایشگاه همین را اجرا کنند و
 * گارد و سنجه یک کد باشند (قاعده‌ی صفرِ `tools/reading-lab/`).
 * تشخیصِ بحران عمداً از `crisisIn`ِ گفتگو می‌آید، نه یک فهرستِ دوم: دو فهرست دیر یا زود
 * واگرا می‌شوند و یک کاربر در فال و گفتگو دو رفتارِ متفاوت می‌گیرد.
 */
import { crisisIn, norm } from './chat-core.js';

/** برچسبِ کلیِ حافظه. باید با جمله‌ی آخرِ `readerSafety` همان زبان یکی بماند. */
export const SENSITIVE_LABEL = {
  fa: 'موضوعِ حساس؛ با احتیاط.',
  en: 'Sensitive topic; handle with care.',
  ru: 'Чувствительная тема; осторожно.',
  es: 'Tema sensible; con cuidado.',
  pt: 'Tema sensível; com cuidado.',
};
const labelOf = (lang) => SENSITIVE_LABEL[lang] || SENSITIVE_LABEL.fa;

/* 🩺 واژه‌هایی که یک جمله‌ی حافظه را «پزشکی/روانیِ حساس» می‌کنند. عمداً تنگ: اضطراب،
 * استرس، وسواس و تراپی **نیستند** (حالِ روزمره‌اند و حذفشان شناختِ مفید را می‌برد).
 * تطبیق از **ابتدای کلمه** است (مثلِ `crisisIn`)، پس «بستری» داخلِ «بستریِ» هم می‌گیرد
 * ولی داخلِ یک کلمه‌ی دیگر نه. */
const SENSITIVE = {
  fa: ['بستری', 'اعصاب و روان', 'روانپزشک', 'روان پزشک', 'بیمارستان روانی', 'افسردگی شدید',
    'افسردگی', 'قرص اعصاب', 'قرص خواب', 'ضد افسردگی', 'ضدافسردگی', 'دوقطبی', 'دو قطبی',
    'اسکیزوفرنی', 'حمله پنیک', 'حمله‌ی پنیک', 'سرطان', 'شیمی درمانی', 'شیمیدرمانی', 'آسیب به خود',
    'خودآزاری', 'خودآسیب', 'ترخیص',
    /* شکل‌هایی که خودِ مدل در **حافظه** می‌نویسد (دورِ آزمایشگاهِ ۱۴۰۵/۰۷/۱۴): «پایانِ رابطه را
     * به آسیب‌زدن به خود گره زده» و «فکرِ پایان‌دادن به زندگی» از این فهرست و از `crisisIn` رد
     * شدند و در حافظه ماندند (نقضِ قاعده‌ی ۱ِ مالک). `norm` نیم‌فاصله را حذف می‌کند، پس هر
     * دو نگارش لازم است. */
    'آسیب زدن به خود', 'آسیب‌زدن به خود', 'صدمه زدن به خود', 'صدمه‌زدن به خود',
    'پایان دادن به زندگی', 'پایان‌دادن به زندگی', 'تمام کردن زندگی', 'تمام‌کردن زندگی',
    'به زندگی‌اش پایان', 'به زندگیش پایان', 'به زندگی خود پایان', 'کشتن خود', 'افکار خودکشی',
    /* سوم‌شخص: خطرِ آدمِ دیگری حساس است ولی بحرانِ خودِ کاربر نیست (خطِ مراقبت نمی‌گیرد). */
    'خودشو بکشه', 'خودش رو بکشه', 'خودش را بکشد', 'خودشو میکشه', 'خودشو می کشه', 'به خودش آسیب'],
  en: ['suicid', 'self-harm', 'self harm', 'hospitaliz', 'psychiatr', 'psych ward', 'depression',
    'antidepress', 'bipolar', 'schizophren', 'panic attack', 'cancer', 'chemo', 'overdos', 'rehab',
    'discharg'],
  ru: ['суицид', 'самоубий', 'самоповрежд', 'госпитализ', 'психиатр', 'психбольниц', 'депресси',
    'антидепрессант', 'биполяр', 'шизофрен', 'панической атак', 'рак ', 'химиотерап', 'передозир',
    'выписк'],
  es: ['suicid', 'autoles', 'hospitaliz', 'internad', 'psiquiatr', 'depresi', 'antidepres',
    'bipolar', 'esquizofren', 'ataque de pánico', 'cáncer', 'cancer', 'quimio', 'sobredosis'],
  pt: ['suicíd', 'suicid', 'automutil', 'internad', 'internação', 'psiquiatr', 'depressão',
    'depressao', 'antidepress', 'bipolar', 'esquizofren', 'ataque de pânico', 'câncer', 'cancer',
    'quimio', 'overdose'],
};

/* ♋ «سرطان» هم بیماری است هم نامِ برجِ تیر. سؤالِ عادیِ طالع («برج سرطان»، «متولد سرطانم»،
 * «ماه تولدم سرطانه»، «سرطانی‌ها») نباید فال را حساس و بی‌حکم کند. فقط همین بافت‌های صریحِ
 * برج حذف می‌شوند؛ «سرطان داره» و «توده‌ی سرطانی» حساس می‌مانند. `norm` نیم‌فاصله را برداشته،
 * پس «سرطانی‌ها» این‌جا «سرطانیها» است. */
const FA_ZODIAC = [
  /(?<= )(ماه تولدم|ماه تولدش|ماه تولد|متولدین|متولد|برجم|برجش|برج|ماه) سرطان[^ ]*/g,
  /(?<= )()سرطانی ?ها[^ ]*/g,
  /(?<= )()سرطانیا[^ ]*/g,
  /* 🛏 «بستری برای حرکت/ادامه» یعنی «زمینه»، نه بیمارستان (قرمزِ کاذبِ واقعی روی یک حافظه، ۱۴۰۵/۰۷/۱۵). */
  /(?<= )()بستری(?= (?:برای|مناسب|مساعد|فراهم) )/g,
];
const stripZodiac = (padded, lang) => (lang === 'fa'
  ? FA_ZODIAC.reduce((s, re) => s.replace(re, (m, lead) => `${lead} `), padded)
  : padded);

/** واژه‌ی حساسِ پیداشده در متن، یا `''`. */
export function sensitiveTermIn(text, lang = 'fa') {
  const padded = stripZodiac(` ${norm(text)} `, lang);
  if (padded.trim() === '') return '';
  for (const p of (SENSITIVE[lang] || SENSITIVE.fa)) {
    const n = norm(p);
    if (n && padded.includes(` ${n}`)) return p;
  }
  return '';
}

/* ✂️ حافظه جمله‌به‌جمله پاک می‌شود، نه کلش: بقیه‌ی شناخت (موضوعِ رابطه، الگوی سؤال‌ها)
 * درست و مفید است. جمله‌ای که حرفِ بحران یا واژه‌ی حساس دارد حذف و یک برچسبِ کلی
 * جایش می‌نشیند. idempotent است: برچسبِ موجود دوباره اضافه نمی‌شود.
 * 🐛 برچسب با **تطبیقِ نرمال** شناخته می‌شود، نه رشته‌ی عینی: مدل آن را بدونِ کسره
 * («موضوع حساس؛ با احتیاط.») یا با یک واژه‌ی اضافه («… موضوعِ حساس دارد؛ با احتیاط.»)
 * بازنویسی می‌کرد و نسخه‌ی قبلی هر بار یک برچسبِ دوم می‌افزود (دورِ آزمایشگاهِ
 * ۱۴۰۵/۰۷/۱۴: «موضوع حساس؛ با احتیاط. موضوعِ حساس؛ با احتیاط.»). تکه‌ای که نیمه‌ی اولِ
 * برچسب را دارد کامل می‌رود، و تکه‌ای که **فقط** نیمه‌ی دوم است هم. */
const HARAKAT = /[\u064B-\u065F\u0670]/g;
const nh = (s) => norm(String(s || '').replace(HARAKAT, '')).replace(/\s+/g, ' ').trim();
const labelParts = (lang) => labelOf(lang).split(/[;؛]/).map(nh).filter(Boolean);
function isLabelSeg(seg, lang) {
  const t = nh(seg);
  if (!t) return false;
  const [head, tail] = labelParts(lang);
  return (head && t.includes(head)) || (tail && t === tail);
}

/** حافظه بدونِ هیچ ردی از برچسبِ کلی: همان چیزی که به **مدل** می‌رسد. */
export function memoryWithoutLabel(text, lang = 'fa') {
  const src = String(text || '');
  const segs = src.match(/[^.!?؟؛\n]+[.!?؟؛]*\s*/g) || [];
  return segs.filter((s) => norm(s) && !isLabelSeg(s, lang)).join('').replace(/\s+/g, ' ').trim();
}

export function sanitizeMemory(text, lang = 'fa') {
  const src = String(text || '');
  if (!src.trim()) return { text: src, cut: 0 };
  const label = labelOf(lang);
  const segs = src.match(/[^.!?؟؛\n]+[.!?؟؛]*\s*/g) || [src];
  let cut = 0;
  let hadLabel = false;
  const kept = segs.filter((s) => {
    if (!norm(s)) return false;
    if (isLabelSeg(s, lang)) { hadLabel = true; return false; }
    if (crisisIn(s) || sensitiveTermIn(s, lang)) { cut++; return false; }
    return true;
  });
  if (!cut && !hadLabel) return { text: src, cut: 0 };
  const body = kept.join('').replace(/\s+/g, ' ').trim();
  return { text: body ? `${body} ${label}` : label, cut };
}

/** حافظه‌ای که خودش موضوعِ حساس دارد (یا قبلاً برچسب خورده). */
export function memorySensitive(text, lang = 'fa') {
  const src = String(text || '');
  if (!src.trim()) return false;
  return memoryWithoutLabel(src, lang) !== src.replace(/\s+/g, ' ').trim() || sanitizeMemory(src, lang).cut > 0;
}

/* 🪪 اسمی که کاربر **در خودِ سؤال** به خودش نسبت داده. فقط الگوهای بی‌ابهام: «اسمم X»،
 * «من X متولد…»، و «خودم X» وقتی بعدش واژه‌ای می‌آید که آن را اسم می‌کند. «من خسته
 * هستم» عمداً الگو نیست (صفت با اسم قابلِ تفکیک نیست). */
const FA_LETTERS = 'آ-یءأإؤئةكيۀ';
const faWord = `[${FA_LETTERS}]{2,}`;
const FA_STOP = new Set(['و', 'هم', 'رو', 'را', 'که', 'اون', 'او', 'دیگه', 'خیلی', 'فکر', 'دارم',
  'هستم', 'خودم', 'هنوز', 'نمی', 'میخوام', 'میدونم', 'دوست', 'تنها', 'واقعا', 'الان', 'حالا',
  'شخصا', 'اصلا', 'همیشه', 'یه', 'یک', 'این', 'اینو', 'چی', 'چه', 'کی', 'کجا', 'چرا', 'باید',
  'میتونم', 'نمیدونم', 'ازش', 'بهش', 'باهاش', 'براش', 'برای', 'واسه', 'هست', 'است', 'بود',
  'متولد', 'ماه', 'سال', 'دختر', 'پسر', 'خانم', 'آقا', 'مجرد', 'متاهل', 'اسمش', 'اسم', 'توی', 'تو',
  'در', 'رشته', 'رشتۀ', 'شناسنامه', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر',
  'آبان', 'آذر', 'دی', 'بهمن', 'اسفند', 'با', 'از', 'به', 'دو', 'سه', 'هر', 'چیه', 'کنه', 'انتخاب',
  /* از دیتای واقعی (۱۴۰۵/۰۷/۱۵): «اسمم دروغ گفتم»، «اسمم قرعه‌کشی میافته»، «از من بزرگتره»،
   * «هم اسم من داشته»، «خودم موفق هستم» اسم خوانده می‌شدند. */
  'دروغ', 'موفق', 'داشته', 'قرعهکشی', 'قرعه', 'بزرگتره', 'بزرگتر', 'کوچیکتره', 'کوچکتره', 'عوض',
  'مخاطب', 'مراجع', 'کاربر', 'اولین', 'جلسه', 'همچنان', 'درباره', 'دربارهی']);
/* فعل اسم نیست («اسمم میاد»، «اسمم میپیچه»): X که با «می/نمی» شروع شود رد می‌شود، **مگر**
 * اسمِ رایجی که خودش با «می» شروع می‌شود (مینا، میلاد، …) یا بعدش «هست/هستم» آمده باشد؛
 * نسخه‌ی اول «اسمم مینا هست» را فعل خواند و جداسازی را از دست داد. */
const MI_NAMES = new Set(['مینا', 'میلاد', 'میترا', 'میثم', 'مینو', 'میعاد', 'میرا', 'میکاییل',
  'میکائیل', 'میهن', 'میشا', 'میسا', 'میلا', 'میناز', 'میهما', 'میهمان']);
const NAME_AFTER = new Set(['هست', 'هستم', 'هستش', 'است', 'ام']);
const notName = (n, next = '') => !n || FA_STOP.has(n)
  || (/^(?:ن?می)/.test(n) && !MI_NAMES.has(n) && !NAME_AFTER.has(next));
/* «خودم X» فقط وقتی اسم است که بعدش یکی از این‌ها بیاید («خودم زینب طرف مقابل…»). «و» و پایانِ
 * جمله عمداً نیستند: «دست خودم نیس و…» و «…از طرف خودم چیه؟» روی دیتای واقعی اسم خوانده می‌شدند.
 * «هستم» هم نیست: «خودم موفق هستم» صفت است نه اسم. */
const AFTER_SELF = new Set(['طرف', 'اون', 'او', 'ماه', 'متولد', 'اسم', 'متولدم']);
/* «از/به/با/مثلِ من X متولد…» درباره‌ی آدمِ دیگری است («دوسال از من بزرگتره متولد شهریور»). */
const BEFORE_MAN = /(?:^|\s)(?:از|به|با|مثل|مث|برای|واسه|برا|پیش|کنار)\s+$/;
const faNorm = (s) => String(s || '').replace(/[‌‏‎]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();

function faSelfNames(q) {
  const t = faNorm(q).replace(/[!؟?.,،؛:()"«»]/g, ' ').replace(/\s+/g, ' ');
  const out = [];
  const push = (n, next) => { if (!notName(n, next)) out.push(n); };
  for (const m of t.matchAll(new RegExp(`(?:^|\\s)(?:اسمم|اسم من|اسم خودم|نام من)\\s+(?:هم\\s+)?(${faWord})(?:\\s+(\\S+))?`, 'g'))) {
    /* «هم‌اسمِ من» (یه دختر هم اسم من داشته) یعنی آدمِ دیگری با همان اسم، نه معرفیِ خود. */
    if (/(?:^|\s)هم\s*$/.test(t.slice(0, m.index + (m[0].startsWith(' ') ? 1 : 0)))) continue;
    push(m[1], m[2]);
  }
  for (const m of t.matchAll(new RegExp(`(?:^|\\s)من\\s+(${faWord})\\s+(?:متولد|متولدم|هستم\\s+متولد)`, 'g'))) {
    if (BEFORE_MAN.test(t.slice(0, m.index + (m[0].startsWith(' ') ? 1 : 0)))) continue;
    push(m[1]);
  }
  for (const m of t.matchAll(new RegExp(`(?:^|\\s)خودم\\s+(${faWord})\\s+(\\S+)`, 'g'))) {
    if (AFTER_SELF.has(m[2])) push(m[1]);
  }
  return out;
}
const OTHER_SELF = {
  /* عبارت با حرفِ بزرگ یا کوچک، ولی خودِ اسم فقط با حرفِ بزرگ (وگرنه «my name is not…»). */
  en: /(?:^|[^\p{L}])[Mm]y name is\s+(\p{Lu}\p{Ll}+)/gu,
  ru: /(?:^|[^\p{L}])[Мм]еня зовут\s+(\p{Lu}\p{Ll}+)/gu,
  es: /(?:^|[^\p{L}])(?:[Mm]e llamo|[Mm]i nombre es)\s+(\p{Lu}\p{Ll}+)/gu,
  pt: /(?:^|[^\p{L}])(?:[Mm]eu nome é|[Mm]e chamo)\s+(\p{Lu}\p{Ll}+)/gu,
};
/** اولین اسمی که کاربر در سؤال به **خودش** نسبت داده، یا `''`. */
export function declaredSelfName(question, lang = 'fa') {
  if (lang === 'fa') return faSelfNames(question)[0] || '';
  const re = OTHER_SELF[lang];
  if (!re) return '';
  for (const m of String(question || '').matchAll(new RegExp(re.source, re.flags))) return m[1];
  return '';
}

/* 👥 «این فال برای کسِ دیگری است». فقط الگوهای صریح؛ «برای دوستم کادو بخرم؟» نباید
 * بگیرد (آن سؤالِ خودِ کاربر درباره‌ی دوستش است، نه فالِ دوستش). */
const FA_FRIEND = '(?:دوستم|دوستام|دوستای|رفیقم|رفیقام|همکارم|دوست صمیمیم|دوستمه|رفیقمه)';
const FA_FAMILY = '(?:خواهرم|برادرم|داداشم|آبجیم|مامانم|مادرم|بابام|پدرم|دخترم|پسرم|همسرم|شوهرم|خانمم|دختر خالم|دخترخالم|پسرخالم|دختر عموم|پسر عموم|دخترعمم|زن داداشم|خالم|عمم)';
const FA_REL = `(?:${FA_FRIEND}|${FA_FAMILY})`;
const FA_OTHER = [
  new RegExp(`(?:برای|واسه|برا)\\s+${FA_FRIEND}(?:ه|مه)?\\s+(?:میخوام|می خوام|فال|بگیر|باز|میگیرم|می گیرم)`),
  new RegExp(`(?:برای|واسه|برا)\\s+${FA_FRIEND}(?:ه|مه)?\\s*$`),
  new RegExp(`فال\\s+(?:برای|واسه|برا|مال)\\s+${FA_REL}`),
  new RegExp(`(?:برای|واسه|برا)\\s+${FA_REL}\\s+(?:یه\\s+|یک\\s+)?فال`),
  new RegExp(`${FA_REL}\\s+(?:میخواد|می خواد|میخواست)\\s+(?:فال|بدونه)`),
  new RegExp(`(?:سوال|سؤال|فال)\\s+${FA_REL}\\s+(?:هست|است|ه\\b)`),
  /فال من نیست|سوال من نیست|سؤال من نیست|برای خودم نیست|واسه خودم نیست/,
  new RegExp(`این\\s+(?:فال\\s+)?(?:برای|واسه|برا|مال)\\s+${FA_REL}(?:ه|مه|هست)?(?:\\s|$)`),
];
const OTHER_FOR = {
  en: /\b(?:reading|asking|this is)\s+for\s+(?:my\s+)?(?:friend|sister|brother|mom|mother|dad|father|cousin|colleague)\b|\bmy (?:friend|sister|brother|mom|cousin) wants (?:a|to know)/i,
  ru: /(?:расклад|гадание|вопрос)\s+для\s+(?:моей\s+|моего\s+)?(?:подруги|друга|сестры|брата|мамы|коллеги)/i,
  es: /(?:lectura|tirada|pregunta)\s+(?:es\s+)?para\s+(?:mi\s+)?(?:amiga|amigo|hermana|hermano|mamá|madre|prima|primo)/i,
  pt: /(?:leitura|tiragem|pergunta)\s+(?:é\s+)?(?:para|pra)\s+(?:a\s+|o\s+)?(?:minha\s+|meu\s+)?(?:amiga|amigo|irmã|irmão|mãe|prima|primo)/i,
};
export function forOtherPerson(question, lang = 'fa') {
  const q = String(question || '');
  if (!q.trim()) return false;
  if (lang === 'fa') {
    const t = faNorm(q).replace(/[!؟?.,،؛:()"«»]/g, ' ').replace(/\s+/g, ' ').trim();
    return FA_OTHER.some((re) => re.test(t));
  }
  return !!OTHER_FOR[lang]?.test(q);
}

/* 🔤 کلیدِ آوایی: یک اسم با چند نگارش یک نفر است. روی دیتای واقعی (۱۴۰۵/۰۷/۱۵) این‌ها جداسازیِ
 * کاذب می‌ساختند: آتنا/اتنا، محیا/مهیا، حانیه/هانیه، فائقه/فاعقه، کوثر/کوثره، آیسل/آیزل،
 * رکسانا/روکسانا، زینب/زیبنه، نرجس/نرگس. پس حروفِ هم‌آوا یکی، اعراب و نیم‌فاصله حذف، و «ه»ِ
 * پایانی (کوثره = «کوثره»، یعنی «کوثر است») متقارن برداشته می‌شود. */
const NAME_MAP = [[/[آأإ]/g, 'ا'], [/[ةۀ]/g, 'ه'], [/ح/g, 'ه'], [/[عئء]/g, 'ا'], [/ؤ/g, 'و'],
  [/[صث]/g, 'س'], [/[ذضظ]/g, 'ز'], [/ط/g, 'ت'], [/غ/g, 'ق']];
function nameKey(s) {
  let x = faNorm(s).replace(HARAKAT, '').toLowerCase();
  for (const [re, to] of NAME_MAP) x = x.replace(re, to);
  if (x.length > 3 && x.endsWith('ه')) x = x.slice(0, -1);
  return x;
}
/** فاصله‌ی ویرایشی با جابه‌جایی (Damerau، فقط تا ۱ لازم است). */
function within1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n] <= 1;
}
/** آیا دو اسم یک نفرند؟ پسوند آزاد است («فرنیاست» = «فرنیا»)؛ اسمِ خالی یعنی «نمی‌دانیم».
 * پیشوند فقط وقتی که اسمِ کوتاه‌تر دست‌کم ۳ حرف است، و غلطِ تایپیِ یک‌حرفی فقط برای اسمِ ≥۴ حرفی.
 * جهتِ خطا عمداً این است: دو اسمِ نزدیک (مینا/مینو) یکی حساب می‌شوند، یعنی همان رفتارِ پیش از
 * این نسخه (بدونِ جداسازی)، نه جداسازیِ کاذبی که حافظه‌ی آدمِ درست را از فالش می‌گیرد. */
const sameName = (a, b) => {
  const x = nameKey(a); const y = nameKey(b);
  if (!x || !y) return true;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s)) return true;
  return s.length >= 4 && within1(x, y);
};

/* 🧠 اسمی که **حافظه** به صاحبِ حساب نسبت داده («نگین (یلدا) هنوز…»، «مراجع (ساغر) درباره…»،
 * «مخاطب فاعقه است…»). قاعده‌ی ۲ِ مالک دقیقاً همین را می‌گوید: اسمِ سؤال را با اسمِ **مموری**
 * بسنج. بدونِ این، کاربری که اسمِ نمایشی‌اش لقب است (زنبور) و همیشه خودش را «شارمین» معرفی
 * می‌کند، در هر فال حافظه‌اش را از دست می‌داد. */
const MEM_SUBJECT_LEAD = new Set(['مخاطب', 'مراجع', 'کاربر']);
export function memorySubjectNames(memory, lang = 'fa') {
  const src = String(memory || '').trim();
  if (!src) return [];
  if (lang !== 'fa') {
    const m = src.match(/^\s*(\p{Lu}\p{Ll}+)/u);
    return m ? [m[1]] : [];
  }
  const head = faNorm(src).slice(0, 80);
  const out = [];
  const add = (n) => { const w = String(n || '').replace(/[^آ-یءأإؤئةكيۀ]/g, ''); if (w.length >= 2 && !notName(w)) out.push(w); };
  const toks = head.replace(/[!؟?.,،؛:"«»]/g, ' ').split(/\s+/).filter(Boolean);
  const first = (toks[0] || '').replace(/[()]/g, '');
  if (MEM_SUBJECT_LEAD.has(first)) {
    /* «مخاطب فاعقه است» / «مراجع (ساغر)» */
    const m = head.match(new RegExp(`^(?:مخاطب|مراجع|کاربر)\\s*\\(?\\s*(${faWord})(?:\\s*\\))?(?:\\s+(?:است|هست|ست)(?![${FA_LETTERS}]))?`));
    if (m && (/\(/.test(m[0]) || /(?:است|هست|ست)$/.test(m[0]))) add(m[1]);
  } else if (!first.includes('(')) add(first);
  for (const m of head.slice(0, 40).matchAll(new RegExp(`\\(\\s*(${faWord})\\s*\\)`, 'g'))) add(m[1]);
  for (const m of head.matchAll(new RegExp(`به نام\\s+(${faWord})`, 'g'))) add(m[1]);
  return [...new Set(out)];
}

/** دلیلِ جداسازی (`'other'` یا `'name'`) یا `''`. `memory` همان حافظه‌ی خامِ حساب است. */
export function identityIsolate(question, displayName, lang = 'fa', memory = '') {
  if (forOtherPerson(question, lang)) return 'other';
  const self = declaredSelfName(question, lang);
  if (!self) return '';
  /* نامِ نمایشی گاهی چندتکه است («اسمم هایا»، «شناسنامه زهرا»): اگر اسمِ اعلام‌شده با **هر** تکه‌اش
   * یا با اسمی که حافظه به این آدم داده بخواند، همان آدم است. */
  const known = [...String(displayName || '').trim().split(/\s+/).filter(Boolean),
    ...memorySubjectNames(memory, lang)];
  if (known.length && !known.some((p) => sameName(self, p))) return 'name';
  return '';
}

/* 🧭 برنامه‌ی ایمنیِ یک فال، تک‌منبع برای ربات و آزمایشگاه.
 *   - `crisis`: سؤال حرفِ صریحِ آسیب به خود دارد (⟵ بلوکِ ایمنی + خطِ مراقبت).
 *   - `sensitive`: **سؤالِ همین فال** موضوعِ حساس دارد (⟵ بلوکِ ایمنی).
 *   - `isolate`: فال برای آدمِ دیگری است (⟵ نه حافظه، نه فال‌های قبلی، نه نام).
 *   - `memory`/`prev`: آن‌چه واقعاً به مدل می‌رود.
 * `prev` ردیف‌هایی است با `question` و `summary`؛ فالِ قبلی‌ای که خودش «برای دیگری» بوده
 * از الگوهای خودِ کاربر حذف می‌شود، و فالِ قبلیِ حساس هم کامل حذف می‌شود. */
/* ⏳ آسیبِ **گذشته** («یه زمانی به خودم آسیب می‌زدم ولی الان بهترم») خطرِ امروز نیست:
 * حساس می‌ماند (بلوکِ ایمنی) ولی خطِ مراقبت نمی‌گیرد (قاعده‌ی مالک: فقط خطرِ صریحِ فعلی).
 * عمداً تنگ: فقط واژه‌های آسیب (نه نیتِ مرگ مثلِ «می‌خوام بمیرم») و فقط با نشانه‌ی صریحِ گذشته. */
const FA_PAST_HARM = /(?:به خودم آسیب|به خودم صدمه|خودزنی)/;
const FA_PAST_MARK = /(?:یه زمانی|یک زمانی|یه موقعی|قبلا|قبلاً|سالها پیش|سال‌ها پیش|اون موقع|آن موقع|در گذشته|میزدم|می زدم|می‌زدم|کرده بودم|زده بودم)/;
function pastHarmOnly(question, lang) {
  if (lang !== 'fa') return false;
  const hit = crisisIn(question);
  if (!hit || !FA_PAST_HARM.test(hit)) return false;
  return FA_PAST_MARK.test(faNorm(question).replace(/\s+/g, ' ')) || FA_PAST_MARK.test(String(question));
}

export function readingSafetyPlan({ question = '', displayName = '', memory = '', prev = [], lang = 'fa',
  safety = true, identity = true } = {}) {
  const pastHarm = safety && pastHarmOnly(question, lang);
  const crisis = safety ? (!!crisisIn(question) && !pastHarm) : false;
  const isolate = identity ? identityIsolate(question, displayName, lang, memory) : '';
  let mem = String(memory || '');
  let memoryCut = 0;
  if (safety) { const s = sanitizeMemory(mem, lang); mem = s.text; memoryCut = s.cut; }
  /* 🧷 برچسبِ کلی فقط در DB می‌ماند و هرگز به مدل نمی‌رسد (دورِ آزمایشگاهِ ۱۴۰۵/۰۷/۱۴):
   * با دیدنش، فالِ بعدیِ کاملاً بی‌ربط («از جلسه‌ی قبلی فقط می‌دونم موضوعت حساسه…») هم
   * محتاط و بی‌حکم می‌شد. همین‌طور `sensitive` فقط از **سؤالِ همین فال** می‌آید، نه از
   * حافظه: سؤالِ پولِ کسی که یک بار از بستری گفته، سؤالِ پول است. */
  if (safety) mem = memoryWithoutLabel(mem, lang);
  const sensitive = safety && (crisis || pastHarm || !!sensitiveTermIn(question, lang));
  let outPrev = Array.isArray(prev) ? prev : [];
  if (identity) outPrev = outPrev.filter((p) => !identityIsolate(p?.question, displayName, lang, memory));
  if (safety) {
    /* فالِ قبلیِ حساس **کامل** حذف می‌شود، نه با برچسب: نوع و بازخوردش هم به مدل می‌گفت
     * «این‌جا چیزی بوده»، و همان برچسب را دوباره به فالِ بی‌ربط می‌کشاند. */
    outPrev = outPrev.filter((p) => !(crisisIn(p?.question) || crisisIn(p?.summary)
      || sensitiveTermIn(p?.question, lang) || sensitiveTermIn(p?.summary, lang)));
  }
  if (isolate) { mem = ''; outPrev = []; }
  return { crisis, sensitive, isolate, memory: mem, prev: outPrev, memoryCut };
}

/* 🧠 حافظه‌ای که بعد از یک فال ذخیره می‌شود — تک‌منبعِ ربات و آزمایشگاه.
 * `null` یعنی «هیچ چیزی ننویس». سه قاعده، به این ترتیب:
 *  1. فالِ «آدمِ دیگر» حافظه‌ی صاحبِ حساب را بازنویسی نمی‌کند. **استثنا:** جداسازیِ «اسم»
 *     (`'name'`) روی حسابی که هنوز هیچ حافظه‌ای ندارد چیزی را بازنویسی نمی‌کند، پس حافظه
 *     ذخیره می‌شود و اسمِ اعلام‌شده اسمِ مموری می‌شود؛ وگرنه کاربری که اسمِ نمایشی‌اش لقب است
 *     هرگز حافظه‌ای نمی‌گرفت و همه‌ی فال‌هایش برای همیشه جدا می‌ماندند. «برای دوستم» (`'other'`)
 *     همیشه `null` است.
 *  2. 🚨 فالِ **بحران**: از متنِ حافظه‌ی همین فال هیچ چیز نمی‌ماند؛ حافظه‌ی قبلی (پاک‌شده)
 *     به‌علاوه‌ی برچسبِ کلی ذخیره می‌شود. دلیل (دورِ دومِ آزمایشگاه، ۱۴۰۵/۰۷/۱۴): مدل در
 *     بحران بازنویسی‌هایی می‌سازد که از هر فهرستِ واژه فرار می‌کنند («ارزشِ زندگی‌اش را به
 *     ماندنِ رابطه گره می‌زند»)، پس گاردِ واژه‌ای آن‌جا ساختاراً کافی نیست.
 *  3. بقیه: همان `sanitizeMemory`. */
export function memoryToStore({ newMemory = '', oldMemory = '', crisis = false, isolate = '',
  lang = 'fa', safety = true } = {}) {
  const fresh = String(newMemory || '').trim();
  if (!fresh) return null;
  if (isolate && !(isolate === 'name' && !String(oldMemory || '').trim())) return null;
  if (!safety) return { text: fresh, cut: 0, crisis: false };
  if (crisis) {
    const prior = memoryWithoutLabel(sanitizeMemory(String(oldMemory || ''), lang).text, lang);
    const label = labelOf(lang);
    return { text: prior ? `${prior} ${label}` : label, cut: 1, crisis: true };
  }
  const s = sanitizeMemory(fresh, lang);
  return { text: s.text, cut: s.cut, crisis: false };
}
