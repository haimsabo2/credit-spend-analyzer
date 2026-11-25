"""FastAPI router for Bank & Household Cashflow endpoints (/api/bank)."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import BankTransaction
from ..services.bank_cashflow import (
    compute_bank_analysis,
    get_bank_status,
    get_or_create_bank_settings,
)
from ..services.bank_uploads import ingest_bank_statement_bytes

router = APIRouter()

VALID_FLOW_GROUPS = {
    "income_regular",
    "income_unemployment",
    "income_anomaly",
    "wash_in",
    "expense_cc",
    "expense_living",
    "savings",
    "expense_anomaly",
    "wash_out",
}

VALID_TRANSFER_TAGS = {"stock", "gift", "reimbursement", "reserve"}


class BankSettingsPayload(BaseModel):
    inc_muni_dig: bool
    inc_bit: bool
    inc_bituach_leumi: bool
    inc_sav_600_as_expense: bool
    inc_khs_as_expense: bool


class BankTransactionPatchPayload(BaseModel):
    flow_group: Optional[str] = None
    transfer_tag: Optional[str] = None
    context_note: Optional[str] = None


@router.get("/status")
def bank_status(session: SessionDep):
    """Return current sync watermark (last transaction date, row count, upload history)."""
    return get_bank_status(session)


@router.get("/analysis")
def bank_analysis(session: SessionDep):
    """Return full dynamic household cashflow analysis joined read-only with credit card DB."""
    return compute_bank_analysis(session)


@router.post("/uploads")
def upload_bank_statements(
    session: SessionDep,
    files: List[UploadFile] = File(...),
):
    """Incrementally ingest one or more Bank Leumi .xls checking statements without overwriting."""
    if not files:
        raise HTTPException(status_code=400, detail="לא נבחרו קבצים להעלאה.")

    results = []
    total_inserted = 0
    total_skipped = 0
    overall_prev_max = None
    overall_new_max = None

    for idx, uf in enumerate(files):
        content = uf.file.read()
        try:
            res = ingest_bank_statement_bytes(
                session,
                content=content,
                filename=uf.filename or "bank_statement.xls",
                content_type=uf.content_type,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if idx == 0:
            overall_prev_max = res.previous_max_date
        overall_new_max = res.new_max_date
        total_inserted += res.inserted_count
        total_skipped += res.skipped_duplicates_count
        results.append(
            {
                "upload_id": res.upload.id,
                "filename": res.upload.original_filename,
                "account_number": res.upload.account_number,
                "date_from": res.upload.date_from.isoformat() if res.upload.date_from else None,
                "date_to": res.upload.date_to.isoformat() if res.upload.date_to else None,
                "inserted_count": res.inserted_count,
                "skipped_duplicates_count": res.skipped_duplicates_count,
                "total_rows_in_file": res.total_rows_in_file,
            }
        )

    return {
        "files_processed": len(results),
        "total_inserted": total_inserted,
        "total_skipped_duplicates": total_skipped,
        "previous_max_date": overall_prev_max.isoformat() if overall_prev_max else None,
        "new_max_date": overall_new_max.isoformat() if overall_new_max else None,
        "files": results,
    }


@router.get("/transactions")
def list_bank_transactions(
    session: SessionDep,
    month: Optional[str] = Query(default=None, description="Filter by YYYY-MM"),
    flow_group: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, description="Search description or reference"),
    limit: int = Query(default=300, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
):
    """List checking-account rows with optional filters for the Bank Ledger tab."""
    stmt = select(BankTransaction)
    if month:
        stmt = stmt.where(BankTransaction.month == month)
    if flow_group:
        stmt = stmt.where(BankTransaction.flow_group == flow_group)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            (BankTransaction.description.like(needle))
            | (BankTransaction.reference.like(needle))
        )

    all_matching = list(
        session.exec(
            stmt.order_by(
                BankTransaction.activity_date.desc(),
                BankTransaction.chronological_order.desc(),
                BankTransaction.id.desc(),
            )
        ).all()
    )
    total = len(all_matching)
    sliced = all_matching[offset : offset + limit]

    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "activity_date": r.activity_date.isoformat(),
                "value_date": r.value_date.isoformat() if r.value_date else None,
                "month": r.month,
                "description": r.description,
                "reference": r.reference,
                "debit": r.debit,
                "credit": r.credit,
                "balance": r.balance,
                "flow_group": r.flow_group,
                "stream_key": r.stream_key,
                "transfer_tag": r.transfer_tag,
                "context_note": r.context_note,
                "is_user_override": r.is_user_override,
            }
            for r in sliced
        ],
    }


@router.patch("/transactions/{tx_id}")
def patch_bank_transaction(
    tx_id: int,
    payload: BankTransactionPatchPayload,
    session: SessionDep,
):
    """Persist user classification or external-transfer tag override."""
    tx = session.get(BankTransaction, tx_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="תנועת הבנק לא נמצאה.")

    if payload.flow_group is not None:
        if payload.flow_group not in VALID_FLOW_GROUPS:
            raise HTTPException(status_code=400, detail="קבוצת תזרים לא חוקית.")
        tx.flow_group = payload.flow_group
        # Keep stream_key coherent when user flips flow_group manually
        if payload.flow_group == "savings" and tx.stream_key not in ("khs_20k", "sav_600"):
            tx.stream_key = "khs_20k" if tx.debit >= 5000 else "sav_600"
        elif payload.flow_group == "expense_living" and tx.stream_key in (
            "irregular_transfer_out",
            "misc_one_time_out",
            "khs_20k",
            "sav_600",
        ):
            tx.stream_key = "reg_transfers"
        elif payload.flow_group == "expense_anomaly" and tx.debit > 0:
            if tx.stream_key not in ("rtgs_car_buy", "irregular_transfer_out", "misc_one_time_out"):
                tx.stream_key = "irregular_transfer_out"
        elif payload.flow_group == "income_regular" and tx.credit > 0:
            if tx.stream_key in ("external_transfer", "other_anomaly_in", "cash_deposit", "tax_refund"):
                tx.stream_key = "muni_digital_in"
        elif payload.flow_group == "income_anomaly" and tx.credit > 0:
            if tx.stream_key not in ("external_transfer", "rtgs_car_sale", "cash_deposit", "tax_refund"):
                tx.stream_key = "external_transfer"

    if payload.transfer_tag is not None:
        if payload.transfer_tag not in VALID_TRANSFER_TAGS:
            raise HTTPException(status_code=400, detail="תג העברה לא חוקי.")
        tx.transfer_tag = payload.transfer_tag

    if payload.context_note is not None:
        tx.context_note = payload.context_note

    tx.is_user_override = True
    session.add(tx)
    session.commit()
    session.refresh(tx)

    return {
        "id": tx.id,
        "flow_group": tx.flow_group,
        "stream_key": tx.stream_key,
        "transfer_tag": tx.transfer_tag,
        "context_note": tx.context_note,
        "is_user_override": tx.is_user_override,
    }


@router.put("/settings")
def update_bank_settings(
    payload: BankSettingsPayload,
    session: SessionDep,
):
    """Save assumption toggle switches in SQLite."""
    row = get_or_create_bank_settings(session)
    row.inc_muni_dig = payload.inc_muni_dig
    row.inc_bit = payload.inc_bit
    row.inc_bituach_leumi = payload.inc_bituach_leumi
    row.inc_sav_600_as_expense = payload.inc_sav_600_as_expense
    row.inc_khs_as_expense = payload.inc_khs_as_expense
    row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return {
        "inc_muni_dig": row.inc_muni_dig,
        "inc_bit": row.inc_bit,
        "inc_bituach_leumi": row.inc_bituach_leumi,
        "inc_sav_600_as_expense": row.inc_sav_600_as_expense,
        "inc_khs_as_expense": row.inc_khs_as_expense,
    }


@router.delete("/reset")
def reset_bank_data(session: SessionDep):
    """Clear only bank checking-account uploads and rows (keeps all credit card data intact)."""
    session.execute(text("DELETE FROM bank_transaction"))
    session.execute(text("DELETE FROM bank_upload"))
    session.commit()
    return {"status": "ok"}
