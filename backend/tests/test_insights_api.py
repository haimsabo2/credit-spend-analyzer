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
    assert isinstance(data.get("category_monthly", []), list)

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


def test_trends_year_trimmed_to_data_span(seeded_client: TestClient):
    """Calendar year returns only months from first upload month through last (no empty tail)."""
    r = seeded_client.get("/api/insights/trends", params={"year": 2026})
    assert r.status_code == 200
    data = r.json()
    n = len(data["months"])
    assert 1 <= n <= 12
    assert all(isinstance(m, str) and len(m) == 7 and m.startswith("2026-") for m in data["months"])
    assert data["months"] == sorted(data["months"])
    assert len(data["total_spend_series"]) == n
    assert len(data["txn_count_series"]) == n
    assert sum(data["total_spend_series"]) > 0
    assert "2026-04" in data["months"]
    idx = data["months"].index("2026-04")
    assert data["txn_count_series"][idx] > 0

    cm = data["category_monthly"]
    assert isinstance(cm, list)
    assert len(cm) >= 1
    for row in cm:
        assert "category_id" in row
        assert isinstance(row["category_name"], str)
        assert len(row["amounts"]) == n
        assert isinstance(row["year_total"], (int, float))
        assert abs(row["year_total"] - sum(row["amounts"])) < 0.02


def test_trends_year_all_zeros(client: TestClient):
    r = client.get("/api/insights/trends", params={"year": 1999})
    assert r.status_code == 200
    data = r.json()
    assert data["months"] == []
    assert data["total_spend_series"] == []
    assert data["txn_count_series"] == []
    assert data["category_monthly"] == []


def test_trends_trailing_calendar_months_shape_any_db(client: TestClient):
    """With no uploads, months is empty; with data, always 12 trailing slots."""
    r = client.get("/api/insights/trends", params={"trailing_calendar_months": 12})
    assert r.status_code == 200
    data = r.json()
    n = len(data["months"])
    assert n in (0, 12)
    assert len(data["total_spend_series"]) == n
    assert len(data["txn_count_series"]) == n
    if n == 0:
        assert data["category_monthly"] == []
    else:
        for row in data["category_monthly"]:
            assert len(row["amounts"]) == n


def test_trends_trailing_calendar_months_seeded(seeded_client: TestClient):
    """Trailing window ends at latest upload month; includes category_monthly like calendar year."""
    r = seeded_client.get("/api/insights/trends", params={"trailing_calendar_months": 12})
    assert r.status_code == 200
    data = r.json()
    assert len(data["months"]) == 12
    assert data["months"][-1] == "2026-04"
    assert data["months"][0] == "2025-05"
    assert len(data["total_spend_series"]) == 12
    assert len(data["txn_count_series"]) == 12
    idx = data["months"].index("2026-04")
    assert data["txn_count_series"][idx] > 0

    cm = data["category_monthly"]
    assert isinstance(cm, list)
    assert len(cm) >= 1
    for row in cm:
        assert len(row["amounts"]) == 12
        assert abs(row["year_total"] - sum(row["amounts"])) < 0.02


# ── Category year merchants (drill-down) ──────────────────────────────────


def test_category_year_merchants_requires_year_or_trailing(client: TestClient):
    r = client.get("/api/insights/category-year-merchants")
    assert r.status_code == 422


def test_category_year_merchants_empty_year(client: TestClient):
    r = client.get("/api/insights/category-year-merchants", params={"year": 1999})
    assert r.status_code == 200
    data = r.json()
    assert data["months"] == []
    assert data["merchants"] == []


def test_category_year_merchants_shape_uncategorized(client: TestClient):
    """Omit category_id => uncategorized only."""
    r = client.get("/api/insights/category-year-merchants", params={"year": 2026})
    assert r.status_code == 200
    data = r.json()
    n = len(data["months"])
    assert n == 0 or (1 <= n <= 12)
    assert isinstance(data["merchants"], list)
    for m in data["merchants"]:
        assert isinstance(m["merchant_key"], str)
        assert len(m["amounts"]) == n
        if n > 0:
            assert isinstance(m["amounts"][0], (int, float))


def test_category_year_merchants_totals_match_category_monthly(seeded_client: TestClient):
    """Sum of merchant amounts per month equals category_monthly for that category."""
    tr = seeded_client.get("/api/insights/trends", params={"year": 2026})
    assert tr.status_code == 200
    trends = tr.json()
    cm = trends.get("category_monthly") or []
    if not cm:
        pytest.skip("No category_monthly in seeded data")
    row = cm[0]
    cid = row["category_id"]
    params = {"year": 2026}
    if cid is not None:
        params["category_id"] = cid
    mr = seeded_client.get("/api/insights/category-year-merchants", params=params)
    assert mr.status_code == 200
    breakdown = mr.json()
    n = len(trends["months"])
    assert len(breakdown["months"]) == n
    by_month_merch = [0.0] * n
    for merch in breakdown["merchants"]:
        for i, v in enumerate(merch["amounts"]):
            by_month_merch[i] += float(v)
    for i in range(n):
        assert abs(by_month_merch[i] - float(row["amounts"][i])) < 0.02


def test_category_year_merchants_trailing_matches_trends(seeded_client: TestClient):
    tr = seeded_client.get("/api/insights/trends", params={"trailing_calendar_months": 12})
    assert tr.status_code == 200
    trends = tr.json()
    cm = trends.get("category_monthly") or []
    if not cm:
        pytest.skip("No category_monthly in seeded data")
    row = cm[0]
    cid = row["category_id"]
    params: dict = {"trailing_calendar_months": 12}
    if cid is not None:
        params["category_id"] = cid
    mr = seeded_client.get("/api/insights/category-year-merchants", params=params)
    assert mr.status_code == 200
    breakdown = mr.json()
    assert breakdown["months"] == trends["months"]
    assert len(breakdown["months"]) == 12
    by_month_merch = [0.0] * 12
    for merch in breakdown["merchants"]:
        for i, v in enumerate(merch["amounts"]):
            by_month_merch[i] += float(v)
    for i in range(12):
        assert abs(by_month_merch[i] - float(row["amounts"][i])) < 0.02


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


def test_category_year_subcategories_requires_year_or_trailing(client: TestClient):
    r = client.get("/api/insights/category-year-subcategories")
    assert r.status_code == 422


def test_category_year_subcategories_matches_merchants_months(seeded_client: TestClient):
    tr = seeded_client.get("/api/insights/trends", params={"year": 2026})
    assert tr.status_code == 200
    trends = tr.json()
    cm = trends.get("category_monthly") or []
    if not cm:
        pytest.skip("No category_monthly in seeded data")
    row = cm[0]
    cid = row["category_id"]
    params: dict = {"year": 2026}
    if cid is not None:
        params["category_id"] = cid
    sr = seeded_client.get("/api/insights/category-year-subcategories", params=params)
    assert sr.status_code == 200
    sub = sr.json()
    assert sub["months"] == trends["months"]
    n = len(sub["months"])
    for m in sub["merchants"]:
        assert len(m["amounts"]) == n
    by_month = [0.0] * n
    for series in sub["merchants"]:
        for i, v in enumerate(series["amounts"]):
            by_month[i] += float(v)
    for i in range(n):
        assert abs(by_month[i] - float(row["amounts"][i])) < 0.02


def test_month_category_subcategories_shape(seeded_client: TestClient):
    r = seeded_client.get(
        "/api/insights/month-category-subcategories",
        params={"month": "2026-04"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    for it in data["items"]:
        assert isinstance(it["label"], str)
        assert isinstance(it["amount"], (int, float))
