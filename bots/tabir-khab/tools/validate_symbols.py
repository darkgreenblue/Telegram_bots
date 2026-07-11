"""اعتبارسنجی یک‌باره‌ی دیتای نمادیاب خواب (بعد از هر تغییر symbols/ اجرا شود).

اجرا از پوشه‌ی ربات:  python3 tools/validate_symbols.py

چک‌ها:
- ساختار هر نماد (word/letter/tafsir با هر سه پرسونا، همه پر)
- نبود word تکراری، حرف نامعتبر، یا ناسازگاری حرف اول کلمه با فیلد letter
- نبود «—» و «--» (قانون کپی انسانی ریپو) و کاراکترهای Markdown-شکن (* _ [ ] `)
- طول معقول هر تعبیر (۸۰ تا ۶۰۰ کاراکتر) و طول کلمه (≤ ۲۰)
خروجی: آمار per حرف + لیست خطاها؛ exit code 1 اگر خطایی بود.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import symbols as SYM  # noqa: E402
from symbols import FA_LETTERS, SYMBOL_PERSONAS  # noqa: E402

BAD_STRINGS = ["—", "--"]
MD_BREAKERS = ["*", "_", "[", "]", "`"]
MIN_TAFSIR, MAX_TAFSIR = 80, 600
MAX_WORD = 20


def check_lang(lang: str) -> list[str]:
    errors: list[str] = []
    from symbols.fa import SYMBOLS as raw  # فعلاً فقط فارسی

    seen: set[str] = set()
    for i, e in enumerate(raw):
        where = f"[{i}] {e.get('word', '?')}"
        word, letter = e.get("word", ""), e.get("letter", "")
        if not word or len(word) > MAX_WORD:
            errors.append(f"{where}: word خالی یا بلندتر از {MAX_WORD}")
        if letter not in FA_LETTERS:
            errors.append(f"{where}: حرف نامعتبر «{letter}»")
        elif word and not word.startswith(letter):
            # «آ» و «ا» را جدا می‌گیریم؛ کلمه باید دقیقاً با حرف اعلام‌شده شروع شود
            errors.append(f"{where}: کلمه با حرف «{letter}» شروع نمی‌شود")
        if word in seen:
            errors.append(f"{where}: word تکراری")
        seen.add(word)

        t = e.get("tafsir", {})
        for p in SYMBOL_PERSONAS:
            body = t.get(p, "")
            if not body:
                errors.append(f"{where}: tafsir[{p}] خالی")
                continue
            if not (MIN_TAFSIR <= len(body) <= MAX_TAFSIR):
                errors.append(f"{where}: tafsir[{p}] طول {len(body)} خارج از [{MIN_TAFSIR},{MAX_TAFSIR}]")
            for bad in BAD_STRINGS:
                if bad in body:
                    errors.append(f"{where}: tafsir[{p}] شامل «{bad}» (ممنوع)")
            for ch in MD_BREAKERS:
                if ch in body or ch in word:
                    errors.append(f"{where}: کاراکتر Markdown-شکن «{ch}»")
                    break
    return errors


def main() -> int:
    errors = check_lang("fa")
    st = SYM.stats("fa")
    print(f"کل نمادها: {st['total']}")
    for letter in FA_LETTERS:
        n = st["per_letter"].get(letter, 0)
        flag = "" if n else "  ⚠️ خالی"
        print(f"  {letter}: {n}{flag}")
    if errors:
        print(f"\n❌ {len(errors)} خطا:")
        for e in errors[:80]:
            print("  -", e)
        return 1
    print("\n✅ همه‌ی چک‌ها پاس شد.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
