# Phase 1 Foundation Implementation Plan

> Execute with superpowers:executing-plans, task by task, using test-driven-development and verification-before-completion. User authorized native execution without further approval prompts on 2026-10-18.

**Goal:** Deliver the independently testable native platform foundation; block progression to production when target-host evidence is absent.
**Architecture:** Node.js 24 LTS gateway and built-in SQLite behind a small state abstraction; no third-party runtime dependencies in this phase. Node 24's SQLite API remains experimental: pin the tested runtime and retain the database boundary. Inference and Qdrant provisioning belong to their subsequent implementation phases.
**Tech Stack:** Node 24.19.0, node:sqlite, node:test, Bash, systemd, GitHub Actions.
**Spec:** LOCAL_AI_MASTER_BUILD_PROMPT.md and docs/requirements/decision-details.md.

## Global Constraints
Debian 13; 4 vCPU; 6 GB RAM; 100 GB disk; native systemd; no Docker.
Independent Local AI only; no PDMS/Family Calendar changes.
One /v1 gateway; loopback-only foundation until authentication/TLS exist.
All failed/missing production evidence blocks release. No main development.

## Review Focus
- Configuration typos or wildcard binding must not expose an unauthenticated gateway.
- Changed/out-of-order/newer migrations must fail without losing existing state.
- Backup while WAL has committed writes must include those writes and reject overwrite.
- Corrupt/unwritable state must produce unavailable health without exposing paths.
- Installer reruns and failures must preserve previous code/configuration/state.

## Task 1: Configuration and SQLite state
Files: packages/shared/config.mjs; packages/shared/settings.json; packages/database/index.mjs; migrations/001-foundation.sql; tests/config.test.mjs; tests/database.test.mjs.
Interfaces: loadConfig(env) → frozen typed configuration; openState(path, options) → state with getSetting, setSetting, backup, health and close.
- [ ] Write tests rejecting invalid ports, unknown LOCALAI variables and public binds; real database persistence/migration drift/rollback/live backup tests.
- [ ] Run node --test and observe missing-module failures; implementation supplies these interfaces.
- [ ] Implement validated environment registry, WAL/FULL synchronous transactions, ordered hashed migrations and exclusive online backups.
- [ ] Run node --test; expect all state/configuration tests pass; commit.

## Task 2: Gateway health and safe startup
Files: apps/gateway/server.mjs; apps/gateway/main.mjs; tests/gateway.test.mjs.
Interfaces: createGateway({state}) → http.Server; start uses loadConfig and openState.
- [ ] Write real HTTP tests: live 200, readiness 503 before remaining platform phases, no /v1 data, unknown route 404, unsupported method 405 and redacted storage error.
- [ ] Run node --test; expect gateway missing.
- [ ] Implement bounded HTTP server with security/no-store headers, loopback binding and shutdown.
- [ ] Run suite; launch a real child process, kill/restart and confirm committed state; commit.

## Task 3: Native installation and release checks
Files: installer/install.sh; installer/preflight.mjs; installer/runtime.json; installer/localai.service; scripts/release-gate.mjs; tests/installer.test.mjs; tests/release-gate.test.mjs.
Interfaces: preflight(snapshot) → errors/warnings; assessRelease(report, {commit, artifactRoot, now}) → blockers.
- [ ] Write resource/OS failures and release missing/stale/mismatch/artifact corruption tests.
- [ ] Observe red, implement, rerun suite.
- [ ] Installer accepts a local trusted checkout; uses official pinned Node binaries with checked SHA256, immutable revision deployments and root-owned configuration. Rerun preserves state; failed health restores previous code. No stable installer URL until release gates pass.
- [ ] Bash syntax and executable preflight tests; Linux CI exercises unsupported OS rejection. Real Debian systemd rerun/crash/rollback remains a mandatory target gate.
- [ ] Commit.

## Task 4: Documentation and CI
Files: .github/workflows/foundation.yml; docs/installation.md; docs/configuration.md; docs/architecture.md; docs/progress.md; README.md; scripts/check-docs.mjs.
- [ ] Document actual implemented scope, tooltip/help metadata and stable anchors, runtime provenance, migration/backup recovery and pending phase gates.
- [ ] Run tests, link/settings documentation checks and diff whitespace check.
- [ ] Native Linux and Windows CI must pass. Production stays blocked by absent target-LXC evidence and unimplemented phases.
- [ ] Request a fresh whole-branch review, fix important findings with regression tests, push branch and open stacked PR against specification branch. No main merge required.
