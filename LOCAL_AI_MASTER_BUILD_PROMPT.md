# Local AI Master Build Specification
Version: 0.1 — 2026-10-18. Owner: Atik Ansari.
Repository: https://github.com/atikansari-ghr/LocalAI-WebApp

## Authority and scope
Build an independent private Local AI platform for Workspace users and API clients. This document consolidates all 110 Local AI decisions recovered from “Branch · PDMS App Development”. The numbered register below preserves traceability; this document's precedence rules resolve historical contradictions. Earlier PDMS performance/sign-in decisions are excluded. No PDMS or Family Calendar repository/application changes are authorized. Their integrations are contracts and synthetic examples only.

Implement in controlled feature branches and PRs. Never report an unexecuted check as passed, merge failing critical checks, publish an incomplete production release, or substitute mock inference for working inference. Every phase ships code, meaningful tests, documentation, and evidence. Specification approved on 2026-10-18; foundation implementation is tracked in docs/progress.md. Later phases and production qualification remain pending.

## Precedence
Latest explicit user requirements prevail, then later confirmed decisions, then earlier decisions. Specifically:
- Decisions 67–68 supersede early OCR orders: native parsing first; configurable default light-ocr → Tesseract → PaddleOCR.
- Decision 57 supersedes 16/28 on automatic starter installation; 58 requires approval for candidate activation after initial provisioning.
- Decision 82 supersedes early /api extensions and per-application URLs: all application operations use one /v1 base.
- Decisions 81/84/85 add capabilities, optional source restrictions, and exactly one active key per application.
- Decision 108 selects SQLite WAL with migration abstraction, not PostgreSQL/Redis.
- Decision 105 selects secure browser setup without a default password.
- Later first-run/release decisions govern any incompatible examples in the historical register.

## Deployment and architecture
Target Debian 13 Proxmox LXC, CPU-only, 4 vCPU, 6 GB RAM, 100 GB disk; native systemd; no Docker. One gateway serves /login, /setup, /workspace, /admin, /docs and /v1 on configurable port 1234. Internal llama.cpp, Qdrant, OCR and embedding workers bind loopback only. Remote administration is opt-in, TLS-required and proxy-aware; LAN and VPN are supported. Trust forwarded headers only from explicitly configured proxy CIDRs.

Use a modular gateway, SQLite WAL metadata persistence and a durable worker scheduler, with independently managed inference, OCR, embedding and Qdrant adapters. A lightweight frontend serves Admin, Workspace and built-in docs. Exact framework choices require a phase implementation plan and dependency review; no unconfirmed framework is presented as a prior decision.

Repository boundaries: apps/gateway, apps/web-admin, apps/workspace; services/inference, rag, ocr, extraction, scheduler, backup, monitoring; packages/auth, database, schemas, shared; installer; migrations; tests/unit, integration, security, performance, synthetic-documents; docs; scripts. Create directories when real code belongs in them.

Use an unprivileged service account, least privilege file permissions, separate configuration/state/cache/log paths and hardened systemd units. Installer must validate OS/resources, support safe rerun after interruption, preserve existing state and report partial failures. No destructive uninstall without explicit authorization. Apply versioned database migrations transactionally; use online SQLite backups rather than copying a live database without its WAL.

## Security and privacy
Admin: passkey preferred; password + TOTP fallback; single-use recovery codes; step-up for sensitive actions. Workspace: policy-controlled password/TOTP/passkey, RBAC and explicit namespace permissions. Secure sessions, CSRF, rate limits, expiration, revocation, lockout and audit events are mandatory.
First-run setup uses an expiring single-use secret, no default account/password, atomic initialization and protection against competing requests and brute force. Browser wizard configures identity, MFA, networking/TLS, models, OCR, calibration and recovery.
Application credentials are separate from browser sessions. Show generated secrets once, store verification digests, rotate atomically with immediate prior-key revocation. Enforce capabilities, quotas, optional expiry and IPv4/IPv6 subnet allowlists.
Treat documents and model outputs as untrusted. The LLM never decides authorization or executes uploaded instructions. Scope enforcement happens before retrieval and again before returning citations/results. Redact secrets and document/prompt contents from routine logs and diagnostic bundles.
No cloud inference fallback or telemetry. Local-only mode blocks outbound processing. Approved downloads, updates, notifications and cloud backup require explicit policy; secrets use encrypted vault storage and step-up reveal/export. External notification payloads minimize sensitive content.

## AI, ingestion and retrieval
Use a validated 4B-class Q4 GGUF instruct model via llama.cpp CPU inference, a small multilingual embedding model and unloadable lightweight reranker. Heavy inference concurrency starts at one; default idle unload is 15 minutes, configurable. Apply adaptive context budgets, bounded queues, timeouts, cancellation and local circuit-breaker fallback.
Automatic starter provisioning consumes a maintained signed compatibility manifest; pin exact artifact revisions, hashes, licenses, architecture, CPU requirements, context and measured RAM. Never download from arbitrary user-supplied URLs without URL/network validation. Capability tests distinguish declared, detected and actually tested behavior. Administrator overrides always win.
Native parsers precede OCR; process pages independently and preserve provenance. Support PDF, DOCX, ODT, RTF, TXT, Markdown, JPEG/PNG/WebP/TIFF, XLSX/XLS/CSV/ODS, PPTX/ODP, HTML/JSON/XML, ICS, EML, reliable locally parsed MSG and bounded ZIP.
Validate extension, MIME, magic, structure, size/pages, archive expansion/path traversal/symlinks/depth and parser resource limits before processing. Optional per-policy ClamAV scanning quarantines suspicious files.
Default OCR chain is configurable, stops when acceptable quality is reached, and exposes engine/language/fallback/provenance/quality/latency. Adaptive preprocessing preserves originals. Critical conflicting fields require review; confidence is calibrated, never fabricated.
Extraction supports versioned managed and caller-supplied validated JSON schemas, deterministic field validation, classification hints/conflicts, source coordinates/pages and explicit missing information. AI field discovery remains a suggestion.
Qdrant stores vectors with mandatory application/user/access scope, document ID, revision and embedding version. Use active revisions by default, structure-aware chunks, deterministic exact/metadata plus semantic retrieval, adaptive reranking and precise authorized citations. Embedding changes require a new index generation and validated reindex, never mixed vector spaces.
General chat and grounded document mode remain distinct. Insufficient evidence yields an explicit abstention. Risk-aware verification checks important dates, IDs, names and amounts against evidence.

