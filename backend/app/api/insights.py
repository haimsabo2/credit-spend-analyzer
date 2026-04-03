from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from ..dependencies import SessionDep
from ..schemas import (
    AnomalyItem,
    CardSpend,
    CategoryMonthlyRow,
    CategorySpend,
    CategoryYearMerchantsResponse,
    MerchantMonthlySeries,
    MerchantSpend,
    SummaryResponse,
    TrendsResponse,
)
from ..utils import prior_months as _prior_months
from ..utils import trailing_calendar_months_ending_at

router = APIRouter()

_TOP_MERCHANTS_YEAR_BREAKDOWN = 14
_OTHER_MERCHANT_KEY = "Other"


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
                   t.description AS merchant_key,
                   SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month IN ({months_list})
              AND  {where_cat}
            GROUP  BY u.month, t.description
        """),
        params,
    ).all()

    if not rows:
        return CategoryYearMerchantsResponse(months=month_labels, merchants=[])

    per_merchant: dict[str, list[float]] = {}
    lookup: dict[tuple[str, str], float] = {}
    for r in rows:
        mk = (r.merchant_key or "").strip() or "(no description)"
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
            SELECT t.description AS merchant_key,
                   t.description AS display_name,
                   SUM(t.amount)  AS amount,
                   COUNT(*)       AS txn_count
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month = :month
            GROUP  BY t.description
            ORDER  BY amount DESC
            LIMIT  10
        """),
        {"month": month},
    ).all()
    top_merchants = [
        MerchantSpend(
            merchant_key=r.merchant_key,
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
        month_labels = [f"{year}-{m:02d}" for m in range(1, 13)]
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
    month_labels = [f"{year}-{m:02d}" for m in range(1, 13)]
    return _category_year_merchant_breakdown(session, month_labels, category_id)


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
