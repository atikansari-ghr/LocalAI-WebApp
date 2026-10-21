# Offline Maintenance Preflight Plan

**Goal:** Refuse interrupted interactive-lease recovery when systemd has a queued unit job or pending configuration reload, even if the unit otherwise appears masked and stopped.

**Scope:** Strengthen the internal read-only verifier and disposable target proof. Do not expose a production recovery entrypoint, change installed unit files, or clear a live marker.

**Evidence:** The Debian target reports `Job=` and `NeedDaemonReload=no` for a disposable runtime-masked unit. The deployed gateway, chat and embedding units remain active; `localai-documents.service` is not installed.

## Tasks

- [x] Write failing parser tests for queued jobs, pending reload and absent/malformed fields.
- [x] Require empty `Job` and `NeedDaemonReload=no` in each of the two full systemd passes.
- [x] Run focused, full Windows and Debian suites and the native disposable recovery proof.
- [x] Record the checkpoint and CI results in draft PR #5. Keep the full Phase 4 gate blocked on journaled exclusive maintenance, installed-service wiring and the remaining release gates.
