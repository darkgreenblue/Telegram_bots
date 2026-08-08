"""لایه‌ی هوش مصنوعی.

معماری مدل‌ها (V2.3 — OpenRouter):
  خواب صوتی:   google/gemini-2.5-flash (OpenRouter، یک ریکوئست: صوت → JSON)
               fallback: ffmpeg→mp3 + openai/gpt-4o-mini-transcribe (OpenRouter STT)
                         + deepseek/deepseek-chat (OpenRouter LLM)
  خواب متنی:   google/gemini-2.5-flash (OpenRouter، متن → JSON)
               fallback: deepseek/deepseek-chat (OpenRouter)
  تصویر:       gapgpt/z-image (GapGPT، URL مستقیم — دست نزن)
               fallback: غیرفعال (IMAGE_FALLBACK_MODEL خالی)

توابع عمومی:
  process_voice_dream()  — خواب صوتی (multimodal، یک ریکوئست) → {preview, depth, image_prompt}
  interpret_dream()      — خواب متنی → {preview, depth, image_prompt}
  generate_image()       — تولید تصویر از توصیفِ بصریِ خواب → {url, width, height, black_retries}
  teaser_of(preview)     — پیش‌نمایشِ دمو (preview + «…»)
  compose_full(preview, depth) — تعبیرِ کاملِ پیوسته‌ی پریمیوم
"""
import io
import os
import base64
import json
import asyncio
import logging
import tempfile
import time

import aiohttp
from openai import AsyncOpenAI

from config import (
    GAPGPT_API_KEY, GAPGPT_BASE_URL,
    OPENROUTER_API_KEY, OPENROUTER_BASE_URL,
    STT_FALLBACK_MODEL, LLM_FALLBACK_MODEL,
    IMAGE_MODEL, IMAGE_SIZE, IMAGE_BLACK_MAX_LUMA,
    IMAGE_ART_DIRECTION, IMAGE_SAFE_RETRY_NOTE,
    IMAGE_TIMEOUT, IMAGE_REQUEST_TIMEOUT, IMAGE_PROBE_TIMEOUT,
    PRIMARY_FORMAT_ATTEMPTS, FORCE_FALLBACK_FOR_TEST,
    llm_model_for,
)
from prompts import build_system_prompt, build_user_prompt

log = logging.getLogger("ai")

REQUIRED_KEYS = ("preview", "depth", "image_prompt")

# ---- کلاینت GapGPT — فقط برای تولید تصویر (gapgpt/z-image) ----
_gap_client: AsyncOpenAI | None = None


def _get_gap_client() -> AsyncOpenAI:
    global _gap_client
    if _gap_client is None:
        # timeout/max_retries صریح: پیش‌فرضِ SDK (۶۰۰ ثانیه با ۲ ریتری) یعنی یک هنگِ
        # سرویسِ تصویر تا سقفِ بیرونی طول می‌کشد و کاربر را پشتِ «صبر کن» نگه می‌دارد.
        _gap_client = AsyncOpenAI(
            api_key=GAPGPT_API_KEY or "missing",
            base_url=GAPGPT_BASE_URL,
            timeout=IMAGE_REQUEST_TIMEOUT,
            max_retries=0,
        )
    return _gap_client


# ---- کلاینت OpenRouter — همه‌ی LLM ----
_or_client: AsyncOpenAI | None = None


def _get_or_client() -> AsyncOpenAI:
    global _or_client
    if _or_client is None:
        _or_client = AsyncOpenAI(
            api_key=OPENROUTER_API_KEY or "missing",
            base_url=OPENROUTER_BASE_URL,
        )
    return _or_client


class AIError(Exception):
    pass


class FormatError(AIError):
    """خروجی مدل «خارج از قالب» است (JSON نامعتبر یا کلیدهای لازم ناقص).
    این خطا باعث می‌شود همان مدل اصلی دوباره امتحان شود (نه فالبک)."""
    pass


# ===================== ابزارهای مشترک =====================

_MIME_MAP = {
    "ogg":  "audio/ogg",
    "mp3":  "audio/mpeg",
    "wav":  "audio/wav",
    "m4a":  "audio/mp4",
    "webm": "audio/webm",
    "flac": "audio/flac",
    "aac":  "audio/aac",
}


def _extract_json(raw: str) -> dict:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.lstrip("`")
        if s[:4].lower() == "json":
            s = s[4:]
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        s = s[start:end + 1]
    return json.loads(s)


