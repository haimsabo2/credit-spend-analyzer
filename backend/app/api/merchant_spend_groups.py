from __future__ import annotations

import fnmatch
from typing import List

from fastapi import APIRouter, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from ..dependencies import SessionDep
from ..models import Category, MerchantKeyUserApproval, MerchantSpendGroup, MerchantSpendGroupMember, Subcategory, Transaction
from ..services.merchant_subcategory import ensure_merchant_key_user_approval
from ..services.spend_group_category_link import (
    apply_linked_group_to_member,
    link_spend_group_to_category,
    unlink_spend_group_from_category,
)
from ..schemas import (
    MerchantSpendGroupCreate,
    MerchantSpendGroupLinkCategory,
    MerchantSpendGroupLinkCategoryResponse,
    MerchantSpendGroupMemberAddResult,
    MerchantSpendGroupMemberCreate,
    MerchantSpendGroupMemberRead,
    MerchantSpendGroupRead,
    MerchantSpendGroupSyncApprovalsResponse,
    MerchantSpendGroupUpdate,
)

router = APIRouter()


def _to_group_read(session: Session, group: MerchantSpendGroup) -> MerchantSpendGroupRead:
    category_name: str | None = None
    subcategory_name: str | None = None
    if group.category_id is not None:
        cat = session.get(Category, group.category_id)
        category_name = cat.name if cat else None
    if group.subcategory_id is not None:
        sub = session.get(Subcategory, group.subcategory_id)
        subcategory_name = sub.name if sub else None
    return MerchantSpendGroupRead(
        id=group.id,  # type: ignore[arg-type]
        display_name=group.display_name,
        created_at=group.created_at,
        category_id=group.category_id,
        category_name=category_name,
        link_mode=group.link_mode,
        subcategory_id=group.subcategory_id,
        subcategory_name=subcategory_name,
    )


def _normalize_pattern_key(raw: str) -> str:
    return (raw or "").strip().lower()


def _pattern_spec_to_fnmatch_wildcard_only(raw: str) -> str:
    """User supplied * or ? ; return fnmatch pattern (lowercased) or raise if only wildcards."""
    low = (raw or "").strip().lower()
    literal = low.replace("*", "").replace("?", "").strip()
    if not literal:
        raise HTTPException(
            422,
            detail="Wildcard pattern must include at least one non-wildcard character",
        )
    return low


def _resolve_fnmatch_pattern(
    session: Session, raw: str, low_normalized: str
) -> str | None:
    """Return fnmatch pattern for bulk add, or None to use a single exact key (low_normalized)."""
    raw_stripped = (raw or "").strip()
    if any(ch in raw_stripped for ch in "*?"):
        return _pattern_spec_to_fnmatch_wildcard_only(raw_stripped)

    keys = set(_all_distinct_pattern_keys(session))
    if low_normalized in keys:
        return None

    parts = [p for p in low_normalized.split() if p]
    if len(parts) >= 2:
        return "*" + "*".join(parts) + "*"
    return None


def _all_distinct_pattern_keys(session: Session) -> list[str]:
    stmt = (
        select(func.lower(func.trim(Transaction.description)))
        .where(Transaction.description.isnot(None))  # noqa: E711
        .distinct()
    )
    rows = session.exec(stmt).all()
    out: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if row is None:
            continue
        k = str(row).strip()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out


def _keys_matching_fnmatch(all_keys: list[str], fn_pattern: str) -> list[str]:
    return sorted(k for k in all_keys if fnmatch.fnmatch(k, fn_pattern))


@router.get("", response_model=List[MerchantSpendGroupRead])
def list_merchant_spend_groups(session: SessionDep):
    stmt = select(MerchantSpendGroup).order_by(MerchantSpendGroup.display_name)
    groups = list(session.exec(stmt).all())
    return [_to_group_read(session, g) for g in groups]


@router.post("", response_model=MerchantSpendGroupRead, status_code=201)
def create_merchant_spend_group(body: MerchantSpendGroupCreate, session: SessionDep):
    name = body.display_name.strip()
    if not name:
        raise HTTPException(422, detail="display_name must be non-empty")
    g = MerchantSpendGroup(display_name=name)
    session.add(g)
    session.commit()
    session.refresh(g)
    return _to_group_read(session, g)


@router.post(
    "/sync-approvals",
    response_model=MerchantSpendGroupSyncApprovalsResponse,
)
def sync_spend_group_member_approvals(session: SessionDep):
    """Create merchant_key_user_approval rows for every distinct spend-group member pattern (idempotent)."""
    stmt = select(MerchantSpendGroupMember.pattern_key).distinct()
    keys = [k for k in session.exec(stmt).all() if k]
    new_count = 0
    for pk in keys:
        had = session.exec(
            select(MerchantKeyUserApproval).where(MerchantKeyUserApproval.pattern_key == pk)
        ).first()
        if not had:
            new_count += 1
        ensure_merchant_key_user_approval(session, pk)
    session.commit()
    return MerchantSpendGroupSyncApprovalsResponse(
        pattern_keys_processed=len(keys),
        new_approvals_created=new_count,
    )


@router.patch("/{group_id}", response_model=MerchantSpendGroupRead)
def update_merchant_spend_group(
    group_id: int,
    body: MerchantSpendGroupUpdate,
    session: SessionDep,
):
    g = session.get(MerchantSpendGroup, group_id)
    if not g:
        raise HTTPException(404, detail="Group not found")
    name = body.display_name.strip()
    if not name:
        raise HTTPException(422, detail="display_name must be non-empty")
    g.display_name = name
    session.add(g)
    session.commit()
    session.refresh(g)
    return _to_group_read(session, g)


