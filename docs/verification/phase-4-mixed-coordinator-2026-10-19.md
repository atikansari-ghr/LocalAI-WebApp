# Phase4 mixed-document coordinator — 2026-10-19

Internal private candidate; no public route, production qualification or source activation.

Actual Debian DynamicUser unit localai-document-processor-det736 passed synthetic native/scanned/mixed3pagePDF, multipageTIFF, legacyRTF/XLS/MSG, exact original page citations, canceled-before-start and private temporary cleanup. Native firstpage remains text-only; scannedpage yields LOCAL AI TEST 1234; mixedpage retains LOCAL AI MIXED PAGE and مرحبا بالعالم as separate native/OCR evidence. TIFF secondpage preserves Arabic words and word polygons; whitespace differs from whole-line engines and is normalized only in comparison/assertions, not fabricated as raw text.

Final14.874seconds; memory peak536,870,912bytes, sampled anonymous peak416,329,728bytes/non-file420,442,112bytes (20ms sampling, not exact process-RSS maxima), zero swap, max1071 reclaim events, OOM/kill0. The fixed512MiB limit remained. Reclaim events mean the memory ceiling was reached; this is bounded execution evidence, not joint6GB headroom acceptance.

Failed runs retained in target .localai/document-processor-*.log: default Paddle detector OOM on1546x2000 page; explicit960long-edge max then survived but sampled anonymous memory520,196,096bytes. Explicit736max reduced the sampled working set while preserving synthetic text. APIs/defaults were verified in installed pinned PaddleOCR/PaddleX sources and local model inference.yml (736 optimum), without global packages or runtime downloads. A TIFF assertion initially expected a space where Tesseract intentionally emits per-word newlines; comparison now checks the same Arabic words with whitespace normalization while preserving returned evidence.

Independent review found whitespace agreement and unnecessary native-page rasterization bugs. Both observed RED, fixed and regressed; no remaining Important/Critical findings. Focused14/14 and full Windows183tests180passed+3POSIX skips/0failed. Source-bound Debian/CI recorded after commit. Previous8b8f160 fullDebian177/177zero skips and both required CIjobs passed.

Limits/gates: ZIP content extraction remains manifest-only; adaptive deskew/perspective/contrast and reliable language detection remain pending. No source images/attachment bytes returned. Outer worker dispatch/admission, authenticated contracts, field validation, coordinated update/recovery and combined-workload acceptance still required. Live localai.service PID19963/NRestarts0; dpkg inventory checksum unchanged.
