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
    assert m.json()["pattern_key"] == pk

    lst = seeded_client.get(f"/api/merchant-spend-groups/{gid}/members").json()
    assert len(lst) == 1


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
