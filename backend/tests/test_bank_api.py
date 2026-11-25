from __future__ import annotations

from datetime import date
from sqlmodel import Session, select

from backend.app.db import engine
from backend.app.models import Category, Transaction, Upload


def _build_leumi_html_xls(account: str, rows_newest_first: list[tuple[str, str, str, str, str, str, str]]) -> bytes:
    """Build a realistic Bank Leumi HTML .xls export with outer wrapper table and bidi marks."""
    tr_html = []
    for act_d, val_d, desc, ref, deb, cred, bal in rows_newest_first:
        tr_html.append(
            f"<tr><td>{act_d}</td><td>{val_d}</td><td>{desc}</td>"
            f"<td>{ref}</td><td>{deb}</td><td>{cred}</td><td>{bal}</td><td></td></tr>"
        )
    html_doc = f"""<html><head><meta charset="utf-8"></head><body>
    <table><tr><td>
      <div>בנק לאומי</div>
      <div>מס' חשבון : \u200f\u200e{account}\u200e</div>
      <table>
        <tr><th>תאריך</th><th>תאריך ערך</th><th>תיאור</th><th>אסמכתא</th><th>בחובה</th><th>בזכות</th><th>היתרה בש"ח</th><th>הערה</th></tr>
        {''.join(tr_html)}
      </table>
    </td></tr></table>
    </body></html>"""
    return html_doc.encode("utf-8")


