#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo 'Debian13 Linux root is required' >&2; exit 1; }
[[ $# == 1 && ( $1 == --activate-private-preview || $1 == --recover ) ]] || { echo 'Use --activate-private-preview or --recover' >&2; exit 1; }
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec 9>/opt/localai/install.lock
flock -n 9 || { echo 'Another application installation is active' >&2; exit 1; }
exec 8>/run/lock/localai-ai.lock
flock -n 8 || { echo 'Another runtime operation is active' >&2; exit 1; }
exec /opt/localai/node/bin/node "$source_root/installer/activate-ai.mjs" "$1"
