# سبکِ نگارشِ کانالِ پرتغالی (@TAROT_PT)

> مکمل `strategy.md`. قواعدِ آهنینِ آن‌جا این‌جا هم برقرارند؛ این فایل فقط چیزهایی را
> می‌گوید که **مخصوصِ پرتغالیِ برزیل** است.
>
> ⚠️ **حدِ صداقت:** پراکسیِ محیط سایت‌های فالِ برزیلی و `t.me` را بست، پس هیچ پستِ
> واقعیِ رقیب خوانده نشد. لنگرِ این سند سه منبعِ **داخلِ ریپو**ست که از قضا بهترند:
> `daily-ganjineh.pt.json` (۹۳۶ متنِ بومیِ همین ژانر، ممیزی‌شده)، `langdata.pt.json`
> و `I18N-PT-LANGUAGE-RESEARCH.md`. نقل‌قول‌های ✅ عیناً از آن پیکره‌اند.

## ⚠️ قاعده‌ی صفر: یک صدا، دو متن
`daily-ganjineh.pt.json` دقیقاً همین ژانر است و **همان کاربر آن را داخلِ ربات به‌عنوان
کارتِ روزِ رایگان می‌بیند.** پس سبکش را تقلید کن ولی **هرگز متنش را بازاستفاده نکن**،
وگرنه کاربر همان روز لو رفتنش را می‌بیند.

## ۱) ساختار و طول
سه بند با یک خطِ خالی بینشان (همان ساختارِ فارسی):
1. قلابِ تصویری از خودِ کارت (چیزی که واقعاً روی تصویر دیده می‌شود)
2. ربط به برج، به‌شکلِ **مشاهده** نه تعریف + یک نکته‌ی مشخص
3. یک کارِ قابلِ انجامِ امروز، که معلوم باشد انجام شده یا نه

**طولِ هدف: ۲۸۰ تا ۴۲۰ کاراکتر.** میانه‌ی پیکره‌ی بومی ۴۳۸ است و `GANJINEH.md`
همان را «۴۸٪ بالای هدف» علامت زده. پرتغالی ذاتاً از فارسی درازتر می‌شود و کپشن سربارِ
خودش را هم دارد (تاریخ، هشتگ، نامِ کارت، CTA) که همه از سقفِ ۱۰۲۴ می‌خورند.

## ۲) رجیستر
- **`você` همیشه.** هرگز `tu`، هرگز `o senhor/a senhora`.
- **امرِ استانداردِ نوشتاری:** `olhe`, `escolha`, `reconheça`, `permita-se`. هرگز
  `olha`, `reconhece`. قاطی‌کردنِ این دو بلندترین نشانه‌ی متنِ ماشینی است.
- انقباضِ محاوره‌ای آزاد و مطلوب: `pra`, `pro`, `dá pra`, `tá`.
- **proclisis:** `Me diz`, `se escolhendo` — نه `Diz-me`.
- **gerúndio:** `está falando` — نه `está a falar`.
- املای برزیل: `fato`, `objetivo` — نه `facto`, `objectivo`.
- بدونِ ایموجی داخلِ متنِ تفسیر (ایموجی را قالبِ کپشن می‌گذارد).

**نمونه‌ی رجیسترِ درست (✅ عیناً از پیکره):**
> ✅ «Você é do tipo que já está andando antes de pensar direito no destino; esse impulso de começar sem esperar luz verde é a sua marca registrada.»
> ✅ «Hoje, permita-se sentir uma mágoa antiga em vez de tentar enterrar ela de novo.»
> ✅ «Você aprecia uma conexão de igual para igual, Gêmeos, onde dá pra trocar ideias na mesma velocidade.»

توجه: `enterrar ela` عمدی است (گفتاریِ برزیل)، نه `enterrá-la` که درست ولی سرد است.

