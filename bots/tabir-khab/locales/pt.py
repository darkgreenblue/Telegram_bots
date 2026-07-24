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
        "symbols":      "🔍 Buscador de símbolos (grátis)",
        "reset_test":   "🔄 Redefinir conta (admin)",
        "support":      "💬 Suporte",
    },

    # پشتیبانی (قرارداد مشترکِ همه‌ی ربات‌ها؛ لینک و کد در support.py). {code} = #DRM-<user_id>
    "support": {
        "open_btn":   "💬 Abrir chat do suporte",
        "draft_note": "Por favor, não apague este código e escreva sua mensagem abaixo 👇",
        "body": "💬 Toque no botão abaixo e escreva sua mensagem; não apague este código:\n`{code}`",
    },

    # نمادیاب — فعلاً فقط فارسی دیتا دارد؛ این متن‌ها تا افزودن symbols/pt نمایش داده نمی‌شوند
    "sym": {
        "intro": (
            "Bem-vindo ao *Buscador de símbolos do sonho* 🔍\n\n"
            "Tudo o que você vê num sonho (água, dentes, uma cobra, voar...) é um símbolo com um segredo dentro. "
            "Escolha a primeira letra do que você viu e eu direi o significado no seu próprio estilo de interpretação.\n\n"
            "Esta parte é totalmente grátis ✨"
        ),
        "letter_header": "🔍 Símbolos com «{letter}» (página {page} de {pages})\n\nEscolha o que você viu no seu sonho:",
        "letter_empty": "Ainda não há símbolos para «{letter}» 🌫️ Tente outra letra.",
        "word_title": "🔍 O símbolo «{word}» no Reino dos Sonhos",
        "cta_line": (
            "Mas lembre-se, companheiro: o verdadeiro significado deste símbolo está ligado ao resto do seu sonho. "
            "Junto às pessoas, lugares e emoções do seu sonho ele pode ganhar um sentido muito mais preciso e pessoal; "
            "por isso contar o sonho completo é outro mundo 💫"
        ),
        "btn_dream":     "✨ Contar meu sonho completo",
        "btn_letters":   "🔤 Todas as letras",
        "btn_back_list": "🔙 Voltar à lista",
        "btn_prev":      "◀️ Anterior",
        "btn_next":      "Próxima ▶️",
        "page_btn": "Pág. {n}",
        "btn_paywall":   "🔍 Buscador de símbolos (grátis)",
        "search_hint":   "Ou digite aqui o nome de um símbolo (como: cobra, dentes, água) e eu o encontro para você 👇",
        "search_multi":  "🔍 Encontrei {count} símbolos próximos do que você escreveu. Qual estava no seu sonho?",
        "not_found":     "Ainda não há nenhum símbolo para «{query}» 🌫️\n\nVocê pode buscar por letra, ou me contar o sonho completo para eu interpretá-lo com precisão e de forma pessoal.",
    },

    "welcome_intro": (
        "Olá, seja bem-vindo 🌙\n"
        "Eu sou o *Grande Intérprete*, guardião do *Reino dos Sonhos* — onde cada sonho é uma porta para um segredo oculto.\n"
        "Primeiro vamos nos conhecer: vou te fazer {count} perguntas curtas e depois a gente lê o seu sonho juntos 💫"
    ),
    "onboarding_start_btn": "Pronto, bora com as {count} perguntas ✨",
    "progress_tmpl": "🔮 Pergunta {n} de {total}",
    "choose_persona_first": "Primeiro vamos nos conhecer com umas perguntas curtas 🌌",
    "persona_change_prompt": "Escolhe o estilo que você quer que eu leia seus sonhos 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Quando você acorda de um sonho estranho, qual é a primeira coisa que vem à cabeça? 💭",
            "options": [
                ("spiritist",   "Um encontro do espírito: recados de quem partiu e dos guias. 🕯️"),
                ("afro",        "Um recado dos Orixás e das forças da natureza. 🌊"),
                ("lottery",     "Um sinal de sorte — que bicho e que números ele aponta? 🍀"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "Nesses dias, onde está mais a sua cabeça e o seu coração? 🍃",
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
            "prompt": "E nas decisões da vida, em que você mais se apoia? 🧭",
            "options": [
                ("reason",    "Na razão e na lógica. ⚖️"),
                ("heart",     "No coração e no que sinto. 💖"),
                ("intuition", "Na intuição e no meu sentir interior. 👁️"),
                ("faith",     "Na fé e nas minhas crenças. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "Se você quisesse relaxar na natureza, para onde iria? 🌿",
            "options": [
                ("water",    "Perto do mar ou de um rio, onde dá pra ouvir a água. 🌊"),
                ("forest",   "No fundo da floresta, entre árvores antigas e o cheiro de terra. 🌲"),
                ("mountain", "No alto de uma montanha, onde o céu está perto e o ar é frio e limpo. ⛰️"),
                ("fire",     "Olhando o fogo numa noite estrelada. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "Se você pudesse viajar no tempo para mudar ou reviver um único momento, o que faria? ⏳",
            "options": [
                ("past",    "Voltar ao passado para consertar um erro ou rever alguém. 🔙"),
                ("future",  "Ir ao futuro para ver no que deram os meus esforços. 🔜"),
                ("present", "Ficar neste momento; o presente é o que mais me importa. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Normalmente, com que frequência você tem sonhos que chamam a sua atenção? 🌙",
            "options": [
                ("often",   "Muito, quase toda noite ou na maioria das noites. 🌌"),
                ("weekly",  "Mais ou menos, uma ou duas vezes por semana. 📅"),
                ("monthly", "Pouco, algumas vezes por mês (geralmente quando estou com a cabeça cheia). 📆"),
                ("seldom",  "Muito raramente, talvez algumas vezes por ano. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "Ao acordar, quanto dos detalhes dos seus sonhos você costuma lembrar? 🎞️",
            "options": [
                ("vivid",    "Como um filme nítido, com todas as cores, diálogos e detalhes. 🎬"),
                ("gist",     "A história no geral e o principal que aconteceu. 📝"),
                ("fragment", "Só uma cena, uma imagem ou uma sensação vaga. 🖼️"),
                ("fading",   "Some rápido; assim que abro os olhos, vai tudo embora. 💨"),
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
                "uma *mensagem de voz* 🎙 até 5 min (ou escreve se preferir)."
            ),
            "image_caption": "O seu sonho ganhou forma entre os dois mundos 🎨✨",
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
                "uma *mensagem de voz* 🎙 até 5 min (ou escreve se preferir)."
            ),
            "image_caption": "O seu sonho se acendeu com as forças da natureza 🎨✨",
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
                "uma *mensagem de voz* 🎙 até 5 min (ou escreve se preferir)."
            ),
            "image_caption": "O seu sonho virou imagem — e talvez sorte 🎨✨",
            "error": "O fio do sonho se cortou por um instante 🌫️ Tenta de novo; sua cota está guardada.",
        },
    },

    "voice_too_short": "A mensagem ficou curtinha 🌙 Me conta o sonho com um pouco mais de detalhe pra eu conseguir ler.",
    "voice_too_long":  "Seu sonho ficou bem longo 🌌 Tenta contar mais resumido (até 5 minutos) pra não perder nada.",
    "text_too_short":  "Com isso não tenho muito pra trabalhar ✍️ Me conta um pouco mais e eu desvendo.",

    "confirm_voice": "Recebi o seu sonho 🌙 Interpreto esse?",
    "confirm_text":  "Li o seu sonho 🌙 Interpreto esse?",
    "btn_confirm":   "✅ Sim, interpreta",
    "btn_cancel":    "🔁 Quero enviar de novo",
    "cancelled":     "Tranquilo 🌙 Me manda quando estiver pronto.",

    "daily_limit": (
        "Esta noite li o seu sonho e demos uma volta juntos pelo Reino dos Sonhos 🌙\n"
        "Só pego um sonho por noite — amanhã estou aqui de novo ✨"
    ),
    "image_failed": "A imagem do sonho se perdeu na névoa dessa vez 🌫️ mas aqui está a interpretação:",
    "btn_view_full": "🔓 Abrir a interpretação completa",

    "narration": [
        "Estou ouvindo o seu sonho… 🕯️",
        "Levo a sua voz ao Reino dos Sonhos… 🌙",
        "Os sinais vão surgindo um a um da névoa… 🌫️",
        "O fio do sonho ganha vida nas minhas mãos… 🧵",
        "Tiro o sentido oculto da escuridão… 🔮",
        "Pinto com luz a imagem do seu sonho… 🎨",
    ],
    "narration_patience": [
        "Fica comigo mais um pouquinho… 🍇",
        "A paciência transforma a uva verde em doçura ✨",
        "Sonhos profundos revelam o segredo devagar… fica mais um pouquinho 🌙",
        "Já tô chegando… a paciência é a chave de todo tesouro escondido 🗝️",
    ],

    "catchphrase": "Me dá a sua mão e seja meu companheiro no Reino dos Sonhos 🌙",
    "pay_success_tmpl": (
        "Pagamento recebido — te peguei pela mão, companheiro! 🤝✨\n"
        "A partir de agora, por *{days} dias*, a gente caminha junto pelo Reino dos Sonhos 🌙"
    ),
    "referral_reward": (
        "Quem você trouxe ao Reino dos Sonhos tomou minha mão e se tornou meu companheiro 🎁\n"
        "Te dei 7 dias de companhia de presente — obrigado! ✨"
    ),
    "sub_active_tmpl": (
        "Você é meu companheiro no Reino dos Sonhos 🌙\n"
        "Por mais *{days} dias* a gente caminha junto ✨"
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
    "new_dream_greet": "Mais uma noite, mais um sonho — pode mandar! 🌙",
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
    "main_menu": "🌙 Menu principal\n\nO que você quer fazer?",
    "btn_back": "◀️ Voltar",
}
