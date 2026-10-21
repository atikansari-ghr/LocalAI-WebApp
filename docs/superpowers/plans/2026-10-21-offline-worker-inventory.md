# Offline Document Worker Inventory Plan

**Goal:** An interrupted interactive lease cannot be cleared while a transient document worker unit remains, even when the four long-lived services are stopped and masked.

**Scope:** Add an internal, fixed-prefix read-only inventory proof and exercise it with a disposable systemd worker. Keep production recovery unavailable; this does not replace the existing worker stop-and-recheck operation or the future journaled maintenance transaction.

## Tasks

- [x] Write failing tests for present, malformed and unavailable transient-unit inventories.
- [x] Implement a bounded two-pass inventory of the fixed `localai-document-job-*.service` pattern.
- [ ] Extend the native disposable proof to reject a running transient document worker and clear a synthetic marker only after it is gone.
- [ ] Run Windows, Debian, native and CI checks; update draft PR #5 and keep Phase 4 blocked.
