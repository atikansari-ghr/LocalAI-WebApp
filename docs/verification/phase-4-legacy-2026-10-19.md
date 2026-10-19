# Phase4 legacy candidate verification — 2026-10-19

Scope: private RTF/XLS/MSG candidates; no gateway route or live activation.

Windows complete suite:169 tests,166 passed,3 POSIX-only skips,0 failed. Focused7/7 pass. Binary HTML MSG regression first failed with empty output, then passed for UTF-8 and Windows1256 Arabic; unsupported codepages reject. Independent review found no remaining Important/Critical findings after fixes. A separate caller-output-limit review finding is fixed and covered by native tests.

Actual Debian DynamicUser unit localai-legacy-html-proof: success,773ms, memory.peak37,400,576 bytes, swap peak0. English/Arabic RTF, two-sheet XLS, Unicode and binary HTML MSG, unsupported encoding, malformed/truncated inputs, output caps, cancellation and temporary cleanup pass. Native paths to live state/models/config are inaccessible. Proof: target .localai/legacy-html-proof.log. Full source-bound Debian suite and CI are recorded after the source checkpoint.

Failed candidates preserved: unrtf plain output replaces Arabic with question marks; selected HTML conversion produces Unicode entities and correct literal Arabic. Python extract-msg0.56.1 wheel-only resolution failed red-black-tree-mod availability; no source build or package installation was attempted. MSG exact-buffer and binary HTML bugs were reproduced and fixed before exposure.

Archive identities are committed in services/documents/legacy-packages.json; vendor copyright files were inspected. Host dpkg status checksum remains unchanged. Live localai.service remains active PID19963/NRestarts0 at phase3 source3bbe66c. Whole phase4 gate remains blocked pending shared isolated dispatch/admission, adaptive OCR, authorized contracts and coordinated update/recovery qualification.
