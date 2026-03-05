"""Unit tests for currency normalization (parser + API output)."""

from __future__ import annotations

import pytest

from backend.parser.normalize import normalize_currency
from backend.app.utils import normalize_currency_code
from backend.app.schemas import TransactionRead


class TestParserNormalizeCurrency:
    """Tests for normalize_currency in parser/normalize.py."""

    @pytest.mark.parametrize("raw,expected", [
        ("₪", "₪"),
        ("NIS", "₪"),
        ("nis", "₪"),
        ("Nis", "₪"),
        ("ILS", "₪"),
        ("ils", "₪"),
        ("Ils", "₪"),
    ])
    def test_shekel_aliases(self, raw, expected):
        assert normalize_currency(raw) == expected

    @pytest.mark.parametrize("raw,expected", [
        ("USD", "USD"),
        ("usd", "USD"),
        ("Usd", "USD"),
        ("EUR", "EUR"),
        ("eur", "EUR"),
        ("GBP", "GBP"),
    ])
    def test_other_currencies_uppercased(self, raw, expected):
        assert normalize_currency(raw) == expected

    def test_none_returns_none(self):
        assert normalize_currency(None) is None

    def test_empty_string_returns_none(self):
        assert normalize_currency("") is None

    def test_whitespace_only_returns_none(self):
        assert normalize_currency("   ") is None

    def test_whitespace_stripped(self):
        assert normalize_currency("  NIS  ") == "₪"
        assert normalize_currency("  USD  ") == "USD"

    def test_shekel_symbol_is_unicode(self):
        result = normalize_currency("ILS")
        assert result == "₪"
        assert isinstance(result, str)
        assert result == "\u20aa"


class TestUtilsNormalizeCurrencyCode:
    """Tests for normalize_currency_code in app/utils.py."""

    @pytest.mark.parametrize("raw,expected", [
        ("₪", "₪"),
        ("NIS", "₪"),
        ("ILS", "₪"),
        ("nis", "₪"),
        ("USD", "USD"),
        ("eur", "EUR"),
    ])
    def test_normalization(self, raw, expected):
        assert normalize_currency_code(raw) == expected

    def test_none_passthrough(self):
        assert normalize_currency_code(None) is None


class TestTransactionReadCurrencyValidator:
    """Tests that TransactionRead normalizes currency on output."""

    def _build(self, currency: str | None) -> TransactionRead:
        return TransactionRead(
            id=1,
            upload_id=1,
            card_label=None,
            section=None,
            posted_at=None,
            description="test",
            amount=100.0,
            currency=currency,
            needs_review=False,
            category_id=None,
            confidence=0.0,
            rule_id_applied=None,
        )

    def test_ils_normalized_to_shekel(self):
        t = self._build("ILS")
        assert t.currency == "₪"

    def test_nis_normalized_to_shekel(self):
        t = self._build("NIS")
        assert t.currency == "₪"

    def test_shekel_symbol_unchanged(self):
        t = self._build("₪")
        assert t.currency == "₪"

    def test_usd_uppercased(self):
        t = self._build("usd")
        assert t.currency == "USD"

    def test_none_stays_none(self):
        t = self._build(None)
        assert t.currency is None
