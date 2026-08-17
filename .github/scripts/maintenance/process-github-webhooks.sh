#!/usr/bin/env bash
set -euo pipefail

valid_response() {
  local response="$1"
  jq -e '
    .ok == true
    and (.projection.claimed | type == "number")
    and (.projection.completed | type == "number")
    and (.projection.retryScheduled | type == "number")
    and (.projection.failed | type == "number")
    and (.planning.claimed | type == "number")
    and (.planning.processed | type == "number")
    and (.planning.ignored | type == "number")
    and (.planning.retryScheduled | type == "number")
    and (.planning.failed | type == "number")
    and (.comments.claimed | type == "number")
    and (.comments.processed | type == "number")
    and (.comments.ignored | type == "number")
    and (.comments.retryScheduled | type == "number")
    and (.comments.failed | type == "number")
    and (.terminalFailed | type == "number")
    and (.outstanding | type == "number")
    and (.projectionTerminalFailed | type == "number")
    and (.projectionOutstanding | type == "number")
    and .projection.retryScheduled == 0
    and .projection.failed == 0
    and .planning.retryScheduled == 0
    and .planning.failed == 0
    and .comments.retryScheduled == 0
    and .comments.failed == 0
    and .projectionTerminalFailed == 0
    and .terminalFailed == 0
  ' <<< "$response" > /dev/null
}

main() {
  : "${APP_URL:?APP_URL is required}"
  : "${FOUNDEROPS_MAINTENANCE_SECRET:?FOUNDEROPS_MAINTENANCE_SECRET is required}"

  local app_url="${APP_URL%/}"
  local response_file
  local error_file
  local response
  local attempt=1
  local backoff
  local jitter
  local wait_seconds
  local -a backoffs=(0 45 90 180)

  response_file="$(mktemp)"
  error_file="$(mktemp)"
  trap "rm -f '$response_file' '$error_file'" EXIT

  echo "Warming up the runner before the first network request."
  sleep 45

  for backoff in "${backoffs[@]}"; do
    if (( backoff > 0 )); then
      jitter=$((RANDOM % 6))
      wait_seconds=$((backoff + jitter))
      echo "Retry ${attempt}/4 after ${wait_seconds}s."
      sleep "$wait_seconds"
    fi
    if ! curl --fail-with-body --show-error --silent \
      --connect-timeout 15 --max-time 45 \
      "${app_url}/api/health" > /dev/null 2> "$error_file"; then
      echo "Health preflight failed on attempt ${attempt}: $(<"$error_file")" >&2
      attempt=$((attempt + 1))
      continue
    fi
    if ! curl --fail-with-body --show-error --silent \
      --connect-timeout 15 --max-time 120 \
      --request POST \
      --header "x-founderops-maintenance-secret: ${FOUNDEROPS_MAINTENANCE_SECRET}" \
      "${app_url}/api/maintenance/github-webhooks" > "$response_file" 2> "$error_file"; then
      echo "GitHub webhook maintenance failed on attempt ${attempt}: $(<"$error_file")" >&2
      attempt=$((attempt + 1))
      continue
    fi
    response="$(<"$response_file")"
    if ! valid_response "$response"; then
      echo "GitHub webhook maintenance returned an unhealthy result on attempt ${attempt}: ${response}" >&2
      attempt=$((attempt + 1))
      continue
    fi
    echo "GitHub webhook maintenance completed: ${response}"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      {
        echo "## GitHub Webhook Maintenance"
        echo
        echo '```json'
        echo "$response"
        echo '```'
      } >> "$GITHUB_STEP_SUMMARY"
    fi
    return 0
  done
  echo "GitHub webhook maintenance failed after four attempts." >&2
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
