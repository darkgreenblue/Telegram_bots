# بررسی منابع کشف کانال و ربات

بررسی در ۶ اکتبر ۲۰۲۶ انجام شد. پنج مسیر جست‌وجوی عمومی در کد متصل و با درخواست واقعی آزمایش شدند. کدهای منتخب ۱۳ مخزن نیز از نظر روش کشف و مجوز خوانده شدند؛ وابستگی موجود mtcute جدا بررسی شد. این بررسی، ممیزی کامل همهٔ فایل‌ها یا اجرای تست‌های خود آن پروژه‌ها نیست. ادعای بررسی تمام پروژه‌های دنیا هم نداریم.

## نتیجهٔ آزمایش واقعی

برای عبارت `tarot` و زبان پیشنهادی `en`، مسیرهای زیر پاسخ واقعی دادند:

| مسیر | سرنخ در پاسخ همان درخواست | کاربرد |
|---|---:|---|
| [Lyzem](https://lyzem.com/search?q=tarot&per-page=20) | ۵ | جست‌وجوی عمومی کانال و ربات؛ گروه و لینک پشتیبانی حذف شد |
| [Telemetr.com، فهرست کانال](https://tgadsspy.com/api/v1/channels?q=tarot&lang=en&limit=20) | ۲۰ | کانال‌های احتمالی؛ زبان و اندازهٔ اعلام‌شده فقط ادعای منبع است |
| [Telemetr.com، مقصد تبلیغ](https://tgadsspy.com/api/v1/ads?q=tarot&lang=en&limit=20&dest=telegram) | ۶ مقصد یکتا | یافتن محصولات رقیب از متن و مقصد تبلیغ؛ محل نمایش یا موفقیت تبلیغ ثابت نمی‌شود |
| [GramBots](https://www.grambots.com/?q=tarot&sort=mau) | ۳ | ربات‌های حوزهٔ تاروت؛ شمارندهٔ فهرست جای شمارندهٔ تلگرام را نمی‌گیرد |
| [Telegramic](https://telegramic.org/bots/?q=tarot) | ۲ | فهرست مستقل ربات‌ها؛ امتیاز کاربران، اندازهٔ مخاطب نیست |

مجموع این درخواست‌ها ۳۶ سرنخ یکتا داشت. با سقف ۳۰ بررسی عمومی، ۲۲ مورد واقعاً کانال یا ربات تشخیص داده شد. اندازهٔ مخاطب ۸ مورد نامعلوم بود؛ ۹ مورد از کف اندازه عبور کردند، اما فقط ۴ کانالِ بالاتر از کف، فعالیت تازهٔ قابل‌مشاهده داشتند. این اعداد به معنی ۹ گزینهٔ مناسب تبلیغ انگلیسی نیستند. بعضی موارد فارسی، روسی، برمه‌ای یا نامرتبط بودند. همهٔ ۲۲ مورد برای بررسی تناسب موضوع و بازار وارد صف شدند؛ عملیات مالی صفر بود.

بودجهٔ بررسی بین منابع نوبتی تقسیم می‌شود تا یک فهرست بزرگ، منابع کوچک‌تر و مستقل را از بررسی حذف نکند. نتایج خام، زمان مشاهده و مسیر رسیدن به هر گزینه نگه داشته می‌شود. [خلاصهٔ ماشین‌خوان](DISCOVERY-BENCHMARK.json) و پاسخ‌های اصلی در `data/verification/discovery-review-2026-10-06/` هستند.

## رقبای مهم و ابهام بازار انگلیسی

| گزینه | مشاهدهٔ مستقیم تلگرام | نتیجهٔ فعلی |
|---|---|---|
| [@tarotnatalbot](https://t.me/tarotnatalbot) | ۷۱۱٬۲۱۹ کاربر ماهانه؛ معرفی روسی | رقیب بزرگ و مستقیم؛ [GramBots](https://www.grambots.com/bots/tarotnatalbot) پشتیبانی انگلیسی را اعلام می‌کند، اما سهم واقعی مخاطب انگلیسی تأیید نشده است |
| [@arcanagurubot](https://t.me/arcanagurubot) | ۲۰۷٬۳۴۹ کاربر ماهانه؛ معرفی روسی | رقیب بزرگ؛ تناسب نمایش تبلیغ انگلیسی هنوز نیازمند بررسی است |
| [@HoroscopesOfLoveBot](https://t.me/HoroscopesOfLoveBot) | ۲۳٬۶۶۷ کاربر ماهانه در بررسی قبلی همین روز؛ معرفی انگلیسیِ تاروت شخصی | محتمل‌ترین گزینهٔ انگلیسیِ اندازه‌دارِ فعلی؛ انتخاب نهایی اولین تست هنوز منتظر پاسخ مالک است |
| [@tarotspreader_bot](https://t.me/tarotspreader_bot) | ربات انگلیسیِ پیدا‌شده از Telegramic؛ اندازه نامعلوم | در مخزن می‌ماند، وارد شروع پایلوت نمی‌شود |

مخاطب بزرگ به‌تنهایی به معنی CPM مناسب، موجودبودن جایگاه Ads یا CPA سودآور نیست. برای ربات‌ها عدد ماهانه و برای کانال‌ها تعداد مشترک استفاده می‌شود؛ این دو با هم مقایسهٔ عددی نمی‌شوند. کف‌های تاییدشدهٔ شروع، ۵٬۰۰۰ مشترک کانال و ۱۰٬۰۰۰ کاربر ماهانهٔ ربات است.

## منابع دیگر و وضعیت واقعی آن‌ها

| منبع | بررسی و تصمیم فعلی |
|---|---|
| [tgAtlas](https://www.tgatlas.org/data) | دو فایل عمومی خوانده شد: ۵٬۲۰۵ کانال و ۱۰٬۸۹۱ یال پیشنهاد. جست‌وجوی واژه‌های تاروت، هوروسکوپ و آسترولوژی در این نمونه نتیجه نداشت. استفاده با ارجاع در [شرایط سرویس](https://www.tgatlas.org/terms) مجاز اعلام شده؛ API کلید RapidAPI می‌خواهد و متصل نشده است |
| [TGbox](https://tgbox.cc/data/entries.json) و [awesome-telegram](https://github.com/TGrpg/awesome-telegram) | ۱٬۱۷۱ ورودی عمومی خوانده شد؛ در جست‌وجوی همین واژه‌ها سرنخ تاروت پیدا نشد. برای حوزه‌های دیگر مفید است؛ اتصال دائمی این داده هنوز انجام نشده |
| [tgden-api](https://github.com/JustJuice55/tgden-api) | شش درخواست متفاوت، دادهٔ یکسان با `isDemo:true` داد. برای کشف واقعی رد شد؛ ادعای حجم بزرگ فهرست پذیرفته نشد |
| [TGStat](https://api.tgstat.ru/docs/ru/channels/search.html) | API جست‌وجو دارد؛ توکن و سطح دسترسی لازم است. کشور و زبان پیش‌فرض باید صریح کنترل شود؛ اتصال یا خریدی انجام نشده |
| [Telemetr.io](https://api.tlmtr.io/docs/guides/channels-and-groups/) | API جدا با کلید دارد؛ با Telemetr.com که بالاتر آزمایش شد یکی نیست. فعلاً مستندات بررسی شده، اتصال برقرار نشده |
| [MiniTelegram](https://minitelegram.com/ru/apps/taro_mem_bot) | فهرست و تاریخچهٔ ماهانه دارد؛ صفحه از ابزار وب خوانده شد ولی درخواست مستقیم محلی پاسخ ۵۰۳ داد. منبع مکملِ در دست بررسی است |
| [Telega.io](https://telega.io/catalog) | فهرست جایگاه‌های مستقیم تبلیغ است؛ می‌تواند سرنخ بدهد، ولی حضور در آن به معنی پذیرش در Telegram Ads نیست |
| [Telegramic API](https://telegramic.org/pages/api-v1/) | API منتشرشده برای FAQ، نظر و مسئله است؛ API جست‌وجوی عمومیِ فهرست از این سند به دست نیامد. جست‌وجوی HTML واقعی به سیستم متصل شد |
| [Leadgram](https://leadgram.io/en/product/channel-discovery) | روش مشابه‌های رسمی تلگرام را با حساب متصل توضیح می‌دهد. مستندات محصول بررسی شد؛ حسابی متصل نشده و ابزار اجرایی ما از آن استفاده نمی‌کند |
| [ActorStack](https://actorstack.dev/guides/telegram/telegram-channel-discovery-catalogue) | راهنمای محدودیت فهرست و کشف بررسی شد؛ اتصال عملی یا ادعای کیفیت نتایج نداریم |
| [TGDev/TgScan](https://tgdev.io/doc/tgscan-api-documentation) | جست‌وجوی شناسه و ردپای کاربر محور است؛ برای کشف موضوعیِ جایگاه تبلیغ، اولویت فعلی ندارد |
| [BotoStore](https://botostore.com/)، [TGBotList](https://tgbotlist.com/)، [FindMini](https://findmini.app/) | پیدا شدند؛ خواندن مستقیم با ابزار وب ناموفق بود. کیفیت جست‌وجوی تاروت و امکان اتصالشان هنوز تأیید نشده است |
| TDirectory، tgbots.io، telegrambotlist.com | در فهرست بررسی مانده‌اند؛ خطای یک نشانی حدس‌زده‌شده یا نخواندن ابزار وب، دلیل نبودن سرویس نیست |

## پروژه‌های متن‌باز

نسخه‌های دقیق و فایل‌های مجوز در `DISCOVERY-BENCHMARK.json` ثبت شده‌اند. از پروژه‌ها روش و اجزای مناسب انتخاب می‌شود؛ اجرای کل یک ابزار بزرگ الزاماً هزینه و کیفیت بهتری برای ما ندارد.

| پروژه | کد منتخب و کاربرد | مجوز مشاهده‌شده / محدودیت |
|---|---|---|
| [tg-radar](https://github.com/bigidulka/tg-radar) | کشف کلمه، گراف لینک، نگهداری منشأ، محدودیت خزش و بازیابی؛ الگو در ماژول عمومی خودمان پیاده شد | MIT؛ زیرساخت Vespa و PostgreSQL آن وارد نسخهٔ اول نشد |
| [tgbotmau](https://github.com/KivApple/tgbotmau) | پارس پروفایل، مقدار نامعلوم و رفتار محدودیت درخواست بررسی شد | MIT؛ API میزبانی‌شدهٔ پروژه برای جست‌وجوی انبوه استفاده نشد |
| [mtcute](https://github.com/mtcute/mtcute) | وابستگی موجود، قرارداد جست‌وجو و پیشنهاد رسمی کانال و ربات | MIT؛ اتصال واقعی حساب جداگانه هنوز برقرار نیست |
| [Telegram-Search-Engine](https://github.com/Brooksolomon/Telegram-Search-Engine) | جست‌وجو، نمونهٔ پیام، گراف و امتیازدهی | MIT؛ تکرار همان coroutine پس از FloodWait در کد منتخب مشکل داشت و منتقل نشد |
| [telegram_similar_channels_finder](https://github.com/MargotP/telegram_similar_channels_finder) | wrapper سادهٔ پیشنهاد کانال | `CC0`؛ موتور کشف مستقل یا پوشش جامع ربات نیست |
| [TGbox](https://github.com/TGrpg/tgbox) | پارس پروفایل، فعالیت و زبان بررسی شد | `A`GPL-3.0``؛ کد آن کپی نشد |
| [awesome-telegram](https://github.com/TGrpg/awesome-telegram) | فهرست بازِ سرنخ | `CC BY 4.0`؛ فقط دادهٔ عمومی با ارجاع |
| [tgdr](https://github.com/thedevs-network/tgdr) | مدل فهرست، پالایش و تازگی داده | `GPL-3.0`؛ کد کپی نشد؛ نشانی و نسخهٔ دقیق مخزن در خلاصه ثبت شده است |
| [Telepathy](https://github.com/prose-intelligence-ltd/Telepathy-Community) | ارجاع و فوروارد به‌عنوان یال گراف | MIT؛ قابلیت‌های کاربران و محتوای خصوصی وارد سیستم نشد |
| [TeleAd](https://github.com/Elimeshi1/TeleAd) | قرارداد اتصال Ads بررسی شد | MIT؛ موتور کشف نیست و کنترل مالی به آن واگذار نشد |
| [TelegramBots](https://github.com/taro-tsuchiya/TelegramBots) | بازتولید پژوهش ربات‌ها | فایل مجوز پیدا نشد؛ شناسه‌های داده هش شده‌اند و فهرست زندهٔ تبلیغ نمی‌دهند |
| [tgden-api](https://github.com/JustJuice55/tgden-api) | مستندات MCP و REST | MIT؛ backend کامل فهرست در مخزن نبود و خروجی واقعی نمایشی بود |
| [tgindex](https://github.com/usedcplt/tgindex) | منابع وب، فهرست، GitHub و توسعه از توضیحات | معرفی پروژه MIT می‌گوید، فایل مجوز ریشه پیدا نشد؛ کد کپی نشد. خروجی خالیِ پس از خطا را عیناً نپذیرفتیم |
| [TelegramScrap](https://github.com/ergoncugler/web-scraping-telegram) | استخراج لینک از محتوای پیام و نمونه‌گیری | ادعای متن‌باز در README، بدون فایل مجوز ریشه؛ کد کپی نشد |

## روش‌های کشف و میزان آمادگی

- **وب و فهرست‌های مستقل:** پنج مسیر عملی، با تایید دوبارهٔ هویت، اندازه و فعالیت از تلگرام.
- **گراف معرفی و لینک:** از توضیح و پست عمومی به کانال و ربات بعدی می‌رسد؛ عمق و تعداد محدود است و منشا هر یال ثبت می‌شود. تست رفتاری انجام شده؛ خزش وسیع بازار هنوز اندازه‌گیری نشده است.
- **محتوای واقعی کانال:** موضوع و زبان با نمونهٔ پیام بررسی می‌شود. بازدید پست‌های دو تا هفت روز و هفت تا سی روز جدا محاسبه می‌شود؛ پست قدیمیِ پربازدید جای عملکرد تازه را نمی‌گیرد.
- **جست‌وجوی رسمی و مشابه‌ها:** adapter کانال، ربات و پست عمومی پیاده و با پاسخ آزمایشی تست شد. برای اجرای واقعی نیاز به حساب جداگانهٔ منتخب مالک دارد. حساب شخصی استفاده نمی‌شود.
- **پست و هشتگ رسمی:** فقط مسیر بدون پرداخت قابل‌استفاده است. [مستندات رسمی](https://core.telegram.org/api/search) برای جست‌وجوی سراسری پست، محدودیت و شروع دستی درخواست را مشخص می‌کند؛ این مسیر فعلاً در حلقهٔ خودکار فعال نیست.
- **گسترش از برنده‌ها:** با شواهد تست به تحقیق بعدی برمی‌گردد. چون هنوز تست پولی کامل نداریم، این بخش از نظر کیفیت بازار تایید نشده است.
- **پرسونا و علایق جانبی:** در مخزن باقی می‌ماند؛ برای شروع پایلوت، جای رقبای مستقیم و اندازه‌دار را نمی‌گیرد.

پژوهش [TelegramBots](https://arxiv.org/abs/۲۶۰۳.۲۴۳۰۲) استفاده از لینک‌های عمومی و چند فهرست را توضیح می‌دهد؛ دادهٔ آن قدیمی‌تر از زمان انتشار است و درصد موفقیت آن را به پایلوت تاروت تعمیم نمی‌دهیم. [TeleHunt](https://arxiv.org/abs/۲۶۰۶.۰۴۶۵۷) نیز سنجش منبع اولیه، نوع ارجاع و فیلتر زمینه را پیشنهاد می‌کند؛ موضوع پژوهش با بازار ما متفاوت است.

## تست و اعتماد فعلی

۸۰ تست محلی گذشت. تست‌های تازه شامل نگهداری شواهد هنگام کشف مجدد، تمایز ربات/گروه/کانال، اندازهٔ نامعلوم، کف اندازه، نگه‌داشتن پیش‌نویس نامناسب، جلوگیری از پذیرش بررسی قدیمی، محدودیت پایدار درخواست، قطع اجرا، عدم ثبت خرابی منابع به‌عنوان نتیجهٔ خالی و جلوگیری از بازنویسی نتیجهٔ worker تازه است. سه بررسی مرتبط مخزن و بررسی توابع تعریف‌نشده نیز گذشت.

پنج منبع در یک اجرای واقعی و بدون خرج پاسخ دادند. این شواهد برای کارکرد جمع‌آوری و محافظ‌های پذیرش مفید است؛ برای ادعای سودآوری، پوشش کامل بازار یا بهترین رتبه‌بندی کافی نیست. هنوز انتخاب نخستین هدف، اتصال حساب جداگانه و آزمایش مالیِ محدود باقی است. تغییر جدید تا استقرار در پنجرهٔ مجاز، روی سرور فعال نیست؛ نسخهٔ قبلی سرور سالم است و هر دو گیت مالی صفر هستند.

## Additional sources checked on October 7

- [Semagram](https://semagram.io/) has hybrid meaning/search and public similar-peer queries. Its [primary API documentation](https://semagram.io/agent-api) describes per-request x402 payment; no payment or wallet was authorized. An anonymous browser query `tarot reading love relationships lang:en min_users:10000` returned 100 bots, including four tarot-named peers and many unrelated results. Russian profiles survived the language filter. Three tarot peers were already known; new `@tarot_gram_bot` had indexed 13.2K monthly users but no exposed current MAU on direct t.me validation. Store as reserve, not initial-test eligibility. Ordinary public HTML GET returned a shell without result links, so a server adapter is not claimed as working. The browser route can supplement desktop research.
- [Statiko](https://statiko.io/catalog/search?q=tarot) public UI is accessible, but this tarot query returned zero channels. Its [MCP connector](https://statiko.io/product/mcp) requires a paid plan; no access was created. A large generic catalog is not evidence of coverage for our niche.
- [Telgrapp's tarot page](https://www.telgrapp.com/apps/tarot-daily-readings) returned HTTP 402 in direct retrieval. No bypass or payment. TelegramTop retrieval failed; status remains unverified.
- [awesome-telegram](https://github.com/ebertti/awesome-telegram) and [awesome-telegram-bots](https://github.com/erkcet/awesome-telegram-bots) extend the source inventory; reading their listings is not a full audit or evidence of a usable licensed discovery adapter.
- [TeleHunt research](https://arxiv.org/html/2606.04657v1) compares seed sources, link/pointer types, contextual filters and rediscovery. Its cybercrime dataset is not evidence of tarot market coverage. The same-named third-party phishing repository is unrelated and is excluded.

These probes are coverage evidence, not an exhaustive worldwide review or proof of conversion. The structured benchmark retains route failures and missing direct measurements; they must not become fabricated zeroes or approved peers.
