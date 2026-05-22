# Ticket 8 — Async Tax Document Processing Implementation Plan

## Top Overview

### Goal
Tax document processing should no longer depend on one long-running HTTP request. When a user opens the review page for a pending document, the app should start processing quickly, stream or poll progress while OCR and Claude parsing run, and show the review page when extraction finishes without surfacing gateway timeout HTML.

### Implementation Shape
1. Refactor server processing into a quick request handler plus a background processing job.
2. Make `POST /api/documents/:id/process` idempotent across `pending`, `processing`, and terminal statuses.
3. Preserve existing progress streaming through `GET /api/documents/:id/process/progress`.
4. Keep frontend review flow mostly intact, but expect `processDocument` to return quickly.
5. Improve frontend API error formatting for HTML and timeout responses.
6. Add focused backend tests for async start, retry behavior, and failure persistence.
7. Add frontend or API tests where practical for user-friendly non-JSON errors.

### Core Invariants
1. A document may only have one active processing job started from a successful atomic `pending -> processing` claim.
2. Long OCR and Claude parsing must not block the HTTP response for `POST /process`.
3. Existing progress stream semantics must remain compatible with `ReviewPage`.
4. Parser failures must persist `failed` status and emit failed progress.
5. This ticket does not introduce an external queue or worker service; background execution stays in-process for the MVP.

---

## Commit Plan

### Commit 1: Refactor processing into a background job

**Issue**
`POST /api/documents/:id/process` currently performs the full parse before responding. Long PDF rendering, OCR, or Claude calls can exceed gateway timeouts.

**Impact**
Users can receive a `504 Gateway Time-out` even though the server may still be working. Retrying can appear to continue the flow, but the request model remains fragile.

**Work**
1. In `server/src/documents/processHandler.ts`, extract the long-running parse/save logic into a new helper, for example:
   ```ts
   async function runDocumentProcessingJob(args: {
     db: Database
     documentId: number
     username: string
     storedPath: string
   }): Promise<void>
   ```
2. Move this logic into that helper:
   - `parseTaxReturnPacket(...)`
   - demo extraction handling
   - failed extraction handling
   - encryption
   - final `UPDATE tax_documents`
   - progress events for saving, completed, and failed
3. Ensure the helper catches all unexpected errors and persists `failed`.
4. Keep `legacyFieldsFromExtraction`, `demoExtraction`, and `failedExtraction` available to the helper.

**Justification**
The process request should only start work; the background helper owns work completion. This directly enforces the invariant that long parsing does not block `POST /process`.

**Deliverables**
1. A background processing helper exists and owns parse/save/failure behavior.
2. The helper emits the same progress events the UI already expects.
3. Failed background processing updates the document to `failed`.

**Verification**
1. Run server process handler tests.
2. Manually force parser failure and confirm document status becomes `failed`.
3. Confirm progress events still include `completed` or `failed`.

**Pre-drafted commit message**
```text
refactor(server): isolate document processing job

Processing:
- Move parse and persistence into job helper.
- Preserve progress events during save and completion.
- Persist failed status on parser errors.

Safety:
- Catch background job failures.
- Keep extraction encryption in one path.
```

---

### Commit 2: Return immediately from process endpoint

**Issue**
The process endpoint still behaves like a synchronous command that returns the final extraction. The frontend only needs processing to start, then it already streams and polls for completion.

**Impact**
Skipping this commit keeps the timeout risk in place.

**Work**
1. In `makeProcessHandler`, after validating ownership and document ID, claim pending documents with the existing atomic update:
   ```sql
   UPDATE tax_documents
   SET status = 'processing'
   WHERE id = ? AND owner_username = ? AND status = 'pending'
   ```
2. If the claim succeeds, start `runDocumentProcessingJob(...)` without awaiting it.
3. Return quickly:
   ```ts
   res.status(202).json({
     documentId: id,
     status: 'processing',
   })
   ```
4. If the document is already `processing`, return `202` with `status: 'processing'`.
5. If the document is `extracted`, `failed`, or `accepted`, return `200` with current status.
6. Avoid `409` for normal retry/idempotency cases.

**Justification**
The database claim remains the duplicate-job guard. Returning `202` matches the API meaning: work has been accepted and is continuing asynchronously.

**Deliverables**
1. `POST /api/documents/:id/process` returns quickly for pending documents.
2. Retrying while processing does not start another job.
3. Terminal documents return current status instead of unnecessary conflict errors.

**Verification**
1. Add or adjust tests in `server/src/documents/processHandler.test.ts`.
2. Verify pending document response is `202 processing`.
3. Verify duplicate process request while `processing` returns `202`.
4. Verify extracted document returns `200` and does not restart processing.

**Pre-drafted commit message**
```text
fix(server): make process endpoint asynchronous

Endpoint:
- Return 202 after claiming pending documents.
- Treat processing retries as idempotent.
- Return terminal statuses without conflicts.

Guards:
- Start jobs only after pending claim succeeds.
- Keep atomic claim as duplicate protection.
```

---

### Commit 3: Align frontend review flow with async start

**Issue**
`ReviewPage` currently awaits `processDocument(documentId)` as though it may return the final extraction. After the backend change, this call becomes a quick start-processing request.

**Impact**
If the frontend assumes final data from `processDocument`, the UI may fetch too early or mishandle normal `processing` responses.

**Work**
1. In `web/src/pages/ReviewPage.tsx`, keep the current flow:
   - load document
   - open progress stream for pending/processing
   - call `processDocument` for pending documents
   - poll with `waitForProcessing`
