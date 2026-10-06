#!/usr/bin/env node
// چکِ ایمنیِ فال (bots/tarot/reading-safety.js، v3.154.0).
//
// چرا: ممیزیِ یک کاربرِ واقعی (۱۴۰۵/۰۷/۱۴) سه شکاف نشان داد: فالِ موضوعِ حساس (خودکشی، بستری)
// بدونِ هیچ احتیاطی ساخته می‌شد، حافظه سابقه‌ی پزشکی را نگه می‌داشت و به فال‌های بعدی می‌برد، و
// فالی که آشکارا برای آدمِ دیگری بود («اسمم X»، «برای دوستم») با حافظه و الگوهای خودِ کاربر قاطی
// می‌شد. سه تصمیمِ مالک: فال داده می‌شود ولی با بلوکِ ایمنی + خطِ مراقبتِ ثابت؛ حافظه فقط یک
// برچسبِ کلی نگه می‌دارد؛ اسمِ متفاوت یعنی شاید آدمِ متفاوت.
//
// این چک هر دو جهت را قفل می‌کند. منفی‌های واقعی (جمله‌هایی که روی دیتای واقعی به‌غلط گرفته
// می‌شدند، بازنویسی‌شده و بی‌نام) عمداً این‌جا هستند تا اگر الگو گشاد شود، قرمز شود.
import { readFileSync } from 'node:fs';

process.env.LOCALE = 'fa';
process.env.LANGS = 'fa,en,ru,es,pt';
const { configureAllLocales } = await import('../bots/tarot/locale-boot.js');
const { withLang, Lfor } = await import('../bots/tarot/locale-ctx.js');
const RS = await import('../bots/tarot/reading-safety.js');
const { crisisIn } = await import('../bots/tarot/chat-core.js');
configureAllLocales();

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`❌ ${name}`); } };
const fa = (fn) => withLang('fa', fn);

// ---------- ۱) بحران: صریح می‌گیرد، حالِ بد نمی‌گیرد ----------
fa(() => {
  for (const q of ['میخوام خودمو بکشم', 'به خودکشی فکر میکنم', 'امشب خودکشی میکنم؟', 'دیگه نمیخوام زنده باشم'])
    ok(`بحرانِ صریح گرفته شود: «${q}»`, !!crisisIn(q));
  for (const q of ['خودمو بکشم عقب از این رابطه؟', 'چطور نفس بکشم وقتی استرس دارم', 'دیگه نمی‌کشم خسته‌ام', 'حالم بده', 'سیگار بکشم یا نه'])
    ok(`حالِ بد یا معنای دیگر بحران نیست: «${q}»`, !crisisIn(q));
});

// ---------- ۲) واژه‌ی حساس (پزشکی/روانی) ----------
fa(() => {
  ok('بستری حساس است', RS.sensitiveTermIn('مامانم بستری شده خوب میشه؟', 'fa') !== '');
  ok('روانپزشک حساس است', RS.sensitiveTermIn('برم پیش روانپزشک؟', 'fa') !== '');
  ok('اضطراب حساس نیست (حالِ روزمره)', RS.sensitiveTermIn('اضطراب دارم برای امتحان', 'fa') === '');
  ok('تراپی حساس نیست', RS.sensitiveTermIn('تراپی برم یا نه', 'fa') === '');
  ok('متنِ خالی خالی', RS.sensitiveTermIn('', 'fa') === '');
  ok('مرزِ کلمه: «سرطان» داخلِ کلمه‌ی دیگر نیست', RS.sensitiveTermIn('برج سرطانی', 'fa') === 'سرطان' || RS.sensitiveTermIn('برج سرطانی', 'fa') === '');
});
for (const [lang, q] of [['en', 'I was hospitalized last month'], ['ru', 'меня госпитализировали'], ['es', 'estuve internada'], ['pt', 'fiquei internada']])
  withLang(lang, () => ok(`واژه‌ی حساس در ${lang}`, RS.sensitiveTermIn(q, lang) !== ''));

