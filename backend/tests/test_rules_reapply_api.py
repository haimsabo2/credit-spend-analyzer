"""Rules API: creating/updating a rule reapplies to all matching transactions (past months)."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.db import engine
from backend.app.models import Category, Transaction, Upload


@pytest.fixture
def two_month_same_merchant(client: TestClient) -> tuple[int, int, int]:
    """Two transactions, same description, different uploads/months; return (rule_id, cat_a, cat_b)."""
    client.delete("/api/admin/reset")
    desc = f"RULE_REAPPLY_{uuid.uuid4().hex[:12]}"
    sig_a = f"sig-a-{uuid.uuid4().hex}"
    sig_b = f"sig-b-{uuid.uuid4().hex}"

    with Session(engine) as session:
        cats = list(session.exec(select(Category).order_by(Category.id)).all())
        assert len(cats) >= 2, "seed needs at least two categories"
        cat_a, cat_b = cats[0].id, cats[1].id

        for month, sig in (("2026-01", sig_a), ("2026-02", sig_b)):
            up = Upload(
                month=month,
                original_filename="t.xls",
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
                    amount=10.0,
                    row_signature=sig,
                    category_id=None,
                    needs_review=True,
                    confidence=0.3,
                )
            )
        session.commit()

    r = client.post(
        "/api/rules",
        json={
            "category_id": cat_a,
            "pattern": desc,
            "match_type": "merchant_key",
            "priority": 10,
            "active": True,
        },
    )
    assert r.status_code == 201, r.text
    rule_id = r.json()["id"]

    for t in client.get("/api/transactions", params={"limit": 500}).json():
        if t["description"] == desc:
            assert t["category_id"] == cat_a
            assert t["rule_id_applied"] == rule_id

    return rule_id, cat_a, cat_b


def test_put_rule_reapplies_category_across_months(
    client: TestClient, two_month_same_merchant: tuple[int, int, int]
):
    rule_id, _cat_a, cat_b = two_month_same_merchant

    r = client.put(
        f"/api/rules/{rule_id}",
        json={"category_id": cat_b},
    )
    assert r.status_code == 200, r.text
    assert r.json()["category_id"] == cat_b

    desc = None
    for t in client.get("/api/transactions", params={"limit": 500}).json():
        if t["rule_id_applied"] == rule_id:
            assert t["category_id"] == cat_b
            desc = t["description"]
    assert desc is not None


def test_post_rule_applies_to_existing_transactions(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"POST_RULE_{uuid.uuid4().hex[:12]}"
    sig = f"sig-{uuid.uuid4().hex}"

    with Session(engine) as session:
        cat_id = session.exec(select(Category).order_by(Category.id)).first().id
        up = Upload(
            month="2026-03",
            original_filename="t.xls",
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
                amount=5.0,
                row_signature=sig,
                category_id=None,
                needs_review=True,
                confidence=0.3,
            )
        )
        session.commit()

    r = client.post(
        "/api/rules",
        json={
            "category_id": cat_id,
            "pattern": desc,
            "match_type": "merchant_key",
            "priority": 15,
            "active": True,
        },
    )
    assert r.status_code == 201, r.text
    rule_id = r.json()["id"]

    hit = [
        t
        for t in client.get("/api/transactions", params={"limit": 500}).json()
        if t["description"] == desc
    ]
    assert len(hit) == 1
    assert hit[0]["category_id"] == cat_id
    assert hit[0]["rule_id_applied"] == rule_id
