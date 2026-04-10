"""merchant_category_conflict flag on transactions and merchant-groups API."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.db import engine
from backend.app.models import Category, Transaction, Upload


def test_transactions_flag_conflict_when_same_merchant_two_categories(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"CONF_MER_{uuid.uuid4().hex[:10]}"
    sig_a = f"cfa-{uuid.uuid4().hex}"
    sig_b = f"cfb-{uuid.uuid4().hex}"

    with Session(engine) as session:
        cats = list(session.exec(select(Category).order_by(Category.id)).all())
        assert len(cats) >= 2
        c1, c2 = cats[0].id, cats[1].id
        for sig in (sig_a, sig_b):
            up = Upload(
                month="2026-08",
                original_filename="x.xls",
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
                    category_id=c1 if sig == sig_a else c2,
                    needs_review=False,
                    confidence=0.9,
                )
            )
        session.commit()

    r = client.get("/api/transactions", params={"limit": 50})
    assert r.status_code == 200
    hits = [t for t in r.json() if t["description"] == desc]
    assert len(hits) == 2
    for t in hits:
        assert t.get("merchant_category_conflict") is True


def test_merchant_groups_category_conflict(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"CONF_GRP_{uuid.uuid4().hex[:10]}"
    sig_a = f"cga-{uuid.uuid4().hex}"
    sig_b = f"cgb-{uuid.uuid4().hex}"

    with Session(engine) as session:
        cats = list(session.exec(select(Category).order_by(Category.id)).all())
        c1, c2 = cats[0].id, cats[1].id
        for sig in (sig_a, sig_b):
            up = Upload(
                month="2026-09",
                original_filename="y.xls",
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
                    category_id=c1 if sig == sig_a else c2,
                    needs_review=False,
                    confidence=0.9,
                )
            )
        session.commit()

    r = client.get("/api/transactions/merchant-groups", params={"approved": False, "limit": 500})
    assert r.status_code == 200
    items = r.json()["items"]
    row = next((x for x in items if x["display_description"] == desc), None)
    assert row is not None
    assert row.get("category_conflict") is True
