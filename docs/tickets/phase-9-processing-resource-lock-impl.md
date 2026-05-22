# Ticket 9 — Processing Resource Lock Implementation Plan

## Top Overview

### Goal
Tax document parsing should run with a bounded amount of server-side concurrency. When the server is already processing the configured number of active OCR/Claude jobs, new pending documents should not be claimed or queued; the API should return a clear busy response and leave the document pending so the user can try again after capacity frees up.

### Implementation Shape
1. Add a small in-process processing slot guard for concurrency control.
2. Configure maximum active jobs with `MAX_ACTIVE_PROCESSING_JOBS`, defaulting to `1`.
3. Wire `POST /api/documents/:id/process` to reserve capacity before claiming a pending document.
4. Preserve the existing database claim as the per-document duplicate-processing guard.
5. Return a clear busy response when capacity is full.
6. Add focused tests proving extra pending documents are not claimed while capacity is full.

### Core Invariants
1. The database claim remains the source of truth for whether a document has been accepted for processing.
2. The slot guard limits total active jobs across different documents; it does not replace the per-document DB lock.
3. `POST /process` must still return quickly after either starting work or rejecting because capacity is full.
4. Invalid or missing `MAX_ACTIVE_PROCESSING_JOBS` values must fall back to `1`.
5. This ticket does not introduce Redis, BullMQ, a separate worker process, or in-memory queued jobs.

---

## Commit Plan

### Commit 1: Add in-process processing slot guard

**Issue**
The async processing flow prevents gateway timeouts, but every claimed document can start its parser job immediately. Multiple large PDFs can run concurrently and compete for CPU, memory, PDF rendering, and Claude API capacity.

**Impact**
Without a resource lock, several users can overload the single Node process even though each individual document has duplicate-processing protection.

**Work**
1. Create `server/src/documents/processingJobSlots.ts`.
2. Add an exported `tryStartProcessingJob` function:
   ```ts
   export function tryStartProcessingJob(job: () => Promise<void>): boolean
   ```
3. Add lower-level reservation helpers so the process handler can reserve capacity before claiming a DB row:
   ```ts
   export function tryReserveProcessingSlot(): (() => void) | null
   export function startReservedProcessingJob(release: () => void, job: () => Promise<void>): void
   ```
4. Read concurrency from `process.env.MAX_ACTIVE_PROCESSING_JOBS`.
5. Default to `1` when the env var is missing, non-integer, or less than `1`.
6. Track active job count only; do not keep a pending job array.
7. Release the active slot when the job settles.
8. Export a test-only reset helper:
   ```ts
   export function resetProcessingJobSlotsForTest(): void
   ```

**Justification**
An in-process slot guard is enough for the current MVP because the app already uses same-process background processing. Rejecting extra work instead of queueing it keeps resource use predictable and avoids creating hidden backlog on low-tier demo hosting.

**Deliverables**
1. `tryStartProcessingJob` starts jobs only when capacity is available.
2. Extra jobs are rejected when active capacity is full.
3. Concurrency is configurable and safely defaults to one active job.
4. Tests can reset slot-guard state between cases.

**Verification**
1. Add unit tests for the slot guard if a separate test file is useful.
2. Verify two unresolved jobs only start one job by default.
3. Verify the second job is rejected while the first is active.
4. Verify `MAX_ACTIVE_PROCESSING_JOBS=2` allows two active jobs.

**Pre-drafted commit message**
```text
feat(server): add processing slot guard

Guard:
- Limit active processing jobs by env config.
- Default invalid concurrency to one.
- Reject jobs when capacity is full.

Tests:
- Cover default and configured concurrency.
```

---

### Commit 2: Reject process starts when capacity is full

**Issue**
`processHandler` currently starts the in-process background parser job directly after claiming a pending document.

**Impact**
The slot guard exists but does not protect PDF parsing or Claude calls unless the process handler uses it before claiming new work.

**Work**
1. In `server/src/documents/processHandler.ts`, import `tryReserveProcessingSlot` and `startReservedProcessingJob`.
2. For pending documents, reserve a slot before emitting claim progress or updating the DB.
3. If no slot is available, return:
   ```ts
   res.status(429).json({
     error: 'Another document is already processing. This exercise build limits extraction to one document at a time because PDF parsing and Claude extraction are resource-intensive on modest hosting. Try again after it finishes.',
   })
   ```
4. If a slot is reserved, keep the atomic database claim unchanged:
   ```sql
   UPDATE tax_documents
   SET status = 'processing'
   WHERE id = ? AND owner_username = ? AND status = 'pending'
   ```
