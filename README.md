# LocalAI-WebApp

Independent, locally hosted AI platform for Workspace users and application clients.

Target: Debian 13 Proxmox LXC, 4 vCPU, 6 GB RAM, 100 GB disk, native systemd without Docker.

The [master build specification](LOCAL_AI_MASTER_BUILD_PROMPT.md) defines the implementation and release requirements. [Recovered decision details](docs/requirements/decision-details.md) preserve all 110 Local AI decisions and their historical context.

Status: phase 1 foundation implementation. Validated configuration, SQLite WAL migrations/online backups, loopback health gateway, native systemd installer and release-evidence validation are implemented. The browser interfaces, authentication, AI services and later phases are not implemented. No production release is available. PDMS and Family Calendar integrations are API contracts/examples only.

See the [installation guide](docs/installation.md), [configuration reference](docs/configuration.md), [architecture and limitations](docs/architecture.md), [implementation plan](docs/superpowers/plans/2026-10-18-phase-1-foundation.md) and [progress ledger](docs/progress.md). Development requires Node.js 24.19.0; run `npm test`, `npm run check:docs`, then `npm start`. No npm packages are needed.

Development uses feature branches and pull requests. Release promotion requires complete automated evidence, including security/isolation, target-host performance, backup/restore, migration and rollback checks.