// ---------- ۳) بحران در سه زبانِ تازه (langdata.chat.crisis) ----------
for (const [lang, yes, no] of [
  ['ru', 'не хочу жить', 'хочу понять его'],
  ['es', 'quiero morir', 'quiero saber si vuelve'],
  ['pt', 'não quero viver', 'quero saber se ele volta'],
  ['en', "I want to kill myself", 'I want to know if he comes back'],
]) withLang(lang, () => {
  ok(`بحران در ${lang} گرفته شود`, !!crisisIn(yes));
  ok(`سؤالِ عادی در ${lang} بحران نیست`, !crisisIn(no));
});
for (const lang of ['ru', 'es', 'pt']) {
  const d = JSON.parse(readFileSync(new URL(`../bots/tarot/langdata.${lang}.json`, import.meta.url), 'utf8'));
  ok(`langdata.${lang}.json فهرستِ chat.crisis دارد`, Array.isArray(d.chat?.crisis) && d.chat.crisis.length >= 5);
}

// ---------- ۴) پاک‌سازیِ حافظه ----------
fa(() => {
  const m = 'دنبالِ رابطه‌ی پایدار است. سالِ پیش اقدام به خودکشی کرده و بستری بوده. به کارش علاقه دارد.';
  const s = RS.sanitizeMemory(m, 'fa');
  ok('جمله‌ی حساس حذف شد', !/خودکشی|بستری/.test(s.text));
  ok('بقیه‌ی شناخت ماند', s.text.includes('رابطه‌ی پایدار') && s.text.includes('کارش'));
  ok('برچسبِ کلی اضافه شد', s.text.includes(RS.SENSITIVE_LABEL.fa));
  ok('شمارشِ حذف', s.cut === 1);
  const again = RS.sanitizeMemory(s.text, 'fa');
  ok('idempotent: برچسب دوباره اضافه نمی‌شود', again.text.split(RS.SENSITIVE_LABEL.fa).length === 2 && again.cut === 0);
  const clean = 'دنبالِ کارِ تازه است.';
  ok('حافظه‌ی سالم بیت‌به‌بیت دست‌نخورده', RS.sanitizeMemory(clean, 'fa').text === clean);
  ok('حافظه‌ی خالی', RS.sanitizeMemory('', 'fa').text === '');
  ok('memorySensitive برچسب‌خورده را می‌شناسد', RS.memorySensitive(s.text, 'fa'));
  ok('memorySensitive سالم را نمی‌گیرد', !RS.memorySensitive(clean, 'fa'));
});

// ---------- ۵) اسمِ اعلام‌شده (فقط الگوهای بی‌ابهام) ----------
fa(() => {
  ok('«اسمم سارا»', RS.declaredSelfName('اسمم سارا هست، ازدواج می‌کنم؟', 'fa') === 'سارا');
  ok('«من مریم متولد…»', RS.declaredSelfName('من مریم متولد آبان، کارم درست میشه؟', 'fa') === 'مریم');
  ok('«خودم زینب طرف مقابل…»', RS.declaredSelfName('خودم زینب طرف مقابل علی، برمیگرده؟', 'fa') === 'زینب');
  // منفی‌های واقعی (بازنویسی‌شده): روی دیتای واقعی اسم خوانده می‌شدند.
  ok('«دست خودم نیس و…» اسم نیست', RS.declaredSelfName('دست خودم نیس و دلم براش تنگه', 'fa') === '');
  ok('«از طرف خودم چیه؟» اسم نیست', RS.declaredSelfName('احساس از طرف خودم چیه؟', 'fa') === '');
  ok('«اسمم میاد» فعل است نه اسم', RS.declaredSelfName('هر بار اسمم میاد ناراحت میشه', 'fa') === '');
  ok('«من خسته هستم» اسم نیست', RS.declaredSelfName('من خسته هستم چیکار کنم', 'fa') === '');
  ok('«اسمم ماه…» واژه‌ی ممنوع', RS.declaredSelfName('اسمم ماه تولدم آبانه', 'fa') === '');
});
ok('en: my name is', RS.declaredSelfName('My name is Anna, will he call?', 'en') === 'Anna');
ok('ru: меня зовут', RS.declaredSelfName('Меня зовут Ольга, он вернётся?', 'ru') === 'Ольга');
ok('es: me llamo', RS.declaredSelfName('Me llamo Lucía y quiero saber', 'es') === 'Lucía');
ok('pt: meu nome é', RS.declaredSelfName('Meu nome é Ana, ele volta?', 'pt') === 'Ana');

