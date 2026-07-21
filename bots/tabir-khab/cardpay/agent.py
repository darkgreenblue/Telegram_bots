"""ایجنتِ تحلیلِ رسیدِ کارت‌به‌کارت با Gemini Flash (از طریق OpenRouter).

ورودی: عکسِ رسید (bytes) یا متنِ رسید + مشخصاتِ موردانتظار (مبلغ، نامِ گیرنده، ۴رقمِ آخرِ کارت).
خروجی: verdict ∈ {approve, reject, review} + دلیل + فیلدهای استخراج‌شده + نشانه‌های ریسک.

⚠️ رسید اثباتِ پرداخت نیست (قابل جعل) — این ایجنت فیلترِ تقلب/ریسک است، نه مرجعِ قطعی.
جزئیات و مسیرِ قطعیِ آینده (پارسِ پیامک): RESEARCH.md همین پکیج.

قرارداد داوری:
- approve → واضحاً رسیدِ موفقِ واقعی به‌نظر می‌رسد و مبلغِ پرداختی ≥ مبلغِ موردانتظار و
  (نامِ گیرنده یا ۴رقمِ آخرِ کارت با موردانتظار می‌خواند) و نشانه‌ی جعلِ قوی نیست.
- reject → اصلاً رسید نیست (متن/عکسِ نامربوط) یا مبلغ آشکارا کمتر از موردانتظار است.
- review → رسید هست ولی مبهم/ناقص/بی‌کیفیت است، یا نام/کارت نمی‌خواند ولی محتمل است،
  یا هر عدمِ‌قطعیت. (به ادمین ارجاع می‌شود.)

fail-safe: هر خطایی (شبکه/پارس/مدل) → review (هرگز auto approve/reject در خطا).
"""
import json
import base64
import logging

from openai import AsyncOpenAI

log = logging.getLogger("cardpay.agent")

VERDICTS = ("approve", "reject", "review")

_client: AsyncOpenAI | None = None


def _get_client(api_key: str, base_url: str) -> AsyncOpenAI:
    # کلاینتِ مستقل تا ماژول به ai.py پروژه‌ی میزبان وابسته نباشد (قابل حمل).
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=api_key or "missing", base_url=base_url)
    return _client


_SYSTEM_PROMPT = """You are a strict Iranian bank card-to-card (کارت به کارت) receipt verifier for a paid subscription bot.

You are given (a) a payment receipt — either an IMAGE (screenshot/photo of a bank app, ATM slip, USSD, or internet-banking receipt) or plain TEXT the user typed as their receipt — and (b) the EXPECTED payment details. Decide whether to APPROVE, REJECT, or send to human REVIEW.

Iranian receipts usually contain these fields (recognize them in Persian): مبلغ (amount, often in ریال = Toman×10), کد رهگیری/کد پیگیری (tracking code), شماره مرجع/RRN (reference number), تاریخ و ساعت (date/time), شماره کارت مقصد (destination card, masked, last 4 digits visible), وضعیت: موفق/تراکنش موفق (successful status), and sometimes نام گیرنده/صاحب حساب (recipient name) and شماره کارت مبدأ (source card).

EXPECTED:
- amount_toman: {amount_toman}   (equivalently amount_rial: {amount_rial}؛ receipts often show Rial = Toman × 10)
- recipient_name: {recipient}
- dest_card_last4: {dest_last4}

DECISION RULES (apply in order):
1. If the input is NOT a payment receipt at all (random text, unrelated photo, a sentence, a greeting) → verdict "reject", reason_code "not_a_receipt".
2. If it IS a receipt and you can read the amount, and the PAID amount is clearly LESS than the expected amount → verdict "reject", reason_code "amount_too_low".
3. If it IS a genuine-looking SUCCESSFUL receipt AND paid amount ≥ expected amount AND (recipient_name matches OR dest_card_last4 matches the expected) AND you see no strong forgery signal → verdict "approve", reason_code "ok".
4. Otherwise (receipt but: unreadable/low quality, amount ambiguous, missing key fields, status not clearly successful, recipient/last4 do not match but it is still plausibly a real receipt, or you are unsure for ANY reason) → verdict "review", reason_code one of: "low_quality", "missing_fields", "mismatch", "uncertain".

Notes:
- Paying MORE than expected is fine (still approve on amount).
- A round amount (exact multiple of 100,000) is a mild fraud signal but NOT reason alone to reject; note it in risk_flags.
- Be conservative: when in doubt, choose "review", never "approve".
- Amount comparison: normalize Rial/Toman correctly (1 Toman = 10 Rial).

Return ONLY a JSON object, no markdown, with EXACTLY these keys:
{{
  "verdict": "approve" | "reject" | "review",
  "reason_code": "ok" | "not_a_receipt" | "amount_too_low" | "low_quality" | "missing_fields" | "mismatch" | "uncertain",
  "reason_fa": "<one short Persian sentence explaining the verdict, no em dash>",
  "extracted": {{
    "amount_toman": <number or null>,
    "recipient_name": "<string or null>",
    "dest_card_last4": "<string or null>",
    "tracking_code": "<string or null>",
    "status_successful": <true|false|null>
  }},
  "risk_flags": ["<short tags: round_amount, name_mismatch, last4_mismatch, no_recipient, edited_look, ...>"]
}}"""


