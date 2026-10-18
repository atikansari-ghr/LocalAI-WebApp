# Configuration reference
The registry at packages/shared/settings.json supplies defaults, help text and stable anchors. Unknown LOCALAI_ names are rejected to prevent ignored typos. Changes require a service restart; values are not exposed through HTTP. Browser transport is under phase 2 verification and must not be treated as a qualified production release.

## Gateway host
Anchor: gateway-host.
LOCALAI_HOST; default 127.0.0.1. Must be an IP address. Loopback transport allows only 127.0.0.1 or ::1; a LAN bind requires secure transport configuration below. Prefer the specific LXC address over a wildcard. IPv6 depends on host support.

## Gateway port
Anchor: gateway-port.
LOCALAI_PORT; default 1234. Valid integer range 1–65535; port zero and mixed text are rejected. Pick an unused unprivileged port; privileged ports conflict with the service's empty capability set. Changing this port requires updating local diagnostics. Lower/higher port numbers do not affect inference speed.

## State directory
Anchor: state-directory.
LOCALAI_STATE_DIR; development default .localai relative to the working directory, systemd default /var/lib/localai. Must be nonempty; resolves to an absolute path. It must be private and writable by the service account, must not be served as web content and should remain on the LXC's local disk for SQLite WAL. Protect disk space and backup access. systemd only grants writes to its managed state/cache/log directories.

## Secure transport
Anchor: secure-transport.
LOCALAI_TRANSPORT; default loopback. The loopback mode exposes foundation health checks only. The proxy mode enables browser routes behind an explicitly trusted HTTPS reverse proxy. The tls mode requires a certificate and private key for direct HTTPS. Invalid or incomplete combinations fail startup.

## Browser origin
Anchor: browser-origin.
LOCALAI_ORIGIN; default empty. Secure modes require the exact HTTPS DNS origin without a path, query or trailing slash. For this installation use https://localai.ansariz.biz. The gateway checks Host and mutation Origin against this value; passkeys bind to its hostname. Changing the hostname invalidates the existing passkey identity and requires a planned credential migration.

## Trusted proxies
Anchor: trusted-proxies.
LOCALAI_TRUSTED_PROXIES; default empty. Comma-separated IP addresses or CIDRs, required in proxy mode. Use 192.168.10.245/32 for the confirmed Nginx Proxy Manager host. Do not trust client networks or an unrestricted CIDR. Only trusted socket peers may assert forwarded client addresses and HTTPS status; the gateway requires X-Forwarded-Proto to equal https. Network rules should also restrict the upstream port to the proxy and local administration.

## TLS certificate
Anchor: tls-certificate.
LOCALAI_TLS_CERT; default empty. Path to a PEM certificate chain, required only for direct tls mode. The service account must be able to read it. Use a certificate trusted by client browsers and renew it before expiry. The installer probes direct TLS using normal certificate validation and the configured DNS origin for hostname/SNI verification, even when connecting to a local IP. Its trust store includes Node's public roots and the explicitly configured certificate chain, permitting private/self-signed local identities without disabling verification. The configured chain is an administrator trust input; protect it against unauthorized replacement. Browser trust must be configured independently. Nginx Proxy Manager owns the browser-facing certificate in proxy mode.

## TLS private key
Anchor: tls-private-key.
LOCALAI_TLS_KEY; default empty. Path to the corresponding protected PEM private key, required only for direct tls mode. Restrict its filesystem permissions to the service account and administrator. Never paste it into the browser, diagnostic reports or source control.

## Nginx Proxy Manager deployment
The confirmed topology is browser HTTPS → localai.ansariz.biz at 192.168.10.245 → private HTTP upstream 192.168.10.214:1234. Configure a proxy host for this hostname with its valid certificate and Force SSL. Preserve the original Host header, set X-Forwarded-Proto from the incoming connection and forward client addresses. Never expose the upstream HTTP port directly to browsers. Configure only this proxy host; other applications are outside this project's scope.

The intended gateway configuration is:

```dotenv
LOCALAI_HOST=192.168.10.214
LOCALAI_PORT=1234
LOCALAI_STATE_DIR=/var/lib/localai
LOCALAI_TRANSPORT=proxy
LOCALAI_ORIGIN=https://localai.ansariz.biz
LOCALAI_TRUSTED_PROXIES=192.168.10.245/32
```

The proxy host and certificate were verified on the disposable LXC on 2026-10-18: HTTPS setup returned 200, HTTP redirected to HTTPS and direct upstream browser access returned 403. The reviewed security preview is deployed with this configuration. This does not qualify production release or the remaining browser authentication and recovery gates.

## Help integration
There is no settings UI yet. When built, its tooltips must consume this registry and link to these built-in documentation sections. Registry coverage is checked now; actual UI tooltips and screenshots cannot be accepted before a UI exists.
