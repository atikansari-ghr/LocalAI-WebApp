# Security core — phase 2 in progress

These modules are under development. A reviewed security preview is deployed behind the configured HTTPS proxy on the disposable LXC. A public application inference API is not implemented. Full phase 2 acceptance remains blocked on complete browser authentication, passkey and recovery qualification.

## Identity and setup
There is no default account. The service layer issues random 256-bit one-time setup codes with 30-minute expiry. Claiming a valid code creates a pending administrator; a 10-minute enrollment token and TOTP verification activate it. Concurrent claims are serialized in SQLite. The operator may reissue setup only before initialization, removing the abandoned pending account. After configuring and verifying HTTPS, an operator can run:

```sh
sudo -u localai /opt/localai/node/bin/node /opt/localai/current/scripts/setup-code.mjs --config /etc/localai/gateway.env
```

Keep the printed code private and enter it at the configured origin's /setup page within 30 minutes. Run as the service account so new state files retain correct ownership. The tool refuses to reset a configured administrator. TOTP enrollment requires an authenticator app; recovery codes are displayed once after verification. No password or enrollment/session token is returned through a URL. Account and vault recovery after completed setup remain pending operational features.

Passwords use Node's scrypt implementation with N=32768, r=8, p=3, unique 128-bit salts and 64-byte outputs. This matches the 32 MiB profile in the [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Passwords require at least 12 characters and at most 1024 UTF-8 bytes. Malformed stored parameters cannot force arbitrary KDF costs.

TOTP uses SHA-1, six digits and a 30-second step with one adjacent step of tolerance. Accepted counters are recorded transactionally to deny replay. Ten independent random recovery codes are returned once; only their hashes persist. Recovery login requires the password and consumes a code atomically. Security events record action/actor/target/outcome, never password, TOTP or recovery values.

Source attempts use normalized IP addresses and five-attempt/15-minute persistent buckets. A separate five-attempt/15-minute account/enrollment budget is shared across login, MFA enrollment, step-up and known passkey verification, so rotating source addresses cannot bypass it. A successful verified authentication resets that identity's failure budget. A locked identity waits for the window; no unauthenticated unlock route exists. Administrative lockout/recovery controls remain part of the pending UI/CLI task.

## Sessions and permissions
Session tokens have 256-bit entropy and only SHA256 verification digests persist. Absolute lifetime is eight hours; idle timeout is 30 minutes. Privileged actions require a fresh MFA-backed session within five minutes and the session-bound HMAC CSRF token. Browser routes require the exact configured Host, HTTPS from the configured transport, and exact Origin plus CSRF for mutations. Session, enrollment and preauthentication cookies use the __Host- prefix, Secure, HttpOnly, SameSite=Strict and Path=/. Sessions never appear in response JSON. Requests have bounded headers, body size and timeouts. Browser acceptance is still pending; service tests alone do not qualify a deployed web application.

The implemented administrator boundary protects application provisioning, rotation and revocation. General user/group management and the complete RBAC control surface remain pending. Password, TOTP and passkey login methods are separate from application credentials.

## Vault
TOTP values are encrypted with AES-256-GCM and purpose-bound authenticated data. The random master key is a separate 32-byte, owner-only file, never a database field. Opening requires an existing key; explicit initialization requires proof that no encrypted state exists, supplied from the repository. A missing or incomplete key fails closed and is never silently regenerated. Tampering, changed purpose and malformed envelopes also fail closed. Do not delete or regenerate a master key to repair an existing vault. The complete encrypted backup/recovery/export workflow is not yet implemented.

## Applications and network policy
Each application has exactly one current random API key digest. Rotation immediately replaces it; revocation clears it and disables the application. Optional expiry, capability permissions, IP/CIDR restrictions and explicit document scopes are checked on every authorization. The application ID determines its namespace; a caller cannot select another application's namespace. RAG/ingestion/document operations require at least one explicitly permitted scope.

Only explicitly configured trusted proxy hops may influence the effective source address. The resolver walks the forwarded chain from the socket peer toward the first untrusted hop, and rejects malformed chains from trusted peers. Untrusted peers' forwarded headers are ignored. Browser routes in proxy mode also reject untrusted socket peers and require forwarded HTTPS status and the exact configured Host.

## Passkeys
The pinned dependency is @simplewebauthn/server 14.0.3, MIT, checked against its [official server documentation](https://simplewebauthn.dev/docs/packages/server) and npm metadata. The exact transitive graph and integrity hashes are in package-lock.json. Dependency installation disables lifecycle scripts. The audit reported no known vulnerabilities when checked on 2026-10-18; this is not a guarantee of absence.

Passkey services require an exact HTTPS DNS origin and RP hostname, with localhost allowed for local development. User verification is mandatory. Registration is bound to a fresh authenticated session; only requested no-attestation credentials are accepted, avoiding outbound attestation metadata lookups. Challenges expire after five minutes and are consumed before verification. Public keys and counters are stored transactionally. A real synthetic P-256 authenticator test signs assertions and exercises replay, invalid signatures, wrong origins and expiry.

The browser hostname is https://localai.ansariz.biz. The user completed administrator enrollment and confirmed successful login on 2026-10-18; service readiness independently confirms setup is complete. No administrator credential was created by the service tests. Real physical-passkey and recovery browser journeys remain unqualified.
