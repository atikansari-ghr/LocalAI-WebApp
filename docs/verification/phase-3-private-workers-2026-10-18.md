# Phase 3 private-worker progress — 2026-10-18

This is native progress evidence, not full phase or production acceptance. Source follows asset commit fed4a3f on PR #4. The target harness and worker profiles are committed with this report; full gateway admission/cancellation and independent review remain outstanding.

## Actual target

Debian 13 Proxmox LXC, 4 assigned vCPU, 6 GiB RAM, expanded 100 GB disk. All three official starter artifacts were downloaded and rehashed on the target. Manifest SHA256: `8c92ab22f416e9abf5f802ce2ed029bc1b64b1eb561df31c93466349cedd5989`.

The pinned binary reports `0.7.0-dev (build 11669, commit 620d2225c)`. Its initial loader check failed because `libgomp.so.1` was absent. Installing Debian's `libgomp1` 14.2.0-19 resolved that dependency; `ldd` then found every required library. The extracted upstream LICENSE remains installed. Runtime files are owned by root, with writes denied to the inference account.

## Observed checks

`TARGET_TEST_LXC=disposable /opt/localai/node/bin/node tests/target/private-workers.mjs` passed on the actual target:

- Separate `localai-inference` account, encrypted systemd credential delivery, private loopback ports 8081/8082; no public API activation.
- Chat and embedding models loaded simultaneously. English chat completed in 1,332 ms (3 output tokens); Arabic chat returned Arabic text in 4,128 ms (32-token limit). These are short smoke checks, not throughput guarantees or language-quality benchmarks.
- English/Arabic embedding batch returned two finite, normalized 1,024-dimension vectors.
- Native SSE returned content and its completion marker. Unauthenticated model-list requests returned 401.
- Aggregate cgroup memory current 4,717,625,344 bytes and observed peak 4,719,116,288 bytes; swap current zero with `MemorySwapMax=0`. This includes charged file cache and is not solely process RSS. The peak includes earlier runs in the same slice; no reset-to-zero claim is made.
- Existing gateway PID remained unchanged. Both private workers were stopped after qualification checks and remain disabled at boot.

An initial run permitted swap, so it was not accepted as memory evidence. Both worker units and their aggregate slice now prohibit swap; the successful repeat used that restriction. Aggregate memory ceiling is 5 GiB and CPU quota 300%, leaving capacity for gateway and OS. Later RAG workloads require new measurements.

The initial test also caught a runtime parent-directory permission error and a harness assumption that version information used stdout; both were corrected before the successful run. No enrolled user factors or database migrations were changed.

## Remaining gate

Gateway authentication/capabilities, context accounting, overload admission, disconnection/deadline cancellation, restart recovery and independent whole-phase review remain mandatory. No model is advertised through the application yet. The candidate report remains `workers-loaded-unqualified`; downloadable integrity and native smoke tests do not establish complete runtime acceptance. Full-platform release gates stay closed.

Host-bound systemd encryption protects the internal worker credential at rest from the service accounts, but does not establish encrypted host storage or qualified backup recovery. Those remain later operational/security gates.
