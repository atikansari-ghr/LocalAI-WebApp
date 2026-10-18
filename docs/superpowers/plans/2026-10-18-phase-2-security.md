# Phase 2 Security Implementation Plan

User approved continued implementation without approval prompts. Execute natively with test-driven-development, verification-before-completion and one independent whole-branch review.

**Spec:** LOCAL_AI_MASTER_BUILD_PROMPT.md; recovered decisions D022–024, D044, D054, D065, D081–090, D105, D107–110.
**Goal:** Secure identity, MFA, bootstrap, sessions, application credentials and secrets before exposing browser administration.
**Architecture:** Keep the loopback gateway fail-closed while building tested security services over SQLite transactions. Encrypt TOTP/vault material using a separately protected local master key. Use a pinned maintained WebAuthn implementation rather than inventing authenticator verification.
**Global constraints:** Debian 13 native systemd; 4 vCPU/6 GB/100 GB; one /v1; one active application key; no PDMS/Calendar changes; synthetic tests only; no cloud fallback.
**Review focus:** concurrent first-run initialization; TOTP/recovery replay; session revocation/CSRF; application key scope/IP/proxy spoofing; encrypted-secret tamper/recovery; forged/replayed WebAuthn responses.

## Task 1: Security primitives and network policy
Files: packages/auth/crypto.mjs, packages/auth/network.mjs, tests/security-primitives.test.mjs.
Interfaces: hashPassword/verifyPassword; tokenDigest; encrypted vault read/write by purpose; TOTP generation/verification with replay counter; matchesNetwork/resolveClientIp.
- Write tests for wrong passwords, bounded hash parameters, RFC TOTP vector, replay, ciphertext tampering/AAD mismatch and IPv4/IPv6/proxy boundaries.
- Observe RED, implement, then run complete suite and commit.

## Task 2: Transactional identity and first-run
Files: migrations/002-security.sql, packages/auth/repository.mjs, packages/auth/service.mjs; tests/auth-service.test.mjs.
Interfaces: issueSetupCode → one-time secret; begin/complete setup with expiry and atomic claim; login → session/recovery codes; authenticateSession, revokeSession and step-up.
- Tests: setup expiry/brute-force/concurrency, pending account recovery, mandatory MFA, replay-safe TOTP/recovery, generic errors, persistent rate limits, CSRF and session expiry/revocation.
- Observe RED before implementation; encrypt persistent secrets and redact audit events; run all tests and commit.

## Task 3: Application credentials and WebAuthn
Files: packages/auth/applications.mjs, packages/auth/passkeys.mjs, related tests; package-lock.json.
Interfaces: application provisioning/rotation/revocation/authorization; WebAuthn registration/authentication options and challenge-bound verification.
- Verify @simplewebauthn/server version/license/Node compatibility from registry and official documentation; lock dependency graph and audit it.
- Tests deny cross-application capability/scope, old keys after rotation, expired keys, untrusted forwarded headers and forged/expired/replayed credential responses.
- Observe RED; use mandatory user verification, configured RP/origin and stored credential counters; run suite and commit.

## Task 4: Secure transport, browser setup and administration
Files: gateway routes, secure HTTP helpers, TLS/proxy configuration, first-run/login frontend, installer and docs.
- Plan the exact endpoint contracts, origin/CSRF/body limits, secure session cookies, setup enrollment and recovery flow before wiring the HTTP layer.
- Test HTTP errors/limits/origin/CSRF/session isolation and real browser setup/login/passkey journeys with synthetic accounts. No public listener until transport/identity tests pass.
- Every setting requires registry help, internal docs and real screenshots once the UI exists.
- Target gate: native install/upgrade plus authentication, recovery, isolation and proxy-spoofing tests. Failed critical gates block subsequent phases.
