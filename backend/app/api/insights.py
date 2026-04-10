from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from ..dependencies import SessionDep
from ..models import MerchantSpendGroup
from ..schemas import (
    AnomalyItem,
    CardSpend,
    CardTrendPoint,
    CardTrendResponse,
    CategoryMonthlyRow,
    CategorySpend,
    CategoryYearMerchantsResponse,
    DataQualityResponse,
    MerchantGroupSeriesResponse,
    MerchantMonthlySeries,
    MerchantSpend,
    MonthCategorySubcategoriesResponse,
    RecurringSpendItem,
    RecurringSpendResponse,
    SubcategoryMonthSlice,
    SummaryResponse,
    TopUncategorizedMerchant,
    TrendsResponse,
)
from ..utils import prior_months as _prior_months
from ..utils import trailing_calendar_months_ending_at

router = APIRouter()

_TOP_MERCHANTS_YEAR_BREAKDOWN = 14
_TOP_SUBCATEGORY_YEAR_BREAKDOWN = 14
_OTHER_MERCHANT_KEY = "Other"
_OTHER_SUBCATEGORY_KEY = "Other"


def _months_inclusive_range(first_ym: str, last_ym: str) -> list[str]:
    """Every YYYY-MM from *first_ym* through *last_ym* inclusive (calendar order)."""
    y1, m1 = int(first_ym[:4]), int(first_ym[5:7])
    y2, m2 = int(last_ym[:4]), int(last_ym[5:7])
    out: list[str] = []
    y, m = y1, m1
    while (y < y2) or (y == y2 and m <= m2):
        out.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _calendar_year_month_labels_with_data_span(session, year: int) -> list[str]:
    """First month in *year* with any transaction through last (gaps kept as zero columns)."""
    start_m = f"{year}-01"
    end_m = f"{year}-12"
    rows = session.execute(
        text("""
            SELECT u.month
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month >= :start_m AND u.month <= :end_m
            GROUP  BY u.month
            ORDER  BY u.month
        """),
        {"start_m": start_m, "end_m": end_m},
    ).all()
    if not rows:
        return []
    return _months_inclusive_range(rows[0].month, rows[-1].month)


def _category_series_for_months(session, month_labels: list[str]) -> dict[str, list[float]]:
    if not month_labels:
        return {}
    months_list = ",".join(f"'{m}'" for m in month_labels)
    top_cat_rows = session.execute(
        text(f"""
            SELECT t.category_id, SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month IN ({months_list})
              AND  t.category_id IS NOT NULL
            GROUP  BY t.category_id
            ORDER  BY total DESC
            LIMIT  8
        """),
    ).all()
    top_cat_ids = [r.category_id for r in top_cat_rows]
    category_series: dict[str, list[float]] = {}
    if not top_cat_ids:
        return category_series
    placeholders = ",".join(str(cid) for cid in top_cat_ids)
    cat_monthly = session.execute(
        text(f"""
            SELECT u.month, t.category_id, SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month IN ({months_list})
              AND  t.category_id IN ({placeholders})
            GROUP  BY u.month, t.category_id
        """),
    ).all()
    lookup: dict[tuple[str, int], float] = {}
    for r in cat_monthly:
        lookup[(r.month, r.category_id)] = r.total
    for cid in top_cat_ids:
        category_series[str(cid)] = [lookup.get((m, cid), 0.0) for m in month_labels]
    return category_series


def _category_monthly_full(session, month_labels: list[str]) -> list[CategoryMonthlyRow]:
    """All categories with any spend in the window; 12 (or len(months)) amounts per row."""
    if not month_labels:
        return []
    months_list = ",".join(f"'{m}'" for m in month_labels)
    rows = session.execute(
        text(f"""
            SELECT u.month,
                   t.category_id,
                   COALESCE(c.name, 'Uncategorized') AS category_name,
                   SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            LEFT JOIN category c ON t.category_id = c.id
            WHERE  u.month IN ({months_list})
            GROUP  BY u.month, t.category_id, category_name
        """),
    ).all()
    if not rows:
        return []

    cat_names: dict[Optional[int], str] = {}
    lookup: dict[tuple[str, Optional[int]], float] = {}
    for r in rows:
        cid = r.category_id
        cat_names[cid] = r.category_name
        lookup[(r.month, cid)] = float(r.total)

    out: list[CategoryMonthlyRow] = []
    for cid in cat_names:
        amounts = [lookup.get((m, cid), 0.0) for m in month_labels]
        year_total = sum(amounts)
        out.append(
            CategoryMonthlyRow(
                category_id=cid,
                category_name=cat_names[cid],
                amounts=amounts,
                year_total=year_total,
            ),
        )
    out.sort(key=lambda row: row.year_total, reverse=True)
    return out


