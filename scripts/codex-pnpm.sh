#!/usr/bin/env bash
set -euo pipefail

if ! command -v rtk >/dev/null 2>&1; then
  echo "Codex pnpm wrapper requires rtk to be available on PATH." >&2
  exit 127
fi

pnpm_home="${PNPM_HOME:-$HOME/Library/pnpm}"
export PATH="${pnpm_home}:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install pnpm 10 or set PNPM_HOME to a directory containing pnpm." >&2
  exit 127
fi

pnpm_version="$(rtk proxy pnpm --version)"
case "$pnpm_version" in
  10.*) ;;
  *)
    echo "Expected pnpm 10.x, found pnpm ${pnpm_version}." >&2
    exit 1
    ;;
esac

exec rtk proxy pnpm "$@"
