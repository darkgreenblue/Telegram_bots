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
    },

    "welcome_intro": (
        "Здравствуй и добро пожаловать 🌙\n"
        "Я — *Великий Толкователь*, хранитель *Царства Снов* — где каждый сон есть дверь к сокрытой тайне.\n"
        "Давай сперва познакомимся: я задам тебе {count} коротких вопросов, а потом вместе прочтём твой сон 💫"
    ),
    "onboarding_start_btn": "Готов ответить на {count} ключевых вопросов ✨",
    "progress_tmpl": "🔮 Вопрос {n} из {total}",
    "choose_persona_first": "Сначала позволь узнать тебя через несколько коротких вопросов 🌌",
    "persona_change_prompt": "Выбери, через какое окно мне читать твои сны 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Скажи, странник… когда ты пробуждаешься от странного сна, какой голос звучит в тебе первым?",
            "options": [
                ("folkloric", "Это знак судьбы — что предрекли бы Ванга и древние? 🔮"),
                ("analytical", "Что сулит мне сон: дела, деньги, успех — по соннику Миллера. 💼"),
                ("freudian",   "Отзвук бессознательного и вытесненных желаний. 🧠"),
                ("esoteric",   "Послание лунных циклов и звёзд. 🌙"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "В эти дни — где чаще всего пребывает твоё сердце? 🍃",
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
            "prompt": "А в жизненных решениях на что ты опираешься больше всего? 🧭",
            "options": [
                ("reason",    "Разум и логику. ⚖️"),
                ("heart",     "Сердце и чувство. 💖"),
                ("intuition", "Интуицию и внутреннее чутьё. 👁️"),
                ("faith",     "Веру и убеждение. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "Если бы ты искал покоя в объятиях природы, куда бы ты отправился? 🌿",
            "options": [
                ("water",    "К морю или реке, где поёт вода. 🌊"),
                ("forest",   "В глубь леса, среди древних деревьев и запаха земли. 🌲"),
                ("mountain", "На вершину горы, где небо близко, а воздух холоден и чист. ⛰️"),
                ("fire",     "Глядеть в пламя костра звёздной ночью. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "Если бы ты мог странствовать во времени, чтобы изменить или вновь пережить одно мгновение, что бы ты сделал? ⏳",
            "options": [
                ("past",    "Вернулся бы в прошлое — исправить ошибку или вновь увидеть кого-то. 🔙"),
                ("future",  "Заглянул бы в будущее — увидеть плоды своих трудов. 🔜"),
                ("present", "Остался бы в этом мгновении; настоящее для меня важнее всего. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Как часто тебе обычно снятся сны, что привлекают твоё внимание? 🌙",
            "options": [
                ("often",   "Очень часто — почти каждую ночь или большинство ночей. 🌌"),
                ("weekly",  "Умеренно — раз или два в неделю. 📅"),
                ("monthly", "Редко — несколько раз в месяц (обычно когда ум занят). 📆"),
                ("seldom",  "Очень редко — быть может, несколько раз в году. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "Пробуждаясь, сколько подробностей сна ты обычно помнишь? 🎞️",
            "options": [
                ("vivid",    "Как чёткий фильм — со всеми красками, диалогами и деталями. 🎬"),
                ("gist",     "Общий ход истории и главные события. 📝"),
                ("fragment", "Лишь одну сцену, образ или смутное чувство. 🖼️"),
                ("fading",   "Быстро тает; едва открою глаза — всё исчезает. 💨"),
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
                "Расскажи мне свой сон, и я прочту его знаки, как древние провидцы — "
                "*голосовое сообщение* 🎙 (или напиши, если хочешь)."
            ),
            "image_caption": "Твой сон ожил в зеркале видений 🎨✨",
            "error": "Нить сна на секунду оборвалась 🌫️ Попробуй ещё раз — твоя доля у меня сохранена.",
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
                "Расскажи мне свой сон, и я прочту, что он означает для твоих дел и решений — "
                "*голосовое сообщение* 🎙 (или напиши, если хочешь)."
            ),
            "image_caption": "Твой сон обрёл ясную форму 🎨✨",
            "error": "Нить на секунду оборвалась 🌫️ Попробуй ещё раз — твоя доля у меня сохранена.",
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
                "Расскажи мне свой сон, и мы вместе нырнём в глубины твоего бессознательного — "
                "*голосовое сообщение* 🎙 (или напиши, если хочешь)."
            ),
            "image_caption": "Твой сон стал образом бессознательного 🎨✨",
            "error": "Нить на секунду прервалась 🌫️ Попробуй ещё раз — твоя доля у меня сохранена.",
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
                "Расскажи мне свой сон, и я прочту его в свете лунных циклов и звёзд — "
                "*голосовое сообщение* 🎙 (или напиши, если хочешь)."
            ),
            "image_caption": "Твой сон засиял своей космической вибрацией 🎨✨",
            "error": "Связь на секунду прервалась 🌫️ Попробуй ещё раз — твоя доля у меня сохранена.",
        },
    },

    "voice_too_short": "Сообщение получилось коротковатым 🌙 Расскажи свой сон чуть подробнее, чтобы я мог его прочитать.",
    "voice_too_long":  "Твой сон слишком длинный 🌌 Расскажи покороче (до 5 минут), чтобы ничего не потерять.",
    "text_too_short":  "Написано маловато ✍️ Добавь немного больше, и я раскрою тайну.",

    "confirm_voice": "Получил твой сон 🌙 Возьму его на толкование?",
    "confirm_text":  "Прочёл твой сон 🌙 Возьму его на толкование?",
    "btn_confirm":   "✅ Да, истолкуй",
    "btn_cancel":    "🔁 Отправлю заново",
    "cancelled":     "Хорошо 🌙 Когда будешь готов, расскажи снова.",

    "daily_limit": (
        "Сегодня ночью я прочёл твой сон, и мы вместе путешествовали по Царству Снов 🌙\n"
        "Я толкую только один сон за ночь — завтра снова буду ждать тебя ✨"
    ),
    "image_failed": "Образ твоего сна потерялся в тумане 🌫️ но вот его толкование:",
    "btn_view_full": "🔓 Открыть полное толкование",

    "narration": [
        "Я вслушиваюсь в шёпот твоего сна… 🕯️",
        "Несу твой голос в самое сердце Царства Снов… 🌙",
        "Иду по коридорам твоего сна… 🚪",
        "Знаки один за другим выступают из тумана… 🌫️",
        "Звёзды шепчут мне на ухо свои тайны… ✨",
        "Складываю древние символы один к одному… 📜",
        "Нить сна оживает в моих руках… 🧵",
        "Извлекаю скрытый смысл из глубины тьмы… 🔮",
        "Рисую образ твоего сна светом… 🎨",
        "Я близко… последние завесы расходятся… 🌌",
    ],
    "narration_patience": [
        "Побудь со мной ещё чуть-чуть… 🍇",
        "Терпение превращает незрелый виноград в сладость ✨",
        "Глубокие сны открывают свою тайну медленно… останься ещё на миг 🌙",
        "Уже близко… терпение — ключ к любому скрытому кладу 🗝️",
    ],

    "catchphrase": "Дай мне руку и стань моим спутником в Царстве Снов 🌙",
    "pay_success_tmpl": (
        "Оплата принята — я беру тебя за руку, спутник! 🤝✨\n"
        "Теперь *{days} дней* мы идём рядом по Царству Снов 🌙"
    ),
    "referral_reward": (
        "Тот, кого ты привёл в Царство Снов, взял меня за руку и стал моим спутником 🎁\n"
        "Я дарю тебе 7 дней спутничества — спасибо ✨"
    ),
    "sub_active_tmpl": (
        "Ты мой спутник в Царстве Снов 🌙\n"
        "Ещё *{days} дней* идём рядом ✨"
    ),
    "sub_inactive_head": "Ты ещё не стал моим спутником 🌙",
    "need_subscription_prefix": "Чтобы открыть полное толкование, нужен ключ от этих врат. 🗝️",
    "paywall_offer": (
        "Дай мне руку и отправимся вместе в глубины твоих ночных снов:\n\n"
        "🎁 Спутничество на 1 месяц 👈 на 50% выгоднее\n"
        "💎 Спутничество на 3 месяца 👈 на 70% выгоднее\n"
        "👇"
    ),
    "paywall_intro": "Любое странствие требует припасов; выбери одно:",

    "invite_text_tmpl": (
        "За каждого, кого ты приведёшь в *Царство Снов*, ты получаешь 7 дней спутничества в подарок "
        "при его первой подписке 🎁\n\n"
        "Твоя ссылка:\n{link}"
    ),
    "new_dream_greet": "Ещё одна ночь — и сон, который хочу услышать! 🌙",
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

    "lang_changed": "Язык установлен на *Русский* 🌙 Начнём заново…",
    "processing_busy": "Минуту — я ещё с твоим прошлым сном… 🌙",
}
