"""Tests for merchant spend groups and insights rollup."""

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


def test_create_group_and_member(seeded_client: TestClient):
    r = seeded_client.post(
        "/api/merchant-spend-groups",
        json={"display_name": "Fuel rollup"},
    )
    assert r.status_code == 201
    gid = r.json()["id"]

    txns = seeded_client.get("/api/transactions", params={"limit": 1}).json()
    assert txns
    pk = (txns[0]["description"] or "").strip().lower()
    assert pk
    m = seeded_client.post(
        f"/api/merchant-spend-groups/{gid}/members",
        json={"pattern_key": pk},
    )
    assert m.status_code == 201
    body = m.json()
    assert body["bulk"] is False
    assert len(body["added"]) == 1
    assert body["added"][0]["pattern_key"] == pk

    lst = seeded_client.get(f"/api/merchant-spend-groups/{gid}/members").json()
    assert len(lst) == 1

    appr = seeded_client.get(
        "/api/transactions/merchant-groups",
        params={"approved": True, "limit": 500},
    ).json()
    pks_ok = {x["pattern_key"] for x in appr["items"]}
    assert pk in pks_ok


def test_sync_spend_group_approvals(seeded_client: TestClient):
    g = seeded_client.post(
        "/api/merchant-spend-groups",
        json={"display_name": "Sync test group"},
    ).json()
    tx = seeded_client.get("/api/transactions", params={"limit": 1}).json()[0]
    pk = (tx["description"] or "").strip().lower()
    seeded_client.post(
        f"/api/merchant-spend-groups/{g['id']}/members",
        json={"pattern_key": pk},
    )
    r = seeded_client.post("/api/merchant-spend-groups/sync-approvals")
    assert r.status_code == 200
    body = r.json()
    assert body["pattern_keys_processed"] >= 1
    assert "new_approvals_created" in body
    r2 = seeded_client.post("/api/merchant-spend-groups/sync-approvals")
    assert r2.status_code == 200
    assert r2.json()["new_approvals_created"] == 0


def test_merchant_group_series_shape(seeded_client: TestClient):
    g = seeded_client.post(
        "/api/merchant-spend-groups",
        json={"display_name": "Test series"},
    ).json()
    tx = seeded_client.get("/api/transactions", params={"limit": 1}).json()[0]
    pk = (tx["description"] or "").strip().lower()
    seeded_client.post(
        f"/api/merchant-spend-groups/{g['id']}/members",
        json={"pattern_key": pk},
    )
    r = seeded_client.get(
        "/api/insights/merchant-group-series",
        params={"group_id": g["id"], "year": 2026},
    )
    assert r.status_code == 200
    data = r.json()
    assert "months" in data and "amounts" in data
    n = len(data["months"])
    assert n == len(data["amounts"])
    assert 1 <= n <= 12
    assert all(m.startswith("2026-") for m in data["months"])


def test_duplicate_pattern_in_other_group_rejected(seeded_client: TestClient):
    tx = seeded_client.get("/api/transactions", params={"limit": 1}).json()[0]
    pk = (tx["description"] or "").strip().lower()
    g1 = seeded_client.post(
        "/api/merchant-spend-groups", json={"display_name": "A"}
    ).json()
    g2 = seeded_client.post(
        "/api/merchant-spend-groups", json={"display_name": "B"}
    ).json()
    seeded_client.post(
        f"/api/merchant-spend-groups/{g1['id']}/members",
        json={"pattern_key": pk},
    )
    r = seeded_client.post(
        f"/api/merchant-spend-groups/{g2['id']}/members",
        json={"pattern_key": pk},
    )
    assert r.status_code == 409


def test_add_member_bulk_two_words_and(seeded_client: TestClient):
    """Space-separated tokens → all must appear as substrings (order-free via *a*b*)."""
    g = seeded_client.post(
        "/api/merchant-spend-groups",
        json={"display_name": "Words test"},
    ).json()
    txns = seeded_client.get("/api/transactions", params={"limit": 200}).json()
    assert txns
    taken: set[str] = set()
    for grp in seeded_client.get("/api/merchant-spend-groups").json():
        mid = grp["id"]
        for m in seeded_client.get(f"/api/merchant-spend-groups/{mid}/members").json():
            taken.add(m["pattern_key"])
    blob = None
    parts: list[str] = []
    for t in txns:
        desc = (t.get("description") or "").strip().lower()
        if not desc or desc in taken:
            continue
        parts = [p for p in desc.replace("\t", " ").split() if len(p) > 1]
        if len(parts) < 2:
            continue
        # If the line is exactly those two tokens, input matches a full pattern_key → single-key mode.
        if desc == f"{parts[0]} {parts[1]}":
            continue
        blob = f"{parts[0]} {parts[1]}"
        break
    if not blob:
        pytest.skip("No free two-token merchant line for bulk test")
    r = seeded_client.post(
        f"/api/merchant-spend-groups/{g['id']}/members",
        json={"pattern_key": blob},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["bulk"] is True
    assert len(data["added"]) >= 1
    hit = data["added"][0]["pattern_key"]
    assert parts[0] in hit and parts[1] in hit


def test_add_member_bulk_wildcard_matches_many(seeded_client: TestClient):
    g = seeded_client.post(
        "/api/merchant-spend-groups",
        json={"display_name": "Bulk test"},
    ).json()
    gid = g["id"]
    txns = seeded_client.get("/api/transactions", params={"limit": 50}).json()
    assert txns
    pks = list({(t["description"] or "").strip().lower() for t in txns if t.get("description")})
    assert pks
    stub = pks[0][: max(3, min(6, len(pks[0])))]
    r = seeded_client.post(
        f"/api/merchant-spend-groups/{gid}/members",
        json={"pattern_key": f"*{stub}*"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["bulk"] is True
    assert len(data["added"]) >= 1
    for row in data["added"]:
        assert stub in row["pattern_key"]


def test_add_member_wildcard_only_rejected(seeded_client: TestClient):
    g = seeded_client.post(
        "/api/merchant-spend-groups",
        json={"display_name": "Reject"},
    ).json()
    r = seeded_client.post(
        f"/api/merchant-spend-groups/{g['id']}/members",
        json={"pattern_key": "***"},
    )
    assert r.status_code == 422