@router.delete("/{group_id}", status_code=204)
def delete_merchant_spend_group(group_id: int, session: SessionDep):
    g = session.get(MerchantSpendGroup, group_id)
    if not g:
        raise HTTPException(404, detail="Group not found")
    session.delete(g)
    session.commit()
    return None


@router.post(
    "/{group_id}/link-category",
    response_model=MerchantSpendGroupLinkCategoryResponse,
)
def link_merchant_spend_group_category(
    group_id: int,
    body: MerchantSpendGroupLinkCategory,
    session: SessionDep,
):
    g = session.get(MerchantSpendGroup, group_id)
    if not g:
        raise HTTPException(404, detail="Group not found")
    if not session.get(Category, body.category_id):
        raise HTTPException(404, detail="Category not found")
    try:
        result = link_spend_group_to_category(
            session, g, body.category_id, body.link_mode  # type: ignore[arg-type]
        )
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    session.commit()
    session.refresh(g)
    cat = session.get(Category, result.category_id)
    sub_name: str | None = None
    if result.subcategory_id is not None:
        sub = session.get(Subcategory, result.subcategory_id)
        sub_name = sub.name if sub else None
    return MerchantSpendGroupLinkCategoryResponse(
        category_id=result.category_id,
        category_name=cat.name if cat else "",
        link_mode=result.link_mode,
        subcategory_id=result.subcategory_id,
        subcategory_name=sub_name,
        members_processed=result.members_processed,
        rules_created=result.rules_created,
        transactions_updated=result.transactions_updated,
    )


@router.post("/{group_id}/unlink-category", response_model=MerchantSpendGroupRead)
def unlink_merchant_spend_group_category(group_id: int, session: SessionDep):
    g = session.get(MerchantSpendGroup, group_id)
    if not g:
        raise HTTPException(404, detail="Group not found")
    if g.category_id is None:
        raise HTTPException(400, detail="Group is not linked to a category")
    unlink_spend_group_from_category(session, g)
    session.commit()
    session.refresh(g)
    return _to_group_read(session, g)


@router.get("/{group_id}/members", response_model=List[MerchantSpendGroupMemberRead])
def list_group_members(group_id: int, session: SessionDep):
    if not session.get(MerchantSpendGroup, group_id):
        raise HTTPException(404, detail="Group not found")
    stmt = (
        select(MerchantSpendGroupMember)
        .where(MerchantSpendGroupMember.group_id == group_id)
        .order_by(MerchantSpendGroupMember.pattern_key)
    )
    return list(session.exec(stmt).all())


@router.post(
    "/{group_id}/members",
    response_model=MerchantSpendGroupMemberAddResult,
    status_code=201,
)
def add_group_member(
    group_id: int,
    body: MerchantSpendGroupMemberCreate,
    session: SessionDep,
):
    g = session.get(MerchantSpendGroup, group_id)
    if not g:
        raise HTTPException(404, detail="Group not found")
    raw = (body.pattern_key or "").strip()
    if not raw:
        raise HTTPException(422, detail="pattern_key must be non-empty")

    low = _normalize_pattern_key(raw)
    fn_pat = _resolve_fnmatch_pattern(session, raw, low)

    if fn_pat is None:
        pk = low
        existing = session.exec(
            select(MerchantSpendGroupMember).where(
                MerchantSpendGroupMember.pattern_key == pk
            )
        ).first()
        if existing:
            if existing.group_id != group_id:
                raise HTTPException(
                    409,
                    detail="This merchant line is already in another group",
                )
            raise HTTPException(400, detail="Already in this group")
        m = MerchantSpendGroupMember(group_id=group_id, pattern_key=pk)
        session.add(m)
        session.flush()
        ensure_merchant_key_user_approval(session, pk)
        apply_linked_group_to_member(session, g, pk)
        session.commit()
        session.refresh(m)
        return MerchantSpendGroupMemberAddResult(
            bulk=False,
            added=[MerchantSpendGroupMemberRead.model_validate(m)],
        )

    all_keys = _all_distinct_pattern_keys(session)
    matched = _keys_matching_fnmatch(all_keys, fn_pat)
    if not matched:
        return MerchantSpendGroupMemberAddResult(
            bulk=True,
            added=[],
            unmatched=True,
        )

    added_rows: list[MerchantSpendGroupMember] = []
    skipped_self: list[str] = []
    blocked: list[str] = []

    for pk in matched:
        existing = session.exec(
            select(MerchantSpendGroupMember).where(
                MerchantSpendGroupMember.pattern_key == pk
            )
        ).first()
        if existing:
            if existing.group_id == group_id:
                skipped_self.append(pk)
            else:
                blocked.append(pk)
            continue
        m = MerchantSpendGroupMember(group_id=group_id, pattern_key=pk)
        session.add(m)
        added_rows.append(m)

    session.flush()
    for m in added_rows:
        ensure_merchant_key_user_approval(session, m.pattern_key)
        apply_linked_group_to_member(session, g, m.pattern_key)
    session.commit()
    for m in added_rows:
        session.refresh(m)

    return MerchantSpendGroupMemberAddResult(
        bulk=True,
        added=[MerchantSpendGroupMemberRead.model_validate(m) for m in added_rows],
        skipped_already_in_this_group=skipped_self,
        blocked_other_group=blocked,
        unmatched=False,
    )


@router.delete("/{group_id}/members/{member_id}", status_code=204)
def remove_group_member(
    group_id: int,
    member_id: int,
    session: SessionDep,
):
    if not session.get(MerchantSpendGroup, group_id):
        raise HTTPException(404, detail="Group not found")
    m = session.get(MerchantSpendGroupMember, member_id)
    if not m or m.group_id != group_id:
        raise HTTPException(404, detail="Member not found")
    session.delete(m)
    session.commit()
    return None
