# Controlled Private Runtime Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. The user authorized continued implementation without approval prompts. Do not bypass failed gates.

**Goal:** Enable the tested private CPU runtime through the authenticated gateway only after matching clean-source native evidence, while preserving the enrolled account and a recoverable disabled-runtime state.

**Architecture:** Root generates a private-preview qualification record by executing the full native suite and target harnesses from a clean immutable source revision. Activation publishes only matching root-owned unit/configuration evidence and an encrypted systemd credential drop-in. The gateway accepts no client-selected worker endpoint, model path, evidence path or qualification flag. Main loads an adapter only when a protected record matches its deployed source/assets. Missing evidence keeps inference unavailable. These are private-preview controls, not signed production release evidence.

**Tech stack:** Existing Node24, native systemd credentials/network namespaces, protected Unix sockets, SQLite unchanged schema, existing installer/liveness/rollback primitives.

**Binding specification:** LOCAL_AI_MASTER_BUILD_PROMPT.md phases3/15; existing phase3 plan and independent-review fix evidence. No database migration, user-factor reset, PDMS or Family Calendar modification.

## Task 1 — Qualification identity and fail-closed bootstrap

Files: services/inference/qualification.mjs, tests/inference-qualification.test.mjs, apps/gateway/main.mjs, shared configuration/docs when the operating mode is exposed.

Interfaces: computeRuntimeFingerprint(sourceRoot) hashes a deterministic explicit set of all runtime/gateway/security modules, manifests and dependency lock; validateQualification(value,expected) requires exact schema/scope, source identity, artifact identities and every mandatory native check; loadQualifiedInference reads a regular root-owned non-writable-by-others record and an internal credential from the service's credential directory, returns null when no activation exists and rejects mismatches. No boolean environment variable can enable unqualified inference. Audit callback writes metadata-only fallback events.

1. Write and observe RED for missing evidence, wrong source/artifact fingerprints, incomplete/skipped checks, malformed/unknown fields, unsafe record metadata and invalid credentials. Expected: no usable adapter for each invalid case.
2. Implement the smallest validation/loader and bootstrap integration. Preserve unavailable runtime behavior when the record is absent. Tests must not grant their synthetic fixture permission to qualify a real deployment.
3. Run focused/full suites and docs checks. Native-only filesystem ownership checks must run without skips on Debian.

## Task 2 — Root qualification and reversible activation

Files: installer/qualify-ai.mjs, installer/activate-ai.mjs, installer/native-activation.mjs, tests/native-activation.test.mjs; update install-ai wrapper only with explicit documented root flags.

Interfaces: qualification command requires clean Git source, correct Debian/resources and exact pinned assets; runs the full test command with zero skips/failures and both native harnesses itself, verifies fresh report contents, records source/fingerprints and writes a protected inactive candidate. No acceptance of caller-supplied pass booleans or stale reports. Activation checks that candidate, installs root-owned known router presets and production900second units, creates only a socket-access/encrypted-credential gateway drop-in, and uses a durable journal before changing files/services. It must restore the prior activation record/units/drop-in and service enabled/active states after failure, without modifying account data or replacing internal credentials silently.

1. Observe RED for incomplete evidence and fault injection after each durable activation step. Expected: prior record, exact unit/drop-in bytes and service states recover; rejected evidence causes no activation mutation.
2. Implement atomic publication and rollback using established installer patterns. The existing foundation install remains the only app-code deployment path and keeps its schema gate. Runtime activation never changes model files or database migrations.
3. Native validation must use generated—not asserted—evidence. Separate short test idle intervals from the actual900second production configuration and record why the same mechanism is qualified.

## Task 3 — Actual deployment, API proof and acceptance

Files: tests/target/activated-runtime.mjs, docs/verification/phase-3-activation-YYYY-MM-DD.md, implementation ledger, installation/model/API docs.

1. Review the activation change independently before first live activation; fix Important/Critical findings with RED→GREEN.
2. Run clean-source Debian full suite, native qualification and both CI jobs. Then use the unchanged-schema installer for the app revision and the reversible runtime activator.
3. Verify exact effective units, namespace/credential/socket boundaries, genuine runtime health, authenticated API through isolated synthetic state against the real private workers, public unauthenticated denial, cancellation, restart and runtime activation rollback. Never use real enrolled credentials as destructive fixtures.
4. Mark phase3 only after its actual evidence passes; keep full-platform readiness/release blocked by later OCR/RAG/Workspace/backup/schema/release gates. Update PR#4 and documentation with concrete current evidence. No stable publication or main merge is implied.

## Interface rulings

Qualification identities bind the source and four asset hashes to activation; existing three-asset starter and separate fallback candidates remain immutable. PrivateNetwork plus Unix sockets is mandatory after the router-child review finding. The gateway drop-in uses SupplementaryGroups=localai-runtime rather than granting model-control/root privileges. Tests may use temporary files/synthetic accounts but never forge the deployed activation record. Source or unit mismatch means requalification, not a force flag. Root administration remains the trust boundary; production signing and full backup/vault recovery remain later gates.
