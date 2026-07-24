"""فلوی کارت‌به‌کارت — قابلِ‌حمل (adapter-based) با ایجنتِ رسیدِ Gemini Flash.

میزبان یک `CardPay` می‌سازد و اکشن‌ها را صدا می‌زند. ماژول از bot فقط این‌ها را می‌خواهد:
  send_message, send_photo, answer_callback_query, get_file_path, download_file
و دو کال‌بک: on_approved(bot, payment) و on_rejected(bot, payment, reason).

قرارداد فلو (مثل voice2text): نمایشِ کارت+مبلغ → دریافتِ رسید (عکس/متن) → داوریِ ایجنت:
  approve → auto (اگر auto_approve روشن) → on_approved
  reject  → auto با دلیل → پیام به کاربر + دلیل به ادمین
  review  → کلِ رسید با دکمه‌های تأیید/رد به همه‌ی ادمین‌ها (تصمیمِ انسانی)
صفِ اکشنِ داشبورد + یادآوریِ رسیدِ معطل با sweep (هر ۶۰ ثانیه).

⚠️ رسید اثبات نیست؛ RESEARCH.md همین پکیج. متنِ رو-به-کاربر اینجا فارسی است چون
کارت‌به‌کارت خاصِ ایران/فارسی است (ماژول کپیِ خودش را حمل می‌کند تا قابلِ‌حمل بماند).
"""
import os
import random
import asyncio
import logging
import tempfile

from . import store
from . import agent

log = logging.getLogger("cardpay.flow")

_APPROVE_CB = "cardok"      # ادمین: تأیید رسیدِ مشکوک
_REJECT_CB = "cardno"       # ادمین: ردِ رسیدِ مشکوک
_SMS_CB = "cardsms"         # ادمین: «پیامکش نیومده» روی پرداختِ auto-approveشده
_REV_CB = "cardrev"         # ادمین: تأیید دومِ برگشت
_REVNO_CB = "cardrevno"     # ادمین: انصراف از برگشت

_DEFAULT_TEXTS = {
    "invoice": (
        "💳 *{tier_title}* — {amount} تومان\n\n"
        "برای فعال‌سازی، مبلغِ بالا را به کارتِ زیر واریز کن:\n"
        "`{card_number}`\n{card_owner}\n\n"
        "بعد از واریز، *تصویرِ فیش یا متنِ تأیید* را همین‌جا بفرست تا بررسی شود. ⏰ مهلت: ۲۴ ساعت"
    ),
    "got_receipt": "رسیدت رسید 🌙 برای بررسی و تأیید فرستاده شد؛ به‌محضِ تأیید، همسفری‌ات فعال می‌شود و خبرت می‌کنم.",
    "approved": "✅ پرداختت تأیید شد؛ همسفری‌ات فعال شد 🌙",
    # پیامِ ردِ یکپارچه (همه‌ی مسیرها) — بدونِ دلیل، فقط راهِ پیگیری (لو نرفتنِ ایجنت)
    "rejected": "❌ پرداخت شما تأیید نشد.\n\nبرای پیگیری با پشتیبانی در ارتباط باش: {support}",
    "review": "رسیدت رسید و برای بررسیِ نهایی به ادمین رفت 🌙 به‌زودی نتیجه را می‌گویم.",
    "not_receipt_hint": "چیزی که فرستادی رسیدِ پرداخت نبود. لطفاً تصویرِ فیشِ واریز یا متنِ تأییدِ بانک را بفرست.",
    "overpaid_note": "کاربر مبلغِ بیشتری واریز کرده: حدود {paid} تومان به‌جای {expected} تومان. اگر خواستی، اختلاف را دستی لحاظ کن.",
    # برگشتِ پرداخت (رسیدِ فیک)
    "admin_ai_approved": "✅ پرداخت #{pid} — مبلغ {amount} تومان توسط ایجنت تأیید و فعال شد.\n{note}",
    "confirm_reverse": (
        "⚠️ مطمئنی پیامکِ واریزِ پرداخت #{pid} نیومده؟\n"
        "اول اپِ بانکی/پیامک را چک کن. با تأیید، اشتراکِ ناشی از این پرداخت *لغو* و کاربر به حالتِ قبل برمی‌گردد "
        "و از این به بعد پرداخت‌هایش فقط دستی (توسط تو) تأیید می‌شود."
    ),
    "reversed_user": (
        "پرداختِ قبلی شما لغو شد و اشتراکِ ناشی از آن برداشته شد. 🌙\n"
        "اگر فکر می‌کنی اشتباهی شده، به پشتیبانی پیام بده: {support}"
    ),
    "admin_reversed": "↩️ پرداخت #{pid} برگشت خورد، اشتراک لغو شد و کاربر {user} بی‌اعتماد علامت خورد (از این پس دستی).",
    "admin_reverse_cancelled": "باشه، برگشت انجام نشد. پرداخت #{pid} سرِ جایش ماند.",
}


