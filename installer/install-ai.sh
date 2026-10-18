#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo 'Root on Debian13 Linux is required' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'This pinned starter supports x64 only' >&2; exit 1; }
[[ $# == 1 && ( $1 == --check || $1 == --download-starter || $1 == --download-fallback ) ]] || { echo 'Use --check, --download-starter or --download-fallback' >&2; exit 1; }
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node=/opt/localai/node/bin/node
[[ -x $node ]] || { echo 'Install the tested Local AI foundation runtime first' >&2; exit 1; }
"$node" "$source_root/installer/preflight.mjs"
exec flock -n /run/lock/localai-ai.lock "$node" "$source_root/installer/install-ai.mjs" "$1"
