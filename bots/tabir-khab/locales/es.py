"""Español — el Gran Intérprete en el Reino de los Sueños.
Personajes (según el estudio de mercado): psicoanalítico clínico (Freud/Lacan),
junguiano arquetípico, sincrético e indígena espiritual."""

LOCALE = {
    "meta": {
        "code": "es",
        "name": "Español",
        "flag": "🇪🇸",
        "select_label": "🇪🇸 Español",
        "output_language": "Spanish",
        "rtl": False,
        "digits": "0123456789",
    },

    "kb": {
        "new_dream":    "🎙 Nuevo sueño",
        "subscription": "🧭 Mi compañía",
        "persona":      "🎭 Cambiar estilo",
        "invite":       "🎁 Enlace de invitación",
        "language":     "🌐 Idioma",
        "symbols":      "🔍 Buscador de símbolos (gratis)",
        "reset_test":   "🔄 Restablecer cuenta (admin)",
        "support":      "💬 Soporte",
    },

    # پشتیبانی (قرارداد مشترکِ همه‌ی ربات‌ها؛ لینک و کد در support.py). {code} = #DRM-<user_id>
    "support": {
        "open_btn":   "💬 Abrir chat de soporte",
        "draft_note": "Por favor, no borres este código y escribe tu mensaje debajo 👇",
        "body": "💬 Toca el botón de abajo y escribe tu mensaje; no borres este código:\n`{code}`",
    },

    # نمادیاب — فعلاً فقط فارسی دیتا دارد؛ این متن‌ها تا افزودن symbols/es نمایش داده نمی‌شوند
    "sym": {
        "intro": (
            "Bienvenido al *Buscador de símbolos del sueño* 🔍\n\n"
            "Todo lo que ves en un sueño (agua, dientes, una serpiente, volar...) es un símbolo con un secreto dentro. "
            "Elige la primera letra de lo que viste y te diré su significado en tu propio estilo de interpretación.\n\n"
            "Esta parte es totalmente gratis ✨"
        ),
        "letter_header": "🔍 Símbolos con «{letter}» (página {page} de {pages})\n\nElige lo que viste en tu sueño:",
        "letter_empty": "Aún no hay símbolos para «{letter}» 🌫️ Prueba otra letra.",
        "word_title": "🔍 El símbolo «{word}» en el Reino de los Sueños",
        "cta_line": (
            "Pero recuerda, compañero: el verdadero significado de este símbolo está ligado al resto de tu sueño. "
            "Junto a las personas, lugares y emociones de tu sueño puede tomar un sentido mucho más preciso y personal; "
            "por eso contar el sueño completo es otro mundo 💫"
        ),
        "btn_dream":     "✨ Contar mi sueño completo",
        "btn_letters":   "🔤 Todas las letras",
        "btn_back_list": "🔙 Volver a la lista",
        "btn_prev":      "◀️ Anterior",
        "btn_next":      "Siguiente ▶️",
        "page_btn": "Pág. {n}",
        "btn_paywall":   "🔍 Buscador de símbolos (gratis)",
        "search_hint":   "O escribe aquí el nombre de un símbolo (como: serpiente, dientes, agua) y lo busco para ti 👇",
        "search_multi":  "🔍 Encontré {count} símbolos cercanos a lo que escribiste. ¿Cuál estaba en tu sueño?",
        "not_found":     "Aún no hay ningún símbolo para «{query}» 🌫️\n\nPuedes buscar por letra, o contarme tu sueño completo para interpretarlo con precisión y de forma personal.",
    },

    "welcome_intro": (
        "Hola, ¡bienvenido! 🌙\n"
        "Soy el *Gran Intérprete*, guardián del *Reino de los Sueños* — donde cada sueño es una puerta a un secreto oculto.\n"
        "Primero conozcámonos: te haré {count} preguntas cortas y luego leemos tu sueño juntos 💫"
    ),
    "onboarding_start_btn": "Listo, vamos con las {count} preguntas ✨",
    "progress_tmpl": "🔮 Pregunta {n} de {total}",
    "choose_persona_first": "Primero conozcámonos con unas preguntas cortas 🌌",
    "persona_change_prompt": "Elige el enfoque con el que quieres que lea tus sueños 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Cuando despiertas de un sueño raro, ¿qué es lo primero que se te viene a la mente? 💭",
            "options": [
                ("clinical",   "Lo manifiesto y lo latente: deseos y miedos reprimidos. 🛋️"),
                ("jungian",    "Arquetipos del inconsciente colectivo y mi camino interior. 🌀"),
                ("indigenous", "Un viaje del alma y la sabiduría de la naturaleza y los ancestros. 🌿"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "En estos días, ¿en qué está más puesta tu cabeza y tu corazón? 🍃",
            "options": [
                ("money",    "El trabajo y el sustento. 💼"),
                ("love",     "El amor y la relación. ❤️"),
                ("family",   "La familia. 👨‍👩‍👧‍👦"),
                ("decision", "Una gran decisión y el futuro. 🎯"),
                ("health",   "El cuerpo y la salud. 🍎"),
                ("meaning",  "Hallar el sentido de la vida. 🧘🏻‍♀️✨"),
            ],
        },
        {
            "key": "inner_compass",
            "prompt": "Y cuando tomas decisiones, ¿en qué te apoyas más? 🧭",
            "options": [
                ("reason",    "En la razón y la lógica. ⚖️"),
                ("heart",     "En el corazón y lo que siento. 💖"),
                ("intuition", "En la intuición y mi sentir interior. 👁️"),
                ("faith",     "En la fe y mis creencias. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "Si quisieras desconectar en la naturaleza, ¿a dónde irías? 🌿",
            "options": [
                ("water",    "Junto al mar o un río, donde se escucha el agua. 🌊"),
                ("forest",   "En lo profundo del bosque, entre árboles viejos y olor a tierra. 🌲"),
                ("mountain", "A la cima de una montaña, donde el cielo está cerca y el aire es frío y limpio. ⛰️"),
                ("fire",     "Mirando el fuego en una noche estrellada. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "Si pudieras viajar en el tiempo para cambiar o revivir un solo momento, ¿qué harías? ⏳",
            "options": [
                ("past",    "Volver al pasado para arreglar un error o ver a alguien de nuevo. 🔙"),
                ("future",  "Ir al futuro para ver en qué quedaron mis esfuerzos. 🔜"),
                ("present", "Quedarme en este momento; el presente es lo que más me importa. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Normalmente, ¿cada cuánto tienes sueños que te llaman la atención? 🌙",
            "options": [
                ("often",   "Muy seguido, casi todas las noches o la mayoría. 🌌"),
                ("weekly",  "Más o menos, una o dos veces por semana. 📅"),
                ("monthly", "Poco, algunas veces al mes (normalmente cuando tengo la cabeza llena). 📆"),
                ("seldom",  "Muy rara vez, quizá unas pocas veces al año. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "Al despertar, ¿cuántos detalles de tus sueños sueles recordar? 🎞️",
            "options": [
                ("vivid",    "Como una película nítida, con todos los colores, diálogos y detalles. 🎬"),
                ("gist",     "La historia en general y lo principal que pasó. 📝"),
                ("fragment", "Solo una escena, una imagen o una sensación vaga. 🖼️"),
                ("fading",   "Se borra rápido; en cuanto abro los ojos, se va todo. 💨"),
            ],
        },
    ],

    "personas": {
        "clinical": {
            "prompt": (
                "PERSONA: Clinical Psychoanalyst (Río de la Plata tradition — Freud and Lacan).\n"
                "Knowledge sources: Freudian and Lacanian psychoanalysis; the distinction between the "
                "manifest content and the latent content (repressed desires, fears, wishes).\n"
                "Approach: act as a professional analyst, never a fortune-teller. Use precise concepts — "
                "complejos, ansiedades existenciales, transferencia, libido, mecanismos de proyección. "
                "Be professional, neutral, non-judgmental and questioning, like a session of free "
                "association (asociación libre) that invites introspection and deep self-inquiry.\n"
                "Writing voice: clear, sober and intellectually warm, in plain modern language."
            ),
            "greet": "Ahora te conozco un poco mejor 🛋️",
            "invite": (
                "Cuéntame tu sueño y juntos vamos a distinguir lo manifiesto de lo latente — "
                "un *mensaje de voz* 🎙 máx. 5 min (o escríbelo si prefieres)."
            ),
            "image_caption": "Tu sueño tomó forma desde lo latente 🎨✨",
            "error": "El hilo se cortó un momento 🌫️ Inténtalo de nuevo; tu cupo está a salvo.",
        },
        "jungian": {
            "prompt": (
                "PERSONA: Jungian Archetypal interpreter.\n"
                "Knowledge sources: Carl Jung, the collective unconscious, individuation (individuación), "
                "and universal archetypes — the Shadow, Anima, Animus, the Wise Old One, the Inner Child, "
                "the Hero.\n"
                "Approach: read the dream as a psychic journey toward wholeness. Map its symbols onto "
                "universal archetypes, classical mythology and the hero's inner journey, seeking harmony "
                "between the light and dark parts of the psyche.\n"
                "Writing voice: reflective and warm, in plain modern language; explain the archetypes clearly, not mythic or grandiose."
            ),
            "greet": "Ahora te conozco un poco mejor 🌀",
            "invite": (
                "Cuéntame tu sueño y vamos a descifrar los arquetipos que viven en él — "
                "un *mensaje de voz* 🎙 máx. 5 min (o escríbelo si prefieres)."
            ),
            "image_caption": "Tu sueño se reveló en sus arquetipos 🎨✨",
            "error": "El hilo se cortó un momento 🌫️ Inténtalo de nuevo; tu cupo está a salvo.",
        },
        "indigenous": {
            "prompt": (
                "PERSONA: Syncretic / Indigenous Spiritualist (Andean-Mesoamerican roots blended with "
                "Spanish Catholicism).\n"
                "Knowledge sources: shamanism and indigenous belief (Mexico, Peru, Bolivia, Colombia); "
                "dreams as real journeys of the soul, healing revelations of nature, and communion with "
                "totem animals, ancestors and protective spirits.\n"
                "Approach: use natural metaphors and the elements (earth, air, fire, water). Tie the "
                "reading to cleansing negative energies, keeping harmony with the rhythm of nature, and "
                "honouring ancestral wisdom.\n"
                "Writing voice: warm and grounded, close to nature, in plain modern language — not flowery or ceremonial."
            ),
            "greet": "Ahora te conozco un poco mejor 🌿",
            "invite": (
                "Cuéntame tu sueño y vamos a leer el viaje que hizo tu alma — "
                "un *mensaje de voz* 🎙 máx. 5 min (o escríbelo si prefieres)."
            ),
            "image_caption": "Tu sueño cobró vida como un viaje del alma 🎨✨",
            "error": "El puente se cortó un momento 🌫️ Inténtalo de nuevo; tu cupo está a salvo.",
        },
    },

    "voice_too_short": "Quedó un poco corto 🌙 Cuéntame tu sueño con un poco más de detalle para poder leerlo.",
    "voice_too_long":  "Tu sueño quedó bastante largo 🌌 Cuéntalo un poco más corto (menos de 5 minutos) para no perder nada.",
    "text_too_short":  "Con eso no tengo mucho de dónde agarrarme ✍️ Cuéntame un poco más y le saco el sentido.",

    "confirm_voice": "Recibí tu sueño 🌙 ¿Lo interpreto?",
    "confirm_text":  "Leí tu sueño 🌙 ¿Lo interpreto?",
    "btn_confirm":   "✅ Sí, interprétalo",
    "btn_cancel":    "🔁 Lo envío de nuevo",
    "cancelled":     "Sin problema 🌙 Envíamelo cuando estés listo.",

    "daily_limit": (
        "Esta noche leí tu sueño y recorrimos juntos el Reino de los Sueños 🌙\n"
        "Solo tomo un sueño por noche — mañana vuelvo a estar aquí ✨"
    ),
    "image_failed": "La imagen se perdió en la niebla esta vez 🌫️ pero aquí tienes la interpretación:",
    "btn_view_full": "🔓 Abrir la interpretación completa",

    "narration": [
        "Escucho tu sueño… 🕯️",
        "Llevo tu voz al Reino de los Sueños… 🌙",
        "Los signos emergen uno a uno de la niebla… 🌫️",
        "El hilo del sueño cobra vida en mis manos… 🧵",
        "Extraigo el sentido oculto de la oscuridad… 🔮",
        "Pinto con luz la imagen de tu sueño… 🎨",
    ],
    "narration_patience": [
        "Quédate un momento más… 🍇",
        "La paciencia convierte la uva verde en dulzura ✨",
        "Los sueños profundos revelan su secreto despacio… quédate un momento más 🌙",
        "Ya casi… la paciencia es la llave de todo tesoro oculto 🗝️",
    ],

    "catchphrase": "Dame tu mano y sé mi compañero en el Reino de los Sueños 🌙",
    "pay_success_tmpl": (
        "¡Pago recibido — te tomo de la mano, compañero! 🤝✨\n"
        "A partir de ahora, por *{days} días*, caminamos juntos por el Reino de los Sueños 🌙"
    ),
    "referral_reward": (
        "Quien trajiste al Reino de los Sueños tomó mi mano y se hizo mi compañero 🎁\n"
        "Te regalo 7 días de compañía — ¡gracias! ✨"
    ),
    "sub_active_tmpl": (
        "Eres mi compañero en el Reino de los Sueños 🌙\n"
        "*{days} días* más caminamos juntos ✨"
    ),
    "sub_inactive_head": "Todavía no eres mi compañero 🌙",
    "need_subscription_prefix": "Para abrir la interpretación completa, necesitas la llave de esta puerta. 🗝️",
    "paywall_offer": (
        "Dame tu mano y ven conmigo a las profundidades de tus sueños nocturnos:\n\n"
        "🎁 Compañía de 1 mes 👈 50% más conveniente\n"
        "💎 Compañía de 3 meses 👈 70% más conveniente\n"
        "👇"
    ),
    "paywall_intro": "Todo viaje necesita provisiones; elige una:",

    "invite_text_tmpl": (
        "Por cada persona que traigas al *Reino de los Sueños*, recibes 7 días de compañía gratis "
        "con su primera suscripción 🎁\n\n"
        "Tu enlace:\n{link}"
    ),
    "new_dream_greet": "¡Otra noche, otro sueño — cuéntamelo! 🌙",
    "returning_welcome": "¡Bienvenido de vuelta al *Reino de los Sueños*! 🌙",

    "tiers": {"week": "7 días", "month": "1 mes", "quarter": "3 meses"},

    "pay": {
        "choose_method":  "¿Cómo deseas recorrer este camino? Elige tu medio:",
        "stars_btn":      "⭐ Telegram Stars",
        "crypto_btn":     "🪙 Cripto",
        "zarinpal_stub":  "",
        "stars_stub":     "⭐ El pago con Telegram Stars estará disponible pronto 🔧",
        "crypto_stub":    "🪙 El pago con cripto estará disponible pronto 🔧",
    },

    "onboarding_prev_btn": "◀️ Pregunta anterior",

    "lang_changed": "Idioma cambiado a *Español* 🌙 Empecemos de nuevo…",
    "processing_busy": "Un momento — todavía estoy con tu sueño anterior… 🌙",
    "main_menu": "🌙 Menú principal\n\n¿Qué quieres hacer?",
    "btn_back": "◀️ Atrás",
}
