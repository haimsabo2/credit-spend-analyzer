"""Business logic for file uploads: hashing, parsing, dedup, persistence."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, List, Optional

from fastapi import UploadFile
from sqlmodel import Session, select

from ..models import Transaction, Upload
from ..parsing.service import parse_xls_bytes
from ..schemas import AutoCategorizeSummary
from ..upload_storage import write_upload_file
from .batch_categorize import batch_categorize_transactions

CONFLICT_SAMPLE_LIMIT = 25


def build_raw_row_json(n: Any) -> Optional[str]:
    """JSON for raw_row_data: voucher, details, source_cells (8 strings)."""
    payload: dict = {}
    if getattr(n, "voucher_number", None):
        payload["voucher_number"] = n.voucher_number
    if getattr(n, "details", None):
        payload["details"] = n.details
    cells = getattr(n, "source_cells", None)
    if cells:
        payload["source_cells"] = cells
    return json.dumps(payload, ensure_ascii=False) if payload else None


def merge_raw_row_data(existing: Optional[str], n: Any) -> Optional[str]:
    """Merge parser fields into existing raw_row_data JSON."""
    base: dict = {}
    if existing:
        try:
            loaded = json.loads(existing)
            if isinstance(loaded, dict):
                base = loaded
        except json.JSONDecodeError:
            base = {}
    if getattr(n, "voucher_number", None):
        base["voucher_number"] = n.voucher_number
    if getattr(n, "details", None):
        base["details"] = n.details
    cells = getattr(n, "source_cells", None)
    if cells:
        base["source_cells"] = cells
    return json.dumps(base, ensure_ascii=False) if base else None


@dataclass
class UploadResult:
    """Rich result returned after processing an upload."""

    upload: Upload
    cards_detected: List[str] = field(default_factory=list)
    sections_detected: List[str] = field(default_factory=list)
    inserted_count: int = 0
    skipped_duplicates_count: int = 0
    skipped_noise_count: int = 0
    categorization: AutoCategorizeSummary = field(
        default_factory=lambda: AutoCategorizeSummary(
            processed=0,
            categorized=0,
            needs_review=0,
            failed=0,
            failures_sample=[],
        )
    )
    enrich_only: bool = False
    enriched_count: int = 0
    only_in_database_count: int = 0
    only_in_file_count: int = 0
    only_in_database_sample: List[dict] = field(default_factory=list)
    only_in_file_sample: List[dict] = field(default_factory=list)


def _delete_uploads_for_month(session: Session, month: str) -> None:
    """Remove all uploads and their transactions for the given YYYY-MM bucket."""
    uploads = list(session.exec(select(Upload).where(Upload.month == month)).all())
    for u in uploads:
        txs = list(session.exec(select(Transaction).where(Transaction.upload_id == u.id)).all())
        for t in txs:
            session.delete(t)
        session.delete(u)
    session.commit()


def _persist_upload_file(session: Session, upload: Upload, content: bytes) -> None:
    name = write_upload_file(upload.id, content)
    upload.stored_path = name
    session.add(upload)
    session.commit()
    session.refresh(upload)


def _handle_upload_enrich_only(
    session: Session,
    file: UploadFile,
    month: str,
) -> UploadResult:
    """Parse XLS and update source-trace fields on existing transactions for this month only."""
    content = file.file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    filename = file.filename or "report.xls"
    content_type = file.content_type

    upload = Upload(
        month=month,
        original_filename=filename,
        content_type=content_type,
        size_bytes=len(content),
        file_hash=file_hash,
        num_transactions=0,
    )
    session.add(upload)
    session.commit()
    session.refresh(upload)
    _persist_upload_file(session, upload, content)

    parse_result = parse_xls_bytes(content)
    normalized_list = parse_result.transactions

    cards_detected = sorted({n.card_label for n in normalized_list if n.card_label})
    sections_detected = sorted({n.section for n in normalized_list if n.section})

    by_sig: dict[str, Any] = {n.row_signature: n for n in normalized_list}
    file_sigs = set(by_sig.keys())

    db_txs = list(
        session.exec(
            select(Transaction)
            .join(Upload, Transaction.upload_id == Upload.id)
            .where(Upload.month == month)
        ).all()
    )
    db_sigs = {t.row_signature for t in db_txs}
    sig_to_tx = {t.row_signature: t for t in db_txs}

    only_in_db = db_sigs - file_sigs
    only_in_file = file_sigs - db_sigs
    matched = db_sigs & file_sigs

    enriched = 0
    for sig in matched:
        t = sig_to_tx[sig]
        n = by_sig[sig]
        t.source_row_1based = n.source_row_1based
        t.source_sheet_index = n.source_sheet_index
        t.source_trace_upload_id = upload.id
        t.raw_row_data = merge_raw_row_data(t.raw_row_data, n)
        session.add(t)
        enriched += 1

    upload.enriched_row_count = enriched
    session.add(upload)
    session.commit()
    session.refresh(upload)

    db_sample: list[dict] = []
    for t in db_txs:
        if t.row_signature not in only_in_db:
            continue
        db_sample.append(
            {
                "transaction_id": t.id,
                "row_signature": t.row_signature,
                "description": t.description,
                "posted_at": t.posted_at.isoformat() if t.posted_at else None,
            }
        )
        if len(db_sample) >= CONFLICT_SAMPLE_LIMIT:
            break

    file_sample: list[dict] = []
    for n in normalized_list:
        if n.row_signature not in only_in_file:
            continue
        file_sample.append(
            {
                "row_signature": n.row_signature,
                "merchant_raw": n.merchant_raw,
            }
        )
        if len(file_sample) >= CONFLICT_SAMPLE_LIMIT:
            break

    return UploadResult(
        upload=upload,
        cards_detected=cards_detected,
        sections_detected=sections_detected,
        inserted_count=0,
        skipped_duplicates_count=0,
        skipped_noise_count=parse_result.noise_rows_skipped,
        categorization=AutoCategorizeSummary(
            processed=0,
            categorized=0,
            needs_review=0,
            failed=0,
            failures_sample=[],
        ),
        enrich_only=True,
        enriched_count=enriched,
        only_in_database_count=len(only_in_db),
        only_in_file_count=len(only_in_file),
        only_in_database_sample=db_sample,
        only_in_file_sample=file_sample,
    )


def handle_upload(
    session: Session,
    file: UploadFile,
    month: str,
    *,
    replace_month: bool = False,
    defer_categorization: bool = False,
    enrich_only: bool = False,
) -> UploadResult:
    """Accept an uploaded .xls file and month; persist upload and transactions with dedup.

    If replace_month is True, delete every existing upload and transaction for this month
    before ingesting (full replace for that calendar bucket).

    If defer_categorization is True, rows are inserted but rules/dictionary/LLM are not run;
    call auto-categorize (or chunked endpoint) afterward.

    If enrich_only is True, do not insert transactions; only update source-trace fields on
    existing transactions for this month. Mutually exclusive with replace_month.
    """
    if enrich_only and replace_month:
        raise ValueError("enrich_only and replace_month cannot both be true")
    if enrich_only:
        return _handle_upload_enrich_only(session, file, month)

    if replace_month:
        _delete_uploads_for_month(session, month)

    content = file.file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    filename = file.filename or "report.xls"
    content_type = file.content_type

    upload = Upload(
        month=month,
        original_filename=filename,
        content_type=content_type,
        size_bytes=len(content),
        file_hash=file_hash,
        num_transactions=0,
    )
    session.add(upload)
    session.commit()
    session.refresh(upload)
    _persist_upload_file(session, upload, content)

    parse_result = parse_xls_bytes(content)
    normalized_list = parse_result.transactions

    cards_detected = sorted({
        n.card_label for n in normalized_list if n.card_label
    })
    sections_detected = sorted({
        n.section for n in normalized_list if n.section
    })

    sigs = [n.row_signature for n in normalized_list]
    existing_sigs: set[str] = set()
    if sigs:
        rows = session.exec(
            select(Transaction.row_signature).where(Transaction.row_signature.in_(sigs))
        ).all()
        existing_sigs = set(rows)

    inserted_txns: list[Transaction] = []
    for n in normalized_list:
        if n.row_signature in existing_sigs:
            continue
        raw_json = build_raw_row_json(n)
        posted_at = n.purchase_date or n.charge_date
        tx = Transaction(
            upload_id=upload.id,
            card_label=n.card_label,
            section=n.section,
            posted_at=posted_at,
            description=n.merchant_raw or "",
            amount=n.amount_charged,
            currency=n.currency_charged or "USD",
            row_signature=n.row_signature,
            raw_row_data=raw_json,
            source_row_1based=n.source_row_1based,
            source_sheet_index=n.source_sheet_index,
            source_trace_upload_id=upload.id,
        )
        session.add(tx)
        inserted_txns.append(tx)
        existing_sigs.add(n.row_signature)

    skipped_duplicates = len(normalized_list) - len(inserted_txns)

    upload.num_transactions = len(inserted_txns)
    upload.skipped_duplicates_count = skipped_duplicates
    session.add(upload)
    session.commit()
    session.refresh(upload)

    if defer_categorization:
        cat_summary = AutoCategorizeSummary(
            processed=0,
            categorized=0,
            needs_review=0,
            failed=0,
            failures_sample=[],
        )
    elif inserted_txns:
        for tx in inserted_txns:
            session.refresh(tx)
        cat_summary = batch_categorize_transactions(session, inserted_txns)
    else:
        cat_summary = AutoCategorizeSummary(
            processed=0,
            categorized=0,
            needs_review=0,
            failed=0,
            failures_sample=[],
        )

    return UploadResult(
        upload=upload,
        cards_detected=cards_detected,
        sections_detected=sections_detected,
        inserted_count=len(inserted_txns),
        skipped_duplicates_count=skipped_duplicates,
        skipped_noise_count=parse_result.noise_rows_skipped,
        categorization=cat_summary,
    )
