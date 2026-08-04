// کاتالوگ فال‌ها
// قانون قیمت: هر کارت ۱۰٬۰۰۰ تومان (price = size × 10k) — استثنا ندارد.
// picks: کاربر حداکثر ۳ کارت را خودش از گرید انتخاب می‌کند؛ اگر size بیشتر باشد،
// بقیه «از جای بریدن دک» به‌ترتیب شافل کشیده می‌شوند (UX ثابت و کم‌اصطکاک).
// focus: فال «موضوعی» است — مرحله‌ی «حول چه موضوعی؟» پرسیده نمی‌شود و همین کلید
// به‌عنوان حوزه‌ی خوانش به LLM می‌رود. نام فال با نام حوزه در پرسشنامه یکی است.
// decisive: فال «تصمیم‌محور» است — کاربر آمده یک جوابِ روشن بگیرد، نه فقط تفسیر.
//   'binary' = آره/نه ، 'choice' = مسیر اول/مسیر دوم. باعث می‌شود پرامپت یک بلوکِ
//   verdict بخواهد و خوانش با پیامِ «جوابِ فال» تمام شود (verdict.js + بند «جوابِ
//   قاطع» در CLAUDE.md همین ربات). فال‌های تفسیری عمداً این را ندارند.

export const DAILY = {
  id: 'daily',
  emoji: '🎴',
  fa: 'کارت روز',
  size: 1,
  price: 0,
  maxTokens: 450,
};

const PER_CARD = 10_000;

const SPREADS = [
  // ترتیبِ این آرایه = ترتیبِ دکمه‌های کاتالوگ. «عشق و رابطه» عمداً اول است: پرتقاضاترین
  // حوزه‌ی کاربران ماست (۴۷٪ از کلِ کاربران این را به‌عنوان تمرکز انتخاب می‌کنند) و از v2.7.0
  // سه‌کارتی و ۳۰٬۰۰۰ تومان است، یعنی **دقیقاً هم‌اندازه‌ی هدیه‌ی خوش‌آمد** — پس کاربرِ تازه
  // می‌تواند همان چیزی را که واقعاً می‌خواهد با اعتبارِ هدیه بگیرد، بدونِ هیچ پرداختی.
  {
    id: 'love', emoji: '💞', fa: 'عشق و رابطه', size: 3, maxTokens: 1600, focus: 'love',
    desc: 'نگاه روشن به رابطه: دل تو، دل او، و مسیری که پیش روتونه',
    positions: [
      { key: 'you', fa: 'قلب تو' },
      { key: 'them', fa: 'قلب او' },
      { key: 'path', fa: 'مسیر رابطه' },
    ],
  },
  {
    id: 'three', emoji: '🔮', fa: 'گذشته، حال، آینده', size: 3, maxTokens: 1600,
    desc: 'نگاه کامل به مسیرت: ریشه‌ی ماجرا، انرژی الان، و جهتی که پیش روته',
    positions: [
      { key: 'past', fa: 'گذشته' },
      { key: 'present', fa: 'حال' },
      { key: 'future', fa: 'آینده' },
    ],
  },
  {
    id: 'career', emoji: '💼', fa: 'کار و مسیر', size: 5, maxTokens: 2400, focus: 'career',
    desc: 'وضعیت حرفه‌ای‌ات: جایگاه الان، برگ برنده، مانع، فرصت پنهان، و برآیند مسیر',
    positions: [
      { key: 'now', fa: 'جایگاه فعلی' },
      { key: 'strength', fa: 'برگ برنده‌ات' },
      { key: 'obstacle', fa: 'مانع' },
      { key: 'opportunity', fa: 'فرصت پنهان' },
      { key: 'outcome', fa: 'برآیند مسیر' },
    ],
  },
  {
    id: 'money', emoji: '💰', fa: 'پول و فراوانی', size: 5, maxTokens: 2400, focus: 'money',
    desc: 'رابطه‌ات با پول: وضعیت الان، نشتی انرژی، باور پنهان، فرصت پیش رو، و مسیر فراوانی',
    positions: [
      { key: 'now', fa: 'وضعیت مالی الان' },
      { key: 'leak', fa: 'نشتی انرژی و پول' },
      { key: 'belief', fa: 'باور پنهانت درباره‌ی پول' },
      { key: 'opportunity', fa: 'فرصت پیش رو' },
      { key: 'path', fa: 'مسیر فراوانی' },
    ],
  },
  {
    id: 'inner', emoji: '🧘', fa: 'حال درونی', size: 5, maxTokens: 2400, focus: 'inner',
    desc: 'برای وقتی حالت با خودت روشن نیست: حال الان، ریشه‌ی ناآرامی، نیاز پنهان، نقطه‌ی قوت، مسیر آرامش',
    positions: [
      { key: 'now', fa: 'حال درونی الان' },
      { key: 'root', fa: 'ریشه‌ی ناآرامی' },
      { key: 'need', fa: 'نیاز پنهان' },
      { key: 'strength', fa: 'نقطه‌ی قوتت' },
      { key: 'path', fa: 'مسیر آرامش' },
    ],
  },
  {
    id: 'family', emoji: '🏠', fa: 'خانواده و نزدیکان', size: 5, maxTokens: 2400, focus: 'family',
    desc: 'فضای بین تو و نزدیکانت: حال رابطه، ریشه‌ی تنش، نقش تو، آنچه دیده نمی‌شه، و مسیر نزدیک‌تر شدن',
    positions: [
      { key: 'now', fa: 'فضای الان' },
      { key: 'root', fa: 'ریشه‌ی تنش' },
      { key: 'role', fa: 'نقش تو' },
      { key: 'unseen', fa: 'چیزی که دیده نمی‌شه' },
      { key: 'path', fa: 'مسیر نزدیک‌تر شدن' },
    ],
  },
  {
    id: 'migration', emoji: '✈️', fa: 'مهاجرت و تغییر بزرگ', size: 5, maxTokens: 2400, focus: 'migration',
    desc: 'برای جابه‌جایی‌های بزرگ زندگی: جایگاه الان، انگیزه‌ی واقعی، ریسک، آنچه در مقصد منتظرته، و چراغ تصمیم',
    positions: [
      { key: 'now', fa: 'جایگاه الان' },
      { key: 'why', fa: 'انگیزه‌ی واقعی' },
      { key: 'risk', fa: 'مانع یا ریسک' },
      { key: 'there', fa: 'چیزی که در مقصد منتظرته' },
      { key: 'guide', fa: 'چراغ تصمیم' },
    ],
  },
  {
    id: 'yesno', emoji: '⚖️', fa: 'آری یا نه', size: 2, maxTokens: 1600, decisive: 'binary',
    desc: 'برای یک تصمیم مشخص: یک جوابِ روشن، با نشونه‌ای که توی کارت‌ها می‌بینی',
    positions: [
      { key: 'core', fa: 'قلب ماجرا' },
      { key: 'direction', fa: 'جهت انرژی' },
    ],
  },
  {
    id: 'choice', emoji: '🔀', fa: 'دوراهی', size: 5, maxTokens: 2600, decisive: 'choice',
    desc: 'بین دو مسیر گیر کردی؟ انرژی هر دو راه، و در آخر یک مسیرِ روشن با نشونه‌اش',
    positions: [
      { key: 'you', fa: 'خودت در این لحظه' },
      { key: 'pathA', fa: 'مسیر اول' },
      { key: 'pathB', fa: 'مسیر دوم' },
      { key: 'hidden', fa: 'عامل پنهان' },
      { key: 'guide', fa: 'چراغ راهنما' },
    ],
  },
  {
    id: 'celtic', emoji: '✨', fa: 'صلیب سلتی (کامل)', size: 10, maxTokens: 3500,
    desc: 'کامل‌ترین خوانش تاروت: ده کارت، تصویر تمام‌قد از زندگی‌ات حول این سؤال',
    positions: [
      { key: 'situation', fa: 'موقعیت فعلی' },
      { key: 'challenge', fa: 'چالش' },
      { key: 'root', fa: 'ریشه' },
      { key: 'past', fa: 'گذشته' },
      { key: 'crown', fa: 'هدف آگاهانه' },
      { key: 'near', fa: 'آینده‌ی نزدیک' },
      { key: 'self', fa: 'خودت' },
      { key: 'environment', fa: 'محیط و اطرافیان' },
      { key: 'hopes', fa: 'امیدها و ترس‌ها' },
      { key: 'outcome', fa: 'برآیند' },
    ],
  },
].map(s => ({ ...s, price: s.size * PER_CARD }));

