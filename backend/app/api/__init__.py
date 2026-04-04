from __future__ import annotations

from fastapi import APIRouter

from . import admin, budgets, categories, forecast, insights, merchant_spend_groups, rules, uploads, transactions

api_router = APIRouter()

api_router.include_router(uploads.router, prefix="/uploads", tags=["uploads"])
api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
api_router.include_router(insights.router, prefix="/insights", tags=["insights"])
api_router.include_router(
    merchant_spend_groups.router,
    prefix="/merchant-spend-groups",
    tags=["merchant-spend-groups"],
)
api_router.include_router(budgets.router, prefix="/budgets", tags=["budgets"])
api_router.include_router(forecast.router, prefix="/forecast", tags=["forecast"])
api_router.include_router(categories.router, prefix="/categories", tags=["categories"])
api_router.include_router(rules.router, prefix="/rules", tags=["rules"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])

