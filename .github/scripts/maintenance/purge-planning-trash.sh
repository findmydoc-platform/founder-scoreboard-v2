#!/usr/bin/env bash
set -euo pipefail

: "${APP_URL:?APP_URL is required}"
: "${FOUNDEROPS_MAINTENANCE_SECRET:?FOUNDEROPS_MAINTENANCE_SECRET is required}"

app_url="${APP_URL%/}"
response_file="$(mktemp)"
error_file="$(mktemp)"
trap 'rm -f "$response_file" "$error_file"' EXIT

echo "Warming up the local runner before the first network request."
sleep 45

backoffs=(0 45 90 180)
attempt=1
for backoff in "${backoffs[@]}"; do
  if (( backoff > 0 )); then
    jitter=$((RANDOM % 6))
    wait_seconds=$((backoff + jitter))
    echo "Retry ${attempt}/4 after ${wait_seconds}s."
    sleep "$wait_seconds"
  fi

  if ! curl --fail-with-body --show-error --silent \
    --connect-timeout 15 --max-time 45 \
    "${app_url}/api/health" \
    > /dev/null 2> "$error_file"; then
    echo "Health preflight failed on attempt ${attempt}: $(<"$error_file")" >&2
    attempt=$((attempt + 1))
    continue
  fi

  if ! curl --fail-with-body --show-error --silent \
    --connect-timeout 15 --max-time 90 \
    --request POST \
    --header "x-founderops-maintenance-secret: ${FOUNDEROPS_MAINTENANCE_SECRET}" \
    "${app_url}/api/maintenance/planning-trash/github-lifecycle" \
    > "$response_file" 2> "$error_file"; then
    echo "GitHub lifecycle request failed on attempt ${attempt}: $(<"$error_file")" >&2
    attempt=$((attempt + 1))
    continue
  fi
  lifecycle_response="$(<"$response_file")"

  if curl --fail-with-body --show-error --silent \
    --connect-timeout 15 --max-time 90 \
    --request POST \
    --header "x-founderops-maintenance-secret: ${FOUNDEROPS_MAINTENANCE_SECRET}" \
    "${app_url}/api/maintenance/planning-trash/purge" \
    > "$response_file" 2> "$error_file"; then
    purge_response="$(<"$response_file")"
    echo "Planning trash GitHub lifecycle completed: ${lifecycle_response}"
    echo "Planning trash purge completed: ${purge_response}"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      {
        echo "## Planning Trash Maintenance"
        echo
        echo "### GitHub lifecycle"
        echo
        echo '```json'
        echo "$lifecycle_response"
        echo '```'
        echo
        echo "### Physical purge"
        echo
        echo '```json'
        echo "$purge_response"
        echo '```'
      } >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi

  echo "Purge request failed on attempt ${attempt}: $(<"$error_file")" >&2
  attempt=$((attempt + 1))
done

echo "Planning trash purge failed after four attempts." >&2
exit 1
