"""Create a consistent SQLite backup (safe while app is running with WAL)."""
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC = REPO_ROOT / "data" / "app.db"
BACKUP_DIR = REPO_ROOT / "backups"


def main() -> int:
    if not SRC.exists():
        print(f"Database not found: {SRC}", file=sys.stderr)
        return 1

    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    dest = BACKUP_DIR / f"app-{stamp}.db"

    src_conn = sqlite3.connect(SRC)
    dest_conn = sqlite3.connect(dest)
    with dest_conn:
        src_conn.backup(dest_conn)
    src_conn.close()
    dest_conn.close()

    conn = sqlite3.connect(dest)
    tx = conn.execute('SELECT COUNT(*) FROM "transaction"').fetchone()[0]
    categorized = conn.execute(
        'SELECT COUNT(*) FROM "transaction" WHERE category_id IS NOT NULL'
    ).fetchone()[0]
    groups = conn.execute("SELECT COUNT(*) FROM merchant_spend_group").fetchone()[0]
    rules = conn.execute("SELECT COUNT(*) FROM classificationrule").fetchone()[0]
    conn.close()

    print(f"Backup: {dest}")
    print(f"Size: {dest.stat().st_size} bytes")
    print(f"Transactions: {tx}, categorized: {categorized}, spend groups: {groups}, rules: {rules}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
