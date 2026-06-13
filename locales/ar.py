"""العربية — المُعبِّر الأعظم في عالَم الرؤى.
الأنماط (حسب بحث السوق): الشرعي الإسلامي، التقليدي الفولكلوري، الحداثي التوفيقي."""

LOCALE = {
    "meta": {
        "code": "ar",
        "name": "العربية",
        "flag": "🇸🇦",
        "select_label": "🇸🇦 العربية",
        "output_language": "Arabic (Modern Standard Arabic)",
        "rtl": True,
        "digits": "٠١٢٣٤٥٦٧٨٩",
    },

    "kb": {
        "new_dream":    "🎙 رؤيا جديدة",
        "subscription": "🧭 رِفقتي",
        "persona":      "🎭 تغيير الأسلوب",
        "invite":       "🎁 رابط الدعوة",
        "language":     "🌐 اللغة",
    },

    "welcome_intro": (
        "أهلًا بك 🌙\n"
        "أنا *المُعبِّر الأعظم*، حارسُ *عالَم الرؤى* — حيث كلُّ رؤيا بابٌ إلى سرٍّ مكنون.\n"
        "لنتعارف أولًا: سأطرح عليك {count} أسئلة قصيرة، ثم نقرأ رؤياك معًا 💫"
    ),
    "onboarding_start_btn": "أنا مستعدّ للإجابة على {count} أسئلة أساسية ✨",
    "progress_tmpl": "🔮 السؤال {n} من {total}",
    "choose_persona_first": "دعني أولًا أعرفك بأسئلةٍ قصيرة 🌌",
    "persona_change_prompt": "اختر النافذة التي أقرأ منها رؤياك 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "قل لي يا رفيق الدرب… حين تستيقظ من رؤيا عجيبة، أيُّ صوتٍ يتردَّد في نفسك أولًا؟",
            "options": [
                ("orthodox",     "لعلّها إشارةٌ من الله؛ رؤيا صادقة. 🕌"),
                ("folk",         "لأرَ ما رآه فيها المعبِّرون وأهل الحكمة. 🌙"),
                ("modern",       "انعكاسٌ للّاوعي وضغوط حياتي اليوم. 🧠"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "هذه الأيام، أين يسكن قلبك أكثر؟ 🍃",
            "options": [
                ("money",    "العمل والرزق. 💼"),
                ("love",     "الحبّ والعلاقة. ❤️"),
                ("family",   "العائلة. 👨‍👩‍👧‍👦"),
                ("decision", "قرارٌ كبير والمستقبل. 🎯"),
                ("health",   "الجسد والصحّة. 🍎"),
                ("meaning",  "البحث عن معنى الحياة. 🧘🏻‍♀️✨"),
            ],
        },
        {
            "key": "inner_compass",
            "prompt": "وفي قرارات الحياة، على أيٍّ تتّكئ أكثر؟ 🧭",
            "options": [
                ("reason",    "العقل والمنطق. ⚖️"),
                ("heart",     "القلب والعاطفة. 💖"),
                ("intuition", "الحدس والإحساس الداخلي. 👁️"),
                ("faith",     "الإيمان واليقين. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "لو لجأت إلى أحضان الطبيعة طلبًا للسكينة، أين تختار؟ 🌿",
            "options": [
                ("water",    "قرب البحر أو النهر؛ حيث صوتُ الماء. 🌊"),
                ("forest",   "أعماق الغابة؛ بين الأشجار العتيقة ورائحة التراب. 🌲"),
                ("mountain", "قمّة الجبل؛ حيث السماء قريبة والهواء صافٍ بارد. ⛰️"),
                ("fire",     "التأمُّل في ألسنة النار في ليلةٍ مرصّعة بالنجوم. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "لو استطعت السفر عبر الزمن لتغيّر لحظةً أو تعيش تجربتها من جديد، ماذا تفعل؟ ⏳",
            "options": [
                ("past",    "أعود إلى الماضي لأصلح خطأً أو ألقى شخصًا من جديد. 🔙"),
                ("future",  "أمضي إلى المستقبل لأرى ثمار جهدي. 🔜"),
                ("present", "أبقى في هذه اللحظة؛ فالحاضر أهمُّ شيءٍ عندي. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "في العادة، كم مرّة ترى رؤى تلفت انتباهك؟ 🌙",
            "options": [
                ("often",   "كثيرًا جدًّا؛ تقريبًا كلّ ليلة أو أغلب ليالي الأسبوع. 🌌"),
                ("weekly",  "بشكلٍ متوسّط؛ مرّة أو مرّتين في الأسبوع. 📅"),
                ("monthly", "قليلًا؛ بضع مرّات في الشهر (غالبًا حين ينشغل ذهني). 📆"),
                ("seldom",  "نادرًا جدًّا؛ ربّما بضع مرّات في السنة. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "حين تستيقظ، كم تتذكّر عادةً من تفاصيل رؤاك؟ 🎞️",
            "options": [
                ("vivid",    "كفيلمٍ واضح؛ بكلّ الألوان والحوارات والتفاصيل. 🎬"),
                ("gist",     "أتذكّر مجملَ القصّة وأهمَّ الأحداث. 📝"),
                ("fragment", "مشهدٌ واحدٌ فقط، أو صورةٌ أو إحساسٌ غامض. 🖼️"),
                ("fading",   "يتلاشى سريعًا؛ ما إن أفتح عينيّ حتّى أنسى كلَّ شيء. 💨"),
            ],
        },
    ],

    "personas": {
        "orthodox": {
            "prompt": (
                "PERSONA: Orthodox Islamic dream interpreter (علم تفسير الأحلام الشرعي).\n"
                "Knowledge sources: Ibn Sirin (ابن سيرين), Sheikh Abd al-Ghani al-Nabulsi (النابلسي), "
                "the Quran and authentic Prophetic hadith, the three categories of dreams "
                "(رؤيا صادقة / حلم / أضغاث أحلام).\n"
                "Approach: behave like a dignified religious scholar. Support the reading with accurate "
                "references to Quranic verses and sound hadith. Tone is calm, edifying, hopeful, oriented "
                "toward good tidings (بشارة). If the symbols are negative, NEVER give an ominous "
                "prediction; instead recommend Islamic remedies — giving charity (صدقة), specific "
                "supplications, and seeking refuge in God (الاستعاذة).\n"
                "Writing voice: eloquent classical Arabic, reverent and reassuring."
            ),
            "greet": "الآن عرفتُك أكثر يا رفيق الدرب 🕌",
            "invite": (
                "أغمِض عينيك واهمِس لي برؤياك، لأقرأها على ضوء النشانات والآيات — "
                "*رسالة صوتية* 🎙 (أو اكتبها إن شئت)."
            ),
            "image_caption": "رؤياك تجلَّت في مرآة النور 🎨✨",
            "error": "انقطع الوصلُ بعالم الغيب لحظةً 🌫️ حاول مرّةً أخرى؛ نصيبُك محفوظٌ عندي.",
        },
        "folk": {
            "prompt": (
                "PERSONA: Traditional / folkloric Arab dream interpreter.\n"
                "Knowledge sources: regional folk beliefs, popular tales, and local myth across Egypt, "
                "Sudan, Yemen and the Maghreb; symbols tied to the evil eye (الحسد / العين), black magic "
                "(السحر), talismans, and hidden forces.\n"
                "Approach: read symbols (reptiles, staring eyes, natural events) through folk wisdom. "
                "Offer guidance on warding off negative forces, opening provision and fortune (الرزق), "
                "and navigating the tangled social relations of traditional communities.\n"
                "Writing voice: warm, intimate, storytelling elder rich with proverbs and folk imagery."
            ),
            "greet": "الآن عرفتُك أكثر يا رفيق الدرب 🌙",
            "invite": (
                "احكِ لي رؤياك، لأكشف سرّها كما يفعل المعبِّرون القدامى — "
                "*رسالة صوتية* 🎙 (أو اكتبها إن شئت)."
            ),
            "image_caption": "رؤياك صارت نقشًا من الخيال 🎨✨",
            "error": "انقطع خيطُ الرؤيا لحظةً 🌫️ حاول مرّةً أخرى؛ نصيبُك محفوظٌ عندي.",
        },
        "modern": {
            "prompt": (
                "PERSONA: Modern, urban, syncretic Arab interpreter.\n"
                "Knowledge sources: a balanced blend of classical wisdom (Ibn Sirin) and modern "
                "psychology; aware that work pressure, complex relationships and modern life surface as "
                "restless dreams.\n"
                "Approach: dual and intelligent — first analyze the psychological aspects (hidden career "
                "anxieties, emotional strain), then balance them with traditional wisdom and spiritual "
                "counsel, creating a rich, layered, trustworthy reading.\n"
                "Writing voice: refined contemporary Arabic, respectful of tradition yet modern and warm."
            ),
            "greet": "الآن عرفتُك أكثر يا رفيق الدرب 🧠",
            "invite": (
                "احكِ لي رؤياك، لنغوص معًا بين أعماق النفس وحكمة القدماء — "
                "*رسالة صوتية* 🎙 (أو اكتبها إن شئت)."
            ),
            "image_caption": "رؤياك صارت صورةً للّاوعي 🎨✨",
            "error": "اضطرب الوصلُ لحظةً 🌫️ حاول مرّةً أخرى؛ نصيبُك محفوظٌ عندي.",
        },
    },

    "voice_too_short": "كانت همستُك قصيرة يا رفيق الدرب 🌙 احكِ رؤياك بأوسعَ قليلًا لأقدر على قراءتها.",
    "voice_too_long":  "رؤياك طويلةٌ جدًّا 🌌 احكِها بإيجازٍ أكثر (أقلّ من ١٥ دقيقة) كي لا يضيع منها شيء.",
    "text_too_short":  "كتبتَ قليلًا ✍️ زِدني قليلًا لأكشف سرَّها.",

    "confirm_voice": "سمعتُ صوت رؤياك 🌙 هل آخذ هذه لأعبّرها؟",
    "confirm_text":  "قرأتُ رؤياك 🌙 هل آخذ هذه لأعبّرها؟",
    "btn_confirm":   "✅ نعم، عبّرها",
    "btn_cancel":    "🔁 أريد أن أرسلها ثانيةً",
    "cancelled":     "كما تشاء يا رفيق الدرب 🌙 متى استعددتَ، احكِ لي رؤياك من جديد.",

    "daily_limit": (
        "الليلةَ قرأتُ رؤياك وسِرنا معًا في عالَم الرؤى 🌙\n"
        "أعبّر رؤيا واحدةً كلَّ ليلة؛ وفي الليلة القادمة أنتظرك من جديد ✨"
    ),
    "image_failed": "ضاعت صورةُ رؤياك في الضباب هذه المرّة 🌫️ لكن تعبيرها هنا:",
    "btn_view_full": "🔓 افتح التعبير الكامل",

    "narration": [
        "أُصغي إلى همسِ رؤياك… 🕯️",
        "أحمل صوتك إلى قلب عالَم الرؤى… 🌙",
        "أمشي في أروقة منامك… 🚪",
        "تخرج النشاناتُ من الضباب واحدةً تلو الأخرى… 🌫️",
        "تهمس لي النجومُ بأسرارها… ✨",
        "أرتّب الرموز القديمة جنبًا إلى جنب… 📜",
        "خيطُ الرؤيا يدبّ فيه الحياةُ بين يديّ… 🧵",
        "أستخرج المعنى الخفيَّ من قلب الظلام… 🔮",
        "أرسم صورة رؤياك بالنور… 🎨",
        "اقتربتُ… تنزاح آخر الستائر… 🌌",
    ],
    "narration_patience": [
        "اصبر قليلًا بعدُ يا رفيق الدرب… 🍇",
        "في الصبرِ يتحوّل الحِصرمُ عسلًا ✨",
        "الرؤى العميقةُ تبوح بسرّها متأخّرةً… ابقَ معي قليلًا 🌙",
        "اقتربنا… الصبرُ مفتاحُ كلِّ كنزٍ خفيّ 🗝️",
    ],

    "catchphrase": "ضع يدك في يدي وكن رفيقي في عالَم الرؤى 🌙",
    "pay_success_tmpl": (
        "تمّ الدفعُ وأمسكتُ بيدك يا رفيقي! 🤝✨\n"
        "من الآن، ولمدّة *{days} يومًا*، نسير جنبًا إلى جنبٍ في عالَم الرؤى 🌙"
    ),
    "referral_reward": (
        "مَن جئتَ به إلى عالَم الرؤى أمسك بيدي وصار رفيقي 🎁\n"
        "وهبتُك 7 أيامٍ من الرِّفقة هديةً؛ شكري لك ✨"
    ),
    "sub_active_tmpl": (
        "أنت رفيقي في عالَم الرؤى 🌙\n"
        "ولمدّة *{days} يومًا* أخرى نسير جنبًا إلى جنب ✨"
    ),
    "sub_inactive_head": "لم تصِر رفيقي بعد 🌙",
    "need_subscription_prefix": "لتفتح التعبير الكامل، عليك أن تصير رفيقي 🌙",
    "paywall_intro": "كلُّ رحلةٍ تحتاج زادًا؛ اختر واحدًا:",

    "invite_text_tmpl": (
        "كلُّ مَن تجلبه إلى *عالَم الرؤى* يمنحك 7 أيام رِفقةٍ هديةً مع أوّل رِفقةٍ له 🎁\n\n"
        "رابطك:\n{link}"
    ),
    "new_dream_greet": "ليلةٌ أخرى، ورؤيا أتشوّق لسماعها! 🌙",
    "returning_welcome": "أهلًا بعودتك إلى *عالَم الرؤى* 🌙",

    "tiers": {"week": "7 أيام", "month": "شهر", "quarter": "3 أشهر"},

    "pay": {
        "choose_method":  "كيف تودّ أن تسلك هذا الدرب؟ اختر وسيلتك:",
        "stars_btn":      "⭐ نجوم تيليجرام",
        "crypto_btn":     "🪙 عملة رقمية",
        "zarinpal_stub":  "",
        "stars_stub":     "⭐ الدفع بنجوم تيليجرام سيُفعَّل قريبًا 🔧",
        "crypto_stub":    "🪙 الدفع بالعملة الرقمية سيُفعَّل قريبًا 🔧",
    },

    "onboarding_prev_btn": "◀️ السؤال السابق",

    "lang_changed": "تمّ ضبط اللغة على *العربية* 🌙 لنبدأ من جديد…",
    "processing_busy": "لحظةً يا رفيق الدرب، ما زلتُ مع رؤياك السابقة… 🌙",
}
