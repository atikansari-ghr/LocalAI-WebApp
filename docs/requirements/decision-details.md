# Recovered Local AI decision details

Historical reference, recovered 2026-10-18 from conversation 6ad32eec-a2d0-83ed-85ff-ffdfa3ab0a52. Later decisions and LOCAL_AI_MASTER_BUILD_PROMPT.md precedence rules override superseded examples. Upstream claims in the conversation require independent verification. PDMS-specific work is out of scope.

## D001

**Decision 1 confirmed: Option B — Dedicated Local AI LXC.**

This is the stronger architecture. PDMS remains on its existing LXC, while inference gets isolated CPU/RAM resources.

### Proposed topology

```text
┌─────────────────────────────┐
│ PDMS LXC                    │
│ Existing 6 GB RAM           │
│                             │
│ Django / PostgreSQL         │
│ OCR / ClamAV / Workers      │
│ Document Storage            │
└──────────────┬──────────────┘
               │
        Private LAN API
               │
               ▼
┌─────────────────────────────┐
│ Local AI LXC                │
│ Debian 13                   │
│ llama.cpp Server            │
│ 4B GGUF Q4 model            │
│ OpenAI-compatible API       │
└─────────────────────────────┘
```

This also matches the project's planned architecture, which explicitly allows the future AI endpoint to run on another local server. :chatgpt-content-reference{index="0"}

I would keep **all normal OCR in PDMS**. The AI LXC receives only the text/content required for an authorized AI job.



## D002

**Decision 2 confirmed: Option B — Dedicated AI LXC with 6 GB RAM / 4 vCPU.**

Initial target:

```text
Local AI LXC
├── OS: Debian 13
├── CPU: 4 vCPU
├── RAM: 6 GB
├── Model class: 4B
├── Quantization: GGUF Q4-class
├── Inference: CPU
├── Runtime: llama.cpp server
├── Concurrent inference: 1
└── Access: Private network from PDMS
```

This keeps the AI workload isolated from the PDMS application and its OCR/processing workers.



## D003

**Decision 3 confirmed: Option C — Full Local AI + RAG from the initial AI implementation.**

The dedicated AI LXC will eventually provide the complete intelligence layer envisioned in the PDMS specification: model-assisted extraction/classification, document chat, embeddings and semantic similarity. :chatgpt-content-reference{index="0"}

### Planned AI capabilities

The design will include one permission-aware pipeline:

```text
PDMS
 │
 ├─ Document OCR text
 │
 ├─ Confirmed metadata
 │
 └─ Current user permissions
        │
        ▼
 Local AI Gateway
        │
        ├─ 4B LLM
        ├─ Embedding model
        ├─ RAG retrieval
        └─ Vector index
             │
             ▼
      AI capabilities
        ├─ Classification
        ├─ Metadata extraction
        ├─ OCR cleanup
        ├─ Tag suggestions
        ├─ Filename/folder suggestions
        ├─ Summaries
        ├─ Single-document Q&A
        ├─ Multi-document Q&A
        ├─ Semantic search
        ├─ Similar documents
        └─ Cross-document comparison
```

A critical requirement will be that **RAG retrieval itself is permission-aware**. A user must never receive AI answers, citations, embeddings-derived results, snippets, document names, or even counts from documents they cannot currently access. This follows the existing requirement that AI retrieval preserve document permissions. :chatgpt-content-reference{index="1"}

I would also require answers to provide **document citations/source links inside PDMS**, rather than letting the 4B model answer from memory when the question concerns family documents.



## D004

**Decision 4 confirmed: Option A — Qdrant on the dedicated Local AI LXC.**

The standalone AI server is now shaping up as:

```text
Local AI LXC
Debian 13
4 vCPU / 6 GB RAM
│
├── llama.cpp
│   └── 4B GGUF LLM
│
├── Embedding Model
│
├── Qdrant
│   └── Persistent Vector Database
│
├── RAG/API Service
│
└── systemd services
```

PDMS remains completely separate. No PDMS changes are part of this build.



## D005

**Decision 5 confirmed: Option C — support both text/API ingestion and direct file ingestion.**

For PDMS, **text/API ingestion remains the preferred path**, while direct file ingestion makes the Local AI platform independently testable and reusable.

```text
                    LOCAL AI LXC
                 Debian 13 / 6 GB
                         │
          ┌──────────────┴──────────────┐
          │                             │
   Text/API ingestion             File ingestion
          │                    PDF/Image/Office
          │                             │
          │                     Extract/OCR locally
          │                             │
          └──────────────┬──────────────┘
                         ▼
                 Normalize content
                         │
                    Chunk text
                         │
                 Embedding model
                         │
                      Qdrant
                         │
                       RAG
                         │
                     4B LLM
                         │
                   REST API response
```

Direct uploads should be processed in temporary working storage by default. We don't need the AI server to become a second permanent document-management system.



## D006

**Decision 6 confirmed: Option C — Hybrid architecture.**

The initial deployment will use a **4B text/instruct model**, but the Local AI service will be designed so a Vision-Language Model can be added later. No vision model needs to consume resources initially.

### Current Local AI design

```text
Dedicated Local AI LXC
Debian 13
4 vCPU / 6 GB RAM
│
├── AI API / RAG Gateway
│
├── llama.cpp
│   └── Primary 4B Text/Instruct GGUF model
│
├── Embedding Model
│
├── Qdrant
│   └── Vectors + RAG chunks
│
├── Document Ingestion
│   ├── Text/API
│   └── Direct files
│       ├── PDF
│       ├── Images
│       └── Office documents
│
└── Future
    └── Optional Vision-Language Model
```

The API should hide the underlying model from PDMS. That is important: later we can replace the 4B model, change quantization, or add vision without requiring PDMS to understand the inference engine.



## D007

**Decision 7 confirmed: Option C — Adaptive model loading/unloading.**

The Local AI service will keep the 4B model loaded during active use and automatically unload it after an idle period. I suggest **15 minutes as the default**, configurable later in the Local AI server configuration.

This is particularly appropriate for the 6 GB LXC because Qdrant, the embedding service, API gateway and document-processing components can remain available while the larger LLM releases its memory.



## D008

**Decision 8 confirmed: Option C — configurable embedding providers.**

The initial deployment will use a **small dedicated local embedding model**, while the Local AI service will expose a provider/model abstraction so the embedding model can be replaced later without redesigning RAG or Qdrant.

This gives us three independently manageable layers:

```text
4B Instruct LLM
   └─ Chat / reasoning / extraction / summaries

Small Embedding Model
   └─ Document & query vectors

Qdrant
   └─ Vector storage / similarity retrieval
```

The embedding service can remain loaded while the larger 4B LLM follows the **15-minute adaptive unload** policy.



## D009

**Decision 9 confirmed: Option C — Hybrid tenant-aware RAG isolation.**

Qdrant will use mandatory access metadata and filtered retrieval. The Local AI API will not permit an unrestricted RAG query when tenant/access scope is required.

One additional principle: **PDMS remains the authority for permissions**. The AI server will enforce the scope supplied to it, but it will not independently try to recreate PDMS's user/role system.



## D010

**Decision 10 confirmed: Option C — Network restriction + API key + TLS.**

Only the AI Gateway will be exposed to the private network. **llama.cpp and Qdrant stay internal/localhost-only**, and direct access to them will not be permitted from PDMS or other clients.



## D011

**Decision 11 confirmed: Option C — Hybrid document extraction/OCR.**

The standalone Local AI server will use native extraction whenever possible, PaddleOCR for scanned/image documents, and Tesseract as a fallback. OCR and LLM inference will be resource-controlled independently.



## D012

**Decision 12 confirmed: Option C — Temporary processing with configurable retention.**

Default will be **delete immediately after successful processing/indexing**. Retention can be configured later for troubleshooting, while PDMS remains the authoritative document repository.



## D013

**Decision 13 confirmed: Option C — Version-aware RAG indexing.**

Each document will have a stable external ID plus revision information. Normal RAG retrieval will use only the **current active revision**, preventing expired or superseded documents from contaminating answers. Older revisions can remain available only when explicitly requested.



## D014

**Decision 14 confirmed: Option C — Grounded hybrid answers.**

