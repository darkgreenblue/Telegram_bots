"""تجمیع دیتای فارسی نمادیاب — فایل‌های g1..g8 (تقسیم per گروه حروف برای بازبینی آسان PR)."""
from symbols.fa import g1, g2, g3, g4, g5, g6, g7, g8

SYMBOLS = (
    g1.SYMBOLS + g2.SYMBOLS + g3.SYMBOLS + g4.SYMBOLS
    + g5.SYMBOLS + g6.SYMBOLS + g7.SYMBOLS + g8.SYMBOLS
)
