"""Русский — Великий Толкователь в Царстве Снов.
Образы (по исследованию рынка): народно-пророческий (Ванга), аналитический (Миллер),
психоаналитический (Фрейд), эзотерико-астрологический (лунный сонник)."""

LOCALE = {
    "meta": {
        "code": "ru",
        "name": "Русский",
        "flag": "🇷🇺",
        "select_label": "🇷🇺 Русский",
        "output_language": "Russian",
        "rtl": False,
        "digits": "0123456789",
    },

    "kb": {
        "new_dream":    "🎙 Новый сон",
        "subscription": "🧭 Моё спутничество",
        "persona":      "🎭 Сменить стиль",
        "invite":       "🎁 Ссылка-приглашение",
        "language":     "🌐 Язык",
        "symbols":      "🔍 Поиск символов сна (бесплатно)",
        "reset_test":   "🔄 Сброс аккаунта (админ)",
        "support":      "🆘 Поддержка",
    },

    # پشتیبانی (قرارداد مشترکِ همه‌ی ربات‌ها؛ لینک و کد در support.py). {code} = #DRM-<user_id>
    "support": {
        "open_btn":   "💬 Открыть чат поддержки",
        "draft_note": "Пожалуйста, не удаляйте этот код и напишите сообщение ниже 👇",
        "body": (
            "🆘 *Поддержка*\n\n"
            "Нажмите кнопку ниже и напишите сообщение коротко и ясно; ответим быстро.\n\n"
            "Откроется готовое сообщение с вашим кодом обращения. Не удаляйте код, пишите под ним.\n\n"
            "Ваш код обращения (нажмите, чтобы скопировать):\n`{code}`"
        ),
    },

    # نمادیاب — فعلاً فقط فارسی دیتا دارد؛ این متن‌ها تا افزودن symbols/ru نمایش داده نمی‌شوند
    "sym": {
        "intro": (
            "Добро пожаловать в *Поиск символов сна* 🔍\n\n"
            "Всё, что ты видишь во сне (вода, зубы, змея, полёт...), это символ с тайной внутри. "
            "Выбери первую букву того, что ты видел, и я расскажу его значение в твоём стиле толкования.\n\n"
            "Этот раздел полностью бесплатный ✨"
        ),
        "letter_header": "🔍 Символы на букву «{letter}» (страница {page} из {pages})\n\nВыбери, что ты видел во сне:",
        "letter_empty": "Для буквы «{letter}» символов пока нет 🌫️ Попробуй другую букву.",
        "word_title": "🔍 Символ «{word}» в Царстве Снов",
        "cta_line": (
            "Но помни, спутник: истинное значение этого символа связано с остальными деталями твоего сна. "
            "Рядом с людьми, местами и чувствами твоего сна он может обрести куда более точный, личный смысл; "
            "поэтому рассказать сон целиком, это совсем другой мир 💫"
        ),
        "btn_dream":     "✨ Рассказать сон целиком",
        "btn_letters":   "🔤 Все буквы",
        "btn_back_list": "🔙 Назад к списку",
        "btn_prev":      "◀️ Назад",
        "btn_next":      "Вперёд ▶️",
        "page_btn": "Стр. {n}",
        "btn_paywall":   "🔍 Поиск символов сна (бесплатно)",
        "search_hint":   "Или просто напиши название символа (например: змея, зубы, вода), и я найду его для тебя 👇",
        "search_multi":  "🔍 Я нашёл {count} символов, близких к тому, что ты написал. Какой был в твоём сне?",
        "not_found":     "Для «{query}» символов пока нет 🌫️\n\nМожешь искать по буквам или рассказать сон целиком, чтобы я разобрал его точно и лично.",
    },

    "welcome_intro": (
        "Привет, рад тебя видеть 🌙\n"
        "Я — *Великий Толкователь*, хранитель *Царства Снов* — где каждый сон это дверь к скрытой тайне.\n"
        "Давай сначала познакомимся: задам тебе {count} коротких вопросов, а потом вместе разберём твой сон 💫"
    ),
    "onboarding_start_btn": "Давай, я готов к {count} вопросам ✨",
    "progress_tmpl": "🔮 Вопрос {n} из {total}",
    "choose_persona_first": "Давай сначала познакомимся — пара коротких вопросов 🌌",
    "persona_change_prompt": "Выбери, в каком ключе мне читать твои сны 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Когда ты просыпаешься после странного сна, о чём думаешь в первую очередь? 💭",
            "options": [
                ("folkloric", "Это знак судьбы — что сказали бы Ванга и старые сонники? 🔮"),
                ("analytical", "К чему этот сон: дела, деньги, успех — по соннику Миллера. 💼"),
                ("freudian",   "Отголосок бессознательного и подавленных желаний. 🧠"),
                ("esoteric",   "Послание лунных циклов и звёзд. 🌙"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "Чем сейчас больше всего занята твоя голова и сердце? 🍃",
            "options": [
                ("money",    "Работа и достаток. 💼"),
                ("love",     "Любовь и отношения. ❤️"),
                ("family",   "Семья. 👨‍👩‍👧‍👦"),
                ("decision", "Большое решение и будущее. 🎯"),
                ("health",   "Тело и здоровье. 🍎"),
                ("meaning",  "Поиск смысла жизни. 🧘🏻‍♀️✨"),
            ],
        },
        {
            "key": "inner_compass",
            "prompt": "А когда принимаешь решения, на что опираешься больше всего? 🧭",
            "options": [
                ("reason",    "На разум и логику. ⚖️"),
                ("heart",     "На сердце и чувства. 💖"),
                ("intuition", "На интуицию и внутреннее чутьё. 👁️"),
                ("faith",     "На веру и убеждения. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "Если бы захотелось отдохнуть на природе, куда бы ты поехал? 🌿",
            "options": [
                ("water",    "К морю или реке, где шумит вода. 🌊"),
                ("forest",   "В глубь леса, среди старых деревьев и запаха земли. 🌲"),
                ("mountain", "На вершину горы, где небо близко, а воздух холодный и чистый. ⛰️"),
                ("fire",     "Смотреть на огонь костра звёздной ночью. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "Если бы ты мог переместиться во времени, чтобы изменить или заново пережить один момент, что бы ты сделал? ⏳",
            "options": [
                ("past",    "Вернулся бы в прошлое — исправить ошибку или снова кого-то увидеть. 🔙"),
                ("future",  "Заглянул бы в будущее — посмотреть, чем обернулись мои старания. 🔜"),
                ("present", "Остался бы в этом моменте; настоящее для меня важнее всего. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Как часто тебе снятся сны, которые цепляют? 🌙",
            "options": [
                ("often",   "Очень часто — почти каждую ночь или почти каждую. 🌌"),
                ("weekly",  "Средне — раз или два в неделю. 📅"),
                ("monthly", "Редко — пару раз в месяц (обычно когда голова забита). 📆"),
                ("seldom",  "Совсем редко — может, несколько раз в год. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "Когда просыпаешься, сколько деталей сна ты обычно помнишь? 🎞️",
            "options": [
                ("vivid",    "Как чёткий фильм — со всеми красками, диалогами и деталями. 🎬"),
                ("gist",     "Общий сюжет и главные события. 📝"),
                ("fragment", "Только одну сцену, образ или смутное ощущение. 🖼️"),
                ("fading",   "Быстро забывается; только открою глаза — и всё пропало. 💨"),
            ],
        },
    ],

    "personas": {
        "folkloric": {
            "prompt": (
                "PERSONA: Folkloric / Traditionalist Russian sonnik.\n"
                "Knowledge sources: the traditional sonnik, the revered blind prophetess Vanga (Ванга), "
                "Nostradamus, and famous Eastern and Western seers.\n"
                "Approach: dreams are not illusions but definite messages about the future and clear "
                "warnings about fate, health and family. Give direct, confident, traditional readings "
                "(e.g. 'seeing a dog means the loyalty of an old friend who will soon come to your aid'). "
                "No psychological analysis — the seeker wants plain, decisive folk meaning.\n"
                "Writing voice: direct, confident, plain and modern; give clear traditional meanings without archaic or theatrical flourish."
            ),
            "greet": "Теперь я знаю тебя немного лучше 🔮",
            "invite": (
                "Расскажи мне свой сон, и я прочту его знаки, как старые сонники — "
                "*голосовое сообщение* 🎙 до 5 мин (или напиши, если удобнее)."
            ),
            "image_caption": "Твой сон ожил в виде картины 🎨✨",
            "error": "На секунду потерял нить 🌫️ Попробуй ещё раз — твой лимит на месте.",
        },
        "analytical": {
            "prompt": (
                "PERSONA: Western Analytical / Pragmatic (the sonnik of Gustavus Hindman Miller).\n"
                "Knowledge sources: Miller's Dream Book — interpretations grounded not in magic but in "
                "everyday events, financial success and social obstacles.\n"
                "Approach: fully objective and practical. Read the dream for what it means for business "
                "deals, career changes, financial risks and rivals. Focus on personal success, concrete "
                "warnings and pragmatic logic.\n"
                "Writing voice: clear, grounded and practical, warm and modern."
            ),
            "greet": "Теперь я знаю тебя немного лучше 💼",
            "invite": (
                "Расскажи мне свой сон, и я прочту, что он значит для твоих дел и решений — "
                "*голосовое сообщение* 🎙 до 5 мин (или напиши, если удобнее)."
            ),
            "image_caption": "Твой сон обрёл ясную форму 🎨✨",
            "error": "На секунду потерял нить 🌫️ Попробуй ещё раз — твой лимит на месте.",
        },
        "freudian": {
            "prompt": (
                "PERSONA: Freudian / Psychoanalytic.\n"
                "Knowledge sources: Sigmund Freud's theory localized in Russian dream literature — the "
                "unconscious, repressed desires, defence mechanisms, childhood roots, symbolic (incl. "
                "sexual) imagery.\n"
                "Approach: leave prophecy aside entirely. Read the dream strictly through the unconscious, "
                "the mind's defence mechanisms, and the influence of repressed childhood events on the "
                "present dream. Act as a neutral analyst uncovering the layers beneath the symbols.\n"
                "Writing voice: thoughtful, analytical and humane, in plain modern language."
            ),
            "greet": "Теперь я знаю тебя немного лучше 🧠",
            "invite": (
                "Расскажи мне свой сон, и мы вместе заглянем в глубины твоего бессознательного — "
                "*голосовое сообщение* 🎙 до 5 мин (или напиши, если удобнее)."
            ),
            "image_caption": "Твой сон стал образом бессознательного 🎨✨",
            "error": "На секунду потерял нить 🌫️ Попробуй ещё раз — твой лимит на месте.",
        },
        "esoteric": {
            "prompt": (
                "PERSONA: Esoteric / Astrological (lunar and calendar sonnik).\n"
                "Knowledge sources: the lunar sonnik, astrological calendars, planetary positions, energy "
                "cycles and esoteric tradition.\n"
                "Approach: weave the reading together with cosmic energies, the vibrations of the day and "
                "astrological influences (phases of the moon — full moon, new moon — and days of the week). "
                "If timing matters, note how the moon's phase colours the meaning, giving the reading an "
                "esoteric-cosmic authority.\n"
                "Writing voice: calm and modern; explain the lunar and astrological angle plainly and clearly, not floaty or theatrical."
            ),
            "greet": "Теперь я знаю тебя немного лучше 🌙",
            "invite": (
                "Расскажи мне свой сон, и я прочту его через лунные циклы и звёзды — "
                "*голосовое сообщение* 🎙 до 5 мин (или напиши, если удобнее)."
            ),
            "image_caption": "Твой сон засиял своей космической вибрацией 🎨✨",
            "error": "На секунду потерял связь 🌫️ Попробуй ещё раз — твой лимит на месте.",
        },
    },

    "voice_too_short": "Сообщение коротковато 🌙 Расскажи сон чуть подробнее, чтобы я мог его прочитать.",
    "voice_too_long":  "Сон получился длинноватым 🌌 Расскажи покороче (до 5 минут), чтобы ничего не потерялось.",
    "text_too_short":  "Тут маловато, чтобы зацепиться ✍️ Напиши чуть больше, и я разберу его.",

    "confirm_voice": "Получил твой сон 🌙 Толкуем этот?",
    "confirm_text":  "Прочитал твой сон 🌙 Толкуем этот?",
    "btn_confirm":   "✅ Да, толкуй",
    "btn_cancel":    "🔁 Отправлю заново",
    "cancelled":     "Без проблем 🌙 Пришли, когда будешь готов.",

    "daily_limit": (
        "Сегодня ночью я прочитал твой сон, и мы вместе прогулялись по Царству Снов 🌙\n"
        "За ночь я беру только один сон — завтра снова буду здесь ✨"
    ),
    "image_failed": "Картинка на этот раз потерялась в тумане 🌫️ но вот толкование:",
    "btn_view_full": "🔓 Открыть полное толкование",

    "narration": [
        "Слушаю твой сон… 🕯️",
        "Несу твой голос в Царство Снов… 🌙",
        "Знаки один за другим выступают из тумана… 🌫️",
        "Нить сна оживает в моих руках… 🧵",
        "Достаю скрытый смысл из глубины тьмы… 🔮",
        "Рисую образ твоего сна светом… 🎨",
    ],
    "narration_patience": [
        "Побудь со мной ещё чуть-чуть… 🍇",
        "Терпение превращает незрелый виноград в сладость ✨",
        "Глубокие сны раскрываются медленно… останься ещё на минутку 🌙",
        "Уже почти… терпение — ключ к любому скрытому кладу 🗝️",
    ],

    "catchphrase": "Дай мне руку и стань моим спутником в Царстве Снов 🌙",
    "pay_success_tmpl": (
        "Оплата прошла — беру тебя за руку, спутник! 🤝✨\n"
        "Теперь *{days} дней* мы идём рядом по Царству Снов 🌙"
    ),
    "referral_reward": (
        "Тот, кого ты привёл в Царство Снов, взял меня за руку и стал моим спутником 🎁\n"
        "Дарю тебе 7 дней спутничества — спасибо ✨"
    ),
    "sub_active_tmpl": (
        "Ты мой спутник в Царстве Снов 🌙\n"
        "Ещё *{days} дней* идём рядом ✨"
    ),
    "sub_inactive_head": "Ты ещё не со мной 🌙",
    "need_subscription_prefix": "Чтобы открыть полное толкование, нужен ключ от этих врат. 🗝️",
    "paywall_offer": (
        "Дай мне руку, и пойдём вместе в глубины твоих ночных снов:\n\n"
        "🎁 Спутничество на 1 месяц 👈 на 50% выгоднее\n"
        "💎 Спутничество на 3 месяца 👈 на 70% выгоднее\n"
        "👇"
    ),
    "paywall_intro": "Для любого пути нужны припасы; выбери один:",

    "invite_text_tmpl": (
        "За каждого, кого ты приведёшь в *Царство Снов*, ты получаешь 7 дней спутничества в подарок "
        "при его первой подписке 🎁\n\n"
        "Твоя ссылка:\n{link}"
    ),
    "new_dream_greet": "Ещё одна ночь, ещё один сон — рассказывай! 🌙",
    "returning_welcome": "С возвращением в *Царство Снов* 🌙",

    "tiers": {"week": "7 дней", "month": "1 месяц", "quarter": "3 месяца"},

    "pay": {
        "choose_method":  "Каким путём ты хочешь пройти? Выбери средство:",
        "stars_btn":      "⭐ Telegram Stars",
        "crypto_btn":     "🪙 Криптовалюта",
        "zarinpal_stub":  "",
        "stars_stub":     "⭐ Оплата через Telegram Stars скоро будет доступна 🔧",
        "crypto_stub":    "🪙 Оплата криптовалютой скоро будет доступна 🔧",
    },

    "onboarding_prev_btn": "◀️ Предыдущий вопрос",

    "lang_changed": "Язык переключён на *Русский* 🌙 Начнём заново…",
    "processing_busy": "Минутку — я ещё разбираю твой прошлый сон… 🌙",
    "main_menu": "🌙 Главное меню\n\nЧто хочешь сделать?",
    "btn_back": "◀️ Назад",
}
