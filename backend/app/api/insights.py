from __future__ import annotations

from typing import List

from fastapi import APIRouter, Query
from sqlalchemy import text

from ..dependencies import SessionDep
from ..schemas import (
    AnomalyItem,
    CardSpend,
    CategorySpend,
    MerchantSpend,
    SummaryResponse,
    TrendsResponse,
)
from ..utils import prior_months as _prior_months

router = APIRouter()


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


@router.get("/trends", response_model=TrendsResponse)
def get_trends(session: SessionDep, months: int = Query(12, ge=1, le=60)):
    monthly_rows = session.execute(
        text("""
            SELECT u.month,
                   SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            GROUP  BY u.month
            ORDER  BY u.month DESC
            LIMIT  :months
        """),
        {"months": months},
    ).all()

    month_labels = [r.month for r in reversed(monthly_rows)]
    total_spend_series = [r.total for r in reversed(monthly_rows)]

    if not month_labels:
        return TrendsResponse(months=[], total_spend_series=[], category_series={})

    top_cat_rows = session.execute(
        text("""
            SELECT t.category_id, SUM(t.amount) AS total
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month IN ({months_list})
              AND  t.category_id IS NOT NULL
            GROUP  BY t.category_id
            ORDER  BY total DESC
            LIMIT  8
        """.format(months_list=",".join(f"'{m}'" for m in month_labels))),
    ).all()
    top_cat_ids = [r.category_id for r in top_cat_rows]

    category_series: dict[str, list[float]] = {}
    if top_cat_ids:
        placeholders = ",".join(str(cid) for cid in top_cat_ids)
        cat_monthly = session.execute(
            text("""
                SELECT u.month, t.category_id, SUM(t.amount) AS total
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                WHERE  u.month IN ({months_list})
                  AND  t.category_id IN ({cat_ids})
                GROUP  BY u.month, t.category_id
            """.format(
                months_list=",".join(f"'{m}'" for m in month_labels),
                cat_ids=placeholders,
            )),
        ).all()

        lookup: dict[tuple[str, int], float] = {}
        for r in cat_monthly:
            lookup[(r.month, r.category_id)] = r.total

        for cid in top_cat_ids:
            category_series[str(cid)] = [
                lookup.get((m, cid), 0.0) for m in month_labels
            ]

    return TrendsResponse(
        months=month_labels,
        total_spend_series=total_spend_series,
        category_series=category_series,
    )


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
