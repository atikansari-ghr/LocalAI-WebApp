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

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils util-linux
install -d -m 0755 /opt/localai /opt/localai/releases /opt/localai/runtimes
exec 9>/opt/localai/install.lock
flock -n 9 || fail "Another installation is active"
stage=$(mktemp -d /opt/localai/.stage.XXXXXXXX)
previous=$(readlink /opt/localai/current || true)
switched=0
cleanup() {
  result=$?
  trap - EXIT
  if [[ $result != 0 && $switched == 1 ]]; then
    if [[ -n $previous ]]; then
      ln -s "$previous" /opt/localai/current.rollback
      mv -Tf /opt/localai/current.rollback /opt/localai/current
      systemctl restart localai.service || true
    else
      systemctl stop localai.service || true
      rm -f /opt/localai/current
    fi
    echo "Install failed. Previous code restored where available; state was preserved. Inspect journalctl -u localai." >&2
  fi
  [[ $stage == /opt/localai/.stage.* && -d $stage ]] && rm -rf -- "$stage"
  exit "$result"
}
trap cleanup EXIT
runtime="/opt/localai/runtimes/node-v$NODE_VERSION-linux-$arch"
if [[ ! -x "$runtime/bin/node" ]]; then
  archive="node-v$NODE_VERSION-linux-$arch.tar.xz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$NODE_VERSION/$archive" -o "$stage/$archive"
  printf '%s  %s\n' "$checksum" "$stage/$archive" | sha256sum -c -
  tar -xJf "$stage/$archive" -C "$stage" --no-same-owner
  mv "$stage/node-v$NODE_VERSION-linux-$arch" "$runtime"
fi
"$runtime/bin/node" "$source_root/installer/preflight.mjs"
id localai >/dev/null 2>&1 || useradd --system --home-dir /var/lib/localai --shell /usr/sbin/nologin localai
install -d -m 0700 -o localai -g localai /var/lib/localai /var/cache/localai /var/log/localai
install -d -m 0750 -o root -g localai /etc/localai
if [[ ! -e /etc/localai/gateway.env ]]; then
  printf 'LOCALAI_HOST=127.0.0.1\nLOCALAI_PORT=1234\nLOCALAI_STATE_DIR=/var/lib/localai\n' > /etc/localai/gateway.env
  chown root:localai /etc/localai/gateway.env
  chmod 0640 /etc/localai/gateway.env
fi
deployment="/opt/localai/releases/$revision"
if [[ ! -d $deployment ]]; then
  mkdir "$stage/source"
  git -C "$source_root" archive HEAD | tar -xf - -C "$stage/source"
  chmod -R u=rwX,go=rX "$stage/source"
  mv "$stage/source" "$deployment"
fi
# Preserve the pre-migration database before code activation. This phase has one additive migration.
if [[ -e /var/lib/localai/platform.sqlite ]]; then
  install -d -m 0700 -o localai -g localai /var/lib/localai/pre-install-backups
  runuser -u localai -- "$runtime/bin/node" "$deployment/scripts/backup-state.mjs" /var/lib/localai/platform.sqlite "/var/lib/localai/pre-install-backups/$(date -u +%Y%m%dT%H%M%S)-$revision.sqlite"
fi
ln -s "$runtime" "$stage/node"
mv -Tf "$stage/node" /opt/localai/node
ln -s "$deployment" "$stage/current"
mv -Tf "$stage/current" /opt/localai/current
switched=1
install -m 0644 "$deployment/installer/localai.service" /etc/systemd/system/localai.service
systemctl daemon-reload
systemctl enable localai.service
systemctl restart localai.service
for attempt in {1..15}; do
  if curl --fail --silent --noproxy '*' http://127.0.0.1:1234/health/live >/dev/null; then
    echo "Foundation installed. Loopback liveness passed; platform readiness and production release remain BLOCKED."
    exit 0
  fi
  sleep 1
done
fail "Gateway liveness failed"