The Local AI server will have two distinct modes: **RAG/document mode**, where answers must be supported by retrieved document evidence with source/page references, and **general AI mode**, where the 4B model can use its general knowledge. If RAG evidence is insufficient, it must report that rather than fabricate an answer.



## D015

**Decision 15 confirmed: Option C — Standalone Web Admin + CLI/configuration.**

The Web Admin will be a **separate Local AI management interface**, not part of PDMS. CLI/systemd/configuration tools remain available for recovery and automation.



## D016

**Decision 16 confirmed: Option C — Curated model catalog + custom/manual GGUF support.**

No automatic model replacement or download. The administrator remains in control of model installation, validation, activation and removal.



## D017

**Decision 17 confirmed: Option C — Task-based model profiles with automatic capability detection.**

That is a useful addition. The administrator should **not have to manually determine what a newly downloaded model can do**.

When a model is downloaded, imported, or selected, the Local AI system will run a **Model Capability Detection** process.

```text
Download / Import Model
          ↓
Read model metadata
          ↓
Check architecture + tokenizer
          ↓
Inspect declared capabilities
          ↓
Run lightweight capability tests
          ↓
Generate capability profile
          ↓
Auto-populate supported task profiles
```

For example, the Web Admin could show:

| Capability | Detection | Profile |
|---|---|---|
| Chat / Instruct | ✓ Supported | Auto-enabled |
| RAG Q&A | ✓ Supported | Auto-enabled |
| Document extraction | ✓ Supported | Auto-enabled |
| Structured JSON | ✓ Supported | Auto-enabled |
| Classification | ✓ Supported | Auto-enabled |
| Summarization | ✓ Supported | Auto-enabled |
| OCR-text cleanup | ✓ Supported | Auto-enabled |
| Tool/function calling | ✓ Supported | Available |
| Vision | ✕ Not supported | Disabled |
| Embeddings | ✕ Not supported | Dedicated embedding model |
| Multilingual | ✓ Tested | Enabled |

I would make detection **evidence-based rather than relying only on the model filename**. The server should combine model metadata with small local validation tests. Results should distinguish **Declared**, **Detected**, **Tested**, **Failed**, and **Unknown** capabilities.

The administrator can override an assignment, but the UI should warn when assigning a model to a profile it failed or wasn't tested for.



## D018

**Decision 18 confirmed: Option C — Automatic quick validation + optional full benchmark.**

Every installed/imported model will automatically receive a lightweight compatibility and capability test. A deeper synthetic-document benchmark will be available on demand. Benchmark results will feed the **automatic profile assignment system**, rather than relying only on model metadata.



## D019

**Decision 19 confirmed: Option C — Intelligent recommendation with administrator control.**

Local AI will automatically recommend and populate task profiles from capability tests and benchmark results, but the administrator can override every assignment. Recommendations should be recalculated after a model update or a new benchmark without silently changing an administrator's explicit override.



## D020

**Decision 20 confirmed: Option C — Adaptive context management.**

Each task profile will receive its own context budget based on the model's tested capability, available RAM, document size, RAG results and current system load. Large documents will use chunking/staged summarization rather than attempting to place the complete document into the 4B model's context.



## D021

**Decision 21 confirmed: Option C — Priority-aware adaptive resource scheduling.**

The Local AI server will prioritize interactive Chat/RAG requests over background OCR, embedding, benchmarking, and maintenance. Initial heavy LLM concurrency will be **1**, with automatic throttling based on CPU, RAM, swap, and queue pressure.



## D022

**Decision 22 updated and confirmed: Local account + TOTP MFA + Passkey + recovery mechanism.**

The standalone Local AI Web Admin authentication will support:

- **Local administrator account** with strong password hashing.
- **TOTP MFA** using standard authenticator apps.
- **Passkeys/WebAuthn** using device biometrics, Windows Hello, security keys, etc.
- **Recovery codes**, generated once and stored securely.
- Administrator-controlled passkey enrollment/revocation and TOTP reset.
- Rate limiting, failed-login protection, session timeout, secure cookies, CSRF protection, and authentication audit logs.
- Recovery must **not bypass security silently**; recovery actions are logged.
- PDMS API authentication remains completely separate from Web Admin authentication.

I would also design it so additional administrator accounts can be supported later without changing the authentication architecture.



## D023

**Decision 23 confirmed: Option B — Passkey preferred, password + TOTP fallback.**

Authentication order for the standalone Local AI Web Admin:

```text
Preferred
   └── Passkey / WebAuthn
        ├── Windows Hello
        ├── Device biometrics
        └── Hardware security key

Fallback
   └── Local username/password
          + TOTP

Emergency Recovery
   └── Single-use recovery codes
```

Security-sensitive actions such as generating API credentials, removing models, changing TLS/security settings, deleting Qdrant collections, or resetting MFA can require **step-up authentication** even when the administrator already has an active session.



## D024

**Decision 24 confirmed: Option B — Separate API key per client.**

We will keep API authentication simpler than scoped permissions.

Each connecting application receives an independent API key:

```text
PDMS              → API Key #1
Future Mobile App → API Key #2
Testing Client    → API Key #3
Other Local App   → API Key #4
```

Each key can be individually created, named, rotated, disabled, and revoked. The Web Admin should record creation date, last-used time, source IP, and usage statistics. The full secret should only be displayed when it is initially generated.

The previously selected protections still apply: **HTTPS/TLS + permitted network sources + client-specific API key**.



## D025

**Decision 25 confirmed: Option C — OpenAI-compatible API + extended Local AI API.**

The standalone service will expose standard endpoints for compatibility with PDMS and other applications, while advanced document/RAG functions use dedicated Local AI endpoints.

```text
Standard compatibility
/v1/models
/v1/chat/completions
/v1/embeddings

Local AI extensions
/api/documents/ingest
/api/documents/{id}/reindex
/api/documents/{id}
/api/rag/query
/api/ocr
/api/models/capabilities
/api/models/benchmark
/api/health
/api/system/status
```

This also means another application that already supports an OpenAI-compatible endpoint can potentially use the Local AI server without needing the document-specific API.



## D026

**Decision 26 confirmed: Option C — LAN + VPN + optional reverse proxy.**

The Local AI Web Admin will support all three access methods, but the safer modes remain the default:

```text
Local LAN ──────────────► Web Admin
VPN / NetBird ──────────► Web Admin
Reverse Proxy ──────────► Web Admin (optional)
                              │
                              ├── Passkey preferred
                              ├── Password + TOTP fallback
                              ├── Recovery mechanism
                              ├── Rate limiting
                              └── TLS
```

The reverse-proxy option will be **disabled by default**. Enabling it should show a security warning and require HTTPS. Qdrant and llama.cpp will remain internal regardless of how the Web Admin is exposed.



## D027

**Decision 27 confirmed: Option C — Proxy-aware architecture with explicit Nginx Proxy Manager (NPM) compatibility.**

NPM will be treated as a **first-class supported reverse-proxy configuration**, alongside Nginx, Caddy and Traefik.

For NPM, the Local AI documentation/configuration should cover HTTPS/WebSocket support where required, forwarded headers, trusted-proxy configuration, large upload limits for document ingestion, appropriate AI/RAG timeout values, streaming responses, and optional access restrictions. **Qdrant and llama.cpp must never be exposed through NPM**—only the AI API and, optionally, Web Admin.



## D028

**Decision 28 confirmed: Option B — Single installer script.**

The Local AI project will provide one primary installer for a fresh **Debian 13 LXC**:

```bash
curl -fsSL https://<install-source>/install.sh | sudo bash
```

It should automatically detect the environment, validate the 4-vCPU/6-GB target, install dependencies and services, create required directories, configure systemd, initialize Qdrant, install the AI Gateway/Web Admin, configure OCR/extraction components, apply security defaults, and run post-install health checks.

The script should still be **safe to rerun after a failed installation**. Completed components should be detected rather than unnecessarily destroyed/reinstalled.

Model installation can then be handled from the Web Admin's Model Manager rather than forcing a large model download during the base installation.



## D029

**Decision 29 confirmed and expanded: Option C — Automatic update capability + full manual update control from Web Admin.**