## Unified API and integrations
OpenAI-compatible GET /v1/models, POST /v1/chat/completions (including SSE) and POST /v1/embeddings. Extensions: POST /v1/ocr, POST /v1/extract, POST /v1/documents/ingest, POST /v1/rag/query, GET /v1/documents/{id}/status, DELETE /v1/documents/{id}. Define schema/version/error/timeout/idempotency and asynchronous job contracts in OpenAPI before implementation.
API key resolves application profile, capabilities, namespace, limits and source policy; do not trust caller-selected application identity. A client may supply authorization context only within its registered delegation boundaries. Deny missing/invalid scopes. Never expose unrestricted Qdrant filters or admin operations to application keys.
PDMS example sends authorized text/metadata and revision identifiers. Family Calendar example returns proposed events with provenance, warnings and confidence; event approval, conflict resolution and writes belong to the consuming application. Synthetic examples only.

## Workspace and UI
Provide multi-user chat, streaming, document Q&A, OCR, extraction, hybrid search, citations, model/profile selection, history and feedback. Uploads are temporary by default with expiry; persistent save is explicit, private by default, quota-controlled and user/group shareable. Revision replacement requires confirmation.
Explicit Remember this controls separate local per-user memory; never automatically learn from sensitive files or share memory with application clients. History, RAG, cache and memory have separate retention/deletion.
After login, Workspace, Admin (as authorized), Documentation and profile are first-class navigation. Responsive desktop/tablet/mobile, keyboard navigation, contrast and reduced motion/transparency are required. Initial English and Arabic use translation catalogs, per-user selection and full RTL; document language is independent.
Themes: Light, Dark, System, Glass and Liquid Glass, configurable accent palettes. Named local login wallpaper schemes include AI, system and host infrastructure designs plus administrator uploads, previews, enabled states, fixed/random/rotation behavior. Readability and reduced effects take priority.
Admin manages applications, keys, users/groups, models/profiles, schemas, OCR/languages, RAG, queues, storage/cache, security, secrets, backups, updates, notifications, logs and configuration. Dashboard widgets are customizable per administrator and show genuine resource/service measurements; unavailable LXC sensors display Unavailable.

## Operations and recovery
Balanced default with Eco/Performance alternatives; non-disableable emergency protection reduces cache/background work before risking exhaustion. Prioritize interactive requests. Measure CPU, memory, swap, disk and queue pressure; explain throttling actions.
Persistent jobs use leases, checkpoints, bounded retries/backoff, cancellation and idempotent outputs. Crash/restart recovery must prevent duplicate vectors and concurrent execution. systemd recovery has bounded backoff and dependency checks.
Cache exact/semantic/retrieval/embedding layers only within identical authorization scope, document/index generations, model/profile and conversation context. Revalidate permissions; invalidate on revisions, sharing, deletion or model changes. Bound RAM/disk with TTL/LRU and pressure eviction.
Storage separates models, vectors, documents, temp, logs, cache, backup and rollback. Only disposable artifacts are automatic cleanup candidates. Never silently remove pinned/active/fallback/rollback models, valid backups, protected security logs or live indexes.
Deletion purges derived text, chunks, vectors, caches and applicable references, verifies retrieval failure, and maintains tombstones applied on restore. Do not promise physical SSD erasure through LXC.
Backups support independent Local/NAS/NFS/SMB/Google Drive/OneDrive policies, schedules, retention, encryption, credentials, retries and capacity/connectivity tests. Failed destinations do not block others. Include SQLite, Qdrant snapshots, configuration, vault recovery and selected assets; consistent point-in-time recovery must be tested. Strong Verified status requires integrity/encryption/manifest/component checks and isolated test restore.
Updates separate application/model versions; Stable default and opt-in Preview, SemVer, changelog, signed/integrity-checked artifacts, pre-update backup, migration compatibility, health checks and documented rollback boundaries. Irreversible migrations require a tested restore path.
Notifications: in-panel, email, Telegram, generic webhook with category controls, testing, deduplication and protected credentials. Rotate/retain logs by category, age and size.

## Documentation acceptance
Write Installation, Administrator, User/Usage, Configuration, API/Integration, Troubleshooting and Recovery guides alongside features. Every setting documents purpose/default/valid range/resource-security consequences/recommendation, tooltip text and stable built-in Learn more anchor. Protect interactive API playgrounds.
Capture real screenshots from implemented UI with synthetic data, including mobile/tablet, English/Arabic, themes and wallpapers; never claim mockups are screenshots. Version docs with code. CI checks help anchors, settings coverage, OpenAPI changes, migration notes and relevant screenshot updates.

