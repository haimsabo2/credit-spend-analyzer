from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import Category, ClassificationRule
from ..schemas import RuleCreateRequest, RuleRead, RuleUpdateRequest

router = APIRouter()


def _to_read(rule: ClassificationRule, category_name: str) -> RuleRead:
    return RuleRead(
        id=rule.id,
        category_id=rule.category_id,
        category_name=category_name,
        pattern=rule.pattern,
        match_type=rule.match_type,
        priority=rule.priority,
        active=rule.active,
        card_label_filter=rule.card_label_filter,
    )


@router.get("", response_model=List[RuleRead])
def list_rules(session: SessionDep, active: Optional[bool] = Query(None)):
    stmt = (
        select(ClassificationRule, Category.name)
        .join(Category, ClassificationRule.category_id == Category.id)
    )
    if active is not None:
        stmt = stmt.where(ClassificationRule.active == active)
    stmt = stmt.order_by(ClassificationRule.priority, ClassificationRule.id)
    rows = session.exec(stmt).all()
    return [_to_read(rule, cat_name) for rule, cat_name in rows]


@router.post("", response_model=RuleRead, status_code=201)
def create_rule(body: RuleCreateRequest, session: SessionDep):
    cat = session.get(Category, body.category_id)
    if not cat:
        raise HTTPException(404, f"Category {body.category_id} not found")
    rule = ClassificationRule(
        category_id=body.category_id,
        pattern=body.pattern,
        match_type=body.match_type,
        priority=body.priority,
        active=body.active,
        card_label_filter=body.card_label_filter,
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _to_read(rule, cat.name)


@router.put("/{rule_id}", response_model=RuleRead)
def update_rule(rule_id: int, body: RuleUpdateRequest, session: SessionDep):
    rule = session.get(ClassificationRule, rule_id)
    if not rule:
        raise HTTPException(404, f"Rule {rule_id} not found")

    update_data = body.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rule, key, value)

    session.add(rule)
    session.commit()
    session.refresh(rule)

    cat = session.get(Category, rule.category_id)
    return _to_read(rule, cat.name)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, session: SessionDep):
    rule = session.get(ClassificationRule, rule_id)
    if not rule:
        raise HTTPException(404, f"Rule {rule_id} not found")
    session.delete(rule)
    session.commit()
