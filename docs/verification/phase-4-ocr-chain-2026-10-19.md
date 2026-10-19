# Phase4 OCR chain candidate — 2026-10-19

Private candidate only. Tests exercise actual installed CPU engines through the new fixed adapters inside a DynamicUser unit, PrivateNetwork/PrivateDevices/PrivateTmp, protected filesystem and live/model/config exclusions,512MiB memory/zero swap/one CPU/32tasks/120second outer boundary. No live activation or whole-phase acceptance.

Real English baseline: light exact, Tesseract LOCAL Al TEST 1234 (strict failure retained), Paddle exact. Real Arabic: light empty (fallback required), Tesseract exact, Paddle exact. The default Arabic chain attempts light then selects Tesseract; disabling Tesseract reaches exact Paddle output. Original synthetic fixtures are unchanged. Engine confidence is preserved only as engine-specific evidence, never equivalent accuracy. Structural/script checks do not detect the known Tesseract English error; all OCR remains review-required.

Native final localai-ocr-chain-observed-abort: success,11.080s, memory.peak309,235,712 bytes, zero swap, memory.events max/oom/oom_kill0. It observes spawned subprocesses before aborting each engine and verifies cancellation/temporary cleanup. Earlier100ms cancellation assertion failed because a fast engine completed before the timer; the harness now observes actual child startup instead of assuming runtime. Proofs remain in target .localai/ocr-chain-*.log.

Memory limitation: first cold run reached512MiB; repeat526,057,472bytes with no max/OOM events, then final309,235,712bytes. Cache/load variability and joint chat/OCR headroom remain a required native qualification gate; the final warm measurement does not replace cold-start or combined-workload acceptance.

Eight focused tests pass after RED→GREEN cases for missing modules, suppressed language-hint errors and null/timeout failures. Full Windows177 tests:174 pass,3POSIX-only skips,0failed. Independent read-only review clear of Important/Critical findings. Source-bound Debian/CI are recorded after commit.

Limits: per-engine30seconds, aggregate100pages/20MiB normalized rasters/1MiB attempted text,1000lines per engine/page. The coordinator requires cancellation-settling isolated adapters; outer whole-document deadline/resource admission must be implemented before public use. Paddle auto language selection remains unqualified; explicit en/ar chooses its fixed local model and missing hints return language-hint-required. Additional preprocessing, mixed-document dispatch, authorized contracts/fields and coordinated recovery remain pending.
