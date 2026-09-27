/* 🚫 قواعدِ صلاحیتِ کارت per کاربر (v3.133.0، تصمیمِ مالک ۱۴۰۵/۰۷/۰۵).
 *
 * منطقِ انتخابِ کارت (`cards-admin.js`: مبلغ ⟵ فاکتورِ باز ⟵ ترتیب) نمی‌داند کاربر کیست. این
 * ماژول **قبل از** آن می‌نشیند و فقط یک کار می‌کند: از فهرستِ کارت‌ها آن‌هایی را برمی‌دارد که
 * این کاربر نباید ببیند. برای آن کاربر، کارتِ حذف‌شده دقیقاً مثلِ کارتِ غیرفعال است: در صدورِ
 * فاکتور، در دکمه‌ی تعویض، در اقدامِ خودکارِ «نتوانستم واریز کنم» و در فالبکِ خطا.
 *
 * هر قاعده یک ردیف است با چهار چیز:
 *   key     شناسه‌ی ثابت (در لاگ `CARD_RULE` و رویدادِ `card_assigned` می‌آید).
 *   why     دلیل، برای آدمِ شش ماه بعد.
 *   applies (facts) ⟵ این قاعده برای این کاربر فعال است؟
 *   blocks  (card)  ⟵ این کارت را برای او برمی‌دارد؟
 * افزودنِ قاعده = یک ردیفِ تازه. حذفِ قاعده = پاک کردنِ همان ردیف (یا خاموش‌کردنِ همه با
 * `CARD_RULES_ENABLED` در index.js). هیچ جای دیگری از کد لازم نیست عوض شود.
 *
 * `facts` دانسته‌های ما درباره‌ی کاربر است و index.js آن را از DB می‌سازد (`userCardFacts`):
 * فعلاً تگ‌های دستیِ رسیدهایش per بُعد (`tags.app`, `tags.bank`، هر کدام یک Set). قاعده‌ای که
 * دانسته‌ی تازه‌ای لازم دارد، فقط همان‌جا یک فیلد اضافه می‌کند.
 *
 * همه‌چیز این‌جا خالص است (بدونِ DB و تلگرام) تا چکِ CI مستقیم اجرایش کند.
 */

/** کارتِ بلوبانک؟ از روی نامِ بانکِ کارت (نه شماره: BINِ بلو همان BINِ بانک سامان است). */
export const isBluCard = (c) => /بلو|blu/i.test(String(c?.bank || ''));

export const CARD_RULES = Object.freeze([
  Object.freeze({
    key: 'ap_no_blu',
    why: 'اپِ «آپ» روی کارتِ بلوبانک حساس شده و احتمالاً محدودیت گذاشته (مالک، ۱۴۰۵/۰۷/۰۵). کاربری که '
      + 'حتی یک رسیدش تگِ دستیِ اپِ «آپ» خورده، کارتِ بلوبانک را هرگز نمی‌بیند.',
    applies: (u) => !!u?.tags?.app?.has('ap'),
    blocks: isBluCard,
  }),
]);

/** دانسته‌های کاربر از ردیف‌های `{dim, value_key}` تگ‌های دستی. */
export function userCardFacts(tagRows = []) {
  const tags = { app: new Set(), bank: new Set() };
  for (const r of Array.isArray(tagRows) ? tagRows : []) {
    if (tags[r?.dim]) tags[r.dim].add(String(r.value_key));
  }
  return { tags };
}

/** قاعده‌های فعال برای این کاربر. */
export const rulesFor = (facts, rules = CARD_RULES) => rules.filter((r) => {
  try { return !!r.applies(facts); } catch { return false; }
});

/**
 * فهرستِ کارت‌های مجاز برای کاربر. خروجی:
 *   cards    همان فهرست بدونِ کارت‌های حذف‌شده (ترتیب دست نمی‌خورد).
 *   blocked  `[{ id, rule }]` برای لاگ و آمار.
 *   rules    کلیدِ قاعده‌هایی که برای این کاربر فعال بودند.
 * `facts === null` یعنی «دانسته‌های کاربر خوانده نشد» (خطای DB) ⟵ **سخت‌ترین حالت**: همه‌ی قاعده‌ها
 * اعمال می‌شوند. کاربرِ «آپ» نباید به خاطرِ یک خطای خواندن بلوبانک بگیرد؛ هزینه‌اش برای بقیه فقط
 * این است که همان یک فاکتور روی کارتِ دیگری برود.
 * قاعده‌ای که `blocks`ش خطا بدهد، هیچ کارتی را حذف نمی‌کند (خطای یک قاعده نباید صدورِ فاکتور را بشکند).
 */
export function eligibleCards(cards, facts, rules = CARD_RULES) {
  const list = Array.isArray(cards) ? cards : [];
  const active = facts === null ? [...rules] : rulesFor(facts, rules);
  if (!active.length) return { cards: list, blocked: [], rules: [] };
  const blocked = [];
  const kept = list.filter((c) => {
    const hit = active.find((r) => { try { return !!r.blocks(c); } catch { return false; } });
    if (hit) blocked.push({ id: c.id, rule: hit.key });
    return !hit;
  });
  return { cards: kept, blocked, rules: active.map((r) => r.key) };
}
