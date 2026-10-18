# Phase 3 private-preview acceptance — 2026-10-18

## Identity and result

Accepted source: **3bbe66c856ac2e5f17534761912185ba5ef1ca1c** on feat/phase-3-ai-runtime, PR4. This accepts the private CPU-runtime phase only. Main remains unchanged and the full production release is blocked.

Target: authorized disposable Debian13 Proxmox LXC at192.168.10.214,4assigned vCPU,6GiB RAM,100GB-class disk; native systemd, no Docker. Public TLS origin: https://localai.ansariz.biz through the previously configured Nginx Proxy Manager. Models/runtime and licenses are pinned in starter-manifest.json and fallback-manifest.json; no cloud fallback.

## Executed evidence

From clean /root/localai-phase3-validation:

1. `TARGET_TEST_LXC=disposable bash installer/qualify-ai.sh --qualify-private-preview` completed at2026-10-18T18:43:48Z. **109/109 native tests passed, zero failures/skips**, followed by real worker/router checks, protected loader/drift rejection and actual isolated systemd rollback. Inactive root-owned candidate: /opt/localai/ai/qualified/3bbe66c856ac2e5f17534761912185ba5ef1ca1c/report.json. Diagnostic log: .localai/final-qualification.log.
2. Both required GitHub CI jobs passed at the same source: [run39155361246](https://github.com/atikansari-ghr/LocalAI-WebApp/actions/runs/39155361246). Local Windows:106passed,3POSIX-only skips,0failed. Native qualification accepts no skipped tests.
3. `bash installer/install.sh` passed dependency installation, unchanged-schema compatibility, existing-state online backup and configured transport/PID liveness. Deployment: /opt/localai/releases/3bbe66c856ac2e5f17534761912185ba5ef1ca1c. Log: .localai/runtime-app-deployment.log.
4. `bash installer/activate-ai.sh --activate-private-preview` committed at2026-10-18T18:44:24Z after protected source/assets/extracted-byte/config checks, effective execution/resource verification, namespace isolation, real primary chat, embedding, fallback and gateway health. The durable journal was removed only after verification. Log: .localai/runtime-first-activation.log.
5. `TARGET_TEST_LXC=disposable /opt/localai/node/bin/node tests/target/activated-runtime.mjs` passed at2026-10-18T18:44:48Z. Separate synthetic SQLite/vault/account state exercised HTTP authentication → gateway → actual native workers: English/Arabic chat,1024dim multilingual embeddings, normalized SSE, disconnect cancellation and next-request reuse, context rejection, app capabilities/IP/revocation, browser CSRF and mixed-identity rejection. Report: .localai/activated-runtime.json; log: .localai/activated-api-acceptance.log. The enrolled account was never a fixture and its gateway PID was preserved during this test.
6. An intentional gateway-only restart subsequently loaded the protected qualification and encrypted credential successfully with NRestarts=0. Both workers remain enabled/active. Public trusted-certificate HTTPS checks returned live200, anonymous /v1/models401, and ready503 with **only release_not_qualified**. No insecure TLS bypass was used.

Independent review corrections are recorded in [runtime fixes](phase-3-review-fixes-2026-10-18.md) and [activation fixes](phase-3-activation-review-fixes-2026-10-18.md). Focused re-review found no remaining Important/Critical finding in the two activation corrections;14focused tests passed without skips.

## Resource observations and limits

Observed aggregate inference cgroup peak: **4,719,296,512bytes**, with MemorySwapCurrent=0. Aggregate hard ceiling5GiB/300%CPU/zero swap; chat4GiB/300%, embedding1GiB/100%, concurrency1. Production idle unload interval900seconds; accelerated5second fixture demonstrated unload and same-process lazy reload. Vendor router permits at most one chat model loaded alongside the embedding worker. Child listeners remain in a private network namespace behind permissioned Unix sockets.

This run's short English completion took2492ms for3generated tokens; Arabic took4014ms for32tokens. These include request/load effects and are observations, not steady-state throughput or TTFT guarantees. Earlier per-process RSS sums double-count shared mappings and are not aggregate physical memory. Full performance calibration, simultaneous OCR/RAG and larger embedding batches remain later gates.

## Boundaries

No production release, signed artifact, main merge, database schema transition, user-factor reset, OCR/RAG/Qdrant activation or PDMS/Family Calendar modification. Subsequent live code/model/runtime updates remain blocked until a coordinated update/requalification/recovery workflow is implemented and qualified. The first-activation command deliberately has no force/update flag. The Nginx upstream long-request timeout has not been requalified in this increment; the gateway emits X-Accel-Buffering:no for SSE, but authenticated native HTTP acceptance used a local synthetic proxy boundary rather than the enrolled user's public session.
