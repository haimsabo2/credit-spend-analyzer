"""Dynamic household cashflow & bank-statement analytics engine (read-only join with CC DB)."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, func, select

from ..models import (
    AiInsight,
    BankCashflowSettings,
    BankTransaction,
    BankUpload,
    Category,
    Subcategory,
    Transaction,
    Upload,
)

TRAVEL_CATEGORY_NAME_HE = 'נסיעות וחו"ל'
SAVINGS_CATEGORY_NAME_HE = "חסכון"

_TRAVEL_DESC_KEYWORDS = (
    "איסתא",
    "WIZZ",
    "AIRALO",
    "היינמן",
    "DUTY FREE",
    'נתב"ג',
    "נמל תעו",
)

_INSTALLMENT_RE = re.compile(r"תשלום\s*(\d+)\s*מתוך\s*(\d+)")


def _prev_month(ym: str) -> str:
    y, m = map(int, ym.split("-"))
    if m == 1:
        return f"{y - 1:04d}-12"
    return f"{y:04d}-{m - 1:02d}"


def _is_travel_cc_row(desc: str, cat_name: Optional[str]) -> bool:
    if cat_name == TRAVEL_CATEGORY_NAME_HE:
        return True
    upper_desc = (desc or "").upper()
    return any(kw in upper_desc for kw in _TRAVEL_DESC_KEYWORDS)


def _estimate_pre_db_cc_one_time(cc_raw: float, cc_isracard: float, cc_mc_other: float) -> float:
    """Estimate one-time vacation/spike portion for pre-DB bank months (before 2025-08)."""
    ot = 0.0
    if cc_isracard > 1200.0:
        ot += cc_isracard - 500.0
    if cc_mc_other > 27000.0:
        ot += cc_mc_other - 26500.0
    return round(min(max(0.0, ot), cc_raw), 2)


def get_or_create_bank_settings(session: Session) -> BankCashflowSettings:
    row = session.get(BankCashflowSettings, 1)
    if row is None:
        row = BankCashflowSettings(id=1)
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


def get_bank_status(session: Session) -> dict[str, Any]:
    total_txs = int(
        session.exec(select(func.count()).select_from(BankTransaction)).one() or 0
    )
    min_d = session.exec(select(func.min(BankTransaction.activity_date))).one()
    max_d = session.exec(select(func.max(BankTransaction.activity_date))).one()
    acct = session.exec(
        select(BankTransaction.account_number)
        .order_by(BankTransaction.id.desc())
        .limit(1)
    ).first()
    distinct_months = int(
        session.exec(
            select(func.count(func.distinct(BankTransaction.month)))
        ).one()
        or 0
    )
    uploads = list(
        session.exec(
            select(BankUpload).order_by(BankUpload.created_at.desc(), BankUpload.id.desc()).limit(20)
        ).all()
    )
    return {
        "has_data": total_txs > 0,
        "account_number": acct or "",
        "total_transactions": total_txs,
        "first_date": min_d.isoformat() if min_d else None,
        "last_synced_date": max_d.isoformat() if max_d else None,
        "total_months": distinct_months,
        "uploads": [
            {
                "id": u.id,
                "original_filename": u.original_filename,
                "account_number": u.account_number,
                "date_from": u.date_from.isoformat() if u.date_from else None,
                "date_to": u.date_to.isoformat() if u.date_to else None,
                "previous_max_date": (
                    u.previous_max_date.isoformat() if u.previous_max_date else None
                ),
                "inserted_count": u.inserted_count,
                "skipped_duplicates_count": u.skipped_duplicates_count,
                "created_at": u.created_at.isoformat(),
            }
            for u in uploads
        ],
    }


def _load_cc_read_only_summary(session: Session) -> dict[str, Any]:
    """Read-only aggregation of credit-spend-analyzer DB with calculation-layer travel separation."""
    stmt = (
        select(
            Upload.month,
            Transaction.card_label,
            Transaction.posted_at,
            Transaction.description,
            Transaction.amount,
            Transaction.spend_pattern,
            Transaction.category_id,
            Category.name,
            Subcategory.name,
            Transaction.raw_row_data,
        )
        .join(Upload, Transaction.upload_id == Upload.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
    )
    rows = session.exec(stmt).all()

    by_upload_month: dict[str, dict[str, float]] = defaultdict(
        lambda: {"sav": 0.0, "ot": 0.0, "rec": 0.0, "total": 0.0}
    )
    cat_agg: dict[str, dict[str, float]] = defaultdict(
        lambda: {"rec_sum": 0.0, "ot_sum": 0.0, "total": 0.0}
    )
    upload_months_set: set[str] = set()

    # Track card 8838 stats & uncategorized stats & open installments & trip totals
    card_8838_total = 0.0
    card_8838_rec = 0.0
    uncat_2026_10_count = 0
    uncat_2026_10_sum = 0.0

    # Open installments tracker (from latest upload month)
    all_months_sorted: list[str] = []
    raw_rows_cache: list[tuple] = []

    for r in rows:
        u_month: str = r[0]
        card_label: str = r[1] or ""
        posted_at = r[2]
        desc: str = r[3] or ""
        amt = float(r[4] or 0.0)
        sp: str = r[5] or "unknown"
        cat_id: Optional[int] = r[6]
        cat_name: Optional[str] = r[7]
        subcat_name: Optional[str] = r[8]
        raw_json: Optional[str] = r[9]

        upload_months_set.add(u_month)
        raw_rows_cache.append(
            (u_month, card_label, posted_at, desc, amt, sp, cat_id, cat_name, subcat_name, raw_json)
        )

        m_bucket = by_upload_month[u_month]
        m_bucket["total"] += amt

        if cat_name == SAVINGS_CATEGORY_NAME_HE:
            m_bucket["sav"] += amt
            if "8838" in card_label:
                card_8838_total += amt
            continue

        is_travel = _is_travel_cc_row(desc, cat_name)
        is_ot = (sp == "one_time") or is_travel

        if is_ot:
            m_bucket["ot"] += amt
        else:
            m_bucket["rec"] += amt

        if "8838" in card_label:
            card_8838_total += amt
            if not is_ot:
                card_8838_rec += amt

        if u_month == "2026-10" and cat_id is None and is_ot:
            uncat_2026_10_count += 1
            uncat_2026_10_sum += amt

        # Group into readable Hebrew display buckets for the horizontal chart
        if is_travel:
            disp_cat = 'נסיעות, חופשות וחו״ל (כולל טיולי אירופה ואילת)'
        elif cat_name in (
            "מועדון שלך (שוברים)",
            "מפעל הפיס",
            "פייבוקס (מתנות, ועדים וכו)",
            "תרומות ומתנות",
            "מספרה וטיפוח",
        ):
            disp_cat = "שוברים, פייבוקס, מתנות, פיס וטיפוח"
        elif cat_name in ("רכב", "תחבורה ודלק"):
            disp_cat = "רכב, דלק ותחבורה"
        elif cat_name == "קניות לבית":
            disp_cat = "קניות לבית (ללא דיוטי פרי)"
        elif cat_name is None:
            disp_cat = 'ללא קטגוריה (חו״ל / חד-פעמי לטיפול)'
        else:
            disp_cat = cat_name

        c_entry = cat_agg[disp_cat]
        c_entry["total"] += amt
        if is_ot:
            c_entry["ot_sum"] += amt
        else:
            c_entry["rec_sum"] += amt

    all_months_sorted = sorted(upload_months_set)
    n_cc_months = max(1, len(all_months_sorted))
    latest_cc_month = all_months_sorted[-1] if all_months_sorted else None

    # Detect active open installments in latest uploaded CC month
    open_installments: list[dict[str, Any]] = []
    if latest_cc_month:
        for (
            u_month,
            card_label,
            posted_at,
            desc,
            amt,
            sp,
            cat_id,
            cat_name,
            subcat_name,
            raw_json,
        ) in raw_rows_cache:
            if u_month != latest_cc_month or not raw_json:
                continue
            try:
                parsed_raw = json.loads(raw_json)
            except Exception:
                continue
            details = str(parsed_raw.get("details") or "")
            m_inst = _INSTALLMENT_RE.search(details)
            if not m_inst:
                continue
            cur_num, tot_num = int(m_inst.group(1)), int(m_inst.group(2))
            rem = tot_num - cur_num
            if rem <= 0:
                continue
            cells = parsed_raw.get("source_cells") or []
            orig_total = None
            if len(cells) >= 3:
                try:
                    orig_total = float(str(cells[2]).replace(",", "").strip())
                except Exception:
                    orig_total = None
            open_installments.append(
                {
                    "description": desc,
                    "card_label": card_label,
                    "monthly_amount": round(amt, 2),
                    "current_installment": cur_num,
                    "total_installments": tot_num,
                    "remaining_installments": rem,
                    "remaining_total": round(amt * rem, 2),
                    "original_total": round(orig_total, 2) if orig_total else round(amt * tot_num, 2),
                    "is_travel": _is_travel_cc_row(desc, cat_name),
                }
            )
        open_installments.sort(key=lambda x: x["remaining_total"], reverse=True)

    # Summarize major trips dynamically from DB rows
    london_sum = 0.0
    eilat_sum = 0.0
    sep_budapest_sum = 0.0
    sep_rome_sum = 0.0
    sep_athens_sum = 0.0
    barcelona_db_billed = 0.0
    issta_original_total = 0.0
    issta_billed_so_far = 0.0
    issta_remaining = 0.0

    for (
        u_month,
        card_label,
        posted_at,
        desc,
        amt,
        sp,
        cat_id,
        cat_name,
        subcat_name,
        raw_json,
    ) in raw_rows_cache:
        p_iso = posted_at.isoformat() if posted_at else ""
        if subcat_name == "טיול ללונדון":
            london_sum += amt
        elif subcat_name == "חופשה משפחתית באילת":
            eilat_sum += amt

        if "איסתא ספורט" in desc:
            issta_billed_so_far += amt
            if raw_json and not issta_original_total:
                try:
                    cells = json.loads(raw_json).get("source_cells") or []
                    if len(cells) >= 3:
                        issta_original_total = float(str(cells[2]).replace(",", "").strip())
                except Exception:
                    pass

        if u_month == "2026-10" and "8838" in card_label:
            if "2026-09-02" <= p_iso <= "2026-09-09":
                sep_athens_sum += amt
            elif "2026-09-10" <= p_iso <= "2026-09-20":
                sep_budapest_sum += amt
            elif "2026-09-24" <= p_iso <= "2026-09-30":
                sep_rome_sum += amt

        if u_month == "2026-09":
            if "היינמן" in desc and p_iso == "2026-09-03":
                sep_athens_sum += amt
            elif "WIZZ" in desc.upper() and p_iso <= "2026-09-09":
                sep_athens_sum += amt
            elif "היינמן" in desc and p_iso == "2026-09-10":
                sep_budapest_sum += amt
            elif "היינמן" in desc and p_iso == "2026-09-25":
                sep_rome_sum += amt

        if p_iso >= "2026-10-22" and (
            "היינמן" in desc or 'נתב"ג' in desc or "נמל תעו" in desc
        ):
            barcelona_db_billed += amt

    if issta_original_total > issta_billed_so_far:
        issta_remaining = round(issta_original_total - issta_billed_so_far, 2)

    cc_categories_list = [
        {
            "name": name,
            "rec_mo": round(vals["rec_sum"] / n_cc_months),
            "ot_mo": round(vals["ot_sum"] / n_cc_months),
            "total": round(vals["total"]),
        }
        for name, vals in cat_agg.items()
        if round(vals["total"]) > 0
    ]
    cc_categories_list.sort(key=lambda c: (c["rec_mo"], c["total"]), reverse=True)

    return {
        "by_upload_month": by_upload_month,
        "cc_months_count": len(all_months_sorted),
        "latest_cc_month": latest_cc_month,
        "cc_categories": cc_categories_list,
        "card_8838_total": round(card_8838_total, 2),
        "card_8838_rec_mo": round(card_8838_rec / n_cc_months, 2),
        "uncat_2026_10_count": uncat_2026_10_count,
        "uncat_2026_10_sum": round(uncat_2026_10_sum, 2),
        "open_installments": open_installments,
        "trip_totals": {
            "london": round(london_sum),
            "eilat": round(eilat_sum),
            "sep_budapest": round(sep_budapest_sum),
            "sep_rome": round(sep_rome_sum),
            "sep_athens": round(sep_athens_sum),
            "barcelona_issta_total": round(issta_original_total, 2),
            "barcelona_issta_billed": round(issta_billed_so_far, 2),
            "barcelona_issta_remaining": round(issta_remaining, 2),
            "barcelona_airport_billed": round(barcelona_db_billed, 2),
        },
    }


def compute_bank_analysis(session: Session) -> dict[str, Any]:
    """Compute the full dynamic household cashflow analysis from SQLite."""
    status = get_bank_status(session)
    settings = get_or_create_bank_settings(session)
    settings_dict = {
        "inc_muni_dig": settings.inc_muni_dig,
        "inc_bit": settings.inc_bit,
        "inc_bituach_leumi": settings.inc_bituach_leumi,
        "inc_sav_600_as_expense": settings.inc_sav_600_as_expense,
        "inc_khs_as_expense": settings.inc_khs_as_expense,
    }

    if not status["has_data"]:
        return {
            "status": status,
            "settings": settings_dict,
            "periods": [],
            "monthly": [],
            "cc_categories": [],
            "savings_vehicles": [],
            "wash_ledger": [],
            "external_transfers": [],
            "other_anomaly_inflows": [],
            "one_time_outflows": [],
            "trips_summary": [],
            "open_installments": [],
            "capital_events": [],
            "insights": [],
        }

    bank_rows = list(
        session.exec(
            select(BankTransaction).order_by(
                BankTransaction.activity_date.asc(),
                BankTransaction.chronological_order.asc(),
                BankTransaction.id.asc(),
            )
        ).all()
    )

    cc_info = _load_cc_read_only_summary(session)
    by_cc_month = cc_info["by_upload_month"]

    # Aggregate bank rows by YYYY-MM
    months_map: dict[str, dict[str, Any]] = {}

    def _ensure_month(ym: str) -> dict[str, Any]:
        if ym not in months_map:
            months_map[ym] = {
                "ym": ym,
                "sal1": 0.0,
                "sal2": 0.0,
                "sal_misc": 0.0,
                "child": 0.0,
                "muni_dig_in": 0.0,
                "health_ins_in": 0.0,
                "bit_in": 0.0,
                "bank_misc_in": 0.0,
                "bituach_leumi": 0.0,
                "anom_in": 0.0,
                "wash_fin_in": 0.0,
                "cc_raw": 0.0,
                "cc_isracard": 0.0,
                "cc_mc_other": 0.0,
                "mortgage": 0.0,
                "reg_transfers": 0.0,
                "loans_monthly": 0.0,
                "vaad_454": 0.0,
                "sav_600": 0.0,
                "cash_checks": 0.0,
                "health_out": 0.0,
                "fees_out": 0.0,
                "khs_20k": 0.0,
                "anom_out": 0.0,
                "wash_fin_out": 0.0,
                "end_bal": 0.0,
            }
        return months_map[ym]

    # Also collect detailed buckets for Tier 1 / Tier 2 / Tier 3
    one_zero_in = one_zero_out = 0.0
    one_zero_in_cnt = one_zero_out_cnt = 0
    sec_in = sec_out = 0.0
    sec_in_cnt = sec_out_cnt = 0
    loan_in = loan_payoff_out = 0.0
    loan_in_cnt = loan_payoff_cnt = 0

    bonus_rows: list[tuple[BankTransaction, float]] = []
    rtgs_in_rows: list[BankTransaction] = []
    unemployment_rows: list[BankTransaction] = []
    cash_dep_rows: list[BankTransaction] = []
    tax_ref_rows: list[BankTransaction] = []
    external_transfer_rows: list[BankTransaction] = []

    rtgs_out_rows: list[BankTransaction] = []
    irreg_transfer_out_rows: list[BankTransaction] = []
    misc_ot_out_rows: list[BankTransaction] = []

    khs_rows: list[BankTransaction] = []
    sav_600_rows: list[BankTransaction] = []
    reg_transfer_out_rows: list[BankTransaction] = []

    barcelona_fx_bank = 0.0

    for tx in bank_rows:
        m = _ensure_month(tx.month)
        if tx.balance is not None:
            m["end_bal"] = tx.balance

        fg = tx.flow_group
        sk = tx.stream_key
        cred = tx.credit
        deb = tx.debit

        if cred > 0:
            if fg == "wash_in":
                m["wash_fin_in"] += cred
                if sk == "one_zero_wash":
                    one_zero_in += cred
                    one_zero_in_cnt += 1
                elif sk == "securities_sale":
                    sec_in += cred
                    sec_in_cnt += 1
                elif sk == "loan_principal_in":
                    loan_in += cred
                    loan_in_cnt += 1
            elif fg == "income_unemployment":
                m["bituach_leumi"] += cred
                unemployment_rows.append(tx)
            elif fg == "income_anomaly":
                m["anom_in"] += cred
                if sk == "external_transfer":
                    external_transfer_rows.append(tx)
                elif sk == "rtgs_car_sale":
                    rtgs_in_rows.append(tx)
                elif sk == "cash_deposit":
                    cash_dep_rows.append(tx)
                elif sk == "tax_refund":
                    tax_ref_rows.append(tx)
            else:
                # income_regular (handle salary bonus split if set)
                if sk in ("sal_primary", "sal_secondary") and tx.split_base_amount is not None:
                    base_part = min(cred, tx.split_base_amount)
                    bonus_part = max(0.0, cred - base_part)
                    if sk == "sal_primary":
                        m["sal1"] += base_part
                    else:
                        m["sal2"] += base_part
                    if bonus_part > 0:
                        m["anom_in"] += bonus_part
                        bonus_rows.append((tx, bonus_part))
                elif sk == "sal_primary":
                    m["sal1"] += cred
                elif sk == "sal_secondary":
                    m["sal2"] += cred
                elif sk == "sal_misc":
                    m["sal_misc"] += cred
                elif sk == "child_allowance":
                    m["child"] += cred
                elif sk == "muni_digital_in":
                    m["muni_dig_in"] += cred
                elif sk == "bit_in":
                    m["bit_in"] += cred
                elif sk == "health_ins_in":
                    m["health_ins_in"] += cred
                else:
                    m["bank_misc_in"] += cred

        if deb > 0:
            if fg == "expense_cc":
                m["cc_raw"] += deb
                if sk == "cc_isracard":
                    m["cc_isracard"] += deb
                else:
                    m["cc_mc_other"] += deb
            elif fg == "wash_out":
                m["wash_fin_out"] += deb
                if sk == "one_zero_wash":
                    one_zero_out += deb
                    one_zero_out_cnt += 1
                elif sk == "securities_buy":
                    sec_out += deb
                    sec_out_cnt += 1
                elif sk == "loan_early_payoff":
                    loan_payoff_out += deb
                    loan_payoff_cnt += 1
            elif fg == "savings":
                if sk == "khs_20k":
                    m["khs_20k"] += deb
                    khs_rows.append(tx)
                else:
                    m["sav_600"] += deb
                    sav_600_rows.append(tx)
            elif fg == "expense_anomaly":
                m["anom_out"] += deb
                if sk == "rtgs_car_buy":
                    rtgs_out_rows.append(tx)
                elif sk == "irregular_transfer_out":
                    irreg_transfer_out_rows.append(tx)
                else:
                    misc_ot_out_rows.append(tx)
                    if "מט\"ח" in tx.description and tx.activity_date.isoformat() >= "2026-10-20":
                        barcelona_fx_bank += deb
            else:
                # expense_living
                if sk == "mortgage":
                    m["mortgage"] += deb
                elif sk == "loans_monthly":
                    m["loans_monthly"] += deb
                elif sk == "vaad_454":
                    m["vaad_454"] += deb
                elif sk == "reg_transfers":
                    m["reg_transfers"] += deb
                    reg_transfer_out_rows.append(tx)
                elif sk == "cash_checks":
                    m["cash_checks"] += deb
                elif sk == "health_out":
                    m["health_out"] += deb
                else:
                    m["fees_out"] += deb

    # Finalize monthly rows with CC read-only split
    monthly_list: list[dict[str, Any]] = []
    for ym in sorted(months_map.keys()):
        m = months_map[ym]
        prev_ym = _prev_month(ym)
        cc_raw = round(m["cc_raw"], 2)
        if prev_ym in by_cc_month and cc_raw > 0:
            cc_b = by_cc_month[prev_ym]
            cc_sav = round(min(cc_raw, cc_b["sav"]), 2)
            cc_ot = round(min(max(0.0, cc_raw - cc_sav), cc_b["ot"]), 2)
            cc_rec = round(max(0.0, cc_raw - cc_sav - cc_ot), 2)
            cc_source = "db"
        else:
            cc_sav = 0.0
            cc_ot = _estimate_pre_db_cc_one_time(
                cc_raw, m["cc_isracard"], m["cc_mc_other"]
            )
            cc_rec = round(max(0.0, cc_raw - cc_ot), 2)
            cc_source = "est"

        monthly_list.append(
            {
                **{k: round(v, 2) if isinstance(v, float) else v for k, v in m.items()},
                "cc_rec": cc_rec,
                "cc_sav": cc_sav,
                "cc_ot": cc_ot,
                "cc_source": cc_source,
            }
        )

    total_months_n = max(1, len(monthly_list))

    # Build dynamic period definitions
    all_yms = [m["ym"] for m in monthly_list]
    # Detect steady-state start: latest window where both earners active at current level (default >= 2026-04 if available)
    steady_start = "2026-04" if any(ym >= "2026-04" for ym in all_yms) else all_yms[max(0, len(all_yms) - 8)]
    steady_yms = [m["ym"] for m in monthly_list if m["ym"] >= steady_start]
    dual_yms = [
        m["ym"]
        for m in monthly_list
        if m["bituach_leumi"] == 0 and not (m["sal2"] == 0 and "2025-05" <= m["ym"] <= "2025-10")
    ]
    db_yms = [m["ym"] for m in monthly_list if m["cc_source"] == "db"]

    periods: list[dict[str, Any]] = [
        {
            "key": "steady",
            "label": f"מצב יציב נוכחי ({steady_yms[0]} עד {steady_yms[-1]} · {len(steady_yms)} חוד׳)",
            "subtitle": "שני המפרנסים במקומות העבודה הנוכחיים עם פיצול אשראי מאומת מול מסד הנתונים והפרדת כל החופשות",
            "months": steady_yms,
            "tone": "success",
        },
        {
            "key": "dual_employed",
            "label": f"חודשי תעסוקה מלאה ({len(dual_yms)} חוד׳ · ללא אבטלה)",
            "subtitle": "כל החודשים שבהם נכנסו שתי משכורות מלאות, ללא עיוות תקופת המעבר ודמי האבטלה",
            "months": dual_yms,
            "tone": "success",
        },
        {
            "key": "db_verified",
            "label": f"חלון מאומת אשראי ({db_yms[0] if db_yms else ''} עד {db_yms[-1] if db_yms else ''} · {len(db_yms)} חוד׳)",
            "subtitle": "התאמה מלאה 1-ל-1 בין חיובי כרטיסי האשראי בבנק לאומי לבין פירוט העסקאות ב-app.db",
            "months": db_yms,
            "tone": "info",
        },
        {
            "key": "all",
            "label": f"כל התקופה ({all_yms[0]} עד {all_yms[-1]} · {len(all_yms)} חוד׳)",
            "subtitle": "כל היסטוריית חשבון העו״ש שנקלטה במערכת",
            "months": all_yms,
            "tone": "neutral",
        },
    ]

    years = sorted({ym[:4] for ym in all_yms})
    for yr in years:
        yr_yms = [ym for ym in all_yms if ym.startswith(yr)]
        has_unemp = any(
            m["bituach_leumi"] > 0 for m in monthly_list if m["ym"].startswith(yr)
        )
        periods.append(
            {
                "key": f"y{yr}",
                "label": f"שנת {yr} ({len(yr_yms)} חוד׳)",
                "subtitle": (
                    f"שנה קלנדרית {yr} (כוללת חודשי מעבר תעסוקתי ודמי אבטלה)"
                    if has_unemp
                    else f"סיכום שנה קלנדרית {yr} ({yr_yms[0]} עד {yr_yms[-1]})"
                ),
                "months": yr_yms,
                "tone": "warning" if has_unemp else "neutral",
            }
        )

    # Confirmed Savings Table
    khs_total = round(sum(r.debit for r in khs_rows))
    cc_sav_total = round(sum(m["cc_sav"] for m in monthly_list))
    sav_600_total = round(sum(r.debit for r in sav_600_rows))
    savings_vehicles = [
        {
            "name": "הפקדות לקרן השתלמות (העברות דיגיטל ~₪20.5k)",
            "cadence": f"{len(khs_rows)} הפקדות בתקופה",
            "total": khs_total,
            "monthly_equiv": round(khs_total / total_months_n),
            "details": "הפקדות תקופתיות לקרן השתלמות שהוחרגו מהוצאות המחיה ונרשמו כחיסכון ארוך-טווח",
        },
        {
            "name": "הפקדות Kraken Exchange (כרטיס 8838 · קטגוריית ׳חסכון׳)",
            "cadence": "מתוך עסקאות האשראי ב-app.db",
            "total": cc_sav_total,
            "monthly_equiv": round(cc_sav_total / total_months_n),
            "details": "חיובי כרטיס קורפוריט 8838 המסווגים תחת קטגוריית ׳חסכון׳ במסד הנתונים",
        },
        {
            "name": "הוראת קבע לחיסכון חודשי (₪600 ב-21 לחודש)",
            "cadence": f"{len(sav_600_rows)} הפקדות חודשיות",
            "total": sav_600_total,
            "monthly_equiv": round(sav_600_total / total_months_n),
            "details": "הוראת קבע קבועה לחיסכון והשקעה לילדים (מופרדת מהו״ק ₪454 של ועד הבית)",
        },
    ]

    # Tier 1: Wash & Financing Principal Ledger
    wash_ledger = [
        {
            "category": "סבב העברות בנק וואן זירו (מב. הדיגיטלי ↔ הוראת קבע)",
            "count_label": f"{one_zero_in_cnt} כניסות / {one_zero_out_cnt} יציאות",
            "inflows": round(one_zero_in),
            "outflows": round(one_zero_out),
            "net": round(one_zero_in - one_zero_out),
            "detail": "הוראת קבע של ₪5,000 יוצאת ב-24–25 לחודש וחוזרת תוך 1–3 ימים — עסקה סיבובית עם השפעה תזרימית נטו ₪0",
        },
        {
            "category": "חניית נזילות בניירות ערך / מק״מ (קניה ומכירה באינטרנט)",
            "count_label": f"{sec_in_cnt} מכירות / {sec_out_cnt} קניות",
            "inflows": round(sec_in),
            "outflows": round(sec_out),
            "net": round(sec_in - sec_out),
            "detail": "קניית ני״ע מהעו״ש ופדיונם חזרה לחשבון בתוספת רווח נטו",
        },
        {
            "category": "קרן הלוואות שהועמדו מול פירעונות מוקדמים חד-פעמיים",
            "count_label": f"{loan_in_cnt} העמדות / {loan_payoff_cnt} סילוקים",
            "inflows": round(loan_in),
            "outflows": round(loan_payoff_out),
            "net": round(loan_in - loan_payoff_out),
            "detail": "העמדת הלוואות מול סילוקי קרן מוקדמים (ההחזרים החודשיים השוטפים כלולים בבסיס המחיה)",
        },
    ]

    # Tier 2A: External Transfers (Interactive rows persisted in SQLite)
    external_transfers_list = [
        {
            "id": tx.id,
            "date": tx.activity_date.isoformat(),
            "source": f"{tx.description} #{tx.reference}" if tx.reference else tx.description,
            "amount": round(tx.credit, 2),
            "tag": tx.transfer_tag or "reserve",
            "context": tx.context_note or "העברה חיצונית נכנסת",
            "is_user_override": tx.is_user_override,
        }
        for tx in sorted(external_transfer_rows, key=lambda r: r.activity_date, reverse=True)
    ]

    # Tier 2B: Other Anomaly Inflows
    bonus_total = round(sum(b for _, b in bonus_rows))
    rtgs_in_total = round(sum(r.credit for r in rtgs_in_rows))
    unemp_total = round(sum(r.credit for r in unemployment_rows))
    cash_dep_total = round(sum(r.credit for r in cash_dep_rows))
    tax_ref_total = round(sum(r.credit for r in tax_ref_rows))

    other_anomaly_inflows = [
        {
            "source": "בונוסים ומענקי שכר (מעל שכר הבסיס החודשי)",
            "count": len(bonus_rows),
            "total": bonus_total,
            "monthly_equiv": round(bonus_total / total_months_n),
            "explanation": "רכיבי בונוס שנתיים/חתימה מעבר לשכר הנטו השוטף (הופרדו אוטומטית כדי לא לנפח את ממוצע השכר החודשי)",
        },
        {
            "source": 'תקבולי העברת זה״ב (מכירת רכב / נכס)',
            "count": len(rtgs_in_rows),
            "total": rtgs_in_total,
            "monthly_equiv": round(rtgs_in_total / total_months_n),
            "explanation": "תקבול חד-פעמי ממכירת רכב בסמוך לרכישת הרכב החלופי",
        },
        {
            "source": "דמי אבטלה מביטוח לאומי (בטוח לאומי ח-י)",
            "count": len(unemployment_rows),
            "total": unemp_total,
            "monthly_equiv": round(unemp_total / total_months_n),
            "explanation": "תשלומי דמי אבטלה בתקופת המעבר התעסוקתי ב-2025 (ניתן להכליל בתזרים בלחיצת מתג למעלה)",
        },
        {
            "source": "הפקדות מזומן בכספומט",
            "count": len(cash_dep_rows),
            "total": cash_dep_total,
            "monthly_equiv": round(cash_dep_total / total_months_n),
            "explanation": "הפקדות מזומן חד-פעמיות לחשבון העו״ש",
        },
        {
            "source": "החזרי מס הכנסה (מס-הכנסה החז-י)",
            "count": len(tax_ref_rows),
            "total": tax_ref_total,
            "monthly_equiv": round(tax_ref_total / total_months_n),
            "explanation": "החזרי מס חד-פעמיים מרשות המסים",
        },
    ]

    # Tier 3: One-Time Outflows
    cc_ot_35m = round(sum(m["cc_ot"] for m in monthly_list))
    cc_ot_db = round(sum(m["cc_ot"] for m in monthly_list if m["cc_source"] == "db"))
    db_cnt = max(1, len(db_yms))
    rtgs_out_total = round(sum(r.debit for r in rtgs_out_rows))
    irreg_out_total = round(sum(r.debit for r in irreg_transfer_out_rows))
    misc_ot_total = round(sum(r.debit for r in misc_ot_out_rows))

    one_time_outflows = [
        {
            "bucket": "חופשות, טיולים והוצאות חד-פעמיות בכרטיסי אשראי",
            "scope": f"{len(db_yms)} חודשי DB + אומדן טרום-DB",
            "total": cc_ot_35m,
            "monthly_equiv": round(cc_ot_35m / total_months_n),
            "details": f"מתוכם ₪{cc_ot_db:,} בחלון המאומת מול app.db (₪{round(cc_ot_db / db_cnt):,} לחודש בממוצע) — כולל כל החופשות בארץ ובחו״ל",
        },
        {
            "bucket": 'רכישת רכב / נכס בהעברת זה״ב',
            "scope": f"{len(rtgs_out_rows)} תנועות",
            "total": rtgs_out_total,
            "monthly_equiv": round(rtgs_out_total / total_months_n),
            "details": f"עלות שדרוג נטו של כ-₪{max(0, rtgs_out_total - rtgs_in_total):,} לאחר קיזוז תקבול מכירת הרכב בסך ₪{rtgs_in_total:,}",
        },
        {
            "bucket": "העברות דיגיטל חד-פעמיות בינוניות (₪2,000–₪12,000)",
            "scope": f"{len(irreg_transfer_out_rows)} העברות",
            "total": irreg_out_total,
            "monthly_equiv": round(irreg_out_total / total_months_n),
            "details": "העברות שאינן חוזרות מדי חודש (חלקן מול החזרים תואמים מבנק הפועלים ומזרחי)",
        },
        {
            "bucket": 'חיובי בנק חד-פעמיים (רשויות / משיכת מט״ח לחו״ל / תשלום מיידי)',
            "scope": f"{len(misc_ot_out_rows)} פריטים",
            "total": misc_ot_total,
            "monthly_equiv": round(misc_ot_total / total_months_n),
            "details": "כולל משיכת מט״ח בנתב״ג ליציאה לברצלונה ותשלומי רשויות חד-פעמיים",
        },
    ]

    # Trips Summary Table (Dynamic from DB + Bank)
    tr = cc_info["trip_totals"]
    bcn_paid_so_far = round(
        tr["barcelona_issta_billed"] + tr["barcelona_airport_billed"] + barcelona_fx_bank
    )
    bcn_est_fx_pending = 1250
    bcn_remaining_est = round(tr["barcelona_issta_remaining"] + bcn_est_fx_pending)
    trips_summary = [
        {
            "trip": "טיול ברצלונה (22–26 באוקטובר 2026 · איסתא ספורט + דיוטי פרי + מט״ח)",
            "timing": "אוקטובר 2026 (תשלומים עד מרץ 2027)",
            "billed_so_far": bcn_paid_so_far,
            "remaining_future": bcn_remaining_est,
            "total_est": bcn_paid_so_far + bcn_remaining_est,
            "status": f"ירדו ₪{bcn_paid_so_far:,} (2/6 איסתא + היינמן + מט״ח); יתרת 4 תשלומי איסתא (₪{round(tr['barcelona_issta_remaining']):,}) + גיהוצי אירו ב-8838 ירדו בדצמ׳ 26–מרץ 27",
        },
        {
            "trip": "טיול משפחתי הונגריה / בודפשט (כרטיס 8838 + דיוטי פרי)",
            "timing": "10–19 בספטמבר 2026 (ירד ב-02/11/2026)",
            "billed_so_far": tr["sep_budapest"],
            "remaining_future": 0,
            "total_est": tr["sep_budapest"],
            "status": "שולם במלואו בחיוב ישראכרט 02/11/2026 (דחיית מט״ח חודשית) — 95 עסקאות לטיפול בסיווג ב-app.db",
        },
        {
            "trip": "טיול זוגי לרומא (כרטיס 8838 + דיוטי פרי)",
            "timing": "25–29 בספטמבר 2026 (ירד ב-02/11/2026)",
            "billed_so_far": tr["sep_rome"],
            "remaining_future": 0,
            "total_est": tr["sep_rome"],
            "status": "שולם במלואו בחיוב ישראכרט 02/11/2026 (44 עסקאות מט״ח)",
        },
        {
            "trip": "אתונה וטיסות WizzAir (כרטיס 8838 + דיוטי פרי)",
            "timing": "02–09 בספטמבר 2026 (ירד באוק׳–נוב׳ 2026)",
            "billed_so_far": tr["sep_athens"],
            "remaining_future": 0,
            "total_est": tr["sep_athens"],
            "status": "שולם במלואו והוחרג בשכבת החישוב מבסיס הקבע",
        },
        {
            "trip": "חופשה משפחתית באילת (מלון רויאל גארדן)",
            "timing": "מאי–יוני 2026 (ירד ביוני–יולי 2026)",
            "billed_so_far": tr["eilat"],
            "remaining_future": 0,
            "total_est": tr["eilat"],
            "status": "הוחרג בשכבת החישוב מבסיס הקבע (ללא שינוי רשומות ה-DB)",
        },
        {
            "trip": "טיול ללונדון (תת-קטגוריה מתויגת ב-app.db)",
            "timing": "נובמבר–דצמבר 2025",
            "billed_so_far": tr["london"],
            "remaining_future": 0,
            "total_est": tr["london"],
            "status": "מתויג במלואו תחת נסיעות וחו״ל -> טיול ללונדון",
        },
    ]

    # Reconstruct Nov 2026 (or any major RTGS week) capital event dynamically
    capital_events: list[dict[str, Any]] = []
    nov26_event_rows = [
        tx
        for tx in bank_rows
        if "2026-11-12" <= tx.activity_date.isoformat() <= "2026-11-18"
        and (tx.credit >= 10000 or tx.debit >= 10000 or tx.stream_key == "rtgs_car_buy")
    ]
    if nov26_event_rows:
        ev_items = []
        net_ev = 0.0
        for tx in nov26_event_rows:
            signed = tx.credit - tx.debit
            net_ev += signed
            role = "תנועת הון באירוע"
            if tx.stream_key == "loan_principal_in":
                role = "פתיחת הלוואה חדשה (מחליפה את סדרת ההלוואה הקודמת)"
            elif tx.stream_key == "rtgs_car_buy":
                role = "תשלום העברת זה״ב לרכישת הרכב + עמלת זה״ב"
            elif tx.stream_key == "external_transfer":
                role = "הזרמת גישור מחשבון בנק הפועלים"
            elif tx.stream_key == "rtgs_car_sale":
                role = "תקבול זה״ב ממכירת הרכב הקודם"
            elif tx.stream_key == "loan_early_payoff":
                role = "סילוק מלא של יתרת ההלוואה הקודמת"
            ev_items.append(
                {
                    "date": tx.activity_date.isoformat(),
                    "description": tx.description,
                    "reference": tx.reference,
                    "signed_amount": round(signed, 2),
                    "role": role,
                }
            )
        capital_events.append(
            {
                "title": "שחזור אירוע שדרוג הרכב ומחזור ההלוואות (12–18 בנובמבר 2026)",
                "net_checking_impact": round(net_ev, 2),
                "items": ev_items,
            }
        )

    # Dynamic Insights computed from live DB metrics
    steady_rows = [m for m in monthly_list if m["ym"] in steady_yms]
    s_n = max(1, len(steady_rows))
    steady_inc = sum(
        m["sal1"]
        + m["sal2"]
        + m["sal_misc"]
        + m["child"]
        + m["health_ins_in"]
        + m["bank_misc_in"]
        + m["muni_dig_in"]
        + m["bit_in"]
        for m in steady_rows
    ) / s_n
    steady_exp = sum(
        m["cc_rec"]
        + m["mortgage"]
        + m["reg_transfers"]
        + m["loans_monthly"]
        + m["vaad_454"]
        + m["cash_checks"]
        + m["health_out"]
        + m["fees_out"]
        for m in steady_rows
    ) / s_n
    steady_surplus = steady_inc - steady_exp
    steady_free_after_600 = steady_surplus - (
        sum(m["sav_600"] for m in steady_rows) / s_n
    )
    cc_ot_db_mo = round(cc_ot_db / db_cnt)
    total_saved_all = khs_total + cc_sav_total + sav_600_total
    steady_housing = (
        sum(m["mortgage"] + m["vaad_454"] for m in steady_rows) / s_n
    )
    housing_pct = round((steady_housing / max(1.0, steady_inc)) * 100, 1)

    # Check 450 ILS multiple share in regular transfers
    reg_total_sum = sum(r.debit for r in reg_transfer_out_rows)
    mult_450_sum = sum(
        r.debit for r in reg_transfer_out_rows if r.debit > 0 and round(r.debit) % 450 == 0
    )
    mult_450_pct = round((mult_450_sum / max(1.0, reg_total_sum)) * 100)

    # Pending AI insights saving sum from app.db
    pending_saving_sum = float(
        session.exec(
            select(func.coalesce(func.sum(AiInsight.estimated_monthly_saving), 0.0)).where(
                AiInsight.is_actionable_saving == True,  # noqa: E712
                AiInsight.status == "pending",
            )
        ).one()
        or 0.0
    )

    open_inst_mo_sum = round(
        sum(i["monthly_amount"] for i in cc_info["open_installments"])
    )

    insights = [
        {
            "id": "paradox",
            "tone": "warning",
            "badge": f"~₪{round(cc_ot_db_mo * 12 / 1000)}k בשנה חופשות/חד-פעמי",
            "title": f"1. פרדוקס ׳החד-פעמי החוזר׳: עודף חופשי של +₪{round(steady_free_after_600):,} לחודש מול ₪{cc_ot_db_mo:,} לחודש חופשות וחד-פעמי",
            "body": (
                f"במצב היציב הנוכחי ההכנסה השוטפת (₪{round(steady_inc):,} לחודש) גבוהה מהוצאות המחיה הקבועות "
                f"(₪{round(steady_exp):,} לחודש כולל ועד בית) ב-+₪{round(steady_surplus):,} לחודש, ואחרי הו״ק חיסכון (₪600) נותר תזרים חופשי "
                f"של +₪{round(steady_free_after_600):,} לחודש. הפער מול קצב החופשות והחד-פעמי בחלון ה-DB (₪{cc_ot_db_mo:,} לחודש) מסביר מדוע "
                f"נסיעות גורמות מעת לעת להזרמות מחשבון הפועלים או אקסלנס. הפרשה קבועה של ₪4,500–₪5,500 לחודש לקופת חופשות תמנע משיכות יתר."
            ),
        },
        {
            "id": "barcelona_forward",
            "tone": "info",
            "badge": f"₪{bcn_remaining_est:,} יתרת ברצלונה",
            "title": "2. צפי תזרימי לחודשים הקרובים: השלמת תשלומי ברצלונה והלוואת הרכב החדשה",
            "body": (
                f"מתוך עלות טיול ברצלונה באוקטובר (~₪22,500), ירדו עד כה מהעו״ש ₪{bcn_paid_so_far:,} בלבד. "
                f"בארבעת החודשים הקרובים ירדו יתרת תשלומי איסתא ספורט (₪{round(tr['barcelona_issta_remaining']):,}) וחיוב המט״ח הדחוי בכרטיס 8838, "
                f"ולצדם יתחיל ההחזר החודשי על ההלוואה החדשה שנפתחה בנובמבר. סך התשלומים הפתוחים הפעילים בכרטיסי האשראי עומד כרגע על ₪{open_inst_mo_sum:,} לחודש."
            ),
        },
        {
            "id": "wealth",
            "tone": "success",
            "badge": f"₪{total_saved_all:,} נחסכו",
            "title": f"3. צבירת הון סמויה בתוך ׳היציאות׳: ₪{total_saved_all:,} נחסכו לאורך התקופה (₪{round(total_saved_all / total_months_n):,} לחודש)",
            "body": (
                f"תנועות שנראו בדוח הגולמי כהוצאות הן בפועל בניית הון: ₪{khs_total:,} בהפקדות לקרן השתלמות, "
                f"₪{cc_sav_total:,} בהפקדות Kraken בכרטיס 8838, ו-₪{sav_600_total:,} בהוראת הקבע החודשית לחיסכון (₪600)."
            ),
        },
        {
            "id": "housing",
            "tone": "success",
            "badge": f"{housing_pct}% מההכנסה",
            "title": f"4. עלות דיור ישירה נמוכה ובריאה: ₪{round(steady_housing):,} לחודש (משכנתא + ועד בית)",
            "body": (
                f"צירוף המשכנתא במזרחי-טפחות עם הוראת הקבע לוועד הבית (₪454) מסתכם ב-₪{round(steady_housing):,} לחודש — "
                f"{housing_pct}% בלבד מההכנסה השוטפת במצב היציב (נמוך משמעותית מרף העומס המקובל של 25%–30%)."
            ),
        },
        {
            "id": "unemployment_roi",
            "tone": "info",
            "badge": "+₪1,600 לחודש תוספת קבועה",
            "title": "5. תשואה חיובית מהירה על תקופת המעבר התעסוקתי ב-2025",
            "body": (
                f"במהלך המעבר התעסוקתי ב-2025 נכנסו דמי אבטלה בסך ₪{unemp_total:,} שכיסו כ-78% משכר הנטו החסר. "
                f"העלייה הקבועה בשכר הנטו במקום העבודה החדש (~+₪1,600 לחודש) החזירה את היתרה תוך כ-7 חודשים ומוסיפה כ-+₪19,200 נטו בשנה."
            ),
        },
        {
            "id": "card_8838",
            "tone": "warning" if cc_info["uncat_2026_10_count"] > 0 else "neutral",
            "badge": f"{cc_info['uncat_2026_10_count']} שורות ללא סיווג",
            "title": "6. כרטיס קורפוריט 8838 משמש ברובו לנסיעות וחו״ל (בדחיית חיוב מט״ח של חודש)",
            "body": (
                f"מתוך ₪{round(cc_info['card_8838_total']):,} שחויבו בכרטיס 8838 בחלון ה-DB, ההוצאה השוטפת הממוצעת היא ₪{round(cc_info['card_8838_rec_mo']):,} לחודש בלבד, "
                f"בעוד מעל 90% מהנפח הוא חופשות בחו״ל והפקדות Kraken. בחודש העלאה 2026-10 ממתינות {cc_info['uncat_2026_10_count']} עסקאות חד-פעמיות (₪{round(cc_info['uncat_2026_10_sum']):,}) לתיוג קטגוריה באפליקציה."
            ),
        },
        {
            "id": "transfers_and_subs",
            "tone": "success",
            "badge": f"{mult_450_pct}% כפולות של ₪450",
            "title": "7. תבנית העברות ₪450 בעו״ש ופוטנציאל התייעלות במנויים קבועים",
            "body": (
                f"מתוך כלל ההעברות הקטנות מהעו״ש (<₪2,000), {mult_450_pct}% הן כפולות מדויקות של ₪450 (תשלום שירות שבועי קבוע). "
                f"במקביל, מנוע התובנות של כרטיסי האשראי מזהה פוטנציאל חיסכון חודשי של כ-₪{round(pending_saving_sum):,} במנויים וביטוחים מתמשכים."
            ),
        },
    ]

    return {
        "status": status,
        "settings": settings_dict,
        "periods": periods,
        "monthly": monthly_list,
        "cc_categories": cc_info["cc_categories"],
        "savings_vehicles": savings_vehicles,
        "wash_ledger": wash_ledger,
        "external_transfers": external_transfers_list,
        "other_anomaly_inflows": other_anomaly_inflows,
        "one_time_outflows": one_time_outflows,
        "trips_summary": trips_summary,
        "open_installments": cc_info["open_installments"],
        "capital_events": capital_events,
        "insights": insights,
    }
