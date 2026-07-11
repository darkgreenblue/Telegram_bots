"""نمادیاب خواب — دیتای استاتیک نمادها + API مرور per زبان.

اصل طلایی: این ماژول هیچ فراخوانی LLM ندارد. محتوا یک‌باره تولید شده
(فایل‌های symbols/<lang>/gN.py) و در import در حافظه ایندکس می‌شود؛ ویرایش فقط از طریق PR.

ساختار هر نماد در فایل‌های دیتا:
  {"word": "...", "letter": "...", "tafsir": {"religious": "...", "traditional": "...", "psychological": "..."}}

زبان بدون دیتا = نمادیاب برای آن ربات غیرفعال (دکمه‌اش هم نمایش داده نمی‌شود).
"""
import logging

log = logging.getLogger("symbols")

# کلیدهای پرسونا — باید با گزینه‌های سؤال ۰ آنبوردینگ (locales) یکی بمانند
SYMBOL_PERSONAS = ("religious", "traditional", "psychological")

# ترتیب الفبای فارسی برای گرید حروف و مرتب‌سازی کلمات
FA_LETTERS = [
    "آ", "ا", "ب", "پ", "ت", "ث", "ج", "چ", "ح", "خ", "د", "ذ",
    "ر", "ز", "ژ", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف",
    "ق", "ک", "گ", "ل", "م", "ن", "و", "ه", "ی",
]

# ترتیب کامل برای مرتب‌سازی (شامل شکل‌های نوشتاری که در ابتدای کلمه نیستند)
_SORT_ALPHABET = FA_LETTERS + ["ء", "أ", "ؤ", "ئ", "ة", "ي", "ك"]
_ORDER = {ch: i for i, ch in enumerate(_SORT_ALPHABET)}


def _sort_key(word: str):
    return [(_ORDER.get(ch, 100 + ord(ch))) for ch in word]


def _build(lang: str, raw: list) -> dict:
    """ایندکس یک زبان: per حرف، لیستِ مرتبِ نمادها."""
    by_letter: dict[str, list] = {}
    seen: set[str] = set()
    for e in raw:
        word, letter = e.get("word", "").strip(), e.get("letter", "")
        if not word or letter not in FA_LETTERS or word in seen:
            if word in seen:
                log.warning("symbols[%s]: نماد تکراری نادیده گرفته شد: %s", lang, word)
            continue
        seen.add(word)
        by_letter.setdefault(letter, []).append(e)
    for letter in by_letter:
        by_letter[letter].sort(key=lambda e: _sort_key(e["word"]))
    return by_letter


_DATA: dict[str, dict] = {}

try:
    from symbols.fa import SYMBOLS as _FA_SYMBOLS
    _DATA["fa"] = _build("fa", _FA_SYMBOLS)
except ImportError as e:  # دیتا هنوز تولید نشده — نمادیاب فقط غیرفعال می‌ماند، بوت نمی‌شکند
    log.warning("symbols: دیتای fa لود نشد: %s", e)


# ===================== API عمومی =====================

def has_data(lang: str | None) -> bool:
    return bool(_DATA.get(lang or ""))


def letters(lang: str | None) -> list[str]:
    """همه‌ی حروف گرید (ثابت)؛ حرف بدون نماد پیام «خالی» می‌گیرد."""
    return FA_LETTERS if has_data(lang) else []


def letter_at(lang: str | None, li: int) -> str | None:
    ls = letters(lang)
    return ls[li] if 0 <= li < len(ls) else None


def words_for(lang: str | None, letter: str) -> list[dict]:
    return _DATA.get(lang or "", {}).get(letter, [])


def get(lang: str | None, li: int, wi: int) -> dict | None:
    letter = letter_at(lang, li)
    if letter is None:
        return None
    entries = words_for(lang, letter)
    return entries[wi] if 0 <= wi < len(entries) else None


def tafsir_for(entry: dict, persona: str | None) -> str:
    """متن تعبیر نماد برای پرسونای کاربر؛ با فالبک به اولین پرسونای پرشده."""
    t = entry.get("tafsir", {})
    if persona and t.get(persona):
        return t[persona]
    for p in SYMBOL_PERSONAS:
        if t.get(p):
            return t[p]
    return ""


def stats(lang: str | None) -> dict:
    """آمار برای گزارش/اعتبارسنجی: تعداد per حرف + کل."""
    data = _DATA.get(lang or "", {})
    per = {letter: len(v) for letter, v in data.items()}
    return {"total": sum(per.values()), "per_letter": per}


# ===================== جستجوی متنی =====================

import re as _re

_ZWNJ = "‌"
_HARAKAT = _re.compile(r"[ً-ْ]")   # اعراب عربی
_PARENS = _re.compile(r"\(.*?\)")            # پرانتزِ ابهام‌زدا: «مو (تاک)» → «مو»


def _norm(s: str) -> str:
    """نرمال‌سازی برای تطبیقِ جستجو (نه برای نمایش): یکسان‌سازی ی/ك عربی، حذف اعراب/نیم‌فاصله،
    یکدست‌کردن همزه‌ها و فاصله‌ها. آ/ا هم برای تطبیق یکی می‌شوند تا کاربر مجبور به تایپ دقیق نباشد."""
    s = (s or "").strip().replace(_ZWNJ, "").replace("‏", "").replace("‎", "")
    s = (s.replace("ي", "ی").replace("ك", "ک").replace("ة", "ه").replace("ؤ", "و")
           .replace("ئ", "ی").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا"))
    s = _HARAKAT.sub("", s)
    return _re.sub(r"\s+", " ", s).strip()


def _core(word: str) -> str:
    """نرمالِ کلمه بدون بخشِ داخل پرانتز (برای تطبیقِ «مو» با «مو (تاک)»)."""
    return _norm(_PARENS.sub("", word))


def search(lang: str | None, query: str, limit: int = 8) -> list[tuple]:
    """جستجوی نماد: لیست (li, wi, entry) مرتب بر پایه‌ی دقیق → پیشوندی → شامل. خالی = نبود نتیجه.
    li ایندکس حرف در FA_LETTERS و wi ایندکس کلمه در لیستِ مرتبِ همان حرف (سازگار با get/word_message)."""
    q = _norm(query)
    data = _DATA.get(lang or "", {})
    if not q or not data:
        return []
    exact, prefix, sub, seen = [], [], [], set()
    for letter, entries in data.items():
        li = FA_LETTERS.index(letter)
        for wi, e in enumerate(entries):
            w, c = _norm(e["word"]), _core(e["word"])
            key = (li, wi)
            if q in (w, c):
                exact.append((li, wi, e)); seen.add(key)
            elif w.startswith(q) or c.startswith(q):
                prefix.append((li, wi, e)); seen.add(key)
            elif q in w:
                sub.append((li, wi, e)); seen.add(key)
    return (exact + prefix + sub)[:limit]


def suggest(lang: str | None, query: str, limit: int = 3) -> list[tuple]:
    """پیشنهاد برای «نتیجه نداشت»: چند نمادِ اولِ حرفی که با نویسه‌ی اولِ کوئری می‌خواند."""
    q = _norm(query)
    data = _DATA.get(lang or "", {})
    if not q or not data:
        return []
    first = q[0]
    out = []
    for letter in FA_LETTERS:
        if _norm(letter) == first and data.get(letter):
            for wi, e in enumerate(data[letter][:limit]):
                out.append((FA_LETTERS.index(letter), wi, e))
            break
    return out[:limit]
