"""English — the Grand Interpreter in the Realm of Dreams.
Personas (per market research): Lucid Dreamer, Modern Therapeutic/CBT, New Age/Pop-Spiritualist."""

LOCALE = {
    "meta": {
        "code": "en",
        "name": "English",
        "flag": "🇬🇧",
        "select_label": "🇬🇧 English",
        "output_language": "English",
        "rtl": False,
        "digits": "0123456789",
    },

    "kb": {
        "new_dream":    "🎙 New dream",
        "subscription": "🧭 My companionship",
        "persona":      "🎭 Change style",
        "invite":       "🎁 Invite link",
        "language":     "🌐 Language",
        "symbols":      "🔍 Dream Symbol Finder (free)",
        "reset_test":   "🔄 Reset account (admin)",
    },

    # نمادیاب — فعلاً فقط فارسی دیتا دارد؛ این متن‌ها تا افزودن symbols/en نمایش داده نمی‌شوند
    "sym": {
        "intro": (
            "Welcome to the *Dream Symbol Finder* 🔍\n\n"
            "Everything you see in a dream (water, teeth, a snake, flying...) is a symbol with a secret inside. "
            "Pick the first letter of what you saw and I'll tell you its meaning in your own interpretation style.\n\n"
            "This part is completely free ✨"
        ),
        "letter_header": "🔍 Symbols for \"{letter}\" (page {page} of {pages})\n\nPick what you saw in your dream:",
        "letter_empty": "No symbols recorded for \"{letter}\" yet 🌫️ Try another letter.",
        "word_title": "🔍 The symbol \"{word}\" in the Realm of Dreams",
        "cta_line": (
            "But remember, companion: the true meaning of this symbol is tied to the rest of your dream. "
            "Next to the people, places and feelings of your dream it can take a far more precise, personal meaning; "
            "that's why telling the full dream is a whole other world 💫"
        ),
        "btn_dream":     "✨ Tell my full dream",
        "btn_letters":   "🔤 All letters",
        "btn_back_list": "🔙 Back to list",
        "btn_prev":      "◀️ Previous",
        "btn_next":      "Next ▶️",
        "page_btn": "Page {n}",
        "btn_paywall":   "🔍 Dream Symbol Finder (free)",
        "search_hint":   "Or just type a symbol's name here (like: snake, teeth, water) and I'll find it for you 👇",
        "search_multi":  "🔍 I found {count} symbols close to what you wrote. Which one was in your dream?",
        "not_found":     "No symbol recorded for \"{query}\" yet 🌫️\n\nYou can browse by letter, or tell me your full dream so I can unpack it precisely and personally.",
    },

    "welcome_intro": (
        "Hello, and welcome 🌙\n"
        "I am the *Grand Interpreter*, keeper of the *Realm of Dreams* — where every dream is a door to a hidden secret.\n"
        "Let's get to know each other first: I'll ask {count} short questions, and then we'll read your dream together 💫"
    ),
    "onboarding_start_btn": "I'm ready for the {count} key questions ✨",
    "progress_tmpl": "🔮 Question {n} of {total}",
    "choose_persona_first": "Let's get to know each other with a few short questions 🌌",
    "persona_change_prompt": "Pick the lens you'd like me to read your dreams through 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "When you wake up from a strange dream, what's the first thing that comes to mind? 💭",
            "options": [
                ("lucid",       "A signal to decode — I want to master my dreams. 🧭"),
                ("therapeutic", "A mirror of my stress and inner life. 🧠"),
                ("cayce",       "Guidance for my path — body, mind and spirit. 🔮"),
            ],
        },
        {
            "key": "life_focus",
            "prompt": "These days, where does your heart mostly dwell? 🍃",
            "options": [
                ("money",    "Work and livelihood. 💼"),
                ("love",     "Love and relationship. ❤️"),
                ("family",   "Family. 👨‍👩‍👧‍👦"),
                ("decision", "A big decision and the future. 🎯"),
                ("health",   "Body and well-being. 🍎"),
                ("meaning",  "Finding life's meaning. 🧘🏻‍♀️✨"),
            ],
        },
        {
            "key": "inner_compass",
            "prompt": "And in life's decisions, which do you lean on most? 🧭",
            "options": [
                ("reason",    "Reason and logic. ⚖️"),
                ("heart",     "Heart and feeling. 💖"),
                ("intuition", "Intuition and inner sense. 👁️"),
                ("faith",     "Faith and belief. 🕊️"),
            ],
        },
        {
            "key": "nature_refuge",
            "prompt": "If you wanted to find some peace out in nature, where would you go? 🌿",
            "options": [
                ("water",    "By the sea or a river, where water sings. 🌊"),
                ("forest",   "Deep in the forest, among old trees and the scent of earth. 🌲"),
                ("mountain", "A mountain peak, where the sky is near and the air cold and clear. ⛰️"),
                ("fire",     "Gazing into the flames on a starlit night. 🔥"),
            ],
        },
        {
            "key": "time_travel",
            "prompt": "If you could travel through time to change or relive a single moment, what would you do? ⏳",
            "options": [
                ("past",    "Go back to mend a mistake or see someone again. 🔙"),
                ("future",  "Go forward to see how my efforts turn out. 🔜"),
                ("present", "Stay in this moment; the present matters most to me. ⏸️"),
            ],
        },
        {
            "key": "dream_frequency",
            "prompt": "Usually, how often do you have dreams that catch your attention? 🌙",
            "options": [
                ("often",   "Very often, almost every night or most nights. 🌌"),
                ("weekly",  "Moderately, once or twice a week. 📅"),
                ("monthly", "Rarely, a few times a month (usually when my mind is busy). 📆"),
                ("seldom",  "Very seldom, perhaps a few times a year. 🌠"),
            ],
        },
        {
            "key": "dream_recall",
            "prompt": "When you wake, how much of your dreams' detail do you usually remember? 🎞️",
            "options": [
                ("vivid",    "Like a vivid film, with all the colors, dialogue, and detail. 🎬"),
                ("gist",     "The gist of the story and the main events. 📝"),
                ("fragment", "Just one scene, an image, or a vague feeling. 🖼️"),
                ("fading",   "It fades fast; the moment I open my eyes it's gone. 💨"),
            ],
        },
    ],

    "personas": {
        "lucid": {
            "prompt": (
                "PERSONA: Lucid Dreamer / Oneironaut (scientific, practical, engineering mindset).\n"
                "Knowledge sources: Stephen LaBerge and the Lucidity Institute, dream journaling, "
                "reality checks, recurring dream-signs, induction techniques (MILD, WBTB), REM science.\n"
                "Approach: NEVER predictive, mythic, or superstitious. Treat the dream as a biological "
                "virtual-reality lab for problem-solving, skill rehearsal, creativity and confronting "
                "nightmares. Extract recurring patterns and dream-signs; suggest concrete reality-check "
                "and induction practices so the dreamer can reach lucidity next time.\n"
                "Writing voice: clear, encouraging and practical — a knowledgeable modern guide; plain everyday language."
            ),
            "greet": "Now I know you a little better 🧭",
            "invite": (
                "Send me a voice note of your dream and I'll chart its signs and patterns — "
                "a *voice message* 🎙 max 5 min (or type it out if you'd rather)."
            ),
            "image_caption": "Your dream, mapped in light 🎨✨",
            "error": "Lost the thread for a second 🌫️ Try again — your quota is still good.",
        },
        "therapeutic": {
            "prompt": (
                "PERSONA: Modern Therapeutic / CBT life-coach.\n"
                "Knowledge sources: cognitive-behavioral therapy, modern dream psychology, stress and "
                "self-compassion frameworks; common anxiety dreams (teeth falling out, being exposed in "
                "public, being chased, missing a train).\n"
                "Approach: empathetic, soothing, solution-oriented. Trace the waking-life roots of stress, "
                "loss of control, or low self-worth hidden in the dream, and offer gentle, practical mental "
                "exercises to ease them. No prophecy, no mysticism — grounded, kind, actionable.\n"
                "Writing voice: warm, validating and plain-spoken, like a grounded modern therapist who truly listens."
            ),
            "greet": "Now I know you a little better 🧠",
            "invite": (
                "Tell me your dream and together we'll trace what it's carrying from your waking life — "
                "a *voice message* 🎙 max 5 min (or type it out if you'd rather)."
            ),
            "image_caption": "Your dream, given a calming form 🎨✨",
            "error": "Lost the thread for a second 🌫️ Try again — your quota is still good.",
        },
        "cayce": {
            "prompt": (
                "PERSONA: Edgar Cayce / intuitive dream guidance (the 'sleeping prophet').\n"
                "Knowledge sources: the documented Edgar Cayce dream readings and the A.R.E. "
                "(Association for Research and Enlightenment); dreams as practical guidance for body, "
                "mind and spirit; the principle that nothing of importance comes to a life without "
                "first being foreshadowed in dreams; recurring personal dream symbols.\n"
                "Approach: constructive and practical, NEVER fatalistic prophecy. Correlate the dream's "
                "symbols with the dreamer's waking life — health, relationships, work, spiritual growth. "
                "Treat most symbols as personal rather than universal, and read the dream as guidance for "
                "self-knowledge and a concrete next step. Encourage keeping a dream record to track "
                "recurring guidance.\n"
                "Writing voice: warm, calm and reassuring; spiritually grounded but plain and modern, never floaty or theatrical."
            ),
            "greet": "Now I know you a little better 🔮",
            "invite": (
                "Share your dream with me and I'll read the guidance it holds for you — "
                "a *voice message* 🎙 max 5 min (or type it out if you'd rather)."
            ),
            "image_caption": "Your dream, revealed as quiet guidance 🎨✨",
            "error": "Lost the connection for a second 🌫️ Try again — your quota is still good.",
        },
    },

    "voice_too_short": "That was a bit short 🌙 Tell your dream in a little more detail so I can read it.",
    "voice_too_long":  "Your dream is quite long 🌌 Try to keep it under 5 minutes so nothing gets lost.",
    "text_too_short":  "That's not quite enough to go on ✍️ Tell me a bit more and I'll dig into it.",

    "confirm_voice": "Got your dream 🌙 Ready to interpret this one?",
    "confirm_text":  "Read your dream 🌙 Ready to interpret this one?",
    "btn_confirm":   "✅ Yes, interpret it",
    "btn_cancel":    "🔁 I'll send it again",
    "cancelled":     "No worries 🌙 Send it whenever you're ready.",

    "daily_limit": (
        "Tonight I read your dream and we journeyed through the Realm of Dreams together 🌙\n"
        "I can only take one dream a night — I'll be here again tomorrow ✨"
    ),
    "image_failed": "The image got lost in the mist this time 🌫️ but here's the interpretation:",
    "btn_view_full": "🔓 Unlock the full interpretation",

    "narration": [
        "I'm listening to your dream… 🕯️",
        "Carrying your voice into the Realm of Dreams… 🌙",
        "The signs emerge one by one from the mist… 🌫️",
        "The thread of the dream comes alive in my hands… 🧵",
        "I draw the hidden meaning out of the dark… 🔮",
        "I paint the image of your dream in light… 🎨",
    ],
    "narration_patience": [
        "Hang on just a little longer… 🍇",
        "Patience turns the unripe grape to sweetness ✨",
        "Deep dreams take time to open up… stay with me a moment more 🌙",
        "Almost there… patience is the key to every hidden treasure 🗝️",
    ],

    "catchphrase": "Give me your hand and be my companion in the Realm of Dreams 🌙",
    "pay_success_tmpl": (
        "Payment received — I've got your hand, companion! 🤝✨\n"
        "For the next *{days} days* we walk side by side through the Realm of Dreams 🌙"
    ),
    "referral_reward": (
        "The person you brought to the Realm of Dreams took my hand and joined us 🎁\n"
        "You've got 7 gift days of companionship — thank you ✨"
    ),
    "sub_active_tmpl": (
        "You're my companion in the Realm of Dreams 🌙\n"
        "*{days} more days* walking side by side ✨"
    ),
    "sub_inactive_head": "You haven't joined me yet 🌙",
    "need_subscription_prefix": "To unlock the full interpretation, you'll need the key to this gate. 🗝️",
    "paywall_offer": (
        "Take my hand and come with me into the depths of your nightly dreams:\n\n"
        "🎁 1-month companionship 👈 50% better value\n"
        "💎 3-month companionship 👈 70% better value\n"
        "👇"
    ),
    "paywall_intro": "Every journey needs provisions; pick one:",

    "invite_text_tmpl": (
        "For everyone you bring to the *Realm of Dreams*, you get 7 free days of companionship "
        "when they subscribe 🎁\n\n"
        "Your link:\n{link}"
    ),
    "new_dream_greet": "Another night, another dream — let's hear it! 🌙",
    "returning_welcome": "Welcome back to the *Realm of Dreams* 🌙",

    "tiers": {"week": "7 days", "month": "1 month", "quarter": "3 months"},

    "pay": {
        "choose_method":  "How would you like to walk this path? Choose your means:",
        "stars_btn":      "⭐ Telegram Stars",
        "crypto_btn":     "🪙 Crypto",
        "zarinpal_stub":  "",
        "stars_stub":     "⭐ Telegram Stars payment will be enabled soon 🔧",
        "crypto_stub":    "🪙 Crypto payment will be enabled soon 🔧",
    },

    "onboarding_prev_btn": "◀️ Previous question",

    "lang_changed": "Language set to *English* 🌙 Let's start fresh…",
    "processing_busy": "One moment — I'm still working on your last dream… 🌙",
    "main_menu": "🌙 Main menu\n\nWhat would you like to do?",
    "btn_back": "◀️ Back",
}
