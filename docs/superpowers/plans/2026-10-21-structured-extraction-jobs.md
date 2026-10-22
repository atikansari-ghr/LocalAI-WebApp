# Durable Structured Extraction Candidate

**Goal:** Preserve private second-stage structured extraction requests and reviewed results across process restarts without exposing a public route or changing the installed Phase 3 service.

**Ruling:** Use a separate encrypted SQLite WAL store for this candidate rather than migrate the existing document-job database during Phase 4 development. This avoids a schema transition in the currently tested document queue; the cost is that backup, restore and eventual deployment must coordinate both stores atomically before activation.

**Supervisor boundary:** The inactive root document supervisor now owns this store and accepts scoped submission/status on its local Unix socket. Its systemd sandbox has no network or model-credential access. The source-only model runner therefore remains outside that service until a separately qualified inference bridge and crash-safe recovery contract exist. No public route is enabled.

**Executor access decision:** A queue-wide claim operation on the group-accessible document socket would reveal the next owner's decrypted report and claim token to any `localai` process. The prototype was rejected in review and removed before commit. A future bridge must bind claims to an authorized job identity or use a separately protected executor capability, and must hold the interactive lease through model completion.

## Tasks

- [x] RED→GREEN private durable queue: validate schema and parser/OCR evidence before enqueue, bind owner/scope/idempotency to the request, encrypt inputs and results, and reject incompatible existing database files.
- [x] RED→GREEN claim/finalization and restart behavior: claim tokens prevent late writes, interrupted model calls become visible failures only after interactive recovery, and owners cannot read another owner's result.
- [ ] Wire a serialized private runner to the qualified inference admission lease, then exercise actual restart/cancellation on disposable Debian without activating a public route. The source-only runner, real-model encrypted persistence proof, durable supervisor queue submission/status and synthetic process-crash proof pass. Supervisor-to-inference execution, cancellation and integrated lease recovery remain open.
- [ ] Review full source branch, run Windows/Debian/CI/docs gates, record remaining installed/quality/release blockers and keep the PR draft.
