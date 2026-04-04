"""Migration: legacy top-level 'מסעדות ובתי קפה' category → subcategory under 'בילויים ופנאי'."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.db import _migrate_restaurants_category_to_leisure_subcategory, engine
from backend.app.models import Category, Subcategory, Transaction, Upload
from backend.app.services.categories import (
    LEISURE_CATEGORY_NAME_HE,
    LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE,
    RESTAURANTS_SUBCATEGORY_NAME_HE,
    resolve_llm_category_subcategory_names,
)


def test_resolve_llm_legacy_top_level_restaurants_maps_to_leisure() -> None:
    cat, sub = resolve_llm_category_subcategory_names("מסעדות ובתי קפה", None)
    assert cat == LEISURE_CATEGORY_NAME_HE
    assert sub == RESTAURANTS_SUBCATEGORY_NAME_HE


def test_resolve_llm_leisure_unchanged() -> None:
    cat, sub = resolve_llm_category_subcategory_names("בילויים ופנאי", "מסעדות ובתי קפה")
    assert cat == LEISURE_CATEGORY_NAME_HE
    assert sub == RESTAURANTS_SUBCATEGORY_NAME_HE


def test_migrate_legacy_restaurant_category_row(client: TestClient) -> None:
    client.delete("/api/admin/reset")
    sig = f"sig-mig-{uuid.uuid4().hex}"

    with Session(engine) as session:
        legacy = Category(
            name=LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE,
            is_system=True,
        )
        session.add(legacy)
        session.commit()
        session.refresh(legacy)
        r_id = legacy.id

        up = Upload(
            month="2026-01",
            original_filename="mig.xls",
            size_bytes=1,
            file_hash=sig,
            num_transactions=1,
        )
        session.add(up)
        session.commit()
        session.refresh(up)

        t = Transaction(
            upload_id=up.id,
            description="test",
            amount=10.0,
            row_signature=sig,
            category_id=r_id,
            subcategory_id=None,
        )
        session.add(t)
        session.commit()

    _migrate_restaurants_category_to_leisure_subcategory()

    with Session(engine) as session:
        assert session.get(Category, r_id) is None
        leisure = session.exec(
            select(Category).where(Category.name == LEISURE_CATEGORY_NAME_HE)
        ).first()
        assert leisure is not None
        assert leisure.id is not None
        sub = session.exec(
            select(Subcategory).where(
                Subcategory.category_id == leisure.id,
                Subcategory.name == RESTAURANTS_SUBCATEGORY_NAME_HE,
            )
        ).first()
        assert sub is not None
        t2 = session.exec(
            select(Transaction).where(Transaction.row_signature == sig)
        ).first()
        assert t2 is not None
        assert t2.category_id == leisure.id
        assert t2.subcategory_id == sub.id


def test_leisure_has_restaurants_subcategory(client: TestClient) -> None:
    client.delete("/api/admin/reset")
    r = client.get("/api/categories")
    assert r.status_code == 200
    names = {c["name"] for c in r.json()}
    assert LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE not in names

    leisure = next(c for c in r.json() if c["name"] == LEISURE_CATEGORY_NAME_HE)
    sr = client.get(f"/api/categories/{leisure['id']}/subcategories")
    assert sr.status_code == 200
    sub_names = {s["name"] for s in sr.json()}
    assert RESTAURANTS_SUBCATEGORY_NAME_HE in sub_names