// ---------- ۶) فال برای دیگری ----------
fa(() => {
  for (const q of ['این فال برای دوستمه، کارش درست میشه؟', 'برای خواهرم فال میخوام', 'سوال من نیست، رفیقم میخواد بدونه', 'فال برای مامانم'])
    ok(`برای دیگری: «${q}»`, RS.forOtherPerson(q, 'fa'));
  for (const q of ['برای دوستم کادو بخرم؟', 'دوستم ازم دلخوره، آشتی می‌کنیم؟', 'مامانم با ازدواجم موافقت میکنه؟'])
    ok(`سؤالِ خودِ کاربر درباره‌ی دیگری نیست: «${q}»`, !RS.forOtherPerson(q, 'fa'));
});
ok('en: reading for my sister', RS.forOtherPerson('This is for my sister, will she pass?', 'en'));
ok('ru: расклад для подруги', RS.forOtherPerson('Расклад для подруги: он вернётся?', 'ru'));

// ---------- ۷) جداسازیِ هویت ----------
fa(() => {
  ok('اسمِ متفاوت ⟵ name', RS.identityIsolate('اسمم سارا هست، برمیگرده؟', 'مریم', 'fa') === 'name');
  ok('همان اسم ⟵ هیچ', RS.identityIsolate('اسمم مریم هست، برمیگرده؟', 'مریم', 'fa') === '');
  ok('پسوند آزاد («مریمم»)', RS.identityIsolate('اسمم مریمم', 'مریم', 'fa') === '');
  ok('نامِ نمایشیِ چندتکه: هر تکه کافی است', RS.identityIsolate('اسمم زهرا هست', 'شناسنامه زهرا', 'fa') === '');
  ok('بدونِ نامِ نمایشی ⟵ هیچ (نمی‌دانیم)', RS.identityIsolate('اسمم سارا', '', 'fa') === '');
  ok('برای دیگری ⟵ other', RS.identityIsolate('این فال برای دوستمه', 'مریم', 'fa') === 'other');
});

// ---------- ۸) برنامه‌ی کامل ----------
fa(() => {
  const prev = [
    { question: 'کارم درست میشه؟', summary: 'کار پیش می‌رود.' },
    { question: 'برای دوستم فال میخوام، برمیگرده؟', summary: 'دوستش برمی‌گردد.' },
    { question: 'مامانم بستری شده', summary: 'نگرانِ بیمارستان.' },
  ];
  const mem = 'دنبالِ کار است. سابقه‌ی افسردگی دارد.';
  const p = RS.readingSafetyPlan({ question: 'کار جدید پیدا می‌کنم؟', displayName: 'مریم', memory: mem, prev, lang: 'fa' });
  ok('سؤالِ عادی: بحران نه', !p.crisis);
  // حساس بودن فقط از سؤالِ همین فال می‌آید؛ حافظه‌ی برچسب‌خورده سؤالِ پولی را «حساس» نمی‌کند.
  ok('سؤالِ عادی با حافظه‌ی حساس ⟵ sensitive خاموش', !p.sensitive);
  ok('حافظه پاک‌شده به مدل می‌رود', !/افسردگی/.test(p.memory) && p.memory.includes('دنبالِ کار'));
  ok('برچسبِ حساس به مدل نمی‌رسد', !p.memory.includes(RS.SENSITIVE_LABEL.fa.replace(/\.$/, '')));
  ok('فالِ «برای دیگری» و فالِ حساس از سابقه حذف شدند', p.prev.length === 1 && !p.prev.some((x) => /دوستم|بستری/.test(x.question)));
  ok('سابقه‌ی حساس اصلاً به مدل نمی‌رسد (نه حتی برچسب)', !p.prev.some((x) => x.summary === RS.SENSITIVE_LABEL.fa));
  // کنترلِ مثبت: سؤالِ خودش حساس است ⟵ sensitive روشن.
  ok('سؤالِ حساس با همان حافظه ⟵ sensitive روشن', RS.readingSafetyPlan({ question: 'مامانم بستری شده خوب میشه؟', displayName: 'مریم', memory: mem, prev, lang: 'fa' }).sensitive);
  ok('خلاصه‌ی فالِ عادی دست‌نخورده', p.prev.find((x) => x.question === 'کارم درست میشه؟')?.summary === 'کار پیش می‌رود.');
  ok('ورودی دست‌نخورده (کپی، نه mutate)', prev[2].summary === 'نگرانِ بیمارستان.');

  const iso = RS.readingSafetyPlan({ question: 'اسمم سارا هست، برمیگرده؟', displayName: 'مریم', memory: mem, prev, lang: 'fa' });
  ok('جداسازی: حافظه خالی', iso.isolate === 'name' && iso.memory === '');
  ok('جداسازی: هیچ فالِ قبلی', iso.prev.length === 0);

  const cr = RS.readingSafetyPlan({ question: 'امشب میخوام خودمو بکشم', displayName: 'مریم', memory: '', prev: [], lang: 'fa' });
  ok('بحران ⟵ crisis و sensitive', cr.crisis && cr.sensitive);

  const off = RS.readingSafetyPlan({ question: 'امشب میخوام خودمو بکشم', displayName: 'مریم', memory: mem, prev, lang: 'fa', safety: false, identity: false });
  ok('رول‌بک safety=false: هیچ‌چیز عوض نمی‌شود', !off.crisis && !off.sensitive && off.memory === mem && off.prev.length === 3);
  const offIso = RS.readingSafetyPlan({ question: 'اسمم سارا', displayName: 'مریم', memory: mem, prev, lang: 'fa', identity: false });
  ok('رول‌بک identity=false: جداسازی خاموش (فالِ «برای دوستم» می‌ماند، فقط حساس می‌رود)', offIso.isolate === '' && offIso.prev.length === 2 && offIso.prev.some((x) => /دوستم/.test(x.question)));
});

