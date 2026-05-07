# Tax Form OCR

A small full-stack app for uploading a 1040 PDF, running OCR on the server, extracting key tax fields, and letting the user review/edit/accept the final data.

The app is scoped for an interview exercise: it prioritizes a complete upload -> OCR -> review -> accept flow over production infrastructure.

## Stack

- React + Vite frontend
- Express + TypeScript backend
- SQLite local database
- Local filesystem uploads
- Poppler `pdftoppm` for PDF page rendering
- `tesseract.js` for OCR

## Prerequisites

- Node.js 20+
- npm
- Poppler command line tools

On Ubuntu/Debian:

```bash
sudo apt-get install poppler-utils
```

Confirm Poppler is available:

```bash
pdftoppm -h
```

## Setup

Install backend dependencies:

```bash
cd server
npm install
cp .env.example .env
```

Install frontend dependencies:

```bash
cd ../web
npm install
cp .env.example .env
```

## Run Locally

Start the backend:

```bash
cd server
npm run dev
```

The backend runs on:

```text
http://localhost:3001
```

Start the frontend in another terminal:

```bash
cd web
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

## How To Use

1. Upload a 1040 PDF.
2. Click Review Document.
3. Wait while the server renders the PDF pages and runs OCR.
4. Review the extracted fields.
5. Edit any missing or incorrect values.
6. Click Accept to persist the reviewed data.

Sample PDFs are available in `1040-examples/` when restored locally for testing.

## OCR Approach

The OCR pipeline runs entirely on the backend:

```text
Uploaded PDF
  -> render each page to PNG with pdftoppm
  -> run tesseract.js on each page image
  -> join page OCR text
  -> parse five review fields
  -> save extracted JSON for review
```

The app intentionally renders PDF pages to images before OCR. This handles scanned PDFs where there is no reliable embedded text layer to parse.

Before OCR starts, the document status is changed from `pending` to `processing`. That prevents repeated review-page requests from starting duplicate OCR jobs for the same upload.

If OCR fails or a field cannot be found, the app keeps the review flow available. Missing values are stored as `null` and shown as blank editable fields.

## Extracted Fields

The app extracts five review fields:

- Taxpayer name
- Filing status
- Total wages / income
- Total tax
- Refund or amount owed

This is intentional scope control. A full 1040 parser would add a lot of brittle OCR rules without improving the core assignment flow.

## Environment

Backend `server/.env`:

```text
PORT=3001
DB_PATH=data/tax_ocr.db
DEBUG=false
```

Frontend `web/.env`:

```text
VITE_SERVER_URL=http://localhost:3001
```

Set `DEBUG=true` on the backend to print OCR timing logs while not in production.

## Database And Files

- SQLite database path defaults to `server/data/tax_ocr.db`.
- Uploads are stored under `server/uploads/`.
- The server creates `uploads/` on startup.
- The schema is applied on startup with `CREATE TABLE IF NOT EXISTS`.

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

## Known Limitations

- PDF only; image uploads are intentionally out of scope.
- OCR extraction targets five fields, not the full 1040.
- Local filesystem storage for server; production would use object storage such as S3.
- SQLite local database; production would use a managed database.
- No authentication; this is single-user exercise scope.
- No real field encryption; encryption hooks are placeholder no-ops.
- Processing is synchronous per request, with a guard to prevent duplicate OCR jobs.
