// خواندنِ صفِ سوال‌های ویدیو از یک دیتابیسِ Notion، و علامت‌زدنِ ردیفِ مصرف‌شده.
//
// چرا fetch خام و نه SDK: قاعده‌ی `tools/` این ریپو هیچ وابستگیِ npm را نمی‌پذیرد، و
// الگوی جاافتاده‌ی `bots/daily-brief/notion.js` نشان داده سه هدرِ ثابت کافی است.
// `Notion-Version` قفل است تا تغییرِ سمتِ نوشن پارس را بی‌صدا نشکند.
//
// سه قاعده‌ی این ماژول:
//   ۱) **علامت‌زدنِ «استفاده‌شده» فقط بعد از تحویلِ واقعیِ ویدیو** انجام می‌شود، و آن هم
//      از `deliver.mjs`. اگر این‌جا موقعِ خواندن علامت می‌خورد، هر شکستِ رندر یک سوال را
//      برای همیشه می‌سوزاند.
//   ۲) پارس **بخشنده** است: ردیفِ ناقص رد می‌شود، نه اینکه کلِ صف را بشکند. یک ردیفِ
//      خرابِ نوشن نباید جابِ ویدیو را قرمز کند.
//   ۳) هر تابعی که شبکه لازم ندارد **بیرونِ** `createNotion` است تا چکِ CI بدونِ توکن و
//      بدونِ اینترنت روی fixture اجرایش کند.

const NOTION_VERSION = '2022-06-28';

// مقدارِ Select «نوع فال» → کلیدِ موضوعِ `TOPICS_V3` در `bots/tarot/spreads.js`.
// آی‌دیِ چیدمان = `<topic>3` (نسخه‌ی اول فقط سه‌کارتی است).
// هر دو املای «سؤال/سوال» هست چون هر دو در نوشن تایپ می‌شوند و کاربر نباید یادش باشد
// کدام را زده؛ ناشناخته/خالی → `personal` که همیشه معتبر است.
export const TOPIC_MAP = {
  'سؤال شخصی': 'personal',
  'سوال شخصی': 'personal',
  'بله و خیر': 'yesno',
  'عشق و رابطه': 'love',
  'کراش': 'crush',
  'حس طرف مقابل': 'feel',
  'تعهد یا خیانت': 'commit',
  'شغل': 'career',
  'پول': 'money',
  'دوراهی': 'choice',
};

export const DEFAULT_TOPIC = 'personal';

// مقدارِ Select «پس‌زمینه» → نامِ پس‌زمینه‌ی کامپوزیشن.
export const BG_MAP = {
  'عرفانی': 'mystic',
  'طبیعت': 'nature',
  'مینیمال': 'minimal',
};

const STATUS_READY = 'آماده';
const STATUS_USED = 'استفاده‌شده';

// نامِ پراپرتی‌ها در نوشن فارسی است، ولی املای «سوال/سؤال» و حروفِ عربی/فارسیِ «ی» و «ک»
// در تایپِ دستی قاطی می‌شوند. به‌جای اینکه کاربر مجبور باشد دقیق تایپ کند، نامِ پراپرتی
// نرمال‌سازی می‌شود و بعد تطبیق می‌خورد.
const normKey = (s) => String(s ?? '')
  .replace(/[يﻱﻲ]/g, 'ی')
  .replace(/[كﻙﻚ]/g, 'ک')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/[ؤئ]/g, 'و')
  .replace(/[ً-ْ‌\s]/g, '')
  .trim();

const PROP_ALIASES = {
  question: ['سوال', 'سؤال', 'question', 'Question'],
  topic: ['نوع فال', 'نوعفال', 'topic'],
  background: ['پس زمینه', 'پس‌زمینه', 'پسزمینه', 'background'],
  status: ['وضعیت', 'status'],
  usedAt: ['تاریخ استفاده', 'تاریخاستفاده'],
  resultUrl: ['لینک نتیجه', 'لینکنتیجه'],
};

/** پراپرتیِ یک ردیف را با هر کدام از املاهای ممکن پیدا می‌کند. */
function prop(properties, kind) {
  const props = properties || {};
  const wanted = (PROP_ALIASES[kind] || []).map(normKey);
  for (const [name, value] of Object.entries(props)) {
    if (wanted.includes(normKey(name))) return value;
  }
  return null;
}

const titleText = (p) => (Array.isArray(p?.title) ? p.title : [])
  .map((t) => t?.plain_text || '')
  .join('')
  .trim();

const selectName = (p) => String(p?.select?.name || '').trim();

/**
 * یک ردیفِ خامِ نوشن → سوالِ قابلِ استفاده. **خالص** (بدونِ شبکه) تا در CI تست شود.
 * @returns {{pageId:string, question:string, topicKey:string, background:string}|null}
 *   `null` یعنی این ردیف قابلِ استفاده نیست (سوال ندارد) و باید رد شود.
 *   `background` ممکن است خالی باشد؛ تصمیمِ پیش‌فرض کارِ صداکننده است نه این‌جا، چون
 *   پیش‌فرض در `config.json` است و این ماژول نباید config بخواند.
 */