class CardPay:
    def __init__(self, *, card_number, card_owner, recipient_name=None, dest_last4="",
                 api_key, base_url, model, auto_approve, admin_ids,
                 on_approved, on_rejected, on_reversed=None, support_contact="", texts=None,
                 human_delay_range=(3.0, 10.0)):
        # تأخیرِ انسانیِ بین «رسید رسید» و نتیجه (حسِ بررسیِ ادمین)؛ تست‌ها (0,0) می‌دهند.
        self.human_delay_range = human_delay_range
        self.card_number = card_number
        self.card_owner = card_owner
        self.recipient_name = recipient_name or card_owner
        self.dest_last4 = dest_last4
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.auto_approve = auto_approve
        self.admin_ids = list(admin_ids or [])
        self.on_approved = on_approved
        self.on_rejected = on_rejected
        self.on_reversed = on_reversed   # میزبان: لغوِ اشتراک/شارژِ ناشی از این پرداخت
        self.support_contact = support_contact
        self.T = {**_DEFAULT_TEXTS, **(texts or {})}

    async def ensure_schema(self):
        await store.ensure_schema()

    # ===================== شروعِ پرداخت =====================

    async def start(self, bot, user_id, chat_id, tier, *, amount_rial, amount_toman,
                    tier_title, resume=False) -> int:
        pid = await store.create_payment(user_id, chat_id, tier, amount_rial, resume=resume)
        text = self.T["invoice"].format(
            tier_title=tier_title, amount=f"{amount_toman:,}",
            card_number=self.card_number, card_owner=self.card_owner,
        )
        # دکمه‌ی کپیِ شماره کارت (Telegram copy_text — کلیک = کپی به کلیپ‌بورد). قاعده‌ی سراسری:
        # هر پیامِ پرداختِ کارت‌به‌کارت که شماره کارت را نشان می‌دهد این دکمه را زیرش دارد.
        kb = {"inline_keyboard": [[{"text": "📋 کپی شماره کارت",
                                    "copy_text": {"text": self.card_number}}]]}
        await bot.send_message(chat_id, text, reply_markup=kb)
        return pid

    # ===================== دریافتِ رسید =====================

    async def maybe_handle_receipt(self, bot, user_id, chat_id, *,
                                   photo_file_id=None, text=None) -> bool:
        """اگر کاربر پرداختِ منتظرِ رسید دارد، این پیام را به‌عنوان رسید پردازش کن.
        True یعنی این پیام مصرف شد (میزبان نباید ادامه بدهد)."""
        payment = await store.get_pending_receipt_payment(user_id)
        if not payment:
            return False
        pid = payment["id"]

        await store.set_receipt_media(pid, photo_file_id, text)
        # پیامِ انسانی: رسید برای بررسی/تأیید فرستاده شد (بدونِ اشاره به بررسیِ خودکار)
        await bot.send_message(chat_id, self.T["got_receipt"])

        expected_toman = payment["amount_rial"] // 10
        expected = {
            "amount_toman": expected_toman,
            "amount_rial": payment["amount_rial"],
            "recipient": self.recipient_name,
            "dest_last4": self.dest_last4,
        }

        # کلیدِ خاموشی یا کاربرِ بی‌اعتماد = مستقیم به ادمین (دستی، بدونِ تصمیمِ خودکار و بدونِ تأخیرِ ساختگی)
        distrusted = await store.is_distrusted(user_id)
        if not self.auto_approve or distrusted:
            await store.set_ai(pid, "review", "manual" if distrusted else "auto_off")
            await self._escalate(bot, payment, "بررسیِ دستی", [])
            return True

        image_bytes = None
        if photo_file_id:
            try:
                image_bytes = await self._download(bot, photo_file_id)
            except Exception as e:
                log.warning("[cardpay] receipt download failed → review: %s", e)

        verdict = None
        try:
            verdict = await agent.analyze_receipt(
                api_key=self.api_key, base_url=self.base_url, model=self.model,
                expected=expected, image_bytes=image_bytes,
                image_mime="image/jpeg", text=text,
            )
            decision = agent.decide_receipt(verdict, expected_toman)  # گاردِ قطعیِ مبلغ (بیشتر → تأیید)
            await store.set_ai(pid, verdict["verdict"], verdict.get("reason_code", ""))
        except Exception as e:
            log.warning("[cardpay] agent failed → review: %s", e)
            decision = {"action": "review", "reason_fa": "", "overpaid": 0}

        # تأخیرِ انسانیِ ۳ تا ۱۰ ثانیه (حسِ «ادمین اپِ بانکی را چک می‌کند») — فقط مسیرِ خودکار
        lo, hi = self.human_delay_range
        if hi and hi > 0:
            await asyncio.sleep(random.uniform(lo, hi))

        reason_fa = decision.get("reason_fa") or "نامشخص"
        action = decision["action"]
        # سیاست: فقط دو نتیجه‌ی خودکار — approve (پرداختِ کافی و واقعی) و reject (فقط مبلغِ اکیداً کمتر).
        # بقیه (not_a_receipt/بی‌کیفیت/مشکوک) → تصمیمِ انسانیِ ادمین. کاربر همیشه فقط یکی از دو
        # پیامِ نهایی را می‌گیرد: «تأیید شد» یا «تأیید نشد + پشتیبانی» (بدونِ «رسید نیست» یا دلیل).
        if action == "approve":
            await self._approve(bot, pid, via="ai", note=reason_fa,
                                overpaid=decision.get("overpaid", 0), expected_toman=expected_toman)
        elif action == "reject":
            await self._reject(bot, pid, reason_fa, via="ai")
        else:  # not_a_receipt یا review → تصمیمِ انسانیِ ادمین
            await self._escalate(bot, payment, reason_fa, verdict.get("risk_flags", []) if verdict else [])
        return True

    # ===================== تأیید / رد =====================

    async def _approve(self, bot, payment_id, *, via, note="", overpaid=0, expected_toman=0):
        if not await store.finalize(payment_id, "approved"):
            return  # قبلاً نهایی شده (ضد دوبار)
        payment = await store.get_payment(payment_id)
        try:
            await self.on_approved(bot, payment)
        except Exception as e:
            log.warning("[cardpay] on_approved failed: %s", e)

        if via == "ai":
            # اطلاع به ادمین + دکمه‌ی «پیامکش نیومده» (برای گرفتنِ جلوی رسیدِ فیکی که AI تأیید کرده)
            text = self.T["admin_ai_approved"].format(
                pid=payment_id, amount=f"{payment['amount_rial'] // 10:,}", note=note)
            if overpaid and overpaid > 0:
                exp = expected_toman or (payment["amount_rial"] // 10)
                text += "\n\n⚠️ " + self.T["overpaid_note"].format(
                    paid=f"{int(overpaid):,}", expected=f"{int(exp):,}")
            kb = {"inline_keyboard": [[
                {"text": "🚫 پیامکش نیومده", "callback_data": f"{_SMS_CB}:{payment_id}"},
            ]]}
            await self._admin_send(bot, text, reply_markup=kb,
                                   photo_file_id=payment.get("receipt_file_id"))
        else:
            await self._admin_note(bot, f"✅ پرداخت #{payment_id} تأیید شد ({via}). {note}",
                                   photo_file_id=payment.get("receipt_file_id"))

    async def _reject(self, bot, payment_id, reason, *, via):
        if not await store.finalize(payment_id, "rejected"):
            return
        payment = await store.get_payment(payment_id)
        try:
            await bot.send_message(payment["chat_id"] or payment["user_id"],
                                   self.T["rejected"].format(reason=reason, support=self.support_contact))
        except Exception:
            pass
        try:
            await self.on_rejected(bot, payment, reason)
        except Exception as e:
            log.warning("[cardpay] on_rejected failed: %s", e)
        await self._admin_note(bot, f"❌ پرداخت #{payment_id} خودکار رد شد ({'AI' if via=='ai' else via}).\nدلیل: {reason}",
                               photo_file_id=payment.get("receipt_file_id"))

    async def _escalate(self, bot, payment, reason, risk_flags):
        """رسیدِ مشکوک → waiting_review + کلِ رسید با دکمه‌های تأیید/رد به همه‌ی ادمین‌ها."""
        pid = payment["id"]
        await store.mark_waiting_review(pid)
        await bot.send_message(payment["chat_id"] or payment["user_id"], self.T["review"])
        caption = (
            f"⚠️ رسیدِ نیازمندِ بررسی #{pid}\n"
            f"👤 کاربر: {payment['user_id']}\n"
            f"💰 مبلغ: {payment['amount_rial'] // 10:,} تومان ({payment.get('tier')})\n"
            f"🤖 نظرِ AI: {reason}"
            + (f"\n🚩 {', '.join(risk_flags)}" if risk_flags else "")
            + (f"\n\n📋 متنِ رسید:\n{payment.get('receipt_text')}" if payment.get("receipt_text") else "")
        )
        kb = {"inline_keyboard": [[
            {"text": "✅ تأیید", "callback_data": f"{_APPROVE_CB}:{pid}"},
            {"text": "❌ رد", "callback_data": f"{_REJECT_CB}:{pid}"},
        ]]}
        first_msg_id = None
        for adm in self.admin_ids:
            try:
                if payment.get("receipt_file_id"):
                    sent = await bot.send_photo(adm, payment["receipt_file_id"],
                                                caption=caption, reply_markup=kb, parse_mode=None)
                else:
                    sent = await bot.send_message(adm, caption, reply_markup=kb, parse_mode=None)
                if first_msg_id is None and isinstance(sent, dict):
                    first_msg_id = sent.get("message_id")
            except Exception:
                pass

    # ===================== کال‌بکِ ادمین =====================

    async def handle_admin_callback(self, bot, cq_id, admin_id, data) -> bool:
        """دکمه‌های ادمین: cardok/cardno (تأیید/ردِ مشکوک)، cardsms (پیامک نیومده)،
        cardrev/cardrevno (تأیید دوم/انصرافِ برگشت). True یعنی مصرف شد."""
        if ":" not in data:
            return False
        act, _, sid = data.partition(":")
        if act not in (_APPROVE_CB, _REJECT_CB, _SMS_CB, _REV_CB, _REVNO_CB) or not sid.isdigit():
            return False
        if admin_id not in self.admin_ids:
            await bot.answer_callback_query(cq_id)
            return True
        pid = int(sid)

        if act == _APPROVE_CB:
            await bot.answer_callback_query(cq_id, text="تأیید شد")
            await self._approve(bot, pid, via="admin")
        elif act == _REJECT_CB:
            await bot.answer_callback_query(cq_id, text="رد شد")
            await self._reject(bot, pid, "توسط ادمین بررسی و رد شد", via="admin")
        elif act == _SMS_CB:
            # تأیید دوم قبل از برگشت (کامیونیکیت + یادآوریِ چکِ اپِ بانکی)
            await bot.answer_callback_query(cq_id)
            kb = {"inline_keyboard": [[
                {"text": "✅ بله مطمئنم، لغو کن", "callback_data": f"{_REV_CB}:{pid}"},
                {"text": "↩️ نه، بی‌خیال", "callback_data": f"{_REVNO_CB}:{pid}"},
            ]]}
            await self._admin_send(bot, self.T["confirm_reverse"].format(pid=pid), reply_markup=kb)
        elif act == _REV_CB:
            await bot.answer_callback_query(cq_id, text="در حال برگشت…")
            await self._reverse(bot, pid)
        elif act == _REVNO_CB:
            await bot.answer_callback_query(cq_id, text="بی‌خیال شد")
            await self._admin_send(bot, self.T["admin_reverse_cancelled"].format(pid=pid))
        return True

    async def _reverse(self, bot, payment_id):
        """برگشتِ پرداختِ فیک: لغوِ اشتراک/شارژ (میزبان) + بی‌اعتمادکردنِ کاربر + اطلاع به کاربر و ادمین."""
        if not await store.mark_reversed(payment_id):
            return  # قبلاً برگشت خورده یا approved نبوده (ضد دوبار)
        payment = await store.get_payment(payment_id)
        user_id = payment["user_id"]
        await store.set_distrusted(user_id)   # از این پس فقط دستی
        try:
            if self.on_reversed:
                await self.on_reversed(bot, payment)   # میزبان: لغوِ اشتراک/شارژِ ناشی از این پرداخت
        except Exception as e:
            log.warning("[cardpay] on_reversed failed: %s", e)
        try:
            await bot.send_message(payment["chat_id"] or user_id,
                                   self.T["reversed_user"].format(support=self.support_contact))
        except Exception:
            pass
        await self._admin_send(bot, self.T["admin_reversed"].format(pid=payment_id, user=user_id))

    # ===================== sweep (هر ۶۰ ثانیه) =====================

    async def sweep(self, bot):
        """درینِ صفِ اکشنِ داشبورد + یادآوریِ رسیدهای معطل. fail-safe."""
        try:
            for act in await store.pending_actions():
                try:
                    if act["action"] == "approve":
                        await self._approve(bot, act["payment_id"], via="dashboard")
                    elif act["action"] == "reject":
                        await self._reject(bot, act["payment_id"], "توسط ادمین (داشبورد) رد شد", via="dashboard")
                except Exception as e:
                    log.warning("[cardpay] action exec %s: %s", act.get("id"), e)
                await store.mark_action_done(act["id"])
            for p in await store.stale_receipts():
                await self._remind(bot, p)
        except Exception as e:
            log.warning("[cardpay] sweep: %s", e)

    async def _remind(self, bot, payment):
        pid = payment["id"]
        caption = (
            f"⏳ یادآوری: رسیدِ منتظرِ تأیید #{pid} (بیش از ۲ ساعت)\n"
            f"👤 {payment['user_id']} · 💰 {payment['amount_rial'] // 10:,} تومان\n"
            f"همین‌جا تأیید یا رد کن:"
        )
        kb = {"inline_keyboard": [[
            {"text": "✅ تأیید", "callback_data": f"{_APPROVE_CB}:{pid}"},
            {"text": "❌ رد", "callback_data": f"{_REJECT_CB}:{pid}"},
        ]]}
        for adm in self.admin_ids:
            try:
                if payment.get("receipt_file_id"):
                    await bot.send_photo(adm, payment["receipt_file_id"], caption=caption,
                                         reply_markup=kb, parse_mode=None)
                else:
                    await bot.send_message(adm, caption, reply_markup=kb, parse_mode=None)
            except Exception:
                pass
        await store.set_reminded(pid)

    # ===================== کمک‌ها =====================

    async def _admin_note(self, bot, text, photo_file_id=None):
        await self._admin_send(bot, text, photo_file_id=photo_file_id)

    async def _admin_send(self, bot, text, reply_markup=None, photo_file_id=None):
        for adm in self.admin_ids:
            try:
                if photo_file_id:
                    await bot.send_photo(adm, photo_file_id, caption=text,
                                         reply_markup=reply_markup, parse_mode=None)
                else:
                    await bot.send_message(adm, text, reply_markup=reply_markup, parse_mode=None)
            except Exception:
                pass

    async def _download(self, bot, file_id) -> bytes:
        path = await bot.get_file_path(file_id)
        fd, tmp = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        try:
            await bot.download_file(path, tmp)
            with open(tmp, "rb") as f:
                return f.read()
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