5. If the DB claim fails, release the reserved slot before returning the latest status.
6. If the claim succeeds, start the reserved job:
   ```ts
   startReservedProcessingJob(releaseProcessingSlot, () =>
     runDocumentProcessingJob(db, id, username, doc.stored_path)
   )
   ```
7. Preserve the existing failed-progress fallback if the job unexpectedly rejects.
8. Keep the success response unchanged:
   ```ts
   res.status(202).json({ documentId: id, status: 'processing' })
   ```

**Justification**
Capacity should be checked before claiming a pending document. That keeps rejected documents pending instead of creating hidden work that will run later without an explicit user action.

**Deliverables**
1. Pending documents are not claimed when capacity is full.
2. `POST /process` returns `429` with a readable busy message when capacity is full.
3. Processing retries and terminal-status behavior remain unchanged.

**Verification**
1. Run `env MASTER_ENCRYPTION_KEY=test-key npm test -- processHandler.test.ts`.
2. Confirm existing async start tests still pass.
3. Confirm no frontend contract changes are required.

**Pre-drafted commit message**
```text
fix(server): reject processing when capacity is full

Processing:
- Reserve processing slot before DB claim.
- Leave pending documents unclaimed when busy.
- Preserve async 202 process response.

Failures:
- Release reserved slot on claim failure.
```

---

### Commit 3: Cover processing concurrency behavior

**Issue**
The slot guard changes process-start behavior. Without regression coverage, a later change could accidentally claim documents while capacity is full or reintroduce hidden queueing.

**Impact**
The app could silently lose its resource lock and return to unbounded concurrent processing or invisible background backlog.

**Work**
1. Update `server/src/documents/processHandler.test.ts`.
2. Import and call `resetProcessingJobSlotsForTest()` in `beforeEach`.
3. Add a test that submits two different pending document requests while the first parser promise is unresolved.
4. Assert the first HTTP response returns `202 processing`.
5. Assert the second HTTP response returns `429` with the busy message.
6. Assert only the first document is claimed as `processing`.
7. Resolve the first parser promise.
8. Assert a retry for the second document can then return `202 processing`.
9. Add or update `server/src/documents/processingJobSlots.test.ts` for pure slot-guard tests.

**Justification**
The important behavior is observable at the process-handler boundary: accepted work starts immediately when capacity exists, and extra work is explicitly refused while preserving the document as pending.

**Deliverables**
1. Tests prove default concurrency is one active processing job.
2. Tests prove extra pending documents are rejected while capacity is full.
3. Tests prove rejected documents can be retried after active work finishes.

**Verification**
1. `env MASTER_ENCRYPTION_KEY=test-key npm test -- processHandler.test.ts`
2. If slot-guard tests are added, run `env MASTER_ENCRYPTION_KEY=test-key npm test -- processingJobSlots.test.ts`.
3. `npm run build` from `server/`.

**Pre-drafted commit message**
```text
test(server): cover processing capacity rejection

Concurrency:
- Assert second pending document is rejected.
- Assert rejected document remains retryable.
- Preserve immediate 202 responses.

Setup:
- Reset processing slot guard between tests.
```

---

## Suggested Implementation Order

1. Commit 1 first, because the slot guard should exist before `processHandler` depends on it.
2. Commit 2 after Commit 1, because the handler can then reserve capacity before claiming documents.
3. Commit 3 last, because tests should lock the final reject-when-busy behavior after wiring is complete.

---

## Implementation Notes

- **No hidden queue**: If capacity is full, pending documents remain pending and the user gets a clear busy response. This is intentional for a demo app because it avoids accumulating unseen heavy work.
- **Limit is per server process**: If the app runs multiple Node instances, each instance has its own in-memory slot guard. A global concurrency limit would require shared infrastructure.
- **Rejected documents stay pending**: A busy response must not update the document to `processing`; retry should be explicit after the active job finishes.
- **Recommended default is one**: PDF rendering and Claude extraction are expensive enough that `MAX_ACTIVE_PROCESSING_JOBS=1` is the safest default for a demo/interview deployment.
- **Frontend behavior**: The existing error panel can display the JSON busy message. A later UI polish ticket could show this as a non-error busy state if desired.

---

## Definition of Done

1. `MAX_ACTIVE_PROCESSING_JOBS` controls active processing concurrency.
2. Missing, invalid, or less-than-one concurrency values default to one active job.
3. A pending document is not claimed when processing capacity is full.
4. No more than the configured number of parser jobs run at once.
5. Busy responses return `429` with a readable retry-later message.
6. Existing per-document duplicate-processing protection remains intact.
7. Rejected pending documents can be retried after active work finishes.
8. Focused server tests cover slot-guard behavior and handler wiring.
9. `server` build passes.