## Controlled phases and acceptance
Each phase starts from a reviewed plan, adds failing behavior tests before implementation, runs targeted checks, documents outcomes and opens a feature PR. Do not progress past critical failures.
1. Foundation: rerunnable Debian installer, state/config, SQLite migrations/WAL, systemd/health. Gate: clean install, rerun and crash-safe state recovery.
2. Security: first-run, MFA/passkeys, RBAC, vault, sessions, API keys/IP/TLS. Gate: concurrent setup, recovery abuse, proxy spoofing and authorization tests.
3. AI runtime: verified starter manifest, inference, embeddings, profiles/fallback/resources. Gate: real CPU inference/streaming/capability and 6 GB memory tests.
4. OCR/parsing: format validation, parsers, configurable chain, multilingual benchmark. Gate: malformed/hostile files, mixed pages, fallback and field provenance.
5. RAG: Qdrant ingestion/search/revisions/citations/reranker. Gate: cross-user/app isolation, multilingual retrieval, reindex and deletion.
6. Gateway: OpenAI compatibility and extended APIs. Gate: contract, streaming disconnect, limits and async job tests.
7. Applications: guided onboarding, policies, isolated keys/namespaces. Gate: rotation/revocation/capability and source tests.
8. Workspace: all user flows, sharing/quotas/history/memory. Gate: permissions, revision confirmation, temporary cleanup and user journeys.
9. Admin: actual control surfaces and monitoring. Gate: privileged action/step-up audit and real state changes.
10. UI/branding: full themes/wallpapers, responsive English/Arabic. Gate: accessibility, RTL and browser screenshots.
11. Operations: durable jobs/cache/resource scheduling/self-healing/notifications. Gate: restart, starvation, invalidation and exhaustion tests.
12. Backup/recovery: all destinations and encrypted verified restore. Gate: corruption, missing keys, isolated restore, tombstone replay.
13. Documentation: complete guides, help registry and screenshots. Gate: coverage, links, version agreement and reproducible examples.
14. QA: regression/security/privacy/performance suites. Gate: complete synthetic evidence, no skipped mandatory checks.
15. Production: clean install/upgrade/rollback on target LXC, reviewed release candidate and signed artifacts. Gate: every mandatory release criterion passes before v1.0.0.

## Full release gates
Fail closed on missing, stale, skipped or failed evidence. Evidence must identify commit, environment, command, timestamps, result and artifacts. Static checks/mocks do not prove Debian LXC or model compatibility.
Mandatory categories: clean install/rerun/upgrade; authentication/MFA/recovery/RBAC; key/IP/proxy isolation; real AI/streaming/load/fallback/context; RAG/revision/citation isolation; multilingual OCR fallback; formats/archives; Workspace/sharing/quotas/memory; API compatibility; restart/resumption; backup/isolated restore; migrations/rollback; privacy/egress; responsive English/Arabic/accessibility/themes; docs; regressions; hardware performance.
Calibrate TTFT, tokens/sec, OCR, embeddings, retrieval, cache and API latency plus CPU/RAM/disk on the actual host. Record Before → After → Target → Pass/Fail. Derive documented tolerances from measured baseline; do not invent throughput guarantees.
Release automation must bind all evidence to the release commit, reject unknown categories or absent artifacts, and prevent publishing Stable until complete. GitHub branch rules/required checks must be inspected and configured when CI names exist; documentation alone is not enforcement.

## Verification findings and open release blockers
As of 2026-10-18 upstream GitHub latest-release API reports llama.cpp v0.7.0, Qdrant v1.19.2 and light-ocr v0.5.8. These are research observations, not approved deployment pins.
Sources: https://github.com/ggml-org/llama.cpp/releases/latest ; https://github.com/qdrant/qdrant/releases/latest ; https://github.com/arcships/light-ocr/releases/latest .
Candidate Qwen3-4B-GGUF has an Apache-2.0 model card and Q4_K_M artifact family; its card describes llama.cpp usage: https://huggingface.co/Qwen/Qwen3-4B-GGUF . light-ocr upstream identifies an offline Node/C++ implementation under Apache-2.0: https://github.com/arcships/light-ocr .
No measured Debian 13 / 6 GB compatibility is established. Before provisioning: pin revisions/hashes, inspect transitive/native dependencies and model-weight licenses separately, verify CPU instruction/glibc compatibility and benchmark jointly with Qdrant/OCR. Choose embedding/reranker only after equivalent license and multilingual quality/resource checks.
Release remains blocked until target-LXC execution, approved starter manifest, complete implementation, automated gate enforcement, backup/restore and all other mandatory evidence exist. No production gate has passed.

## Numbered decision register
Full recovered details: [Decision details](docs/requirements/decision-details.md). The summaries below are an index; retain the detailed requirements during phase planning.

The following are recovered decision summaries, not independently verified claims about upstream software. Precedence rules above apply to historical details. Numbers 1–110 refer only to Local AI decisions.

### D001
Decision 1 confirmed: Option B — Dedicated Local AI LXC.

This is the stronger architecture. PDMS remains on its existing LXC, while inference gets isolated CPU/RAM resources.

### D002
Decision 2 confirmed: Option B — Dedicated AI LXC with 6 GB RAM / 4 vCPU.

Initial target:

### D003
Decision 3 confirmed: Option C — Full Local AI + RAG from the initial AI implementation.

The dedicated AI LXC will eventually provide the complete intelligence layer envisioned in the PDMS specification: model-assisted extraction/classification, document chat, embeddings and semantic similarity. :chatgpt-content-reference{index="0"}

### D004
Decision 4 confirmed: Option A — Qdrant on the dedicated Local AI LXC.

The standalone AI server is now shaping up as:

### D005
Decision 5 confirmed: Option C — support both text/API ingestion and direct file ingestion.

For PDMS, text/API ingestion remains the preferred path, while direct file ingestion makes the Local AI platform independently testable and reusable.

### D006
Decision 6 confirmed: Option C — Hybrid architecture.

The initial deployment will use a 4B text/instruct model, but the Local AI service will be designed so a Vision-Language Model can be added later. No vision model needs to consume resources initially.

### D007
Decision 7 confirmed: Option C — Adaptive model loading/unloading.

