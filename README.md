# LocalAI-WebApp

Independent, locally hosted AI platform for Workspace users and application clients.

Target: Debian 13 Proxmox LXC, 4 vCPU, 6 GB RAM, 100 GB disk, native systemd without Docker.

The [master build specification](LOCAL_AI_MASTER_BUILD_PROMPT.md) defines the implementation and release requirements. [Recovered decision details](docs/requirements/decision-details.md) preserve all 110 Local AI decisions and their historical context.

Status: phase 1 foundation is target-tested; phase 2 security core is in development. Validated configuration, SQLite WAL migrations/online backups, loopback health gateway, native systemd installer and release-evidence validation are implemented. The [security modules](docs/security.md) add tested identity/MFA/session/vault/application-key/passkey services, but browser authentication and secure transport are not yet exposed. AI services and subsequent phases remain pending. No production release is available. PDMS and Family Calendar integrations are API contracts/examples only.

See the [installation guide](docs/installation.md), [configuration reference](docs/configuration.md), [architecture and limitations](docs/architecture.md), [implementation plan](docs/superpowers/plans/2026-10-18-phase-1-foundation.md) and [progress ledger](docs/progress.md). Development requires Node.js 24.19.0; run `npm ci --ignore-scripts`, `npm test`, `npm run check:docs`, then `npm start`.

Development uses feature branches and pull requests. Release promotion requires complete automated evidence, including security/isolation, target-host performance, backup/restore, migration and rollback checks.
