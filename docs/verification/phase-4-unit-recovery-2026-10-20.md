# Phase 4 transient-unit recovery checkpoint — 2026-10-20

An inactive privileged recovery candidate now inventories only strictly named document-job transient units, stops each one, verifies an inactive/failed state with no main PID, and inventories again before allowing a caller to recover interrupted job claims. A stop error, surviving PID, malformed inventory, foreign unit name or newly active unit fails closed. The caller must hold the supervisor startup lock so no new document unit can start during this check; that persistent lock and supervisor are still to be implemented.

RED→GREEN tests cover stop failures, surviving workers, foreign unit identities and a worker that appears active again after the stop check. The focused tests pass 3/3 in a restricted Debian `DynamicUser` unit with 128 MiB cap, zero swap and 26.7 MiB observed peak.

A separate root-only Debian proof created a temporary isolated systemd service that slept as a synthetic orphan worker, claimed a synthetic encrypted job, and verified the store refused recovery before cleanup. The candidate stopped the temporary unit, checked its PID had gone, then allowed the job to become failed. The enrolled gateway PID stayed unchanged. The temporary service was never enabled at boot. This proves the systemd inventory/stop/recheck path on the target, not persistent supervisor crash recovery with actual OCR work.

The full Phase 4 release gate remains blocked by the persistent root supervisor and startup lock, job-to-unit identity binding, real cancellation and process-crash recovery, OCR/rich-format worker adapters, authenticated routes, coordinated updates and joint resource qualification.