The Local AI service will keep the 4B model loaded during active use and automatically unload it after an idle period. I suggest 15 minutes as the default, configurable later in the Local AI server configuration.

### D008
Decision 8 confirmed: Option C — configurable embedding providers.

The initial deployment will use a small dedicated local embedding model, while the Local AI service will expose a provider/model abstraction so the embedding model can be replaced later without redesigning RAG or Qdrant.

### D009
Decision 9 confirmed: Option C — Hybrid tenant-aware RAG isolation.

Qdrant will use mandatory access metadata and filtered retrieval. The Local AI API will not permit an unrestricted RAG query when tenant/access scope is required.

### D010
Decision 10 confirmed: Option C — Network restriction + API key + TLS.

Only the AI Gateway will be exposed to the private network. llama.cpp and Qdrant stay internal/localhost-only, and direct access to them will not be permitted from PDMS or other clients.

### D011
Decision 11 confirmed: Option C — Hybrid document extraction/OCR.

The standalone Local AI server will use native extraction whenever possible, PaddleOCR for scanned/image documents, and Tesseract as a fallback. OCR and LLM inference will be resource-controlled independently.

### D012
Decision 12 confirmed: Option C — Temporary processing with configurable retention.

Default will be delete immediately after successful processing/indexing. Retention can be configured later for troubleshooting, while PDMS remains the authoritative document repository.

### D013
Decision 13 confirmed: Option C — Version-aware RAG indexing.

Each document will have a stable external ID plus revision information. Normal RAG retrieval will use only the current active revision, preventing expired or superseded documents from contaminating answers. Older revisions can remain available only when explicitly requested.

### D014
Decision 14 confirmed: Option C — Grounded hybrid answers.

The Local AI server will have two distinct modes: RAG/document mode, where answers must be supported by retrieved document evidence with source/page references, and general AI mode, where the 4B model can use its general knowledge. If RAG evidence is insufficient, it must report that rather than fabricate an answer.

### D015
Decision 15 confirmed: Option C — Standalone Web Admin + CLI/configuration.

The Web Admin will be a separate Local AI management interface, not part of PDMS. CLI/systemd/configuration tools remain available for recovery and automation.

### D016
Decision 16 confirmed: Option C — Curated model catalog + custom/manual GGUF support.

No automatic model replacement or download. The administrator remains in control of model installation, validation, activation and removal.

### D017
Decision 17 confirmed: Option C — Task-based model profiles with automatic capability detection.

That is a useful addition. The administrator should not have to manually determine what a newly downloaded model can do.

### D018
Decision 18 confirmed: Option C — Automatic quick validation + optional full benchmark.

Every installed/imported model will automatically receive a lightweight compatibility and capability test. A deeper synthetic-document benchmark will be available on demand. Benchmark results will feed the automatic profile assignment system, rather than relying only on model metadata.

### D019
Decision 19 confirmed: Option C — Intelligent recommendation with administrator control.

Local AI will automatically recommend and populate task profiles from capability tests and benchmark results, but the administrator can override every assignment. Recommendations should be recalculated after a model update or a new benchmark without silently changing an administrator's explicit override.

### D020
Decision 20 confirmed: Option C — Adaptive context management.

Each task profile will receive its own context budget based on the model's tested capability, available RAM, document size, RAG results and current system load. Large documents will use chunking/staged summarization rather than attempting to place the complete document into the 4B model's context.

### D021
Decision 21 confirmed: Option C — Priority-aware adaptive resource scheduling.

The Local AI server will prioritize interactive Chat/RAG requests over background OCR, embedding, benchmarking, and maintenance. Initial heavy LLM concurrency will be 1, with automatic throttling based on CPU, RAM, swap, and queue pressure.

### D022
Decision 22 updated and confirmed: Local account + TOTP MFA + Passkey + recovery mechanism.

The standalone Local AI Web Admin authentication will support:

### D023
Decision 23 confirmed: Option B — Passkey preferred, password + TOTP fallback.

Authentication order for the standalone Local AI Web Admin:

### D024
Decision 24 confirmed: Option B — Separate API key per client.

We will keep API authentication simpler than scoped permissions.

### D025
Decision 25 confirmed: Option C — OpenAI-compatible API + extended Local AI API.

The standalone service will expose standard endpoints for compatibility with PDMS and other applications, while advanced document/RAG functions use dedicated Local AI endpoints.

### D026
Decision 26 confirmed: Option C — LAN + VPN + optional reverse proxy.

The Local AI Web Admin will support all three access methods, but the safer modes remain the default:

### D027
Decision 27 confirmed: Option C — Proxy-aware architecture with explicit Nginx Proxy Manager (NPM) compatibility.

NPM will be treated as a first-class supported reverse-proxy configuration, alongside Nginx, Caddy and Traefik.

### D028
Decision 28 confirmed: Option B — Single installer script.

The Local AI project will provide one primary installer for a fresh Debian 13 LXC:

### D029
Decision 29 confirmed and expanded: Option C — Automatic update capability + full manual update control from Web Admin.

Automatic updating should be configurable rather than forced. The administrator must always be able to Check for Updates, review what is available, and invoke installation manually.

### D030
Decision 30 confirmed: Option C — Multi-channel notifications.

The standalone Local AI platform will support Web Admin notifications + Email + Telegram + generic Webhook, with independent event/category controls for each channel. Critical events can include service/model failures, Qdrant problems, sustained resource pressure, low disk space, authentication/security events, TLS expiry, update availability, failed updates/rollback, OCR/indexing failures, and backup/diagnostic issues.

### D031
Decision 31 confirmed and expanded: Option C — Smart backup with multiple storage destinations.

The Local AI platform will have its own backup subsystem, independent of PDMS.

### D032
Decision 32 confirmed: Option C — Policy-based multi-destination backup.

