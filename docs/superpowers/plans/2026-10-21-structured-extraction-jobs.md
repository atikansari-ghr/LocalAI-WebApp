# Durable Structured Extraction Candidate

**Goal:** Preserve private second-stage structured extraction requests and reviewed results across process restarts without exposing a public route or changing the installed Phase 3 service.

**Ruling:** Use a separate encrypted SQLite WAL store for this candidate rather than migrate the existing document-job database during Phase 4 development. This avoids a schema transition in the currently tested document queue; the cost is that backup, restore and eventual deployment must coordinate both stores atomically before activation.

**Supervisor boundary:** The inactive root document supervisor now owns this store and accepts scoped submission/status on its local Unix socket. Its systemd sandbox has no network or model-credential access. The source-only model runner therefore remains outside that service until a separately qualified inference bridge and crash-safe recovery contract exist. No public route is enabled.

**Executor access decision:** A queue-wide claim operation on the group-accessible document socket would reveal the next owner's decrypted report and claim token to any `localai` process. The prototype was rejected in review and removed before commit. A future bridge must bind claims to an authorized job identity or use a separately protected executor capability, and must hold the interactive lease through model completion.

**Candidate bridge:** The private store now derives a purpose-separated claim capability from its vault and includes it only on the first internal enqueue receipt, never status or an idempotent replay. A private socket claim must provide the exact job ID, namespace, scope and capability. Neither the socket nor the store/runner exposes a queue-wide claim. The eventual public HTTP handler must never return the capability. An executor still needs protected crash-safe receipt retention and the real interactive lease before this candidate may consume production jobs.

**Restart candidate:** The root-owned store can rederive bounded live queued receipts after reopening its existing vault; no enumeration operation is available on the group-accessible socket. A disposable child-SIGKILL proof reconstructed a second queued receipt while an interrupted running claim stayed protected. The protected handoff and systemd scheduling contract are still unimplemented.

## Tasks

- [x] RED→GREEN private durable queue: validate schema and parser/OCR evidence before enqueue, bind owner/scope/idempotency to the request, encrypt inputs and results, and reject incompatible existing database files.
- [x] RED→GREEN claim/finalization and restart behavior: claim tokens prevent late writes, interrupted model calls become visible failures only after interactive recovery, and owners cannot read another owner's result.
- [ ] Wire a serialized private runner to the qualified inference admission lease, then exercise actual restart/cancellation on disposable Debian without activating a public route. The source-only runner now holds one real interactive lease across claim/model/completion in a disposable direct llama.cpp proof; a lost lease after claim blocks completion in a unit regression. Protected receipt scheduling, the separate restricted executor, installed restart/cancellation and integrated lease recovery remain open.
- [ ] Review full source branch, run Windows/Debian/CI/docs gates, record remaining installed/quality/release blockers and keep the PR draft.