def test_bank_incremental_upload_dedup_and_preserves_user_tags(client):
    client.delete("/api/admin/reset")

    # Statement 1: Oct–Nov 2026 (including two identical transfers on 17/10/2026)
    stmt1 = _build_leumi_html_xls(
        "940-110192/96",
        [
            ("15/11/2026", "15/11/2026", "בנק הפועלים", "99012", "0.00", "30,000.00", "65,000.00"),
            ("10/11/2026", "10/11/2026", "טפחות-משכנתא-י", "704", "7,200.00", "0.00", "35,000.00"),
            ("03/11/2026", "03/11/2026", "הוראת קבע", "5034217", "454.00", "0.00", "42,200.00"),
            ("01/11/2026", "01/11/2026", "סימילרווב בע-י", "75512", "0.00", "28,300.00", "42,654.00"),
            ("21/10/2026", "21/10/2026", "הוראת קבע", "5020500", "600.00", "0.00", "14,354.00"),
            ("17/10/2026", "17/10/2026", "העברה דיגיטל", "29300", "5,500.00", "0.00", "14,954.00"),
            ("17/10/2026", "17/10/2026", "העברה דיגיטל", "29300", "5,500.00", "0.00", "20,454.00"),
        ],
    )

    r1 = client.post(
        "/api/bank/uploads",
        files=[("files", ("leumi_part1.xls", stmt1, "application/vnd.ms-excel"))],
    )
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["total_inserted"] == 7
    assert b1["total_skipped_duplicates"] == 0
    assert b1["previous_max_date"] is None
    assert b1["new_max_date"] == "2026-11-15"

    # Override external transfer tag to 'gift'
    analysis1 = client.get("/api/bank/analysis").json()
    assert len(analysis1["external_transfers"]) == 1
    ext_tx_id = analysis1["external_transfers"][0]["id"]

    patch_resp = client.patch(
        f"/api/bank/transactions/{ext_tx_id}",
        json={"transfer_tag": "gift"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["transfer_tag"] == "gift"
    assert patch_resp.json()["is_user_override"] is True

    # Statement 2: Overlaps Oct 17 – Nov 15 AND adds new Dec 2026 rows (with perturbed balance column)
    stmt2 = _build_leumi_html_xls(
        "940-110192/96",
        [
            ("20/12/2026", "20/12/2026", "קצבת ילדים-י", "13104", "0.00", "598.00", "93,898.00"),
            ("01/12/2026", "01/12/2026", "סימילרווב בע-י", "75512", "0.00", "28,300.00", "93,300.00"),
            ("15/11/2026", "15/11/2026", "בנק הפועלים", "99012", "0.00", "30,000.00", "99,999.00"),
            ("10/11/2026", "10/11/2026", "טפחות-משכנתא-י", "704", "7,200.00", "0.00", "35,000.00"),
            ("17/10/2026", "17/10/2026", "העברה דיגיטל", "29300", "5,500.00", "0.00", "14,954.00"),
            ("17/10/2026", "17/10/2026", "העברה דיגיטל", "29300", "5,500.00", "0.00", "20,454.00"),
        ],
    )

    r2 = client.post(
        "/api/bank/uploads",
        files=[("files", ("leumi_part2.xls", stmt2, "application/vnd.ms-excel"))],
    )
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["total_inserted"] == 2
    assert b2["total_skipped_duplicates"] == 4
    assert b2["previous_max_date"] == "2026-11-15"
    assert b2["new_max_date"] == "2026-12-20"

    status = client.get("/api/bank/status").json()
    assert status["total_transactions"] == 9
    assert status["last_synced_date"] == "2026-12-20"

    # Confirm user tag override was preserved and NOT overwritten
    analysis2 = client.get("/api/bank/analysis").json()
    assert analysis2["external_transfers"][0]["tag"] == "gift"
    assert analysis2["external_transfers"][0]["is_user_override"] is True


def test_cc_travel_excluded_in_calc_layer_without_mutating_cc_transactions(client):
    client.delete("/api/admin/reset")

    with Session(engine) as session:
        travel_cat = session.exec(
            select(Category).where(Category.name == 'נסיעות וחו"ל')
        ).first()
        groceries_cat = session.exec(
            select(Category).where(Category.name == "סופר ומכולת")
        ).first()
        assert travel_cat is not None and groceries_cat is not None

        up = Upload(
            month="2026-10",
            original_filename="cc_2026_10.xls",
            size_bytes=100,
            file_hash="hash_cc_2026_10",
            num_transactions=3,
        )
        session.add(up)
        session.commit()
        session.refresh(up)

        t_issta = Transaction(
            upload_id=up.id,
            card_label="זהב - ביזנס - 6813",
            posted_at=date(2026, 9, 24),
            description='איסתא ספורט בע"מ',
            amount=3250.85,
            currency="₪",
            row_signature="sig_test_issta",
            spend_pattern="recurring",
            category_id=None,
            raw_row_data='{"details": "תשלום 2 מתוך 6", "source_cells": ["24/09/2026", "איסתא", "19505.11"]}',
        )
        t_hotel = Transaction(
            upload_id=up.id,
            card_label="זהב - ביזנס - 5644",
            posted_at=date(2026, 10, 10),
            description="מלון רויאל גארדן",
            amount=6798.00,
            currency="₪",
            row_signature="sig_test_hotel",
            spend_pattern="recurring",
            category_id=travel_cat.id,
        )
        t_groc = Transaction(
            upload_id=up.id,
            card_label="זהב - ביזנס - 5644",
            posted_at=date(2026, 10, 12),
            description="שופרסל דיל רעננה",
            amount=5000.00,
            currency="₪",
            row_signature="sig_test_groc",
            spend_pattern="recurring",
            category_id=groceries_cat.id,
        )
        session.add_all([t_issta, t_hotel, t_groc])
        session.commit()

    # Upload bank statement for 2026-11 (which joins 1-month lagged to Upload 2026-10)
    bank_nov = _build_leumi_html_xls(
        "940-110192/96",
        [
            ("02/11/2026", "02/11/2026", "ל.מאסטרקארד", "5644", "15,048.85", "0.00", "20,000.00"),
            ("01/11/2026", "01/11/2026", "סימילרווב בע-י", "75512", "0.00", "28,300.00", "35,048.85"),
        ],
    )
    resp = client.post(
        "/api/bank/uploads",
        files=[("files", ("nov_bank.xls", bank_nov, "application/vnd.ms-excel"))],
    )
    assert resp.status_code == 200

    analysis = client.get("/api/bank/analysis").json()
    nov_row = next(m for m in analysis["monthly"] if m["ym"] == "2026-11")
    assert nov_row["cc_source"] == "db"
    assert abs(nov_row["cc_ot"] - 10048.85) < 0.05
    assert abs(nov_row["cc_rec"] - 5000.00) < 0.05
    assert len(analysis["open_installments"]) == 1
    assert analysis["open_installments"][0]["remaining_installments"] == 4

    # Verify settings persistence
    put_res = client.put(
        "/api/bank/settings",
        json={
            "inc_muni_dig": True,
            "inc_bit": False,
            "inc_bituach_leumi": True,
            "inc_sav_600_as_expense": False,
            "inc_khs_as_expense": False,
        },
    )
    assert put_res.status_code == 200
    assert client.get("/api/bank/analysis").json()["settings"]["inc_bituach_leumi"] is True

    # CRITICAL: Confirm credit card Transaction rows in DB were NOT mutated
    with Session(engine) as session:
        issta_after = session.exec(
            select(Transaction).where(Transaction.row_signature == "sig_test_issta")
        ).one()
        hotel_after = session.exec(
            select(Transaction).where(Transaction.row_signature == "sig_test_hotel")
        ).one()
        assert issta_after.spend_pattern == "recurring"
        assert hotel_after.spend_pattern == "recurring"
