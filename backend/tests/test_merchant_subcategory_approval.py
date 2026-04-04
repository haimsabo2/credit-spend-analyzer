"""Tests for subcategory preference per approved merchant (pattern_key)."""

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


def test_merchant_groups_list_includes_subcategory_id(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": False, "limit": 5},
    )
    assert r.status_code == 200
    items = r.json()["items"]
    if not items:
        pytest.skip("No merchant groups")
    assert "subcategory_id" in items[0]


def test_set_merchant_group_subcategory_without_approval_409(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": False, "limit": 1},
    )
    assert r.status_code == 200
    items = r.json()["items"]
    if not items:
        pytest.skip("No pending merchant groups")
    pk = items[0]["pattern_key"]
    cats = seeded_client.get("/api/categories").json()
    cid = cats[0]["id"]
    sub = seeded_client.post(
        f"/api/categories/{cid}/subcategories",
        json={"name": "SubFor409Test"},
    )
    if sub.status_code != 201:
        pytest.skip("Could not create subcategory")
    sid = sub.json()["id"]
    bad = seeded_client.post(
        "/api/transactions/merchant-groups/subcategory",
        json={"pattern_key": pk, "subcategory_id": sid},
    )
    assert bad.status_code == 409


def test_approved_merchant_subcategory_propagates_to_all_occurrences(
    seeded_client: TestClient,
):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": False, "limit": 200},
    )
    assert r.status_code == 200
    items = [g for g in r.json()["items"] if g["occurrence_count"] >= 2]
    if not items:
        pytest.skip("Need a merchant with at least two occurrences")
    g = items[0]
    pk = g["pattern_key"]
    rep_id = g["representative_transaction_id"]
    cid = g["category_id"]
    if cid is None:
        cats = seeded_client.get("/api/categories").json()
        cid = cats[0]["id"]
        seeded_client.post(
            f"/api/transactions/{rep_id}/categorize",
            json={"category_id": cid, "rule_pattern": g["display_description"]},
        )

    sub = seeded_client.post(
        f"/api/categories/{cid}/subcategories",
        json={"name": "PropagateTestSub"},
    )
    assert sub.status_code == 201
    sid = sub.json()["id"]

    ap = seeded_client.post(
        "/api/transactions/merchant-groups/approve",
        json={"transaction_id": rep_id},
    )
    assert ap.status_code == 200

    sc = seeded_client.post(
        "/api/transactions/merchant-groups/subcategory",
        json={"pattern_key": pk, "subcategory_id": sid},
    )
    assert sc.status_code == 200

    term = (g["display_description"] or "")[:12].strip()
    if len(term) < 3:
        pytest.skip("Description too short for search")
    tx_list = seeded_client.get(
        "/api/transactions",
        params={"q": term, "limit": 100},
    ).json()
    same_desc = [
        t
        for t in tx_list
        if (t.get("description") or "").strip().lower() == pk
        and t.get("category_id") == cid
    ]
    assert len(same_desc) >= 2
    for t in same_desc:
        assert t.get("subcategory_id") == sid

    mg = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": True, "q": term, "limit": 50},
    ).json()
    hit = next((x for x in mg["items"] if x["pattern_key"] == pk), None)
    assert hit is not None
    assert hit.get("subcategory_id") == sid


def test_patch_subcategory_with_approval_propagates(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": False, "limit": 200},
    )
    assert r.status_code == 200
    items = [g for g in r.json()["items"] if g["occurrence_count"] >= 2]
    if not items:
        pytest.skip("Need a merchant with at least two occurrences")
    g = items[0]
    pk = g["pattern_key"]
    rep_id = g["representative_transaction_id"]
    cid = g["category_id"]
    if cid is None:
        cats = seeded_client.get("/api/categories").json()
        cid = cats[0]["id"]
        seeded_client.post(
            f"/api/transactions/{rep_id}/categorize",
            json={"category_id": cid, "rule_pattern": g["display_description"]},
        )
    sub = seeded_client.post(
        f"/api/categories/{cid}/subcategories",
        json={"name": "PatchPropagateSub"},
    )
    assert sub.status_code == 201
    sid = sub.json()["id"]

    seeded_client.post(
        "/api/transactions/merchant-groups/approve",
        json={"transaction_id": rep_id},
    )
    p = seeded_client.patch(
        f"/api/transactions/{rep_id}/subcategory",
        json={"subcategory_id": sid},
    )
    assert p.status_code == 200

    term = (g["display_description"] or "")[:12].strip()
    if len(term) < 3:
        pytest.skip("Description too short for search")
    tx_list = seeded_client.get(
        "/api/transactions",
        params={"q": term, "limit": 100},
    ).json()
    same = [
        t
        for t in tx_list
        if (t.get("description") or "").strip().lower() == pk
        and t.get("category_id") == cid
    ]
    assert len(same) >= 2
    assert all(t.get("subcategory_id") == sid for t in same)


def test_categorize_propagate_clears_mismatched_approval_subcategory(
    seeded_client: TestClient,
):
    cats = seeded_client.get("/api/categories").json()
    if len(cats) < 2:
        pytest.skip("Need two categories")
    c1, c2 = cats[0]["id"], cats[1]["id"]

    r = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": False, "limit": 200},
    )
    assert r.status_code == 200
    items = r.json()["items"]
    if not items:
        pytest.skip("No merchant groups")
    g = items[0]
    pk = g["pattern_key"]
    rep_id = g["representative_transaction_id"]

    seeded_client.post(
        f"/api/transactions/{rep_id}/categorize",
        json={"category_id": c1, "rule_pattern": g["display_description"]},
    )
    sub = seeded_client.post(
        f"/api/categories/{c1}/subcategories",
        json={"name": "StaleSubSyncTest"},
    )
    assert sub.status_code == 201
    sid = sub.json()["id"]

    seeded_client.post(
        "/api/transactions/merchant-groups/approve",
        json={"transaction_id": rep_id},
    )
    seeded_client.post(
        "/api/transactions/merchant-groups/subcategory",
        json={"pattern_key": pk, "subcategory_id": sid},
    )

    seeded_client.post(
        f"/api/transactions/{rep_id}/categorize",
        json={"category_id": c2, "rule_pattern": g["display_description"]},
    )

    approved = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": True, "limit": 500},
    ).json()
    row = next((x for x in approved["items"] if x["pattern_key"] == pk), None)
    assert row is not None
    assert row.get("subcategory_id") is None

    t = seeded_client.get(f"/api/transactions", params={"limit": 500}).json()
    rep = next((x for x in t if x["id"] == rep_id), None)
    assert rep is not None
    assert rep.get("subcategory_id") is None
