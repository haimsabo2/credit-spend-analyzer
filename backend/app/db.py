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


def _migrate_merchant_key_user_approval_subcategory() -> None:
    """Add subcategory_id to merchant_key_user_approval for existing DBs."""
    from .models import MerchantKeyUserApproval

    try:
        inspector = sa_inspect(engine)
    except Exception:
        return
    tname = MerchantKeyUserApproval.__tablename__
    if not inspector.has_table(tname):
        return
    cols = {c["name"] for c in inspector.get_columns(tname)}
    if "subcategory_id" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                f'ALTER TABLE "{tname}" ADD COLUMN subcategory_id INTEGER REFERENCES subcategory(id)'
            )
        )


def _migrate_transaction_subcategory_column() -> None:
    """Add subcategory_id to transaction for existing DBs."""
    from .models import Transaction

    try:
        inspector = sa_inspect(engine)
    except Exception:
        return
    tname = Transaction.__tablename__
    if not inspector.has_table(tname):
        return
    cols = {c["name"] for c in inspector.get_columns(tname)}
    if "subcategory_id" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                f'ALTER TABLE "{tname}" ADD COLUMN subcategory_id INTEGER REFERENCES subcategory(id)'
            )
        )


def _migrate_upload_stats_columns() -> None:
    """Add skipped_duplicates_count and enriched_row_count to upload."""
    from .models import Upload

    try:
        inspector = sa_inspect(engine)
    except Exception:
        return
    tname = Upload.__tablename__
    if not inspector.has_table(tname):
        return
    cols = {c["name"] for c in inspector.get_columns(tname)}
    stmts: list[str] = []
    if "skipped_duplicates_count" not in cols:
        stmts.append(
            f'ALTER TABLE "{tname}" ADD COLUMN skipped_duplicates_count INTEGER NOT NULL DEFAULT 0'
        )
    if "enriched_row_count" not in cols:
        stmts.append(f'ALTER TABLE "{tname}" ADD COLUMN enriched_row_count INTEGER')
    if not stmts:
        return
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))


def _migrate_upload_stored_path() -> None:
    """Add stored_path to upload for persisted XLS files."""
    from .models import Upload

    try:
        inspector = sa_inspect(engine)
    except Exception:
        return
    tname = Upload.__tablename__
    if not inspector.has_table(tname):
        return
    cols = {c["name"] for c in inspector.get_columns(tname)}
    if "stored_path" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text(f'ALTER TABLE "{tname}" ADD COLUMN stored_path VARCHAR'))


def _migrate_transaction_source_trace_columns() -> None:
    """Add source row / trace upload columns for XLS provenance."""
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
    if "source_row_1based" not in cols:
        stmts.append(f'ALTER TABLE "{tname}" ADD COLUMN source_row_1based INTEGER')
    if "source_sheet_index" not in cols:
        stmts.append(f'ALTER TABLE "{tname}" ADD COLUMN source_sheet_index INTEGER')
    if "source_trace_upload_id" not in cols:
        stmts.append(
            f'ALTER TABLE "{tname}" ADD COLUMN source_trace_upload_id INTEGER REFERENCES upload(id)'
        )
    if not stmts:
        return
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))


def _migrate_restaurants_category_to_leisure_subcategory() -> None:
    """Move legacy top-level 'מסעדות ובתי קפה' category under 'בילויים ופנאי' as subcategories.

    Idempotent: no-op if the legacy top-level category row does not exist.
    """
    from sqlmodel import select

    from .models import (
        Budget,
        Category,
        ClassificationRule,
        MerchantKeyUserApproval,
        Subcategory,
        Transaction,
    )
    from .services.categories import (
        LEISURE_CATEGORY_NAME_HE,
        LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE,
        RESTAURANTS_SUBCATEGORY_NAME_HE,
    )

    with Session(engine) as session:
        old_cat = session.exec(
            select(Category).where(Category.name == LEGACY_RESTAURANTS_TOP_CATEGORY_NAME_HE)
        ).first()
        if not old_cat or old_cat.id is None:
            return

        r_id = old_cat.id
        leisure = session.exec(
            select(Category).where(Category.name == LEISURE_CATEGORY_NAME_HE)
        ).first()
        if not leisure or leisure.id is None:
            return
        l_id = leisure.id

        default_sub = session.exec(
            select(Subcategory).where(
                Subcategory.category_id == l_id,
                Subcategory.name == RESTAURANTS_SUBCATEGORY_NAME_HE,
            )
        ).first()
        if not default_sub or default_sub.id is None:
            return
        default_sub_id = default_sub.id

        subs_r = list(
            session.exec(select(Subcategory).where(Subcategory.category_id == r_id)).all()
        )
        for sub in subs_r:
            assert sub.id is not None
            twin = session.exec(
                select(Subcategory).where(
                    Subcategory.category_id == l_id,
                    Subcategory.name == sub.name,
                )
            ).first()
            if twin and twin.id != sub.id:
                keep_id, lose_id = twin.id, sub.id
                for t in session.exec(
                    select(Transaction).where(Transaction.subcategory_id == lose_id)
                ).all():
                    t.subcategory_id = keep_id
                for row in session.exec(
                    select(MerchantKeyUserApproval).where(
                        MerchantKeyUserApproval.subcategory_id == lose_id
                    )
                ).all():
                    row.subcategory_id = keep_id
                session.delete(sub)
            else:
                sub.category_id = l_id
                session.add(sub)

        for t in session.exec(select(Transaction).where(Transaction.category_id == r_id)).all():
            t.category_id = l_id
            if t.subcategory_id is None:
                t.subcategory_id = default_sub_id
            session.add(t)

        for rule in session.exec(
            select(ClassificationRule).where(ClassificationRule.category_id == r_id)
        ).all():
            rule.category_id = l_id
            session.add(rule)

        for br in session.exec(select(Budget).where(Budget.category_id == r_id)).all():
            bl = session.exec(
                select(Budget).where(
                    Budget.category_id == l_id,
                    Budget.month == br.month,
                )
            ).first()
            if bl:
                bl.budget_amount += br.budget_amount
                session.delete(br)
            else:
                br.category_id = l_id
                session.add(br)

        session.delete(old_cat)
        session.commit()


def init_db() -> None:
    """Create database tables for all SQLModel models."""
    from . import models  # noqa: F401
    from .services.categories import (
        ensure_default_subcategories,
        ensure_seed_categories,
    )

    SQLModel.metadata.create_all(engine)
    _migrate_upload_stored_path()
    _migrate_upload_stats_columns()
    _migrate_transaction_source_trace_columns()
    _migrate_transaction_spend_pattern_columns()
    _migrate_transaction_subcategory_column()
    _migrate_merchant_key_user_approval_subcategory()
    with Session(engine) as session:
        ensure_seed_categories(session)
        ensure_default_subcategories(session)
    _migrate_restaurants_category_to_leisure_subcategory()

