"""Incremental non-destructive bank statement upload & deterministic Hebrew classification."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from statistics import median
from typing import Optional

from sqlmodel import Session, func, select

from ..models import BankTransaction, BankUpload
from .bank_parser import ParsedBankRow, parse_bank_statement_bytes


@dataclass
class BankClassification:
    flow_group: str
    stream_key: str
    transfer_tag: Optional[str] = None
    context_note: Optional[str] = None


@dataclass
class BankUploadResult:
    upload: BankUpload
    inserted_count: int
    skipped_duplicates_count: int
    total_rows_in_file: int
    previous_max_date: Optional[date]
    new_max_date: Optional[date]


# Contextual notes & default transfer tags for external bank transfers
def _default_external_transfer_metadata(
    act_date: date, desc: str, ref: str, credit: float
) -> tuple[str, str]:
    iso = act_date.isoformat()
    if "אקסלנס" in desc:
        if credit >= 50000:
            return (
                "stock",
                "פדיון מאקסלנס; מימן למחרת שתי הפקדות לקרן השתלמות (2×₪20,566)",
            )
        return ("stock", "משיכה / פדיון מחשבון השקעות אקסלנס")
    if "המרת מט" in desc:
        return ("stock", "המרת מט״ח לשקלים (מימוש מניות RSU/ESPP או יתרת מט״ח)")
    if "הפקדת שיק" in desc:
        return ("gift", "הפקדת שיק (שלושה ימים לפני שתי העברות יוצאות של ₪5,500)")
    if "בנק מזרחי" in desc:
        if abs(credit - 2160.0) < 1.0:
            return ("reimbursement", "תואם על השקל להעברה יוצאת של -₪2,160 מיום 29/07/2025")
        if credit >= 10000:
            return ("gift", "כיסה יתרת חובה בעו״ש לאחר חיובי נובמבר–דצמבר")
        return ("reimbursement", "העברה נכנסת מבנק מזרחי")
    if "בנק הפועלים" in desc:
        if iso == "2024-07-08":
            return ("gift", "6 ימים לאחר חיוב אשראי קיץ גבוה של ₪42.2k")
        if iso == "2025-02-09":
            return ("gift", "באותו שבוע של הפקדת שיק ₪12k ושתי העברות של ₪5,500")
        if iso == "2025-04-07" or credit >= 35000 and credit < 45000:
            return ("stock", "סכום מדויק לא-עגול; באותו חודש של המרת מט״ח ₪30.3k וקרן השתלמות")
        if iso == "2025-06-27":
            return ("reserve", "במהלך תקופת המעבר התעסוקתי (מאי–אוקטובר 2025)")
        if abs(credit - 6300.0) < 1.0:
            return ("reimbursement", "תואם על השקל להעברה יוצאת של -₪6,300 מיום 19/08/2025")
        if abs(credit - 5140.0) < 1.0:
            return ("reimbursement", "באותו יום של העברה יוצאת בסך -₪6,300")
        if iso == "2026-09-23":
            return ("stock", "לקראת נסיעות ספטמבר–אוקטובר ופעילות רבעון 4")
        if iso == "2026-11-17" or credit >= 45000:
            return ("reserve", "5 ימים לאחר רכישת הרכב בזה״ב (₪158k) ויום לפני סילוק הלוואה (₪70k)")
        if credit < 2000:
            return ("reimbursement", "העברה קטנה מחשבון בנק הפועלים (<₪2,000)")
        return ("reserve", "העברה נכנסת מחשבון בנק הפועלים")
    return ("reserve", "העברה חיצונית נכנסת")


def classify_bank_row(row: ParsedBankRow) -> BankClassification:
    """Deterministic classification of a Bank Leumi checking row."""
    desc = row.description
    cred = row.credit
    deb = row.debit

    # -------------------- INFLOWS (CREDITS) --------------------
    if cred > 0:
        # 1. Pure washes & loan principal inflows
        if "מב. הדיגיטלי" in desc and abs(cred - 5000.0) < 5.0:
            return BankClassification("wash_in", "one_zero_wash")
        if "מכירה-אינטרנט" in desc:
            return BankClassification("wash_in", "securities_sale")
        if "העמדת הלואה" in desc or "העמדת הלוואה" in desc:
            return BankClassification("wash_in", "loan_principal_in")
        if "ישראכרט" in desc or "ל.מאסטרקארד" in desc:
            return BankClassification("wash_in", "cc_refund_wash")

        # 2. Primary & Secondary Salaries
        if "סימילרווב" in desc:
            return BankClassification("income_regular", "sal_primary")
        if desc == "העברת משכורת":
            if cred >= 10000.0:
                return BankClassification("income_regular", "sal_primary")
            return BankClassification("income_regular", "sal_misc")
        if "ארו/רפק" in desc or "יו-ביטק" in desc:
            return BankClassification("income_regular", "sal_secondary")

        # 3. Child allowance
        if "קצבת ילדים" in desc:
            return BankClassification("income_regular", "child_allowance")

        # 4. Unemployment benefits (Bituach Leumi)
        if "בטוח לאומי" in desc:
            return BankClassification(
                "income_unemployment",
                "unemployment_benefits",
                context_note="דמי אבטלה מביטוח לאומי",
            )

        # 5. Confirmed recurring municipality + monthly digital inflows
        if "עירית רעננה" in desc or desc == "העברה דיגיטל":
            return BankClassification("income_regular", "muni_digital_in")

        # 6. Bit P2P inflows
        if "הפועלים-ביט" in desc or "פייבוקס" in desc:
            return BankClassification("income_regular", "bit_in")

        # 7. Health, insurance & bank grants/interest
        if any(
            k in desc
            for k in (
                "שירותי בריאו",
                "שרותי בריאות",
                "פמי פרימיום",
                "איילון חברה",
                "מגדל מקפת",
            )
        ):
            return BankClassification("income_regular", "health_ins_in")

        if any(
            k in desc
            for k in (
                "מענק בנק לאומי",
                "רבית זכות",
                "החזר פריים",
                "החזר ריבית",
                "החזר עמ.הקצאה",
                "הח.ע.עסקי",
                "זיכוי מיידי",
                "העברה ברשימה",
            )
        ):
            return BankClassification("income_regular", "bank_misc_in")

        if "הפקדת שיק" in desc and cred < 1000.0:
            return BankClassification("income_regular", "bank_misc_in")

        # 8. Non-recurring / Capital / External transfers
        if "העברת זה\"ב" in desc or "העברת זהב" in desc:
            return BankClassification(
                "income_anomaly",
                "rtgs_car_sale",
                context_note="תקבול העברת זה״ב (מכירת רכב / נכס)",
            )
        if "מס-הכנסה החז" in desc:
            return BankClassification("income_anomaly", "tax_refund")
        if "מזומן" in desc:
            return BankClassification("income_anomaly", "cash_deposit")
        if any(
            k in desc
            for k in ("בנק הפועלים", "בנק מזרחי", "אקסלנס", "המרת מט", "הפקדת שיק")
        ):
            tag, note = _default_external_transfer_metadata(
                row.activity_date, desc, row.reference, cred
            )
            return BankClassification(
                "income_anomaly",
                "external_transfer",
                transfer_tag=tag,
                context_note=note,
            )

        # Fallback for future large vs small credits
        if cred >= 5000.0:
            return BankClassification("income_anomaly", "other_anomaly_in")
        return BankClassification("income_regular", "bank_misc_in")

    # -------------------- OUTFLOWS (DEBITS) --------------------
    # 1. Credit card debits (matched to credit-spend-analyzer DB)
    if any(k in desc for k in ("ל.מאסטרקארד", "ישראכרט", "כרטיסי אשראי-י")):
        stream = "cc_isracard" if "ישראכרט" in desc else "cc_mastercard"
        return BankClassification("expense_cc", stream)

    # 2. Washes & Early Loan Payoffs
    if desc == "הוראת קבע" and abs(deb - 5000.0) < 5.0:
        return BankClassification("wash_out", "one_zero_wash")
    if "קניה-אינטרנט" in desc:
        return BankClassification("wash_out", "securities_buy")
    if "פרעון הלוואה" in desc:
        if deb >= 5000.0:
            return BankClassification("wash_out", "loan_early_payoff")
        return BankClassification("expense_living", "loans_monthly")

    # 3. Confirmed Standing Orders: ₪454 Va'ad Bayit vs ₪600 Savings
    if desc == "הוראת קבע":
        if abs(deb - 454.0) < 15.0:
            return BankClassification("expense_living", "vaad_454")
        if abs(deb - 600.0) < 25.0:
            return BankClassification("savings", "sav_600")
        return BankClassification("expense_living", "standing_order_other")

    # 4. Mortgage
    if "משכנתא" in desc:
        return BankClassification("expense_living", "mortgage")

    # 5. Digital & Internet transfers: Keren Hishtalmut (~₪20.5k) vs <₪2k regular vs >=₪2k one-time
    if desc in ("העברה דיגיטל", "הע. אינטרנט"):
        if 19000.0 <= deb <= 22000.0:
            return BankClassification(
                "savings",
                "khs_20k",
                context_note="הפקדה לקרן השתלמות",
            )
        if deb >= 2000.0:
            return BankClassification("expense_anomaly", "irregular_transfer_out")
        return BankClassification("expense_living", "reg_transfers")

    # 6. Cash withdrawals & checks
    if "משיכת מזומן" in desc or desc == "שיק":
        return BankClassification("expense_living", "cash_checks")

    # 7. Health fund direct debits
    if "שירותי בריאו" in desc or "שרותי בריאות" in desc:
        return BankClassification("expense_living", "health_out")

    # 8. Large RTGS purchase (vehicle/asset) & one-off FX/Gov charges
    if "העברת זה\"ב" in desc or "העברת זהב" in desc or "עמ.גל\"י לבנקים" in desc:
        return BankClassification("expense_anomaly", "rtgs_car_buy")
    if any(
        k in desc
        for k in ("משיכת מט\"ח", "תשלום מיידי", "רשויות אינטרנט", "עמ.העברת מטח")
    ):
        return BankClassification("expense_anomaly", "misc_one_time_out")

    # 9. Bank fees & minor taxes
    return BankClassification("expense_living", "fees_out")


def refresh_salary_bonus_splits(session: Session) -> None:
    """Detect salary rows containing an annual/sign-on bonus spike (>₪5,000 above employer median base).

    Idempotent and respects ``is_user_override == True``.
    Sets ``split_base_amount`` on the salary row so regular income keeps the normal monthly net
    salary while the bonus portion is reported transparently in ``income_anomaly``.
    """
    salary_rows = list(
        session.exec(
            select(BankTransaction)
            .where(BankTransaction.stream_key.in_(["sal_primary", "sal_secondary"]))
            .order_by(BankTransaction.activity_date.asc())
        ).all()
    )
    if not salary_rows:
        return

    # Group by employer description + year half/neighboring window so raises (e.g. Apr 2026) aren't treated as bonuses
    by_desc: dict[str, list[BankTransaction]] = {}
    for r in salary_rows:
        by_desc.setdefault(r.description, []).append(r)

    updated = False
    for desc, txs in by_desc.items():
        n = len(txs)
        for idx, tx in enumerate(txs):
            if tx.is_user_override:
                continue
            # Look at up to 3 neighboring payments before and after from the same employer
            win_start = max(0, idx - 3)
            win_end = min(n, idx + 4)
            peers = [
                p.credit
                for j, p in enumerate(txs[win_start:win_end], start=win_start)
                if j != idx and p.credit > 4000.0
            ]
            if not peers:
                continue
            # Filter out other extreme spikes from peer baseline
            low_peers = sorted(peers)[: max(1, len(peers) - 1)] if len(peers) >= 3 else peers
            base_est = float(median(low_peers))
            if tx.credit - base_est > 5000.0:
                # Round to nearest 100 ILS for clean base separation (e.g. 24,800 / 28,000 / 9,500)
                clean_base = round(base_est / 100.0) * 100.0
                if tx.split_base_amount != clean_base:
                    tx.split_base_amount = clean_base
                    session.add(tx)
                    updated = True
            else:
                if tx.split_base_amount is not None:
                    tx.split_base_amount = None
                    session.add(tx)
                    updated = True

    if updated:
        session.commit()


def ingest_bank_statement_bytes(
    session: Session,
    content: bytes,
    filename: str,
    content_type: Optional[str] = None,
) -> BankUploadResult:
    """Parse and incrementally append new bank statement rows without overwriting existing data."""
    parsed = parse_bank_statement_bytes(content)
    file_hash = hashlib.sha256(content).hexdigest()

    prev_max: Optional[date] = session.exec(
        select(func.max(BankTransaction.activity_date))
    ).one()

    existing_sigs = set(session.exec(select(BankTransaction.row_signature)).all())
    new_rows = [r for r in parsed.rows if r.row_signature not in existing_sigs]
    skipped = len(parsed.rows) - len(new_rows)

    if not new_rows:
        existing_upload = session.exec(
            select(BankUpload)
            .where(BankUpload.file_hash == file_hash)
            .order_by(BankUpload.id.desc())
        ).first()
        if existing_upload is not None:
            return BankUploadResult(
                upload=existing_upload,
                inserted_count=0,
                skipped_duplicates_count=skipped,
                total_rows_in_file=len(parsed.rows),
                previous_max_date=prev_max,
                new_max_date=prev_max,
            )

    upload = BankUpload(
        original_filename=filename or "bank_statement.xls",
        content_type=content_type,
        size_bytes=len(content),
        file_hash=file_hash,
        account_number=parsed.account_number,
        date_from=parsed.date_from,
        date_to=parsed.date_to,
        previous_max_date=prev_max,
        inserted_count=0,
        skipped_duplicates_count=0,
    )
    session.add(upload)
    session.commit()
    session.refresh(upload)

    inserted = 0
    for row in new_rows:
        if row.row_signature in existing_sigs:
            skipped += 1
            continue

        cls = classify_bank_row(row)
        db_row = BankTransaction(
            bank_upload_id=upload.id,
            account_number=row.account_number,
            activity_date=row.activity_date,
            value_date=row.value_date,
            month=row.month,
            chronological_order=row.chronological_order,
            description=row.description,
            reference=row.reference,
            debit=row.debit,
            credit=row.credit,
            balance=row.balance,
            row_signature=row.row_signature,
            flow_group=cls.flow_group,
            stream_key=cls.stream_key,
            transfer_tag=cls.transfer_tag,
            context_note=cls.context_note,
            is_user_override=False,
        )
        session.add(db_row)
        existing_sigs.add(row.row_signature)
        inserted += 1

    upload.inserted_count = inserted
    upload.skipped_duplicates_count = skipped
    session.add(upload)
    session.commit()
    session.refresh(upload)

    if inserted > 0:
        refresh_salary_bonus_splits(session)

    new_max: Optional[date] = session.exec(
        select(func.max(BankTransaction.activity_date))
    ).one()

    return BankUploadResult(
        upload=upload,
        inserted_count=inserted,
        skipped_duplicates_count=skipped,
        total_rows_in_file=len(parsed.rows),
        previous_max_date=prev_max,
        new_max_date=new_max,
    )
