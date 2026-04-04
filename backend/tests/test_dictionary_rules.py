"""Unit tests for the keyword dictionary categorizer."""

from __future__ import annotations

from backend.app.models import Transaction
from backend.app.services.categories import (
    LEISURE_CATEGORY_NAME_HE,
    RESTAURANTS_SUBCATEGORY_NAME_HE,
)
from backend.app.services.dictionary_rules import dictionary_categorize


def _make_tx(description: str) -> Transaction:
    """Create a minimal Transaction-like object for dictionary matching."""
    return Transaction(
        description=description,
        amount=0,
        row_signature=f"test-{description}",
        upload_id=0,
    )


def test_hebrew_keyword_match():
    result = dictionary_categorize(_make_tx("שופרסל דימונה"))
    assert result is not None
    assert result.category_name_he == "סופר ומכולת"
    assert result.confidence == 0.8


def test_english_keyword_case_insensitive():
    result = dictionary_categorize(_make_tx("NETFLIX MONTHLY"))
    assert result is not None
    assert result.category_name_he == "מנויים ודיגיטל"


def test_english_keyword_lowercase():
    result = dictionary_categorize(_make_tx("spotify premium"))
    assert result is not None
    assert result.category_name_he == "מנויים ודיגיטל"


def test_fuel_keyword():
    result = dictionary_categorize(_make_tx("תחנת דלק פז"))
    assert result is not None
    assert result.category_name_he == "תחבורה ודלק"


def test_health_keyword():
    result = dictionary_categorize(_make_tx("מכבי שירותי בריאות"))
    assert result is not None
    assert result.category_name_he == "בריאות"


def test_no_match_returns_none():
    result = dictionary_categorize(_make_tx("some random merchant xyz"))
    assert result is None


def test_empty_description_returns_none():
    result = dictionary_categorize(_make_tx(""))
    assert result is None


def test_insurance_keyword():
    result = dictionary_categorize(_make_tx("הראל ביטוח ופיננסים"))
    assert result is not None
    assert result.category_name_he == "ביטוחים"


def test_taxes_keyword():
    result = dictionary_categorize(_make_tx("ביטוח לאומי"))
    assert result is not None
    assert result.category_name_he == "מיסים ואגרות"


def test_reason_he_contains_keyword():
    result = dictionary_categorize(_make_tx("רמי לוי"))
    assert result is not None
    assert "רמי לוי" in result.reason_he


def test_dictionary_wolt_leisure_and_restaurants_sub():
    result = dictionary_categorize(_make_tx("WOLT חיפה"))
    assert result is not None
    assert result.category_name_he == LEISURE_CATEGORY_NAME_HE
    assert result.subcategory_name_he == RESTAURANTS_SUBCATEGORY_NAME_HE
