# Foundation architecture
The master specification remains authoritative; this phase implements only the platform substrate.

Gateway uses Node HTTP and exposes process health, with a permanent incomplete-platform readiness failure until future implementation changes are tested. Every other route is denied. HTTP errors omit internal exception text. No framework or third-party runtime package is installed.

SQLite metadata is accessed through packages/database/index.mjs. Ordered, immutable migrations have SHA256 drift detection; migration application runs in one immediate transaction. WAL, FULL synchronous mode, foreign keys and trusted-schema restrictions are configured. Startup checks integrity. Backups use SQLite's online backup API and verify the result; existing destination files cannot be overwritten. Node SQLite calls are synchronous: large queries and backups must remain bounded, and future background services must isolate expensive work.

## Runtime provenance
Node 24.19.0 was verified against https://nodejs.org/dist/v24.19.0/SHASUMS256.txt on 2026-10-18. The installer pins x64 and arm64 tarball SHA256 digests in installer/runtime.env. Source/license: https://github.com/nodejs/node/blob/v24.19.0/LICENSE . Node uses the MIT license with bundled component notices; redistribution must retain those notices. Official binary archives include the license. No project-wide software license is selected by this change.

Node's SQLite API in the 24 LTS series is experimental. The database module isolates it; no unchecked runtime upgrades are supported. Documentation: https://nodejs.org/docs/latest-v24.x/api/sqlite.html . The actual installed development runtime is 24.19.0, tested with SQLite 3.53.3; deployed binaries still require platform tests.

Qdrant, llama.cpp, OCR models, embeddings and rerankers are not downloaded in this phase. Previously researched upstream versions remain candidates pending signed artifact manifests and CPU/RAM validation. Nothing in the development tests establishes a compatible starter AI stack.

## Release evidence
scripts/release-gate.mjs validates a supplied evidence report for the complete mandatory category set, commit, target environment, command, time and on-disk artifact hashes. It rejects missing, duplicate, unknown, skipped, stale or failed categories. It does not authenticate the truth of caller-supplied reports: production needs protected CI provenance and artifact attestation. This phase deliberately supplies no Stable publishing workflow.

GitHub Actions unit tests are development checks on Linux/Windows, not a claim of Debian Proxmox qualification. A successful CI run cannot clear the absent target-install, inference, isolation, backup/restore, migration/rollback, privacy or UI gates. Do not hand-author passing production reports.

## Boundaries
The root-owned installer controls deployment, never the unprivileged gateway. No HTTP endpoint can write configuration, run a shell, install models or read arbitrary files. Default loopback binding cannot be overridden to a network address in this phase. The service unit bounds resources and restarts; inference will require its own independently budgeted units.
