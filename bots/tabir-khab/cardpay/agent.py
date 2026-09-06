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

Iranian receipts usually contain these fields (recognize them in Persian): مبلغ (amount, almost always in ریال), کد رهگیری/کد پیگیری (tracking code), شماره مرجع/RRN (reference number), تاریخ و ساعت (date/time), شماره کارت مقصد (destination card, masked, last 4 digits visible), وضعیت: موفق/تراکنش موفق (successful status), and sometimes نام گیرنده/صاحب حساب (recipient name) and شماره کارت مبدأ (source card).

EXPECTED:
- amount_toman: {amount_toman}
- amount_rial: {amount_rial}   ← a CORRECT receipt shows THIS number (one more zero than the Toman figure)
- recipient_name: {recipient}
- dest_card_last4: {dest_last4}

CURRENCY RULE (the most important rule here, read it twice):
Iranian bank receipts print RIAL. The invoice we showed the user is in TOMAN. 1 Toman = 10 Rial.
**Never convert anything yourself.** Report only what is printed:
- extracted.amount_raw = the amount EXACTLY as printed on the receipt (plain digits, no separators, NO conversion)
- extracted.amount_currency = "rial" if the receipt shows ریال/IRR, "toman" if it shows تومان/تومن, null if no unit is printed or you cannot read it
The server does the Rial↔Toman arithmetic and re-checks your verdict. If you convert, you will be wrong.
The exact mistake to avoid: a receipt printed «۱۰۰,۰۰۰ ریال» is only 10,000 Toman. Correct output is amount_raw=100000 with amount_currency="rial". Calling it 100,000 Toman would approve a payment that is TEN TIMES too small.

DECISION RULES (apply in order). Compare paid vs expected in the SAME unit, using amount_rial when the receipt is in Rial:
1. If the input is NOT a payment receipt at all (random text, unrelated photo, a sentence, a greeting) → verdict "reject", reason_code "not_a_receipt".
2. If it IS a receipt and you can read the amount, and the PAID amount is STRICTLY LESS than the expected amount (paid < expected) → verdict "reject", reason_code "amount_too_low".
3. If it IS a genuine-looking SUCCESSFUL receipt AND paid amount is GREATER THAN OR EQUAL to expected (paid >= expected) AND (recipient_name matches OR dest_card_last4 matches the expected) AND you see no strong forgery signal → verdict "approve", reason_code "ok".
4. Otherwise (receipt but: unreadable/low quality, amount ambiguous, missing key fields, status not clearly successful, recipient/last4 do not match but it is still plausibly a real receipt, or you are unsure for ANY reason) → verdict "review", reason_code one of: "low_quality", "missing_fields", "mismatch", "uncertain".

CRITICAL AMOUNT RULE: paying MORE than expected is ALWAYS acceptable. When the paid amount is greater than or equal to the expected amount you must NEVER use "amount_too_low" and must NOT reject for the amount, EVER. "amount_too_low" is ONLY for paid < expected. Overpayment → approve (rule 3).

Notes:
- A round amount (exact multiple of 100,000) is a mild fraud signal but NOT reason alone to reject; note it in risk_flags.
- Be conservative: when in doubt, choose "review", never "approve".

