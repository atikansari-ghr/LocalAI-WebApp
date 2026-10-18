# Phase 3 resource and fallback continuation — 2026-10-18

This report supplements the private-worker report. It does not accept the whole phase or production release; independent review and controlled activation are still outstanding.

## Native idle unload and restart

Actual disposable Debian13/4vCPU/6GiB LXC, with the enrolled gateway running. The native harness used5second idle intervals to test the same supported mechanism whose default is900seconds. Both workers reported sleeping; summed resident mappings fell from5,874,905,088 to150,110,208bytes. This sum double-counts shared pages and is **not** aggregate physical memory. Cgroup current was4,301,385,728bytes with an observed historical peak4,719,116,288 and zero swap.

Chat and embedding requests woke their models without changing worker PIDs. After SIGKILL of the chat worker, native systemd restart produced a new PID and successful inference; gateway PID was preserved. The inference account could not read the gateway database or master key. Workers were stopped after the harness and remain disabled at boot. No user factors changed.

## Profiles and fallback

RED→GREEN tests establish Eco/Balanced/Performance budgets, mandatory emergency protection, actual tokenizer accounting and fail-closed resource measurement. A request cannot increase the native concurrency or resource ceilings through a profile.

Official fallback metadata and LICENSE were retrieved at immutable revision23749fefcc72300e3a2ad315e1317431b06b590a. Native download verified all639446688bytes against SHA2569465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031. Its separate candidate digest is a6cab9a97e6f8d1c157e94477bd4d76c0e70e848c500a1336147a19a6b298aa1; starter digest remains unchanged.

The real llama.cpp router successfully switched primary→fallback→primary with English/Arabic requests and actual template/tokenizer endpoints for both. Its private `/models` report was checked to contain no more than one loaded/loading chat model. Embedding worker was active concurrently. No model files were moved or deleted to simulate a failure.

A loopback-only test proxy injected503 solely for primary template requests while forwarding fallback requests to the actual native router. Four requests received real fallback output; three primary attempts preceded circuit cooldown. Advancing the test clock past60seconds and restoring primary forwarding returned a primary-model completion. Four metadata-only audit callbacks were observed. This is an HTTP-outage simulation, not a claim to reproduce every OS/model-corruption failure.

Partial-stream and caller-cancellation tests forbid automatic retry. Circuit state is currently process-local; durable notification/admin presentation and broader self-healing belong to later phases. No inference activation report was forged and no stable release was published.

Local full suite:89tests,87pass plus2explicit POSIX-only skips; actual native full-suite and final source CI are required for the committed checkpoint. Source changes remain on PR#4; the deployed gateway still has no inference adapter.
