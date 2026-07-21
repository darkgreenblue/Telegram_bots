"""ماژولِ پرداختِ کارت‌به‌کارت (قابلِ‌حمل بین پروژه‌ها) + ایجنتِ رسیدِ Gemini Flash.

استفاده در میزبان:
    from cardpay import CardPay, store
    store.configure(db._path)          # getter مسیرِ DBِ فعلی
    cp = CardPay(card_number=..., card_owner=..., api_key=..., base_url=..., model=...,
                 auto_approve=..., admin_ids=[...], on_approved=..., on_rejected=...)
    await cp.ensure_schema()           # per DB
    # شروع: await cp.start(bot, uid, chat, tier, amount_rial=.., amount_toman=.., tier_title=..)
    # رسید: await cp.maybe_handle_receipt(bot, uid, chat, photo_file_id=.., text=..)
    # ادمین: await cp.handle_admin_callback(bot, cq_id, admin_id, data)
    # هر ۶۰ث: await cp.sweep(bot)

جزئیات و مسیرِ قطعیِ آینده (پارسِ پیامک، مبلغِ یکتا): RESEARCH.md همین پکیج.
"""
from .flow import CardPay
from . import store
from . import agent

__all__ = ["CardPay", "store", "agent"]
