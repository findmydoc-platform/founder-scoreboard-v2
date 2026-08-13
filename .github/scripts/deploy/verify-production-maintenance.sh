#!/usr/bin/env bash
set -euo pipefail

expected_state="${1:-}"
app_url="${APP_URL:-}"

if [[ "${expected_state}" != "active" && "${expected_state}" != "inactive" ]]; then
  echo "Expected state must be active or inactive." >&2
  exit 1
fi
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
  if node - "${response_file}" "${expected_state}" "${status}" <<'NODE'
const fs = require("node:fs");
const [file, expected, status] = process.argv.slice(2);
let body;
try { body = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(1); }
const valid = expected === "active"
  ? status === "503" && body?.status === "maintenance"
  : status === "200" && body?.status === "ready";
process.exit(valid ? 0 : 1);
NODE
  then
    echo "Production maintenance state verified: ${expected_state}."
    exit 0
  fi
done

echo "Production maintenance state did not become ${expected_state}." >&2
exit 1
