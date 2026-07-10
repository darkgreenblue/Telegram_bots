"""پرداخت platform-aware + اشتراک + رفرال روزمحور.

بله  → sendInvoice بومی (کیف‌پول بله)
تلگرام → زرین‌پال (stub فعلاً؛ معماری آماده)
آینده  → تلگرام Stars (currency="XTR")
"""
import uuid
import logging

import analytics
import db
import locales
import texts as C
from config import SUBSCRIPTIONS, REFERRAL_REWARD_DAYS, REFERRAL_ENABLED, fmt_toman

log = logging.getLogger("payments")


# ===================== ارسال فاکتور اشتراک =====================

async def send_subscription_invoice(bot, chat_id: int, user_id: int, tier: str):
    sub = SUBSCRIPTIONS[tier]
    payload = f"sub_{tier}_{uuid.uuid4().hex}"
    await db.create_transaction(
        user_id=user_id, tier=tier, duration_days=sub["days"],
        amount_rial=sub["rial"], invoice_payload=payload,
    )
    if bot.platform == "telegram":
        await _send_zarinpal_stub(bot, chat_id, sub, payload)
    else:
        await _send_bale_invoice(bot, chat_id, sub, payload)


async def simulate_purchase(bot, chat_id: int, user_id: int, tier: str):
    """رد کردن پرداخت برای تست (SKIP_PAYMENT): بلافاصله همسفری را فعال می‌کند."""
    sub = SUBSCRIPTIONS[tier]
    payload = f"sub_{tier}_{uuid.uuid4().hex}"
    await db.create_transaction(
        user_id=user_id, tier=tier, duration_days=sub["days"],
        amount_rial=sub["rial"], invoice_payload=payload,
    )
    await apply_successful_payment(bot, user_id, payload, charge_id="SKIP")


async def _send_bale_invoice(bot, chat_id: int, sub: dict, payload: str):
    title = f"اشتراک {sub['title']}"
    description = f"اشتراک {sub['title']} قلمرو رویاها — {fmt_toman(sub['toman'])} تومان"
    prices = [{"label": title, "amount": sub["rial"]}]
    await bot.send_invoice(
        chat_id=chat_id, title=title, description=description, payload=payload,
        provider_token=bot.payment_token, prices=prices, currency="IRR",
    )


async def _send_zarinpal_stub(bot, chat_id: int, sub: dict, payload: str):
    """
    Stub زرین‌پال تلگرام. برای واقعی‌کردن:
    1. authority از api.zarinpal.com/pg/v4/payment/request.json
    2. لینک: https://www.zarinpal.com/pg/StartPay/{authority}
    3. وب‌هوک تأیید → apply_successful_payment(bot, user_id, payload, charge_id)
    آینده — تلگرام Stars: send_invoice(currency="XTR", provider_token="", prices=[{label, amount:N}])
    """
    text = (
        f"💳 *اشتراک {sub['title']}* — {fmt_toman(sub['toman'])} تومان\n\n"
        + C.zarinpal_stub("fa") + "\n\n"
        f"`payload: {payload}`"
    )
    await bot.send_message(chat_id, text)


# ===================== پردازش پرداخت موفق =====================

async def apply_successful_payment(bot, user_id: int, payload: str, charge_id: str = ""):
    """اشتراک را فعال می‌کند، رفرال را پاداش می‌دهد، و تعبیر کامل تریال را خودکار می‌فرستد. idempotent."""
    first_time_event = await db.mark_transaction_paid(payload, charge_id)
    if not first_time_event:
        log.info("payment %s already processed — skipping", payload)
        return

    txn = await db.get_transaction_by_payload(payload)
    if not txn:
        log.warning("no transaction for payload %s", payload)
        return

    tier = txn["tier"]
    days = txn["duration_days"]
    # آنالیتیکس مونوریپو: charge_id های SKIP/SIMULATED یعنی پرداخت تستی (مثل report.py جدا شمرده می‌شود)
    await analytics.track(user_id, "payment_approved", {
        "tier": tier, "amount_rial": txn["amount_rial"], "simulated": charge_id in ("SKIP", "SIMULATED"),
    })

    user = await db.get_user(user_id)
    was_first_purchase = (user or {}).get("has_paid", 0) == 0
    referrer_id = (user or {}).get("referred_by")

    # فعال‌سازی/تمدید اشتراک خریدار
    await db.activate_subscription(user_id, tier, days)

    # رفرال: فقط در اولین خرید موفق (و اگر سیستم رفرال روشن باشد)
    if was_first_purchase:
        await db.set_has_paid(user_id, 1)
        if REFERRAL_ENABLED and referrer_id:
            referrer = await db.get_user(referrer_id)
            if referrer:
                await db.grant_referral_days(referrer_id, REFERRAL_REWARD_DAYS)
                try:
                    ref_lang = db.user_lang(referrer)
                    await bot.send_message(referrer["chat_id"], C.referral_reward(ref_lang))
                except Exception as e:
                    log.warning("failed to notify referrer %s: %s", referrer_id, e)

    # پیام موفقیت اشتراک (زبان‌آگاه)
    lang = db.user_lang(user or {})
    chat_id = (user or {}).get("chat_id", user_id)
    await bot.send_message(chat_id, C.pay_success(lang, days))

    # تحویل خودکار بخشِ کاملِ خوابِ تریالِ معلق — فقط depth (preview را کاربر از آزمایشی دیده)
    pending_dream = await db.get_pending_trial_dream(user_id)
    if pending_dream:
        depth = pending_dream.get("depth") or pending_dream.get("interpretation") or ""
        if depth:
            try:
                await bot.send_message(chat_id, depth, parse_mode=None)
                await db.mark_full_delivered(pending_dream["id"])
            except Exception as e:
                log.warning("failed to auto-deliver trial full interpretation: %s", e)
