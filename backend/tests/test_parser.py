from __future__ import annotations

from pathlib import Path

import pytest

from backend.parser import TransactionNormalized, parse_xls_report


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = PROJECT_ROOT / "fixtures"


def _require_fixture(name: str) -> Path:
    path = FIXTURES_DIR / name
    if not path.exists():
        pytest.skip(f"Fixture file not found: {path}")
    return path


def test_parser_returns_non_empty_for_each_fixture():
    """Each existing fixture yields at least one transaction (structural assertion)."""
    for name in ("Export_4_01_2026.xls", "Export_4_03_2026.xls"):
        path = FIXTURES_DIR / name
        if not path.exists():
            continue
        txs = parse_xls_report(path)
        assert len(txs) > 0, f"Fixture {name} should produce at least one transaction"


def test_parser_finds_multiple_card_labels_in_first_fixture():
    path = _require_fixture("Export_4_01_2026.xls")
    txs = parse_xls_report(path)
    assert isinstance(txs, list)
    assert all(isinstance(t, TransactionNormalized) for t in txs)
    card_labels = {t.card_label for t in txs if t.card_label}
    assert len(card_labels) >= 2


def test_parser_extracts_il_and_foreign_sections_across_fixtures():
    fixtures = [
        FIXTURES_DIR / "Export_4_01_2026.xls",
        FIXTURES_DIR / "Export_4_03_2026.xls",
    ]
    sections = set()
    any_fixture = False
    for path in fixtures:
        if not path.exists():
            continue
        any_fixture = True
        txs = parse_xls_report(path)
        sections.update(t.section for t in txs if t.section)

    if not any_fixture:
        pytest.skip("No parser fixtures found under fixtures/")

    assert "IL" in sections
    assert "FOREIGN" in sections


def test_parser_produces_transactions_and_skips_noise_lines():
    noise_markers = ["TOTAL FOR DATE", "סך חיוב"]
    fixtures = [
        FIXTURES_DIR / "Export_4_01_2026.xls",
        FIXTURES_DIR / "Export_4_03_2026.xls",
    ]

    any_fixture = False
    has_transactions = False

    for path in fixtures:
        if not path.exists():
            continue
        any_fixture = True

        txs = parse_xls_report(path)
        if txs:
            has_transactions = True
        for t in txs:
            text = (t.merchant_raw or "") + " " + (t.details or "")
            for marker in noise_markers:
                assert marker not in text

    if not any_fixture:
        pytest.skip("No parser fixtures found under fixtures/")

    assert has_transactions


def test_row_signature_is_non_empty_and_stable():
    path = _require_fixture("Export_4_01_2026.xls")
    txs1 = parse_xls_report(path)
    txs2 = parse_xls_report(path)

    sigs1 = {t.row_signature for t in txs1}
    sigs2 = {t.row_signature for t in txs2}

    assert all(isinstance(sig, str) and sig for sig in sigs1)
    assert sigs1 == sigs2

