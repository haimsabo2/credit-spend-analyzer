"""Deferred upload ingest + chunked categorization API."""

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


def test_upload_defer_skips_categorization(client: TestClient, fixture_file: Path):
    client.delete("/api/admin/reset")
    month = "2026-08"
    with open(fixture_file, "rb") as f:
        content = f.read()
    r = client.post(
        "/api/uploads",
        data={"month": month, "defer_categorization": "true"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["categorization_deferred"] is True
    assert body["categorization"]["processed"] == 0
    assert body["inserted_count"] > 0

    txs = client.get("/api/transactions", params={"month": month, "limit": 5}).json()
    assert any(t["category_id"] is None for t in txs)


def test_categorize_queue_and_chunk(client: TestClient, fixture_file: Path):
    client.delete("/api/admin/reset")
    month = "2026-09"
    with open(fixture_file, "rb") as f:
        content = f.read()
    up = client.post(
        "/api/uploads",
        data={"month": month, "defer_categorization": "true"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert up.status_code == 200

    q = client.get("/api/transactions/categorize-queue", params={"month": month})
    assert q.status_code == 200
    assert q.json()["pending_count"] >= 1

    c = client.post(
        "/api/transactions/auto-categorize-chunk",
        params={"month": month, "limit": 80},
    )
    assert c.status_code == 200
    chunk_body = c.json()
    assert "chunk" in chunk_body
    assert "pending_remaining" in chunk_body
    assert "done" in chunk_body
    assert isinstance(chunk_body["done"], bool)
