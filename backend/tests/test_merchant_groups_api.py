"""Tests for GET/POST /api/transactions/merchant-groups (grouped merchants + user approval)."""

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
        pytest.skip("Upload failed; cannot test merchant groups")
    return client


def _first_group(seeded_client: TestClient, approved: bool):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": approved, "limit": 500, "offset": 0},
    )
    assert r.status_code == 200
    data = r.json()
    assert "items" in data and "total" in data
    return data


def test_merchant_groups_list_shape(seeded_client: TestClient):
    data = _first_group(seeded_client, approved=False)
    assert isinstance(data["total"], int)
    if not data["items"]:
        pytest.skip("No transaction groups in fixture")
    row = data["items"][0]
    for key in (
        "pattern_key",
        "display_description",
        "occurrence_count",
        "total_amount",
        "representative_transaction_id",
        "category_id",
        "subcategory_id",
        "needs_review_any",
        "spend_group_name",
    ):
        assert key in row


def test_merchant_groups_approve_unapprove_roundtrip(seeded_client: TestClient):
    pending = _first_group(seeded_client, approved=False)
    if not pending["items"]:
        pytest.skip("No pending merchant groups")
    g = pending["items"][0]
    pk = g["pattern_key"]
    rep_id = g["representative_transaction_id"]

    r_ap = seeded_client.post(
        "/api/transactions/merchant-groups/approve",
        json={"transaction_id": rep_id},
    )
    assert r_ap.status_code == 200
    assert r_ap.json()["pattern_key"] == pk

    pending2 = _first_group(seeded_client, approved=False)
    pks_pending = {x["pattern_key"] for x in pending2["items"]}
    assert pk not in pks_pending

    approved = _first_group(seeded_client, approved=True)
    pks_ok = {x["pattern_key"] for x in approved["items"]}
    assert pk in pks_ok

    r_un = seeded_client.post(
        "/api/transactions/merchant-groups/unapprove",
        json={"pattern_key": pk},
    )
    assert r_un.status_code == 200

    pending3 = _first_group(seeded_client, approved=False)
    pks_pending3 = {x["pattern_key"] for x in pending3["items"]}
    assert pk in pks_pending3


def test_merchant_groups_approve_by_pattern_key(seeded_client: TestClient):
    pending = _first_group(seeded_client, approved=False)
    if not pending["items"]:
        pytest.skip("No pending merchant groups")
    pk = pending["items"][0]["pattern_key"]
    r = seeded_client.post(
        "/api/transactions/merchant-groups/approve",
        json={"pattern_key": pk},
    )
    assert r.status_code == 200
    assert r.json()["pattern_key"] == pk


def test_merchant_groups_rejects_both_ids(seeded_client: TestClient):
    r = seeded_client.post(
        "/api/transactions/merchant-groups/approve",
        json={"transaction_id": 1, "pattern_key": "x"},
    )
    assert r.status_code == 422


def test_merchant_groups_search_q(seeded_client: TestClient):
    pending = _first_group(seeded_client, approved=False)
    if not pending["items"]:
        pytest.skip("No pending merchant groups")
    term = pending["items"][0]["display_description"][:8]
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": False, "q": term, "limit": 50},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 1
    assert any(term.lower() in (x["display_description"] or "").lower() for x in data["items"])


def test_merchant_groups_filter_by_category_id(seeded_client: TestClient):
    data = _first_group(seeded_client, approved=False)
    if not data["items"]:
        pytest.skip("No merchant groups")
    with_cid = next((x for x in data["items"] if x.get("category_id") is not None), None)
    if not with_cid:
        pytest.skip("No categorized merchant groups in fixture")
    cid = with_cid["category_id"]
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"category_id": cid, "limit": 500, "offset": 0},
    )
    assert r.status_code == 200
    out = r.json()
    for item in out["items"]:
        assert item["category_id"] == cid


def test_merchant_groups_rejects_subcategory_without_category(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"subcategory_id": 1, "limit": 10},
    )
    assert r.status_code == 422


def test_merchant_groups_uncategorized_only(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"uncategorized_only": True, "limit": 500},
    )
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["category_id"] is None