Automatic updating should be configurable rather than forced. The administrator must always be able to **Check for Updates**, review what is available, and invoke installation manually.

### Web Admin → System Management

I’ll include a dedicated system-management area covering:

| Area | Functions |
|---|---|
| **Updates** | Current version, latest version, Check for Updates, available updates, release notes, security/update classification, Install Update, update history |
| **Update Policy** | Automatic/manual mode, maintenance window, update notifications, automatic security updates toggle |
| **Safe Upgrade** | Pre-update health check, configuration backup, Qdrant safety check, disk-space check, integrity verification, migrations, post-update validation |
| **Rollback** | Preserve previous application release/configuration and automatically roll back after critical failure where technically safe |
| **Models** | Model updates shown separately; **never automatically replace the active model** |
| **Host Monitoring** | CPU utilization/load, RAM, swap, disk usage, disk I/O, uptime, network activity, temperatures where exposed by the LXC, process/service status |
| **AI Monitoring** | Loaded model, model RAM, inference activity, tokens/sec, time-to-first-token, context usage, active requests, queue depth, failures |
| **RAG/Qdrant** | Health, collections, vectors, indexed documents/chunks, storage usage, indexing queue and errors |
| **Services** | AI Gateway, Web Admin, llama.cpp, Qdrant, embedding service, OCR workers and background scheduler status |
| **Logs** | Application, API, authentication, model, RAG, OCR, Qdrant integration, update and system-service logs |
| **Diagnostics** | Run diagnostics, service checks, ports, dependencies, permissions, storage, model loading, API connectivity, Qdrant connectivity and OCR tests |
| **Diagnostic Bundle** | Generate downloadable support bundle with sensitive values/API keys/passwords/tokens automatically redacted |

The dashboard should also use clear health states such as **Healthy / Warning / Critical / Offline**, rather than requiring the administrator to interpret raw Linux metrics.

For automatic updates, I will require **pre-update validation and post-update health checks**. An update must not delete Qdrant data, models, API keys, administrator authentication configuration, TLS configuration, or Local AI settings.



## D030

**Decision 30 confirmed: Option C — Multi-channel notifications.**

The standalone Local AI platform will support **Web Admin notifications + Email + Telegram + generic Webhook**, with independent event/category controls for each channel. Critical events can include service/model failures, Qdrant problems, sustained resource pressure, low disk space, authentication/security events, TLS expiry, update availability, failed updates/rollback, OCR/indexing failures, and backup/diagnostic issues.

Notification credentials will be encrypted at rest where feasible, masked in the UI/logs, and each provider will have a **Test Notification** function.



## D031

**Decision 31 confirmed and expanded: Option C — Smart backup with multiple storage destinations.**

The Local AI platform will have its **own backup subsystem**, independent of PDMS.

### Supported backup destinations

| Destination | Configuration & validation |
|---|---|
| **Local storage** | Path, permissions, free space, writable test |
| **NAS** | Host/path, authentication where required, reachability, writable test, capacity/free-space check |
| **NFS share** | Server/export/mount options, connectivity, mount test, read/write test, available storage |
| **SMB/CIFS share** | Server/share, credentials/domain, SMB version, connectivity, authentication, read/write test, available storage |
| **Google Drive** | Account authorization, destination folder, connectivity, quota/free-space check, upload/download test |
| **Microsoft OneDrive** | Account authorization, destination folder, connectivity, quota/free-space check, upload/download test |

Each destination will have **Test Configuration** before it can be enabled. The test should verify DNS/network reachability, authentication, path/folder availability, read/write capability, available capacity/quota and a small upload/download/delete cycle where applicable.

Backup jobs will also have **verification after backup**, history, duration, size, destination, status and diagnostic details.

Credentials/tokens must never appear in normal logs or diagnostic bundles.



## D032

**Decision 32 confirmed: Option C — Policy-based multi-destination backup.**

The Local AI Web Admin will support multiple independent backup policies, each with its own destination, schedule, retention, encryption, verification, retry behavior, included components, and notification rules.

A failed destination should **not block other backup policies**. For example, if Google Drive is unreachable, the local and NAS backup policies should still complete normally.



## D033

**Decision 33 confirmed: Option B — Encryption selectable per backup policy, using a password.**

The administrator can decide whether each backup policy is encrypted. For example, Local could be unencrypted while NAS and Google Drive are encrypted.

For security, the backup password should **not simply be stored in recoverable plaintext**. Instead, we can provide controlled recovery.

### Password recovery design

When encryption is enabled, the system should offer:

- Administrator enters and confirms the backup encryption password.
- Backup archives are encrypted using a strong password-based encryption scheme.
- The password can optionally be saved in the Local AI secure credential store.
- Saved credentials are encrypted using a separate **system recovery key**.
- Web Admin normally shows only `••••••••`, never the actual password.
- A **Reveal/Recover Password** operation requires step-up authentication using the administrator's passkey or password + TOTP.
- Administrator can export/print a separate **Recovery Key** and store it offline.
- Recovery key must not be stored inside the backup archive it protects.
- Password changes apply to **new backups**; existing encrypted backups retain their original encryption information.
- Restore wizard identifies which key/password is required for each backup.

This gives you password recovery without weakening the backup by storing its password directly beside it.



## D034

**Decision 34 confirmed: Option B — Protected local recovery copy + downloadable recovery key.**

The Local AI server will maintain a strongly protected local recovery mechanism, while the administrator can download/print an offline recovery key. Accessing or exporting recovery material will require **step-up authentication** and will be audit logged.

If both the LXC and offline recovery key are lost, encrypted backups may become unrecoverable; the Web Admin documentation and backup-health checks should make this clear.



## D035

**Decision 35 confirmed: Option C — Automated backup verification + non-destructive restore testing.**

A backup will only receive a strong **Verified** status after integrity, encryption, manifest, required components and Qdrant snapshot checks succeed. **Test Restore** will validate restoration in an isolated temporary area without affecting the running Local AI server.



## D036

**Decision 36 confirmed: Option C — Detailed historical monitoring with a polished widget-style dashboard.**

The Web Admin dashboard will be designed as a real **AI/host operations dashboard**, not just tables of Linux statistics.

### Dashboard design

The main dashboard should include visually distinct, responsive widgets such as:

- **Gauge meters:** CPU, RAM, swap, disk, model memory/context utilization.
- **Temperature gauges:** CPU/system temperature when Proxmox/LXC exposes valid sensor data; otherwise clearly show `Unavailable`.
- **Live status cards:** llama.cpp, Qdrant, AI Gateway, embedding service, OCR workers, scheduler, backup and update service.
- **Bar/line charts:** AI requests, tokens, latency, tokens/sec, API-client usage, RAG activity, OCR/indexing jobs and errors over selectable time ranges.
- **AI model widget:** active model, profile, quantization, loaded/unloaded state, RAM consumption, context utilization and inference speed.
- **Queue widget:** running, waiting, paused and failed jobs.
- **Storage widget:** system disk, Qdrant, models, logs, backups and temporary files.
- **Security widget:** recent admin logins, failed attempts, API-client activity, TLS status and certificate expiry.
- **Backup widget:** last backup, next scheduled backup, destination health, verification and latest restore-test result.
- **Update widget:** installed version, available version, last check and update status.
- **Alerts widget:** Healthy / Warning / Critical conditions with drill-down diagnostics.

The interface can use **green/amber/red health states and multiple chart colors** where they convey status or distinguish metrics, while remaining readable in both light and dark themes.

Historical ranges should include **Live, 1 hour, 24 hours, 7 days, 30 days and custom range**.



## D037

**Decision 37 confirmed: Option C — Fully customizable dashboard.**

The Web Admin will ship with a polished default layout, while allowing **drag-and-drop positioning, widget resizing, show/hide, metric selection, default time range, and Reset to Default**. Layout preferences will be stored per administrator so future admin accounts can have their own dashboard.



## D038

**Decision 38 confirmed: Option C — Adaptive real-time monitoring.**

The dashboard will use **SSE/WebSocket-style live updates where appropriate**, slower refresh intervals for less volatile metrics, cached historical data, and an administrator-selectable refresh mode. High-frequency browser updates stop when the dashboard is not actively being viewed.



