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
    },

    "welcome_intro": (
        "Hola, te doy la bienvenida 🌙\n"
        "Soy el *Gran Intérprete*, guardián del *Reino de los Sueños* — donde cada sueño es una puerta a un secreto oculto.\n"
        "Conozcámonos primero: te haré {count} preguntas breves y luego leeremos tu sueño juntos 💫"
    ),
    "onboarding_start_btn": "Listo para las {count} preguntas clave ✨",
    "progress_tmpl": "🔮 Pregunta {n} de {total}",
    "choose_persona_first": "Primero, deja que te conozca con unas breves preguntas 🌌",
    "persona_change_prompt": "Elige la ventana por la que he de leer tus sueños 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Dime, viajero… cuando despiertas de un sueño extraño, ¿qué voz resuena primero en ti?",
            "options": [
                ("clinical",   "Lo manifiesto y lo latente: deseos y temores reprimidos. 🛋️"),
                ("jungian",    "Arquetipos del inconsciente colectivo y mi camino interior. 🌀"),
                ("indigenous", "Un viaje del alma y la sabiduría de la naturaleza y los ancestros. 🌿"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "En estos días, ¿dónde habita más tu corazón? 🍃",
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
            "prompt": "Y en las decisiones de la vida, ¿en qué te apoyas más? 🧭",
            "options": [
                ("reason",    "La razón y la lógica. ⚖️"),
                ("heart",     "El corazón y el sentimiento. 💖"),
                ("intuition", "La intuición y el sentir interior. 👁️"),
                ("faith",     "La fe y la creencia. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "Si buscaras paz en el regazo de la naturaleza, ¿a dónde irías? 🌿",
            "options": [
                ("water",    "Junto al mar o un río, donde canta el agua. 🌊"),
                ("forest",   "En lo profundo del bosque, entre árboles antiguos y olor a tierra. 🌲"),
                ("mountain", "La cima de una montaña, donde el cielo está cerca y el aire es frío y claro. ⛰️"),
                ("fire",     "Contemplar las llamas en una noche estrellada. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "Si pudieras viajar en el tiempo para cambiar o revivir un solo instante, ¿qué harías? ⏳",
            "options": [
                ("past",    "Volver al pasado para reparar un error o ver a alguien de nuevo. 🔙"),
                ("future",  "Ir al futuro para ver el fruto de mis esfuerzos. 🔜"),
                ("present", "Quedarme en este instante; el presente es lo que más me importa. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Normalmente, ¿con qué frecuencia tienes sueños que llaman tu atención? 🌙",
            "options": [
                ("often",   "Muy a menudo, casi cada noche o la mayoría de las noches. 🌌"),
                ("weekly",  "Moderadamente, una o dos veces por semana. 📅"),
                ("monthly", "Poco, algunas veces al mes (suele ser cuando mi mente está ocupada). 📆"),
                ("seldom",  "Muy rara vez, quizá unas pocas veces al año. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "Al despertar, ¿cuánto detalle de tus sueños sueles recordar? 🎞️",
            "options": [
                ("vivid",    "Como una película nítida, con todos los colores, diálogos y detalles. 🎬"),
                ("gist",     "El conjunto de la historia y los sucesos principales. 📝"),
                ("fragment", "Solo una escena, una imagen o una sensación vaga. 🖼️"),
                ("fading",   "Se desvanece pronto; en cuanto abro los ojos, todo se va. 💨"),
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
                "Writing voice: lucid, sober, intellectually warm — a Buenos Aires analyst."
            ),
            "greet": "Ahora te conozco un poco mejor, viajero 🛋️",
            "invite": (
                "Cuéntame tu sueño, y juntos distinguiremos lo manifiesto de lo latente — "
                "un *mensaje de voz* 🎙 (o escríbelo, si prefieres)."
            ),
            "image_caption": "Tu sueño tomó forma desde lo latente 🎨✨",
            "error": "El hilo de la sesión se cortó un instante 🌫️ Inténtalo de nuevo; tu cupo está a salvo conmigo.",
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
                "Writing voice: mythic, reflective, luminous and integrative."
            ),
            "greet": "Ahora te conozco un poco mejor, viajero 🌀",
            "invite": (
                "Cuéntame tu sueño, y descifraremos los arquetipos que habitan en él — "
                "un *mensaje de voz* 🎙 (o escríbelo, si prefieres)."
            ),
            "image_caption": "Tu sueño se reveló en sus arquetipos 🎨✨",
            "error": "El hilo se cortó un instante 🌫️ Inténtalo de nuevo; tu cupo está a salvo conmigo.",
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
                "Writing voice: earthy, reverent, poetic and rooted in nature."
            ),
            "greet": "Ahora te conozco un poco mejor, viajero 🌿",
            "invite": (
                "Cuéntame tu sueño, y leeremos el viaje que tu alma emprendió — "
                "un *mensaje de voz* 🎙 (o escríbelo, si prefieres)."
            ),
            "image_caption": "Tu sueño cobró vida como un viaje del alma 🎨✨",
            "error": "El puente con los espíritus tembló un instante 🌫️ Inténtalo de nuevo; tu cupo está a salvo conmigo.",
        },
    },

    "voice_too_short": "Tu susurro fue breve, viajero 🌙 Cuéntame tu sueño un poco más para poder leerlo.",
    "voice_too_long":  "Tu sueño es muy largo 🌌 Cuéntalo algo más conciso (menos de 15 minutos) para no perder nada.",
    "text_too_short":  "Escribiste algo escueto ✍️ Dime un poco más para desvelar su secreto.",

    "confirm_voice": "Escuché la voz de tu sueño 🌙 ¿Tomo este para interpretarlo?",
    "confirm_text":  "Leí tu sueño 🌙 ¿Tomo este para interpretarlo?",
    "btn_confirm":   "✅ Sí, interprétalo",
    "btn_cancel":    "🔁 Quiero enviarlo de nuevo",
    "cancelled":     "Como quieras, viajero 🌙 Cuando estés listo, cuéntame tu sueño otra vez.",

    "daily_limit": (
        "Esta noche leí tu sueño y viajamos juntos por el Reino de los Sueños 🌙\n"
        "Interpreto solo un sueño cada noche; mañana por la noche te esperaré de nuevo ✨"
    ),
    "image_failed": "La imagen de tu sueño se perdió en la niebla esta vez 🌫️ pero aquí está su interpretación:",
    "btn_view_full": "🔓 Abrir la interpretación completa",

    "narration": [
        "Estoy escuchando el susurro de tu sueño… 🕯️",
        "Llevo tu voz al corazón del Reino de los Sueños… 🌙",
        "Camino por los pasillos de tu sueño… 🚪",
        "Los signos emergen uno a uno de la niebla… 🌫️",
        "Las estrellas me susurran sus secretos al oído… ✨",
        "Coloco los símbolos antiguos uno junto a otro… 📜",
        "El hilo del sueño cobra vida en mis manos… 🧵",
        "Extraigo el sentido oculto de la oscuridad… 🔮",
        "Pinto con luz la imagen de tu sueño… 🎨",
        "Estoy cerca… los últimos velos se apartan… 🌌",
    ],
    "narration_patience": [
        "Quédate conmigo un poco más, viajero… 🍇",
        "La paciencia convierte la uva verde en dulzura ✨",
        "Los sueños profundos revelan su secreto más tarde… quédate un momento más 🌙",
        "Estamos cerca… la paciencia es la llave de todo tesoro oculto 🗝️",
    ],

    "catchphrase": "Dame tu mano y sé mi compañero en el Reino de los Sueños 🌙",
    "pay_success_tmpl": (
        "¡Pago recibido, y he tomado tu mano, compañero! 🤝✨\n"
        "Desde ahora, durante *{days} días*, caminamos juntos por el Reino de los Sueños 🌙"
    ),
    "referral_reward": (
        "Quien trajiste al Reino de los Sueños tomó mi mano y se hizo mi compañero 🎁\n"
        "Te he regalado 7 días de compañía; mi gratitud te acompaña ✨"
    ),
    "sub_active_tmpl": (
        "Eres mi compañero en el Reino de los Sueños 🌙\n"
        "Durante *{days} días* más caminamos juntos ✨"
    ),
    "sub_inactive_head": "Aún no eres mi compañero 🌙",
    "need_subscription_prefix": "Para abrir la interpretación completa, debes hacerte mi compañero 🌙",
    "paywall_intro": "Todo viaje necesita provisiones; elige una:",

    "invite_text_tmpl": (
        "Por cada persona que traigas al *Reino de los Sueños*, recibes 7 días de compañía de regalo "
        "con su primera compañía 🎁\n\n"
        "Tu enlace:\n{link}"
    ),
    "new_dream_greet": "¡Otra noche, y un sueño que anhelo escuchar! 🌙",
    "returning_welcome": "Bendita sea tu vuelta al *Reino de los Sueños* 🌙",

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

    "lang_changed": "Idioma configurado en *Español* 🌙 Empecemos de nuevo…",
    "processing_busy": "Un momento, viajero — aún estoy con tu sueño anterior… 🌙",
}
