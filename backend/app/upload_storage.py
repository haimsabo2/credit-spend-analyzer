"""Persist uploaded XLS bytes on disk; path is relative name under the storage directory."""

from __future__ import annotations

from pathlib import Path

from .config import get_settings


def upload_storage_base_dir() -> Path:
    """Absolute directory where upload files are stored."""
    settings = get_settings()
    raw = (settings.upload_storage_dir or "").strip()
    if raw:
        p = Path(raw).expanduser()
        if not p.is_absolute():
            backend_root = Path(__file__).resolve().parents[1]
            p = (backend_root / p).resolve()
        return p
    backend_root = Path(__file__).resolve().parents[1]
    return (backend_root / "data" / "upload_files").resolve()


def stored_filename_for_upload_id(upload_id: int) -> str:
    return f"{upload_id}.xls"


def write_upload_file(upload_id: int, content: bytes) -> str:
    """Write bytes to disk; return stored_path value to save on Upload (filename only)."""
    base = upload_storage_base_dir()
    base.mkdir(parents=True, exist_ok=True)
    name = stored_filename_for_upload_id(upload_id)
    path = base / name
    path.write_bytes(content)
    return name


def resolve_upload_file_path(stored_path: str | None) -> Path | None:
    """Resolve Upload.stored_path to an absolute Path, or None if missing/invalid."""
    if not stored_path or not stored_path.strip():
        return None
    base = upload_storage_base_dir()
    p = Path(stored_path.strip())
    if p.is_absolute():
        return p if p.exists() else None
    candidate = (base / p).resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        return None
    return candidate if candidate.exists() else None
