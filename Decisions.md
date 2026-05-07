# Design Decisions

Key choices made during the exercise. Operational setup is in the [README](README.md). Happy to discuss any of this.

---

## Auth

Not in the spec. Added because without it, any visitor to a shared demo URL can read other users' extracted tax data.

Kept minimal: two preset env users, JWT, every document query filtered by owner. No registration, sessions, or bcrypt.

---

## OCR Pipeline

**PDF → image → OCR** — pages are rendered to PNG first, then Tesseract runs on the image. This handles scanned PDFs that have no embedded text layer.

**Duplicate job guard** — if OCR is already running for a document, a second request returns the current status instead of starting a new job.

**Missing fields** — if a field can't be extracted, it's stored as `null` and shown as a blank editable input. The flow doesn't break.

---

## Extracted Fields

Five fields: taxpayer name, filing status, total wages, total tax, refund or amount owed.

A full 1040 has 80+ lines. Five clean fields is enough to show the pipeline works — more would just add brittle regex.

---

## Database and Storage

SQLite and local filesystem — both are deliberate exercise shortcuts. Production would use PostgreSQL and S3. Named in Known Limitations rather than silently omitted.

Schema is applied on server startup (`CREATE TABLE IF NOT EXISTS`) so a reviewer can clone and run without a separate migration step.

---

## Encryption

**Scope:** extracted field values only (`ExtractedFields`). The uploaded PDF is not encrypted — out of scope for this exercise.

**Algorithm:** AES-256-GCM, field-level. Each non-null field is encrypted individually at write and decrypted at read.

**Key design (2-layer):**
- Layer 1 — server master secret (`MASTER_ENCRYPTION_KEY` env var)
- Layer 2 — username (stand-in for a user secret key retrieved and decoded from password)
- Combined: `SHA-256( masterKey + ":" + username )`
- Neither layer alone can decrypt the data

**Data lifecycle:**
- Plaintext only ever exists in memory during OCR extraction and encrypt/decrypt calls
- Every DB write goes through `encryptFields` — no plaintext path to storage
- Decrypted fields are sent to the client over the API (intentional — user must review them)
- Auth is untouched — key derivation is contained entirely within the encryption service

---

## PDF Preview

Not a stated requirement. Added for demo convenience — having the source document alongside the review form makes it easier to verify the upload and OCR result without switching tabs.

---

## PDF Preview Auth

The PDF is fetched through the same auth-gated endpoint as everything else (`GET /api/documents/:id/file`), with the same Bearer token and owner check.

Once the bytes land in the browser, `URL.createObjectURL` creates a blob URL in memory. The blob URL itself carries no token, but it is:
- Origin-scoped — only readable from the same origin
- Session-scoped — invalid outside the current browser session
- Revoked on navigation — `ReviewPage` calls `URL.revokeObjectURL` on cleanup

Acceptable for a demo. Production would use short-lived signed URLs instead.

---

## Frontend

React + Vite, no component library. Tailwind utilities are enough for a functional review form without the setup overhead.

JWT stored in localStorage — simpler than cookies for a local demo, not appropriate for production (XSS risk), named as a known limitation.
