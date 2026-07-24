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
        "symbols":      "🔍 باحث رموز الأحلام (مجاني)",
        "reset_test":   "🔄 إعادة تعيين الحساب (مشرف)",
        "support":      "💬 الدعم",
    },

    # پشتیبانی (قرارداد مشترکِ همه‌ی ربات‌ها؛ لینک و کد در support.py). {code} = #DRM-<user_id>
    "support": {
        "open_btn":   "💬 فتح محادثة الدعم",
        "draft_note": "من فضلك لا تحذف هذا الرمز واكتب رسالتك تحته 👇",
        "body": "💬 اضغط الزر بالأسفل واكتب رسالتك؛ لا تحذف هذا الرمز:\n`{code}`",
    },

    # نمادیاب — فعلاً فقط فارسی دیتا دارد؛ این متن‌ها تا افزودن symbols/ar نمایش داده نمی‌شوند
    "sym": {
        "intro": (
            "أهلاً بك في *باحث رموز الأحلام* 🔍\n\n"
            "كل ما تراه في المنام (ماء، أسنان، أفعى، طيران...) رمزٌ يحمل سرًا. "
            "اختر الحرف الأول لما رأيته وسأخبرك بمعناه بأسلوب تفسيرك الخاص.\n\n"
            "هذا القسم مجاني تمامًا ✨"
        ),
        "letter_header": "🔍 رموز حرف «{letter}» (صفحة {page} من {pages})\n\nاختر ما رأيته في منامك:",
        "letter_empty": "لا رموز مسجّلة لحرف «{letter}» بعد 🌫️ جرّب حرفًا آخر.",
        "word_title": "🔍 رمز «{word}» في عالَم الرؤى",
        "cta_line": (
            "لكن تذكّر يا رفيقي: المعنى الحقيقي لهذا الرمز مرتبط ببقية تفاصيل رؤياك. "
            "هذا الرمز بجانب الأشخاص والأماكن ومشاعر رؤياك قد يأخذ معنى أدق وأكثر خصوصية؛ "
            "لهذا فإن سرد الرؤيا كاملةً عالمٌ آخر 💫"
        ),
        "btn_dream":     "✨ أروي رؤياي كاملة",
        "btn_letters":   "🔤 كل الحروف",
        "btn_back_list": "🔙 عودة إلى القائمة",
        "btn_prev":      "◀️ السابق",
        "btn_next":      "التالي ▶️",
        "page_btn": "صفحة {n}",
        "btn_paywall":   "🔍 باحث رموز الأحلام (مجاني)",
        "search_hint":   "أو اكتب اسم الرمز هنا (مثل: أفعى، أسنان، ماء) وسأجده لك مباشرة 👇",
        "search_multi":  "🔍 وجدت {count} رموز قريبة مما كتبت. أيّها كان في منامك؟",
        "not_found":     "لا رمز مسجّل لـ «{query}» بعد 🌫️\n\nيمكنك التصفّح حسب الحرف، أو تروي لي رؤياك كاملةً لأفسّرها بدقة وخصوصية.",
    },

    "welcome_intro": (
        "أهلًا بك 🌙\n"
        "أنا *المُعبِّر الأعظم*، حارس *عالَم الرؤى* — وكل رؤيا هنا باب على سرّ خفي.\n"
        "خلّينا نتعرّف على بعض أول: رح أسألك {count} أسئلة قصيرة، وبعدها نقرأ رؤياك مع بعض 💫"
    ),
    "onboarding_start_btn": "تمام، أنا جاهز لـ{count} أسئلة ✨",
    "progress_tmpl": "🔮 السؤال {n} من {total}",
    "choose_persona_first": "خلّينا نتعرّف على بعض بكم سؤال قصير 🌌",
    "persona_change_prompt": "اختر الأسلوب اللي تحب أقرأ فيه رؤياك 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "لما تصحى من رؤيا غريبة، شو أول شي يخطر في بالك؟ 💭",
            "options": [
                ("orthodox",     "يمكن إشارة من الله؛ رؤيا صادقة. 🕌"),
                ("folk",         "أبغى أعرف شو معناها عند المعبّرين القدامى. 🌙"),
                ("modern",       "انعكاس للّاوعي وضغوط حياتي اليوم. 🧠"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "هاليومين، وين قلبك مشغول أكثر؟ 🍃",
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
            "prompt": "ولما تاخذ قرار في حياتك، على شو تعتمد أكثر؟ 🧭",
            "options": [
                ("reason",    "العقل والمنطق. ⚖️"),
                ("heart",     "القلب والإحساس. 💖"),
                ("intuition", "الحدس والإحساس الداخلي. 👁️"),
                ("faith",     "الإيمان واليقين. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "لو بغيت تروّح عن نفسك في الطبيعة، وين تروح؟ 🌿",
            "options": [
                ("water",    "عند البحر أو النهر، وين صوت الماء. 🌊"),
                ("forest",   "جوّا الغابة، بين الأشجار القديمة وريحة التراب. 🌲"),
                ("mountain", "قمة جبل، وين السما قريبة والهوا بارد وصافي. ⛰️"),
                ("fire",     "أتفرّج على النار في ليلة مليانة نجوم. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "لو تقدر ترجع بالزمن وتغيّر لحظة وحدة أو تعيشها من جديد، شو بتسوي؟ ⏳",
            "options": [
                ("past",    "أرجع للماضي أصلّح غلطة أو أشوف شخص مرة ثانية. 🔙"),
                ("future",  "أروح للمستقبل أشوف نتيجة تعبي. 🔜"),
                ("present", "أبقى في هاللحظة؛ الحاضر أهم شي عندي. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "بشكل عام، كم مرة تشوف رؤى تلفت انتباهك؟ 🌙",
            "options": [
                ("often",   "وايد، تقريبًا كل ليلة أو أغلب الليالي. 🌌"),
                ("weekly",  "متوسط، مرة أو مرتين في الأسبوع. 📅"),
                ("monthly", "قليل، كم مرة في الشهر (غالبًا لما يكون بالي مشغول). 📆"),
                ("seldom",  "نادر جدًا، يمكن كم مرة في السنة. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "لما تصحى، كم تتذكر عادة من تفاصيل رؤاك؟ 🎞️",
            "options": [
                ("vivid",    "مثل فيلم واضح، بكل الألوان والحوارات والتفاصيل. 🎬"),
                ("gist",     "أتذكر القصة بشكل عام وأهم اللي صار. 📝"),
                ("fragment", "مشهد واحد بس، أو صورة أو إحساس مو واضح. 🖼️"),
                ("fading",   "تروح بسرعة؛ أول ما أفتح عيوني أنسى كل شي. 💨"),
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
                "Writing voice: clear, modern standard Arabic; reverent and reassuring but plain and accessible, not ornate or archaic."
            ),
            "greet": "حلو، صرت أعرفك أكثر شوي 🕌",
            "invite": (
                "احكِ لي رؤياك وأنا أقرأها لك على ضوء الآيات والأحاديث — "
                "*رسالة صوتية* 🎙 حتى ٥ دقائق (أو اكتبها إذا تحب)."
            ),
            "image_caption": "رؤياك صارت صورة 🎨✨",
            "error": "انقطع الاتصال لحظة 🌫️ جرّب مرة ثانية، نصيبك لسا محفوظ.",
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
                "Writing voice: warm and intimate like a friendly elder, but in plain modern Arabic — explain the folk meanings simply, not in flowery prose."
            ),
            "greet": "حلو، صرت أعرفك أكثر شوي 🌙",
            "invite": (
                "احكِ لي رؤياك وأنا أكشف لك سرّها على طريقة المعبّرين القدامى — "
                "*رسالة صوتية* 🎙 حتى ٥ دقائق (أو اكتبها إذا تحب)."
            ),
            "image_caption": "رؤياك صارت صورة 🎨✨",
            "error": "انقطع الخيط لحظة 🌫️ جرّب مرة ثانية، نصيبك لسا محفوظ.",
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
                "Writing voice: clear, modern Arabic; respectful of tradition yet contemporary, warm and plain."
            ),
            "greet": "حلو، صرت أعرفك أكثر شوي 🧠",
            "invite": (
                "احكِ لي رؤياك ونغوص مع بعض في أعماق النفس وحكمة القدماء — "
                "*رسالة صوتية* 🎙 حتى ٥ دقائق (أو اكتبها إذا تحب)."
            ),
            "image_caption": "رؤياك صارت صورة للّاوعي 🎨✨",
            "error": "اضطرب الاتصال لحظة 🌫️ جرّب مرة ثانية، نصيبك لسا محفوظ.",
        },
    },

    "voice_too_short": "الرسالة طلعت قصيرة شوي 🌙 احكِ لي رؤياك بتفصيل أكثر شوي عشان أقدر أقرأها.",
    "voice_too_long":  "رؤياك طويلة شوي 🌌 حاول تختصرها (أقل من ٥ دقائق) عشان ما يضيع منها شي.",
    "text_too_short":  "كتبت شوي بس ✍️ زوّدني أكثر شوي وأنا أكشف لك سرّها.",

    "confirm_voice": "وصلتني رؤياك 🌙 أعبّرها لك؟",
    "confirm_text":  "قرأت رؤياك 🌙 أعبّرها لك؟",
    "btn_confirm":   "✅ إيه، عبّرها",
    "btn_cancel":    "🔁 رح أرسلها من جديد",
    "cancelled":     "ولا يهمك 🌙 متى ما كنت جاهز، احكِ لي رؤياك.",

    "daily_limit": (
        "الليلة قرأت رؤياك وتمشّينا مع بعض في عالَم الرؤى 🌙\n"
        "أعبّر رؤيا وحدة كل ليلة؛ بكرة بنتظرك من جديد ✨"
    ),
    "image_failed": "ضاعت صورة رؤياك في الضباب هالمرة 🌫️ بس هذا تعبيرها:",
    "btn_view_full": "🔓 افتح التعبير الكامل",

    "narration": [
        "أسمع رؤياك… 🕯️",
        "أحمل صوتك لقلب عالَم الرؤى… 🌙",
        "النشانات تطلع من الضباب وحدة وراء وحدة… 🌫️",
        "خيط الرؤيا يدبّ فيه الحياة بين يديّ… 🧵",
        "أطلّع المعنى الخفي من قلب الظلام… 🔮",
        "أرسم صورة رؤياك بالنور… 🎨",
    ],
    "narration_patience": [
        "اصبر شوي معي… 🍇",
        "بالصبر يصير الحصرم عسل ✨",
        "الرؤى العميقة تبوح بسرّها على مهل… خلّيك معي شوي 🌙",
        "قربنا… الصبر مفتاح كل كنز خفي 🗝️",
    ],

    "catchphrase": "حُط يدك في يدي وكن رفيقي في عالَم الرؤى 🌙",
    "pay_success_tmpl": (
        "تم الدفع، وأمسكت بيدك يا رفيقي! 🤝✨\n"
        "من الآن ولمدة *{days} يوم* نمشي جنب بعض في عالَم الرؤى 🌙"
    ),
    "referral_reward": (
        "اللي جبته لعالَم الرؤى أمسك بيدي وصار رفيقي 🎁\n"
        "أهديتك 7 أيام رفقة مجانية؛ شكرًا لك ✨"
    ),
    "sub_active_tmpl": (
        "أنت رفيقي في عالَم الرؤى 🌙\n"
        "باقي *{days} يوم* نمشي فيهم جنب بعض ✨"
    ),
    "sub_inactive_head": "لسا ما انضميت لي 🌙",
    "need_subscription_prefix": "عشان تفتح التعبير الكامل، تحتاج مفتاح هالباب. 🗝️",
    "paywall_offer": (
        "أمسك بيدي وتعال معي لأعماق رؤاك الليلية:\n\n"
        "🎁 رفقة شهر واحد 👈 أوفر بنسبة ٥٠٪\n"
        "💎 رفقة ٣ أشهر 👈 أوفر بنسبة ٧٠٪\n"
        "👇"
    ),
    "paywall_intro": "كل رحلة تحتاج زاد؛ اختر واحد:",

    "invite_text_tmpl": (
        "كل واحد تجيبه لـ*عالَم الرؤى* يعطيك 7 أيام رفقة هدية مع أول اشتراك له 🎁\n\n"
        "رابطك:\n{link}"
    ),
    "new_dream_greet": "ليلة جديدة ورؤيا متشوّق أسمعها! 🌙",
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

    "lang_changed": "ضبطت اللغة على *العربية* 🌙 خلّينا نبدأ من جديد…",
    "processing_busy": "لحظة، لسا أشتغل على رؤياك السابقة… 🌙",
    "main_menu": "🌙 القائمة الرئيسية\n\nشو تحب نسوي؟",
    "btn_back": "◀️ رجوع",
}
