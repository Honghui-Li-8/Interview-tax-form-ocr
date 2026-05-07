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

1. Sign in with one of the preset exercise users.
2. Upload a 1040 PDF.
3. Click Review Document.
4. Wait while the server renders the PDF pages and runs OCR.
5. Review the extracted fields.
6. Edit any missing or incorrect values.
7. Click Accept to persist the reviewed data.

Sample PDFs are available in `1040-examples/` when restored locally for testing.

## Auth Approach

The app includes a minimal auth layer for the exercise. The main reason is to protect a live demo from public uploads and show basic authorization judgment without building a full account system.

Auth flow:

```text
Preset env user
  -> login endpoint verifies credentials
  -> server returns signed JWT
  -> frontend stores token and username locally
  -> document API calls send Authorization header
  -> backend scopes document access by owner username
```

Preset users are configured with `AUTH_USERS` in `server/.env`. This is intentionally exercise-scoped. There is no registration, password reset, profile management, refresh token flow, or production password storage.

Documents store `owner_username`, and document read/process/accept queries filter by that owner. Cross-user document access returns `404`.

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
AUTH_USERS=user:password,user2:password
JWT_SECRET=replace-with-a-long-random-string
```

Frontend `web/.env`:

```text
VITE_SERVER_URL=http://localhost:3001
```

Set `DEBUG=true` on the backend to print OCR timing logs while not in production.

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

## Known Limitations

- PDF only; image uploads are intentionally out of scope.
- OCR extraction targets five fields, not the full 1040.
- Local filesystem storage for server; production would use object storage such as S3.
- SQLite local database; production would use a managed database.
- Auth uses preset env users and JWTs for exercise/demo protection only.
- Passwords in `AUTH_USERS` are plaintext demo credentials, not production auth.
- JWT is stored in localStorage for simplicity.
- No real field encryption; encryption hooks are placeholder no-ops.
- Processing is synchronous per request, with a guard to prevent duplicate OCR jobs.