**دو چیزی که فوراً بد خوانده می‌شود:**
- پرتغالیِ اروپا: `estás`, `está a mostrar`, `Diz-me`, `facto`, `objectivo`.
- رجیسترِ ماشینی: `Em resumo`, `É importante notar que`, ساختارِ
  `não é apenas X, é Y`, `Mergulhe` (ترجمه‌ی `delve into`), `confie na sua intuição`,
  `o universo`. آخری‌ها در گاردِ `verdict.js` ممنوعِ صریح‌اند چون جمله را بی‌جهت می‌کنند.

## ۳) هشتگ
**تشدید نگه داشته می‌شود.** فرمِ قانونی، برای همیشه ثابت:
`#Áries` · `#Touro` · `#Gêmeos` · `#Câncer` · `#Leão` · `#Virgem` · `#Libra` ·
`#Escorpião` · `#Sagitário` · `#Capricórnio` · `#Aquário` · `#Peixes`

چهار دلیل: (۱) `#Cancer` بدونِ تشدید با نامِ **بیماری** یکی می‌شود و فیدِ فال را به
محتوای سرطان می‌چسباند؛ `#Câncer` بی‌ابهام است. (۲) متنِ بی‌تشدید برای برزیلی امضای
اسپم است و کانال دارد اعتمادِ لازم برای یک رباتِ **پولی** را می‌سازد. (۳) مسیرِ غالب
تپ‌کردنِ هشتگ است نه تایپش. (۴) شش تا از دوازده نام اصلاً تشدید ندارند، پس سیاستِ
نصفه بی‌معنی است.

**هشتگِ دومِ بی‌تشدید اضافه نکن** (آرشیو دو نیم می‌شود) و **هشتگِ برهنه نداریم**؛
داخلِ جمله‌ی توضیحیِ خطِ اول می‌نشیند.

## ۴) خنثی‌بودنِ جنسیت
ممیزیِ ۱۴۰۵/۰۶/۱۲ روی همین دیتای pt **~۸۰ نشتِ جنسیت** پیدا کرد در حالی که چکِ CI با
۸۶ ادعا سبز بود. `@`/`x`/`e` ممنوع‌اند (در متنِ فالِ گرم سیاسی خوانده می‌شوند)؛ راهِ
حل همیشه **بازنویسی** است.

**پنج ساختِ امن (✅ همه از پیکره):**
1. اسم به‌جای صفت: ✅ «Você já nasce com essa **vontade** de botar a mão na massa»
2. فعل + قید به‌جای ربطی + صفت: ✅ «Você **costuma agir** primeiro e pensar depois»
3. چرخاندنِ فاعل به «چیز»: ✅ «**Paciência** não costuma ser a sua palavra favorita»
4. `quem` وقتی جمله ناچار صفت می‌خواهد: ✅ «…para **quem** vive com pressa»
5. نام‌بردنِ حالت: ✅ «reconhecer o **cansaço** não é fraqueza»

**تله‌ها:** `você está cansado/a` · `foi deixado` · `tem sido ignorada` ·
`sentir-se preso` · `quando estiver pronta` · `você mesmo` · صفتِ دور از فاعل ·
**فاعلِ حذف‌شده** (`Está cansada de esperar.` بدونِ `você` هم جنسیت را تحمیل می‌کند).

**قرمزِ کاذب نگیر:** `uma decisão está travada`, `a rotina fica parada` — صفت با
**شیء** می‌خواند نه خواننده. و `firme`, `feliz`, `capaz`, `simples`, `forte`,
`presente` هیچ جنسیتی ندارند و بهترین دوستِ کپی‌رایترند.

## ۵) قابِ فرهنگیِ برج‌ها
**مشاهده بنویس، نه برچسب.** `Arianos são impulsivos` بد است؛
`Você costuma agir primeiro` خوب است. **خواننده همیشه دوم‌شخص است**؛
`O ariano não gosta de esperar` غلط است.