def _category_year_merchant_breakdown(
    session,
    month_labels: list[str],
    category_id: Optional[int],
) -> CategoryYearMerchantsResponse:
    """Per-merchant monthly totals for one category in a calendar year; top-N + Other, stack order ASC by year total."""
    if not month_labels:
        return CategoryYearMerchantsResponse(months=[], merchants=[])

    months_list = ",".join(f"'{m}'" for m in month_labels)
    if category_id is None:
        where_cat = "t.category_id IS NULL"
        params: dict = {}
    else:
        where_cat = "t.category_id = :cid"
        params = {"cid": category_id}

    rows = session.execute(
        text(f"""
            SELECT u.month,
                   SUM(t.amount) AS total,
                   COALESCE(MAX(g.display_name), MIN(t.description)) AS merchant_label
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            LEFT JOIN merchant_spend_group_member m
                   ON lower(trim(t.description)) = m.pattern_key
            LEFT JOIN merchant_spend_group g ON m.group_id = g.id
            WHERE  u.month IN ({months_list})
              AND  {where_cat}
            GROUP  BY u.month,
                     COALESCE(CAST(g.id AS TEXT), lower(trim(t.description)))
        """),
        params,
    ).all()

    if not rows:
        return CategoryYearMerchantsResponse(months=month_labels, merchants=[])

    per_merchant: dict[str, list[float]] = {}
    lookup: dict[tuple[str, str], float] = {}
    for r in rows:
        mk = (r.merchant_label or "").strip() or "(no description)"
        lookup[(r.month, mk)] = float(r.total)
        if mk not in per_merchant:
            per_merchant[mk] = [0.0] * len(month_labels)

    for mk in list(per_merchant.keys()):
        per_merchant[mk] = [lookup.get((m, mk), 0.0) for m in month_labels]

    totals = {mk: sum(amts) for mk, amts in per_merchant.items()}
    sorted_by_total_desc = sorted(totals.keys(), key=lambda k: totals[k], reverse=True)
    top_keys = sorted_by_total_desc[:_TOP_MERCHANTS_YEAR_BREAKDOWN]
    tail_keys = sorted_by_total_desc[_TOP_MERCHANTS_YEAR_BREAKDOWN:]

    merged: dict[str, list[float]] = {k: per_merchant[k][:] for k in top_keys}
    if tail_keys:
        other_amt = [0.0] * len(month_labels)
        for tk in tail_keys:
            for i, v in enumerate(per_merchant[tk]):
                other_amt[i] += v
        merged[_OTHER_MERCHANT_KEY] = other_amt

    # Stack bottom = smallest year total, top = largest (ascending sort)
    keys_for_response = sorted(merged.keys(), key=lambda k: sum(merged[k]))
    merchants_out = [
        MerchantMonthlySeries(merchant_key=k, amounts=merged[k]) for k in keys_for_response
    ]
    return CategoryYearMerchantsResponse(months=month_labels, merchants=merchants_out)


