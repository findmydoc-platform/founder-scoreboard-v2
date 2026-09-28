#!/usr/bin/env bash
set -euo pipefail

app_url="${APP_URL:-}"
if [[ -z "${app_url}" ]]; then
  echo "APP_URL is required." >&2
  exit 1
fi

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT
backoffs=(0 5 10 20)

for delay in "${backoffs[@]}"; do
  if [[ "${delay}" -gt 0 ]]; then sleep "${delay}"; fi
  status="$(curl --silent --show-error --output "${response_file}" --write-out '%{http_code}' "${app_url%/}/api/health" || true)"
  if node - "${response_file}" "${status}" <<'NODE'
const fs = require("node:fs");
const [file, status] = process.argv.slice(2);
let body;
try { body = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(1); }
process.exit(status === "200" && body?.status === "ready" ? 0 : 1);
NODE
  then
    echo "Production application is ready."
    exit 0
  fi
done

echo "Production application did not become ready." >&2
exit 1