## D039

**Decision 39 confirmed: Option C — Smart log management.**

Logs will be categorized, searchable, filterable, downloadable, automatically rotated/compressed, retention-controlled by both age and disk consumption, and protected against filling the LXC storage. Security/audit records receive stronger retention protection, while secrets and sensitive document content are redacted from normal logs and diagnostic bundles.



## D040

**Decision 40 confirmed: Option B — 100 GB disk.**

Current target for the dedicated Local AI LXC is now:

```text
OS:      Debian 13
CPU:     4 vCPU
RAM:     6 GB
Disk:    100 GB
Runtime: llama.cpp
LLM:     4B GGUF, initially Q4-class
Vector:  Qdrant
Access:  LAN + VPN + optional NPM-compatible reverse proxy
```

Storage monitoring will distinguish **OS/application, models, Qdrant, temporary processing, logs, updates/rollback, and local backups**, with configurable warning/critical thresholds.



## D041

**Decision 41 confirmed: Option C — Tiered intelligent storage cleanup.**

At warning/critical thresholds, Local AI can clean only disposable data and restrict storage-heavy operations. **Models, Qdrant indexes, valid backups, configuration and protected audit/security data will never be silently deleted.**



## D042

**Decision 42 confirmed: Option C — Controlled intelligent local fallback.**

Each task profile can have a primary and one or more validated fallback models. Failover remains **100% local**, is capability/RAM aware, generates an audit event and notification, and uses cooldown/circuit-breaker logic to prevent restart loops. There will be **no silent cloud fallback**.



## D043

**Decision 43 confirmed: Option C — Controlled outbound Internet access.**

Inference, OCR, embeddings, Qdrant and RAG remain local. Outbound connectivity is limited to administrator-enabled functions such as model downloads, platform updates, Google Drive/OneDrive backups, email/Telegram/webhook notifications and required authentication flows. External connectivity status will be visible in Web Admin.



## D044

**Decision 44 confirmed: Option C — Encrypted secrets vault with Web Admin management.**

Secrets will be encrypted at rest, masked by default, excluded from logs/diagnostics, rotation-capable, and recoverable through the protected recovery mechanism. Sensitive reveal/export actions will require step-up authentication and generate audit records.



## D045

**Decision 45 confirmed and expanded: Option C — Privacy-aware conversation history + intelligent caching + performance-first Web Admin.**

Caching should be a first-class Local AI component, but it must be **permission-aware and revision-aware**. We must never return a cached answer after the underlying document, access scope, model, or RAG index has changed.

### Cache architecture

I recommend several cache layers rather than simply caching final text:

```text
Incoming Query
     │
     ├─► Exact Query Cache ─────────────► Immediate response
     │
     ├─► Semantic Query Cache ──────────► Reuse if safely equivalent
     │
     └─► RAG Retrieval Cache
               │
               ▼
          Qdrant Retrieval
               │
               ▼
           4B Model
               │
               ▼
        Response + Sources
               │
               ▼
          Cache Result
```

For example, asking **“When does Dad's passport expire?”** twice could return the second response almost immediately if the document revision, permission scope, RAG index, task profile, model and relevant configuration are unchanged.

The cache key should therefore account for things such as `client`, tenant/access scope, normalized query, conversation context where applicable, document IDs/revisions, RAG index generation, model/profile/version and relevant generation settings.

We can also use **embedding cache, RAG retrieval cache, model/prompt-prefix cache where llama.cpp supports it, model metadata cache, Web Admin API cache, and browser-side UI caching**.

Sensitive cached data remains local. Cache contents should not be mixed between unauthorized clients/users. Document deletion, reindexing, revision changes, permission/scope changes and relevant model changes must trigger appropriate invalidation.

### Web Admin performance

The Web Admin itself will be designed for speed: route/code splitting, lazy-loaded heavy charts/log viewers, server-side pagination, cached dashboard aggregates, virtualized large log/document lists, compressed API responses where appropriate, asynchronous diagnostics, and no unnecessary dashboard polling.

The objective is that opening **Dashboard, Models, RAG, Logs, Backups, Updates and Settings feels immediate**, even while an AI job is running.

The dashboard should also expose **cache hit rate, semantic-cache hit rate, cache size, estimated latency saved, evictions and Clear Cache controls**.



## D046

**Decision 46 confirmed: Option C — Conservative semantic caching.**

The cache will prioritize correctness over reuse. Exact matches can be served aggressively, while semantically similar questions are reused only when the similarity threshold is high **and** the authorization scope, document revisions, RAG sources/index generation, model/profile, conversation context, and relevant generation settings remain compatible.

Cache invalidation will be automatic when underlying information changes.



## D047

**Decision 47 confirmed: Option C — Hybrid RAM + disk cache with strict resource controls.**

The cache must improve performance without competing with the **4B model, Qdrant, embeddings, OCR, or interactive requests**.

I’ll make caching resource-aware rather than assigning it unlimited memory. The default design will use a **small bounded RAM hot cache**, a larger disk-backed cache, automatic LRU/TTL eviction, compression where worthwhile, and adaptive throttling. If RAM pressure rises, the RAM cache should shrink/evict first rather than forcing the model or critical services into swap. Cache maintenance also stays low priority.

The Web Admin will show **RAM cache usage, disk cache usage, hit/miss rate, semantic hits, evictions, estimated latency saved, and resource pressure**, with configurable limits and Clear/Purge controls.



## D048

**Decision 48 confirmed: Option C — Adaptive Resource Manager + operating profiles.**

The Local AI server will provide **Eco / Balanced / Performance** profiles, with **Balanced as the default**. The resource manager will dynamically protect the 6 GB LXC by prioritizing interactive Chat/RAG, controlling cache size, limiting concurrency, postponing OCR/indexing/benchmark work, and unloading idle models when necessary.

The Web Admin dashboard will show the active profile, current resource pressure, throttled/paused jobs, and why the resource manager took an action.



## D049

**Decision 49 confirmed: Option C — Manual resource profiles + automatic emergency protection.**

The administrator remains in control of **Eco / Balanced / Performance**, while a non-disableable safety layer protects the **4-vCPU / 6-GB RAM / 100-GB disk** LXC from resource exhaustion. Once pressure clears, the system returns to the administrator-selected profile.



## D050

**Decision 50 confirmed: Option C — Adaptive structure-aware RAG chunking.**

The Local AI server will preserve page/section/table relationships, document revision and source provenance while dynamically choosing appropriate chunk sizes. Chunking will remain lightweight enough for the **4-vCPU / 6-GB** environment and integrate with Qdrant, caching and revision-aware reindexing.



## D051

**Decision 51 confirmed: Option C — Adaptive lightweight RAG reranking.**

Qdrant remains the primary retrieval engine. A lightweight local reranker will activate only when it can materially improve retrieval quality, such as ambiguous queries, multi-document searches, or closely scored results. It will be resource-limited, benchmarked, unloadable when idle, and must never compete with the primary 4B model for critical RAM.



## D052

**Decision 52 confirmed: Option C — Multilingual architecture.**

The Local AI platform will support automatic language detection and configurable language packs across **OCR → extraction → embeddings → Qdrant → RAG → LLM response**. Initial priority can include English, Arabic, Hindi and Urdu, while Web Admin reports **declared vs detected vs actually tested** language capability for each installed model.

Cross-language RAG will also be supported—for example, querying in English against an Arabic document.



## D053

**Decision 53 confirmed: Option C — Schema validation + confidence + provenance + verification.**

The Local AI extraction engine will use structured schemas, field-level confidence, source/page references, conflict detection, format validation, and optional second-pass verification. Missing information must remain **Not Found** rather than being guessed.



## D054

**Decision 54 confirmed: Option C — Defense-in-depth document isolation.**

All uploaded/extracted/OCR/RAG content will be treated as **untrusted data**. Authorization and retrieval boundaries remain enforced by the Local AI server rather than by the LLM. Embedded document instructions cannot change permissions, execute commands, alter configuration, expose other documents, or bypass security controls.



## D055

**Decision 55 confirmed: Option C — Adaptive per-client rate limiting + intelligent queue management.**

