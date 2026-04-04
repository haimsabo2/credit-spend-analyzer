from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import select

from ..dependencies import SessionDep
from ..models import Upload
from ..schemas import EnrichConflictSide, UploadCreateResponse, UploadRead
from ..services.uploads import handle_upload
from ..upload_storage import resolve_upload_file_path

router = APIRouter()


@router.post("", response_model=UploadCreateResponse)
def post_upload(
    session: SessionDep,
    file: UploadFile = File(...),
    month: str = Form(..., description="Statement month YYYY-MM"),
    replace_month: bool = Form(
        False,
        description="If true, delete all existing data for this month before importing",
    ),
    defer_categorization: bool = Form(
        False,
        description="If true, only ingest rows; run categorization separately (e.g. after parallel uploads)",
    ),
    enrich_only: bool = Form(
        False,
        description="If true, only update source-trace fields on existing transactions for this month; no new rows",
    ),
):
    """Upload an .xls credit card report and associate it with a statement month.

    The month always comes from the form field (YYYY-MM). File names are not parsed for month
    (e.g. Export_11_2025 may reflect billing cycle, not spend month).

    By default, new transactions are categorized automatically. Use defer_categorization=true to ingest
    only, then POST /api/transactions/auto-categorize or auto-categorize-chunk for that month.

    Use enrich_only=true to attach XLS row provenance without inserting transactions or changing categories.
    Cannot combine enrich_only with replace_month.
    """
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

    if enrich_only and replace_month:
        raise HTTPException(
            422,
            detail="enrich_only and replace_month cannot both be true",
        )

    try:
        result = handle_upload(
            session,
            file,
            month,
            replace_month=replace_month,
            defer_categorization=defer_categorization,
            enrich_only=enrich_only,
        )
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc

    conflict_db: EnrichConflictSide | None = None
    conflict_file: EnrichConflictSide | None = None
    if result.enrich_only:
        conflict_db = EnrichConflictSide(
            count=result.only_in_database_count,
            sample=result.only_in_database_sample,
        )
        conflict_file = EnrichConflictSide(
            count=result.only_in_file_count,
            sample=result.only_in_file_sample,
        )

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
        categorization=result.categorization,
        categorization_deferred=defer_categorization and not result.enrich_only,
        enrich_only=result.enrich_only,
        enriched_count=result.enriched_count,
        conflict_only_in_database=conflict_db,
        conflict_only_in_file=conflict_file,
    )


@router.get("/{upload_id}/file")
def download_upload_file(upload_id: int, session: SessionDep):
    """Download the persisted original XLS for this upload, if available."""
    u = session.get(Upload, upload_id)
    if not u or not u.stored_path:
        raise HTTPException(404, detail="Upload file not found")
    path = resolve_upload_file_path(u.stored_path)
    if path is None or not path.is_file():
        raise HTTPException(404, detail="Upload file missing on disk")
    media = u.content_type or "application/vnd.ms-excel"
    return FileResponse(
        path,
        filename=u.original_filename,
        media_type=media,
    )


@router.get("", response_model=list[UploadRead])
def get_uploads(session: SessionDep, month: str | None = None):
    """List uploads, optionally filtered by month (YYYY-MM)."""
    stmt = select(Upload).order_by(Upload.created_at.desc())
    if month:
        stmt = stmt.where(Upload.month == month)
    uploads = session.exec(stmt).all()
    return [UploadRead.model_validate(x) for x in uploads]