// فال «موضوع آزاد»: کاربر خودش موضوع را می‌نویسد (هر چیزی از زندگی‌اش).
// عمداً در کاتالوگِ SPREADS و suggestSpreads نمی‌آید؛ فقط از دکمه‌ی «موضوع دلخواه» و SPREAD_BY_ID
// در دسترس است تا هدفِ سیگنال‌دادنِ «می‌تونی درباره‌ی هر چیزی فال بگیری» بدون شلوغ‌کردن کاتالوگ انجام شود.
export const OPEN_SPREADS = [
  {
    id: 'open3', emoji: '🌀', fa: 'موضوع دلخواه', size: 3, maxTokens: 1600, open: true,
    desc: 'هر چیزی که این روزها ذهنت رو گرفته',
    positions: [
      { key: 'root', fa: 'ریشه‌ی ماجرا' },
      { key: 'now', fa: 'وضعیت الان' },
      { key: 'path', fa: 'مسیر پیش رو' },
    ],
  },
  {
    id: 'open5', emoji: '🌀', fa: 'موضوع دلخواه (عمیق‌تر)', size: 5, maxTokens: 2400, open: true,
    desc: 'همون موضوع، با نگاهی عمیق‌تر و پنج‌کارتی',
    positions: [
      { key: 'core', fa: 'قلب ماجرا' },
      { key: 'root', fa: 'ریشه' },
      { key: 'hidden', fa: 'نیروی پنهان' },
      { key: 'challenge', fa: 'مانع پیش رو' },
      { key: 'path', fa: 'مسیر پیش رو' },
    ],
  },
].map(s => ({ ...s, price: s.size * PER_CARD }));

export const SPREAD_BY_ID = Object.fromEntries([...SPREADS, ...OPEN_SPREADS].map(s => [s.id, s]));
export default SPREADS;
