# Phase4 OOXML package policy checkpoint — 2026-10-18

Code:ecd4467cef71b2d0c8399108f4423154afeaa0c0 on the isolated phase4 branch, draft PR5. Internal DOCX/XLSX/PPTX package policy inspection is implemented; schema validation, text/cell/slide extraction and public document routes remain pending.

The checker reuses bounded in-memory ZIP verification and validates package content type declarations, a unique package main relationship, family-specific main part type/root namespace, every XML part and every relationship. It forbids DTDs, external relationship targets, missing/escaping targets, macro/ActiveX/OLE/embedded package indicators and ZIP signatures hidden behind another extension. Content types are normalized before dispatch; noncanonical relationship filenames are rejected. Original member hashes and bytes are preserved without extraction to disk.

Independent review reproduced XML inspection bypasses via uppercase suffixes and XML declared on text members, embedded ZIP bytes disguised as Office/text members, and external relationships disguised by suffix or media-type casing. Regression tests observed failures before corrections; final focused8/8pass and review reports no remaining Important/Critical findings in this scope. This is a restrictive policy subset, not full OOXML schema conformance, media validation or a malware-scanner guarantee.

Windows exact-code full suite:134tests,131passed,3POSIX-only skips,0failed. Documentation and whitespace checks pass. Native target and CI results are recorded below when complete. No live source/account/OCR changes are authorized by this package-policy result; phase4 and full release gates remain unaccepted.

Actual Debian13 target on exact code:134/134passed,0skips,0failures. Log:/root/localai-phase4-validation/.localai/office-policy-native-suite.log. Package inventory fingerprint remains unchanged. Live gateway ActiveState=active,MainPID=19963,NRestarts=0; qualified phase3 remains deployed.
