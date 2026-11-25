"""Seed Bank Leumi checking statement (.xls) into data/app.db using incremental dedup pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import Session  # noqa: E402

from app.db import engine, init_db  # noqa: E402
from app.services.bank_uploads import ingest_bank_statement_bytes  # noqa: E402

DEFAULT_STATEMENT_PATH = Path(r"C:\Users\Haim\Downloads\תנועות בחשבון 24_11_2026 (1).xls")


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_STATEMENT_PATH
    if not src.exists():
        raise FileNotFoundError(f"Bank statement file not found: {src}")

    init_db()
    content = src.read_bytes()

    with Session(engine) as session:
        res = ingest_bank_statement_bytes(
            session,
            content=content,
            filename=src.name,
            content_type="application/vnd.ms-excel",
        )
        print(
            f"Seed complete: account={res.upload.account_number} | "
            f"range={res.upload.date_from}..{res.upload.date_to} | "
            f"inserted={res.inserted_count} | skipped_duplicates={res.skipped_duplicates_count} | "
            f"prev_max={res.previous_max_date} -> new_max={res.new_max_date}"
        )


if __name__ == "__main__":
    main()
