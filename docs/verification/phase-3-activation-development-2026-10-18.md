# Private activation development evidence — 2026-10-18

This is development/recovery evidence. No live runtime activation is claimed.

## Qualification executed

At clean source c2618d7297a470e1e94e0af0a718ef02c54f7a5a the root qualifier executed98/98 native tests, the real worker and router harnesses, and the isolated qualification loader fixture. It wrote a protected private-preview candidate under /opt/localai/ai/qualified for that revision and reported activated=false. Subsequent code changes require a new matching qualification; the earlier candidate is not permission to activate a later commit.

## Reversible publication

The native activation journal tests observe publication before verification, restore prior bytes and service states after verifier failure, retain a journal when restoration fails, allow recovery retry, reject unexpected paths/writable targets before mutation, and recover after a child process exits after publication.

The actual Debian systemd fixture uses uniquely named disposable units and a separate synthetic SQLite state directory. It starts a fixture gateway, records its synthetic setting, injects an invalid executable as a new unit version, and verifies recovery of prior unit bytes, disabled/active states and persisted synthetic data. The enrolled gateway's PID is asserted unchanged; no enrolled credentials or its database are test fixtures. All disposable units/files are removed afterward.

The first native run exposed systemd reset-failed returning nonzero for a newly defined unloaded unit. Reset is now optional preparatory cleanup; actual restart success is still mandatory. A complete native repeat passed after the change.

## Before live execution

Independent review of qualification/bootstrap, durable publication and the activation controller; clean-source full native qualification including the new rollback gate; required CI; same-revision unchanged-schema installation; then controlled first activation with real gateway/worker verification. Production signing, full UI/admin/backup/schema-update and remaining platform gates remain closed. Runtime updates beyond the first preview are explicitly blocked until the coordinated update workflow is qualified.