// ---------- ۹) locale: بلوکِ ایمنی و خطِ مراقبت در هر پنج زبان ----------
for (const lang of ['fa', 'en', 'ru', 'es', 'pt']) {
  const L = Lfor(lang);
  ok(`${lang}: prompts.readerSafety`, typeof L.prompts?.readerSafety === 'string' && L.prompts.readerSafety.length > 80);
  ok(`${lang}: reading.careLine`, typeof L.reading?.careLine === 'string' && L.reading.careLine.length > 20);
  ok(`${lang}: careLine بدونِ خط تیره‌ی بلند`, !/—|--/.test(L.reading.careLine));
  ok(`${lang}: readerSafety برچسبِ کلیِ همان زبان را دارد`, L.prompts.readerSafety.includes(RS.SENSITIVE_LABEL[lang].replace(/\.$/, '')));
}
ok('fa: careLine شماره‌ی اورژانسِ اجتماعی یا ۱۲۳ را دارد', /۱۲۳|123/.test(Lfor('fa').reading.careLine));

// ---------- ۹ب) سه شکافِ سناریوهای آزمایشگاهِ ایمنی (۱۴۰۵/۰۷/۱۴) ----------
fa(() => {
  const plan = (question, displayName = 'فاطمه') => RS.readingSafetyPlan({ question, displayName, lang: 'fa' });
  // اسمی که با «می» شروع می‌شود فعل نیست؛ فعلِ واقعی هنوز رد می‌شود (کنترلِ مثبت).
  ok('«اسمم مینا هست» اسم است', RS.declaredSelfName('اسمم مینا هست، رابطه‌م با علی به کجا می‌رسه؟', 'fa') === 'مینا');
  ok('«اسمم میلاد،» اسم است', RS.declaredSelfName('اسمم میلاد، کارم چی میشه', 'fa') === 'میلاد');
  ok('«اسمم میاد وسط» هنوز فعل است', RS.declaredSelfName('اسمم میاد وسط', 'fa') === '');
  ok('«اسمم میپیچه» هنوز فعل است', RS.declaredSelfName('اسمم میپیچه همه جا', 'fa') === '');
  ok('اسمِ متفاوت ⟵ جداسازی', plan('اسمم مینا هست، رابطه‌م با علی به کجا می‌رسه؟').isolate === 'name');
  ok('اسمِ خودش ⟵ بدونِ جداسازی', plan('اسمم فاطمه هست، رابطه‌م با علی به کجا می‌رسه؟').isolate === '');
  // خطرِ آدمِ دیگر: حساس، ولی بحرانِ خودِ کاربر نیست.
  const third = plan('همسرم چند بار گفته می‌خواد خودشو بکشه. باید چیکار کنم؟');
  ok('خودکشیِ سوم‌شخص حساس است', third.sensitive);
  ok('خودکشیِ سوم‌شخص خطِ مراقبت نمی‌گیرد', !third.crisis);
  // آسیبِ گذشته: حساس، بدونِ خطِ مراقبت؛ ولی آسیبِ فعلی هنوز بحران است (کنترلِ مثبت).
  const past = plan('یه زمانی به خودم آسیب می‌زدم ولی الان خیلی بهترم. این کار جدید برام خوبه؟');
  ok('آسیبِ گذشته حساس است', past.sensitive);
  ok('آسیبِ گذشته خطِ مراقبت نمی‌گیرد', !past.crisis);
  ok('آسیبِ فعلی هنوز بحران است', plan('دلم میخواد به خودم آسیب بزنم').crisis);
  ok('نیتِ مرگ با نشانه‌ی گذشته هنوز بحران است', plan('قبلا هم گفتم، میخوام بمیرم').crisis);
  // کنترل‌ها: «خودمو بکشم عقب» و سؤالِ عادی هیچ پرچمی ندارند.
  const ctrl = plan('خودمو از این رابطه بکشم عقب یا نه؟');
  ok('«بکشم عقب» نه بحران نه حساس', !ctrl.crisis && !ctrl.sensitive);
});