The Local AI Web Admin will support multiple independent backup policies, each with its own destination, schedule, retention, encryption, verification, retry behavior, included components, and notification rules.

### D033
Decision 33 confirmed: Option B — Encryption selectable per backup policy, using a password.

The administrator can decide whether each backup policy is encrypted. For example, Local could be unencrypted while NAS and Google Drive are encrypted.

### D034
Decision 34 confirmed: Option B — Protected local recovery copy + downloadable recovery key.

The Local AI server will maintain a strongly protected local recovery mechanism, while the administrator can download/print an offline recovery key. Accessing or exporting recovery material will require step-up authentication and will be audit logged.

### D035
Decision 35 confirmed: Option C — Automated backup verification + non-destructive restore testing.

A backup will only receive a strong Verified status after integrity, encryption, manifest, required components and Qdrant snapshot checks succeed. Test Restore will validate restoration in an isolated temporary area without affecting the running Local AI server.

### D036
Decision 36 confirmed: Option C — Detailed historical monitoring with a polished widget-style dashboard.

The Web Admin dashboard will be designed as a real AI/host operations dashboard, not just tables of Linux statistics.

### D037
Decision 37 confirmed: Option C — Fully customizable dashboard.

The Web Admin will ship with a polished default layout, while allowing drag-and-drop positioning, widget resizing, show/hide, metric selection, default time range, and Reset to Default. Layout preferences will be stored per administrator so future admin accounts can have their own dashboard.

### D038
Decision 38 confirmed: Option C — Adaptive real-time monitoring.

The dashboard will use SSE/WebSocket-style live updates where appropriate, slower refresh intervals for less volatile metrics, cached historical data, and an administrator-selectable refresh mode. High-frequency browser updates stop when the dashboard is not actively being viewed.

### D039
Decision 39 confirmed: Option C — Smart log management.

Logs will be categorized, searchable, filterable, downloadable, automatically rotated/compressed, retention-controlled by both age and disk consumption, and protected against filling the LXC storage. Security/audit records receive stronger retention protection, while secrets and sensitive document content are redacted from normal logs and diagnostic bundles.

### D040
Decision 40 confirmed: Option B — 100 GB disk.

Current target for the dedicated Local AI LXC is now:

### D041
Decision 41 confirmed: Option C — Tiered intelligent storage cleanup.

At warning/critical thresholds, Local AI can clean only disposable data and restrict storage-heavy operations. Models, Qdrant indexes, valid backups, configuration and protected audit/security data will never be silently deleted.

### D042
Decision 42 confirmed: Option C — Controlled intelligent local fallback.

Each task profile can have a primary and one or more validated fallback models. Failover remains 100% local, is capability/RAM aware, generates an audit event and notification, and uses cooldown/circuit-breaker logic to prevent restart loops. There will be no silent cloud fallback.

### D043
Decision 43 confirmed: Option C — Controlled outbound Internet access.

Inference, OCR, embeddings, Qdrant and RAG remain local. Outbound connectivity is limited to administrator-enabled functions such as model downloads, platform updates, Google Drive/OneDrive backups, email/Telegram/webhook notifications and required authentication flows. External connectivity status will be visible in Web Admin.

### D044
Decision 44 confirmed: Option C — Encrypted secrets vault with Web Admin management.

Secrets will be encrypted at rest, masked by default, excluded from logs/diagnostics, rotation-capable, and recoverable through the protected recovery mechanism. Sensitive reveal/export actions will require step-up authentication and generate audit records.

### D045
Decision 45 confirmed and expanded: Option C — Privacy-aware conversation history + intelligent caching + performance-first Web Admin.

Caching should be a first-class Local AI component, but it must be permission-aware and revision-aware. We must never return a cached answer after the underlying document, access scope, model, or RAG index has changed.

### D046
Decision 46 confirmed: Option C — Conservative semantic caching.

The cache will prioritize correctness over reuse. Exact matches can be served aggressively, while semantically similar questions are reused only when the similarity threshold is high and the authorization scope, document revisions, RAG sources/index generation, model/profile, conversation context, and relevant generation settings remain compatible.

### D047
Decision 47 confirmed: Option C — Hybrid RAM + disk cache with strict resource controls.

The cache must improve performance without competing with the 4B model, Qdrant, embeddings, OCR, or interactive requests.

### D048
Decision 48 confirmed: Option C — Adaptive Resource Manager + operating profiles.

The Local AI server will provide Eco / Balanced / Performance profiles, with Balanced as the default. The resource manager will dynamically protect the 6 GB LXC by prioritizing interactive Chat/RAG, controlling cache size, limiting concurrency, postponing OCR/indexing/benchmark work, and unloading idle models when necessary.

### D049
Decision 49 confirmed: Option C — Manual resource profiles + automatic emergency protection.

The administrator remains in control of Eco / Balanced / Performance, while a non-disableable safety layer protects the 4-vCPU / 6-GB RAM / 100-GB disk LXC from resource exhaustion. Once pressure clears, the system returns to the administrator-selected profile.

### D050
Decision 50 confirmed: Option C — Adaptive structure-aware RAG chunking.

The Local AI server will preserve page/section/table relationships, document revision and source provenance while dynamically choosing appropriate chunk sizes. Chunking will remain lightweight enough for the 4-vCPU / 6-GB environment and integrate with Qdrant, caching and revision-aware reindexing.

### D051
Decision 51 confirmed: Option C — Adaptive lightweight RAG reranking.

Qdrant remains the primary retrieval engine. A lightweight local reranker will activate only when it can materially improve retrieval quality, such as ambiguous queries, multi-document searches, or closely scored results. It will be resource-limited, benchmarked, unloadable when idle, and must never compete with the primary 4B model for critical RAM.

### D052
Decision 52 confirmed: Option C — Multilingual architecture.