Return ONLY a JSON object, no markdown, with EXACTLY these keys:
{{
  "verdict": "approve" | "reject" | "review",
  "reason_code": "ok" | "not_a_receipt" | "amount_too_low" | "low_quality" | "missing_fields" | "mismatch" | "uncertain",
  "reason_fa": "<one short Persian sentence explaining the verdict, no em dash>",
  "extracted": {{
    "amount_raw": <number or null>,
    "amount_currency": "rial" | "toman" | null,
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


_RIAL_WORDS = {"rial", "rials", "irr", "ریال"}
_TOMAN_WORDS = {"toman", "tomans", "tuman", "tumans", "irt", "تومان", "تومن"}


def resolve_paid_toman(ext: dict, expected_toman: float) -> tuple:
    """عددِ چاپ‌شده‌ی رسید → مبلغِ واقعی به **تومان**. خروجی: (raw, toman, basis).

    رسیدِ بانکیِ ایرانی **ریال** چاپ می‌کند ولی فاکتورِ ما **تومان** است، پس رسیدِ درست همیشه
    یک صفر بیشتر دارد. باگِ واقعی (۱۴۰۵/۰۵/۱۲ روی ربات زنده‌ی tarot): تبدیل به عهده‌ی خودِ
    مدل بود (`amount_toman`)، کاربری هر سه پرداختش را یک صفر کمتر زد، مدل عددِ چاپ‌شده را
    «تومان» گزارش کرد و ربات هر سه را تأیید کرد. تبدیلِ واحد یک عملِ حسابیِ قطعی است و هرگز
    نباید به مدلِ احتمالاتی سپرده شود.

    وقتی واحد چاپ نشده و عدد آن‌قدر بزرگ نیست که قطعاً ریال باشد → `ambiguous`، چون هر دو
    حدس خطرناک است: حدسِ «تومان» ما را سرِ ۹۰٪ پول می‌گذارد و حدسِ «ریال» اعتبارِ کاربرِ
    درست‌پرداخت‌کرده را یک‌دهم می‌کند.
    """
    raw = None
    for key in ("amount_raw", "amount_toman"):  # amount_toman = پاسخِ قدیمیِ مدل
        try:
            candidate = float(ext.get(key))
        except (TypeError, ValueError):
            continue
        if candidate > 0:
            raw = candidate
            break
    if raw is None:
        return (None, None, "none")
    cur = str(ext.get("amount_currency") or "").strip().lower()
    if cur in _RIAL_WORDS:
        return (raw, raw // 10, "rial")
    if cur in _TOMAN_WORDS:
        return (raw, raw, "toman")
    exp = float(expected_toman or 0)
    # واحد چاپ نشده ولی عدد ≥ ده‌برابرِ فاکتور است: در هر دو خوانش کافی است، پس بی‌خطر
    if exp > 0 and raw >= exp * 10:
        return (raw, raw // 10, "rial_inferred")
    return (raw, None, "ambiguous")


def decide_receipt(verdict: dict, expected_toman: float) -> dict:
    """خروجیِ خامِ ایجنت را به یک «تصمیمِ قطعی» تبدیل می‌کند و گاردِ مبلغ می‌زند.

    مبلغ را **کد** داوری می‌کند نه مدل، و در **هر دو جهت**: تأییدِ اشتباهِ مدل هم اصلاح
    می‌شود، نه فقط ردِ اشتباهش (همان چیزی که نبودنش باگِ ریال را ساخت). overpaid = مبلغِ
    پرداختی وقتی به‌قدرِ محسوس (≥۱۰٪) بیشتر است، تا میزبان به ادمین اطلاع دهد.
    خروجی: {action: approve|reject|review|not_a_receipt, reason_fa, reason_code, paid, overpaid, basis}
    """
    ext = verdict.get("extracted") or {}
    exp = float(expected_toman or 0)
    rc = verdict.get("reason_code", "") or ""
    reason_fa = verdict.get("reason_fa", "") or ""

    def out(action, **extra):
        base = {"action": action, "reason_fa": reason_fa, "reason_code": rc,
                "paid": None, "overpaid": 0, "basis": "none"}
        base.update(extra)
        return base

    # «اصلاً رسید نیست» ربطی به مبلغ ندارد، پس اول بررسی می‌شود
    if verdict.get("verdict") == "reject" and rc == "not_a_receipt":
        return out("not_a_receipt")

    raw, paid, basis = resolve_paid_toman(ext, exp)
    has_paid = paid is not None and paid > 0
    # واحدِ مبلغ مبهم است → هیچ تصمیمِ خودکاری (نه تأیید، نه رد)
    if basis == "ambiguous":
        return out("review", reason_code="amount_ambiguous", basis=basis)

    v = verdict.get("verdict")
    # مبلغِ ناخوانا = تصمیمِ انسانی — عیناً همان گاردِ دو کپیِ JS (هر سه هم‌قرارداد
    # می‌مانند). همه‌ی گاردهای مبلغ داخلِ `if has_paid and exp > 0` بودند، پس اگر مدل
    # «approve» می‌داد ولی هیچ عددی در نمی‌آورد، پرداخت با صفر راستی‌آزماییِ مبلغ
    # خودکار تأیید می‌شد. بند ۹ ریشه: گاردِ مبلغ باید هر دو جهت را ببیند — ردِ اشتباه
    # و تأییدِ اشتباه. مبلغِ ناخوانا از واحدِ مبهم هم کم‌اطلاع‌تر است.
    if v == "approve" and not has_paid and exp > 0:
        return out("review", reason_code="amount_unreadable", basis=basis)

    if has_paid and exp > 0:
        # مدل اشتباه رد کرده در حالی که پول کافی رسیده → تأیید
        if paid >= exp and v == "reject" and rc == "amount_too_low":
            v = "approve"
        # مدل اشتباه تأیید کرده در حالی که پول کافی نرسیده → رد (گاردِ باگِ ریال)
        if paid < exp and v == "approve":
            v = "reject"

    # اختلافی که دقیقاً امضای «اشتباهِ واحد» است: عددِ چاپ‌شده برابرِ خودِ فاکتور است.
    # یا کاربر مبلغِ تومانی را در اپِ ریالی زده، یا رسید واقعاً تومانی و پرداخت درست بوده.
    # این دو از روی عدد تفکیک‌پذیر نیستند → تصمیمِ انسانی.
    if has_paid and exp > 0 and paid < exp and raw == exp:
        return out("review", reason_code="amount_unit_suspect", paid=paid, basis=basis)

    overpaid = paid if (v == "approve" and has_paid and exp > 0 and paid >= exp * 1.1) else 0
    return out(v, paid=paid if has_paid else None, overpaid=overpaid, basis=basis)


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
