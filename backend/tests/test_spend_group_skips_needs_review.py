"""Spend-group members are excluded from needs-review queues and counts."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.db import engine
from backend.app.models import (
    MerchantSpendGroup,
    MerchantSpendGroupMember,
    Transaction,
    Upload,
)


def test_needs_review_endpoint_excludes_spend_group_member(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"SG_NR_{uuid.uuid4().hex[:10]}"
    sig = f"sig-{uuid.uuid4().hex}"

    with Session(engine) as session:
        g = MerchantSpendGroup(display_name="Trip group")
        session.add(g)
        session.commit()
        session.refresh(g)
        session.add(
            MerchantSpendGroupMember(
                group_id=g.id,
                pattern_key=desc.strip().lower(),
            )
        )
        up = Upload(
            month="2026-12",
            original_filename="sg.xls",
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
                confidence=0.0,
            )
        )
        session.commit()

    r = client.get("/api/transactions/needs-review", params={"month": "2026-12", "limit": 100})
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()}
    tid = (
        Session(engine)
        .exec(select(Transaction).where(Transaction.row_signature == sig))
        .first()
        .id
    )
    assert tid not in ids


def test_llm_pending_count_excludes_spend_group_member(client: TestClient):
    client.delete("/api/admin/reset")
    desc = f"SG_LL_{uuid.uuid4().hex[:10]}"
    sig = f"sig2-{uuid.uuid4().hex}"

    with Session(engine) as session:
        g = MerchantSpendGroup(display_name="G2")
        session.add(g)
        session.commit()
        session.refresh(g)
        session.add(MerchantSpendGroupMember(group_id=g.id, pattern_key=desc.strip().lower()))
        up = Upload(
            month="2026-12",
            original_filename="sg2.xls",
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
                category_id=None,
                needs_review=True,
                confidence=0.0,
            )
        )
        session.commit()

    r = client.get(
        "/api/transactions/llm-categorize-pending/count",
        params={"month": "2026-12"},
    )
    assert r.status_code == 200
    assert r.json()["pending_count"] == 0
