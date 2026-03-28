"""Tests for POST/GET uploads and deduplication via row_signature."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


def _fixture_path(name: str) -> Path:
    return FIXTURES_DIR / name


@pytest.fixture
def fixture_file():
    """Path to first available .xls fixture."""
    for name in ("Export_4_01_2026.xls", "Export_4_03_2026.xls"):
        p = _fixture_path(name)
        if p.exists():
            return p
    pytest.skip("No .xls fixture found in fixtures/")


def test_post_upload_returns_rich_response(client: TestClient, fixture_file: Path):
    with open(fixture_file, "rb") as f:
        content = f.read()
    response = client.post(
        "/api/uploads",
        data={"month": "2026-04"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert response.status_code == 200
    body = response.json()

    assert "upload_id" in body
    assert body["month"] == "2026-04"
    assert body["file_name"] == fixture_file.name
    assert "file_hash" in body and len(body["file_hash"]) == 64

    assert isinstance(body["cards_detected"], list)
    assert len(body["cards_detected"]) >= 1

    assert isinstance(body["sections_detected"], list)
    assert len(body["sections_detected"]) >= 1

    assert body["inserted_count"] >= 0
    assert body["skipped_duplicates_count"] >= 0
    assert body["skipped_noise_count"] >= 0


def test_get_uploads_returns_list(client: TestClient, fixture_file: Path):
    response = client.get("/api/uploads")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_get_uploads_filter_by_month(client: TestClient, fixture_file: Path):
    response = client.get("/api/uploads", params={"month": "2026-04"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_upload_deduplication_same_file_twice(client: TestClient, app, fixture_file: Path):
    """Re-uploading the same file should not create duplicate transactions."""
    with open(fixture_file, "rb") as f:
        content = f.read()

    r1 = client.post(
        "/api/uploads",
        data={"month": "2026-04"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert r1.status_code == 200
    first = r1.json()

    r2 = client.post(
        "/api/uploads",
        data={"month": "2026-04"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert r2.status_code == 200
    second = r2.json()

    assert second["inserted_count"] == 0
    assert second["skipped_duplicates_count"] > 0
    assert first["upload_id"] != second["upload_id"]
    assert first["file_hash"] == second["file_hash"]


def test_replace_month_clears_then_reimports(client: TestClient, fixture_file: Path):
    """replace_month=true removes prior March data; same file imports fresh rows again."""
    client.delete("/api/admin/reset")

    with open(fixture_file, "rb") as f:
        content = f.read()

    r1 = client.post(
        "/api/uploads",
        data={"month": "2026-03"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert r1.status_code == 200
    first_inserted = r1.json()["inserted_count"]
    assert first_inserted > 0

    r2 = client.post(
        "/api/uploads",
        data={"month": "2026-03"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert r2.status_code == 200
    assert r2.json()["inserted_count"] == 0

    r3 = client.post(
        "/api/uploads",
        data={"month": "2026-03", "replace_month": "true"},
        files={"file": (fixture_file.name, content, "application/vnd.ms-excel")},
    )
    assert r3.status_code == 200
    assert r3.json()["inserted_count"] == first_inserted
