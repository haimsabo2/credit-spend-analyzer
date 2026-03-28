"""Unit tests for refresh_auto_spend_patterns (month-depth gate + merchant recurrence)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from backend.app.models import Transaction, Upload
from backend.app.services.spend_pattern_refresh import refresh_auto_spend_patterns


@pytest.fixture(name="memory_session")
def _memory_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _add_upload(session: Session, month: str, h: str) -> Upload:
    u = Upload(
        month=month,
        original_filename="x.xls",
        size_bytes=1,
        file_hash=h,
        num_transactions=0,
    )
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


def _add_tx(
    session: Session,
    upload_id: int,
    description: str,
    row_signature: str,
    *,
    user_set: bool = False,
    pattern: str = "unknown",
) -> Transaction:
    t = Transaction(
        upload_id=upload_id,
        description=description,
        amount=1.0,
        currency="ILS",
        row_signature=row_signature,
        posted_at=date(2026, 1, 1),
        spend_pattern=pattern,
        spend_pattern_user_set=user_set,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def test_fewer_than_three_distinct_months_forces_unknown(memory_session: Session):
    u1 = _add_upload(memory_session, "2026-01", "ha")
    u2 = _add_upload(memory_session, "2026-02", "hb")
    t = _add_tx(memory_session, u1.id, "Coffee", "sig-a", pattern="one_time")
    _add_tx(memory_session, u2.id, "Coffee", "sig-b", pattern="recurring")

    refresh_auto_spend_patterns(memory_session)
    memory_session.refresh(t)
    assert t.spend_pattern == "unknown"


def test_three_months_recurring_and_one_time(memory_session: Session):
    months = ["2026-01", "2026-02", "2026-03"]
    uploads = [_add_upload(memory_session, m, f"h{m}") for m in months]
    _add_tx(memory_session, uploads[0].id, "Acme Corp", "sig-r1")
    _add_tx(memory_session, uploads[1].id, "Acme Corp", "sig-r2")
    solo = _add_tx(memory_session, uploads[2].id, "Rare Buy", "sig-o1")

    refresh_auto_spend_patterns(memory_session)
    acme_rows = list(
        memory_session.exec(select(Transaction).where(Transaction.description == "Acme Corp")).all()
    )
    assert len(acme_rows) == 2
    assert all(r.spend_pattern == "recurring" for r in acme_rows)
    memory_session.refresh(solo)
    assert solo.spend_pattern == "one_time"


def test_respects_user_override(memory_session: Session):
    months = ["2026-01", "2026-02", "2026-03"]
    uploads = [_add_upload(memory_session, m, f"hx{m}") for m in months]
    t = _add_tx(
        memory_session,
        uploads[0].id,
        "Same",
        "sig-u1",
        user_set=True,
        pattern="one_time",
    )
    _add_tx(memory_session, uploads[1].id, "Same", "sig-u2")

    refresh_auto_spend_patterns(memory_session)
    memory_session.refresh(t)
    assert t.spend_pattern == "one_time"
    assert t.spend_pattern_user_set is True
