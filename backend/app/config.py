from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parents[2] / ".env"
if not _env_path.exists():
    _env_path = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(_env_path, override=False)

try:
    from pydantic_settings import BaseSettings
except ImportError:
    from pydantic import BaseSettings  # pydantic v1


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    app_name: str = "Credit Spend Analyzer API"
    debug: bool = True
    database_url: str = "sqlite:///data/app.db"
    cors_origins: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_base_url: Optional[str] = None
    # Representatives per LLM request (dedupe collapses identical merchant lines first).
    categorize_llm_batch_size: int = 32
    # When false, auto-categorize uses rules + dictionary only; use llm-categorize-pending for AI.
    auto_categorize_use_llm: bool = False
    # Directory for persisted XLS uploads (empty = backend/data/upload_files).
    upload_storage_dir: str = ""

    class Config:
        env_prefix = "CSA_"
        case_sensitive = False

    def __init__(self, **kwargs: object) -> None:
        super().__init__(**kwargs)
        if not self.llm_api_key:
            self.llm_api_key = os.environ.get("OPENAI_API_KEY", "")


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()

