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

Private workers, admission control, gateway contracts, resource fallback and native benchmarking remain under implementation. Never redirect an unavailable local model to a remote inference provider. Full model management/updates and UI controls are later qualified features.
