"""Shared spend-pattern literals (no service imports — avoids circular imports)."""

ALLOWED_SPEND_PATTERNS = frozenset({"unknown", "recurring", "one_time"})
