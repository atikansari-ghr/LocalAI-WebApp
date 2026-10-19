# Phase4 Word main-body extraction checkpoint — 2026-10-19

Code43b339fe01acf991d405bbe2c29099a18034c39b, feature branch feat/phase-4-document-processing, draft PR5. Internal DOCX main-body literal extraction follows reviewed package policy and bounded XML parsing. No public document route or live source update is introduced.

Five focused regressions cover English/Arabic, entity/CDATA decoding with exact UTF16 XML source spans, namespace-prefix independence, deleted/instruction/embedded-story omissions, cancellation/output limits and reuse, table paragraph source order, tabs/breaks with explicit element provenance, and directly hidden run flags. Initial tests failed against an unavailable parser before implementation. Independent read-only review reports no Important/Critical findings within this scope.

Exact-code verification:

- Windows139tests:136passed,3POSIX-only skips,0failed.
- Actual Debian13 target139/139passed,0skips,0failed. Log:/root/localai-phase4-validation/.localai/word-native-suite.log.
- Documentation and whitespace checks pass.
- Host package inventory fingerprint unchanged; live gateway active,MainPID19963,NRestarts0. User account and qualified phase3 source unchanged.

Each literal text unit references main-part SHA256/path and decoded XML start/end indices, paragraph and run. Tab/break units reference their XML element without invented text offsets. Styles/inherited visibility, rendered layout, numbering, table geometry and other document stories are not reconstructed; cached fields are not recalculated. These limitations are reported in parser warnings and docs/documents.md. Spreadsheet/slide extraction and the remaining phase4 format/OCR/resource/API/update/recovery gates are still pending. This checkpoint does not accept phase4 or production release.
