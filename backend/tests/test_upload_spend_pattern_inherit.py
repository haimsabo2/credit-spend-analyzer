"""New transactions inherit spend_pattern from user-set peers with the same merchant key."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.db import engine
from backend.app.models import Transaction, Upload
from backend.app.services.uploads import _inherit_spend_pattern_from_user_set_peers


def test_inherit_spend_pattern_from_user_set_peer(client: TestClient):
    client.delete("/api/admin/reset")
    sig_peer = f"inh-peer-{uuid.uuid4().hex}"
    sig_new = f"inh-new-{uuid.uuid4().hex}"
    desc = f"INHERIT_SP_{uuid.uuid4().hex[:10]}"

    with Session(engine) as session:
        up1 = Upload(
            month="2026-06",
            original_filename="a.xls",
            size_bytes=1,
            file_hash=sig_peer,
            num_transactions=1,
        )
        session.add(up1)
        session.commit()
        session.refresh(up1)
        peer = Transaction(
            upload_id=up1.id,
            description=desc,
            amount=1.0,
            row_signature=sig_peer,
            spend_pattern="recurring",
            spend_pattern_user_set=True,
        )
        session.add(peer)
        session.commit()
        session.refresh(peer)

        up2 = Upload(
            month="2026-07",
            original_filename="b.xls",
            size_bytes=1,
            file_hash=sig_new,
            num_transactions=1,
        )
        session.add(up2)
        session.commit()
        session.refresh(up2)
        new_tx = Transaction(
            upload_id=up2.id,
            description=desc,
            amount=2.0,
            row_signature=sig_new,
            spend_pattern="unknown",
            spend_pattern_user_set=False,
        )
        session.add(new_tx)
        session.commit()
        session.refresh(new_tx)

        _inherit_spend_pattern_from_user_set_peers(session, [new_tx])
        session.refresh(new_tx)

        assert new_tx.spend_pattern == "recurring"
        assert new_tx.spend_pattern_user_set is True

    loaded = (
        Session(engine)
        .exec(select(Transaction).where(Transaction.row_signature == sig_new))
        .first()
    )
    assert loaded is not None
    assert loaded.spend_pattern == "recurring"
    assert loaded.spend_pattern_user_set is True
