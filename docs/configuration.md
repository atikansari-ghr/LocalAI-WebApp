# Configuration reference
The registry at packages/shared/settings.json supplies defaults, help text and stable anchors. Only the three settings below exist in the foundation. Unknown LOCALAI_ names are rejected to prevent ignored typos. Changes require a service restart; values are not exposed through HTTP.

## Gateway host
Anchor: gateway-host.
LOCALAI_HOST; default 127.0.0.1. Allowed: 127.0.0.1 or ::1. Other addresses fail startup. IPv6 loopback depends on host support. Public/LAN binding will be introduced only with authenticated setup and TLS controls. More exposure is not configurable in this phase.

## Gateway port
Anchor: gateway-port.
LOCALAI_PORT; default 1234. Valid integer range 1–65535; port zero and mixed text are rejected. Pick an unused unprivileged port; privileged ports conflict with the service's empty capability set. Changing this port requires updating local diagnostics. Lower/higher port numbers do not affect inference speed.

## State directory
Anchor: state-directory.
LOCALAI_STATE_DIR; development default .localai relative to the working directory, systemd default /var/lib/localai. Must be nonempty; resolves to an absolute path. It must be private and writable by the service account, must not be served as web content and should remain on the LXC's local disk for SQLite WAL. Protect disk space and backup access. systemd only grants writes to its managed state/cache/log directories.

## Help integration
There is no settings UI yet. When built, its tooltips must consume this registry and link to these built-in documentation sections. Registry coverage is checked now; actual UI tooltips and screenshots cannot be accepted before a UI exists.
