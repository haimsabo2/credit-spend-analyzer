"""Business logic for file uploads: hashing, parsing, dedup, persistence."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import List, Optional

from fastapi import UploadFile
from sqlmodel import Session, select

from ..models import Transaction, Upload
from ..parsing.service import parse_xls_bytes
from .classification import apply_rules


@dataclass
class UploadResult:
    """Rich result returned after processing an upload."""

    upload: Upload
    cards_detected: List[str] = field(default_factory=list)
    sections_detected: List[str] = field(default_factory=list)
    inserted_count: int = 0
    skipped_duplicates_count: int = 0
    skipped_noise_count: int = 0


def _delete_uploads_for_month(session: Session, month: str) -> None:
    """Remove all uploads and their transactions for the given YYYY-MM bucket."""
    uploads = list(session.exec(select(Upload).where(Upload.month == month)).all())
    for u in uploads:
        txs = list(session.exec(select(Transaction).where(Transaction.upload_id == u.id)).all())
        for t in txs:
            session.delete(t)
        session.delete(u)
    session.commit()


def handle_upload(
    session: Session,
    file: UploadFile,
    month: str,
    *,
    replace_month: bool = False,
) -> UploadResult:
    """Accept an uploaded .xls file and month; persist upload and transactions with dedup.

    If replace_month is True, delete every existing upload and transaction for this month
    before ingesting (full replace for that calendar bucket).
    """
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
        raw_json: Optional[str] = None
        if n.voucher_number or n.details:
            raw_json = json.dumps(
                {"voucher_number": n.voucher_number, "details": n.details},
                ensure_ascii=False,
            )
        # Show purchase date (when the charge was made), not billing/settlement date.
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
        )
        session.add(tx)
        inserted_txns.append(tx)
        existing_sigs.add(n.row_signature)

    skipped_duplicates = len(normalized_list) - len(inserted_txns)

    upload.num_transactions = len(inserted_txns)
    session.add(upload)
    session.commit()
    session.refresh(upload)

    if inserted_txns:
        for tx in inserted_txns:
            session.refresh(tx)
        apply_rules(session, inserted_txns)

    return UploadResult(
        upload=upload,
        cards_detected=cards_detected,
        sections_detected=sections_detected,
        inserted_count=len(inserted_txns),
        skipped_duplicates_count=skipped_duplicates,
        skipped_noise_count=parse_result.noise_rows_skipped,
    )
