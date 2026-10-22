# LocalAI-WebApp

Independent, locally hosted AI platform for Workspace users and application clients.

Target: Debian 13 Proxmox LXC, 4 vCPU, 6 GB RAM, 100 GB disk, native systemd without Docker.

The [master build specification](LOCAL_AI_MASTER_BUILD_PROMPT.md) defines the implementation and release requirements. [Recovered decision details](docs/requirements/decision-details.md) preserve all 110 Local AI decisions and their historical context.

Status: foundation/security controls and the phase3 private CPU-runtime gate have passed target checks. The preview includes secure browser setup, MFA/passkeys/device names, sessions/vault/application keys, authenticated local chat/embeddings/streaming, SQLite WAL and native installation/controlled first activation. [Phase3 evidence](docs/verification/phase-3-activation-2026-10-18.md) identifies the exact deployed source and scope. Phase4 document parsing/OCR is in development; full Workspace/Admin, RAG, operations/recovery and production gates remain pending. PDMS and Family Calendar integrations are API contracts/examples only.

See the [installation guide](docs/installation.md), [configuration reference](docs/configuration.md), [architecture and limitations](docs/architecture.md), [document-processing plan](docs/superpowers/plans/2026-10-18-phase-4-document-processing.md) and [progress ledger](docs/progress.md). Development requires Node.js24.19.0; run `npm ci --ignore-scripts`, `npm ci --ignore-scripts --prefix services/documents/parsers`, `npm test`, `npm run check:docs`, then `npm start`.

Development uses feature branches and pull requests. Release promotion requires complete automated evidence, including security/isolation, target-host performance, backup/restore, migration and rollback checks.