def _norm(data: dict) -> dict:
    """اعتبارسنجی و نرمال‌سازیِ خروجی؛ ورودیِ ناقص → review."""
    v = str(data.get("verdict", "")).strip().lower()
    if v not in VERDICTS:
        v = "review"
    ext = data.get("extracted") or {}
    if not isinstance(ext, dict):
        ext = {}
    flags = data.get("risk_flags") or []
    if not isinstance(flags, list):
        flags = []
    return {
        "verdict": v,
        "reason_code": str(data.get("reason_code", "uncertain")).strip() or "uncertain",
        "reason_fa": str(data.get("reason_fa", "")).strip(),
        "extracted": ext,
        "risk_flags": [str(f) for f in flags][:8],
    }


def _parse(raw: str) -> dict:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.lstrip("`")
        if s[:4].lower() == "json":
            s = s[4:]
    a, b = s.find("{"), s.rfind("}")
    if a != -1 and b != -1 and b > a:
        s = s[a:b + 1]
    return _norm(json.loads(s))


async def analyze_receipt(*, api_key: str, base_url: str, model: str,
                          expected: dict, image_bytes: bytes | None = None,
                          image_mime: str = "image/jpeg", text: str | None = None,
                          timeout: int = 60) -> dict:
    """داوریِ یک رسید. یکی از image_bytes یا text باید داده شود.

    expected: {"amount_toman": int, "amount_rial": int, "recipient": str, "dest_last4": str}
    خروجی: dict نرمال‌شده (verdict/reason_code/reason_fa/extracted/risk_flags).
    هر خطا → review (fail-safe)."""
    system = _SYSTEM_PROMPT.format(
        amount_toman=f"{expected.get('amount_toman', 0):,}",
        amount_rial=f"{expected.get('amount_rial', 0):,}",
        recipient=expected.get("recipient") or "(unknown)",
        dest_last4=expected.get("dest_last4") or "(unknown)",
    )
    if image_bytes:
        b64 = base64.b64encode(image_bytes).decode()
        user_content = [
            {"type": "text", "text": "این رسیدِ پرداخت را طبق قرارداد داوری کن و فقط JSON بده."},
            {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{b64}"}},
        ]
    else:
        body = (text or "").strip()[:4000]
        user_content = (
            "کاربر این متن را به‌عنوانِ رسیدِ پرداخت فرستاده. طبق قرارداد داوری کن و فقط JSON بده.\n\n"
            f"متنِ کاربر:\n{body}"
        )
    try:
        client = _get_client(api_key, base_url)
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            temperature=0,
            timeout=timeout,
        )
        raw = resp.choices[0].message.content or ""
        result = _parse(raw)
        log.info("[cardpay.agent] verdict=%s reason=%s flags=%s",
                 result["verdict"], result["reason_code"], result["risk_flags"])
        return result
    except Exception as e:
        # هرگز در خطا auto approve/reject نکن — به انسان بسپار.
        log.warning("[cardpay.agent] failed → review: %s", e)
        return _norm({"verdict": "review", "reason_code": "uncertain",
                      "reason_fa": "بررسیِ خودکارِ رسید ممکن نشد؛ به ادمین ارجاع شد.",
                      "risk_flags": ["agent_error"]})