| برج | انتظارِ خواننده | کلیشه‌ی ممنوع |
|---|---|---|
| Áries | اقدام قبل از فکر، سرعت، رک‌گویی، جلو افتادن | `explosivo/barraqueiro/briguento` |
| Touro | بی‌عجلگی، لذت و راحتی، وفاداری به ساخته‌ها | `teimoso e só pensa em comida` |
| Gêmeos | سرعتِ ذهنی، تبادلِ ایده، کنجکاوی | **`duas caras / falso`** (بدترینِ برزیل) |
| Câncer | حسِ عمیق، خانه و خانواده، عقب‌کشیدن، حافظه‌ی عاطفی | `chorão/dramático` |
| Leão | جشن، دیده‌شدن، سخاوت، گرما | `egocêntrico/metido/só quer aparecer` |
| Virgem | جزئیات، مراقبت، سنجیدن، نقدِ خود | `chato/neurótico de limpeza` |
| Libra | تعادل، آرامشِ ظاهری، سنجیدنِ دو طرف، زیبایی | **`indeciso`** (فرسوده‌ترینِ زودیاک) |
| Escorpião | عمق، تشخیصِ حقیقت، شدت | `vingativo/tóxico` و جنسی‌سازی |
| Sagitário | صراحت، آزادی، افق، خوش‌بینی | `não se compromete / pé na jaca` |
| Capricórnio | تلاش و زمان، هدفِ بلندمدت، مسئولیت | `workaholic frio sem emoção` |
| Aquário | ایده‌ی تازه، استقلال، نگاهِ متفاوت، جمع | `alienígena/frio demais` |
| Peixes | حسِ حالِ دیگران، شهود، مرزِ نرم | `iludido/vítima/mundo da lua` |

**نامِ برج حداکثر در یک‌سومِ پست‌های روز** بیاید و به‌شکلِ ندا؛ خطِ اول و هشتگ از قبل
گفته‌اند مالِ کدام برج است.

## ۶) تابوها
- **مذهب: هیچ‌کدام.** برزیل جمعیتِ اونجلیکالِ بزرگی دارد و همین محتوا در آن محیط
  `adivinhação` نامیده می‌شود. بدونِ `Deus`, `abençoado`, `amém`, `oração`, `alma`,
  `espírito`, `karma`. **و هیچ ارجاعی به Umbanda/Candomblé** (`orixá`, `despacho`):
  هم تصاحبِ فرهنگی است هم موضوعِ داغِ «racismo religioso». قاب = `autoconhecimento`
  و `pausa`، نه اقتدارِ معنوی.
- **کلاهبرداری:** `amarração amorosa`, `trabalho feito`, `traga seu amor de volta`,
  `resultado garantido`, `100% de acerto`, `URGENTE`, `chama no zap`, `vidente`,
  `dom espiritual`.
- **جبرگرایی:** هیچ پیش‌گوییِ بیماری، مرگ، طلاق، اخراج یا پولِ مشخص. کارتِ سنگین
  بازقاب می‌شود: ✅ «Mas essa torre tinha uma base frágil, e o que cai agora abre
  espaço pra reconstruir de um jeito mais firme.»
- **هیچ جمله‌ی بی‌جهت:** `confie na sua intuição`, `depende de você`,
  `o universo vai conspirar`, `talvez sim, talvez não`.
- **هیچ اشاره‌ای به گذشته‌ی کاربر** (`no ano passado`, `da última vez`) — ما هیچ‌چیز
  از آن نمی‌دانیم. بازه‌ی **آینده** (`até o fim da semana`) مجاز است.
- بدونِ توصیه‌ی مالی/پزشکیِ مشخص.

## ۷) دو ریسکِ سبکیِ شمرده‌شده
1. **`Hoje,` دارد فرسوده می‌شود.** در پیکره ده الگوی پرتکرارِ بندِ سوم همه با `Hoje,`
   شروع می‌شوند. در دوازده پستِ یک روز حداکثر **دو تا سه** تا؛ بقیه از خودِ فعلِ امر
   شروع کنند (`Escolha hoje…`, `Verifique hoje…`).
2. **عددِ کارت‌های کوچک باید با تصویر بخواند.** کاربر عکس را هم‌زمان می‌بیند. خطای
   ثبت‌شده‌ی واقعی: `p08` با «پنج تا روی تیر و یکی روی زمین» توصیف شده بود، یعنی هفت.
