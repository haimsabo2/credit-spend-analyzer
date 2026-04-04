"""Tests for subcategories and PATCH /transactions/{id}/subcategory."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def fixture_file():
    for name in ("Export_4_01_2026.xls", "Export_4_03_2026.xls"):
        p = FIXTURES_DIR / name
        if p.exists():
            return p
    pytest.skip("No .xls fixture found in fixtures/")


@pytest.fixture
def seeded_client(client: TestClient, fixture_file: Path):
    with open(fixture_file, "rb") as f:
        content = f.read()
    r = client.post(
        "/api/uploads",
        data={"month": "2026-04"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    if r.status_code not in (200, 201):
        pytest.skip("Upload failed")
    return client


def test_list_create_subcategory(seeded_client: TestClient):
    cats = seeded_client.get("/api/categories").json()
    assert cats
    cid = cats[0]["id"]
    r = seeded_client.post(
        f"/api/categories/{cid}/subcategories",
        json={"name": "Fruits"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Fruits"
    assert data["category_id"] == cid

    lst = seeded_client.get(f"/api/categories/{cid}/subcategories").json()
    assert any(x["name"] == "Fruits" for x in lst)


def test_patch_transaction_subcategory(seeded_client: TestClient):
    cats = seeded_client.get("/api/categories").json()
    cid = cats[0]["id"]
    sub = seeded_client.post(
        f"/api/categories/{cid}/subcategories",
        json={"name": "Meat"},
    ).json()

    txns = seeded_client.get(
        "/api/transactions",
        params={"month": "2026-04", "category_id": cid, "limit": 5},
    ).json()
    if not txns:
        txns = seeded_client.get("/api/transactions", params={"limit": 5}).json()
    if not txns:
        pytest.skip("No transactions")
    tid = txns[0]["id"]
    if txns[0].get("category_id") != cid:
        seeded_client.post(
            f"/api/transactions/{tid}/categorize",
            json={"category_id": cid},
        )
    r = seeded_client.patch(
        f"/api/transactions/{tid}/subcategory",
        json={"subcategory_id": sub["id"]},
    )
    assert r.status_code == 200
    assert r.json()["subcategory_id"] == sub["id"]

    r2 = seeded_client.get(
        "/api/transactions",
        params={"subcategory_id": sub["id"], "limit": 10},
    )
    assert r2.status_code == 200
    assert any(x["id"] == tid for x in r2.json())


def test_subcategory_wrong_category_rejected(seeded_client: TestClient):
    cats = seeded_client.get("/api/categories").json()
    if len(cats) < 2:
        pytest.skip("Need two categories")
    c1, c2 = cats[0]["id"], cats[1]["id"]
    sub = seeded_client.post(
        f"/api/categories/{c1}/subcategories",
        json={"name": "OnlyC1"},
    ).json()
    txns = seeded_client.get("/api/transactions", params={"limit": 1}).json()
    tid = txns[0]["id"]
    seeded_client.post(
        f"/api/transactions/{tid}/categorize",
        json={"category_id": c2},
    )
    r = seeded_client.patch(
        f"/api/transactions/{tid}/subcategory",
        json={"subcategory_id": sub["id"]},
    )
    assert r.status_code == 422
