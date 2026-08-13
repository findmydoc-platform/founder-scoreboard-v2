#!/usr/bin/env bash
set -euo pipefail

deployment_url="${1:-}"
vercel_cli_version="${VERCEL_CLI_VERSION:-54.1.0}"

if [[ -z "${deployment_url}" || "${deployment_url}" != https://*.vercel.app ]]; then
  echo "A Vercel maintenance deployment URL is required." >&2
  exit 1
fi
if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN is required." >&2
  exit 1
fi

command=(pnpm dlx "vercel@${vercel_cli_version}" promote "${deployment_url}" --yes --timeout=3m --token="${VERCEL_TOKEN}")
if [[ -n "${VERCEL_ORG_ID:-}" ]]; then command+=(--scope="${VERCEL_ORG_ID}"); fi
"${command[@]}"
echo "Maintenance deployment restored as production alias."
