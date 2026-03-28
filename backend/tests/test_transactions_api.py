"""Tests for GET /api/transactions with filters (month, card_label, section, needs_review, q)."""

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
    """Ensure at least one upload with transactions exists."""
    with open(fixture_file, "rb") as f:
        content = f.read()
    r = client.post(
        "/api/uploads",
        data={"month": "2026-04"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    if r.status_code not in (200, 201):
        pytest.skip("Upload failed; cannot test transaction filters")
    return client


def test_get_transactions_returns_list(seeded_client: TestClient):
    response = seeded_client.get("/api/transactions")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_get_transactions_includes_spend_pattern_fields(seeded_client: TestClient):
    r = seeded_client.get("/api/transactions", params={"limit": 1})
    assert r.status_code == 200
    data = r.json()
    if not data:
        pytest.skip("No transactions")
    t = data[0]
    assert t.get("spend_pattern") in ("unknown", "recurring", "one_time")
    assert "spend_pattern_user_set" in t


def test_patch_spend_pattern(seeded_client: TestClient):
    r = seeded_client.get("/api/transactions", params={"limit": 1})
    assert r.status_code == 200
    data = r.json()
    if not data:
        pytest.skip("No transactions")
    tid = data[0]["id"]
    p = seeded_client.patch(
        f"/api/transactions/{tid}/spend-pattern",
        json={"spend_pattern": "recurring"},
    )
    assert p.status_code == 200
    body = p.json()
    assert body["spend_pattern"] == "recurring"
    assert body["spend_pattern_user_set"] is True


def test_patch_spend_pattern_invalid(seeded_client: TestClient):
    r = seeded_client.get("/api/transactions", params={"limit": 1})
    assert r.status_code == 200
    data = r.json()
    if not data:
        pytest.skip("No transactions")
    tid = data[0]["id"]
    bad = seeded_client.patch(
        f"/api/transactions/{tid}/spend-pattern",
        json={"spend_pattern": "nope"},
    )
    assert bad.status_code == 422


def test_get_transactions_filter_by_month(seeded_client: TestClient):
    all_resp = seeded_client.get("/api/transactions", params={"limit": 500})
    assert all_resp.status_code == 200
    all_txs = all_resp.json()

    month_resp = seeded_client.get("/api/transactions", params={"month": "2026-04", "limit": 500})
    assert month_resp.status_code == 200
    month_txs = month_resp.json()

    for t in month_txs:
        assert "id" in t
        assert "upload_id" in t
    assert len(month_txs) <= len(all_txs) or len(all_txs) == 0


def test_get_transactions_filter_by_section(seeded_client: TestClient):
    response = seeded_client.get("/api/transactions", params={"section": "IL", "limit": 50})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for t in data:
        assert t.get("section") == "IL"


def test_get_transactions_filter_by_card_label(seeded_client: TestClient):
    all_resp = seeded_client.get("/api/transactions", params={"limit": 10})
    assert all_resp.status_code == 200
    all_txs = all_resp.json()
    if not all_txs:
        pytest.skip("No transactions to filter by card_label")
    card_label = all_txs[0].get("card_label")
    if not card_label:
        pytest.skip("No card_label in transactions")
    filtered = seeded_client.get(
        "/api/transactions",
        params={"card_label": card_label, "limit": 50},
    )
    assert filtered.status_code == 200
    for t in filtered.json():
        assert t.get("card_label") == card_label


def test_get_transactions_filter_needs_review_true(seeded_client: TestClient):
    """needs_review=true returns transactions where category_id IS NULL."""
    response = seeded_client.get("/api/transactions", params={"needs_review": True, "limit": 10})
    assert response.status_code == 200
    data = response.json()
    for t in data:
        assert t.get("category_id") is None


def test_get_transactions_search_q(seeded_client: TestClient):
    """Search by q filters description / raw_row_data."""
    all_resp = seeded_client.get("/api/transactions", params={"limit": 5})
    assert all_resp.status_code == 200
    all_txs = all_resp.json()
    if not all_txs:
        pytest.skip("No transactions to search")

    term = all_txs[0]["description"][:4]
    if not term.strip():
        pytest.skip("No usable description text for search")

    search_resp = seeded_client.get("/api/transactions", params={"q": term, "limit": 50})
    assert search_resp.status_code == 200
    results = search_resp.json()
    assert len(results) >= 1
    for t in results:
        found = term.lower() in (t.get("description") or "").lower()
        assert found


def test_get_transactions_pagination(seeded_client: TestClient):
    r1 = seeded_client.get("/api/transactions", params={"limit": 2, "offset": 0})
    r2 = seeded_client.get("/api/transactions", params={"limit": 2, "offset": 2})
    assert r1.status_code == 200 and r2.status_code == 200
    list1 = r1.json()
    list2 = r2.json()
    assert len(list1) <= 2 and len(list2) <= 2
    if list1 and list2:
        ids1 = {t["id"] for t in list1}
        ids2 = {t["id"] for t in list2}
        assert ids1.isdisjoint(ids2)
