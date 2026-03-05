from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import Category
from ..schemas import CategoryCreate, CategoryRead

router = APIRouter()


@router.get("", response_model=List[CategoryRead])
def list_categories(session: SessionDep):
    stmt = select(Category).order_by(Category.name)
    return list(session.exec(stmt).all())


@router.post("", response_model=CategoryRead, status_code=201)
def create_category(body: CategoryCreate, session: SessionDep):
    existing = session.exec(select(Category).where(Category.name == body.name)).first()
    if existing:
        raise HTTPException(400, detail=f"Category '{body.name}' already exists")
    cat = Category(name=body.name, description=body.description, is_system=False)
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat
