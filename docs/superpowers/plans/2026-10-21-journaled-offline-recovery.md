# Journaled Offline Interactive Recovery Plan

**Goal:** Recover an interrupted interactive lease only inside an exclusive, crash-recoverable maintenance window that keeps the actual installed systemd units effectively masked and confirms all transient document workers are gone.

**Architecture:** A root-only operator command takes the existing `/opt/localai/install.lock`, snapshots the four fixed service definitions and active/enabled states into a durable root-owned journal, stops the services, installs effective `/etc/systemd/system` masks with same-directory backups, reloads systemd, stops and collects transient document workers, and runs the internal offline proofs before clearing the protected marker. It then restores the exact prior definitions and states. If interrupted, the next invocation restores from the journal before any new recovery attempt. The marker remains until every offline proof passes. An incomplete restore retains the journal and blocks activation.

**Scope:** Only Local AI files and units. Do not run this procedure against the deployed Phase 3 services while Phase 4 is inactive; prove it with disposable synthetic `/etc` units and a separate marker first. No PR merge or production activation until independent review, rollback proof and all Phase 4 release gates pass.

## Tasks

- [x] Build and test protected journal and exact file-snapshot primitives, including unexpected symlinks, ownership/mode, oversized-file and path rejection. Interrupted-write crash proof remains part of the later transaction task.
- [ ] Build and test the stop/mask/reload/worker-cleanup/verify/marker-clear/restore state machine with injected controls and rollback failures.
- [ ] Native Debian proof using only synthetic `/etc` units: active and enabled state, crash points, retry, rollback, no transient worker, unchanged live PIDs/package database.
- [ ] Review safety boundaries; run full Windows/Debian suites, documentation and required CI; update draft PR #5 with remaining gate failures.