Interactive Chat/RAG receives priority, while OCR, indexing, benchmarks and maintenance can be throttled or queued. Limits will be configurable per client API key and dynamically tightened during resource pressure.



## D056

**Decision 56 confirmed: Option C — Verified secure logical purge with restore protection.**

Deletion will cover vectors, chunks, OCR/extracted text, document-derived caches, embeddings, temporary artifacts and applicable conversation references. A verification step will confirm that deleted content can no longer be retrieved. Historical backups will use deletion/tombstone protection so a restore cannot silently resurrect deleted AI data.



## D057

**Decision 57 confirmed and expanded: Option C — Multiple controlled model sources + automatic default model installation.**

You should **not need to manually install the initial models** after deploying the Local AI server. The installer will provision a tested starter model stack automatically.

For the **4-vCPU / 6-GB RAM** LXC, the installer should automatically select compatible lightweight models for the required roles: a **4B-class Q4 GGUF instruct model** for Chat/RAG/extraction/classification/summarization, a small multilingual embedding model for Qdrant, and a lightweight reranker compatible with the available resources. OCR components and language packs will also be installed for the initially enabled languages.

The important part is that we should **not hard-code an old model name into the design now**. At installation time, the installer can consult a signed/maintained compatibility manifest containing approved models, versions, download sources, checksums, licenses, llama.cpp compatibility and expected resource requirements. It downloads the approved defaults from Hugging Face or another configured trusted source, verifies them, runs the quick capability tests we already defined, and activates them only after successful validation.

If the preferred model cannot be downloaded or fails validation, the installer can automatically try the next **approved compatible fallback**, rather than leaving the Local AI installation unusable. It must not arbitrarily download an unknown model.

Web Admin will subsequently allow you to discover, download, import, benchmark, switch, remove and update models manually.



## D058

**Decision 58 confirmed: Option C — Automatically download/test candidate models, but require administrator approval before activation.**

The currently working model will never be silently replaced. Candidate models can be downloaded during configured maintenance periods, checksum/license/compatibility verified, benchmarked with synthetic data, and compared with the active model. Web Admin will show accuracy, speed, RAM, context, capability and stability differences before you approve the change. Rollback remains available.



## D059

**Decision 59 confirmed: Option C — Protected intelligent model storage.**

The system may automatically clean incomplete downloads, temporary model files and disposable caches, but it will **never automatically delete active, fallback, rollback or administrator-pinned models**. Disk-pressure controls and cleanup recommendations will protect the 100 GB storage.



## D060

**Decision 60 confirmed: Option C — Intelligent low-impact Qdrant maintenance.**

Qdrant maintenance will be health- and threshold-driven, coordinated with the adaptive resource manager, backups, indexing, and interactive workloads. Heavy optimization will be deferred during active Chat/RAG usage, with snapshots and post-maintenance verification where appropriate.



## D061

**Decision 61 confirmed: Option C — Self-healing service orchestration.**

The Local AI server will use systemd plus application-aware health management. It will automatically recover services with controlled backoff, validate dependencies after recovery, safely resume/retry eligible jobs, prevent crash loops, and expose recovery status/history through Web Admin. Repeated or critical failures can trigger the configured notification channels.



## D062

**Decision 62 confirmed: Option C — OpenAPI + protected API testing console + integration examples.**

The standalone Local AI server will expose versioned OpenAPI documentation, Swagger-style interactive documentation, a protected Web Admin API Playground, streaming tests, performance metrics, sanitized `curl` examples, and tests for Chat, RAG, embeddings, OCR, extraction and ingestion. This lets us validate the AI server independently before any future PDMS integration.



## D063

**Decision 63 confirmed: Option C — Flexible TLS management.**

The Local AI server will support internal TLS, administrator-provided certificates, and reverse-proxy TLS including **Nginx Proxy Manager**. Certificate health/expiry will be monitored, with notifications and protected private-key handling.



## D064

**Decision 64 confirmed: Option C — Stable + Preview update channels.**

**Stable** will be the default production channel. **Preview** can be explicitly enabled for testing newer features. Updates will include integrity verification, compatibility checks, pre/post health checks, configuration/Qdrant protection, migration handling, and safe rollback where possible. Application updates and AI model updates remain separate.



## D065

**Decision 65 confirmed: Option C — Privacy-first outbound policy.**

The Local AI server will operate **local-first by default**. Prompts, document contents, OCR text, embeddings, RAG chunks, filenames, extracted metadata, and conversation content will not leave the server. External access will be limited to explicitly enabled functions such as approved model repositories, software updates, configured cloud backups, and notification services.

Web Admin will include **Outbound Connections** monitoring and a **Local-Only/Offline mode**.



## D066

**Decision 66 confirmed: Option C — Managed OCR language packs.**

The reason for language packs depends on the OCR engine. OCR is not like the 4B LLM: it must recognize the **visual characters on scanned documents and images** before the LLM can understand the text.

For example, a digitally generated PDF may already contain selectable text and require **no OCR at all**. But a scanned passport, Iqama, Aadhaar/PAN document, old certificate, or photographed document contains pixels. An OCR engine must convert those pixels into text first.

For our Local AI server, I recommend this pipeline:

```text
Document received
       │
       ▼
Does it already contain usable text?
       │
   ┌── Yes ──► Native text extraction ───────────┐
   │                                              │
   No                                             │
   ▼                                              │
Detect image/script                               │
   │                                              │
   ▼                                              │
PaddleOCR ───── Primary OCR                       │
   │                                              │
   ├── low confidence/failure                     │
   ▼                                              │
Tesseract ───── Fallback OCR                      │
                                                  │
                 ▼
         Normalize extracted text
                 │
                 ▼
       4B Local AI extraction
                 │
          ┌──────┴──────┐
          ▼             ▼
     Metadata        RAG/Qdrant
```

### OCR engines

**PaddleOCR will be the primary OCR engine.** It is substantially more than a basic character recognizer and is suitable for document-oriented OCR pipelines, including multilingual documents and layout-oriented processing.

**Tesseract will be the fallback engine.** Tesseract uses installed language data such as English, Arabic, Hindi and Urdu. This is where the term **language packs** applies most literally.

I would slightly refine my previous answer: we should **not blindly install a separate large OCR model for every language**. The Local AI installer should install only the language resources required by the selected OCR engines.

For our initial deployment:

| Component | Purpose | Initial configuration |
|---|---|---|
| **PaddleOCR** | Primary OCR | Multilingual/document OCR |
| **Tesseract** | Fallback OCR | `eng`, `ara`, `hin`, `urd` |
| Native PDF extraction | PDFs containing real text | Preferred before OCR |
| DOCX/XLSX/PPTX parsers | Office documents | Native extraction; no OCR unless embedded images require it |
| 4B GGUF LLM | Understand/structure extracted text | Not used as the primary OCR engine |
| Future VLM | Difficult visual documents | Optional, not loaded initially |

This approach is particularly important for your **6 GB RAM** limit. We should avoid loading a vision model just to read a normal scanned page when PaddleOCR can do it much more efficiently.

The Web Admin's **OCR Languages** section can therefore show which languages are available for each installed OCR engine, whether they have actually passed a synthetic OCR test, and allow additional languages to be installed later.



## D067

**Decision 67 confirmed and updated: intelligent OCR detection with this fallback order:**

1. **light-ocr** — primary OCR engine
2. **Tesseract** — secondary fallback
3. **PaddleOCR** — tertiary fallback for difficult cases

I checked the repository you specified. `arcships/light-ocr` is an offline OCR project for Node.js/C++ built around **PP-OCRv6**, with confidence scores and coordinates, and hardware acceleration support where available. It is Apache-2.0 licensed.

For your **Debian 13 / 4-vCPU / 6-GB RAM** Local AI server, this order makes sense because we can try the lightweight engine first and escalate only when confidence or extraction quality is insufficient.

The OCR flow will therefore be:

```text
Native text extraction first
        ↓
If OCR required:
        ↓
light-ocr
        ↓
Low confidence / failure
        ↓
Tesseract
        ↓
Still poor / complex document
        ↓
PaddleOCR
        ↓
Normalize + validate text
        ↓
4B LLM extraction / RAG
```

