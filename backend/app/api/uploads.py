from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import Upload
from ..schemas import UploadCreateResponse, UploadRead
from ..services.uploads import handle_upload

router = APIRouter()


@router.post("", response_model=UploadCreateResponse)
def post_upload(
    session: SessionDep,
    file: UploadFile = File(...),
    month: str = Form(..., description="Statement month YYYY-MM"),
):
    """Upload an .xls credit card report and associate it with a statement month."""
    if not month or len(month) != 7 or month[4] != "-":
        raise HTTPException(422, detail="month must be YYYY-MM")
    try:
        y, m = int(month[:4]), int(month[5:7])
        if not (1 <= m <= 12):
            raise ValueError("invalid month")
    except ValueError:
        raise HTTPException(422, detail="month must be YYYY-MM")

    if not file.filename or not file.filename.lower().endswith(".xls"):
        raise HTTPException(422, detail="File must be a .xls file")

    result = handle_upload(session, file, month)
    return UploadCreateResponse(
        upload_id=result.upload.id,
        month=result.upload.month,
        file_name=result.upload.original_filename,
        file_hash=result.upload.file_hash,
        cards_detected=result.cards_detected,
        sections_detected=result.sections_detected,
        inserted_count=result.inserted_count,
        skipped_duplicates_count=result.skipped_duplicates_count,
        skipped_noise_count=result.skipped_noise_count,
    )


@router.get("", response_model=list[UploadRead])
def get_uploads(session: SessionDep, month: str | None = None):
    """List uploads, optionally filtered by month (YYYY-MM)."""
    stmt = select(Upload).order_by(Upload.created_at.desc())
    if month:
        stmt = stmt.where(Upload.month == month)
    uploads = session.exec(stmt).all()
    return [UploadRead.from_orm(u) for u in uploads]
