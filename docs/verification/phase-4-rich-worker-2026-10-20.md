# Phase 4 rich-format job-worker proof — 2026-10-20

A disposable, root-owned Debian 13 candidate worker composes the previously tested fixed Poppler, Pillow, legacy parser and light-ocr → Tesseract → PaddleOCR adapters behind the one-shot document socket. The root-only proof submitted encrypted jobs through the private job runner, let systemd launch a restricted DynamicUser worker with `MemoryMax=512M` and `MemorySwapMax=0`, then read and deleted each result. It did not alter the enrolled gateway or install packages.

| Synthetic fixture | Worker cgroup peak | Swap peak | Result |
| --- | ---: | ---: | --- |
| Mixed native/scanned PDF | 269,025,280 bytes | 0 | Arabic text returned |
| Two-page TIFF | 191,012,864 bytes | 0 | Arabic text returned |
| Multilingual RTF | 20,267,008 bytes | 0 | Arabic text returned |

The test confirmed no active document units after completion, deletion of all three retained jobs, and unchanged enrolled gateway PID 19963. The worker and driver are target-only proof scripts under `tests/target/`; the deployed gateway still does not enable document routes. This checks individual bounded jobs, not simultaneous chat plus OCR, sustained joint load, exact production cohort qualification or the whole Phase 4 release gate. The main worker still needs an installed, qualified cohort configuration before native OCR/rich formats can be enabled.
