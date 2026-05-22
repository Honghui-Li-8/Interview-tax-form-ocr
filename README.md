# Tax Form Parser

A small full-stack app for uploading a federal tax return PDF packet, parsing supported forms with Claude vision, and letting the user review/edit/accept the final structured data.

The app is scoped for an interview exercise: it prioritizes a complete upload -> parse -> review -> accept flow over production infrastructure.

> Design rationale and tradeoffs: [Decisions.md](Decisions.md)
> Timeline and scope justification: [Effort.md](Effort.md)

## Stack

- React + Vite frontend
- Express + TypeScript backend
- SQLite local database
- Local filesystem uploads
- Poppler `pdftoppm` for PDF page rendering
- Claude vision/document parsing for tax packet extraction

## Prerequisites

- Node.js 20+
- npm
- Poppler command line tools
- Anthropic API key for real document parsing

On Ubuntu/Debian:

```bash
sudo apt-get install poppler-utils
```

Confirm Poppler is available:

```bash
pdftoppm -h
```

## Setup

Use the script:

```bash
./setup-dev.sh
```

Or manually:

```bash
cd server
npm install
cp .env.example .env
```

```bash
cd ../web
npm install
cp .env.example .env
```

## Run Locally

Use the script (starts both servers in parallel, Ctrl+C stops both):

```bash
./run-dev.sh
```

Or manually in separate terminals:

Start the backend:

```bash
cd server
npm run dev
```

The backend runs on:

```text
http://localhost:3001
```

Start the frontend:

```bash
cd web
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

## How To Use

1. Sign in with one of the preset exercise users.
2. Upload a 1040 PDF.
3. Click Review Document.
4. Watch the processing status while the server renders pages and asks Claude to classify/extract supported forms.
5. Review the extracted packet fields and warnings.
6. Edit any missing or incorrect values.
7. Click Accept to persist the reviewed data.

Sample PDFs are available in `1040-examples/` when restored locally for testing.

## Environment

Backend `server/.env`:

```text
PORT=3001
DB_PATH=data/tax_ocr.db
DEBUG=false
AUTH_USERS=user:password,user2:password
JWT_SECRET=replace-with-a-long-random-string
MASTER_ENCRYPTION_KEY=replace-with-32-byte-hex-secret
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-sonnet-4-5
DOCUMENT_PARSER=claude
CLAUDE_MAX_FORM_PAGES_PER_CALL=4
```

Frontend `web/.env`:

```text
VITE_SERVER_URL=http://localhost:3001
```

Set `DEBUG=true` on the backend to print safe timing/count logs while not in production. Logs must not include rendered images, prompt bodies, SSNs, banking fields, names, addresses, local file paths, raw Claude output, `rawText`, or raw extracted values.

## Processing Progress

The review page opens an authenticated progress stream while a pending document is processing:

```text
GET /api/documents/:id/process/progress
```

The stream uses newline-delimited JSON over `fetch()` so the browser can send the same Bearer token as the rest of the API. If the stream is unavailable or disconnects, the frontend falls back to the existing polling flow and still refetches the document when processing finishes.

Progress events contain safe stage metadata only: phase, message, timestamp, percent, page counts, page numbers, supported form name, form index/count, and warning codes. They must not contain prompt text, image payloads, extracted values, `rawText`, SSNs, EINs, banking fields, names, addresses, or local file paths.

The sample `AUTH_USERS` values are demo credentials only. Do not store real passwords this way in production.

## Database And Files

- SQLite database path defaults to `server/data/tax_ocr.db`.
- Uploads are stored under `server/uploads/`.
- The server creates `uploads/` on startup.
- The schema is applied on startup with `CREATE TABLE IF NOT EXISTS`.
- A small exercise-scoped startup migration preserves local demo DBs after ownership was added.

If the schema changes during local development, delete the local database and restart the server:

```bash
rm server/data/tax_ocr.db
```

## Verification

Backend tests:

```bash
cd server
npm test
```

Backend build:

```bash
cd server
npm run build
```

Frontend build:

```bash
cd web
npm run build
```

## AcroForm Utilities

The 2025 IRS `shared/documents/2025/official_doc/f1040.pdf` already contains AcroForm widgets. The repo includes a small helper for exporting the field inventory, stripping the XFA packet, and filling the form from JSON:

```bash
python3 -m pip install -r scripts/pdf_forms/requirements.txt
python3 scripts/pdf_forms/acroform_tools.py normalize --input shared/documents/2025/official_doc/f1040.pdf --transform-spec shared/documents/2025/acroform/f1040.transforms.json --output shared/documents/2025/acroform/f1040.acroform.pdf
python3 scripts/pdf_forms/acroform_tools.py inventory --input shared/documents/2025/acroform/f1040.acroform.pdf --output shared/documents/2025/acroform/f1040.fields.json
python3 scripts/pdf_forms/acroform_tools.py template --input shared/documents/2025/acroform/f1040.acroform.pdf --output shared/documents/2025/acroform/f1040.values.template.json
python3 scripts/pdf_forms/acroform_tools.py fill --input shared/documents/2025/acroform/f1040.acroform.pdf --values path/to/values.json --output path/to/filled.pdf
```

The checked-in 2025 `f1040.acroform.pdf` also splits the primary taxpayer and spouse SSN widgets into three fields each, and the page 2 direct-deposit routing/account widgets into one field per printed digit box.

## Known Limitations

- PDF only; image uploads are intentionally out of scope.
- Supported tax packet scope is 2025 Form 1040 plus Schedules 1, 2, 3, A, B, C, D, and E.
- W-2, 1099, K-1, state forms, multi-PDF returns, and async background queues are out of scope.
- Local filesystem storage for server; production would use object storage such as S3.
- SQLite local database; production would use a managed database.
- Auth uses preset env users and JWTs for exercise/demo protection only.
- Passwords in `AUTH_USERS` are plaintext demo credentials, not production auth.
- JWT is stored in localStorage for simplicity.
- Uploaded PDFs are not encrypted at rest in this exercise; extracted packet JSON is encrypted before database storage.
- Processing is synchronous per request, with a guard to prevent duplicate parser jobs.
