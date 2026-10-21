# Durable Structured Extraction Candidate

**Goal:** Preserve private second-stage structured extraction requests and reviewed results across process restarts without exposing a public route or changing the installed Phase 3 service.

**Ruling:** Use a separate encrypted SQLite WAL store for this candidate rather than migrate the existing document-job database during Phase 4 development. This avoids a schema transition in the currently tested document queue; the cost is that backup, restore and eventual deployment must coordinate both stores atomically before activation.

## Tasks

- [x] RED→GREEN private durable queue: validate schema and parser/OCR evidence before enqueue, bind owner/scope/idempotency to the request, encrypt inputs and results, and reject incompatible existing database files.
- [x] RED→GREEN claim/finalization and restart behavior: claim tokens prevent late writes, interrupted model calls become visible failures only after interactive recovery, and owners cannot read another owner's result.
- [ ] Wire a serialized private runner to the qualified inference admission lease, then exercise actual restart/cancellation on disposable Debian without activating a public route.
- [ ] Review full source branch, run Windows/Debian/CI/docs gates, record remaining installed/quality/release blockers and keep the PR draft.
