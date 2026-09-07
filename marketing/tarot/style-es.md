# سبکِ نگارشِ کانالِ اسپانیایی (@TAROOT_ES)

> مکمل `strategy.md`. قواعدِ آهنینِ آن‌جا این‌جا هم برقرارند؛ این فایل فقط چیزهایی را
> می‌گوید که **مخصوصِ اسپانیاییِ آمریکای لاتین** است.
>
> ⚠️ **حدِ صداقت:** پراکسیِ محیط `t.me` و همه‌ی سایت‌های فالِ لاتین را بست، پس هیچ
> پستِ واقعیِ رقیب خوانده نشد. لنگر، منابعِ **داخلِ ریپو**ست: `daily-ganjineh.es.json`
> (۹۳۶ متنِ بومیِ همین ژانر، ممیزی‌شده)، `langdata.es.json` و
> `I18N-ES-LANGUAGE-RESEARCH.md` (اندازه‌گیری روی ۵٬۹۸۷ خروجی). نقل‌قول‌های ✅ عیناً
> از آن پیکره‌اند.

## ⚠️ قاعده‌ی صفر: یک صدا، دو متن
`daily-ganjineh.es.json` همین ژانر است و **همان کاربر آن را داخلِ ربات به‌عنوان کارتِ
روزِ رایگان می‌بیند.** سبکش را تقلید کن، متنش را هرگز بازاستفاده نکن.

## ۱) ساختار و طول
سه بند با خطِ خالی: قلابِ تصویریِ کارت ← مشاهده‌ی برج به دوم‌شخص ← یک کارِ مشخصِ امروز.

**طولِ هدف: ۲۸۰ تا ۴۲۰ کاراکتر.** میانه‌ی پیکره ۴۳۹ است (لبِ بالای هدف) و کپشن سربارِ
خودش را دارد. اگر کپی‌رایتر عددِ فارسیِ «۲۵۰ تا ۹۰۰» را بگیرد، اعتبارسنج روز را رد
می‌کند و **هیچ پستی منتشر نمی‌شود**.

## ۲) رجیستر
- **همیشه `tú`.** هرگز `usted`، هرگز `vos`، هرگز `vosotros`.
- امر همیشه شکلِ `tú`: `elige`, `escribe`, `toma`, `cierra`, `pide`, `haz`.
  `elegí` (voseo) یا `elija` (usted) بلندترین نشانه‌ی متنِ ماشینی است.
- دوم‌شخصِ مستقیم از جمله‌ی اول. **نه سوم‌شخص:** ممیزی ۶۹ متن پیدا کرد که
  `La mente de Acuario no se apaga` نوشته بودند؛ درستش ✅ «No se te apaga la cabeza de noche.»
- راوی هرگز درباره‌ی خودش حرف نمی‌زند. کارت فاعل است: `Esta carta te avisa que…`

**نمونه‌های رجیسترِ درست (✅ عیناً از پیکره):**
> ✅ «Tienes todas esas herramientas repartidas frente a ti: ideas, energía, contactos, ganas de moverte. El punto es que sueles arrancar varias cosas a la vez y terminas ninguna del todo.»
> ✅ «La sensación de quedar afuera te pesa hondo, aunque muchas veces hay ayuda cerca que todavía no notaste.»
> ✅ «Hoy escribe en un papel lo que te tiene despierto, para sacarlo de la cabeza aunque sea un rato.»
> ✅ «Esta carta no habla de pérdida, habla del cierre que necesitas para dejar entrar lo siguiente.»

**دو چیزی که فوراً بد خوانده می‌شود:**
- شبه‌جزیره‌ای: `deberéis`, `vuestra`, و مخصوصاً **`coger`**.
- کالکِ ترجمه‌زده: `Es importante destacar que`, `cabe mencionar`,
  `en el mundo actual`, `no cabe duda de que`. هیچ regexی نمی‌گیردشان، فقط چشمِ انسان.

## ۳) هشتگ
🔴 **تصحیحِ یک فرضِ رایج:** فقط **دو** نام تشدید دارند، نه شش تا.
`Escorpio`, `Capricornio`, `Acuario`, `Piscis` هیچ‌کدام تشدید ندارند.