The Local AI platform will support automatic language detection and configurable language packs across OCR → extraction → embeddings → Qdrant → RAG → LLM response. Initial priority can include English, Arabic, Hindi and Urdu, while Web Admin reports declared vs detected vs actually tested language capability for each installed model.

### D053
Decision 53 confirmed: Option C — Schema validation + confidence + provenance + verification.

The Local AI extraction engine will use structured schemas, field-level confidence, source/page references, conflict detection, format validation, and optional second-pass verification. Missing information must remain Not Found rather than being guessed.

### D054
Decision 54 confirmed: Option C — Defense-in-depth document isolation.

All uploaded/extracted/OCR/RAG content will be treated as untrusted data. Authorization and retrieval boundaries remain enforced by the Local AI server rather than by the LLM. Embedded document instructions cannot change permissions, execute commands, alter configuration, expose other documents, or bypass security controls.

### D055
Decision 55 confirmed: Option C — Adaptive per-client rate limiting + intelligent queue management.

Interactive Chat/RAG receives priority, while OCR, indexing, benchmarks and maintenance can be throttled or queued. Limits will be configurable per client API key and dynamically tightened during resource pressure.

### D056
Decision 56 confirmed: Option C — Verified secure logical purge with restore protection.

Deletion will cover vectors, chunks, OCR/extracted text, document-derived caches, embeddings, temporary artifacts and applicable conversation references. A verification step will confirm that deleted content can no longer be retrieved. Historical backups will use deletion/tombstone protection so a restore cannot silently resurrect deleted AI data.

### D057
Decision 57 confirmed and expanded: Option C — Multiple controlled model sources + automatic default model installation.

You should not need to manually install the initial models after deploying the Local AI server. The installer will provision a tested starter model stack automatically.

### D058
Decision 58 confirmed: Option C — Automatically download/test candidate models, but require administrator approval before activation.

The currently working model will never be silently replaced. Candidate models can be downloaded during configured maintenance periods, checksum/license/compatibility verified, benchmarked with synthetic data, and compared with the active model. Web Admin will show accuracy, speed, RAM, context, capability and stability differences before you approve the change. Rollback remains available.

### D059
Decision 59 confirmed: Option C — Protected intelligent model storage.

The system may automatically clean incomplete downloads, temporary model files and disposable caches, but it will never automatically delete active, fallback, rollback or administrator-pinned models. Disk-pressure controls and cleanup recommendations will protect the 100 GB storage.

### D060
Decision 60 confirmed: Option C — Intelligent low-impact Qdrant maintenance.

Qdrant maintenance will be health- and threshold-driven, coordinated with the adaptive resource manager, backups, indexing, and interactive workloads. Heavy optimization will be deferred during active Chat/RAG usage, with snapshots and post-maintenance verification where appropriate.

### D061
Decision 61 confirmed: Option C — Self-healing service orchestration.

The Local AI server will use systemd plus application-aware health management. It will automatically recover services with controlled backoff, validate dependencies after recovery, safely resume/retry eligible jobs, prevent crash loops, and expose recovery status/history through Web Admin. Repeated or critical failures can trigger the configured notification channels.

### D062
Decision 62 confirmed: Option C — OpenAPI + protected API testing console + integration examples.

The standalone Local AI server will expose versioned OpenAPI documentation, Swagger-style interactive documentation, a protected Web Admin API Playground, streaming tests, performance metrics, sanitized `curl` examples, and tests for Chat, RAG, embeddings, OCR, extraction and ingestion. This lets us validate the AI server independently before any future PDMS integration.

### D063
Decision 63 confirmed: Option C — Flexible TLS management.

The Local AI server will support internal TLS, administrator-provided certificates, and reverse-proxy TLS including Nginx Proxy Manager. Certificate health/expiry will be monitored, with notifications and protected private-key handling.

### D064
Decision 64 confirmed: Option C — Stable + Preview update channels.

Stable will be the default production channel. Preview can be explicitly enabled for testing newer features. Updates will include integrity verification, compatibility checks, pre/post health checks, configuration/Qdrant protection, migration handling, and safe rollback where possible. Application updates and AI model updates remain separate.

### D065
Decision 65 confirmed: Option C — Privacy-first outbound policy.

The Local AI server will operate local-first by default. Prompts, document contents, OCR text, embeddings, RAG chunks, filenames, extracted metadata, and conversation content will not leave the server. External access will be limited to explicitly enabled functions such as approved model repositories, software updates, configured cloud backups, and notification services.

### D066
Decision 66 confirmed: Option C — Managed OCR language packs.

The reason for language packs depends on the OCR engine. OCR is not like the 4B LLM: it must recognize the visual characters on scanned documents and images before the LLM can understand the text.

### D067
Decision 67 confirmed and updated: intelligent OCR detection with this fallback order:

1. light-ocr — primary OCR engine
2. Tesseract — secondary fallback
3. PaddleOCR — tertiary fallback for difficult cases

### D068
Decision 68 confirmed and expanded: Option C — Adaptive OCR quality scoring + administrator-controlled engine priority.

The OCR order will not be hard-coded. `light-ocr → Tesseract → PaddleOCR` will be the default, but you can change it from Web Admin.

### D069
Decision 69 confirmed: Option C — Automatic initial OCR benchmark + manual re-benchmark.

After installation, the Local AI server will benchmark light-ocr, Tesseract and PaddleOCR using synthetic multilingual test documents. It will measure recognition quality, field extraction success, processing time, CPU/RAM usage, failures and language performance. Web Admin can recommend an OCR priority order, but your manually configured order will never be changed automatically.

### D070
Decision 70 confirmed: Option C — Adaptive OCR preprocessing.

