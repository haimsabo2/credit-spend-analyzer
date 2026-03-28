from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import delete, text, update
from sqlmodel import select

from ..config import get_settings
from ..dependencies import SessionDep
from ..models import Category, Transaction, Upload

router = APIRouter()


@router.delete("/reset")
def reset_all_data(session: SessionDep):
    """Delete all user data (transactions, budgets, rules, uploads, user categories). System categories stay."""
    session.execute(text('DELETE FROM "transaction"'))
    session.execute(text("DELETE FROM budget"))
    session.execute(text("DELETE FROM classificationrule"))
    session.execute(text("DELETE FROM upload"))
    session.execute(delete(Category).where(Category.is_system.is_(False)))
    session.commit()
    return {"status": "ok"}


@router.post("/reset-categorization")
def reset_categorization(
    session: SessionDep,
    month: str = Query(..., description="Statement month YYYY-MM", pattern=r"^\d{4}-\d{2}$"),
):
    """Clear categorization data for every transaction in the given month."""
    upload_ids = select(Upload.id).where(Upload.month == month)
    stmt = (
        update(Transaction)
        .where(Transaction.upload_id.in_(upload_ids))
        .values(
            category_id=None,
            confidence=0,
            needs_review=False,
            reason_he=None,
            rule_id_applied=None,
            meta_json=None,
        )
    )
    result = session.execute(stmt)
    session.commit()
    return {"month": month, "reset_count": result.rowcount}


@router.get("/env-check")
def env_check():
    """Return non-sensitive info about LLM configuration."""
    settings = get_settings()
    has_key = bool(settings.llm_api_key)
    return {
        "has_openai_api_key": has_key,
        "llm_model": settings.llm_model,
        "llm_enabled": has_key,
    }
