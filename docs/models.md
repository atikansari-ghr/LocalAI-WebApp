# Starter model and runtime candidates

The checked source manifest is services/inference/starter-manifest.json. Its hashes, exact byte lengths, upstream revisions and license references were verified from official vendor metadata on 2026-10-18. These are **candidates, not a compatible/production-qualified runtime** until native inference, streaming, embedding and memory tests pass on the target LXC.

| Component | Pinned candidate | License | Artifact bytes |
| --- | --- | --- | --- |
| CPU runtime | llama.cpp b11669, the build referenced by official v0.7.0 | MIT | 17,851,611 |
| Chat | Qwen3-4B-GGUF, Q4_K_M | Apache-2.0 | 2,497,280,256 |
| Embedding | Qwen3-Embedding-0.6B-GGUF, Q8_0 | Apache-2.0 | 639,150,592 |

Runtime provenance: [official pinned release](https://github.com/ggml-org/llama.cpp/releases/tag/b11669). Model provenance: [official chat repository](https://huggingface.co/Qwen/Qwen3-4B-GGUF) and [official embedding repository](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF). Exact immutable model revision URLs and SHA256 values are in the manifest. The embedding model card declares Apache-2.0; its GGUF repository does not contain a separate LICENSE file, so the pinned model-card license declaration is explicitly recorded as evidence. Downloads come directly from these upstreams; no model or third-party runtime is rehosted by this repository.

## Approved download step
After the tested foundation runtime is installed, a root operator can run:

```sh
bash installer/install-ai.sh --check
bash installer/install-ai.sh --download-starter
```

Run from the reviewed feature checkout. The wrapper checks Debian13/x64/resources and uses a native exclusive lock. The download step provisions approximately 3.15 GB of pinned assets. It does not start workers, change the gateway or claim compatibility. Network access here downloads approved software/models; there is no cloud processing of prompts or documents.

Downloads stream through SHA256 and exact length checks with a ten-minute bound per artifact. Redirects must stay on approved HTTPS vendor/CDN hosts. Oversized, corrupt, truncated, interrupted and cancelled transfers fail without publishing a partial asset. Files are published exclusively; an existing mismatched file is preserved and blocks provisioning for operator inspection. Verified files can be reused after interruption.

Runtime archives reside below /opt/localai/ai/archives/HASH; model weights below /var/lib/localai-models/HASH. The separate model root allows a later inference service account to read weights without traversing the private gateway state/vault directory. Completed candidates receive a protected report below /opt/localai/ai/candidates/MANIFEST_HASH/assets.json with downloaded-unqualified status. This report is not signed release evidence or permission to activate inference. Earlier candidates/weights are not automatically deleted.

## Qualification still required
Starter context limits are 4096 chat tokens and 2048 embedding tokens, subject to actual memory tests. The official embedding instructions specify last-token pooling; the runtime's real pinned CLI and resulting output must be validated rather than assumed. A vendor model card or successful file hash does not prove Arabic quality, capability behavior, CPU instruction compatibility, embedding normalization or the 6 GB memory budget.

Private workers, admission control, gateway contracts and local fallback now have native test evidence. Controlled activation and final phase acceptance remain open. Never redirect an unavailable local model to a remote inference provider. Full model management/updates and UI controls are later qualified features.

## Private runtime progress

The target now passes synthetic English/Arabic CPU chat, normalized 1024-dimension embeddings and SSE streaming with the pinned assets. Evidence and limitations are recorded in [the native worker report](verification/phase-3-private-workers-2026-10-18.md). The separate inference account receives an encrypted systemd credential and cannot access gateway state. Workers now use permission-protected Unix sockets inside private network namespaces and are stopped after the qualification harness; the earlier loopback arrangement was superseded after review.

The gateway adapter uses actual native tokenization, a single aggregate request slot, a two-minute total deadline and cancellation. Chat accepts at most 4096 total prompt/output tokens, with output limited to1024. Embedding requests currently accept at most16 strings and **256 tokens per string**, because that is the qualified physical batch budget; the larger native context is not permission to submit longer embedding inputs. Oversized input is rejected rather than truncated. Streaming uses the public model ID and requires a valid completion marker.

The `/v1/models`, `/v1/chat/completions` and `/v1/embeddings` route contracts require a permitted application key/IP or an authenticated browser session; browser POSTs require same-origin CSRF. Mixed application/session identities are rejected. These routes still return service unavailable in the deployed app: production bootstrap does not supply an inference adapter until activation evidence is qualified. Unit fixtures that inject an adapter are authorization tests, not live activation. Resource profiles, fallback and native sleep/restart checks are implemented; controlled activation and phase acceptance remain open.

## Resource profiles and local fallback

Eco caps chat at2048 context/256 output tokens; Balanced defaults to4096/512; Performance permits4096/1024. Concurrency stays one and native CPU/memory ceilings stay enforced in every mode. Less than1GiB available reduces the request budget to1024/128; less than512MiB rejects new work. The adapter takes the smaller of available memory and visible container headroom and fails closed when measurements are unavailable. These are request budgets, not a promise that the same workload fits every later OCR/RAG combination.

Native workers unload idle model contexts after900seconds by default. The isolated target test accelerates this to5seconds, verifies resident-memory release and same-process lazy reload, and independently kills/restarts a worker. No gateway service-management permission is added.

Optional fallback is official [Qwen3-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/tree/23749fefcc72300e3a2ad315e1317431b06b590a), Q8_0,639446688bytes, Apache-2.0 with its pinned LICENSE. Exact SHA256/revision are in services/inference/fallback-manifest.json. `bash installer/install-ai.sh --download-fallback` provisions it separately from the unchanged starter manifest. A downloaded file remains unqualified until tested.

The private native router uses root-owned presets for only the two approved local chat models, with at most one chat model loaded at a time. A smaller fallback cannot reproduce every primary-model capability or context length; its input/output sum is capped at2048tokens and larger requests fail explicitly. Enabled fallback requires an audit callback and a separately qualified deployment. Primary failures open a60second circuit after three failures. Memory pressure can choose the smaller model. Caller cancellation and partially delivered streams are never retried. Returned model IDs identify when fallback answered; there is no remote-provider fallback.

Actual target tests exercised both models in English/Arabic, primary→fallback→primary swaps, and a primary-only HTTP outage with real fallback inference, audit callbacks, circuit cooldown and primary recovery. Router and gateway activation remain separate: no production inference configuration has been published by these tests. Evidence: [resource and fallback checks](verification/phase-3-resources-2026-10-18.md).

## Worker socket isolation

The gateway adapter defaults to `unix:/run/localai-chat/inference.sock` and `unix:/run/localai-embedding/inference.sock`. Both service units use `PrivateNetwork=true`, so vendor router children cannot expose unauthenticated TCP ports in the LXC's main network namespace. Runtime directories are0750 and socket access is restricted to the `localai-runtime` group. The inference process retains separate model-read permissions and cannot read gateway state. Controlled gateway activation must grant only the socket-access group and its own encrypted systemd credential; it does not grant namespace or service-management privileges.

Fresh IPC connections avoid pooled stale sockets after native streaming/sleep/restart. TCP endpoints remain constructor options for isolated test fixtures; the deployed defaults use Unix sockets. Missing namespace support or socket permissions must block installation rather than fall back to exposed child listeners.

Three internal primary deadlines or failed partial streams open the circuit for subsequent requests. The affected current request is never retried after its deadline or first delivered chunk; explicit caller cancellation does not count as a primary failure.

## Qualification boundary

The gateway's qualification loader accepts only a protected root-owned activation record matching its immutable source revision, a fingerprint of runtime/security/gateway code and dependency locks, pinned starter/fallback manifests, target environment, mandatory native checks, exact installed unit hashes and the immutable preset hash. It reads the backend key from its private systemd credential directory. Missing evidence leaves inference disabled; mismatched evidence fails closed. No browser/API request or environment boolean can claim qualification. Synthetic loader fixtures are explicitly separate from deployed evidence.

On the authorized disposable qualification LXC, a root operator can run `/opt/localai/node/bin/node installer/qualify-ai.mjs --qualify-private-preview` with `TARGET_TEST_LXC=disposable` from a clean reviewed checkout. The source's `.localai` directory must be private and root-owned. The command runs the entire native test suite with zero failures/skips, real worker/router checks and isolated loader checks, rejects stale reports or changed source/environment, and writes only an inactive protected candidate below `/opt/localai/ai/qualified/SOURCE_COMMIT/report.json`. It does not write `/etc/localai/inference.json`, deploy gateway code or enable a service.

The environment identity binds the LXC machine ID, Debian package inventory, OS/kernel, CPU model/flags, assigned memory and Node runtime. Transient CPU speed/free memory and ordinary same-environment reboots do not invalidate it; dependency/hardware changes require requalification. Private-preview evidence is not a signed production release report. Reversible activation and its recovery/deployment tests remain under implementation; no live activation has been published.