The OCR pipeline will automatically assess each page/image before processing and apply only the transformations that are useful: orientation correction, deskewing, perspective correction, contrast normalization, denoising, border/crop correction and controlled resizing. The original input remains unchanged.

### D071
Decision 71 confirmed: Option C — Intelligent OCR result selection and controlled merging.

When fallback OCR engines run, Local AI will compare results using multiple quality signals rather than trusting each engine's raw confidence score. High-confidence complementary information may be merged, while conflicting critical fields will be flagged for verification instead of silently selecting one.

### D072
Decision 72 confirmed: Option C — Privacy-preserving local correction feedback.

Corrections will remain entirely local and can improve OCR engine selection, document-layout handling, validation rules, and extraction quality over time. The system will not automatically retrain or fine-tune models from family documents.

### D073
Decision 73 confirmed: Option C — Hybrid automatic document-type detection + caller hint.

Local AI will independently classify documents while accepting an optional type hint from PDMS or another client. It will return the detected type, confidence, caller/AI agreement status, and conflicts without silently overriding the caller's classification.

### D074
Decision 74 confirmed: Option C — Managed, versioned document-schema library with AI-assisted field discovery.

Local AI will ship with common schemas and allow administrators to create, clone, modify, version, enable/disable and test additional schemas. AI-discovered fields remain suggestions until explicitly incorporated into a schema.

### D075
Decision 75 confirmed: Option C — Precise, permission-aware evidence citations.

I also checked the requirements from your Family Calendar project. This changes an important architectural point: the Local AI server should be designed as a general-purpose private Family AI service, not specifically as a PDMS AI backend.

### D076
Decision 76 confirmed: Option C — Hybrid application namespaces.

The Local AI server becomes a shared private AI platform while keeping each consuming application isolated. PDMS, Family Calendar, and future applications will have separate client identities, API keys, cache namespaces, RAG authorization contexts, usage statistics, rate controls, and logically isolated Qdrant data. Cross-application retrieval is denied by default.

### D077
Decision 77 confirmed: Option C — Global defaults + isolated application profiles.

The Local AI server will provide shared infrastructure while allowing PDMS, Family Calendar, and future applications to maintain their own task profiles, schemas, RAG namespaces, caching, retention, rate limits and AI behavior.

### D078
Decision 78 confirmed: Option B — Return extracted events and let Family Calendar handle conflict/change logic.

This keeps the Local AI server more generic and reusable. For Family Calendar, Local AI will focus on accurately extracting structured information and evidence rather than deciding which calendar entry should replace another.

### D079
Decision 79 confirmed: Option C — Managed schemas + caller-provided schemas.

The Local AI server will support both centrally managed/versioned schemas and application-supplied JSON schemas. This keeps the AI platform reusable across PDMS, Family Calendar, and future applications without requiring server code changes for every new extraction format.

### D080
Decision 80 confirmed: Option C — Guided Web Admin application onboarding + API/CLI support.

New applications will be onboarded through a wizard that creates an isolated application identity, API key, RAG/cache namespace, rate limits, allowed capabilities, network restrictions and integration examples. CLI/API equivalents will support automation and recovery.

### D081
Decision 81 confirmed: Option C — Per-application capability permissions.

Each application profile will control which AI services it can access. Administrative functions such as model management, backups, system configuration, secrets, updates and other applications' RAG data remain inaccessible to application API keys.

### D082
Agreed. That is simpler and better suited to your local environment.

### Decision 82 revised — Single Local AI API endpoint

### D083
Decision 83 confirmed: Option C — LAN + HTTPS/domain access simultaneously.

The Local AI Gateway will expose one consistent `/v1` API. You can use either the direct LAN address or the HTTPS reverse-proxy/domain address, while each application receives its own API key.

### D084
Decision 84 confirmed: Option C — API key + optional source IP/subnet allowlist.

Each application will use the same Local AI `/v1` endpoint but receive its own API key. An administrator can optionally restrict that key to specific IP addresses or subnets. Trusted-proxy handling will prevent spoofed forwarded addresses when Nginx Proxy Manager is used.

### D085
Decision 85 confirmed: Option A — One active API key per application.

Each registered application—PDMS, Family Calendar, or a future application—will have one active API key. Creating/replacing the key immediately invalidates the previous key. Web Admin will clearly warn that rotation can interrupt the client until its configuration is updated.

### D086
Decision 86 confirmed: Option C — Optional API-key expiration per application.

Default can remain Never Expire, while individual applications can use a configured expiration date. Web Admin will show expiry status and warnings before expiration through enabled notification channels.

### D087
Decision 87 confirmed: Option C — Full Local AI Workspace.

The standalone server will include both Web Admin and a fast AI Workspace for Chat, RAG/document Q&A, temporary uploads, OCR/extraction testing, model/profile selection, streaming responses, citations, cache status, performance information, and privacy-aware conversation history.

### D088
Decision 88 confirmed: Option C — Multi-user AI Workspace with role-based access.

The Local AI platform will separate system administration from normal AI usage. Additional family/workspace users can be created later without receiving access to API keys, secrets, backups, updates, Qdrant administration, model installation, or server configuration.

### D089
Decision 89 confirmed: Option C — Password + optional TOTP + optional Passkey for Workspace users.

Administrators will retain stronger MFA requirements and step-up authentication. Regular Workspace users can use passwords, TOTP and passkeys according to administrator policy, with session revocation, lockout/rate limiting and authentication auditing.

### D090
Decision 90 confirmed: Option C — Role + explicit application/RAG namespace access.

Workspace authentication and document authorization will remain separate. Users only retrieve information from explicitly authorized namespaces/scopes, while requests originating from applications such as PDMS continue to use the application's supplied authorization context.

### D091
Decision 91 confirmed: Option C — Temporary by default + explicit Save to Workspace.