فرمِ قانونی، برای همیشه ثابت:
`#Aries` · `#Tauro` · `#Géminis` · `#Cáncer` · `#Leo` · `#Virgo` ·
`#Libra` · `#Escorpio` · `#Sagitario` · `#Capricornio` · `#Acuario` · `#Piscis`

**تشدید نگه داشته می‌شود**، چون کانالی که نامِ برجِ خودِ کاربر را غلط بنویسد ارزان به
نظر می‌رسد، و مسیرِ غالبِ مصرف تپ است نه تایپ. ⚠️ ادعای «تلگرام تشدید را normalize
نمی‌کند» **تأییدنشده** است (مستنداتِ تلگرام از این محیط باز نشد)؛ ولی چون فقط دو برج
درگیرند، هزینه‌ی بدترین حالت کوچک است.

**`#Cáncer` تنها هشتگی است که با یک معنیِ دیگر تصادم دارد: خودِ بیماری.** پس دو قاعده:
هشتگ **هرگز تنها نایستد** (همیشه داخلِ جمله: `Lectura diaria del tarot para #Cáncer`)،
و **در کپشنِ آن برج هیچ جمله‌ای درباره‌ی سلامتی نوشته نشود.**

## ۴) خنثی‌بودنِ جنسیت
ممیزی **۴۹ نشتِ جنسیت** در اسپانیایی پیدا کرد در حالی که چکِ CI سبز بود. و اسپانیایی
از روسی بدتر است: روسی فقط در گذشته جنسیت می‌گیرد، اسپانیایی در **حال** هم
(`estás cansado/cansada`). `@`/`x`/`e` ممنوعِ مطلق؛ راهِ حل بازنویسی است.

**پنج ساختِ امن:**
1. **صفتِ بی‌جنسیت** (پایانه‌ی `-e`, `-al`, `-z`, `-ente` جنسیت نمی‌گیرد):
   `firme`, `fuerte`, `capaz`, `presente`, `paciente`, `constante`, `valiente`,
   `consciente`, `estable`, `amable`. ✅ «Mantente firme»
2. **اسمِ حالت:** ✅ «La sensación de quedar afuera te pesa hondo» به‌جای `te sientes excluida`
3. **مصدر:** ✅ «Pedir ayuda no es lo que más te sale»
4. **چرخاندنِ فاعل به کارت/شیء:** ✅ «Esta carta te avisa que hay una ayuda cerca»
5. **فعل بدونِ صفت:** ✅ «sueles arrancar varias cosas a la vez»

**تله‌ها:** `solo/sola` (پرتکرارترین → ✅ **`por tu cuenta`**) · `tú mismo` ·
صفتِ مفعولی بعد از `estar/sentirte/quedarte/verte` · `listo/lista`, `seguro/segura`,
`tranquilo/tranquila`, `dispuesto/dispuesta` · `bienvenido/a` (→ ✅ `Te damos la bienvenida`) ·
منادای `querido/querida`.

**قرمزِ کاذب نگیر:** قیدهای پایان‌یافته به `-o` (`demasiado`, `rápido`) اصلاً جنسیت
ندارند؛ و `demasiada energía` به `energía` برمی‌گردد نه به خواننده.

## ۵) قابِ فرهنگیِ برج‌ها
**مشاهده، نه تعریف.** و **نامِ برج در متنِ تفسیر نیاید** (خطِ اول و هشتگ از قبل
گفته‌اند)، مگر اشاره‌ای گذرا که الگوی غالب نشود. ممیزی گرفت که ماهِ ۵ و ۱۱ تقریباً
همیشه نامِ برج را می‌گفتند و شش برجِ دیگر هرگز.

