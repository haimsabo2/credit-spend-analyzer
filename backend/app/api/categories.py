from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import Category, Subcategory
from ..schemas import (
    CategoryCreate,
    CategoryRead,
    SubcategoryCreate,
    SubcategoryRead,
    SubcategoryUpdate,
)

router = APIRouter()


# More specific paths first (under /categories prefix).
@router.patch("/subcategories/{subcategory_id}", response_model=SubcategoryRead)
def update_subcategory(
    subcategory_id: int,
    body: SubcategoryUpdate,
    session: SessionDep,
):
    sub = session.get(Subcategory, subcategory_id)
    if not sub:
        raise HTTPException(404, detail="Subcategory not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(422, detail="name must be non-empty")
    dup = session.exec(
        select(Subcategory).where(
            Subcategory.category_id == sub.category_id,
            Subcategory.name == name,
            Subcategory.id != subcategory_id,
        )
    ).first()
    if dup:
        raise HTTPException(400, detail="A subcategory with this name already exists")
    sub.name = name
    session.add(sub)
    session.commit()
    session.refresh(sub)
    return sub


@router.delete("/subcategories/{subcategory_id}", status_code=204)
def delete_subcategory(subcategory_id: int, session: SessionDep):
    sub = session.get(Subcategory, subcategory_id)
    if not sub:
        raise HTTPException(404, detail="Subcategory not found")
    session.delete(sub)
    session.commit()
    return None


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


@router.get("/{category_id}/subcategories", response_model=List[SubcategoryRead])
def list_subcategories(category_id: int, session: SessionDep):
    if not session.get(Category, category_id):
        raise HTTPException(404, detail="Category not found")
    stmt = (
        select(Subcategory)
        .where(Subcategory.category_id == category_id)
        .order_by(Subcategory.name)
    )
    return list(session.exec(stmt).all())


@router.post("/{category_id}/subcategories", response_model=SubcategoryRead, status_code=201)
def create_subcategory(
    category_id: int,
    body: SubcategoryCreate,
    session: SessionDep,
):
    if not session.get(Category, category_id):
        raise HTTPException(404, detail="Category not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(422, detail="name must be non-empty")
    existing = session.exec(
        select(Subcategory).where(
            Subcategory.category_id == category_id,
            Subcategory.name == name,
        )
    ).first()
    if existing:
        raise HTTPException(400, detail="Subcategory already exists")
    sub = Subcategory(category_id=category_id, name=name)
    session.add(sub)
    session.commit()
    session.refresh(sub)
    return sub
