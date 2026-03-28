"""Orchestrates parsing of legacy .xls reports into normalized transaction records."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import List

import pandas as pd

try:
    from backend.parser import XlsReportParser
    from backend.parser.xls_report_parser import TransactionNormalized
except ModuleNotFoundError:
    # uvicorn from backend/: `app` is the package root, not `backend`.
    from parser import XlsReportParser
    from parser.xls_report_parser import TransactionNormalized


@dataclass
class ParseResult:
    """Container for the output of a single XLS parse run."""

    transactions: List[TransactionNormalized]
    noise_rows_skipped: int


def parse_xls_bytes(file_bytes: bytes) -> ParseResult:
    """Load an .xls file from bytes and return normalized transactions plus stats.

    Uses pandas + xlrd to read the file and the state-machine parser to extract
    transactions. Does not set upload_id; the upload service sets that when
    persisting.
    """
    df = pd.read_excel(io.BytesIO(file_bytes), header=None, engine="xlrd")
    parser = XlsReportParser(df)
    transactions = parser.parse()
    return ParseResult(
        transactions=transactions,
        noise_rows_skipped=parser.noise_rows_skipped,
    )
