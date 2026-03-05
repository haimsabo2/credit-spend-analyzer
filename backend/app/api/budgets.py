from __future__ import annotations

from typing import List

from fastapi import APIRouter, Query
from sqlalchemy import text
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import Budget, Category
from ..schemas import BudgetAlertItem, BudgetRead, BudgetUpsertRequest

router = APIRouter()


@router.get("", response_model=List[BudgetRead])
def get_budgets(session: SessionDep, month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    stmt = select(Budget).where(Budget.month == month).order_by(Budget.category_id)
    return list(session.exec(stmt).all())


@router.post("", response_model=BudgetRead)
def upsert_budget(body: BudgetUpsertRequest, session: SessionDep):
    existing = session.exec(
        select(Budget).where(
            Budget.category_id == body.category_id,
            Budget.month == body.month,
        )
    ).first()

    if existing:
        existing.budget_amount = body.budget_amount
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    budget = Budget(
        category_id=body.category_id,
        month=body.month,
        budget_amount=body.budget_amount,
    )
    session.add(budget)
    session.commit()
    session.refresh(budget)
    return budget


@router.get("/alerts", response_model=List[BudgetAlertItem])
def get_budget_alerts(
    session: SessionDep, month: str = Query(..., pattern=r"^\d{4}-\d{2}$")
):
    budgets = session.exec(
        select(Budget, Category.name)
        .join(Category, Budget.category_id == Category.id)
        .where(Budget.month == month)
    ).all()

    if not budgets:
        return []

    spend_rows = session.execute(
        text("""
            SELECT t.category_id, SUM(t.amount) AS spent
            FROM   "transaction" t
            JOIN   upload u ON t.upload_id = u.id
            WHERE  u.month = :month
              AND  t.category_id IS NOT NULL
            GROUP  BY t.category_id
        """),
        {"month": month},
    ).all()
    spend_map = {r.category_id: r.spent for r in spend_rows}

    alerts: list[BudgetAlertItem] = []
    for budget, category_name in budgets:
        spent = spend_map.get(budget.category_id, 0.0)
        remaining = budget.budget_amount - spent
        if spent > budget.budget_amount:
            status = "exceeded"
        elif spent > budget.budget_amount * 0.8:
            status = "warn"
        else:
            status = "ok"
        alerts.append(BudgetAlertItem(
            category_id=budget.category_id,
            category_name=category_name,
            budget=budget.budget_amount,
            spent=round(spent, 2),
            remaining=round(remaining, 2),
            status=status,
        ))
    return alerts