def _validate(data: dict) -> dict:
    if not all(k in data and str(data[k]).strip() for k in REQUIRED_KEYS):
        raise ValueError(f"missing keys in JSON: {list(data.keys())}")
    return {k: str(data[k]).strip() for k in REQUIRED_KEYS}


def _unescape_json_str(s: str) -> str:
    """باز کردن escapeهای رایجِ JSON در یک رشته‌ی نجات‌یافته."""
    return (s.replace('\\n', '\n').replace('\\t', '\t')
             .replace('\\"', '"').replace('\\/', '/'))


def _lenient_fields(raw: str, keys: tuple) -> dict | None:
    """نجاتِ مقاومِ چند فیلد وقتی JSON معتبر نیست (کوتیشن/نیولاینِ escape‌نشده داخل متن).
    به‌جای quote-balancing، روی کلیدهای شناخته‌شده لنگر می‌اندازد: مقدارِ هر کلید =
    بینِ اولین و آخرین `"` در بازه‌ی تا کلیدِ بعدی. در برابر کوتیشن‌های داخلیِ خام مقاوم است."""
    s = raw or ""
    positions = []
    for k in keys:
        i = s.find(f'"{k}"')
        if i == -1:
            return None
        positions.append((i, k))
    positions.sort()

    out = {}
    for idx, (pos, k) in enumerate(positions):
        start = pos + len(f'"{k}"')
        end = positions[idx + 1][0] if idx + 1 < len(positions) else len(s)
        seg = s[start:end]
        a = seg.find('"')
        b = seg.rfind('"')
        if a == -1 or b <= a:
            return None
        out[k] = _unescape_json_str(seg[a + 1:b])
    return out


def _parse_and_validate(raw: str) -> dict:
    """خروجی خام مدل → dict معتبر. اول JSON سخت‌گیرانه؛ اگر شکست خورد، نجاتِ مقاومِ
    فیلدها. اگر هر دو شکست خورد → FormatError (تا retry/fallback اتفاق بیفتد)."""
    data = None
    try:
        data = _extract_json(raw)
    except Exception:
        data = _lenient_fields(raw, REQUIRED_KEYS)  # نجات از escapeِ خراب
        if data is None:
            raise FormatError(f"output is not valid JSON (len={len(raw or '')})")
    try:
        return _validate(data)
    except Exception as e:
        raise FormatError(f"output JSON out of schema: {e}") from e


async def _primary_with_format_retry(factory, label: str) -> dict:
    """مدل اصلی را اجرا می‌کند؛ اگر خروجی «خارج از قالب» بود (FormatError) همان مدل را
    تا PRIMARY_FORMAT_ATTEMPTS بار دوباره صدا می‌زند. سایر خطاها (شبکه/API) بلافاصله
    بالا می‌روند تا لایه‌ی بالاتر سراغ فالبک برود. `factory` هر بار یک awaitable تازه می‌سازد."""
    last: Exception | None = None
    for attempt in range(1, PRIMARY_FORMAT_ATTEMPTS + 1):
        try:
            return await factory()
        except FormatError as e:
            last = e
            log.warning("[%s] خروجی خارج از قالب — تلاش %d/%d: %s",
                        label, attempt, PRIMARY_FORMAT_ATTEMPTS, e)
            continue
    raise last  # همه‌ی تلاش‌های قالبیِ مدل اصلی ناموفق → فالبک


def _ensure_ellipsis(s: str) -> str:
    s = s.rstrip()
    while s and s[-1] in ".،,:;؛ ":
        s = s[:-1].rstrip()
    if not s.endswith("…"):
        s += "…"
    return s


def teaser_of(preview: str) -> str:
    """پیش‌نمایشِ دمو = preview + «…» (روی مرزِ جمله، بدونِ نقطه‌گذاریِ اضافه)."""
    return _ensure_ellipsis(preview or "")


def compose_full(preview: str, depth: str) -> str:
    """تعبیرِ کاملِ پریمیوم = preview (بدونِ «…»ِ انتهایی) + depth، یک متنِ پیوسته."""
    p = (preview or "").rstrip()
    while p and p[-1] in "….،,:;؛ ":
        p = p[:-1].rstrip()
    d = (depth or "").strip()
    if p and d:
        return p + "\n\n" + d
    return p or d


# ===================== STT fallback (فقط در زنجیره‌ی fallback عمیق) =====================

