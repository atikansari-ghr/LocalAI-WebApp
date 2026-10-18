# OCR and Document Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task. The user authorized implementation without approval prompts. Do not bypass failed native or release gates.

**Goal:** Parse authorized untrusted documents locally, use the configurable light-ocr → Tesseract → PaddleOCR fallback chain only where needed, and return bounded text/results with page/coordinate/engine provenance and explicit review warnings.

**Architecture:** Separate preliminary format/limit inspection, isolated format parsers, per-page extraction/OCR coordination, quality/provenance normalization and authenticated HTTP entrypoints. Native workers receive bounded synthetic/upload bytes through fixed local contracts, never caller-selected executables/URLs/paths. Keep the qualified phase3 deployment running while developing isolated candidate dependencies; no global package inventory change or live code replacement before coordinated requalification/recovery exists.

**Tech stack:** Existing Node24 gateway/security, CPU-only native OCR candidates in a separate locked dependency cohort; exact parser/Python/native versions must be researched before selection. No Docker/cloud OCR.

**Spec:** LOCAL_AI_MASTER_BUILD_PROMPT.md phase4 and decisions67–74,84–86; docs/requirements/decision-details.md (later decisions supersede earlier Paddle-first text).

## Constraints and review focus

- Debian13,4vCPU,6GB RAM,100GB-class disk; preserve interactive inference priority and enforce aggregate resources. New dependencies must not silently invalidate the enrolled live deployment.
- Native text before OCR; mixed PDFs evaluated page by page; no OCR output is trusted instruction. Originals remain unchanged.
- Default engine order light-ocr,Tesseract,PaddleOCR; administrator order wins. Disabled/unavailable/untested-language engines are reported honestly. No fabricated fallback or untested capability claim.
- Enforce filename/MIME/magic/structure, UTF8/size/page/pixel/text limits and archive expansion/CRC/path/symlink/nesting rules before extraction. Preliminary sniffing never means a container passed structural validation.
- Treat low confidence, missing fields, contradictory critical values and partial/timeout results as reviewable evidence; no guessed fields or silent conflict merging. Raw confidence scores from different engines are not directly comparable.
- Malformed/hostile files, timeout/cancellation, parser crashes, output overflow, encrypted/unsupported documents and decompression bombs must fail within explicit bounds and clean temporary state.
- PDMS/Family Calendar remain integration contracts/examples only. No enrolled credentials/documents as destructive test fixtures. Schema-changing updates remain blocked.

## Task 1 — Input inspection and bounded native text parsing

Files: services/documents/validation.mjs, services/documents/text.mjs, tests/document-validation.test.mjs, tests/document-text.test.mjs, docs/documents.md.

Interfaces: inspectDocument({name,mime,bytes},limits) returns immutable preliminary format/hash/size metadata, or a safe typed error. It never authorizes archive expansion or claims parser success. parseTextDocument consumes validated UTF8 formats and returns bounded text with source offsets/sections and parser identity, without executing HTML/XML/ICS/mail content or dereferencing anything.

- [ ] Write RED cases for wrong extension/MIME/magic, binary masquerading as text, path/control filenames, empty/oversized buffers, unsupported formats and document mutation prevention.
- [ ] Implement minimal inspection and tests. Initial defaults are implementation choices:10MiB file,1MiB text; document them before external exposure.
- [ ] Add real deterministic TXT/Markdown/JSON/CSV/ICS/HTML/XML/EML parsing with strict bounds and field/line provenance. Observe malformed/hostile RED first. Rich binary/container formats stay explicitly unsupported until task2.
- [ ] Run full Windows/Linux suites and docs checks; commit a feature branch checkpoint without claiming OCR or full format acceptance.

## Task 2 — Structural containers, PDFs and rich formats

Files: services/documents/containers.mjs, parsers.mjs, workers/parser.mjs, services/documents/package.json/package-lock.json, relevant tests and synthetic fixtures.

Interfaces: inspectContainer validates ZIP directory/entries/expanded size/ratio/nesting/paths/symlinks/CRC; parseDocument dispatches fixed parsers under bounded native workers. PDF output distinguishes native text/image pages before OCR, preserves page coordinates and detects encryption. Support PDF,OOXML/OpenDocument,RTF,legacy XLS/MSG,images and bounded ZIP only after corresponding structural/native checks pass.

