# Phase 4 synthetic HTTP-to-worker proof — 2026-10-20

On the disposable Debian 13 LXC, a temporary restricted document supervisor service and a synthetic HTTPS-proxy-mode gateway handler completed one Arabic/English TXT request through the entire candidate path: browser bootstrap and MFA setup, CSRF-protected `POST /v1/extract`, bounded private Unix socket, encrypted SQLite job claim, transient systemd worker, and scoped `GET /v1/documents/{id}/status`. The returned text exactly matched `مرحبا browser-to-worker`.

This proof used a synthetic administrator, disposable root-only authentication/document stores, an ephemeral loopback HTTP listener and the candidate service under `/opt/localai/documents/candidates/`. The gateway handler was injected with the candidate document client for the proof; the enrolled gateway was not changed and retained PID 19963. Cleanup stopped the temporary service, verified no active document worker units, and removed both synthetic stores. Separate proofs cover access from the real `localai` service account and service restart with an orphaned worker.

Public document routes are still disabled on the deployed gateway. This proof covers the text extraction path, not OCR/rich formats, deletion, sustained joint load, production activation or the whole Phase 4 release gate.
