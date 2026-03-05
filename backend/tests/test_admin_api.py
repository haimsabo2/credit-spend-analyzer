"""Tests for admin endpoints (reset-categorization, etc.)."""

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
        pytest.skip("Upload failed; cannot test admin endpoints")
    return client


def test_reset_categorization_rejects_bad_month(client: TestClient):
    """Invalid month format returns 422."""
    r = client.post(
        "/api/admin/reset-categorization", params={"month": "not-a-month"}
    )
    assert r.status_code == 422


def test_reset_categorization_returns_200(client: TestClient):
    """POST /api/admin/reset-categorization?month=2026-03 returns 200."""
    r = client.post("/api/admin/reset-categorization", params={"month": "2026-03"})
    assert r.status_code == 200
    data = r.json()
    assert data["month"] == "2026-03"
    assert "reset_count" in data
    assert isinstance(data["reset_count"], int)


def test_reset_categorization_clears_fields(seeded_client: TestClient):
    """Reset clears categorization fields for transactions in the month."""
    r = seeded_client.post(
        "/api/admin/reset-categorization", params={"month": "2026-04"}
    )
    assert r.status_code == 200
    data = r.json()
    assert data["month"] == "2026-04"
    assert data["reset_count"] > 0

    txs = seeded_client.get(
        "/api/transactions", params={"month": "2026-04", "limit": 500}
    ).json()
    for t in txs:
        assert t.get("category_id") is None
        assert t.get("confidence") == 0
        assert t.get("needs_review") is False
        assert t.get("reason_he") is None
        assert t.get("rule_id_applied") is None
        assert t.get("meta_json") is None