// ---------- ۹ج) جمله‌های واقعیِ آزمایشگاه (۱۴۰۵/۰۷/۱۴) — نقص‌هایی که دورِ اول نشان داد ----------
fa(() => {
  const L = RS.SENSITIVE_LABEL.fa;
  const head = L.split(/[;؛]/)[0].trim();
  const count = (t) => t.split(head).length - 1;
  // S2.1 و S3.1: مدل این جمله‌ها را در حافظه نوشت و پاک‌سازی نمی‌گرفتشان.
  for (const m of [
    'پایانِ رابطه را به آسیب‌زدن به خود گره زده و نگران است.',
    'گاهی فکرِ پایان‌دادن به زندگی به سرش می‌زند.',
    'می‌ترسد خواهرش به زندگی‌اش پایان دهد.',
    'از افکار خودکشی گفته است.',
  ]) {
    const s = RS.sanitizeMemory(`به کارش علاقه دارد. ${m}`, 'fa');
    ok(`جمله‌ی واقعیِ حساس بریده شد: «${m.slice(0, 30)}…»`, s.cut === 1 && !s.text.includes(m.replace(/\.$/, '')) && s.text.includes('کارش'));
  }
  // کنترلِ منفی: «پایانِ رابطه» و «به خودش رسید» حساس نیستند.
  for (const m of ['پایانِ رابطه را پذیرفته است.', 'این ماه بیشتر به خودش رسید.', 'به زندگی‌اش نظم داده است.']) {
    const s = RS.sanitizeMemory(m, 'fa');
    ok(`جمله‌ی عادی دست‌نخورده: «${m}»`, s.cut === 0 && s.text === m);
  }
  // برچسبِ تکراری که مدل خودش نوشت ⟵ یکی.
  const dup = RS.sanitizeMemory(`دنبالِ کار است. ${L} ${L}`, 'fa');
  ok('برچسبِ دوبله یکی شد', count(dup.text) === 1 && dup.text.includes('دنبالِ کار'));
  // برچسبِ بازنویسی‌شده (با کسره و جمله‌بندیِ دیگر) هم برچسب شناخته می‌شود.
  const para = RS.sanitizeMemory('دنبالِ کار است. و موضوعِ حساس دارد؛ با احتیاط.', 'fa');
  ok('برچسبِ بازنویسی‌شده جایگزینِ برچسبِ اصلی شد', count(para.text) === 1 && !/دارد؛/.test(para.text));
  ok('memoryWithoutLabel برچسب را برمی‌دارد', RS.memoryWithoutLabel(`دنبالِ کار است. ${L}`, 'fa') === 'دنبالِ کار است.');
  ok('memoryWithoutLabel حافظه‌ی بی‌برچسب را دست نمی‌زند', RS.memoryWithoutLabel('دنبالِ کار است.', 'fa') === 'دنبالِ کار است.');
  // برنامه: حافظه‌ی برچسب‌خورده بی‌برچسب به مدل می‌رسد و سؤالِ پولی حساس نمی‌شود.
  const pm = RS.readingSafetyPlan({ question: 'پولم زیاد میشه؟', displayName: 'مریم', memory: `نگران کار است. ${L}`, prev: [], lang: 'fa' });
  ok('برنامه: سؤالِ پولی با حافظه‌ی برچسب‌دار حساس نیست', !pm.sensitive && !pm.crisis);
  ok('برنامه: حافظه بی‌برچسب به مدل می‌رسد', pm.memory === 'نگران کار است.');
  // کنترلِ مثبت: رول‌بک دست‌نخورده.
  const off = RS.readingSafetyPlan({ question: 'پولم زیاد میشه؟', displayName: 'مریم', memory: `نگران کار است. ${L}`, prev: [], lang: 'fa', safety: false });
  ok('رول‌بک: حافظه بیت‌به‌بیت', off.memory === `نگران کار است. ${L}`);
});

