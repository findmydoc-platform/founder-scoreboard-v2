#!/usr/bin/env bash
set -euo pipefail

validate_lifecycle_response() {
  local response="$1"
  jq -e '
    .ok == true
    and (.claimed | type == "number")
    and (.completed | type == "number")
    and (.retryScheduled | type == "number")
    and (.failed | type == "number")
    and .claimed >= 0
    and .completed >= 0
    and .completed == .claimed
    and .retryScheduled == 0
    and .failed == 0
  ' <<< "$response" > /dev/null
}

validate_purge_response() {
  local response="$1"
  jq -e '
    .ok == true
    and .busy == false
    and (.purgedRoots | type == "number")
    and (.purgedTasks | type == "number")
    and (.resolvedNotifications | type == "number")
    and (.hasMore | type == "boolean")
    and .purgedRoots >= 0
    and .purgedRoots <= 25
    and .purgedTasks >= 0
    and .resolvedNotifications >= 0
    and ((.hasMore == false) or (.purgedRoots == 25))
  ' <<< "$response" > /dev/null
}

main() {
  : "${APP_URL:?APP_URL is required}"
  : "${FOUNDEROPS_MAINTENANCE_SECRET:?FOUNDEROPS_MAINTENANCE_SECRET is required}"

  local app_url="${APP_URL%/}"
  local response_file
  local error_file
  local lifecycle_response
  local purge_response
  local jitter
  local wait_seconds
  local attempt=1
  local backoff
  local -a backoffs=(0 45 90 180)

  response_file="$(mktemp)"
  error_file="$(mktemp)"
  trap "rm -f '$response_file' '$error_file'" EXIT

  echo "Warming up the local runner before the first network request."
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
    if ! validate_lifecycle_response "$lifecycle_response"; then
      echo "GitHub lifecycle returned an incomplete batch on attempt ${attempt}: ${lifecycle_response}" >&2
      attempt=$((attempt + 1))
      continue
    fi

    if ! curl --fail-with-body --show-error --silent \
      --connect-timeout 15 --max-time 90 \
      --request POST \
      --header "x-founderops-maintenance-secret: ${FOUNDEROPS_MAINTENANCE_SECRET}" \
      "${app_url}/api/maintenance/planning-trash/purge" \
      > "$response_file" 2> "$error_file"; then
      echo "Purge request failed on attempt ${attempt}: $(<"$error_file")" >&2
      attempt=$((attempt + 1))
      continue
    fi
    purge_response="$(<"$response_file")"
    if ! validate_purge_response "$purge_response"; then
      echo "Purge returned a busy or blocked batch on attempt ${attempt}: ${purge_response}" >&2
      attempt=$((attempt + 1))
      continue
    fi

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
    return 0
  done

  echo "Planning trash purge failed after four attempts." >&2
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
