# Ticket 9 — Processing Resource Lock Implementation Plan

## Top Overview

### Goal
Tax document parsing should run with a bounded amount of server-side concurrency. When multiple documents are submitted for processing, each request should still return quickly, but the server should only execute a configured number of active OCR/Claude parsing jobs at the same time.

### Implementation Shape
1. Add a small in-process processing job queue for concurrency control.
2. Configure maximum active jobs with `MAX_ACTIVE_PROCESSING_JOBS`, defaulting to `1`.
3. Wire `POST /api/documents/:id/process` to enqueue background jobs instead of starting them directly.
4. Preserve the existing database claim as the per-document duplicate-processing guard.
5. Add focused tests proving jobs are queued and drained in order.
6. Document the same-process durability limitation for future production hardening.

### Core Invariants
1. The database claim remains the source of truth for whether a document has been accepted for processing.
2. The queue limits total active jobs across different documents; it does not replace the per-document DB lock.
3. `POST /process` must still return quickly after a successful claim and enqueue.
4. Invalid or missing `MAX_ACTIVE_PROCESSING_JOBS` values must fall back to `1`.
5. This ticket does not introduce Redis, BullMQ, a separate worker process, or durable queued jobs.

---

## Commit Plan

### Commit 1: Add in-process processing job queue

**Issue**
The async processing flow prevents gateway timeouts, but every claimed document can start its parser job immediately. Multiple large PDFs can run concurrently and compete for CPU, memory, PDF rendering, and Claude API capacity.

**Impact**
Without a resource lock, several users can overload the single Node process even though each individual document has duplicate-processing protection.

**Work**
1. Create `server/src/documents/processingJobQueue.ts`.
2. Add an exported `enqueueProcessingJob` function:
   ```ts
   export function enqueueProcessingJob(job: () => Promise<void>): void
   ```
3. Read concurrency from `process.env.MAX_ACTIVE_PROCESSING_JOBS`.
4. Default to `1` when the env var is missing, non-integer, or less than `1`.
5. Track active job count and a FIFO array of pending jobs.
6. When a job finishes, decrement the active count and drain the next queued job.
7. Export a test-only reset helper:
   ```ts
   export function resetProcessingJobQueueForTest(): void
   ```

**Justification**
An in-process queue is enough for the current MVP because the app already uses same-process background processing. It adds resource protection without adding new infrastructure or deployment complexity.

**Deliverables**
1. `enqueueProcessingJob` starts jobs only when capacity is available.
2. Queued jobs automatically start after active jobs settle.
3. Queue concurrency is configurable and safely defaults to one active job.
4. Tests can reset queue state between cases.

**Verification**
1. Add unit tests for the queue if a separate test file is useful.
2. Verify two enqueued unresolved jobs only start one job by default.
3. Verify the second job starts after the first resolves.
4. Verify `MAX_ACTIVE_PROCESSING_JOBS=2` allows two active jobs.

**Pre-drafted commit message**
```text
feat(server): add processing job queue

Queue:
- Limit active processing jobs by env config.
- Default invalid concurrency to one.
- Drain queued jobs after completion.

Tests:
- Reset queue state between cases.
```

---

### Commit 2: Route document processing through the queue

**Issue**
`processHandler` currently starts the in-process background parser job directly after claiming a pending document.

**Impact**
The queue exists but does not protect PDF parsing or Claude calls unless the process handler uses it.

**Work**
1. In `server/src/documents/processHandler.ts`, import `enqueueProcessingJob`.
2. Replace direct background execution:
   ```ts
   void runDocumentProcessingJob(...)
   ```
   with:
   ```ts
   enqueueProcessingJob(() =>
     runDocumentProcessingJob(db, id, username, doc.stored_path)
   )
   ```
3. Preserve the existing `.catch(...)` fallback that emits failed progress if the job unexpectedly rejects.
4. Keep the HTTP response unchanged:
   ```ts
   res.status(202).json({ documentId: id, status: 'processing' })
   ```
5. Keep the atomic database claim unchanged:
   ```sql
   UPDATE tax_documents
   SET status = 'processing'
   WHERE id = ? AND owner_username = ? AND status = 'pending'
   ```

