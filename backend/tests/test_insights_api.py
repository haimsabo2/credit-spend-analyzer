"""Shape tests for GET /api/insights/* endpoints."""

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
        pytest.skip("Upload failed; cannot test insights")
    return client


# ── Summary ───────────────────────────────────────────────────────────────


def test_summary_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/insights/summary", params={"month": "2026-04"})
    assert r.status_code == 200
    data = r.json()

    assert isinstance(data["total_spend"], (int, float))
    assert isinstance(data["spend_by_category"], list)
    assert isinstance(data["spend_by_card"], list)
    assert isinstance(data["top_merchants"], list)


def test_summary_category_item_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/insights/summary", params={"month": "2026-04"})
    data = r.json()
    for item in data["spend_by_category"]:
        assert "category_id" in item
        assert isinstance(item["category_name"], str)
        assert isinstance(item["amount"], (int, float))
        assert isinstance(item["pct"], (int, float))


def test_summary_card_item_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/insights/summary", params={"month": "2026-04"})
    data = r.json()
    for item in data["spend_by_card"]:
        assert "card_label" in item
        assert isinstance(item["amount"], (int, float))


def test_summary_merchant_item_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/insights/summary", params={"month": "2026-04"})
    data = r.json()
    for item in data["top_merchants"]:
        assert isinstance(item["merchant_key"], str)
        assert isinstance(item["display_name"], str)
        assert isinstance(item["amount"], (int, float))
        assert isinstance(item["txn_count"], int)


def test_summary_empty_month(client: TestClient):
    r = client.get("/api/insights/summary", params={"month": "1999-01"})
    assert r.status_code == 200
    data = r.json()
    assert data["total_spend"] == 0
    assert data["spend_by_category"] == []
    assert data["spend_by_card"] == []
    assert data["top_merchants"] == []


def test_summary_rejects_bad_month(client: TestClient):
    r = client.get("/api/insights/summary", params={"month": "not-a-month"})
    assert r.status_code == 422


# ── Trends ────────────────────────────────────────────────────────────────


def test_trends_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/insights/trends", params={"months": 6})
    assert r.status_code == 200
    data = r.json()

    assert isinstance(data["months"], list)
    assert isinstance(data["total_spend_series"], list)
    assert len(data["total_spend_series"]) == len(data["months"])
    assert isinstance(data["txn_count_series"], list)
    assert len(data["txn_count_series"]) == len(data["months"])
    assert isinstance(data["category_series"], dict)

    for month_str in data["months"]:
        assert isinstance(month_str, str)
        assert len(month_str) == 7

    for vals in data["category_series"].values():
        assert isinstance(vals, list)
        assert len(vals) == len(data["months"])


def test_trends_empty(client: TestClient):
    """Rolling trends align counts with months (may be non-empty if DB has data)."""
    r = client.get("/api/insights/trends", params={"months": 1})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["months"], list)
    assert isinstance(data["total_spend_series"], list)
    assert isinstance(data["txn_count_series"], list)
    assert len(data["txn_count_series"]) == len(data["months"])


def test_trends_year_twelve_months(seeded_client: TestClient):
    """Calendar year view returns 12 slots; sparse data fills zeros elsewhere."""
    r = seeded_client.get("/api/insights/trends", params={"year": 2026})
    assert r.status_code == 200
    data = r.json()
    assert len(data["months"]) == 12
    assert data["months"][0] == "2026-01"
    assert data["months"][11] == "2026-12"
    assert len(data["total_spend_series"]) == 12
    assert len(data["txn_count_series"]) == 12
    assert sum(data["total_spend_series"]) > 0
    idx = data["months"].index("2026-04")
    assert data["txn_count_series"][idx] > 0


def test_trends_year_all_zeros(client: TestClient):
    r = client.get("/api/insights/trends", params={"year": 1999})
    assert r.status_code == 200
    data = r.json()
    assert len(data["months"]) == 12
    assert all(x == 0 for x in data["total_spend_series"])
    assert data["txn_count_series"] == [0] * 12


# ── Anomalies ─────────────────────────────────────────────────────────────


def test_anomalies_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/insights/anomalies", params={"month": "2026-04"})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)

    for item in data:
        assert item["type"] in ("category", "merchant")
        assert isinstance(item["name"], str)
        assert isinstance(item["current"], (int, float))
        assert isinstance(item["baseline"], (int, float))
        assert isinstance(item["delta"], (int, float))
        assert isinstance(item["pct"], (int, float))


def test_anomalies_empty_month(client: TestClient):
    r = client.get("/api/insights/anomalies", params={"month": "1999-01"})
    assert r.status_code == 200
    assert r.json() == []


def test_anomalies_rejects_bad_month(client: TestClient):
    r = client.get("/api/insights/anomalies", params={"month": "bad"})
    assert r.status_code == 422