The Web Admin should show, per OCR job, which engine was used, confidence, fallback path, processing time, detected language, and whether manual review is recommended.



## D068

**Decision 68 confirmed and expanded: Option C — Adaptive OCR quality scoring + administrator-controlled engine priority.**

The OCR order will **not be hard-coded**. `light-ocr → Tesseract → PaddleOCR` will be the **default**, but you can change it from Web Admin.

For example, under **Settings → OCR → Engine Priority**, you could configure:

| Priority | OCR Engine | Role | Enabled |
|---|---|---|---|
| 1 | light-ocr | Primary | Yes |
| 2 | Tesseract | Fallback 1 | Yes |
| 3 | PaddleOCR | Fallback 2 | Yes |

You could change it to `PaddleOCR → light-ocr → Tesseract`, disable an engine completely, or select **Primary only / Primary + one fallback / all three**.

Each engine will have its own configuration, installed languages/models, health status, benchmark results, average processing time, accuracy/quality statistics, resource consumption and **Test OCR** function.

The adaptive controller will decide whether fallback is necessary using confidence, detected-text quality, language confidence, layout quality, structured-field validation and extraction completeness. It will **stop as soon as acceptable quality is reached**, avoiding unnecessary CPU/RAM use.

Importantly, **administrator priority wins**: adaptive processing determines *whether to fall back*, while your configured engine order determines *which engine runs next*.



## D069

**Decision 69 confirmed: Option C — Automatic initial OCR benchmark + manual re-benchmark.**

After installation, the Local AI server will benchmark **light-ocr, Tesseract and PaddleOCR** using synthetic multilingual test documents. It will measure recognition quality, field extraction success, processing time, CPU/RAM usage, failures and language performance. Web Admin can recommend an OCR priority order, but **your manually configured order will never be changed automatically**.



## D070

**Decision 70 confirmed: Option C — Adaptive OCR preprocessing.**

The OCR pipeline will automatically assess each page/image before processing and apply only the transformations that are useful: orientation correction, deskewing, perspective correction, contrast normalization, denoising, border/crop correction and controlled resizing. The original input remains unchanged.

This will integrate with the configurable OCR chain:

**Primary OCR → quality evaluation → fallback 1 → quality evaluation → fallback 2**

and remain subordinate to the adaptive resource manager.



## D071

**Decision 71 confirmed: Option C — Intelligent OCR result selection and controlled merging.**

When fallback OCR engines run, Local AI will compare results using multiple quality signals rather than trusting each engine's raw confidence score. High-confidence complementary information may be merged, while conflicting critical fields will be flagged for verification instead of silently selecting one.



## D072

**Decision 72 confirmed: Option C — Privacy-preserving local correction feedback.**

Corrections will remain entirely local and can improve OCR engine selection, document-layout handling, validation rules, and extraction quality over time. The system will **not automatically retrain or fine-tune models** from family documents.



## D073

**Decision 73 confirmed: Option C — Hybrid automatic document-type detection + caller hint.**

Local AI will independently classify documents while accepting an optional type hint from PDMS or another client. It will return the detected type, confidence, caller/AI agreement status, and conflicts without silently overriding the caller's classification.



## D074

**Decision 74 confirmed: Option C — Managed, versioned document-schema library with AI-assisted field discovery.**

Local AI will ship with common schemas and allow administrators to create, clone, modify, version, enable/disable and test additional schemas. AI-discovered fields remain suggestions until explicitly incorporated into a schema.



## D075

**Decision 75 confirmed: Option C — Precise, permission-aware evidence citations.**

I also checked the requirements from your **Family Calendar** project. This changes an important architectural point: the Local AI server should be designed as a **general-purpose private Family AI service**, not specifically as a PDMS AI backend.

Your Family Calendar requirements include uploading school/college PDFs and images, extracting academic dates and holidays, handling official India/Saudi holidays and travel dates, and using an **Upload → AI extraction → review/edit → approval** workflow rather than allowing AI to insert events directly into the live calendar. You also wanted source-page/confidence tracking, duplicate/revision handling, circular amendments, semester profiles, recurrence rules, and privacy controls.

So our architecture should become:

```text
                    LOCAL AI SERVER
              Debian 13 • 4 CPU • 6 GB
                         │
        ┌────────────────┼────────────────┐
        │                │                │
      PDMS         Family Calendar    Future Apps
        │                │                │
        └──── Separate API keys / clients ┘
                         │
                    AI Gateway
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
   Chat / LLM       Document AI          RAG
       │                 │                 │
       │          OCR / Extraction      Qdrant
       │          Classification       Embeddings
       │          Structured JSON      Reranker
       │
       └──────── Shared model infrastructure
```

For **Family Calendar**, we should add a generic **Event Extraction capability/profile** to the Local AI API. It can accept a school circular, college calendar, office-holiday PDF, travel itinerary, image, PDF, CSV/ICS-related content, etc., and return structured *proposed* events—for example event title, start/end date and time, all-day status, event category/type, recurrence information where supported by evidence, source page/section, confidence, conflicts, and extraction warnings. The Family Calendar remains responsible for review, approval, permissions and actually creating the calendar event.

This also means our model capability detection should include **Calendar/Event Extraction** alongside Chat, RAG Q&A, Document Extraction, Classification, Structured JSON, Summarization, OCR cleanup, multilingual processing, embeddings and future vision.

The client isolation we already designed becomes particularly important: **PDMS and Family Calendar get separate API keys, statistics, rate limits, cache namespaces and RAG authorization contexts.** A Family Calendar request must never retrieve PDMS vectors or cached PDMS answers.



## D076

**Decision 76 confirmed: Option C — Hybrid application namespaces.**

The Local AI server becomes a **shared private AI platform** while keeping each consuming application isolated. PDMS, Family Calendar, and future applications will have separate client identities, API keys, cache namespaces, RAG authorization contexts, usage statistics, rate controls, and logically isolated Qdrant data. Cross-application retrieval is denied by default.

The underlying expensive components—4B LLM, embedding model, OCR engines, reranker, monitoring and resource scheduler—can still be shared efficiently.



## D077

**Decision 77 confirmed: Option C — Global defaults + isolated application profiles.**

The Local AI server will provide shared infrastructure while allowing **PDMS, Family Calendar, and future applications** to maintain their own task profiles, schemas, RAG namespaces, caching, retention, rate limits and AI behavior.



## D078

**Decision 78 confirmed: Option B — Return extracted events and let Family Calendar handle conflict/change logic.**

This keeps the Local AI server more **generic and reusable**. For Family Calendar, Local AI will focus on accurately extracting structured information and evidence rather than deciding which calendar entry should replace another.

For example, Local AI can return both:

```json
{
  "events": [
    {
      "title": "School Holiday",
      "date": "2026-12-10",
      "source": "school-calendar.pdf",
      "confidence": 0.97
    },
    {
      "title": "School Holiday",
      "date": "2026-12-12",
      "source": "new-circular.pdf",
      "confidence": 0.96
    }
  ]
}
```

The **Family Calendar application** will decide whether these represent duplicates, amendments, cancellations, conflicts, or replacement events. Local AI can still provide confidence and precise source citations, but it will not apply calendar-specific business decisions.



## D079

**Decision 79 confirmed: Option C — Managed schemas + caller-provided schemas.**

The Local AI server will support both centrally managed/versioned schemas and application-supplied JSON schemas. This keeps the AI platform reusable across **PDMS, Family Calendar, and future applications** without requiring server code changes for every new extraction format.

Caller-provided schemas will still pass validation and security/resource controls before execution.



## D080

**Decision 80 confirmed: Option C — Guided Web Admin application onboarding + API/CLI support.**

New applications will be onboarded through a wizard that creates an isolated application identity, API key, RAG/cache namespace, rate limits, allowed capabilities, network restrictions and integration examples. CLI/API equivalents will support automation and recovery.



## D081

**Decision 81 confirmed: Option C — Per-application capability permissions.**

Each application profile will control which AI services it can access. Administrative functions such as model management, backups, system configuration, secrets, updates and other applications' RAG data remain inaccessible to application API keys.



## D082

Agreed. That is simpler and better suited to your local environment.

