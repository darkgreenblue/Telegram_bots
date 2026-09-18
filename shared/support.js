// دکمه و لینکِ «پشتیبانی» — تک‌منبعِ حقیقتِ حسابِ پشتیبانی برای همه‌ی ربات‌های ریپو.
// قانون shared/: هیچ import از npm (reply_markup به‌صورت آبجکتِ ساده ساخته می‌شود، بدون Telegraf).
//
// چرا اینجا: پشتیبانی یکی است ولی ربات‌ها زیادند؛ اگر آی‌دی عوض شد یا جای حساب، ربات پشتیبانی
// نشست، فقط همین فایل عوض می‌شود (+ کپیِ خودکفای voice2text و پورتِ پایتونیِ tabir که CI سینکشان
// را قفل کرده: tools/check-support-sync.mjs).
//
// قابلیتِ تلگرام (تأیید شده در core.telegram.org/api/links → Public username links):
//   https://t.me/<username>?text=<urlencoded>
// «draft_text» را در کادرِ تایپِ چتِ همان حساب می‌گذارد (فقط draft است، خودکار ارسال نمی‌شود) و برای
// حسابِ کاربریِ عمومی هم کار می‌کند نه فقط ربات. اگر متن با @ شروع شود کلاینت یک فاصله جلویش
// می‌گذارد، پس کد را با # شروع می‌کنیم. سقف ۴۰۹۶ کاراکتر.
// نکته: چون روی بعضی بیلدهای قدیمیِ دسکتاپ متنِ غیرASCII ممکن است خام (percent-encoded) بچسبد،
// کد همیشه **خطِ اول و ASCII** است و در پیامِ خودِ ربات هم به‌صورت قابلِ کپی چاپ می‌شود؛
// یعنی حتی اگر prefill خراب شود، کاربر کد را دارد.

export const SUPPORT_CONTRACT_VERSION = 1;

// ── حسابِ پشتیبانی (تنها جایی که باید عوض شود) ──────────────────────────────
// kind: 'account' = حسابِ انسانی | 'bot' = ربات پشتیبانی (آینده؛ لینک خودکار به ?start= سوییچ می‌کند)
// enabled: رول‌بکِ یک‌خطیِ کلِ قابلیت (بند ۸ «قوانین ربات زنده»): false کن → دکمه از کیبوردها محو
// می‌شود و هندلر ثبت نمی‌شود، رفتار دقیقاً مثل قبلِ این PR. (کپیِ voice2text هم همین فلگ را دارد.)
export const SUPPORT = {
  enabled: true,
  kind: 'account',
  username: 'Efficient_Support',
  id: 8914152957,
};

export const SUPPORT_CONTACT = `@${SUPPORT.username}`;
export const SUPPORT_BTN = '💬 پشتیبانی';

// ── کدِ پیگیری: کدام کاربر، از کدام ربات ─────────────────────────────────────
// پشتیبانی مشترک است، پس پیامِ کاربر باید خودش بگوید از کجا آمده. فرمت: #<BOT>-<user_id>
// (ASCII، کوتاه، هم برای چشمِ آدم خواناست هم با parseSupportCode ماشین‌خوان).
export const BOT_CODES = {
  voice2text: 'V2T',
  tarot: 'TRT',
  'tabir-khab': 'DRM',
  'resume-tailor': 'RSM',
  'daily-brief': 'DLB',
};

export const supportCode = (botCode, uid) => `#${String(botCode).toUpperCase()}-${uid}`;

// کد را از هر جای یک متن بیرون می‌کشد (داشبورد: پیامِ کاربر را paste کن و کاربر را پیدا کن).
const CODE_RE = /#?\b([A-Z0-9]{2,6})-(\d{4,15})\b/i;
export function parseSupportCode(s) {
  const m = CODE_RE.exec(String(s || ''));
  if (!m) return null;
  const botCode = m[1].toUpperCase();
  const bot = Object.keys(BOT_CODES).find((k) => BOT_CODES[k] === botCode) || null;
  return { botCode, bot, userId: Number(m[2]) };
}

