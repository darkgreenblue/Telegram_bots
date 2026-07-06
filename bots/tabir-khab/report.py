"""گزارش‌گیرِ مدیریتی — داشبوردِ کاربرها/خواب‌ها/درآمد از روی دیتابیس‌ها.

از هر دو دیتابیس (بله + تلگرام) می‌خواند و یک گزارشِ متنیِ خوانا چاپ می‌کند:
  • فهرستِ کاربرها با آیدی، نام، زبان، سبک، تعدادِ خوابِ تعبیرشده، و مبلغِ پرداختی
  • جمع‌بندیِ کل: تعداد کاربر، تعداد خواب، درآمدِ واقعی در برابرِ پرداختِ شبیه‌سازی‌شده (تست)

اجرا روی سرور:  python3 report.py
این اسکریپت فقط می‌خوانَد (read-only) و چیزی در دیتابیس تغییر نمی‌دهد.
"""
import os
import sqlite3
import datetime

DBS = [
    ("بله",    "tabir_bale.db"),
    ("تلگرام", "tabir_telegram.db"),
]

# پرداخت‌های تستی/شبیه‌سازی‌شده با این charge_idها مشخص می‌شوند (SKIP_PAYMENT)
SIMULATED_CHARGE_IDS = {"SKIP", "SIMULATED"}


def _fmt_toman(rial: int) -> str:
    return f"{rial // 10:,} تومان"


def _short_date(s: str | None) -> str:
    if not s:
        return "—"
    return s.split("T")[0]


def _table_has(con, table: str) -> bool:
    cur = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cur.fetchone() is not None


def _sub_state(expires_at: str | None) -> str:
    if not expires_at:
        return "—"
    try:
        exp = datetime.datetime.fromisoformat(expires_at)
    except (ValueError, TypeError):
        return expires_at
    now = datetime.datetime.now()
    if exp > now:
        return f"فعال (تا {(exp - now).days}روز دیگر)"
    return f"منقضی ({_short_date(expires_at)})"


def report_db(label: str, path: str) -> None:
    print(f"\n{'='*70}")
    print(f"  دیتابیسِ {label}  ({path})")
    print(f"{'='*70}")

    if not os.path.exists(path):
        print("  ⚠️  فایلِ دیتابیس پیدا نشد (هنوز هیچ کاربری نیامده یا مسیر اشتباه است).")
        return

    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row

    if not _table_has(con, "users"):
        print("  ⚠️  جدولِ users وجود ندارد.")
        con.close()
        return

    users = con.execute("SELECT * FROM users ORDER BY created_at").fetchall()
    print(f"\n  تعدادِ کلِ کاربرها: {len(users)}")

    # تعدادِ خوابِ هر کاربر
    dreams_by_user: dict[int, int] = {}
    total_dreams = 0
    if _table_has(con, "dreams"):
        for row in con.execute(
            "SELECT user_id, COUNT(*) c FROM dreams GROUP BY user_id"
        ):
            dreams_by_user[row["user_id"]] = row["c"]
            total_dreams += row["c"]

    # پرداختِ هر کاربر (فقط تراکنش‌های paid)؛ واقعی در برابرِ شبیه‌سازی
    paid_by_user: dict[int, int] = {}
    sim_by_user: dict[int, int] = {}
    total_real_rial = 0
    total_sim_rial = 0
    if _table_has(con, "transactions"):
        for row in con.execute(
            "SELECT user_id, amount_rial, charge_id FROM transactions WHERE status='paid'"
        ):
            amt = row["amount_rial"] or 0
            uid = row["user_id"]
            if (row["charge_id"] or "") in SIMULATED_CHARGE_IDS:
                sim_by_user[uid] = sim_by_user.get(uid, 0) + amt
                total_sim_rial += amt
            else:
                paid_by_user[uid] = paid_by_user.get(uid, 0) + amt
                total_real_rial += amt

    if not users:
        print("  (هنوز هیچ کاربری ثبت نشده)")
        con.close()
        return

    print(f"\n  {'آیدی':>12}  {'نام':<18} {'یوزرنیم':<16} {'زبان':<5} "
          f"{'سبک':<14} {'عضویت':<11} {'خواب':>5}  {'وضعیت':<22} {'پرداخت'}")
    print(f"  {'-'*120}")

    for u in users:
        uid = u["user_id"]
        name = (u["first_name"] or "—")[:18]
        uname = ("@" + u["username"]) if u["username"] else "—"
        uname = uname[:16]
        lang = u["language"] or "—"
        persona = (u["persona"] or "—")[:14]
        joined = _short_date(u["created_at"])
        dcount = dreams_by_user.get(uid, 0)
        sub = _sub_state(u["sub_expires_at"])[:22]

        real = paid_by_user.get(uid, 0)
        sim = sim_by_user.get(uid, 0)
        if real:
            pay = _fmt_toman(real)
            if sim:
                pay += f"  (+{_fmt_toman(sim)} تستی)"
        elif sim:
            pay = f"{_fmt_toman(sim)} (تستی)"
        else:
            pay = "—"

        trial = "🎁" if u["has_used_free_trial"] else "  "
        print(f"  {uid:>12}  {name:<18} {uname:<16} {lang:<5} "
              f"{persona:<14} {joined:<11} {dcount:>5}  {sub:<22} {trial} {pay}")

    print(f"\n  {'─'*40}")
    print(f"  جمع‌بندیِ {label}:")
    print(f"    • کاربر:            {len(users)}")
    print(f"    • خوابِ تعبیرشده:    {total_dreams}")
    print(f"    • درآمدِ واقعی:      {_fmt_toman(total_real_rial)}")
    print(f"    • پرداختِ تستی:      {_fmt_toman(total_sim_rial)}  "
          f"(SKIP_PAYMENT — پولِ واقعی نیست)")

    con.close()


def main() -> None:
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n📊 گزارشِ مدیریتیِ تعبیرِ خواب — {now}")
    for label, path in DBS:
        report_db(label, path)
    print(f"\n{'='*70}\nپایانِ گزارش.\n")


if __name__ == "__main__":
    main()