def _category_year_subcategory_breakdown(
    session,
    month_labels: list[str],
    category_id: Optional[int],
) -> CategoryYearMerchantsResponse:
    """Per-subcategory monthly totals; rows without subcategory roll into the parent category name."""
    if not month_labels:
        return CategoryYearMerchantsResponse(months=[], merchants=[])

    months_list = ",".join(f"'{m}'" for m in month_labels)
    if category_id is None:
        where_cat = "t.category_id IS NULL"
        params: dict = {}
    else:
        where_cat = "t.category_id = :cid"
        params = {"cid": category_id}

    bucket_expr = """
        CASE
          WHEN t.subcategory_id IS NOT NULL THEN s.name
          WHEN t.category_id IS NULL THEN 'Uncategorized'
          ELSE COALESCE(c.name, 'Uncategorized')
        END
    """

    rows = session.execute(
        text(f"""
            SELECT u.month,
                   {bucket_expr} AS bucket_label,
                   SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            LEFT JOIN subcategory s ON t.subcategory_id = s.id
            LEFT JOIN category c ON t.category_id = c.id
            WHERE  u.month IN ({months_list})
              AND  {where_cat}
            GROUP  BY u.month, {bucket_expr}
        """),
        params,
    ).all()

    if not rows:
        return CategoryYearMerchantsResponse(months=month_labels, merchants=[])

    per_label: dict[str, list[float]] = {}
    lookup: dict[tuple[str, str], float] = {}
    for r in rows:
        lbl = (r.bucket_label or "").strip() or "—"
        lookup[(r.month, lbl)] = float(r.total)
        if lbl not in per_label:
            per_label[lbl] = [0.0] * len(month_labels)

    for lbl in list(per_label.keys()):
        per_label[lbl] = [lookup.get((m, lbl), 0.0) for m in month_labels]

    totals = {lbl: sum(amts) for lbl, amts in per_label.items()}
    sorted_by_total_desc = sorted(totals.keys(), key=lambda k: totals[k], reverse=True)
    top_keys = sorted_by_total_desc[:_TOP_SUBCATEGORY_YEAR_BREAKDOWN]
    tail_keys = sorted_by_total_desc[_TOP_SUBCATEGORY_YEAR_BREAKDOWN:]

    merged: dict[str, list[float]] = {k: per_label[k][:] for k in top_keys}
    if tail_keys:
        other_amt = [0.0] * len(month_labels)
        for tk in tail_keys:
            for i, v in enumerate(per_label[tk]):
                other_amt[i] += v
        merged[_OTHER_SUBCATEGORY_KEY] = other_amt

    keys_for_response = sorted(merged.keys(), key=lambda k: sum(merged[k]))
    series_out = [
        MerchantMonthlySeries(merchant_key=k, amounts=merged[k]) for k in keys_for_response
    ]
    return CategoryYearMerchantsResponse(months=month_labels, merchants=series_out)


# ── GET /api/insights/summary ──────────────────────────────────────────────


