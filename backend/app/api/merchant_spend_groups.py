from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import MerchantSpendGroup, MerchantSpendGroupMember
from ..schemas import (
    MerchantSpendGroupCreate,
    MerchantSpendGroupMemberCreate,
    MerchantSpendGroupMemberRead,
    MerchantSpendGroupRead,
    MerchantSpendGroupUpdate,
)

router = APIRouter()


def _normalize_pattern_key(raw: str) -> str:
    return (raw or "").strip().lower()


@router.get("", response_model=List[MerchantSpendGroupRead])
def list_merchant_spend_groups(session: SessionDep):
    stmt = select(MerchantSpendGroup).order_by(MerchantSpendGroup.display_name)
    return list(session.exec(stmt).all())


@router.post("", response_model=MerchantSpendGroupRead, status_code=201)
def create_merchant_spend_group(body: MerchantSpendGroupCreate, session: SessionDep):
    name = body.display_name.strip()
    if not name:
        raise HTTPException(422, detail="display_name must be non-empty")
    g = MerchantSpendGroup(display_name=name)
    session.add(g)
    session.commit()
    session.refresh(g)
    return g


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
    return g


@router.delete("/{group_id}", status_code=204)
def delete_merchant_spend_group(group_id: int, session: SessionDep):
    g = session.get(MerchantSpendGroup, group_id)
    if not g:
        raise HTTPException(404, detail="Group not found")
    session.delete(g)
    session.commit()
    return None


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
    response_model=MerchantSpendGroupMemberRead,
    status_code=201,
)
def add_group_member(
    group_id: int,
    body: MerchantSpendGroupMemberCreate,
    session: SessionDep,
):
    if not session.get(MerchantSpendGroup, group_id):
        raise HTTPException(404, detail="Group not found")
    pk = _normalize_pattern_key(body.pattern_key)
    if not pk:
        raise HTTPException(422, detail="pattern_key must be non-empty")
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
    session.commit()
    session.refresh(m)
    return m


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
