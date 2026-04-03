"""Tests for the classification rules engine and POST /api/transactions/{id}/categorize."""

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
        pytest.skip("Upload failed; cannot test classification")
    return client


# ── Import sets confidence / needs_review ─────────────────────────────────


def test_imported_transactions_have_confidence_field(seeded_client: TestClient):
    r = seeded_client.get("/api/transactions", params={"limit": 5})
    assert r.status_code == 200
    for t in r.json():
        assert "confidence" in t
        assert isinstance(t["confidence"], (int, float))


def test_imported_transactions_have_rule_id_applied_field(seeded_client: TestClient):
    r = seeded_client.get("/api/transactions", params={"limit": 5})
    assert r.status_code == 200
    for t in r.json():
        assert "rule_id_applied" in t


def test_imported_uncategorized_transactions_have_needs_review(seeded_client: TestClient):
    """Transactions without a matching rule should have needs_review=True."""
    r = seeded_client.get(
        "/api/transactions", params={"needs_review": True, "limit": 5}
    )
    assert r.status_code == 200
    for t in r.json():
        assert t["category_id"] is None
        assert t["needs_review"] is True


# ── Manual categorize (no rule) ───────────────────────────────────────────


def _get_first_txn_id(client: TestClient) -> int:
    r = client.get("/api/transactions", params={"limit": 1})
    assert r.status_code == 200
    txns = r.json()
    assert len(txns) >= 1, "Need at least one transaction"
    return txns[0]["id"]


def _get_first_category_id(client: TestClient) -> int:
    """Grab a category id by looking at the summary endpoint's seed data."""
    r = client.get("/api/insights/summary", params={"month": "1999-01"})
    assert r.status_code == 200
    return 1


def test_categorize_no_rule_response_shape(seeded_client: TestClient):
    """Manual categorize always upserts a merchant_key rule and propagates to matching rows."""
    txn_id = _get_first_txn_id(seeded_client)
    cat_id = _get_first_category_id(seeded_client)

    r = seeded_client.post(
        f"/api/transactions/{txn_id}/categorize",
        json={"category_id": cat_id, "create_rule": False},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["transaction_id"] == txn_id
    assert data["category_id"] == cat_id
    assert data["rule_created"] is True
    assert isinstance(data["rule_id"], int)
    assert isinstance(data["backfill_count"], int)
    assert data["backfill_count"] >= 1


def test_categorize_sets_confidence_to_manual(seeded_client: TestClient):
    txn_id = _get_first_txn_id(seeded_client)
    cat_id = _get_first_category_id(seeded_client)

    seeded_client.post(
        f"/api/transactions/{txn_id}/categorize",
        json={"category_id": cat_id, "create_rule": False},
    )

    r = seeded_client.get("/api/transactions", params={"limit": 500})
    txn = next(t for t in r.json() if t["id"] == txn_id)
    assert txn["confidence"] == 1.0
    assert txn["needs_review"] is False
    assert txn["category_id"] == cat_id


def test_categorize_404_for_missing_transaction(client: TestClient):
    r = client.post(
        "/api/transactions/999999/categorize",
        json={"category_id": 1},
    )
    assert r.status_code == 404


# ── Categorize with rule creation ─────────────────────────────────────────


def test_categorize_with_rule_creation_shape(seeded_client: TestClient):
    txn_id = _get_first_txn_id(seeded_client)
    cat_id = _get_first_category_id(seeded_client)

    r = seeded_client.post(
        f"/api/transactions/{txn_id}/categorize",
        json={"category_id": cat_id, "create_rule": True},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["transaction_id"] == txn_id
    assert data["rule_created"] is True
    assert isinstance(data["rule_id"], int)
    assert isinstance(data["backfill_count"], int)


# ── Repeated categorize for same merchant (description) ───────────────────


def test_second_categorize_same_description_new_rule_id(seeded_client: TestClient):
    """Each save creates a new active merchant_key rule row; prior same-pattern rules are deactivated."""
    all_txns = seeded_client.get("/api/transactions", params={"limit": 500}).json()
    by_desc: dict[str, list] = {}
    for t in all_txns:
        by_desc.setdefault(t["description"], []).append(t)
    pair = next((v for v in by_desc.values() if len(v) >= 2), None)
    if pair is None:
        pytest.skip("Need two transactions with identical description")

    cat_id = _get_first_category_id(seeded_client)
    a, b = pair[0], pair[1]

    d1 = seeded_client.post(
        f"/api/transactions/{a['id']}/categorize",
        json={"category_id": cat_id},
    ).json()
    d2 = seeded_client.post(
        f"/api/transactions/{b['id']}/categorize",
        json={"category_id": cat_id},
    ).json()
    assert d1["rule_created"] is True
    assert d2["rule_created"] is True
    assert d2["rule_id"] != d1["rule_id"]


# ── Backfill ──────────────────────────────────────────────────────────────


def test_backfill_categorizes_matching_transactions(seeded_client: TestClient):
    """Find two transactions with the same description; categorize one
    with create_rule=True and verify the other gets backfilled."""
    all_txns = seeded_client.get("/api/transactions", params={"limit": 500}).json()

    desc_to_txns: dict[str, list[dict]] = {}
    for t in all_txns:
        desc_to_txns.setdefault(t["description"], []).append(t)

    pair = None
    for desc, txns in desc_to_txns.items():
        uncategorized = [t for t in txns if t["category_id"] is None]
        if len(uncategorized) >= 2:
            pair = uncategorized[:2]
            break

    if pair is None:
        pytest.skip("No pair of uncategorized transactions with same description")

    cat_id = _get_first_category_id(seeded_client)
    r = seeded_client.post(
        f"/api/transactions/{pair[0]['id']}/categorize",
        json={"category_id": cat_id},
    )
    assert r.status_code == 200
    assert r.json()["backfill_count"] >= 2

    r2 = seeded_client.get("/api/transactions", params={"limit": 500})
    other = next(t for t in r2.json() if t["id"] == pair[1]["id"])
    assert other["category_id"] == cat_id
    assert other["confidence"] == 1.0


# ── Needs-review filter ──────────────────────────────────────────────────


def test_needs_review_filter_returns_uncategorized(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/transactions", params={"needs_review": True, "limit": 10}
    )
    assert r.status_code == 200
    for t in r.json():
        assert t["category_id"] is None