2. Remove or simplify special handling for `Already processing` and `Already processed` if the backend no longer returns those for normal retries.
3. Confirm `doc = await getDocument(documentId)` still happens after the start request.
4. Keep the fallback polling behavior unchanged.

**Justification**
The frontend already has the correct observe path. The smallest safe change is to treat `processDocument` as a start signal and leave stream/poll completion behavior intact.

**Deliverables**
1. Review page starts pending processing without waiting for final extraction from `POST /process`.
2. Progress panel continues updating from `progressEvent`.
3. Polling still transitions from loading/progress to review or failure state.

**Verification**
1. Run frontend unit and type checks.
2. Manually upload a sample PDF and confirm progress appears.
3. Confirm final review fields appear after document status becomes `extracted`.
4. Retry during processing and confirm no user-visible conflict error.

**Pre-drafted commit message**
```text
fix(web): treat processing request as async start

Review flow:
- Keep progress stream during processing.
- Poll document status after start request.
- Remove retry conflict assumptions.

UX:
- Preserve loading and progress states.
```

---

### Commit 4: Sanitize non-JSON API errors in the frontend

**Issue**
`handleResponse` displays raw non-JSON response bodies. Gateway timeout pages are HTML, so the user sees unreadable markup.

**Impact**
Even after the async fix, proxy or infrastructure errors can still produce poor UX.

**Work**
1. In `web/src/api/documents.ts`, update `handleResponse` to detect JSON vs non-JSON error responses.
2. Special-case `504` with a friendly message:
   ```text
   Processing took longer than the server allowed. Refresh the status or try again.
   ```
3. For HTML responses, avoid showing raw tags. Use a generic message based on HTTP status.
4. Keep JSON `{ error }` behavior unchanged.

**Justification**
API clients should not expose gateway HTML to users. This is a small defensive improvement independent of the backend architecture.

**Deliverables**
1. HTML error bodies are not displayed directly.
2. JSON API errors still show server-provided messages.
3. `504` has a specific readable message.

**Verification**
1. Add focused tests for `handleResponse` if API tests exist.
2. Manually mock or simulate a `504 text/html` response.
3. Confirm the review error panel shows readable text.

**Pre-drafted commit message**
```text
fix(web): format non-json api errors

Errors:
- Preserve json error messages.
- Hide raw html response bodies.
- Add readable timeout message.

Resilience:
- Fall back to status-based errors.
```

---

### Commit 5: Add regression coverage for async processing

**Issue**
The timeout fix changes endpoint semantics and job orchestration. Without tests, regressions could reintroduce blocking behavior or duplicate jobs.

**Impact**
Future edits could accidentally await the long parse again or start multiple jobs for the same document.

**Work**
1. Extend `server/src/documents/processHandler.test.ts`.
2. Mock or stub the parser so tests can control completion timing.
3. Cover:
   - pending document returns `202` before parser resolves
   - processing document returns `202` without starting another parser call
   - extracted/failed document returns `200`
   - parser rejection persists `failed`
4. Run existing progress service tests to ensure stream events still behave.

**Justification**
The core risk is orchestration behavior, not parsing correctness. Tests should focus on response timing, idempotency, and persistence.

**Deliverables**
1. Tests prove `POST /process` does not wait for parser completion.
2. Tests prove retries do not duplicate background jobs.
3. Tests prove parser failure updates DB status.

**Verification**
1. `yarn test:unit` from repo root if configured.
2. Or `npm test` from `server/` if that is the local package command.
3. Confirm all existing server tests still pass.

**Pre-drafted commit message**
```text
test(server): cover async processing semantics

Process endpoint:
- Assert pending documents return 202 quickly.
- Assert processing retries are idempotent.
- Assert terminal states do not restart jobs.

Failures:
- Persist failed status after parser rejection.
```

---

## Suggested Implementation Order

1. Commit 1 first, because the long-running work needs a clean callable boundary before changing endpoint behavior.
2. Commit 2 after Commit 1, because the endpoint can safely start the extracted background helper without awaiting it.
3. Commit 3 after server behavior changes, because the frontend should align to the new `202 processing` contract.
4. Commit 4 after Commit 3, because it is a UX hardening layer and does not block async processing.
5. Commit 5 last, because tests should lock the final semantics after the server and frontend contracts settle.

---

## Implementation Notes

- **In-process background jobs are not durable**: If the server process crashes after returning `202`, the document may remain `processing`. A later ticket should add startup recovery or a real queue.
- **Stuck processing recovery**: Consider adding `processing_started_at` or a timeout-based requeue strategy later.
- **Progress stream lifecycle**: Current stream behavior should remain compatible, but deployed proxies may also timeout long-held streams. Polling fallback is still important.
- **Response type contract**: `ProcessResponse` in `shared/types.ts` may need to allow `status: 'processing'` without extraction fields.

---

## Definition of Done

1. `POST /api/documents/:id/process` returns quickly with `202 processing` for pending documents.
2. Long parsing runs outside the HTTP response path.
3. Progress stream still updates the review page with page/form status.
4. Frontend polling still loads the final extracted or failed document.
5. Retrying while a document is processing does not create duplicate jobs.
6. Parser failures persist `failed` status and show a recoverable review-page error state.
7. Raw HTML gateway errors are no longer displayed in the UI.
8. Backend process handler tests cover async start, idempotent retry, terminal status, and failure persistence.
9. Typecheck and relevant unit tests pass.
