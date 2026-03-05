"""Tests for POST /api/transactions/auto-categorize and GET /api/transactions/needs-review."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.schemas import LLMCategorizationResult

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"

MOCK_LLM_RESULT = LLMCategorizationResult(
    category_name_he="סופר ומכולת",
    confidence=0.85,
    needs_review=False,
    reason_he="רכישה בסופרמרקט",
    merchant_key_guess="shupersal",
    suggested_new_category=None,
)

MOCK_LLM_RESULT_NEEDS_REVIEW = LLMCategorizationResult(
    category_name_he="אחר",
    confidence=0.4,
    needs_review=True,
    reason_he="לא ברור מהי העסקה",
    merchant_key_guess=None,
    suggested_new_category=None,
)


@pytest.fixture
def fixture_file():
    for name in ("Export_4_01_2026.xls", "Export_4_03_2026.xls"):
        p = FIXTURES_DIR / name
        if p.exists():
            return p
    pytest.skip("No .xls fixture found in fixtures/")


@pytest.fixture
def seeded_month(client: TestClient, fixture_file: Path) -> str:
    """Upload a fixture so transactions exist, return the month string."""
    month = "2026-04"
    with open(fixture_file, "rb") as f:
        content = f.read()
    r = client.post(
        "/api/uploads",
        data={"month": month},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    if r.status_code not in (200, 201):
        pytest.skip("Upload failed; cannot test auto-categorize")
    return month


@patch("backend.app.api.transactions.llm_categorize", return_value=MOCK_LLM_RESULT)
def test_auto_categorize_response_schema(mock_llm, client: TestClient, seeded_month: str):
    resp = client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
    assert resp.status_code == 200
    body = resp.json()

    assert isinstance(body["processed"], int)
    assert isinstance(body["categorized"], int)
    assert isinstance(body["needs_review"], int)
    assert isinstance(body["failed"], int)
    assert isinstance(body["failures_sample"], list)
    assert body["failed"] == 0


@patch("backend.app.api.transactions.llm_categorize", return_value=MOCK_LLM_RESULT)
def test_auto_categorize_updates_rows(mock_llm, client: TestClient, seeded_month: str):
    resp = client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
    assert resp.status_code == 200
    body = resp.json()

    if body["processed"] == 0:
        pytest.skip("No uncategorized transactions to test")

    assert body["categorized"] + body["needs_review"] + body["failed"] == body["processed"]

    txns = client.get("/api/transactions", params={"month": seeded_month, "limit": 10}).json()
    categorized_txns = [t for t in txns if t["category_id"] is not None]
    assert len(categorized_txns) > 0
    for t in categorized_txns:
        assert t["confidence"] > 0


@patch("backend.app.api.transactions.llm_categorize", return_value=MOCK_LLM_RESULT_NEEDS_REVIEW)
def test_needs_review_endpoint(mock_llm, client: TestClient, seeded_month: str):
    client.post("/api/transactions/auto-categorize", params={"month": seeded_month})

    resp = client.get("/api/transactions/needs-review", params={"month": seeded_month})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    for t in data:
        assert t["needs_review"] is True


@patch("backend.app.api.transactions.llm_categorize", return_value=MOCK_LLM_RESULT)
def test_auto_categorize_force_param(mock_llm, client: TestClient, seeded_month: str):
    """force=false processes only uncategorized; force=true processes all."""
    resp_no_force = client.post(
        "/api/transactions/auto-categorize",
        params={"month": seeded_month, "force": False},
    )
    assert resp_no_force.status_code == 200
    body_no_force = resp_no_force.json()
    processed_no_force = body_no_force["processed"]

    resp_force = client.post(
        "/api/transactions/auto-categorize",
        params={"month": seeded_month, "force": True},
    )
    assert resp_force.status_code == 200
    body_force = resp_force.json()
    processed_force = body_force["processed"]

    assert processed_force >= processed_no_force
