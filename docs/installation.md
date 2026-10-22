# Installation and recovery

The native private preview includes browser setup/authentication and a separately qualified local CPU chat/embedding runtime. The full platform and production release remain gated; OCR/parsing is under development and Qdrant/RAG is not installed. See [phase3 deployment evidence](verification/phase-3-activation-2026-10-18.md) and the [progress ledger](progress.md). There is no supported one-line stable installer yet.

## Development
Install Node.js 24.19.0 from the official distribution, then run:
```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix services/documents/parsers
npm test
npm run check:docs
npm start
```
The separate parser cohort installs only locked pure-JavaScript parsing dependencies; native OCR candidate dependencies are not installed by these commands. By default the development gateway binds127.0.0.1:1234, writes private SQLite state under .localai and exposes health endpoints. Secure browser/API transport requires the explicit TLS/proxy configuration below. Readiness intentionally stays503 with release_not_qualified while the full platform is incomplete.

## Debian foundation evaluation
Use a disposable Debian 13 Proxmox LXC with 4 vCPU, 6 GB RAM and 100 GB disk; root, running systemd and Git are required. Clone and inspect the intended feature commit before executing:
```sh
sudo bash installer/install.sh --check
sudo bash installer/install.sh
```
Do not execute a moving branch from a remote pipe. The installer requires a clean local checkout. The x86-64 foundation was tested on the target Debian 13 LXC; arm64 remains untested. This does not certify the AI stack or production readiness. The pinned Node runtime is fetched from nodejs.org and verified against committed SHA256 values. See [runtime provenance](architecture.md#runtime-provenance).

On a dedicated disposable LXC only, the repeatable integration harness is `TARGET_TEST_LXC=disposable /opt/localai/node/bin/node tests/target/foundation.mjs`, run as root from a clean checkout after the first install. It reinstalls the selected revision, checks rerun/state/backup, kills the service to test systemd recovery, and creates a local synthetic fault commit with a broken unit to test rollback. The synthetic commit is never pushed. Logs and evidence are written to the ignored .localai directory. This harness must not run on a host containing real user data.

The installer creates an unprivileged localai account; root-owned immutable source deployments at /opt/localai/releases/COMMIT; pinned runtimes at /opt/localai/runtimes; configuration at /etc/localai/gateway.env; state at /var/lib/localai; cache and logs in their respective /var directories. It does not expose the service through a reverse proxy or open firewall ports. Application output goes to the systemd journal.

Existing configuration and state are preserved on rerun. Initial configuration is prepared and validated separately, then published atomically; an incomplete existing file fails validation. All three documented environment keys must be present in the installed configuration. Before a migration, an exclusive, integrity-checked online database backup is saved under the configured state directory's pre-install-backups subdirectory. These are sensitive development recovery copies with no automated retention/encryption; administrator review is required. They do not qualify as the full backup/restore feature.

## Diagnostics
```sh
systemctl status localai.service
journalctl -u localai.service --since today
curl --noproxy '*' http://127.0.0.1:1234/health/live
curl --noproxy '*' http://127.0.0.1:1234/health/ready
```
Liveness 200 proves only a running gateway; readiness 503 is expected for this incomplete phase. A port conflict, invalid configuration, migration checksum drift or unwritable/corrupt database prevents startup. Do not delete state or modify already-applied migration files to suppress errors.

## Recovery boundaries
A failed activation attempts to restore previous code, runtime link and service unit together using a protected journal at /opt/localai/activation.json. The journal is written before activation, and a later installer run recovers an interrupted activation. Health checks use the configured transport/host/port and require the responding gateway PID to match systemd's MainPID. Direct TLS additionally validates the configured certificate trust and DNS origin hostname. The installer preserves state. Automatic code rollback is not a guarantee of schema rollback.

For an existing database, the installer now checks persisted migration history against both installed and candidate manifests before activation. A changed, added or removed migration blocks the update before the running service is stopped or the schema is changed. This deliberately blocks schema transitions until the separate schema recovery procedure is implemented and qualified. It is not a migration rollback implementation. First installations without an existing database are supported; restoring/importing an existing database with unknown or incompatible history requires a separately validated recovery process. Do not delete a database or edit migration files to get around this gate.

For a database restore: stop the service, preserve the current database plus WAL/SHM together in a protected recovery directory, verify the chosen backup offline, and restore it to a separate test directory first. Never overwrite a live database. Full automated encrypted backup, isolated restore and tombstone replay remain later-phase work.

No uninstall script is supplied because removal of local state requires a deliberate, reviewed operation. Do not manually remove /var/lib/localai to repair an installation.
