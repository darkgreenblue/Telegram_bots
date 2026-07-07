"""کلاینت ناهمگام Bot API — هم بله هم تلگرام.

هر دو API تقریباً یکسان‌اند؛ فقط base_url، توکن، و چند جزئیات فرق دارند.
با پارامتردهی به __init__ یک کلاینت برای هر پلتفرم می‌سازیم.
"""
import os
import json
import logging
import aiohttp

from config import (
    BALE_API_BASE, BALE_SSL_NO_VERIFY, BALE_PAYMENT_TOKEN,
    TELEGRAM_API_BASE, TELEGRAM_SSL_NO_VERIFY, TELEGRAM_PAYMENT_TOKEN,
    ASSETS_DIR,
)

log = logging.getLogger("bale")


class BaleError(Exception):
    pass


class Bale:
    """کلاینت Bot API برای بله یا تلگرام."""

    def __init__(
        self,
        token: str,
        api_base: str,
        platform: str,          # "bale" | "telegram"
        locale: str,            # زبانِ ثابتِ این ربات ("fa", "en", ...)
        ssl_no_verify: bool,
        payment_token: str,
        db_path: str,
    ):
        self._token = token
        self._api = f"{api_base}/bot{token}"
        self._file_base = f"{api_base}/file/bot{token}"
        self._ssl_no_verify = ssl_no_verify
        self.platform = platform          # public — استفاده در payments/handlers
        self.locale = locale              # زبانِ ثابت — انتخابگر زبان حذف شده
        self.tag = f"{platform}:{locale}" # برچسبِ لاگ/قفل (چند ربات تلگرامی داریم)
        self.payment_token = payment_token
        self.db_path = db_path
        self.bot_username: str = ""       # بعد از getMe پر می‌شود
        self._session: aiohttp.ClientSession | None = None

    # --- factory ---

    @classmethod
    def for_instance(cls, spec: dict) -> "Bale":
        """ساخت کلاینت از روی یک instance از config.bot_instances()."""
        if spec["platform"] == "bale":
            api_base, ssl_nv, pay = BALE_API_BASE, BALE_SSL_NO_VERIFY, BALE_PAYMENT_TOKEN
        else:
            api_base, ssl_nv, pay = TELEGRAM_API_BASE, TELEGRAM_SSL_NO_VERIFY, TELEGRAM_PAYMENT_TOKEN
        return cls(
            token=spec["token"],
            api_base=api_base,
            platform=spec["platform"],
            locale=spec["locale"],
            ssl_no_verify=ssl_nv,
            payment_token=pay,
            db_path=spec["db"],
        )

    # --- session ---

    def _new_session(self) -> aiohttp.ClientSession:
        connector = aiohttp.TCPConnector(ssl=not self._ssl_no_verify) if self._ssl_no_verify else None
        return aiohttp.ClientSession(connector=connector)

    async def __aenter__(self):
        self._session = self._new_session()
        return self

    async def __aexit__(self, *exc):
        if self._session:
            await self._session.close()

    @property
    def session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = self._new_session()
        return self._session

    # --- core call ---

    async def _call(self, method: str, payload: dict | None = None, timeout: int = 60):
        url = f"{self._api}/{method}"
        try:
            async with self.session.post(
                url, json=payload or {}, timeout=aiohttp.ClientTimeout(total=timeout)
            ) as resp:
                data = await resp.json()
        except aiohttp.ClientError as e:
            raise BaleError(f"network error on {method}: {e}") from e
        if not data.get("ok"):
            raise BaleError(f"{method} failed: {data}")
        return data.get("result")

    # --- اطلاعات ربات ---

    async def get_me(self):
        return await self._call("getMe", {})

    # --- لینک دعوت (platform-aware) ---

    def invite_link(self, user_id: int) -> str:
        if self.platform == "telegram":
            return f"https://t.me/{self.bot_username}?start=ref_{user_id}"
        return f"https://ble.ir/{self.bot_username}?start=ref_{user_id}"

    # --- آپدیت ---

    async def get_updates(self, offset: int | None = None, timeout: int = 30, limit: int = 100):
        payload = {"timeout": timeout, "limit": limit}
        if offset is not None:
            payload["offset"] = offset
        return await self._call("getUpdates", payload, timeout=timeout + 15)

    # --- ارسال ---

    async def send_message(self, chat_id, text, reply_markup=None, parse_mode="Markdown"):
        payload = {"chat_id": chat_id, "text": text}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return await self._call("sendMessage", payload)

    async def edit_message_text(self, chat_id, message_id, text, reply_markup=None,
                                parse_mode="Markdown"):
        payload = {"chat_id": chat_id, "message_id": message_id, "text": text}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return await self._call("editMessageText", payload)

    async def send_photo(self, chat_id, photo, caption=None, reply_markup=None, parse_mode="Markdown"):
        """photo می‌تواند URL/file_id (رشته) یا مسیر فایل محلی باشد.
        اگر مسیر فایل موجود بود → آپلود multipart."""
        if isinstance(photo, str) and os.path.exists(photo):
            return await self._send_photo_file(chat_id, photo, caption, reply_markup, parse_mode)
        payload = {"chat_id": chat_id, "photo": photo}
        if caption:
            payload["caption"] = caption
        if caption and parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return await self._call("sendPhoto", payload)

    async def _send_photo_file(self, chat_id, file_path, caption=None, reply_markup=None,
                               parse_mode="Markdown"):
        url = f"{self._api}/sendPhoto"
        data = aiohttp.FormData()
        data.add_field("chat_id", str(chat_id))
        if caption:
            data.add_field("caption", caption)
            if parse_mode:
                data.add_field("parse_mode", parse_mode)
        if reply_markup is not None:
            data.add_field("reply_markup", json.dumps(reply_markup, ensure_ascii=False))
        with open(file_path, "rb") as f:
            data.add_field("photo", f, filename=os.path.basename(file_path),
                           content_type="image/png")
            try:
                async with self.session.post(
                    url, data=data, timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    result = await resp.json()
            except aiohttp.ClientError as e:
                raise BaleError(f"network error on sendPhoto(file): {e}") from e
        if not result.get("ok"):
            raise BaleError(f"sendPhoto(file) failed: {result}")
        return result.get("result")

    # --- دارایی‌ها (مسکات) با کش file_id per-platform ---

    def _fileid_cache_path(self) -> str:
        # file_id در تلگرام مخصوصِ هر ربات است — با چند رباتِ تلگرامی، کش باید per-instance باشد
        return os.path.join(ASSETS_DIR, f"fileids_{self.platform}_{self.locale}.json")

    def _load_fileid_cache(self) -> dict:
        try:
            with open(self._fileid_cache_path(), "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_fileid_cache(self, cache: dict):
        try:
            with open(self._fileid_cache_path(), "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)
        except OSError as e:
            log.warning("could not write file_id cache: %s", e)

    @staticmethod
    def _extract_file_id(result: dict):
        photos = (result or {}).get("photo") or []
        if photos:
            return photos[-1].get("file_id")
        return None

    async def send_asset(self, chat_id, asset_filename, caption=None, reply_markup=None,
                         parse_mode="Markdown"):
        """ارسال مسکات: اول از کش file_id، وگرنه آپلود فایل محلی و کش‌کردن file_id.
        اگر فایل نبود None برمی‌گرداند (caller به متن fallback می‌کند)."""
        cache = self._load_fileid_cache()
        cached = cache.get(asset_filename)
        if cached:
            try:
                return await self.send_photo(chat_id, cached, caption, reply_markup, parse_mode)
            except BaleError as e:
                log.warning("cached file_id failed (%s), re-uploading: %s", asset_filename, e)

        path = os.path.join(ASSETS_DIR, asset_filename)
        if not os.path.exists(path):
            log.warning("asset missing: %s", path)
            return None

        result = await self._send_photo_file(chat_id, path, caption, reply_markup, parse_mode)
        fid = self._extract_file_id(result)
        if fid:
            cache[asset_filename] = fid
            self._save_fileid_cache(cache)
        return result

    async def answer_callback_query(self, callback_query_id, text=None, show_alert=False):
        payload = {"callback_query_id": callback_query_id, "show_alert": show_alert}
        if text:
            payload["text"] = text
        return await self._call("answerCallbackQuery", payload)

    # --- فایل ---

    async def get_file_path(self, file_id: str) -> str:
        result = await self._call("getFile", {"file_id": file_id})
        return result["file_path"]

    async def download_file(self, file_path: str, dest_path: str):
        url = f"{self._file_base}/{file_path}"
        async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=120)) as resp:
            if resp.status != 200:
                raise BaleError(f"download failed: HTTP {resp.status}")
            with open(dest_path, "wb") as f:
                async for chunk in resp.content.iter_chunked(8192):
                    f.write(chunk)
        return dest_path

    async def download_url(self, url: str, dest_path: str):
        """دانلودِ یک URLِ دلخواه (مثلِ عکسِ تولیدشده) به فایلِ محلی — برای آپلودِ مجدد
        وقتی پیام‌رسان نمی‌تواند خودش URL را بکشد."""
        async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=120)) as resp:
            if resp.status != 200:
                raise BaleError(f"download_url failed: HTTP {resp.status}")
            with open(dest_path, "wb") as f:
                async for chunk in resp.content.iter_chunked(8192):
                    f.write(chunk)
        return dest_path

    # --- پرداخت ---

    async def send_invoice(self, chat_id, title, description, payload, provider_token,
                           prices, currency="IRR", photo_url=None):
        body = {
            "chat_id": chat_id,
            "title": title,
            "description": description,
            "payload": payload,
            "provider_token": provider_token,
            "currency": currency,
            "prices": prices,
        }
        if photo_url:
            body["photo_url"] = photo_url
        return await self._call("sendInvoice", body)

    async def answer_pre_checkout_query(self, pre_checkout_query_id, ok=True, error_message=None):
        payload = {"pre_checkout_query_id": pre_checkout_query_id, "ok": ok}
        if error_message:
            payload["error_message"] = error_message
        return await self._call("answerPreCheckoutQuery", payload)


# ===================== سازنده‌های کیبورد =====================

def inline_keyboard(rows):
    return {"inline_keyboard": rows}


def reply_keyboard(rows, resize=True):
    keyboard = [[{"text": t} for t in row] for row in rows]
    return {"keyboard": keyboard, "resize_keyboard": resize}