async def audio_duration(path: str) -> float | None:
    """مدتِ یک فایلِ صوتی به ثانیه با ffprobe — دقیق و مستقل از فرمت/حجم.
    برای هر فرمتی (ویسِ تلگرام، m4aِ آیفون، واتساپ، mp3، wav...) کار می‌کند.
    None اگر ffprobe نبود یا فایل قابلِ‌خواندن نبود (آن‌وقت caller محدودیت را اعمال نمی‌کند)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        if proc.returncode == 0:
            return float((out or b"").decode().strip())
    except FileNotFoundError:
        log.warning("ffprobe not installed — skipping precise duration check")
    except (ValueError, OSError) as e:
        log.warning("ffprobe duration failed: %s", e)
    return None


async def _to_mp3(audio_path: str) -> tuple[str, bool]:
    """تبدیلِ فایلِ صوتی به mp3 با ffmpeg.
    gpt-4o-mini-transcribe فایلِ OGG/Opusِ تلگرام را اغلب رد می‌کند (مشکلِ هدرِ کدک)؛
    پیش از رونویسی به mp3 تبدیل می‌کنیم. اگر از قبل mp3 بود، دست‌نخورده برمی‌گردد.
    خروجی: (مسیرِ فایل، آیا فایلِ موقتِ تازه ساخته شد که باید حذف شود).
    اگر ffmpeg نبود یا تبدیل شکست خورد، فایلِ اصلی برگردانده می‌شود (best-effort)."""
    if os.path.splitext(audio_path)[1].lower() == ".mp3":
        return audio_path, False
    fd, out_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", audio_path, "-vn", "-acodec", "libmp3lame",
            "-ar", "16000", "-ac", "1", out_path,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode == 0 and os.path.getsize(out_path) > 0:
            return out_path, True
        log.warning("ffmpeg → mp3 failed (rc=%s): %s — using original file",
                    proc.returncode, (stderr or b"").decode(errors="ignore")[-300:])
    except FileNotFoundError:
        log.warning("ffmpeg not installed — sending original audio to STT (may fail)")
    except Exception as e:
        log.warning("ffmpeg conversion error: %s — using original file", e)
    if os.path.exists(out_path):
        try:
            os.remove(out_path)
        except OSError:
            pass
    return audio_path, False


async def _stt_fallback(audio_path: str) -> str:
    """تبدیل صوت به متن با gpt-4o-mini-transcribe روی OpenRouter — فقط وقتی LLM روی صوت
    خطا داد. کارش فقط رونویسیِ عینِ صوت است. فایل ابتدا به mp3 تبدیل می‌شود (الزامِ مدل).

    OpenRouter این مدل را روی endpoint استاندارد audio/transcriptions پشتیبانی می‌کند،
    اما به‌جای multipart/form-data (که SDK پیش‌فرض می‌فرستد)، JSON با base64 می‌خواهد.
    بنابراین مستقیم با aiohttp درخواست می‌زنیم."""
    mp3_path, made_tmp = await _to_mp3(audio_path)
    try:
        with open(mp3_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()
        filename = os.path.basename(mp3_path)
        connector = aiohttp.TCPConnector(ssl=False)
        ext = os.path.splitext(mp3_path)[1].lstrip(".").lower() or "mp3"
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.post(
                f"{OPENROUTER_BASE_URL}/audio/transcriptions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": STT_FALLBACK_MODEL,
                    "input_audio": {
                        "data": audio_b64,
                        "format": ext,
                    },
                },
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                data = await resp.json()
                if resp.status != 200:
                    raise AIError(
                        f"STT fallback ({STT_FALLBACK_MODEL}) HTTP {resp.status}: {data}"
                    )
                return (data.get("text") or "").strip()
    except AIError:
        raise
    except Exception as e:
        raise AIError(f"STT fallback ({STT_FALLBACK_MODEL}) failed: {e}") from e
    finally:
        if made_tmp and os.path.exists(mp3_path):
            try:
                os.remove(mp3_path)
            except OSError:
                pass


# ===================== تعبیر متنی — OpenRouter =====================

async def _interpret_text_once(transcript: str, lang: str, persona: str, profile: dict, model: str) -> dict:
    resp = await _get_or_client().chat.completions.create(
        model=model,
        # response_format حذف شد: gemini-2.5-flash روی OpenRouter با json_object پاسخ ناقص می‌دهد.
        # prompt به‌وضوح JSON می‌خواهد؛ _extract_json کدبلاک‌های احتمالی را پاکسازی می‌کند.
        messages=[
            {"role": "system", "content": build_system_prompt(lang, persona, profile)},
            {"role": "user",   "content": build_user_prompt(transcript)},
        ],
    )
    return _parse_and_validate(resp.choices[0].message.content)


# ===================== تعبیر صوتی مستقیم — OpenRouter (gemini multimodal) =====================

async def _interpret_audio_once(audio_path: str, lang: str, persona: str, profile: dict, model: str) -> dict:
    """صوت → JSON  در یک ریکوئست (بدون STT جداگانه).
    فرمت: data URI در image_url — همان روشی که روی OpenRouter تست شده."""
    ext = os.path.splitext(audio_path)[1].lstrip(".").lower() or "ogg"
    mime = _MIME_MAP.get(ext, f"audio/{ext}")
    with open(audio_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode()

    resp = await _get_or_client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": build_system_prompt(lang, persona, profile)},
            {"role": "user", "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{audio_b64}"}
                },
                {
                    "type": "text",
                    "text": "Listen carefully to the dream in the audio, then produce exactly the requested JSON."
                }
            ]},
        ],
    )
    return _parse_and_validate(resp.choices[0].message.content)


# ===================== API عمومی — تعبیر =====================

async def process_voice_dream(audio_path: str, lang: str, persona: str, profile: dict,
                               tier: str = "paid") -> dict:
    """Pipeline خواب صوتی:
      primary  → google/gemini-2.5-flash (OpenRouter) با ورودی audio
      fallback → whisper (OpenRouter STT) + deepseek (OpenRouter LLM)
    اگر هر دو خطا بدهند، AIError پرتاب می‌شود (pending_state مدیریت می‌کند)."""
    primary = llm_model_for(tier)  # google/gemini-2.5-flash
    profile = profile or {}
    # تستِ موقت: مدلِ اصلی را رد کن و مستقیم برو سراغ مسیرِ فالبک.
    if not FORCE_FALLBACK_FOR_TEST:
        try:
            return await _primary_with_format_retry(
                lambda: _interpret_audio_once(audio_path, lang, persona, profile, primary),
                label=f"audio:{primary}",
            )
        except Exception as e:
            log.warning("primary audio LLM (%s) failed: %s — trying fallback %s",
                        primary, e, LLM_FALLBACK_MODEL)

    # fallback: gpt-4o-mini-transcribe (OpenRouter STT) → transcript → deepseek (OpenRouter LLM)
    transcript = await _stt_fallback(audio_path)  # AIError اگر این هم بزند
    try:
        return await _interpret_text_once(transcript, lang, persona, profile, LLM_FALLBACK_MODEL)
    except Exception as e2:
        raise AIError(
            f"audio fallback ({STT_FALLBACK_MODEL} + {LLM_FALLBACK_MODEL}) failed: {e2}"
        ) from e2


async def interpret_dream(transcript: str, lang: str, persona: str, profile: dict | None = None,
                          tier: str = "paid") -> dict:
    """تعبیر خواب متنی:
      primary  → google/gemini-2.5-flash (OpenRouter)
      fallback → deepseek (OpenRouter)"""
    primary = llm_model_for(tier)
    profile = profile or {}
    # تستِ موقت: مدلِ اصلی را رد کن و مستقیم با deepseek (فالبک) تعبیر کن.
    if not FORCE_FALLBACK_FOR_TEST:
        try:
            return await _primary_with_format_retry(
                lambda: _interpret_text_once(transcript, lang, persona, profile, primary),
                label=f"text:{primary}",
            )
        except Exception as e:
            log.warning("primary text LLM (%s) failed: %s — fallback %s", primary, e, LLM_FALLBACK_MODEL)
    try:
        return await _interpret_text_once(transcript, lang, persona, profile, LLM_FALLBACK_MODEL)
    except Exception as e2:
        raise AIError(f"interpretation failed: {e2}") from e2


# ===================== تولید تصویر =====================


async def _request_image(prompt: str, budget: float) -> str:
    """یک ریکوئستِ تصویر به مدلِ اصلی (gapgpt/z-image) — URL مستقیم برمی‌گرداند.
    `budget` سقفِ ثانیه‌ایِ همین ریکوئست است (باقیمانده‌ی بودجه‌ی کلِ مرحله)."""
    t0 = time.monotonic()
    try:
        resp = await asyncio.wait_for(
            _get_gap_client().images.generate(
                model=IMAGE_MODEL, prompt=prompt, size=IMAGE_SIZE, n=1
            ),
            timeout=max(1.0, budget),
        )
    except asyncio.TimeoutError:
        raise AIError(
            f"image request ({IMAGE_MODEL}) timed out after {time.monotonic() - t0:.1f}s"
        ) from None
    log.info("image request ✓ %.1fs", time.monotonic() - t0)
    url = getattr(resp.data[0], "url", None)
    if not url:
        raise AIError(f"model {IMAGE_MODEL} returned no URL")
    return url


async def _probe_image(url: str, budget: float | None = None) -> dict | None:
    """دانلودِ تصویر و استخراجِ {width, height, is_black}.
    در هر خطایی None برمی‌گرداند تا هرگز مسیرِ تحویل را مسدود نکند (best-effort).
    is_black تنها بررسیِ هاردکدِ تصویر است: مدل گاهی فریمِ کاملاً سیاه برمی‌گرداند.

    این مرحله صرفاً «متادیتا» است، پس بودجه‌ی کوتاهی می‌گیرد: اگر میزبانِ تصویر کند بود،
    عکس همان‌طور تحویل می‌شود و فقط ابعاد/چکِ سیاهی از دست می‌رود."""
    cap = IMAGE_PROBE_TIMEOUT if budget is None else min(IMAGE_PROBE_TIMEOUT, budget)
    if cap <= 0:
        return None
    t0 = time.monotonic()
    try:
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=cap)) as resp:
                if resp.status != 200:
                    return None
                data = await resp.read()
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        w, h = img.size
        _lo, hi = img.convert("L").getextrema()  # روشن‌ترین پیکسل
        log.info("image probe ✓ %.1fs (%sx%s)", time.monotonic() - t0, w, h)
        return {"width": w, "height": h, "is_black": hi <= IMAGE_BLACK_MAX_LUMA}
    except Exception as e:
        log.warning("image probe failed after %.1fs (ignored): %s",
                    time.monotonic() - t0, e or type(e).__name__)
        return None


async def generate_image(description: str) -> dict:
    """تولید تصویر از روی «توصیفِ بصریِ خوابِ» مدلِ زبانی.

    توصیف داخلِ قاب‌بندیِ هنریِ کد (IMAGE_ART_DIRECTION) تزریق می‌شود؛ سبک/سایز/جذابیت
    این‌جا اضافه می‌شود، نه در خروجیِ مدلِ زبانی. تنها بررسیِ هاردکد: تصویرِ کاملاً سیاه →
    یک ریکوئستِ دومِ دیگر به همان مدلِ اصلی با تأکید بر حذفِ موارد حساس (نه فالبک).
    ابعاد فقط ثبت می‌شود (بدون ری‌تلاش بابتِ ابعاد).

    برمی‌گرداند: {url, width, height, black_retries}
    """
    prompt = IMAGE_ART_DIRECTION.format(description=description)
    # بودجه‌ی کلِ مرحله بین زیرمرحله‌ها تقسیم می‌شود تا هیچ‌کدام بقیه را قربانی نکند؛
    # کاربر پشتِ تصویر (که تزئینِ تعبیر است) بیش از این منتظر نمی‌ماند.
    deadline = time.monotonic() + IMAGE_TIMEOUT

    def _left() -> float:
        return deadline - time.monotonic()

    try:
        url = await _request_image(prompt, min(IMAGE_REQUEST_TIMEOUT, _left()))
    except AIError:
        raise
    except Exception as e:
        raise AIError(f"image generation ({IMAGE_MODEL}) failed: {e}") from e

    meta = await _probe_image(url, _left())
    black_retries = 0

    # تصویرِ سیاه → یک تلاشِ دوباره به همان مدلِ اصلی، با یادداشتِ «بی‌خطرسازی».
    # فقط اگر بودجه واقعاً باقی مانده باشد؛ وگرنه همان تصویرِ اول تحویل می‌شود
    # (تصویرِ سیاه از دو دقیقه انتظار بهتر است).
    if meta and meta.get("is_black"):
        if _left() < 5:
            log.warning("image came back fully black — no time budget left for retry")
        else:
            black_retries = 1
            log.warning("image came back fully black — retrying same model with safe-render note")
            try:
                url2 = await _request_image(prompt + "\n\n" + IMAGE_SAFE_RETRY_NOTE,
                                            min(IMAGE_REQUEST_TIMEOUT, _left()))
                meta2 = await _probe_image(url2, _left())
                url, meta = url2, (meta2 or meta)
            except Exception as e:
                log.warning("black-image retry failed (keeping first image): %s", e)

    return {
        "url": url,
        "width": (meta or {}).get("width"),
        "height": (meta or {}).get("height"),
        "black_retries": black_retries,
    }
