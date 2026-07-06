// کاتالوگ فال‌ها — قیمت‌ها به تومان
// picks: کاربر همیشه ۳ کارت را خودش از گرید انتخاب می‌کند؛ اگر size بیشتر باشد،
// بقیه «از جای بریدن دک» به‌ترتیب شافل کشیده می‌شوند (UX ثابت و کم‌اصطکاک).

export const DAILY = {
  id: 'daily',
  emoji: '🎴',
  fa: 'کارت روز',
  size: 1,
  price: 0,
  maxTokens: 450,
};

const SPREADS = [
  {
    id: 'three', emoji: '🔮', fa: 'گذشته، حال، آینده', size: 3, price: 30_000, maxTokens: 1600,
    desc: 'نگاه کامل به مسیرت: ریشه‌ی ماجرا، انرژی الان، و جهتی که پیش روته',
    positions: [
      { key: 'past', fa: 'گذشته' },
      { key: 'present', fa: 'حال' },
      { key: 'future', fa: 'آینده' },
    ],
  },
  {
    id: 'yesno', emoji: '⚖️', fa: 'آری یا نه', size: 2, price: 15_000, maxTokens: 1200,
    desc: 'برای یک تصمیم مشخص: جوابِ تمایل انرژی + چرایی‌اش',
    positions: [
      { key: 'core', fa: 'قلب ماجرا' },
      { key: 'direction', fa: 'جهت انرژی' },
    ],
  },
  {
    id: 'love', emoji: '💞', fa: 'عشق و رابطه', size: 5, price: 50_000, maxTokens: 2400,
    desc: 'عمیق‌ترین نگاه به رابطه: دل تو، دل او، پیوند، مانع، و مسیر پیش رو',
    positions: [
      { key: 'you', fa: 'قلب تو' },
      { key: 'them', fa: 'قلب او' },
      { key: 'bond', fa: 'پیوند بینتون' },
      { key: 'challenge', fa: 'مانع پیش رو' },
      { key: 'path', fa: 'مسیر رابطه' },
    ],
  },
  {
    id: 'career', emoji: '💼', fa: 'کار و پول', size: 5, price: 50_000, maxTokens: 2400,
    desc: 'وضعیت حرفه‌ای و مالی: جایگاه الان، نقطه‌ی قوت، مانع، فرصت پنهان، و نتیجه',
    positions: [
      { key: 'now', fa: 'جایگاه فعلی' },
      { key: 'strength', fa: 'برگ برنده‌ات' },
      { key: 'obstacle', fa: 'مانع' },
      { key: 'opportunity', fa: 'فرصت پنهان' },
      { key: 'outcome', fa: 'برآیند مسیر' },
    ],
  },
  {
    id: 'money', emoji: '💰', fa: 'پول و فراوانی', size: 4, price: 40_000, maxTokens: 2000,
    desc: 'رابطه‌ات با پول: وضعیت الان، جایی که انرژی نشت می‌کنه، فرصت پیش رو، و مسیر فراوانی',
    positions: [
      { key: 'now', fa: 'وضعیت مالی الان' },
      { key: 'leak', fa: 'نشتی انرژی و پول' },
      { key: 'opportunity', fa: 'فرصت پیش رو' },
      { key: 'path', fa: 'مسیر فراوانی' },
    ],
  },
  {
    id: 'inner', emoji: '🧘', fa: 'آینه‌ی درون', size: 4, price: 40_000, maxTokens: 2000,
    desc: 'برای وقتی حالت با خودت روشن نیست: حال الان، ریشه‌ی ناآرامی، نیاز پنهان، مسیر آرامش',
    positions: [
      { key: 'now', fa: 'حال درونی الان' },
      { key: 'root', fa: 'ریشه‌ی ناآرامی' },
      { key: 'need', fa: 'نیاز پنهان' },
      { key: 'path', fa: 'مسیر آرامش' },
    ],
  },
  {
    id: 'choice', emoji: '🔀', fa: 'دوراهی', size: 5, price: 50_000, maxTokens: 2400,
    desc: 'بین دو مسیر گیر کردی؟ انرژی هر دو راه، عامل پنهان ماجرا، و چراغ راهنمای انتخاب',
    positions: [
      { key: 'you', fa: 'خودت در این لحظه' },
      { key: 'pathA', fa: 'مسیر اول' },
      { key: 'pathB', fa: 'مسیر دوم' },
      { key: 'hidden', fa: 'عامل پنهان' },
      { key: 'guide', fa: 'چراغ راهنما' },
    ],
  },
  {
    id: 'celtic', emoji: '✨', fa: 'صلیب سلتی (کامل)', size: 10, price: 90_000, maxTokens: 3500,
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
];

export const SPREAD_BY_ID = Object.fromEntries(SPREADS.map(s => [s.id, s]));
export default SPREADS;
