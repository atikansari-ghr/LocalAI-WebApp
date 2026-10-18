# Implementation ledger
Plan: docs/superpowers/plans/2026-10-18-phase-1-foundation.md
Spec: LOCAL_AI_MASTER_BUILD_PROMPT.md

2026-10-18: specification approved; user requested execution without further approvals.
Ruling: use the dedicated clean clone and feature branch in place — it is already task-specific, no shared app checkout is modified.
Ruling: Node 24.19.0 and built-in SQLite are the foundation runtime — zero external runtime packages, with experimental SQLite isolated behind a database module; future runtime upgrades require tests.
Pre-flight: configuration feeds gateway/installer; state feeds gateway/backup; release checker reads only evidence and artifacts. No conflicting interfaces.
Phase 1 target gate: pending real Debian 13 Proxmox LXC install/rerun/recovery. Windows checks are development evidence only.
Phases 2–15: pending; no production release is qualified.
Task 1: complete — observed missing implementation RED, then 7/7 state/config tests GREEN. Tests exercise real SQLite WAL, persistence, live backup, exclusive destinations, migration drift and rollback. Windows test cleanup was corrected to close database handles before directory removal.
Task 2: complete — HTTP tests observed RED before implementation; 11/11 suite GREEN including a real child gateway killed and restarted. Readiness remains 503 and application routes are unavailable until later phases.
Task 3: development implementation complete — resource/release tests observed RED before implementation; 16/16 suite GREEN. Installer Bash syntax passes; actual unsupported-host rejection and missing-evidence release rejection are checked. Target Debian/systemd installation is pending, so phase 1 acceptance remains BLOCKED.
Task 4: documentation and CI prepared; configuration help coverage and local links pass. Native Linux/Windows CI and independent review are pending.
Independent review: five Important issues identified (configured endpoint/PID, complete activation rollback, configured backup path, atomic initial configuration, actual crash WAL coverage). Regression tests were added before the fix pass; missing lifecycle module and the old crash fixture both failed as expected. Fix pass adds configuration-aware lifecycle helpers, PID probes, persistent activation journal and a child that commits while keeping WAL open before forced termination.
Final: minor (deferred): storage health uses a read-only integrity check and cannot detect an otherwise intact but unwritable/full disk. Platform readiness remains blocked; a write-availability check is required before production health acceptance.
Ruling: one POSIX activation test is Linux-only and explicitly skipped on Windows — the product deploys on Debian, and Linux CI/target execution must supply this evidence. Cost if wrong: platform-specific activation issues could be missed; real target checks remain mandatory.
User supplied root SSH access to the disposable Debian 13 LXC on 2026-10-18. Inspection confirms Debian 13.6, 4 vCPU and 6 GB RAM, but only a 49 GB filesystem. The 100 GB disk gate is currently blocked; requested expansion without bypassing preflight.
Target disk was expanded to 100 GB by the user. Clean native install succeeded at commit 2441e3c; all 21 tests passed on Debian with zero skips. Rerun preserved configuration/state and created a verified backup; systemd recovered a forced process crash. Deliberately broken unit activation exposed a critical recovery failure: systemd start limiting blocked restarting the restored good unit. No later phase was started. Fix resets the failed/start-limit state for explicit install/rollback and waits for the restored PID-bound endpoint.