**Justification**
The queue should sit between the claim and the expensive work. The user-facing API remains asynchronous and idempotent, while active backend resource use is bounded.

**Deliverables**
1. Claimed documents are enqueued instead of immediately parsed.
2. `POST /process` still returns `202 processing` quickly.
3. Processing retries and terminal-status behavior remain unchanged.

**Verification**
1. Run `env MASTER_ENCRYPTION_KEY=test-key npm test -- processHandler.test.ts`.
2. Confirm existing async start tests still pass.
3. Confirm no frontend contract changes are required.

**Pre-drafted commit message**
```text
fix(server): enqueue document processing jobs

Processing:
- Route claimed documents through job queue.
- Preserve async 202 process response.
- Keep duplicate guard in database claim.

Failures:
- Preserve failed progress fallback.
```

---

### Commit 3: Cover processing concurrency behavior

**Issue**
The queue changes runtime ordering. Without regression coverage, a later change could accidentally start all jobs immediately again.

**Impact**
The app could silently lose its resource lock and return to unbounded concurrent processing.

**Work**
1. Update `server/src/documents/processHandler.test.ts`.
2. Import and call `resetProcessingJobQueueForTest()` in `beforeEach`.
3. Add a test that submits two different pending document requests with unresolved parser promises.
4. Assert both HTTP responses return `202 processing`.
5. Assert only the first parser call starts while concurrency is default `1`.
6. Resolve the first parser promise.
7. Assert the second parser call starts after the first job persists completion.
8. If queue behavior is easier to isolate, add `server/src/documents/processingJobQueue.test.ts` for pure queue tests and keep handler tests focused on wiring.

**Justification**
The important behavior is observable at the process-handler boundary: users get immediate responses, but expensive parser work is serialized by default.

**Deliverables**
1. Tests prove default concurrency is one active processing job.
2. Tests prove queued jobs drain after active completion.
3. Tests prove handler responses remain immediate while work is queued.

**Verification**
1. `env MASTER_ENCRYPTION_KEY=test-key npm test -- processHandler.test.ts`
2. If queue tests are added, run `env MASTER_ENCRYPTION_KEY=test-key npm test -- processingJobQueue.test.ts`.
3. `npm run build` from `server/`.

**Pre-drafted commit message**
```text
test(server): cover processing resource lock

Concurrency:
- Assert second parser waits by default.
- Assert queued job drains after completion.
- Preserve immediate 202 responses.

Setup:
- Reset processing queue between tests.
```

---

## Suggested Implementation Order

1. Commit 1 first, because the queue abstraction should exist before `processHandler` depends on it.
2. Commit 2 after Commit 1, because the handler can then route claimed jobs through the new limiter without changing API behavior.
3. Commit 3 last, because tests should lock the final queue-and-handler behavior after wiring is complete.

---

## Implementation Notes

- **Same-process queue is not durable**: If the Node process restarts, queued jobs are lost and already-claimed documents may remain `processing`. A future production ticket should add stuck-job recovery or a durable worker queue.
- **Limit is per server process**: If the app runs multiple Node instances, each instance has its own in-memory queue. A global concurrency limit would require shared infrastructure.
- **Queued documents report processing**: A claimed but not-yet-running document still has status `processing`. That is acceptable for MVP, but a later ticket could add `queued` or progress metadata if users need that distinction.
- **Recommended default is one**: PDF rendering and Claude extraction are expensive enough that `MAX_ACTIVE_PROCESSING_JOBS=1` is the safest default for a demo/interview deployment.
- **No frontend change expected**: The frontend already treats processing as asynchronous and observes progress through stream/polling. Queued jobs may simply spend longer before detailed progress appears.

---

## Definition of Done

1. `MAX_ACTIVE_PROCESSING_JOBS` controls active processing concurrency.
2. Missing, invalid, or less-than-one concurrency values default to one active job.
3. Multiple pending documents can be claimed and return `202 processing`.
4. No more than the configured number of parser jobs run at once.
5. Queued jobs start automatically when active jobs finish.
6. Existing per-document duplicate-processing protection remains intact.
7. Existing progress stream and polling flow still work without frontend changes.
8. Focused server tests cover queue behavior and handler wiring.
9. `server` build passes.
