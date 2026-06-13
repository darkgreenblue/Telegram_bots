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
    },

    "welcome_intro": (
        "Hello, and welcome 🌙\n"
        "I am the *Grand Interpreter*, keeper of the *Realm of Dreams* — where every dream is a door to a hidden secret.\n"
        "Let's get to know each other first: I'll ask {count} short questions, and then we'll read your dream together 💫"
    ),
    "onboarding_start_btn": "I'm ready for the {count} key questions ✨",
    "progress_tmpl": "🔮 Question {n} of {total}",
    "choose_persona_first": "Let's get to know each other with a few short questions 🌌",
    "persona_change_prompt": "Choose the lens through which I shall read your dreams 🎭",

    "onboarding": [
        {
            "key": "persona", "is_persona": True,
            "prompt": "Tell me, wayfarer… when you wake from a strange dream, which voice rises first within you?",
            "options": [
                ("lucid",       "A signal to decode — I want to master my dreams. 🧭"),
                ("therapeutic", "A mirror of my stress and inner life. 🧠"),
                ("newage",      "A message from the universe and my higher self. 🔮"),
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
            "prompt": "If you sought peace in the arms of nature, where would you go? 🌿",
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
                "Writing voice: lucid, encouraging, precise yet warm — a wise guide-engineer of dreams."
            ),
            "greet": "Now I know you a little better, wayfarer 🧭",
            "invite": (
                "Record your dream and send it to me, so I can chart its signs and patterns — "
                "a *voice message* 🎙 (or write it, if you prefer)."
            ),
            "image_caption": "Your dream, mapped in light 🎨✨",
            "error": "The thread of the dream slipped for a moment 🌫️ Try again; your quota is safe with me.",
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
                "Writing voice: warm, validating, like a trusted therapist who truly listens."
            ),
            "greet": "Now I know you a little better, wayfarer 🧠",
            "invite": (
                "Tell me your dream, and together we'll trace what it carries from your waking life — "
                "a *voice message* 🎙 (or write it, if you prefer)."
            ),
            "image_caption": "Your dream, given a calming form 🎨✨",
            "error": "Our thread slipped for a moment 🌫️ Try again; your quota is safe with me.",
        },
        "newage": {
            "prompt": (
                "PERSONA: New Age / Pop-Spiritualist.\n"
                "Knowledge sources: law of attraction, manifestation, astrology, tarot, chakras, "
                "synchronicity, the Higher Self, energy work — the modern self-help spiritual blend.\n"
                "Approach: read the dream as a sign of alignment with the universe, intuition from the "
                "Higher Self, or guidance toward abundance and love. Use this subculture's vocabulary "
                "(vibrations, manifestation, awakening, synchronicity) and frame the reading as an "
                "uplifting roadmap past energy blockages toward psychic and material abundance.\n"
                "Writing voice: luminous, uplifting, gently mystical and motivational."
            ),
            "greet": "Now I know you a little better, wayfarer 🔮",
            "invite": (
                "Share your dream with me, so we may read the signs the universe wove into it — "
                "a *voice message* 🎙 (or write it, if you prefer)."
            ),
            "image_caption": "Your dream, alight with its own vibration 🎨✨",
            "error": "The connection shimmered and broke for a moment 🌫️ Try again; your quota is safe with me.",
        },
    },

    "voice_too_short": "Your whisper was brief, wayfarer 🌙 Tell your dream a little more fully so I can read it.",
    "voice_too_long":  "Your dream runs very long 🌌 Tell it a little more concisely (under 15 minutes) so none is lost.",
    "text_too_short":  "You wrote rather little ✍️ Tell me a bit more so I can unveil its secret.",

    "confirm_voice": "I heard the voice of your dream 🌙 Shall I take this one for interpretation?",
    "confirm_text":  "I read your dream 🌙 Shall I take this one for interpretation?",
    "btn_confirm":   "✅ Yes, interpret it",
    "btn_cancel":    "🔁 I'll send it again",
    "cancelled":     "As you wish, wayfarer 🌙 Whenever you're ready, tell me your dream again.",

    "daily_limit": (
        "Tonight I read your dream and we journeyed together through the Realm of Dreams 🌙\n"
        "I interpret only one dream each night; tomorrow night I'll be waiting for you again ✨"
    ),
    "image_failed": "The image of your dream was lost in the mist this time 🌫️ but here is its interpretation:",
    "btn_view_full": "🔓 Unlock the full interpretation",

    "narration": [
        "I'm listening to the whisper of your dream… 🕯️",
        "Carrying your voice into the heart of the Realm of Dreams… 🌙",
        "Walking the corridors of your sleep… 🚪",
        "The signs emerge one by one from the mist… 🌫️",
        "The stars murmur their secrets in my ear… ✨",
        "I gather the ancient symbols side by side… 📜",
        "The thread of the dream comes alive in my hands… 🧵",
        "I draw the hidden meaning out of the dark… 🔮",
        "I paint the image of your dream in light… 🎨",
        "I am near… the last veils are drawing aside… 🌌",
    ],
    "narration_patience": [
        "Stay with me a little longer, wayfarer… 🍇",
        "Patience turns the unripe grape to sweetness ✨",
        "Deep dreams yield their secrets slowly… linger with me a moment more 🌙",
        "We are close… patience is the key to every hidden treasure 🗝️",
    ],

    "catchphrase": "Give me your hand and be my companion in the Realm of Dreams 🌙",
    "pay_success_tmpl": (
        "Payment received, and I have taken your hand, companion! 🤝✨\n"
        "From now, for *{days} days*, we walk side by side through the Realm of Dreams 🌙"
    ),
    "referral_reward": (
        "The one you brought to the Realm of Dreams took my hand and became my companion 🎁\n"
        "I've granted you 7 days of companionship as a gift; my thanks are with you ✨"
    ),
    "sub_active_tmpl": (
        "You are my companion in the Realm of Dreams 🌙\n"
        "For *{days} more days* we walk side by side ✨"
    ),
    "sub_inactive_head": "You are not yet my companion 🌙",
    "need_subscription_prefix": "To unlock the full interpretation, you need the key to this gate. 🗝️",
    "paywall_offer": (
        "Take my hand and journey with me into the depths of your nightly dreams:\n\n"
        "🎁 1-month companionship 👈 50% better value\n"
        "💎 3-month companionship 👈 70% better value\n"
        "👇"
    ),
    "paywall_intro": "Every journey needs provisions; choose one:",

    "invite_text_tmpl": (
        "For everyone you bring to the *Realm of Dreams*, you receive 7 gift days of companionship "
        "with their first companionship 🎁\n\n"
        "Your link:\n{link}"
    ),
    "new_dream_greet": "Another night, and a dream I long to hear! 🌙",
    "returning_welcome": "Blessed be your return to the *Realm of Dreams* 🌙",

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

    "lang_changed": "Language set to *English* 🌙 Let us begin anew…",
    "processing_busy": "One moment, wayfarer — I'm still with your previous dream… 🌙",
}
