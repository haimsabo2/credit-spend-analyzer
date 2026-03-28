from __future__ import annotations

from pathlib import Path
from typing import Generator

from sqlalchemy import event, inspect as sa_inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from .config import get_settings


def _resolve_database_url(raw_url: str) -> str:
    """Resolve DATABASE_URL, ensuring SQLite paths are absolute and directories exist."""
    if not raw_url.startswith("sqlite:///"):
        return raw_url

    raw_path = raw_url.replace("sqlite:///", "", 1)
    db_path = Path(raw_path)

    if not db_path.is_absolute():
        # backend/app/db.py -> backend/app -> backend -> repo root
        base_dir = Path(__file__).resolve().parents[2]
        db_path = (base_dir / db_path).resolve()

    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path.as_posix()}"


settings = get_settings()
DATABASE_URL = _resolve_database_url(settings.database_url)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

if DATABASE_URL == "sqlite:///:memory:":
    # Single in-memory DB across the application (mainly for tests)
    engine = create_engine(
        DATABASE_URL,
        echo=settings.debug,
        connect_args=connect_args,
        poolclass=StaticPool,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        echo=settings.debug,
        connect_args=connect_args,
    )


def _set_sqlite_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


if DATABASE_URL.startswith("sqlite"):
    event.listen(engine, "connect", _set_sqlite_pragmas)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a SQLModel Session."""
    with Session(engine) as session:
        yield session


def _migrate_transaction_spend_pattern_columns() -> None:
    """Add spend_pattern columns to existing SQLite/Postgres DBs (create_all does not alter)."""
    from .models import Transaction

    try:
        inspector = sa_inspect(engine)
    except Exception:
        return
    tname = Transaction.__tablename__
    if not inspector.has_table(tname):
        return
    cols = {c["name"] for c in inspector.get_columns(tname)}
    stmts: list[str] = []
    if "spend_pattern" not in cols:
        stmts.append(
            f'ALTER TABLE "{tname}" ADD COLUMN spend_pattern VARCHAR(20) NOT NULL DEFAULT \'unknown\''
        )
    if "spend_pattern_user_set" not in cols:
        if DATABASE_URL.startswith("sqlite"):
            stmts.append(
                f'ALTER TABLE "{tname}" ADD COLUMN spend_pattern_user_set INTEGER NOT NULL DEFAULT 0'
            )
        else:
            stmts.append(
                f'ALTER TABLE "{tname}" ADD COLUMN spend_pattern_user_set BOOLEAN NOT NULL DEFAULT false'
            )
    if not stmts:
        return
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))


def init_db() -> None:
    """Create database tables for all SQLModel models."""
    from . import models  # noqa: F401
    from .services.categories import ensure_seed_categories

    SQLModel.metadata.create_all(engine)
    _migrate_transaction_spend_pattern_columns()
    with Session(engine) as session:
        ensure_seed_categories(session)