### Decision 82 revised — Single Local AI API endpoint

We will **not expose different URLs for PDMS, Family Calendar, or other applications**. All applications connect to the same Local AI gateway:

```text
http://192.168.1.50:1234/v1
```

or with internal TLS:

```text
https://192.168.1.50:1234/v1
```

or through Nginx Proxy Manager:

```text
https://localai.domain.com/v1
```

The **API key identifies the application**:

```text
Authorization: Bearer <API_KEY>
```

For example:

```text
Local AI
https://localai.domain.com/v1
        │
        ├── PDMS API Key
        ├── Family Calendar API Key
        └── Future App API Key
```

The gateway looks up the API key and automatically determines the associated application profile, permissions, RAG namespace, cache namespace, rate limits, usage statistics and allowed source IPs. The client therefore does **not** need to put `pdms` or `family-calendar` into the URL.

The standard interface should remain OpenAI-compatible where practical:

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/embeddings
```

Our additional functions can remain under the **same `/v1` base URL**, for example:

```text
POST /v1/ocr
POST /v1/extract
POST /v1/documents/ingest
POST /v1/rag/query
GET  /v1/documents/{id}/status
DELETE /v1/documents/{id}
```

So an application only needs essentially:

```text
AI_BASE_URL=https://localai.domain.com/v1
AI_API_KEY=<application-specific-key>
```

This also means **API versioning stays in `/v1`**, but we won't create separate application-specific API URLs.

For LAN-only deployments, HTTP can be available if you deliberately enable it, but **HTTPS will be recommended**, especially because the API key is a bearer credential.



## D083

**Decision 83 confirmed: Option C — LAN + HTTPS/domain access simultaneously.**

The Local AI Gateway will expose one consistent `/v1` API. You can use either the direct LAN address or the HTTPS reverse-proxy/domain address, while each application receives its own API key.

Example:

```text
LAN:
http://192.168.1.50:1234/v1

Direct TLS:
https://192.168.1.50:1234/v1

