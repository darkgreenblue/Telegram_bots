# tarot-reel

پروژه‌ی Remotion که از یک فالِ تاروتِ **ناشناس** یک ویدیوی عمودیِ `1080×1920`، زیرِ ۶۰ ثانیه و بی‌صدا
برای اینستاگرام ریلز می‌سازد.

این پوشه عمداً **خارج از `bots/`** است: هرچه زیرِ `bots/tarot/` عوض شود رباتِ زنده را ری‌استارت می‌کند.
پس اینجا نه روی VPS نصب می‌شود، نه در ماتریسِ CI است، نه در `ecosystem.config.cjs`. کلِ رندر روی رانرِ
گیت‌هاب (ورک‌فلوی `Tarot video`) اتفاق می‌افتد و ربات فقط یک dispatch می‌فرستد.
تصویرِ کلی و تصمیم‌های محصولی: بخشِ «🎬 ویدیوی ریلز» در `bots/tarot/CLAUDE.md`.

## راه‌اندازی

```bash
cd video/tarot-reel
npm ci
node ../../tools/tarot-video/stage-assets.mjs --props fixtures/props.sample.json
```

قدمِ سوم عکس‌های کارتِ لازمِ همان فال را از `bots/tarot/assets/cards/` به `public/cards/` **کپی** می‌کند.
بدونِ آن کارت‌ها خالی رندر می‌شوند. این پوشه در گیت نیست (استیجِ موقت است، نه دارایی).

## پیش‌نمایشِ محلی

```bash
npx remotion studio src/index.js
```

استودیو با `fixtures/props.sample.json` بالا می‌آید و هر تغییرِ فایل را زنده نشان می‌دهد. برای دیدنِ یک
فالِ دیگر، پنلِ props همان استودیو را ویرایش کن یا فایلِ فیکسچر را عوض کن (بعدش `stage-assets` را دوباره
بزن تا عکس‌های کارتِ آن فال هم کپی شوند).

## رندرِ محلی

```bash
npx remotion render src/index.js TarotReel out/reel.mp4 --codec=h264 \
  --props=fixtures/props.sample.json
```

روی محیط‌هایی که دانلودِ مرورگرِ Remotion بلاک است (مثل همین کانتینرِ توسعه) مرورگرِ موجود را دستی بده:

```bash
npx remotion render src/index.js TarotReel out/reel.mp4 --codec=h264 \
  --props=fixtures/props.sample.json \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
```

روی رانرِ گیت‌هاب این فلگ لازم نیست؛ آن‌جا `npx remotion browser ensure` مرورگر را می‌آورد و کشش در
`node_modules/.remotion` می‌نشیند (پس restoreِ کش باید **بعد از** `npm ci` باشد، وگرنه `npm ci` پاکش می‌کند).

⚠️ `npm run render` در `package.json` هنوز به `src/index.mjs` اشاره می‌کند که وجود ندارد؛ نقطه‌ی ورود
`src/index.js` است. تا اصلاحِ آن اسکریپت، دستورِ کاملِ بالا را بزن.

## ساختارِ فایل‌ها

```
src/layout.js        اعدادِ هندسیِ قاب: SAFE_BOX، دالان‌ها، جای کارت‌ها و باکس‌های متن، تم‌ها و بازه‌های فونت
src/motion.js        هندسه‌ی حرکت: cardRectAt(...) → مستطیلِ هر کارت در هر لحظه
src/timing.js        buildPlan(props) → صحنه‌ها و طولشان؛ سقفِ ۵۸ ثانیه اینجا قفل می‌شود
src/text.js          fitFontSize / paginateToFit / stripDash
src/index.js         registerRoot
src/Root.jsx         ثبتِ کامپوزیشن TarotReel (طول از calculateMetadata → buildPlan)
src/Reel.jsx         چیدنِ صحنه‌ها روی تایم‌لاین
src/scenes/*.jsx     پس‌زمینه، کارت، اینترو، فوکوس، جوابِ نهایی
src/useVazirmatn.jsx بارگذاریِ فونتِ فارسی (توضیحِ باگی که شکلش را تعیین کرده، داخلِ خودِ فایل)
public/fonts/        Vazirmatn (کامیت‌شده)
public/cards/        استیجِ عکس‌ها (خارج از گیت)
fixtures/            نمونه‌ی props برای استودیو و تست
```

**چهار فایلِ `.js` بالا خالص‌اند و باید بمانند:** حق ندارند از `react`، `remotion` یا هر پکیجِ npm ای
import کنند. دلیل صرفاً سلیقه نیست؛ چکِ CI (`tools/check-tarot-video.mjs`) آن‌ها را با Node خام و بدونِ
`node_modules` این پوشه اجرا می‌کند و هندسه و زمان‌بندی را واقعاً می‌سنجد. اولین import از remotion یعنی
آن چک اصلاً بالا نمی‌آید. JSX یک رندرکننده‌ی نازک است: هیچ تصمیمِ هندسی یا زمانی داخلش نیست.

`Math.random()` و `Date.now()` هم در هیچ کامپوننتی استفاده نمی‌شوند؛ Remotion فریم‌ها را موازی رندر
می‌کند و هر تصادفی یعنی پرشِ تصویر بین فریم‌ها. هر «تصادف» از یک PRNGِ seedدار در ماژولِ خالص می‌آید.

## کجا تیون می‌شود

تقریباً همه چیز در `src/layout.js` است و بالای همان فایل نوشته شده کدام عدد چه کاری می‌کند:

- استیکرِ سوالِ اینستاگرام جابه‌جا شد → `SAFE_BOX` و بعد `CORRIDOR_L/R` (باید به لبه‌هایش بچسبند).
- کارت‌ها کوچک یا بزرگ به نظر رسیدند → `TOP_ROW.cardH` و `FOCUS_CARD.h`.
- متن سرریز کرد → `CAPTION_BOX`/`VERDICT_BOX` را بزرگ کن، نه اینکه کفِ فونت را پایین بیاوری (زیرِ ~۳۰px
  روی موبایل خوانا نیست).
- رنگ‌ها → `THEMES` (سه پس‌زمینه‌ی `mystic`/`nature`/`minimal`). تیره‌بودن عمدی است.
- ریتم و طولِ صحنه‌ها → ثابت‌های بالای `src/timing.js`.

بعد از هر تیون، `node tools/check-tarot-video.mjs` را از ریشه‌ی ریپو بزن. اگر عددی کارت را واردِ باندِ
`SAFE_BOX` ببرد یا ویدیو را از سقف رد کند، همان‌جا قرمز می‌شود.
