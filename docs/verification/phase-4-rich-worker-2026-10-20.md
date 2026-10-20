# Phase 4 rich-format job-worker proof — 2026-10-20

A disposable, root-owned Debian 13 candidate worker composes the previously tested fixed Poppler, Pillow, legacy parser and light-ocr → Tesseract → PaddleOCR adapters behind the one-shot document socket. The root-only proof submitted encrypted jobs through the private job runner, let systemd launch a restricted DynamicUser worker with `MemoryMax=512M` and `MemorySwapMax=0`, then read and deleted each result. It did not alter the enrolled gateway or install packages.

| Synthetic fixture | Worker cgroup peak | Swap peak | Result |
| --- | ---: | ---: | --- |
| Mixed native/scanned PDF | 269,025,280 bytes | 0 | Arabic text returned |
| Two-page TIFF | 191,012,864 bytes | 0 | Arabic text returned |
| Multilingual RTF | 20,267,008 bytes | 0 | Arabic text returned |

The test confirmed no active document units after completion, deletion of all three retained jobs, and unchanged enrolled gateway PID 19963. The worker and driver are target-only proof scripts under `tests/target/`; the deployed gateway still does not enable document routes. This first check covers individual bounded jobs. The main worker still needs an installed, qualified cohort configuration before native OCR/rich formats can be enabled.

A second disposable native proof used the same rich worker and encrypted TIFF job under the shared admission candidate, then issued a real local llama.cpp chat request. Observed order was worker active → background abort → document unit finished → interactive admitted → chat finished. The job became cancelled and was deleted after exit; host swap stayed zero, no document units remained, and the enrolled gateway PID was unchanged. The chat completed about 12.6 seconds after preemption was requested. This verifies priority and cleanup for one combined request, not sustained load or final installed-service admission wiring.
