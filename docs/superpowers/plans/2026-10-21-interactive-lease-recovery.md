# Interrupted Interactive Lease Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear an interrupted chat marker only during a verified offline maintenance window, without allowing the document supervisor to claim work while chat or a private worker may still run.

**Architecture:** Keep normal completion in the existing barrier. Add an offline recovery operation that checks the protected marker and fixed systemd units, requires all gateway/inference/document units to be runtime-masked and fully stopped, then rechecks the marker before durable removal. It never stops or masks services itself and is not called during supervisor startup. The operator/update workflow must establish and hold the masked maintenance window.

**Tech Stack:** Node.js ESM, Debian 13 systemd, root-owned state directory, Node test runner.

**Spec:** `LOCAL_AI_MASTER_BUILD_PROMPT.md`; `docs/verification/phase-4-interactive-restart-barrier-2026-10-20.md`.

## Global Constraints

- Debian 13 Proxmox LXC, 4 vCPU, 6 GB RAM, 100 GB disk; native systemd; no Docker.
- Keep the deployed Phase 3 gateway and its administrator state unchanged during candidate testing.
- No document claim may proceed while an unclean interactive marker exists.
- Phase 4 remains inactive and draft until all release gates pass.

## Review Focus

- A unit starts or un-masks between checks: refuse marker removal.
- A unit reports inactive but retains a PID or control group: refuse marker removal.
- The marker is missing, malformed, swapped or writable: refuse recovery without deleting another file.
- The caller offers a different unit set or state directory outside the disposable target: refuse configuration.
- Recovery fails partway through: leave the marker in place and keep document claims blocked.

---

### Task 1: Protected offline marker recovery primitive

**Files:** `services/resources/interactive-lease-barrier.mjs`, `tests/interactive-lease-barrier.test.mjs`.

- [ ] Add a failing test: recovery with a rejected verifier leaves the marker and scheduler block intact.
- [ ] Add a failing test: a valid offline proof clears the same protected marker durably; wrong-token or inode replacement fails closed.
- [ ] Implement the minimal async recovery method, with callback proof while marker exists, protected descriptor checks and directory sync after unlink.
- [ ] Run focused tests on Windows and Debian; commit the primitive.

### Task 2: Fixed systemd offline proof

**Files:** `services/resources/interactive-lease-recovery.mjs`, `tests/interactive-lease-recovery.test.mjs`.

- [ ] Add failing tests for unmasked, active, lingering-PID/control-group, missing and malformed unit states.
- [ ] Add a passing case requiring four fixed units masked and inactive with zero PIDs and no control group.
- [ ] Implement a bounded `systemctl show` parser and twice-check proof, with a target-only synthetic override gated by `TARGET_TEST_LXC=disposable`.
- [ ] Run focused and full tests; commit the verifier.

### Task 3: Native synthetic recovery and evidence

**Files:** `tests/target/document-interactive-recovery.mjs`, `docs/verification/phase-4-interactive-recovery-2026-10-21.md`, `docs/progress.md`.

- [ ] Create disposable synthetic services and an interrupted marker; show a running/unmasked unit prevents recovery.
- [ ] Runtime-mask and stop only those synthetic services, recover the marker, and show a document claim can resume.
- [ ] Verify the real gateway PID, package database and real service states remain unchanged; remove synthetic resources.
- [ ] Run documentation checks and required CI, update draft PR #5, and keep Phase 4 blocked on live gateway wiring and other gates.
