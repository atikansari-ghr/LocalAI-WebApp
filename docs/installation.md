# Installation and recovery

This is a development foundation, not a usable AI platform or production release. There is no supported one-line stable installer yet. No models, Qdrant, accounts or browser setup are installed by this phase.

## Development
Install Node.js 24.19.0 from the official distribution, then run:
```sh
npm test
npm run check:docs
npm start
```
No npm packages are required. The gateway binds 127.0.0.1:1234 and writes private SQLite state under .localai. It exposes GET /health/live and GET /health/ready only. Readiness intentionally returns 503 until the remaining platform is implemented. No unauthenticated Admin or Workspace UI is served.

## Debian foundation evaluation
Use a disposable Debian 13 Proxmox LXC with 4 vCPU, 6 GB RAM and 100 GB disk; root, running systemd and Git are required. Clone and inspect the intended feature commit before executing:
```sh
sudo bash installer/install.sh --check
sudo bash installer/install.sh
```
Do not execute a moving branch from a remote pipe. The installer requires a clean local checkout. The foundation supports x86-64 and arm64; actual compatibility on either is not yet certified. The pinned Node runtime is fetched from nodejs.org and verified against committed SHA256 values. See [runtime provenance](architecture.md#runtime-provenance).

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
A failed activation attempts to restore previous code, runtime link and service unit together using a protected journal at /opt/localai/activation.json. The journal is written before activation, and a later installer run recovers an interrupted activation. Health checks use the configured host/port and require the responding gateway PID to match systemd's MainPID. The installer preserves state. Automatic code rollback is not a guarantee of schema rollback. The initial migration is additive; future migrations require tested downgrade/restore procedures before installation is accepted.

For a database restore: stop the service, preserve the current database plus WAL/SHM together in a protected recovery directory, verify the chosen backup offline, and restore it to a separate test directory first. Never overwrite a live database. Full automated encrypted backup, isolated restore and tombstone replay remain later-phase work.

No uninstall script is supplied because removal of local state requires a deliberate, reviewed operation. Do not manually remove /var/lib/localai to repair an installation.
