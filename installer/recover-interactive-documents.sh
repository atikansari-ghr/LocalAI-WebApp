#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo 'Debian 13 root is required' >&2; exit 1; }
[[ $# == 1 && $1 == --recover ]] || { echo 'Use --recover' >&2; exit 1; }
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ $(realpath -e -- "$source_root") == "$(realpath -e -- /opt/localai/current)" ]] || { echo 'The installed Local AI source is required' >&2; exit 1; }
command -v flock >/dev/null || { echo 'util-linux flock is required' >&2; exit 1; }

exec 9>/opt/localai/install.lock
flock -n 9 || { echo 'Another Local AI installation is active' >&2; exit 1; }
exec 8>/run/lock/localai-ai.lock
flock -n 8 || { echo 'Another Local AI runtime operation is active' >&2; exit 1; }
exec /opt/localai/node/bin/node "$source_root/installer/recover-interactive-documents.mjs" --recover
