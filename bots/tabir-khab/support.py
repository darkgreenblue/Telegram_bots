"""پشتیبانی — پورتِ هم‌قراردادِ shared/support.js برای ربات پایتونیِ تعبیر خواب.

چرا کپی: tabir-khab استثنای مونوریپوست (پایتون/systemd) و نمی‌تواند ماژول ESM را import کند.
قرارداد (نامِ حساب، فرمتِ کد، ساختارِ لینک) باید عیناً با shared/support.js یکی بماند؛
CI با ``tools/check-support-sync.mjs`` این سینک را قفل کرده است.

قابلیتِ تلگرام (core.telegram.org/api/links → Public username links):
    https://t.me/<username>?text=<urlencoded>
متن را به‌عنوان draft در کادرِ تایپِ چتِ همان حساب می‌گذارد (خودکار ارسال نمی‌شود) و برای
حسابِ کاربریِ عمومی هم کار می‌کند، نه فقط ربات. کد همیشه خطِ اول و ASCII است تا اگر روی
کلاینتی prefill خراب شد، باز هم قابل خواندن بماند (در پیامِ خودِ ربات هم چاپ می‌شود).
"""
from urllib.parse import quote

SUPPORT_CONTRACT_VERSION = 1

# ── حسابِ پشتیبانی (تنها جایی که باید عوض شود؛ هم‌زمان با shared/support.js) ──
# kind: "account" = حسابِ انسانی | "bot" = ربات پشتیبانی (آینده؛ لینک به ?start= سوییچ می‌کند)
# enabled=False → دکمه از کیبورد محو و اکشن غیرفعال می‌شود (رول‌بکِ یک‌خطی).
SUPPORT_ENABLED = True
SUPPORT_KIND = "account"
SUPPORT_USERNAME = "Efficient_Support"
SUPPORT_ID = 8914152957
SUPPORT_CONTACT = f"@{SUPPORT_USERNAME}"

# کدِ این ربات در کدِ پیگیری (BOT_CODES در shared/support.js): #DRM-<user_id>
SUPPORT_BOT_CODE = "DRM"


def support_code(uid: int) -> str:
    return f"#{SUPPORT_BOT_CODE}-{uid}"


def support_draft(lang_texts: dict, uid: int) -> str:
    """متنی که در کادرِ تایپِ کاربر آماده می‌شود: کد در خطِ اول، بعد راهنمای «کد را پاک نکن»."""
    return f"{support_code(uid)}\n\n{lang_texts['draft_note']}\n"


def support_link(lang_texts: dict, uid: int) -> str:
    base = f"https://t.me/{SUPPORT_USERNAME}"
    if SUPPORT_KIND == "bot":
        return f"{base}?start={quote(support_code(uid).lstrip('#'), safe='')}"
    return f"{base}?text={quote(support_draft(lang_texts, uid), safe='')}"


def support_message(lang_texts: dict, uid: int):
    """(text, inline_rows) آماده‌ی ارسال. inline_rows فرمتِ استانداردِ همین ربات است."""
    text = lang_texts["body"].format(code=support_code(uid))
    rows = [[{"text": lang_texts["open_btn"], "url": support_link(lang_texts, uid)}]]
    return text, rows