export function rowToQuestion(page) {
  if (!page || typeof page !== 'object') return null;
  const props = page.properties || {};

  // اگر پراپرتیِ عنوان با هیچ املایی پیدا نشد، هر پراپرتیِ از نوعِ `title` قبول است:
  // در یک دیتابیسِ نوشن دقیقاً یکی وجود دارد، پس حدس نیست.
  let qProp = prop(props, 'question');
  if (!qProp || !Array.isArray(qProp.title)) {
    qProp = Object.values(props).find((p) => Array.isArray(p?.title)) || null;
  }
  const question = titleText(qProp);
  if (!question) return null;

  const topicRaw = selectName(prop(props, 'topic'));
  const bgRaw = selectName(prop(props, 'background'));

  return {
    pageId: String(page.id || ''),
    question,
    topicKey: TOPIC_MAP[normKeyLookup(topicRaw)] || TOPIC_MAP[topicRaw] || DEFAULT_TOPIC,
    background: BG_MAP[normKeyLookup(bgRaw)] || BG_MAP[bgRaw] || '',
  };
}

// تطبیقِ مقدارِ Select با کلیدهای نگاشت، بعد از نرمال‌سازیِ املا.
const NORM_TOPIC = Object.fromEntries(Object.keys(TOPIC_MAP).map((k) => [normKey(k), k]));
const NORM_BG = Object.fromEntries(Object.keys(BG_MAP).map((k) => [normKey(k), k]));
function normKeyLookup(raw) {
  const n = normKey(raw);
  return NORM_TOPIC[n] || NORM_BG[n] || raw;
}

/**
 * قدیمی‌ترین ردیفِ **قابلِ استفاده** از نتیجه‌ی یک کوئری. **خالص**.
 * کوئری خودش `sorts` دارد، ولی این تابع دوباره مرتب می‌کند تا به ترتیبِ سرور وابسته نباشد
 * و بتوان همان منطق را روی fixture تست کرد. ردیفِ بدونِ `created_time` عمداً **آخر**
 * می‌افتد، وگرنه یک ردیفِ ناقص صفِ واقعی را دور می‌زد.
 */
export function pickOldest(results) {
  const rows = (Array.isArray(results) ? results : []).filter((p) => p && !p.archived);
  const sorted = [...rows].sort((a, b) =>
    String(a.created_time || '9999').localeCompare(String(b.created_time || '9999')));
  for (const page of sorted) {
    const q = rowToQuestion(page);
    if (q) return q;
  }
  return null;
}

/** پیامِ فارسیِ اقدام‌پذیر از خطای خامِ نوشن (لاگِ انگلیسیِ API به کسی کمک نمی‌کند). */
export function notionErrorFa(err) {
  const s = err?.status;
  if (s === 401) return 'توکن Notion معتبر نیست. سکرت را دوباره بساز و ورک‌فلو را اجرا کن.';
  if (s === 403) return 'اینتگریشن Notion به این دیتابیس دسترسی ندارد. از منوی Share همان اینتگریشن را اضافه کن.';
  if (s === 404) return 'دیتابیس Notion پیدا نشد. آی‌دی را چک کن و مطمئن شو با اینتگریشن share شده است.';
  if (s === 400) return 'کوئری Notion رد شد. معمولاً یعنی نامِ ستون‌ها با قرارداد فرق دارد (سوال، نوع فال، پس‌زمینه، وضعیت).';
  if (s === 429) return 'Notion فعلاً درخواست‌ها را محدود کرده. چند دقیقه دیگر دوباره امتحان کن.';
  return `ارتباط با Notion برقرار نشد: ${String(err?.message || '').slice(0, 160)}`;
}

/**
 * کلاینتِ نوشن. `fetchImpl` تزریق می‌شود تا چکِ CI بتواند بدونِ شبکه همین کد را اجرا کند.
 * @returns {{api, oldestUnused, markUsed}|null} بدونِ توکن `null` (صداکننده تصمیم می‌گیرد).
 */
export function createNotion({ token, fetchImpl = fetch } = {}) {
  if (!token) return null;

  async function api(method, path, body) {
    const res = await fetchImpl(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => String(res.status));
      const err = new Error(`Notion ${res.status}: ${String(msg).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /**
   * قدیمی‌ترین سوالِ آماده. ردیفِ بدونِ «وضعیت» هم آماده حساب می‌شود، وگرنه هر سوالی که
   * کاربر سریع تایپ کرده و Select را پر نکرده تا ابد در صف می‌ماند.
   * @returns {Promise<object|null>} `null` = صف خالی است.
   */
  async function oldestUnused(dbId, { pageSize = 1 } = {}) {
    const res = await api('POST', `/databases/${dbId}/query`, {
      filter: {
        or: [
          { property: 'وضعیت', select: { equals: STATUS_READY } },
          { property: 'وضعیت', select: { is_empty: true } },
        ],
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: pageSize,
    });
    return pickOldest(res?.results);
  }

  /**
   * علامت‌زدنِ ردیفِ مصرف‌شده. **فقط بعد از ارسالِ موفقِ ویدیو** صدا زده می‌شود
   * (`deliver.mjs`)؛ این تنها نقطه‌ای است که می‌تواند یک سوال را از صف بیرون ببرد.
   */
  function markUsed(pageId, { runUrl = '' } = {}) {
    return api('PATCH', `/pages/${pageId}`, {
      properties: {
        'وضعیت': { select: { name: STATUS_USED } },
        'تاریخ استفاده': { date: { start: new Date().toISOString() } },
        // نوشن رشته‌ی خالی را برای URL رد می‌کند، پس نبودِ لینک یعنی اصلاً نفرستش.
        ...(runUrl ? { 'لینک نتیجه': { url: runUrl } } : {}),
      },
    });
  }

  return { api, oldestUnused, markUsed };
}
