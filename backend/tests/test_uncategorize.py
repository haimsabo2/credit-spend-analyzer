"""POST /api/transactions/{id}/uncategorize."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.db import engine
from backend.app.models import Category, Transaction, Upload


def test_uncategorize_single_row(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"UNC_{uuid.uuid4().hex[:10]}"
    sig = f"sig-{uuid.uuid4().hex}"

    with Session(engine) as session:
        cat_id = session.exec(select(Category).order_by(Category.id)).first().id
        up = Upload(
            month="2026-10",
            original_filename="u.xls",
            size_bytes=1,
            file_hash=sig,
            num_transactions=1,
        )
        session.add(up)
        session.commit()
        session.refresh(up)
        session.add(
            Transaction(
                upload_id=up.id,
                description=desc,
                amount=3.0,
                row_signature=sig,
                category_id=cat_id,
                needs_review=False,
                confidence=0.9,
            )
        )
        session.commit()
        tid = session.exec(select(Transaction).where(Transaction.row_signature == sig)).first().id

    r = client.post(f"/api/transactions/{tid}/uncategorize")
    assert r.status_code == 200
    assert r.json() == {"transaction_id": tid, "updated_count": 1}

    row = client.get("/api/transactions", params={"limit": 500}).json()
    t = next(x for x in row if x["id"] == tid)
    assert t["category_id"] is None
    assert t["subcategory_id"] is None
    assert t["needs_review"] is True
    assert t["rule_id_applied"] is None


def test_uncategorize_same_merchant_propagates(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"UNCP_{uuid.uuid4().hex[:10]}"
    sig_a = f"a-{uuid.uuid4().hex}"
    sig_b = f"b-{uuid.uuid4().hex}"

    with Session(engine) as session:
        cats = list(session.exec(select(Category).order_by(Category.id)).all())
        c1, c2 = cats[0].id, cats[1].id
        for sig, cid in ((sig_a, c1), (sig_b, c2)):
            up = Upload(
                month="2026-11",
                original_filename="v.xls",
                size_bytes=1,
                file_hash=sig,
                num_transactions=1,
            )
            session.add(up)
            session.commit()
            session.refresh(up)
            session.add(
                Transaction(
                    upload_id=up.id,
                    description=desc,
                    amount=1.0,
                    row_signature=sig,
                    category_id=cid,
                    needs_review=False,
                    confidence=0.9,
                )
            )
        session.commit()
        ids = [
            session.exec(select(Transaction).where(Transaction.row_signature == sig_a)).first().id,
            session.exec(select(Transaction).where(Transaction.row_signature == sig_b)).first().id,
        ]

    r = client.post(f"/api/transactions/{ids[0]}/uncategorize", params={"same_merchant": True})
    assert r.status_code == 200
    assert r.json()["updated_count"] == 2

    by_id = {t["id"]: t for t in client.get("/api/transactions", params={"limit": 500}).json()}
    for tid in ids:
        assert by_id[tid]["category_id"] is None
        assert by_id[tid]["needs_review"] is True
