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
                "Writing voice: warm, consoling and instructive, in plain modern language."
            ),
            "greet": "Agora te conheço um pouco melhor 🕯️",
            "invite": (
                "Me conta o seu sonho pra eu ler o que o seu espírito viveu — "
                "uma *mensagem de voz* 🎙 (ou escreve se preferir)."
            ),
            "image_caption": "O teu sonho ganhou forma entre os dois mundos 🎨✨",
            "error": "A ponte com o mundo espiritual oscilou por um instante 🌫️ Tenta de novo; sua cota está guardada.",
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
                "Writing voice: warm and vivid, rooted in the forces of nature, but in plain modern language — not ceremonial or ornate."
            ),
            "greet": "Agora te conheço um pouco melhor 🌊",
            "invite": (
                "Me conta o seu sonho pra eu ouvir o recado dos Orixás — "
                "uma *mensagem de voz* 🎙 (ou escreve se preferir)."
            ),
            "image_caption": "O teu sonho acendeu-se com as forças da natureza 🎨✨",
            "error": "A ligação com as forças oscilou por um instante 🌫️ Tenta de novo; sua cota está guardada.",
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
                "Writing voice: friendly, upbeat and modern, with a light wink of luck."
            ),
            "greet": "Agora te conheço um pouco melhor 🍀",
            "invite": (
                "Me conta o seu sonho pra eu descobrir o bicho e os números que ele aponta — "
                "uma *mensagem de voz* 🎙 (ou escreve se preferir)."
            ),
            "image_caption": "O teu sonho virou imagem — e talvez sorte 🎨✨",
            "error": "O fio do sonho se cortou por um instante 🌫️ Tenta de novo; sua cota está guardada.",
        },
    },

    "voice_too_short": "A mensagem ficou curtinha 🌙 Me conta o sonho com um pouco mais de detalhe pra eu conseguir ler.",
    "voice_too_long":  "Seu sonho ficou bem longo 🌌 Tenta contar de forma mais breve (até 5 minutos) pra não perder nada.",
    "text_too_short":  "Escreveu pouco ✍️ Me conta um pouco mais e eu desvendo o segredo.",

    "confirm_voice": "Recebi o seu sonho 🌙 Levo esse pra interpretar?",
    "confirm_text":  "Li o seu sonho 🌙 Levo esse pra interpretar?",
    "btn_confirm":   "✅ Sim, interpreta",
    "btn_cancel":    "🔁 Quero enviar de novo",
    "cancelled":     "Tudo bem 🌙 Quando estiver pronto, me conta o sonho.",

    "daily_limit": (
        "Esta noite li o seu sonho e viajamos juntos pelo Reino dos Sonhos 🌙\n"
        "Só interpreto um sonho por noite — amanhã estarei aqui de novo ✨"
    ),
    "image_failed": "A imagem do sonho se perdeu na névoa desta vez 🌫️ mas aqui está a interpretação:",
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
        "Fica comigo mais um instante… 🍇",
        "A paciência transforma a uva verde em doçura ✨",
        "Sonhos profundos revelam seu segredo devagar… fica mais um pouquinho 🌙",
        "Já tô chegando… a paciência é a chave de todo tesouro oculto 🗝️",
    ],

    "catchphrase": "Dá-me a tua mão e sê meu companheiro no Reino dos Sonhos 🌙",
    "pay_success_tmpl": (
        "Pagamento recebido — te peguei pela mão, companheiro! 🤝✨\n"
        "A partir de agora, por *{days} dias*, caminhamos juntos pelo Reino dos Sonhos 🌙"
    ),
    "referral_reward": (
        "Quem você trouxe ao Reino dos Sonhos tomou minha mão e se tornou meu companheiro 🎁\n"
        "Te dei 7 dias de companhia de presente — obrigado! ✨"
    ),
    "sub_active_tmpl": (
        "Você é meu companheiro no Reino dos Sonhos 🌙\n"
        "Por mais *{days} dias* caminhamos juntos ✨"
    ),
    "sub_inactive_head": "Você ainda não é meu companheiro 🌙",
    "need_subscription_prefix": "Para abrir a interpretação completa, você precisa da chave deste portão. 🗝️",
    "paywall_offer": (
        "Me dá a mão e vem comigo até as profundezas dos seus sonhos noturnos:\n\n"
        "🎁 Companhia de 1 mês 👈 50% mais vantajoso\n"
        "💎 Companhia de 3 meses 👈 70% mais vantajoso\n"
        "👇"
    ),
    "paywall_intro": "Toda jornada precisa de provisões; escolha uma:",

    "invite_text_tmpl": (
        "Por cada pessoa que você trouxer ao *Reino dos Sonhos*, ganha 7 dias de companhia de presente "
        "na primeira assinatura dela 🎁\n\n"
        "Seu link:\n{link}"
    ),
    "new_dream_greet": "Mais uma noite, mais um sonho — me conta! 🌙",
    "returning_welcome": "Bem-vindo de volta ao *Reino dos Sonhos* 🌙",

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
    "processing_busy": "Um momento — ainda tô com seu sonho anterior… 🌙",
}
