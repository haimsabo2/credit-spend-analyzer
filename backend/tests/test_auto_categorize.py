"""Tests for POST /api/transactions/auto-categorize and GET /api/transactions/needs-review."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.schemas import LLMCategorizationResult

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"

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
    """Fresh DB + upload so this module does not depend on ordering with other API tests."""
    client.delete("/api/admin/reset")
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


def test_auto_categorize_response_schema(client: TestClient, seeded_month: str):
    resp = client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
    assert resp.status_code == 200
    body = resp.json()

    assert isinstance(body["processed"], int)
    assert isinstance(body["categorized"], int)
    assert isinstance(body["needs_review"], int)
    assert isinstance(body["failed"], int)
    assert isinstance(body["failures_sample"], list)
    assert body["failed"] == 0


def test_auto_categorize_updates_rows(client: TestClient, seeded_month: str):
    """Upload runs rules/dictionary (no default LLM); auto-categorize stays consistent with pending queue."""
    txns = client.get("/api/transactions", params={"month": seeded_month, "limit": 50}).json()
    assert len(txns) > 0
    for t in txns:
        if t["category_id"] is not None:
            assert t["confidence"] > 0

    resp = client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
    assert resp.status_code == 200
    body = resp.json()
    if body["processed"] > 0:
        assert body["categorized"] + body["needs_review"] + body["failed"] == body["processed"]


def test_auto_categorize_does_not_invoke_llm_batch(client: TestClient, seeded_month: str):
    """Default path must not call OpenAI batch categorization."""
    with patch(
        "backend.app.services.batch_categorize.categorize_transactions_batch",
    ) as mock_batch:
        mock_batch.side_effect = AssertionError("categorize_transactions_batch must not run")
        resp = client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
        assert resp.status_code == 200
        mock_batch.assert_not_called()


@patch(
    "backend.app.services.batch_categorize.categorize_transactions_batch",
)
def test_needs_review_endpoint(mock_batch, client: TestClient, seeded_month: str):
    mock_batch.side_effect = lambda txns: {
        t.id: MOCK_LLM_RESULT_NEEDS_REVIEW for t in txns
    }
    client.post("/api/admin/reset-categorization", params={"month": seeded_month})
    client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
    client.post(
        "/api/transactions/llm-categorize-pending",
        params={"month": seeded_month, "limit": 500},
    )

    resp = client.get("/api/transactions/needs-review", params={"month": seeded_month})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    for t in data:
        assert t["needs_review"] is True


@patch("backend.app.services.batch_categorize.categorize_transactions_batch")
def test_llm_categorize_pending_invokes_batch(mock_batch, client: TestClient, seeded_month: str):
    mock_batch.side_effect = lambda txns: {
        t.id: MOCK_LLM_RESULT_NEEDS_REVIEW for t in txns
    }
    client.post("/api/admin/reset-categorization", params={"month": seeded_month})
    client.post("/api/transactions/auto-categorize", params={"month": seeded_month})
    mock_batch.reset_mock()
    cnt_res = client.get(
        "/api/transactions/llm-categorize-pending/count",
        params={"month": seeded_month},
    )
    assert cnt_res.status_code == 200
    pending = cnt_res.json()["pending_count"]
    resp = client.post(
        "/api/transactions/llm-categorize-pending",
        params={"month": seeded_month, "limit": 500},
    )
    assert resp.status_code == 200
    if pending > 0:
        assert mock_batch.called
    else:
        assert resp.json()["processed"] == 0


def test_auto_categorize_force_param(client: TestClient, seeded_month: str):
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
