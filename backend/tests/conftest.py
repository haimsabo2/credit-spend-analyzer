from __future__ import annotations

import os
import sys
from pathlib import Path

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


@pytest.fixture(scope="session")
def app():
    application = create_app()
    init_db()
    return application


@pytest.fixture(scope="session")
def client(app):
    return TestClient(app)