- [ ] Verify official parser/native sources, maintained versions, licenses/transitive dependencies and installed byte integrity. Use a separate locked cohort rather than changing the active gateway dependency tree.
- [ ] RED hostile/truncated archives, traversal/symlink/duplicates, nested bombs, mismatched OOXML content types, huge XML/JSON nesting, encrypted documents, oversized image dimensions and broken mixed PDFs.
- [ ] Implement fixed isolated parsers, literal text output and precise provenance; no network/active content execution. Preserve original bytes; cleanup on failure/cancellation/output limit.
- [ ] Run synthetic real-format fixtures on Debian and Windows where supported; mandatory native target checks cannot be skipped.

## Task 3 — Real CPU OCR engines and adaptive chain

Files: services/documents/ocr.mjs, quality.mjs, workers/ocr.mjs, installer/qualify-documents.mjs, target harness and docs.

Interfaces: processPages receives extracted page metadata and fixed installed engine adapters. It preserves configurable order, stops after acceptable independent quality evaluation, returns attempt/fallback/timing/language/coordinate evidence, flags conflicts/missing fields and observes aggregate admission/cancellation. Native adapters cannot download at request time.

- [ ] Research/provision exact engine/model/language cohorts. First candidate: light-ocr0.5.8 release3a4d88e0740a0eda2944eac4f816af538771543b, runtime0.1.8, PP-OCRv6-small0.3.4, Linux-x64-gnu0.5.8. npm0.5.9 is a separate newer observation, not interchangeable qualification. Inspect bundled ONNX/PDFium/model/font licenses and CPU dependencies.
- [ ] Verify Tesseract Debian candidate5.5.0-1+b1 and language pack1:4.1.0-2 versus upstream5.5.3; verify PaddleOCR3.7.0 plus an actually compatible CPU/Python/model cohort. No invented model-language capability.
- [ ] RED order/disabled/primary-only/quality fallback, contradictory fields, Unicode/RTL, timeout/abort/cleanup and malformed engine outputs. Implement orchestration without comparing raw engine confidence as equivalent accuracy.
- [ ] Execute all three actual CPU engines on synthetic English/Arabic and mixed-page fixtures. Record declared/detected/tested languages, quality, time, memory, failures, fallback and source provenance. No automatic change to administrator order.
- [ ] Test joint inference/OCR resource pressure and interactive priority. Heavy OCR must queue/postpone instead of forcing swap or starving chat.

## Task 4 — Authorized document contracts and review metadata

Files: gateway document routes, auth application capabilities, shared settings/help registry, docs/API and synthetic browser/HTTP tests.

Interfaces: fixed /v1 document/OCR/extraction routes accept bounded uploads under app capability/IP or browser session/CSRF. Temporary-by-default workspaces isolate owner/app requests, reject arbitrary URLs/paths, return page/engine/source evidence and review/conflict status. Versioned schema validation accepts managed/caller schemas without executing code or following remote references.

- [ ] RED cross-app/owner access, revoked keys, CSRF/mixed identities, forged media/paths/schema references, upload disconnect and cleanup; implement actual fixed contracts and durable bounded jobs when request duration requires them.
- [ ] Add EN/AR settings/help for engine order/threshold/retention/scanning, truthful health/test actions and synthetic screenshots only for implemented controls.
- [ ] Verify structured extraction with actual local inference and deterministic field validators; preserve missing information/conflicts and caller/detected-type disagreement. Do not create calendar/PDMS records.

## Task 5 — Coordinated qualification, recovery and phase gate

Files: controlled runtime update/requalification workflow, isolated recovery fixtures, docs/verification/phase-4-*.md and progress ledger.

- [ ] Implement/review an unchanged-schema coordinated app/runtime/OCR update transaction before deploying phase4 to the already qualified service. Current first-activation command intentionally rejects updates. No force flag, forged evidence or edited source identity.
- [ ] Qualification must generate exact cohort/source/environment evidence; recover prior app/units/qualification and service state after injected failure without altering the account. Keep schema transitions blocked until full restore proof exists.
- [ ] Run whole-phase independent review, complete native/CI/docs/hostile-format/fallback/provenance gates and joint6GB resource tests. Fix Important/Critical findings using RED→GREEN.
- [ ] Accept phase4 only with real complete evidence, update its feature PR and preserve all remaining production gates. If any engine/format/dependency is incompatible, report the concrete failed gate rather than advertise support.
