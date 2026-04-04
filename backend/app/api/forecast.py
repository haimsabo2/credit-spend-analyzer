from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import text

from ..dependencies import SessionDep
from ..schemas import (
    CategoryForecast,
    ForecastResponse,
    RecurringMerchant,
)
from ..utils import next_month, prior_months

router = APIRouter()


@router.get("", response_model=ForecastResponse)
def get_forecast(
    session: SessionDep, month: str = Query(..., pattern=r"^\d{4}-\d{2}$")
):
    forecast_mo = next_month(month)
    last_4 = prior_months(forecast_mo, 4)
    last_6 = prior_months(forecast_mo, 6)

    # ── Recurring merchants (present in >= 3 of last 4 months) ────────────

    recurring_rows = session.execute(
        text("""
            SELECT merchant_key, merchant_key AS display_name,
                   COUNT(DISTINCT month) AS months_present,
                   AVG(month_total)      AS avg_amount
            FROM (
                SELECT COALESCE(g.display_name, lower(trim(t.description))) AS merchant_key,
                       u.month,
                       SUM(t.amount) AS month_total
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                LEFT JOIN merchant_spend_group_member m
                       ON lower(trim(t.description)) = m.pattern_key
                LEFT JOIN merchant_spend_group g ON m.group_id = g.id
                WHERE  u.month IN ({months})
                GROUP  BY COALESCE(g.display_name, lower(trim(t.description))), u.month
            ) sub
            GROUP  BY merchant_key
            HAVING months_present >= 3
            ORDER  BY avg_amount DESC
        """.format(months=",".join(f"'{m}'" for m in last_4))),
    ).all()

    recurring_merchants = [
        RecurringMerchant(
            merchant_key=r.merchant_key,
            display_name=r.display_name,
            avg_amount=round(r.avg_amount, 2),
            months_present=r.months_present,
        )
        for r in recurring_rows
    ]

    # ── Category forecasts (avg spend over last 6 months) ─────────────────

    cat_rows = session.execute(
        text("""
            SELECT category_id,
                   COALESCE(category_name, 'Uncategorized') AS category_name,
                   AVG(month_total) AS amount
            FROM (
                SELECT t.category_id,
                       c.name AS category_name,
                       u.month,
                       SUM(t.amount) AS month_total
                FROM   "transaction" t
                JOIN   upload u ON t.upload_id = u.id
                LEFT JOIN category c ON t.category_id = c.id
                WHERE  u.month IN ({months})
                GROUP  BY t.category_id, c.name, u.month
            ) sub
            GROUP  BY category_id, category_name
            ORDER  BY amount DESC
        """.format(months=",".join(f"'{m}'" for m in last_6))),
    ).all()

    category_forecasts = [
        CategoryForecast(
            category_id=r.category_id,
            category_name=r.category_name,
            amount=round(r.amount, 2),
        )
        for r in cat_rows
    ]

    total_forecast = round(sum(cf.amount for cf in category_forecasts), 2)

    return ForecastResponse(
        forecast_month=forecast_mo,
        total_forecast=total_forecast,
        category_forecasts=category_forecasts,
        recurring_merchants=recurring_merchants,
    )
