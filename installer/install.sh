#!/usr/bin/env bash
# Development foundation installer. Run only from a reviewed local Git checkout.
set -euo pipefail
umask 077

fail() { echo "Installation blocked: $*" >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || fail "Debian 13 Linux is required"
[[ -r /etc/os-release ]] || fail "OS identification unavailable"
# shellcheck source=/dev/null
source /etc/os-release
[[ "${ID:-}" == debian && "${VERSION_ID:-}" == 13 ]] || fail "Debian 13 is required"
[[ -d /run/systemd/system ]] || fail "Running systemd is required"
[[ $EUID == 0 ]] || fail "Run as root"
[[ $# -eq 0 || ( $# -eq 1 && $1 == --check ) ]] || fail "Only --check is supported"
[[ $(getconf _NPROCESSORS_ONLN) -ge 4 ]] || fail "At least four CPUs are required"
memory_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
[[ $memory_kb -ge 5371094 ]] || fail "At least 5.5 GB usable RAM is required"
read -r disk_kb free_kb < <(df -Pk /var/lib | awk 'NR==2 {print $2, $4}')
[[ $disk_kb -ge 87890625 && $free_kb -ge 9765625 ]] || fail "100 GB-class disk and 10 GB free are required"
[[ ${1:-} != --check ]] || { echo "Shell preflight passed; runtime/cgroup check follows during installation."; exit 0; }

source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v git >/dev/null || fail "git is required to verify the source checkout"
command -v flock >/dev/null || fail "util-linux flock is required"
[[ -z "$(git -C "$source_root" status --porcelain)" ]] || fail "Use a clean, reviewed checkout"
revision=$(git -C "$source_root" rev-parse HEAD)
[[ $revision =~ ^[a-f0-9]{40}$ ]] || fail "Invalid source revision"
# shellcheck source=runtime.env
source "$source_root/installer/runtime.env"
case "$(uname -m)" in
  x86_64) arch=x64; checksum=$NODE_X64_SHA256 ;;
  aarch64) arch=arm64; checksum=$NODE_ARM64_SHA256 ;;
  *) fail "Unsupported CPU architecture" ;;
esac

install -d -m 0755 /opt/localai /opt/localai/releases /opt/localai/runtimes
exec 9>/opt/localai/install.lock
flock -n 9 || fail "Another installation is active"
stage=$(mktemp -d /opt/localai/.stage.XXXXXXXX)
runtime="/opt/localai/runtimes/node-v$NODE_VERSION-linux-$arch"
journal=/opt/localai/activation.json
activation_started=0
previous_enabled=0
previous_active=0
systemctl is-enabled --quiet localai.service 2>/dev/null && previous_enabled=1
systemctl is-active --quiet localai.service 2>/dev/null && previous_active=1
probe_service() {
  systemctl is-active --quiet localai.service || return 1
  local pid
  pid=$(systemctl show localai.service --property=MainPID --value)
  "$runtime/bin/node" "$source_root/installer/lifecycle.mjs" probe /etc/localai/gateway.env "$pid"
}
cleanup() {
  result=$?
  trap - EXIT
  if [[ $result != 0 && $activation_started == 1 ]]; then
    systemctl stop localai.service || true
    if "$runtime/bin/node" "$source_root/installer/activation.mjs" restore "$journal"; then
      systemctl daemon-reload
      if [[ $previous_enabled == 0 ]]; then systemctl disable localai.service 2>/dev/null || true; fi
      if [[ $previous_active == 1 ]]; then
        systemctl start localai.service || true
        if ! probe_service; then echo "ROLLBACK HEALTH FAILED; service requires recovery." >&2; fi
      fi
    else
      echo "ROLLBACK FAILED; keep the protected activation journal for recovery." >&2
    fi
    echo "Install failed. State was preserved; code/runtime/unit restoration was attempted. Inspect journalctl -u localai." >&2
  fi
  [[ $stage == /opt/localai/.stage.* && -d $stage ]] && rm -rf -- "$stage"
  exit "$result"
}
trap cleanup EXIT
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils util-linux
if [[ ! -x "$runtime/bin/node" ]]; then
  archive="node-v$NODE_VERSION-linux-$arch.tar.xz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$NODE_VERSION/$archive" -o "$stage/$archive"
  printf '%s  %s\n' "$checksum" "$stage/$archive" | sha256sum -c -
  tar -xJf "$stage/$archive" -C "$stage" --no-same-owner
  mv "$stage/node-v$NODE_VERSION-linux-$arch" "$runtime"
fi
"$runtime/bin/node" "$source_root/installer/preflight.mjs"
if [[ -e $journal ]]; then
  systemctl stop localai.service || true
  "$runtime/bin/node" "$source_root/installer/activation.mjs" restore "$journal"
  systemctl daemon-reload
  echo "Recovered a previous interrupted activation; state was not rolled back."
fi
id localai >/dev/null 2>&1 || useradd --system --home-dir /var/lib/localai --shell /usr/sbin/nologin localai
install -d -m 0700 -o localai -g localai /var/lib/localai /var/cache/localai /var/log/localai
install -d -m 0750 -o root -g localai /etc/localai
if [[ ! -e /etc/localai/gateway.env ]]; then
  config_stage=$("$runtime/bin/node" "$source_root/installer/lifecycle.mjs" prepare /etc/localai/gateway.env)
  chown root:localai "$config_stage"
  chmod 0640 "$config_stage"
  "$runtime/bin/node" "$source_root/installer/lifecycle.mjs" publish "$config_stage" /etc/localai/gateway.env
fi
"$runtime/bin/node" "$source_root/installer/lifecycle.mjs" validate /etc/localai/gateway.env
deployment="/opt/localai/releases/$revision"
if [[ ! -d $deployment ]]; then
  mkdir "$stage/source"
  git -C "$source_root" archive HEAD | tar -xf - -C "$stage/source"
  chmod -R u=rwX,go=rX "$stage/source"
  mv "$stage/source" "$deployment"
fi
# Back up the actual configured database read-only, before any new migration is applied.
runuser -u localai -- "$runtime/bin/node" "$deployment/installer/lifecycle.mjs" backup /etc/localai/gateway.env
activation_started=1
"$runtime/bin/node" "$source_root/installer/activation.mjs" apply /opt/localai /etc/systemd/system/localai.service "$deployment" "$runtime" "$deployment/installer/localai.service" "$journal"
systemctl daemon-reload
systemctl enable localai.service
systemctl restart localai.service
for attempt in {1..15}; do
  if probe_service; then
    "$runtime/bin/node" "$source_root/installer/activation.mjs" commit "$journal"
    echo "Foundation installed. Service PID and configured loopback liveness passed; platform readiness and production release remain BLOCKED."
    exit 0
  fi
  sleep 1
done
fail "Gateway liveness failed"