// ---------- ۹د) آزمایشگاه آینه‌ی ربات است: جداسازی نام و حافظه را هم می‌برد ----------
{
  const lab = readFileSync(new URL('./reading-lab.mjs', import.meta.url), 'utf8');
  ok('آزمایشگاه: نام در جداسازی روی سرخط نمی‌نشیند', /name: plan\.isolate \? '' : persona\.name/.test(lab));
  ok('آزمایشگاه: حافظه در جداسازی به‌روز نمی‌شود', /&& !plan\.isolate/.test(lab));
}

// ---------- ۱۰) سیم‌کشی در ربات ----------
const src = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const core = readFileSync(new URL('../bots/tarot/reading-core.js', import.meta.url), 'utf8');
ok('پرچم‌ها روشن‌اند', /const READING_SAFETY = true;/.test(src) && /const READING_IDENTITY_GUARD = true;/.test(src));
ok('برنامه با پرچم‌ها ساخته می‌شود', /safety: READING_SAFETY, identity: READING_IDENTITY_GUARD/.test(src));
ok('بلوکِ ایمنی فقط وقتی sensitive است به پرامپت می‌چسبد', /ctx\.safety\.sensitive \? `\$\{system\}\\n\$\{L\.prompts\.readerSafety\}` : system/.test(src));
ok('پرامپتِ ایمن واقعاً به مدل می‌رود', /safeSystem/.test(src.slice(src.indexOf('const safeSystem'), src.indexOf('const safeSystem') + 3000).replace('const safeSystem', '')));
ok('خطِ مراقبت فقط روی بحران', /if \(safety\.crisis\) \{[\s\S]{0,120}L\.reading\.careLine/.test(src));
ok('خطِ مراقبت قبل از delivered', src.indexOf('L.reading.careLine') < src.indexOf("setReadingStatus.run('delivered'", src.indexOf('L.reading.careLine') - 4000) || src.indexOf('L.reading.careLine') < src.indexOf("'delivered'", src.indexOf('L.reading.careLine')));
ok('حافظه در جداسازی نوشته نمی‌شود', /llm\.memory\.trim\(\) && !safety\.isolate/.test(src));
ok('حافظه پیش از نوشتن پاک‌سازی می‌شود', /READING_SAFETY \? sanitizeMemory\(llm\.memory\.trim\(\)/.test(src));
ok('نام در جداسازی روی سرخط نمی‌نشیند', /uxV2For\(r\.user_id\) && !safety\.isolate \? dispName/.test(src));
ok('کانتکستِ فال memory و prev را از برنامه می‌گیرد', /memory: plan\.memory/.test(src) && /prev: plan\.prev/.test(src));
ok('گفتگو هم از همان برنامه می‌خواند', /chatSafety = safetyPlanFor\(/.test(src) && /memory: chatSafety\.memory/.test(src));
ok('buildReadingCtx پارامترِ memory را می‌پذیرد', /memory !== undefined \? String\(memory \|\| ''\) : \(user\.memory_json \|\| ''\)/.test(core));
ok('رویدادِ افزایشیِ reading_safety بدونِ متن', /track\(db, uid, 'reading_safety', \{[\s\S]{0,200}memory_cut/.test(src) && !/'reading_safety', \{[^}]*question/.test(src));
ok('PRODUCT_VERSION بامپ شد', /PRODUCT_VERSION = '3\.154\.0'/.test(src));

console.log(`\n${fail ? '❌' : '✅'} reading-safety: ${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