// ── متن‌ها (قابلِ تزریق برای ربات‌های چندزبانه؛ پیش‌فرض فارسی) ────────────────
export const SUPPORT_TEXTS_FA = {
  button: SUPPORT_BTN,
  openBtn: '💬 باز کردن چت پشتیبانی',
  // متنی که در کادرِ تایپِ کاربر آماده می‌شود. خطِ اول = کد (ASCII).
  draft: (code) => `${code}\n\nلطفاً این کد را پاک نکنید و پیام‌تان را پایین‌تر بنویسید 👇\n`,
  // پیامی که خودِ ربات به کاربر می‌دهد (HTML) — کوتاه و مستقیم: فقط CTA + کد.
  body: (code) =>
    `💬 روی دکمه‌ی زیر بزن و پیامت رو بنویس؛ این کد رو پاک نکن:\n<code>${code}</code>`,
};

// ── لینک ────────────────────────────────────────────────────────────────────
// حساب: ?text= (پیامِ آماده در کادرِ تایپ). ربات (آینده): ?start= با همان کد به‌عنوان payload
// (سقف ۶۴ کاراکترِ base64url؛ `V2T-123456789` معتبر است، فقط # اول حذف می‌شود).
export function supportLink(botCode, uid, texts = SUPPORT_TEXTS_FA) {
  const code = supportCode(botCode, uid);
  const base = `https://t.me/${SUPPORT.username}`;
  if (SUPPORT.kind === 'bot') return `${base}?start=${encodeURIComponent(code.replace(/^#/, ''))}`;
  return `${base}?text=${encodeURIComponent(texts.draft(code))}`;
}

// خروجی آماده‌ی ctx.reply(...) — بدون وابستگی به Telegraf (reply_markup آبجکتِ ساده است).
export function supportReply(botCode, uid, texts = SUPPORT_TEXTS_FA) {
  const code = supportCode(botCode, uid);
  const url = supportLink(botCode, uid, texts);
  return {
    text: texts.body(code),
    extra: {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: texts.openBtn, url }]] },
    },
    code,
    url,
  };
}

// ردیفِ دکمه برای کیبوردِ اصلی:  ...supportRow()
export const supportRow = (texts = SUPPORT_TEXTS_FA) => (SUPPORT.enabled ? [[texts.button]] : []);

// ثبتِ دکمه + دستور /support.
// botCode: کدِ کوتاهِ همین ربات (از BOT_CODES). before(ctx): گاردِ اختیاری (true = بلاک).
// after(ctx): معمولاً یادآوریِ قدمِ فعلیِ فلو تا کاربر بعد از دیدنِ پشتیبانی سرگردان نشود.
// hearsLabels: اختیاری و افزایشی. رباتِ چندزبانه باید **اتحادِ** برچسبِ همه‌ی زبان‌هایش
// را بدهد، چون `bot.hears` لحظه‌ی ثبت ارزیابی می‌شود و یک برچسبِ تک‌زبانه یعنی تپِ
// کاربرِ زبانِ دیگر به هندلرِ متنِ آزاد می‌افتد. ندادنش = رفتارِ قبلی، بیت‌به‌بیت.
export function registerSupport(
  bot, { botCode, texts = SUPPORT_TEXTS_FA, before, after, hearsLabels } = {}) {
  if (!SUPPORT.enabled) return;
  const handler = async (ctx) => {
    if (before && (await before(ctx))) return;
    const r = supportReply(botCode, ctx.from.id, texts);
    await ctx.reply(r.text, r.extra);
    if (after) await after(ctx);
  };
  const labels = (Array.isArray(hearsLabels) ? hearsLabels : []).filter(Boolean);
  bot.hears(labels.length ? labels : texts.button, handler);
  bot.command('support', handler);
}