@router.get("/summary", response_model=SummaryResponse)
def get_summary(session: SessionDep, month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    total_row = session.execute(
        text("""
            SELECT COALESCE(SUM(t.amount), 0) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month = :month
        """),
        {"month": month},
    ).one()
    total_spend: float = total_row.total

    cat_rows = session.execute(
        text("""
            SELECT t.category_id,
                   COALESCE(c.name, 'Uncategorized') AS category_name,
                   SUM(t.amount) AS amount
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            LEFT JOIN category c ON t.category_id = c.id
            WHERE  u.month = :month
            GROUP  BY t.category_id, category_name
            ORDER  BY amount DESC
        """),
        {"month": month},
    ).all()

    spend_by_category = [
        CategorySpend(
            category_id=r.category_id,
            category_name=r.category_name,
            amount=r.amount,
            pct=round(r.amount * 100.0 / total_spend, 1) if total_spend else 0.0,
        )
        for r in cat_rows
    ]

    card_rows = session.execute(
        text("""
            SELECT t.card_label,
                   SUM(t.amount) AS amount
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month = :month
            GROUP  BY t.card_label
            ORDER  BY amount DESC
        """),
        {"month": month},
    ).all()
    spend_by_card = [CardSpend(card_label=r.card_label, amount=r.amount) for r in card_rows]

    merch_rows = session.execute(
        text("""
            SELECT COALESCE(MAX(g.display_name), MIN(t.description)) AS display_name,
                   SUM(t.amount) AS amount,
                   COUNT(*) AS txn_count
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            LEFT JOIN merchant_spend_group_member m
                   ON lower(trim(t.description)) = m.pattern_key
            LEFT JOIN merchant_spend_group g ON m.group_id = g.id
            WHERE  u.month = :month
            GROUP  BY COALESCE(CAST(g.id AS TEXT), lower(trim(t.description)))
            ORDER  BY amount DESC
            LIMIT  10
        """),
        {"month": month},
    ).all()
    top_merchants = [
        MerchantSpend(
            merchant_key=r.display_name,
            display_name=r.display_name,
            amount=r.amount,
            txn_count=r.txn_count,
        )
        for r in merch_rows
    ]

    return SummaryResponse(
        total_spend=total_spend,
        spend_by_category=spend_by_category,
        spend_by_card=spend_by_card,
        top_merchants=top_merchants,
    )


# ── GET /api/insights/trends ──────────────────────────────────────────────


def _trends_for_month_labels(session, month_labels: list[str]) -> TrendsResponse:
    if not month_labels:
        return TrendsResponse(
            months=[],
            total_spend_series=[],
            category_series={},
            txn_count_series=[],
            category_monthly=[],
        )
    start_m, end_m = month_labels[0], month_labels[-1]
    rows = session.execute(
        text("""
            SELECT u.month,
                   COALESCE(SUM(t.amount), 0) AS total,
                   COUNT(*) AS txn_count
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month >= :start_m AND u.month <= :end_m
            GROUP  BY u.month
        """),
        {"start_m": start_m, "end_m": end_m},
    ).all()
    lookup = {r.month: (float(r.total), int(r.txn_count)) for r in rows}
    total_spend_series = [lookup.get(m, (0.0, 0))[0] for m in month_labels]
    txn_count_series = [lookup.get(m, (0.0, 0))[1] for m in month_labels]
    category_series = _category_series_for_months(session, month_labels)
    category_monthly = _category_monthly_full(session, month_labels)
    return TrendsResponse(
        months=month_labels,
        total_spend_series=total_spend_series,
        category_series=category_series,
        txn_count_series=txn_count_series,
        category_monthly=category_monthly,
    )


@router.get("/trends", response_model=TrendsResponse)
def get_trends(
    session: SessionDep,
    months: int = Query(12, ge=1, le=60),
    year: Optional[int] = Query(None, ge=1990, le=2100),
    trailing_calendar_months: Optional[int] = Query(
        None,
        ge=1,
        le=24,
        description="Trailing N calendar months ending at MAX(upload.month); ignores year and months",
    ),
):
    if trailing_calendar_months is not None:
        max_row = session.execute(text("SELECT MAX(month) AS m FROM upload")).first()
        if not max_row or max_row.m is None:
            return TrendsResponse(
                months=[],
                total_spend_series=[],
                category_series={},
                txn_count_series=[],
                category_monthly=[],
            )
        month_labels = trailing_calendar_months_ending_at(max_row.m, trailing_calendar_months)
        return _trends_for_month_labels(session, month_labels)

    if year is not None:
        month_labels = _calendar_year_month_labels_with_data_span(session, year)
        return _trends_for_month_labels(session, month_labels)

    monthly_rows = session.execute(
        text("""
            SELECT u.month,
                   SUM(t.amount) AS total,
                   COUNT(*) AS txn_count
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            GROUP  BY u.month
            ORDER  BY u.month DESC
            LIMIT  :months
        """),
        {"months": months},
    ).all()

    month_labels = [r.month for r in reversed(monthly_rows)]
    total_spend_series = [float(r.total) for r in reversed(monthly_rows)]
    txn_count_series = [int(r.txn_count) for r in reversed(monthly_rows)]

    if not month_labels:
        return TrendsResponse(
            months=[],
            total_spend_series=[],
            category_series={},
            txn_count_series=[],
            category_monthly=[],
        )

    category_series = _category_series_for_months(session, month_labels)
    return TrendsResponse(
        months=month_labels,
        total_spend_series=total_spend_series,
        category_series=category_series,
        txn_count_series=txn_count_series,
        category_monthly=[],
    )


# ── GET /api/insights/category-year-merchants ─────────────────────────────


@router.get("/category-year-merchants", response_model=CategoryYearMerchantsResponse)
def get_category_year_merchants(
    session: SessionDep,
    year: Optional[int] = Query(None, ge=1990, le=2100),
    trailing_calendar_months: Optional[int] = Query(
        None,
        ge=1,
        le=24,
        description="Trailing N calendar months ending at MAX(upload.month); use instead of year",
    ),
    category_id: Optional[int] = Query(
        None,
        description="Category id; omit for uncategorized (category_id IS NULL)",
    ),
):
    if trailing_calendar_months is not None:
        max_row = session.execute(text("SELECT MAX(month) AS m FROM upload")).first()
        if not max_row or max_row.m is None:
            return CategoryYearMerchantsResponse(months=[], merchants=[])
        month_labels = trailing_calendar_months_ending_at(max_row.m, trailing_calendar_months)
        return _category_year_merchant_breakdown(session, month_labels, category_id)
    if year is None:
        raise HTTPException(
            status_code=422,
            detail="Provide either year or trailing_calendar_months",
        )
    month_labels = _calendar_year_month_labels_with_data_span(session, year)
    if not month_labels:
        return CategoryYearMerchantsResponse(months=[], merchants=[])
    return _category_year_merchant_breakdown(session, month_labels, category_id)


@router.get("/category-year-subcategories", response_model=CategoryYearMerchantsResponse)
def get_category_year_subcategories(
    session: SessionDep,
    year: Optional[int] = Query(None, ge=1990, le=2100),
    trailing_calendar_months: Optional[int] = Query(
        None,
        ge=1,
        le=24,
        description="Trailing N calendar months ending at MAX(upload.month); use instead of year",
    ),
    category_id: Optional[int] = Query(
        None,
        description="Category id; omit for uncategorized (category_id IS NULL)",
    ),
):
    if trailing_calendar_months is not None:
        max_row = session.execute(text("SELECT MAX(month) AS m FROM upload")).first()
        if not max_row or max_row.m is None:
            return CategoryYearMerchantsResponse(months=[], merchants=[])
        month_labels = trailing_calendar_months_ending_at(max_row.m, trailing_calendar_months)
        return _category_year_subcategory_breakdown(session, month_labels, category_id)
    if year is None:
        raise HTTPException(
            status_code=422,
            detail="Provide either year or trailing_calendar_months",
        )
    month_labels = _calendar_year_month_labels_with_data_span(session, year)
    if not month_labels:
        return CategoryYearMerchantsResponse(months=[], merchants=[])
    return _category_year_subcategory_breakdown(session, month_labels, category_id)


@router.get("/month-category-subcategories", response_model=MonthCategorySubcategoriesResponse)
def get_month_category_subcategories(
    session: SessionDep,
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    category_id: Optional[int] = Query(
        None,
        description="Category id; omit for uncategorized bucket",
    ),
):
    if category_id is None:
        where_cat = "t.category_id IS NULL"
        params: dict = {"month": month}
    else:
        where_cat = "t.category_id = :cid"
        params = {"month": month, "cid": category_id}

    bucket_expr = """
        CASE
          WHEN t.subcategory_id IS NOT NULL THEN s.name
          WHEN t.category_id IS NULL THEN 'Uncategorized'
          ELSE COALESCE(c.name, 'Uncategorized')
        END
    """
    rows = session.execute(
        text(f"""
            SELECT {bucket_expr} AS label,
                   SUM(t.amount) AS amount
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            LEFT JOIN subcategory s ON t.subcategory_id = s.id
            LEFT JOIN category c ON t.category_id = c.id
            WHERE  u.month = :month
              AND  {where_cat}
            GROUP  BY {bucket_expr}
            ORDER  BY amount DESC
        """),
        params,
    ).all()
    items = [
        SubcategoryMonthSlice(label=(r.label or "").strip() or "—", amount=float(r.amount))
        for r in rows
    ]
    return MonthCategorySubcategoriesResponse(items=items)


def _month_labels_for_merchant_series(
    session,
    year: Optional[int],
    trailing_calendar_months: Optional[int],
) -> list[str]:
    if trailing_calendar_months is not None:
        max_row = session.execute(text("SELECT MAX(month) AS m FROM upload")).first()
        if not max_row or max_row.m is None:
            return []
        return trailing_calendar_months_ending_at(
            max_row.m, trailing_calendar_months
        )
    if year is None:
        return []
    return _calendar_year_month_labels_with_data_span(session, year)


@router.get("/merchant-group-series", response_model=MerchantGroupSeriesResponse)
def get_merchant_group_series(
    session: SessionDep,
    group_id: int = Query(..., ge=1),
    year: Optional[int] = Query(None, ge=1990, le=2100),
    trailing_calendar_months: Optional[int] = Query(
        None,
        ge=1,
        le=24,
        description="Trailing N calendar months ending at MAX(upload.month)",
    ),
):
    if not session.get(MerchantSpendGroup, group_id):
        raise HTTPException(404, detail="Group not found")
    if trailing_calendar_months is None and year is None:
        raise HTTPException(
            422,
            detail="Provide either year or trailing_calendar_months",
        )
    month_labels = _month_labels_for_merchant_series(
        session, year, trailing_calendar_months
    )
    if not month_labels:
        return MerchantGroupSeriesResponse(months=[], amounts=[])
    months_in = ",".join(f"'{m}'" for m in month_labels)
    rows = session.execute(
        text(f"""
            SELECT u.month, SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            JOIN   merchant_spend_group_member m
                   ON lower(trim(t.description)) = m.pattern_key
            WHERE  m.group_id = :gid
              AND  u.month IN ({months_in})
            GROUP  BY u.month
        """),
        {"gid": group_id},
    ).all()
    lookup = {r.month: float(r.total) for r in rows}
    amounts = [lookup.get(m, 0.0) for m in month_labels]
    return MerchantGroupSeriesResponse(months=month_labels, amounts=amounts)


# ── GET /api/insights/anomalies ───────────────────────────────────────────

_ANOMALY_MULTIPLIER = 1.35
_ANOMALY_MIN_DELTA = 200


@router.get("/anomalies", response_model=List[AnomalyItem])
def get_anomalies(session: SessionDep, month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    prior = _prior_months(month, 3)

    cat_current = {
        r.category_name: r.amount
        for r in session.execute(
            text("""
                SELECT COALESCE(c.name, 'Uncategorized') AS category_name,
                       SUM(t.amount) AS amount
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                LEFT JOIN category c ON t.category_id = c.id
                WHERE  u.month = :month
                GROUP  BY category_name
            """),
            {"month": month},
        ).all()
    }

    cat_baseline: dict[str, float] = {}
    if prior:
        for r in session.execute(
            text("""
                SELECT category_name, AVG(monthly_total) AS avg_amount
                FROM (
                    SELECT COALESCE(c.name, 'Uncategorized') AS category_name,
                           u.month,
                           SUM(t.amount) AS monthly_total
                    FROM   "transaction" t
                    JOIN   upload u ON t.upload_id = u.id
                    LEFT JOIN category c ON t.category_id = c.id
                    WHERE  u.month IN ({prior_list})
                    GROUP  BY category_name, u.month
                ) sub
                GROUP BY category_name
            """.format(prior_list=",".join(f"'{m}'" for m in prior))),
        ).all():
            cat_baseline[r.category_name] = r.avg_amount

    merch_current = {
        r.merchant: r.amount
        for r in session.execute(
            text("""
                SELECT t.description AS merchant,
                       SUM(t.amount)  AS amount
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                WHERE  u.month = :month
                GROUP  BY t.description
            """),
            {"month": month},
        ).all()
    }

    merch_baseline: dict[str, float] = {}
    if prior:
        for r in session.execute(
            text("""
                SELECT merchant, AVG(monthly_total) AS avg_amount
                FROM (
                    SELECT t.description AS merchant,
                           u.month,
                           SUM(t.amount) AS monthly_total
                    FROM   "transaction" t
                    JOIN   upload u ON t.upload_id = u.id
                    WHERE  u.month IN ({prior_list})
                    GROUP  BY t.description, u.month
                ) sub
                GROUP BY merchant
            """.format(prior_list=",".join(f"'{m}'" for m in prior))),
        ).all():
            merch_baseline[r.merchant] = r.avg_amount

    anomalies: list[AnomalyItem] = []

    for name, current in cat_current.items():
        baseline = cat_baseline.get(name, 0.0)
        delta = current - baseline
        if baseline > 0 and current > baseline * _ANOMALY_MULTIPLIER and delta > _ANOMALY_MIN_DELTA:
            anomalies.append(AnomalyItem(
                type="category",
                name=name,
                current=round(current, 2),
                baseline=round(baseline, 2),
                delta=round(delta, 2),
                pct=round(delta * 100.0 / baseline, 1),
            ))

    for name, current in merch_current.items():
        baseline = merch_baseline.get(name, 0.0)
        delta = current - baseline
        if baseline > 0 and current > baseline * _ANOMALY_MULTIPLIER and delta > _ANOMALY_MIN_DELTA:
            anomalies.append(AnomalyItem(
                type="merchant",
                name=name,
                current=round(current, 2),
                baseline=round(baseline, 2),
                delta=round(delta, 2),
                pct=round(delta * 100.0 / baseline, 1),
            ))

    anomalies.sort(key=lambda a: a.delta, reverse=True)
    return anomalies


# ── GET /api/insights/recurring-spend ──────────────────────────────────────

@router.get("/recurring-spend", response_model=RecurringSpendResponse)
def get_recurring_spend(
    session: SessionDep,
    trailing_months: int = Query(6, ge=3, le=24),
):
    max_row = session.execute(text("SELECT MAX(month) AS m FROM upload")).first()
    if not max_row or max_row.m is None:
        return RecurringSpendResponse(
            items=[], total_monthly_recurring=0, total_annual_estimate=0, window_months=trailing_months,
        )
    month_labels = trailing_calendar_months_ending_at(max_row.m, trailing_months)
    months_in = ",".join(f"'{m}'" for m in month_labels)

    rows = session.execute(
        text(f"""
            SELECT merchant_key,
                   display_name,
                   months_present,
                   avg_amount,
                   total_amount,
                   first_seen,
                   last_seen,
                   category_name,
                   category_id
            FROM (
                SELECT COALESCE(g.display_name, lower(trim(t.description))) AS merchant_key,
                       COALESCE(MAX(g.display_name), MIN(t.description))    AS display_name,
                       COUNT(DISTINCT u.month)                              AS months_present,
                       CAST(SUM(t.amount) AS REAL) / COUNT(DISTINCT u.month) AS avg_amount,
                       SUM(t.amount)                                        AS total_amount,
                       MIN(u.month)                                         AS first_seen,
                       MAX(u.month)                                         AS last_seen,
                       MAX(c.name)                                          AS category_name,
                       MAX(t.category_id)                                   AS category_id
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                LEFT JOIN merchant_spend_group_member m
                       ON lower(trim(t.description)) = m.pattern_key
                LEFT JOIN merchant_spend_group g ON m.group_id = g.id
                LEFT JOIN category c ON t.category_id = c.id
                WHERE  u.month IN ({months_in})
                GROUP  BY merchant_key
                HAVING months_present >= 3
            ) recurring
            ORDER BY avg_amount DESC
        """),
    ).all()

    items: list[RecurringSpendItem] = []
    total_monthly = 0.0
    last_month = month_labels[-1] if month_labels else ""
    first_possible = month_labels[2] if len(month_labels) > 2 else month_labels[0] if month_labels else ""

    for r in rows:
        avg = round(r.avg_amount, 2)
        total_monthly += avg
        if r.first_seen >= first_possible:
            trend = "new"
        elif r.months_present >= trailing_months - 1:
            trend = "stable"
        else:
            trend = "stable"

        items.append(RecurringSpendItem(
            merchant_key=r.merchant_key,
            display_name=r.display_name,
            avg_amount=avg,
            months_present=r.months_present,
            total_months_in_window=trailing_months,
            total_amount=round(r.total_amount, 2),
            first_seen=r.first_seen,
            last_seen=r.last_seen,
            trend=trend,
            category_name=r.category_name,
            category_id=r.category_id,
        ))

    return RecurringSpendResponse(
        items=items,
        total_monthly_recurring=round(total_monthly, 2),
        total_annual_estimate=round(total_monthly * 12, 2),
        window_months=trailing_months,
    )


# ── GET /api/insights/data-quality ─────────────────────────────────────────

@router.get("/data-quality", response_model=DataQualityResponse)
def get_data_quality(
    session: SessionDep,
    month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
):
    where_month = ""
    params: dict = {}
    if month:
        where_month = "AND u.month = :month"
        params = {"month": month}

    counts = session.execute(
        text(f"""
            SELECT COUNT(*)                                                 AS total,
                   SUM(CASE WHEN t.category_id IS NOT NULL THEN 1 ELSE 0 END) AS categorized,
                   SUM(CASE WHEN t.category_id IS NULL THEN 1 ELSE 0 END)     AS uncategorized,
                   SUM(CASE WHEN t.confidence >= 0.8 THEN 1 ELSE 0 END)       AS high_conf,
                   SUM(CASE WHEN t.confidence >= 0.3 AND t.confidence < 0.8 THEN 1 ELSE 0 END) AS med_conf,
                   SUM(CASE WHEN t.confidence < 0.3 THEN 1 ELSE 0 END)        AS low_conf,
                   SUM(CASE WHEN t.needs_review = 1 THEN 1 ELSE 0 END)        AS needs_review
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  1=1 {where_month}
        """),
        params,
    ).one()

    total = int(counts.total or 0)
    categorized = int(counts.categorized or 0)
    uncategorized = int(counts.uncategorized or 0)

    top_uncat = session.execute(
        text(f"""
            SELECT t.description,
                   SUM(t.amount)  AS total_amount,
                   COUNT(*)       AS occurrence_count
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  t.category_id IS NULL {where_month}
            GROUP  BY t.description
            ORDER  BY total_amount DESC
            LIMIT  10
        """),
        params,
    ).all()

    return DataQualityResponse(
        total_transactions=total,
        categorized_count=categorized,
        uncategorized_count=uncategorized,
        coverage_pct=round(categorized * 100.0 / total, 1) if total > 0 else 0.0,
        high_confidence_count=int(counts.high_conf or 0),
        medium_confidence_count=int(counts.med_conf or 0),
        low_confidence_count=int(counts.low_conf or 0),
        needs_review_count=int(counts.needs_review or 0),
        top_uncategorized_merchants=[
            TopUncategorizedMerchant(
                description=r.description,
                total_amount=round(r.total_amount, 2),
                occurrence_count=r.occurrence_count,
            )
            for r in top_uncat
        ],
    )


# ── GET /api/insights/card-trends ──────────────────────────────────────────

@router.get("/card-trends", response_model=List[CardTrendResponse])
def get_card_trends(
    session: SessionDep,
    trailing_months: int = Query(12, ge=1, le=24),
):
    max_row = session.execute(text("SELECT MAX(month) AS m FROM upload")).first()
    if not max_row or max_row.m is None:
        return []
    month_labels = trailing_calendar_months_ending_at(max_row.m, trailing_months)
    months_in = ",".join(f"'{m}'" for m in month_labels)

    cards = session.execute(
        text(f"""
            SELECT t.card_label,
                   SUM(t.amount)  AS total_amount,
                   COUNT(*)       AS txn_count
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month IN ({months_in})
            GROUP  BY t.card_label
            ORDER  BY total_amount DESC
        """),
    ).all()

    result: list[CardTrendResponse] = []
    for card in cards:
        monthly = session.execute(
            text(f"""
                SELECT u.month, SUM(t.amount) AS amount
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                WHERE  u.month IN ({months_in})
                  AND  t.card_label {'IS NULL' if card.card_label is None else '= :cl'}
                GROUP  BY u.month
                ORDER  BY u.month
            """),
            {"cl": card.card_label} if card.card_label is not None else {},
        ).all()
        lookup = {r.month: float(r.amount) for r in monthly}
        trend = [CardTrendPoint(month=m, amount=lookup.get(m, 0.0)) for m in month_labels]

        cat_rows = session.execute(
            text(f"""
                SELECT COALESCE(c.name, 'Uncategorized') AS category_name,
                       t.category_id,
                       SUM(t.amount) AS amount
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                LEFT JOIN category c ON t.category_id = c.id
                WHERE  u.month IN ({months_in})
                  AND  t.card_label {'IS NULL' if card.card_label is None else '= :cl'}
                GROUP  BY category_name, t.category_id
                ORDER  BY amount DESC
                LIMIT  8
            """),
            {"cl": card.card_label} if card.card_label is not None else {},
        ).all()
        total_for_pct = float(card.total_amount) if card.total_amount else 1.0
        top_cats = [
            CategorySpend(
                category_id=r.category_id,
                category_name=r.category_name,
                amount=round(float(r.amount), 2),
                pct=round(float(r.amount) * 100.0 / total_for_pct, 1),
            )
            for r in cat_rows
        ]

        result.append(CardTrendResponse(
            card_label=card.card_label or "(unknown)",
            total_amount=round(float(card.total_amount), 2),
            transaction_count=int(card.txn_count),
            monthly_trend=trend,
            top_categories=top_cats,
        ))

    return result