Nginx Proxy Manager:
https://localai.domain.com/v1
```

Web Admin will show the available endpoints, connection status, TLS status, and allow plain HTTP to be disabled. Qdrant, llama.cpp, OCR workers, embedding services, and other internal components will **not** be directly exposed.



## D084

**Decision 84 confirmed: Option C — API key + optional source IP/subnet allowlist.**

Each application will use the same Local AI `/v1` endpoint but receive its own API key. An administrator can optionally restrict that key to specific IP addresses or subnets. Trusted-proxy handling will prevent spoofed forwarded addresses when Nginx Proxy Manager is used.



## D085

**Decision 85 confirmed: Option A — One active API key per application.**

Each registered application—PDMS, Family Calendar, or a future application—will have **one active API key**. Creating/replacing the key immediately invalidates the previous key. Web Admin will clearly warn that rotation can interrupt the client until its configuration is updated.



## D086

**Decision 86 confirmed: Option C — Optional API-key expiration per application.**

Default can remain **Never Expire**, while individual applications can use a configured expiration date. Web Admin will show expiry status and warnings before expiration through enabled notification channels.



## D087

**Decision 87 confirmed: Option C — Full Local AI Workspace.**

The standalone server will include both **Web Admin** and a fast **AI Workspace** for Chat, RAG/document Q&A, temporary uploads, OCR/extraction testing, model/profile selection, streaming responses, citations, cache status, performance information, and privacy-aware conversation history.



## D088

**Decision 88 confirmed: Option C — Multi-user AI Workspace with role-based access.**

The Local AI platform will separate **system administration** from normal AI usage. Additional family/workspace users can be created later without receiving access to API keys, secrets, backups, updates, Qdrant administration, model installation, or server configuration.



## D089

**Decision 89 confirmed: Option C — Password + optional TOTP + optional Passkey for Workspace users.**

Administrators will retain stronger MFA requirements and step-up authentication. Regular Workspace users can use passwords, TOTP and passkeys according to administrator policy, with session revocation, lockout/rate limiting and authentication auditing.



## D090

**Decision 90 confirmed: Option C — Role + explicit application/RAG namespace access.**

Workspace authentication and document authorization will remain separate. Users only retrieve information from explicitly authorized namespaces/scopes, while requests originating from applications such as PDMS continue to use the application's supplied authorization context.



## D091

**Decision 91 confirmed: Option C — Temporary by default + explicit Save to Workspace.**

Direct Workspace uploads will be temporary by default, with configurable automatic expiry and cleanup. Users can explicitly save selected documents for persistent RAG use within their authorized Workspace namespace. Temporary uploads will not silently become permanent AI storage.



## D092

**Decision 92 confirmed: Option C — Controlled Workspace sharing with user/group permissions.**

Saved Workspace documents will be **Private by default**. Sharing can be granted to selected users/groups, and the same authorization will apply to RAG retrieval, semantic search, citations, conversation access, and caches. Permission changes will invalidate affected authorization-sensitive cache entries. Application namespaces such as PDMS remain protected from Workspace sharing.



## D093

**Decision 93 confirmed: Option C — Global Workspace storage limit + configurable per-user/group quotas.**

Workspace storage will have its own controlled allocation within the **100 GB Local AI disk**, with configurable quotas for individual users and groups. Models, Qdrant, cache, temporary files, logs, backups and Workspace documents will be tracked separately. Critical system storage always takes priority over new Workspace uploads.



## D094

**Decision 94 confirmed: Option C — Version-aware Workspace documents with user confirmation.**

Potential revisions will be detected using content fingerprints, metadata, filenames and similarity. The system will **not automatically replace documents**. Once confirmed as a revision, normal RAG uses only the active version while authorized users can still access previous revisions.



## D095

**Decision 95 confirmed: Option C — Hybrid, permission-aware Workspace search.**

Search will combine exact/keyword matching, metadata filtering, and Qdrant semantic search. Exact identifiers, dates, filenames, and document numbers will favor deterministic matching, while natural-language searches can use embeddings. All results remain constrained by user/application permissions and active document revisions.



## D096

**Decision 96 confirmed: Option C — Intelligent, configurable search-result ranking.**

Hybrid search will combine exact matches, metadata, semantic relevance, active revision, source quality, and adaptive reranking. Application profiles can tune ranking behavior without requiring separate search infrastructure.



## D097

**Decision 97 confirmed: Option C — Explicit, user-controlled local memory.**

Workspace memory will be separate from RAG, conversation history, and query cache. It remains per-user, local, permission-aware, reviewable/editable/deletable, and disabled for automatic extraction from sensitive documents. PDMS and Family Calendar API requests will not automatically receive Workspace memories.



## D098

**Decision 98 confirmed: Option C — Structured, privacy-preserving local feedback and quality analytics.**

Feedback will help identify weak models, OCR engines, retrieval configurations, cache problems and performance issues. It can influence recommendations, but it will **not automatically retrain models, switch production models, or change security settings**.



## D099

**Decision 99 confirmed: Option C — Risk-aware adaptive verification.**

We have covered most of the architecture. I estimate **about 8–10 important decisions remain** before the specification is complete enough to generate the master build prompt.

The remaining areas are mainly:

1. **Performance targets and acceptance benchmarks** for the 4-vCPU/6-GB server.
2. **Job queue/restart persistence** after reboot or failure.
3. **Web Admin/Workspace UI design**, themes and mobile responsiveness.
4. **Accessibility and browser support.**
5. **Installer behavior**, including failed-install recovery and uninstall/reinstall.
6. **Testing strategy**—unit, API, RAG, OCR, security, performance and synthetic-data tests.
7. **Documentation**—installation, administration, API integration, troubleshooting and recovery.
8. **Final backup/disaster-recovery validation** and complete system acceptance criteria.
9. **Project/repository structure and release/deployment workflow**, if needed.

We should be able to finish around **Question 107–109** without adding unnecessary questions.



## D100

**Decision 100 confirmed: Option C — Baseline + hardware-calibrated performance targets.**

The installation will establish a synthetic performance baseline for the actual Proxmox/LXC hardware. Future application/model updates can be compared against it to detect regressions in TTFT, tokens/sec, OCR, embeddings, RAG retrieval, cache performance, API latency and resource consumption.



## D101

**Decision 101 confirmed: Option C — Persistent, resumable job queue.**

OCR, embeddings, indexing, backups, benchmarks and maintenance jobs will persist across service/LXC restarts. Safe checkpoints, retry limits and duplicate-prevention will be built in, while interactive Chat/RAG retains priority.



## D102

**Decision 102 confirmed and expanded: Option C — Modern customizable UI with advanced theming.**

The Local AI platform specification will include a dedicated **Appearance & Branding** system rather than only Light/Dark mode.

### Theme system

Users can select themes independently where permitted, while the administrator controls which themes are available.

- **Light**
- **Dark**
- **Glass**
- **Liquid Glass**
- Multiple configurable **color schemes** such as green, blue, purple, graphite, cyan and custom accent colors.
- **System/Auto** mode following the device preference.
- Themes apply consistently across Workspace, Admin dashboard, dialogs, document viewers and mobile layouts.
- Accessibility and readability override decorative effects when necessary.
- Glass/liquid effects automatically reduce on low-powered clients or when reduced-motion/transparency accessibility settings are enabled.

### Login wallpaper system

The login screen will support a managed wallpaper library with **named wallpaper schemes**.

Examples:

| Scheme | Design direction |
|---|---|
| **AI Core** | Neural/AI infrastructure visualization |
| **AI Network** | Abstract interconnected AI nodes |
| **System Grid** | Professional systems/infrastructure environment |
| **Host Matrix** | Servers, compute nodes and host topology |
| **Data Flow** | Abstract secure data-processing visualization |
| **Digital Infrastructure** | Datacenter/network-inspired professional design |
| **Custom** | Administrator-uploaded image |

Admin can upload wallpapers, give each one a custom name, preview it, enable/disable it, set a default, replace/delete custom wallpapers, and optionally configure **fixed, random-on-login, or rotating** wallpaper behavior.

The actual login form remains highly readable using an adaptive glass/solid overlay. Wallpapers will be optimized into suitable web sizes/formats so a large background image does not make login slow.

No external wallpaper service or tracking will be required; bundled/default artwork and uploaded wallpapers remain **local**.



## D103

**Decision 103 confirmed: Option C — Translation-ready multilingual UI.**

Initial release will include **English + Arabic**, with complete RTL handling. The UI architecture will use language packs so Hindi, Urdu and additional languages can be added later without redesign. Language selection will be per user, while multilingual OCR/document processing remains independently configurable.



## D104

**Decision 104 confirmed: Option C — Unified Local AI web service**, with your additional requirement that **Workspace, Admin, and Documentation are first-class sections of the authenticated web panel**.

After login, the main navigation will provide:

```text
Local AI
├── Dashboard
├── Workspace
│   ├── Chat
│   ├── Documents
│   ├── Search
│   ├── OCR
│   ├── Extraction
│   └── History
├── Admin
│   ├── Applications
│   ├── Models
│   ├── OCR Engines
│   ├── RAG / Qdrant
│   ├── Users & Groups
│   ├── API Keys
│   ├── Jobs / Queues
│   ├── Monitoring
│   ├── Storage & Cache
│   ├── Backup & Restore
│   ├── Updates
│   ├── Security
│   ├── Logs & Audit
│   └── Settings
├── Documentation
│   ├── Getting Started
│   ├── API Reference
│   ├── Application Integration
│   ├── PDMS Example
│   ├── Family Calendar Example
│   ├── OCR / RAG Guides
│   ├── Backup & Recovery
│   └── Troubleshooting
└── User Profile
```

Permissions will control visibility. For example, a normal Workspace user won't see administrative sections they cannot access. Documentation will be built into the web panel rather than relying on an external website, and API documentation/testing will remain available under `/docs`.



## D105

**Decision 105 confirmed: Option C — Secure browser-based first-run setup wizard.**

There will be **no default administrator password**. Installation generates a short-lived, one-time setup code. The browser wizard configures the administrator, Passkey/TOTP, recovery codes, networking/TLS, starter models, OCR engines, performance calibration and initial recovery settings.



## D106

**Decision 106 confirmed: Option C — Comprehensive document ingestion.**

Local AI will use native/structured parsers first and invoke OCR only when required. Supported categories will include PDF, Office/OpenDocument files, images, spreadsheets, presentations, text/Markdown, HTML/JSON/XML, ICS, email formats, and securely controlled ZIP archives. Archive extraction will include decompression-bomb, nesting, executable, size and resource protections.



## D107

**Decision 107 confirmed: Option C — Layered, configurable upload protection.**

Local AI will validate every upload before parsing, OCR, extraction, or indexing. Malware scanning will be configurable globally and per application, with quarantine, archive protections, resource limits, audit logging, and a design appropriate for the **4-vCPU / 6-GB RAM** LXC.

We are close to completion. I expect **2–3 decisions after this one** before the master specification can be generated.



## D108

**Decision 108 confirmed: Option C — SQLite WAL initially with a clean migration path.**

SQLite will hold platform/application state while **Qdrant remains dedicated to vectors and RAG**. The design will use transactions, migrations, integrity checks, backups and an abstraction layer so PostgreSQL can be introduced later if scale requires it. No unnecessary Redis/PostgreSQL services for the initial deployment.



## D109

**Decision 109 confirmed: Option C — Full automated release gate.**

A build cannot be promoted when critical security, privacy, permission-isolation, data-integrity, backup/restore, migration, or recovery tests fail. Automated testing will use synthetic documents rather than family data.

At this point, the **core Local AI architecture is essentially complete**. I recommend only **one final design decision** before consolidating everything into the master implementation specification.



## D110

**Decision 110 confirmed: Option C — Controlled Git-based release workflow**, with documentation treated as a **required product feature and release criterion**, not an afterthought.

The documentation system will include:

- **Installation Guide:** Debian 13 LXC prerequisites, sizing, one-line installer, first-run wizard, networking, HTTPS/TLS, Nginx Proxy Manager, firewall, upgrades, rollback, uninstall/reinstall and troubleshooting.
- **Administrator Guide:** users/RBAC, applications, API keys, models, embeddings, Qdrant/RAG, OCR priority, schemas, cache, resource profiles, queues, security, backups, notifications, updates, monitoring, logs and recovery.
- **User Guide:** Workspace chat, document upload, OCR, extraction, hybrid search, RAG Q&A, citations, memory, conversation history, sharing, feedback and document versions.
- **Configuration Reference:** every configurable setting documented with its purpose, default, valid values, resource/security implications and recommended setting.
- **API & Integration Guide:** `/v1` reference plus examples for PDMS, Family Calendar and future applications.
- **Screenshots:** real screenshots generated from the implemented application using synthetic/demo data. Include desktop, tablet/mobile where relevant, English and Arabic/RTL examples, themes, login wallpapers, Admin and Workspace.
- **Troubleshooting & Recovery:** service failures, model problems, Qdrant, OCR, API authentication, storage pressure, backup/restore, TLS, updates and diagnostics.

### Built-in contextual help

Settings should not merely show technical labels. Each important option will have an **ⓘ tooltip/help control** explaining what it does, its default and consequences.

For example:

> **Model Idle Timeout ⓘ**
> Unloads an inactive LLM to recover RAM. Default: 15 minutes. Lower values save memory but may increase the delay of the next request.
> **Learn more →**

**Learn more** opens the corresponding section of the **built-in Documentation panel**, not an unrelated external page.

Configuration screens can therefore provide:

`Setting → Tooltip → Learn More → Full Configuration Guide`

Documentation links should use stable internal anchors so an update does not break help links.

### Documentation release gate

A feature should **not be considered complete** until its documentation is complete. CI/release checks should verify that new configurable settings have tooltip/help text, documentation links resolve correctly, screenshots are updated when materially necessary, API changes appear in the API reference, migrations/upgrades are documented, and the relevant troubleshooting information exists.

Documentation will be versioned alongside the source code so, for example, documentation for `v1.2.0` describes the actual `v1.2.0` application.

This completes the **110-question requirements/design phase**. The architecture is now sufficiently defined to produce the consolidated **Local AI Master Build Specification / Codex implementation prompt** without further architecture questions.