Direct Workspace uploads will be temporary by default, with configurable automatic expiry and cleanup. Users can explicitly save selected documents for persistent RAG use within their authorized Workspace namespace. Temporary uploads will not silently become permanent AI storage.

### D092
Decision 92 confirmed: Option C — Controlled Workspace sharing with user/group permissions.

Saved Workspace documents will be Private by default. Sharing can be granted to selected users/groups, and the same authorization will apply to RAG retrieval, semantic search, citations, conversation access, and caches. Permission changes will invalidate affected authorization-sensitive cache entries. Application namespaces such as PDMS remain protected from Workspace sharing.

### D093
Decision 93 confirmed: Option C — Global Workspace storage limit + configurable per-user/group quotas.

Workspace storage will have its own controlled allocation within the 100 GB Local AI disk, with configurable quotas for individual users and groups. Models, Qdrant, cache, temporary files, logs, backups and Workspace documents will be tracked separately. Critical system storage always takes priority over new Workspace uploads.

### D094
Decision 94 confirmed: Option C — Version-aware Workspace documents with user confirmation.

Potential revisions will be detected using content fingerprints, metadata, filenames and similarity. The system will not automatically replace documents. Once confirmed as a revision, normal RAG uses only the active version while authorized users can still access previous revisions.

### D095
Decision 95 confirmed: Option C — Hybrid, permission-aware Workspace search.

Search will combine exact/keyword matching, metadata filtering, and Qdrant semantic search. Exact identifiers, dates, filenames, and document numbers will favor deterministic matching, while natural-language searches can use embeddings. All results remain constrained by user/application permissions and active document revisions.

### D096
Decision 96 confirmed: Option C — Intelligent, configurable search-result ranking.

Hybrid search will combine exact matches, metadata, semantic relevance, active revision, source quality, and adaptive reranking. Application profiles can tune ranking behavior without requiring separate search infrastructure.

### D097
Decision 97 confirmed: Option C — Explicit, user-controlled local memory.

Workspace memory will be separate from RAG, conversation history, and query cache. It remains per-user, local, permission-aware, reviewable/editable/deletable, and disabled for automatic extraction from sensitive documents. PDMS and Family Calendar API requests will not automatically receive Workspace memories.

### D098
Decision 98 confirmed: Option C — Structured, privacy-preserving local feedback and quality analytics.

Feedback will help identify weak models, OCR engines, retrieval configurations, cache problems and performance issues. It can influence recommendations, but it will not automatically retrain models, switch production models, or change security settings.

### D099
Decision 99 confirmed: Option C — Risk-aware adaptive verification.

We have covered most of the architecture. I estimate about 8–10 important decisions remain before the specification is complete enough to generate the master build prompt.

### D100
Decision 100 confirmed: Option C — Baseline + hardware-calibrated performance targets.

The installation will establish a synthetic performance baseline for the actual Proxmox/LXC hardware. Future application/model updates can be compared against it to detect regressions in TTFT, tokens/sec, OCR, embeddings, RAG retrieval, cache performance, API latency and resource consumption.

### D101
Decision 101 confirmed: Option C — Persistent, resumable job queue.

OCR, embeddings, indexing, backups, benchmarks and maintenance jobs will persist across service/LXC restarts. Safe checkpoints, retry limits and duplicate-prevention will be built in, while interactive Chat/RAG retains priority.

### D102
Decision 102 confirmed and expanded: Option C — Modern customizable UI with advanced theming.

The Local AI platform specification will include a dedicated Appearance & Branding system rather than only Light/Dark mode.

### D103
Decision 103 confirmed: Option C — Translation-ready multilingual UI.

Initial release will include English + Arabic, with complete RTL handling. The UI architecture will use language packs so Hindi, Urdu and additional languages can be added later without redesign. Language selection will be per user, while multilingual OCR/document processing remains independently configurable.

### D104
Decision 104 confirmed: Option C — Unified Local AI web service, with your additional requirement that Workspace, Admin, and Documentation are first-class sections of the authenticated web panel.

After login, the main navigation will provide:

### D105
Decision 105 confirmed: Option C — Secure browser-based first-run setup wizard.

There will be no default administrator password. Installation generates a short-lived, one-time setup code. The browser wizard configures the administrator, Passkey/TOTP, recovery codes, networking/TLS, starter models, OCR engines, performance calibration and initial recovery settings.

### D106
Decision 106 confirmed: Option C — Comprehensive document ingestion.

Local AI will use native/structured parsers first and invoke OCR only when required. Supported categories will include PDF, Office/OpenDocument files, images, spreadsheets, presentations, text/Markdown, HTML/JSON/XML, ICS, email formats, and securely controlled ZIP archives. Archive extraction will include decompression-bomb, nesting, executable, size and resource protections.

### D107
Decision 107 confirmed: Option C — Layered, configurable upload protection.

Local AI will validate every upload before parsing, OCR, extraction, or indexing. Malware scanning will be configurable globally and per application, with quarantine, archive protections, resource limits, audit logging, and a design appropriate for the 4-vCPU / 6-GB RAM LXC.

### D108
Decision 108 confirmed: Option C — SQLite WAL initially with a clean migration path.

SQLite will hold platform/application state while Qdrant remains dedicated to vectors and RAG. The design will use transactions, migrations, integrity checks, backups and an abstraction layer so PostgreSQL can be introduced later if scale requires it. No unnecessary Redis/PostgreSQL services for the initial deployment.

### D109
Decision 109 confirmed: Option C — Full automated release gate.

A build cannot be promoted when critical security, privacy, permission-isolation, data-integrity, backup/restore, migration, or recovery tests fail. Automated testing will use synthetic documents rather than family data.

### D110
Decision 110 confirmed: Option C — Controlled Git-based release workflow, with documentation treated as a required product feature and release criterion, not an afterthought.

The documentation system will include:
