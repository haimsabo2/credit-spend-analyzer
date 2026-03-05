"""Shape tests for budget, alert, and forecast endpoints."""

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
        pytest.skip("Upload failed; cannot test budgets")
    return client


# ── Budget CRUD ───────────────────────────────────────────────────────────


def test_post_budget_upsert_creates(client: TestClient):
    r = client.post(
        "/api/budgets",
        json={"category_id": 1, "month": "2026-04", "budget_amount": 500.0},
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["id"], int)
    assert data["category_id"] == 1
    assert data["month"] == "2026-04"
    assert data["budget_amount"] == 500.0


def test_post_budget_upsert_updates(client: TestClient):
    r1 = client.post(
        "/api/budgets",
        json={"category_id": 2, "month": "2026-04", "budget_amount": 300.0},
    )
    assert r1.status_code == 200
    first_id = r1.json()["id"]

    r2 = client.post(
        "/api/budgets",
        json={"category_id": 2, "month": "2026-04", "budget_amount": 450.0},
    )
    assert r2.status_code == 200
    data = r2.json()
    assert data["id"] == first_id
    assert data["budget_amount"] == 450.0


def test_get_budgets_by_month(client: TestClient):
    client.post(
        "/api/budgets",
        json={"category_id": 3, "month": "2026-05", "budget_amount": 200.0},
    )
    r = client.get("/api/budgets", params={"month": "2026-05"})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    for item in data:
        assert "id" in item
        assert "category_id" in item
        assert "month" in item
        assert "budget_amount" in item


def test_get_budgets_empty_month(client: TestClient):
    r = client.get("/api/budgets", params={"month": "1999-01"})
    assert r.status_code == 200
    assert r.json() == []


# ── Budget Alerts ─────────────────────────────────────────────────────────


def test_get_alerts_shape(seeded_client: TestClient):
    seeded_client.post(
        "/api/budgets",
        json={"category_id": 1, "month": "2026-04", "budget_amount": 5000.0},
    )
    r = seeded_client.get("/api/budgets/alerts", params={"month": "2026-04"})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for item in data:
        assert isinstance(item["category_id"], int)
        assert isinstance(item["category_name"], str)
        assert isinstance(item["budget"], (int, float))
        assert isinstance(item["spent"], (int, float))
        assert isinstance(item["remaining"], (int, float))
        assert item["status"] in ("ok", "warn", "exceeded")


def test_get_alerts_status_values(seeded_client: TestClient):
    seeded_client.post(
        "/api/budgets",
        json={"category_id": 1, "month": "2026-04", "budget_amount": 0.01},
    )
    r = seeded_client.get("/api/budgets/alerts", params={"month": "2026-04"})
    assert r.status_code == 200
    statuses = {item["status"] for item in r.json()}
    assert statuses <= {"ok", "warn", "exceeded"}


def test_get_alerts_empty_month(client: TestClient):
    r = client.get("/api/budgets/alerts", params={"month": "1999-01"})
    assert r.status_code == 200
    assert r.json() == []


# ── Forecast ──────────────────────────────────────────────────────────────


def test_forecast_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/forecast", params={"month": "2026-04"})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["forecast_month"], str)
    assert isinstance(data["total_forecast"], (int, float))
    assert isinstance(data["category_forecasts"], list)
    assert isinstance(data["recurring_merchants"], list)


def test_forecast_category_item_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/forecast", params={"month": "2026-04"})
    data = r.json()
    for item in data["category_forecasts"]:
        assert "category_id" in item
        assert isinstance(item["category_name"], str)
        assert isinstance(item["amount"], (int, float))


def test_forecast_recurring_merchant_shape(seeded_client: TestClient):
    r = seeded_client.get("/api/forecast", params={"month": "2026-04"})
    data = r.json()
    for item in data["recurring_merchants"]:
        assert isinstance(item["merchant_key"], str)
        assert isinstance(item["display_name"], str)
        assert isinstance(item["avg_amount"], (int, float))
        assert isinstance(item["months_present"], int)
        assert item["months_present"] >= 3


def test_forecast_month_offset(seeded_client: TestClient):
    r = seeded_client.get("/api/forecast", params={"month": "2026-04"})
    assert r.json()["forecast_month"] == "2026-05"


def test_forecast_month_offset_december(client: TestClient):
    r = client.get("/api/forecast", params={"month": "2026-12"})
    assert r.status_code == 200
    assert r.json()["forecast_month"] == "2027-01"
