# Private CPU AI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user authorized continued implementation without approval prompts.

**Goal:** Install and verify a real private CPU chat/embedding runtime within the target LXC's memory budget, then expose only authenticated gateway contracts.

**Architecture:** Pinned official llama.cpp CPU binaries and Qwen GGUF assets, streamed integrity-checked downloads and immutable installed assets. Separate unprivileged native systemd workers bind permissioned Unix sockets in private network namespaces; authenticated gateway clients enforce profiles, limits and cancellation. Root-owned validation evidence gates activation; mocks never establish model compatibility.

**Tech Stack:** Node 24.19.0, native systemd, llama.cpp CPU, official Apache-2.0 Qwen GGUF models. Qdrant remains a separately qualified phase-5 service.

**Spec:** LOCAL_AI_MASTER_BUILD_PROMPT.md phase3; foundational security gate evidence in docs/verification/phase-2-recovery-2026-10-18.md.

## Global constraints
- Debian13 Proxmox LXC,4vCPU,6GBRAM,100GBdisk; native systemd/noDocker.
- No cloud inference fallback or document/prompt logging. Downloads are explicit provisioning of approved pinned assets.
- One public /v1 base; private workers never bind a LAN/wildcard address.
- Model updates remain separate from application updates. Do not alter PDMS/Family Calendar or the enrolled user's credentials.
- No schema transition or installer-gate bypass. Feature branch/PR; main stays unchanged.
- Missing, skipped or failed native inference/streaming/embedding/memory evidence blocks runtime acceptance.

## Review focus
Interrupted downloads cannot replace verified assets; oversized/corrupt/redirected content fails closed.
Unsupported CPU/ELF dependencies must block activation, not fall back to remote inference.
Total service memory/CPU must leave headroom for gateway/OS and later RAG; context and parallelism remain bounded.
Workers must not read gateway vault/database or expose diagnostics/prompts to application callers.
Disconnect/timeout/shutdown must cancel upstream generation and release request capacity.

## Task 1: Verified starter manifest and asset provisioning
Files: services/inference/starter-manifest.json, assets.mjs; installer/install-ai.mjs; tests/inference-assets.test.mjs; docs/models.md.
Interfaces: validateStarterManifest(value) returns immutable validated metadata; downloadAsset(asset,destination,{fetchImpl}) streams to exclusive temporary file, verifies exact size/SHA256 and atomically publishes without clobbering an unrelated file; install-ai consumes only this manifest and validates target before mutation.
- [x] Pin official release/model revisions, SHA256, bytes, licenses and provenance; verify vendor metadata/model cards. Candidate chat Qwen3-4B Q4_K_M and embedding Qwen3-Embedding-0.6B Q8_0 are not compatibility-approved until task4.
- [x] Observe failing tests for manifest errors, corrupt/truncated/oversized transfer, interruption and existing-file handling; implement and run suite/docs checks.
- [x] Provision verified assets on the target, inspect CPU/runtime requirements and preserve upstream licenses in installed distributions. Report compatibility failures instead of substituting unverified assets.

## Task 2: Private native workers and resource limits
Files: installer/localai-ai.slice, localai-chat.service, localai-embedding.service; services/inference/native.mjs; tests/inference-native.test.mjs.
Interfaces: buildWorkerArguments(profile,paths) returns bounded CPU-only command arguments; native provisioning installs root-owned runtime/models and separate unprivileged workers. Internal credentials must not be logged or placed in process arguments; use qualified native credential delivery if required.
- [x] Test unsafe binds/paths/context/parallelism and missing assets; observe RED then implement.
- [x] Verify actual pinned CLI flags/ELF dependencies on Debian; start only private Unix-socket workers with read-only models and no access to gateway state/vault.
- [x] Apply native aggregate CPU/memory limits; validate starts/stops/restarts and no unsupported cloud/download behavior.

## Task 3: Gateway adapter, profiles and resource admission
Files: services/inference/client.mjs, profiles.mjs, admission.mjs; gateway routes/config; tests/inference-client.test.mjs and gateway inference tests.
Interfaces: chat/stream/embeddings accept bounded typed inputs and fixed configured worker endpoints; AbortSignal propagates disconnect/deadline. Profiles use verified capabilities and bounded contexts, one active generation slot, explicit overload errors and safe model IDs.
- [x] Test capability denial, application/session permissions, unsupported parameters, stream disconnect, timeouts and capacity release with real local HTTP fixtures.
- [x] Observe RED, implement minimal real contracts and document limits/errors. No silent context truncation or fabricated completions.
- [x] Keep activation blocked when the native validation report/assets do not match the installed manifest.

## Task 4: Real target compatibility and phase gate
Files: tests/target/inference.mjs; docs/verification/phase-3-YYYY-MM-DD.md; implementation ledger and screenshots when actual UI is wired.
- [x] Verify installed hashes/licenses, real English/Arabic chat, streamed chunks, normalized multilingual embeddings and bounded context rejection.
- [x] Measure loaded process/cgroup memory and actual CPU behavior on 4vCPU/6GB with gateway active. Exercise restart, cancellation, warmup and unsupported-capability paths.
- [x] Independent whole-milestone review; fix Important/Critical findings with RED→GREEN. Run complete target/CI/docs checks and keep full production gates blocked.

## Pre-flight and rulings
Task1's validated asset paths/hashes feed task2; task2 fixed private Unix-socket endpoints/credentials/resource units feed task3; task4 qualifies the exact pinned combination. No model is advertised as compatible before real execution. Existing dedicated task clone and feature branch provide isolation; reuse rather than modifying any shared application checkout. Upstream release metadata currently maps llama.cpp v0.7.0 to CPU build b11669; pin that actual artifact instead of inventing a nonexistent v0.7 CPU archive. Full UI/admin/backup/production criteria remain later gates, even when this private runtime gate passes.
