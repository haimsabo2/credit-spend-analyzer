# Credit Spend Analyzer

Local-first app for analyzing monthly credit-card spend from legacy `.xls` reports.

## Monorepo layout

- **backend/** -- FastAPI + SQLModel backend, parsing pipeline, and APIs.
- **frontend/** -- React + Vite + TypeScript + Tailwind + shadcn/ui + Recharts + TanStack Table (scaffold only; UI not implemented yet).
- **fixtures/** -- Sample legacy `.xls` reports (e.g. `Export_4_01_2026.xls`, `Export_4_03_2026.xls`).
- **data/** -- SQLite database file `data/app.db` under the repo root (created automatically on first run).

## Backend setup and run

1. Use **Python 3.11** (or compatible). Create and activate a virtualenv:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   # source .venv/bin/activate   # macOS/Linux
   ```

2. Install dependencies:

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. The `data/` directory is created automatically when the app starts. To override the DB path:

   ```bash
   set CSA_DATABASE_URL=sqlite:///../data/app.db
   ```

4. Start the API server:

   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   API base: `http://localhost:8000`

## Backend tests

```bash
cd backend
pytest
```

Run with verbose output:

```bash
pytest -v
```

Tests use a temporary SQLite DB under `backend/tests/test_app.db`. Parser and upload tests require `.xls` fixtures in `fixtures/`; if missing, those tests are skipped.

## Example API commands

### Health check

```bash
curl http://localhost:8000/health
```

### Upload an .xls report

```bash
curl -X POST http://localhost:8000/api/uploads ^
  -F "file=@fixtures/Export_4_01_2026.xls" ^
  -F "month=2026-04"
```

Response:

```json
{
  "upload_id": 1,
  "month": "2026-04",
  "file_name": "Export_4_01_2026.xls",
  "file_hash": "abc123...",
  "cards_detected": ["קורפוריט - זהב - 8838", "זהב - ביזנס - 6813"],
  "sections_detected": ["FOREIGN", "IL"],
  "inserted_count": 42,
  "skipped_duplicates_count": 0,
  "skipped_noise_count": 5
}
```

### List uploads

```bash
curl "http://localhost:8000/api/uploads"
curl "http://localhost:8000/api/uploads?month=2026-04"
```

### List transactions

```bash
curl "http://localhost:8000/api/transactions"
curl "http://localhost:8000/api/transactions?month=2026-04&section=IL&limit=50"
curl "http://localhost:8000/api/transactions?card_label=...&limit=20"
```

### Search transactions by text

```bash
curl "http://localhost:8000/api/transactions?q=supermarket"
```

### Filter uncategorized (needs review)

```bash
curl "http://localhost:8000/api/transactions?needs_review=true"
```

## Frontend

The frontend is not implemented yet. Use the backend API from a future React UI or from curl/HTTPie.
