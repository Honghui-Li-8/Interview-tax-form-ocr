# Effort and Scope

What's included and what was skipped. Happy to discuss any of this.

---

## Included

- [x] Upload flow — PDF upload, stored server-side, returns a document ID
- [x] OCR pipeline — PDF rendered to images, Tesseract runs per page, fields extracted
- [x] Review and accept flow — pre-filled editable form, persists accepted data
- [x] Known limitations documented in README

## Bonus (listed in spec)

- [x] Auth — JWT login, documents scoped to owner
- [x] Unit tests — field extraction logic covered
- [x] Encryption — AES-256-GCM field-level, 2-layer key (server master + username)
- [x] Installation instructions — setup and run steps documented in README
- [x] Source control and commit messages — conventional commits throughout
- [x] Deployment — live on EC2 via Nginx + pm2; `setup-deploy.sh` handles full server setup

## Added (not required — some purely for demo UX quality and convenience)

- [x] Duplicate OCR guard — repeat requests while processing return current status, no duplicate jobs
- [x] PDF preview — served through the same auth-gated endpoint, blob URL revoked on navigation
- [x] Idempotent upload — re-uploading the same file replaces rather than duplicates
- [x] Field validation on accept — server-side format and presence checks before persisting
- [x] UI polish — refined upload, review, and records pages for demo clarity
- [x] `setup-dev.sh` — installs deps and scaffolds `.env` files for local dev
- [x] `run-dev.sh` — starts frontend and backend in parallel with one command
- [x] `setup-deploy.sh` — builds and deploys to a Linux server via Nginx + pm2, optional HTTPS via SSL cert
