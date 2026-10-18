# Phase 2 installer safety continuation

Source tested and deployed: 73aa925d05da9b1062bdf04061c1f106b20b0725 on feat/phase-2-security, draft PR #3.

## Evidence
- Windows Node 24.19.0: 49 tests, 47 passed, two explicit POSIX-only skips; no failures.
- Actual Debian 13 Proxmox LXC: 49 tests passed, zero skips/failures. Documentation checks passed.
- Both required GitHub CI jobs passed at this source revision: Ubuntu and Windows.
- Direct TLS tests use a real HTTPS server and a public test-only localhost certificate/key. They verify correct TLS/PID, wrong hostname, wrong trust material, wrong PID and absence of plaintext fallback.
- Independent review identified an Important timeout regression. A real slow-trickle HTTP response reproduced it: the old probe accepted a response after three seconds. An absolute abort deadline fixes it; the regression now rejects at two seconds. Socket inactivity timeout and the 16 KiB response cap remain enforced.
- The native rejection harness created a synthetic source-only migration in a temporary Git worktree. The real installer rejected it before activation. MainPID, active code link and persisted schema history remained unchanged, with no activation journal left behind. No migration was applied to the enrolled account's database.
- The regular installer then accepted the unchanged-schema source update, reported rollback compatibility and PID-bound liveness success, and left the service active. HTTPS returned 200. Readiness still excludes setup_required, confirming the enrolled account remains initialized; runtime_not_provisioned and release_not_qualified remain.

## Safety boundary
The new migration gate blocks schema-changing updates to an existing database because automatic code rollback cannot restore schema compatibility. It checks the actual stored history against installed and candidate manifests. First installation without existing state remains supported. There is no bypass flag. This is prevention, not a completed schema restore workflow.

Node HTTPS request/TLS behavior was checked against the [official Node HTTPS documentation](https://nodejs.org/docs/latest-v24.x/api/https.html) and exercised on the pinned 24.19.0 runtime. The probe connects to the configured local IP while verifying the DNS origin through SNI and normal certificate validation. Trust includes public roots and the administrator-configured certificate chain; browser trust is separate.

## Still pending
Complete physical-passkey and recovery browser acceptance, general user/group administration, operational vault/account recovery, and schema-transition recovery remain unqualified. An actual direct-TLS systemd installation with production certificate rotation is also not certified by the HTTPS unit tests; this deployment uses Nginx Proxy Manager. Full platform release stays blocked. No inference or document-service phase has been accepted.
