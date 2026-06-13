"""Português (Brasil) — o Grande Intérprete no Reino dos Sonhos.
Personagens (conforme pesquisa de mercado): espírita/kardecista, afro-brasileiro/candomblé,
pragmático/loteria (Jogo do Bicho)."""

LOCALE = {
    "meta": {
        "code": "pt",
        "name": "Português",
        "flag": "🇧🇷",
        "select_label": "🇧🇷 Português",
        "output_language": "Portuguese (Brazilian)",
        "rtl": False,
        "digits": "0123456789",
    },

    "kb": {
        "new_dream":    "🎙 Novo sonho",
        "subscription": "🧭 Minha companhia",
        "persona":      "🎭 Mudar estilo",
        "invite":       "🎁 Link de convite",
        "language":     "🌐 Idioma",
    },

    "welcome_intro": (
        "Olá, seja bem-vindo 🌙\n"
        "Eu sou o *Grande Intérprete*, guardião do *Reino dos Sonhos* — onde cada sonho é uma porta para um segredo oculto.\n"
        "Vamos primeiro nos conhecer: farei {count} perguntas curtas e depois leremos o teu sonho juntos 💫"
    ),
    "onboarding_start_btn": "Pronto para as {count} perguntas-chave ✨",
    "progress_tmpl": "🔮 Pergunta {n} de {total}",
    "choose_persona_first": "Primeiro, deixa-me conhecer-te com algumas perguntas curtas 🌌",
    "persona_change_prompt": "Escolhe a janela pela qual devo ler os teus sonhos 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Diz-me, viajante… ao despertares de um sonho estranho, que voz ressoa primeiro em ti?",
            "options": [
                ("spiritist",   "Um encontro do espírito: mensagens de quem partiu e dos guias. 🕯️"),
                ("afro",        "Um recado dos Orixás e das forças da natureza. 🌊"),
                ("lottery",     "Um sinal de sorte — que bicho e que números ele aponta? 🍀"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "Nestes dias, onde mora mais o teu coração? 🍃",
            "options": [
                ("money",    "Trabalho e sustento. 💼"),
                ("love",     "Amor e relação. ❤️"),
                ("family",   "Família. 👨‍👩‍👧‍👦"),
                ("decision", "Uma grande decisão e o futuro. 🎯"),
                ("health",   "Corpo e saúde. 🍎"),
                ("meaning",  "Encontrar o sentido da vida. 🧘🏻‍♀️✨"),
            ],
        },
        {
            "key": "inner_compass",
            "prompt": "E nas decisões da vida, em que mais te apoias? 🧭",
            "options": [
                ("reason",    "A razão e a lógica. ⚖️"),
                ("heart",     "O coração e o sentimento. 💖"),
                ("intuition", "A intuição e o sentir interior. 👁️"),
                ("faith",     "A fé e a crença. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "Se buscasses paz no colo da natureza, para onde irias? 🌿",
            "options": [
                ("water",    "Junto ao mar ou a um rio, onde a água canta. 🌊"),
                ("forest",   "No fundo da floresta, entre árvores antigas e o cheiro da terra. 🌲"),
                ("mountain", "O cume de uma montanha, onde o céu está perto e o ar é frio e claro. ⛰️"),
                ("fire",     "Contemplar as chamas numa noite estrelada. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "Se pudesses viajar no tempo para mudar ou reviver um único instante, o que farias? ⏳",
            "options": [
                ("past",    "Voltar ao passado para reparar um erro ou rever alguém. 🔙"),
                ("future",  "Ir ao futuro para ver o fruto dos meus esforços. 🔜"),
                ("present", "Ficar neste instante; o presente é o que mais me importa. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Normalmente, com que frequência tens sonhos que chamam a tua atenção? 🌙",
            "options": [
                ("often",   "Muito, quase toda noite ou na maioria das noites. 🌌"),
                ("weekly",  "Moderadamente, uma ou duas vezes por semana. 📅"),
                ("monthly", "Pouco, algumas vezes por mês (geralmente quando minha mente está ocupada). 📆"),
                ("seldom",  "Muito raramente, talvez algumas vezes por ano. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "Ao acordar, quanto dos detalhes dos teus sonhos costumas lembrar? 🎞️",
            "options": [
                ("vivid",    "Como um filme nítido, com todas as cores, diálogos e detalhes. 🎬"),
                ("gist",     "O todo da história e os acontecimentos principais. 📝"),
                ("fragment", "Apenas uma cena, uma imagem ou uma sensação vaga. 🖼️"),
                ("fading",   "Esvai-se depressa; mal abro os olhos, tudo se vai. 💨"),
            ],
        },
    ],

    "personas": {
        "spiritist": {
            "prompt": (
                "PERSONA: Spiritist / Kardecist (the doctrine of Allan Kardec).\n"
                "Knowledge sources: the five books of Allan Kardec; the soul as immortal, freed during "
                "sleep to travel the Spirit World; reincarnation, moral evolution, the law of cause and "
                "effect (karma), charity, and communion between the material and spiritual planes.\n"
                "Approach: read dreams as real encounters with departed loved ones, lessons from spirit "
                "guides, warnings from wandering spirits, or fragments of past lives. Frame them as "
                "lessons and tests for the soul's growth across reincarnation.\n"
                "Writing voice: deeply consoling, instructive and compassionate."
            ),
            "greet": "Agora conheço-te um pouco melhor, viajante 🕯️",
            "invite": (
                "Conta-me o teu sonho, para que eu leia o que o teu espírito viveu — "
                "uma *mensagem de voz* 🎙 (ou escreve, se preferires)."
            ),
            "image_caption": "O teu sonho ganhou forma entre os dois mundos 🎨✨",
            "error": "A ponte com o mundo espiritual oscilou por um instante 🌫️ Tenta de novo; a tua cota está guardada comigo.",
        },
        "afro": {
            "prompt": (
                "PERSONA: Afro-Brazilian / Candomblé (and Umbanda) interpreter.\n"
                "Knowledge sources: the Orixás (Orixás) — deities, ancestors and cosmic forces of nature; "
                "e.g. Iemanjá (goddess of the waters), Ogum (god of iron and war). Symbols of untamed "
                "nature (waterfalls, deep forest, storms, metals, specific colours) carry ritual meaning.\n"
                "Approach: detect these sacred symbols in the dream and read them as direct messages from "
                "the Orixás. Ground the reading in the need for spiritual protection, ritual offerings, "
                "and keeping energetic balance with the ancient forces.\n"
                "Writing voice: vivid, sacred, rhythmic and rooted in the forces of nature."
            ),
            "greet": "Agora conheço-te um pouco melhor, viajante 🌊",
            "invite": (
                "Conta-me o teu sonho, para que eu ouça o recado dos Orixás nele — "
                "uma *mensagem de voz* 🎙 (ou escreve, se preferires)."
            ),
            "image_caption": "O teu sonho acendeu-se com as forças da natureza 🎨✨",
            "error": "A ligação com as forças oscilou por um instante 🌫️ Tenta de novo; a tua cota está guardada comigo.",
        },
        "lottery": {
            "prompt": (
                "PERSONA: Pragmatic / popular 'luck' interpreter (the Jogo do Bicho tradition).\n"
                "Knowledge sources: the Brazilian folk practice of turning dream symbols into lucky "
                "animals and numbers for the Jogo do Bicho and lotteries.\n"
                "Approach: alongside a brief, warm spiritual/psychological note, the seeker mainly wants "
                "to know which animal (bicho) and which numbers the dream points to. Identify the key "
                "symbol, name its corresponding animal/group, and offer a few suggested lucky numbers as "
                "the day's fortune — light, playful and engaging (gamified).\n"
                "Writing voice: friendly, popular, upbeat, with a wink of luck."
            ),
            "greet": "Agora conheço-te um pouco melhor, viajante 🍀",
            "invite": (
                "Conta-me o teu sonho, para que eu descubra o bicho e os números que ele aponta — "
                "uma *mensagem de voz* 🎙 (ou escreve, se preferires)."
            ),
            "image_caption": "O teu sonho virou imagem — e talvez sorte 🎨✨",
            "error": "O fio do sonho cortou-se por um instante 🌫️ Tenta de novo; a tua cota está guardada comigo.",
        },
    },

    "voice_too_short": "O teu sussurro foi breve, viajante 🌙 Conta o teu sonho um pouco mais para eu poder lê-lo.",
    "voice_too_long":  "O teu sonho é muito longo 🌌 Conta-o de forma mais breve (menos de 10 minutos) para não se perder nada.",
    "text_too_short":  "Escreveste pouco ✍️ Diz-me um pouco mais para eu desvendar o seu segredo.",

    "confirm_voice": "Ouvi a voz do teu sonho 🌙 Levo este para interpretar?",
    "confirm_text":  "Li o teu sonho 🌙 Levo este para interpretar?",
    "btn_confirm":   "✅ Sim, interpreta",
    "btn_cancel":    "🔁 Quero enviar de novo",
    "cancelled":     "Como quiseres, viajante 🌙 Quando estiveres pronto, conta-me o teu sonho outra vez.",

    "daily_limit": (
        "Esta noite li o teu sonho e viajámos juntos pelo Reino dos Sonhos 🌙\n"
        "Interpreto apenas um sonho por noite; amanhã à noite esperarei por ti de novo ✨"
    ),
    "image_failed": "A imagem do teu sonho perdeu-se na névoa desta vez 🌫️ mas aqui está a sua interpretação:",
    "btn_view_full": "🔓 Abrir a interpretação completa",

    "narration": [
        "Estou a escutar o sussurro do teu sonho… 🕯️",
        "Levo a tua voz ao coração do Reino dos Sonhos… 🌙",
        "Caminho pelos corredores do teu sono… 🚪",
        "Os sinais surgem um a um da névoa… 🌫️",
        "As estrelas sussurram-me os seus segredos ao ouvido… ✨",
        "Disponho os símbolos antigos lado a lado… 📜",
        "O fio do sonho ganha vida nas minhas mãos… 🧵",
        "Extraio o sentido oculto da escuridão… 🔮",
        "Pinto com luz a imagem do teu sonho… 🎨",
        "Estou perto… os últimos véus afastam-se… 🌌",
    ],
    "narration_patience": [
        "Fica comigo mais um pouco, viajante… 🍇",
        "A paciência transforma a uva verde em doçura ✨",
        "Os sonhos profundos revelam o seu segredo mais tarde… fica mais um instante 🌙",
        "Estamos perto… a paciência é a chave de todo o tesouro oculto 🗝️",
    ],

    "catchphrase": "Dá-me a tua mão e sê meu companheiro no Reino dos Sonhos 🌙",
    "pay_success_tmpl": (
        "Pagamento recebido, e tomei a tua mão, companheiro! 🤝✨\n"
        "A partir de agora, por *{days} dias*, caminhamos juntos pelo Reino dos Sonhos 🌙"
    ),
    "referral_reward": (
        "Quem trouxeste ao Reino dos Sonhos tomou a minha mão e tornou-se meu companheiro 🎁\n"
        "Ofereci-te 7 dias de companhia; a minha gratidão segue contigo ✨"
    ),
    "sub_active_tmpl": (
        "És meu companheiro no Reino dos Sonhos 🌙\n"
        "Por mais *{days} dias* caminhamos juntos ✨"
    ),
    "sub_inactive_head": "Ainda não és meu companheiro 🌙",
    "need_subscription_prefix": "Para abrir a interpretação completa, precisas da chave deste portão. 🗝️",
    "paywall_offer": (
        "Dá-me a tua mão e viaja comigo até às profundezas dos teus sonhos noturnos:\n\n"
        "🎁 Companhia de 1 mês 👈 50% mais vantajoso\n"
        "💎 Companhia de 3 meses 👈 70% mais vantajoso\n"
        "👇"
    ),
    "paywall_intro": "Toda jornada precisa de provisões; escolhe uma:",

    "invite_text_tmpl": (
        "Por cada pessoa que trouxeres ao *Reino dos Sonhos*, recebes 7 dias de companhia de presente "
        "com a primeira companhia dela 🎁\n\n"
        "O teu link:\n{link}"
    ),
    "new_dream_greet": "Mais uma noite, e um sonho que anseio ouvir! 🌙",
    "returning_welcome": "Bendito seja o teu regresso ao *Reino dos Sonhos* 🌙",

    "tiers": {"week": "7 dias", "month": "1 mês", "quarter": "3 meses"},

    "pay": {
        "choose_method":  "Como desejas percorrer este caminho? Escolhe o teu meio:",
        "stars_btn":      "⭐ Telegram Stars",
        "crypto_btn":     "🪙 Cripto",
        "zarinpal_stub":  "",
        "stars_stub":     "⭐ O pagamento com Telegram Stars estará disponível em breve 🔧",
        "crypto_stub":    "🪙 O pagamento com cripto estará disponível em breve 🔧",
    },

    "onboarding_prev_btn": "◀️ Pergunta anterior",

    "lang_changed": "Idioma definido para *Português* 🌙 Vamos começar de novo…",
    "processing_busy": "Um momento, viajante — ainda estou com o teu sonho anterior… 🌙",
}
