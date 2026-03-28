from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

_project_root = Path(__file__).resolve().parents[2]
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

TEST_DB_PATH = Path(__file__).parent / "test_app.db"
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

os.environ.setdefault("CSA_DATABASE_URL", f"sqlite:///{TEST_DB_PATH}")

from backend.app.main import create_app  # noqa: E402
from backend.app.db import init_db  # noqa: E402
from backend.app.schemas import LLMCategorizationResult  # noqa: E402

_MOCK_LLM_DEFAULT = LLMCategorizationResult(
    category_name_he="סופר ומכולת",
    confidence=0.85,
    needs_review=False,
    reason_he="רכישה בסופרמרקט",
    merchant_key_guess="shupersal",
    suggested_new_category=None,
)


def _mock_categorize_transactions_batch(transactions):
    return {t.id: _MOCK_LLM_DEFAULT for t in transactions}


@pytest.fixture(autouse=True)
def _mock_llm_for_categorization():
    """Avoid real OpenAI calls during uploads and auto-categorize (tests patch override when needed)."""
    with patch(
        "backend.app.services.batch_categorize.categorize_transactions_batch",
        side_effect=_mock_categorize_transactions_batch,
    ):
        yield


@pytest.fixture(scope="session")
def app():
    application = create_app()
    init_db()
    return application


@pytest.fixture(scope="session")
def client(app):
    return TestClient(app)