| برج | انتظارِ خواننده | کلیشه‌ی ممنوع |
|---|---|---|
| Aries | شروعِ سریع، رکِ بی‌پرده، چند کارِ ناتمام | `siempre quiere ser el primero / líder nato` |
| Tauro | استقامت، لذتِ حسی، کندیِ عمدی، وفاداری | `terco como un toro / solo piensa en comer` |
| Géminis | ذهنِ پرشتاب، کلام، کنجکاوی، حوصله‌ی کوتاه | **`doble cara / bipolar / falso`** (سمی‌ترین) |
| Cáncer | حافظه‌ی عاطفی، خانه، مراقبت، حسِ طرد | `el llorón / mamitis / vive en el pasado` |
| Leo | سخاوت، گرمای حضور، غرورِ زخم‌پذیر | `egocéntrico / narcisista` |
| Virgo | دقت، خدمتِ عملی، نقدِ اول از خود، فهرست | `obsesivo con la limpieza / criticón` |
| Libra | سنجش، حساسیت به بی‌عدالتی، اجتنابِ تقابل | `nunca puede decidir` |
| Escorpio | شدت، عمق، تشخیصِ دروغ، تولدِ دوباره | `vengativo / tóxico` و جنسی‌سازی |
| Sagitario | حرکت و سفر، صراحت، امیدواری | `el infiel / siempre huye` |
| Capricornio | ساختن با صبر، مسئولیت، بلندمدت | `frío / workaholic sin sentimientos` |
| Acuario | منطق و ایده، فاصله از جمع، آینده‌نگری | `raro / alienígena / frío` |
| Piscis | همدلیِ جذبی، شهود، مرزِ نرم، سختیِ «نه» | `vive en las nubes / la víctima` |

## ۶) تابوها
- **`coger` ممنوعِ مطلق** (در مکزیک، آرژانتین، شیلی، اروگوئه و پرو رکیکِ جنسی است و
  مکزیک بزرگ‌ترین بازارِ ماست). جایگزین: `tomar`, `agarrar`, `recoger`.
- **`hostia` ممنوع.** درسِ گران‌قیمتِ خودمان: در **هفت برج** از دورِ اول آمده بود.
- **واژگانِ فقط-اسپانیا:** `ordenador`, `móvil`, `gafas`, `chaval`, `guay`,
  `tío/tía`, `vale` (به معنیِ «باشد»). ⚠️ ولی `piso` (طبقه)، `vale la pena` و
  `conducir` (هدایت کردن) در لاتین هم درست‌اند و نباید کورکورانه حذف شوند.
- **voseo و localismos:** `sos, tenés, mirá, dale` · `wey, órale, chido, neta,
  ahorita, platicar` · `che, boludo` · `cachái` · `parce`, `chévere`.
  هدف **español neutro** است، همان اسپانیاییِ دوبله‌ی لاتین.
- **مذهب:** بدونِ `Dios`, `bendición`, `sagrado`, `ángeles`. ⚠️ **مخصوصِ مکزیک:
  `La Santa Muerte` هرگز** — یک آیینِ عامیانه‌ی زنده و پرمناقشه است، نه استعاره‌ی
  تاروتی. (اشاره‌ی سبک به **Lotería** بی‌خطر و حتی گرم است.)
- **کلاهبرداری:** `amarres de amor`, `limpias`, `brujería`, `vidente`, `bruja/o`,
  `consulta gratis`, `escríbeme al privado`, حروفِ همه‌بزرگ، خوشه‌ی ایموجی، و
  **رتبه‌بندیِ برج‌ها** (`el signo más tóxico`) که هم مبتذل است هم طعمه‌ی اینگیجمنت.
- **جبرگرایی:** `Vas a recibir dinero esta semana` · `Te vas a enfermar` (در کپشنِ
  `#Cáncer` فاجعه‌ی مضاعف) · `El karma te va a cobrar` · `el destino ya está escrito`.
- **جمله‌ی بی‌جهت:** `depende de ti`, `confía en tu intuición`, `el universo te va a
  responder`. هر جمله باید یک جهت داشته باشد.
- **امرِ سرزنش‌گر** `Tienes que…` / `deberías…` → امرِ دعوت‌کننده `Elige hoy…`.

## ۷) ریسکِ سبکیِ شمرده‌شده
ماهِ ۲ و ۴ در دورِ اول **هر ۷۸ متن** را با `La carta de hoy es…` شروع کرده بودند.
قاعده: هیچ الگویی نباید بیش از **یک‌پنجمِ** پست‌های یک روز را بگیرد. `Hoy` + امر
الگوی درستِ بندِ سوم است ولی همه‌ی دوازده‌تا نباید یک شکل باشند.
