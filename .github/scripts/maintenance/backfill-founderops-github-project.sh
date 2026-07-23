#!/usr/bin/env bash
set -euo pipefail

write_summary() {
  local response_file="$1"
  if [[ -z "${GITHUB_STEP_SUMMARY:-}" ]]; then
    return
  fi
  {
    echo "## FounderOps GitHub Project backfill"
    echo
    jq -r '
      .report as $report
      | "- Mode: **\($report.mode)**",
        "- Target: **\($report.target.owner)#\($report.target.number)**",
        "- Linked FounderOps items: **\($report.inventory.linked)**",
        "- Processed: **\($report.summary.processed)**",
        "- Applied items: **\($report.summary.appliedItems)**",
        "- Existing memberships: **\($report.summary.existing)**",
        "- Missing memberships: **\($report.summary.missing)**",
        "- Added memberships: **\($report.summary.added)**",
        "- Field warnings: **\($report.summary.warnings)**",
        "- Errors: **\($report.summary.errors)**"
    ' "$response_file"
  } >> "$GITHUB_STEP_SUMMARY"
}

validate_response() {
  local response_file="$1"
  jq -e '
    .ok == true
    and (.report.inventory.linked | type == "number")
    and (.report.summary.processed | type == "number")
    and (.report.summary.appliedItems | type == "number")
    and (.report.summary.errors == 0)
    and (.report.invalidTasks | length == 0)
  ' "$response_file" > /dev/null
}

request_backfill() {
  local response_file="$1"
  local error_file="$2"
  local app_url="${APP_URL%/}"

  if [[ "$BACKFILL_MODE" == "dry-run" ]]; then
    curl --fail-with-body --show-error --silent \
      --connect-timeout 15 --max-time 300 \
      --get \
      --header "x-founderops-delivery-secret: ${FOUNDEROPS_DELIVERY_SECRET}" \
      --header "x-founderops-github-actor: ${FOUNDEROPS_GITHUB_ACTOR}" \
      --data-urlencode "afterTaskId=${BACKFILL_AFTER_TASK_ID}" \
      --data-urlencode "batchSize=${BACKFILL_BATCH_SIZE}" \
      --data-urlencode "expectedOwner=${BACKFILL_EXPECTED_OWNER}" \
      --data-urlencode "expectedProjectNumber=${BACKFILL_EXPECTED_PROJECT_NUMBER}" \
      --data-urlencode "includeNotSynced=${BACKFILL_INCLUDE_NOT_SYNCED}" \
      --data-urlencode "repository=${BACKFILL_REPOSITORY}" \
      "${app_url}/api/maintenance/github-project-backfill" \
      > "$response_file" 2> "$error_file"
    return
  fi

  local payload
  payload="$(jq -n \
    --arg afterTaskId "$BACKFILL_AFTER_TASK_ID" \
    --argjson batchSize "$BACKFILL_BATCH_SIZE" \
    --arg expectedOwner "$BACKFILL_EXPECTED_OWNER" \
    --argjson expectedProjectNumber "$BACKFILL_EXPECTED_PROJECT_NUMBER" \
    --argjson includeNotSynced "$BACKFILL_INCLUDE_NOT_SYNCED" \
    --arg repository "$BACKFILL_REPOSITORY" \
    '{
      afterTaskId: $afterTaskId,
      batchSize: $batchSize,
      expectedOwner: $expectedOwner,
      expectedProjectNumber: $expectedProjectNumber,
      includeNotSynced: $includeNotSynced,
      repository: $repository
    }')"
  curl --fail-with-body --show-error --silent \
    --connect-timeout 15 --max-time 300 \
    --request POST \
    --header "content-type: application/json" \
    --header "x-founderops-delivery-secret: ${FOUNDEROPS_DELIVERY_SECRET}" \
    --header "x-founderops-github-actor: ${FOUNDEROPS_GITHUB_ACTOR}" \
    --data "$payload" \
    "${app_url}/api/maintenance/github-project-backfill" \
    > "$response_file" 2> "$error_file"
}

main() {
  : "${APP_URL:?APP_URL is required}"
  : "${BACKFILL_BATCH_SIZE:?BACKFILL_BATCH_SIZE is required}"
  : "${BACKFILL_EXPECTED_OWNER:?BACKFILL_EXPECTED_OWNER is required}"
  : "${BACKFILL_EXPECTED_PROJECT_NUMBER:?BACKFILL_EXPECTED_PROJECT_NUMBER is required}"
  : "${BACKFILL_INCLUDE_NOT_SYNCED:?BACKFILL_INCLUDE_NOT_SYNCED is required}"
  : "${BACKFILL_MODE:?BACKFILL_MODE is required}"
  : "${BACKFILL_REPORT_PATH:?BACKFILL_REPORT_PATH is required}"
  : "${BACKFILL_REPOSITORY:?BACKFILL_REPOSITORY is required}"
  : "${FOUNDEROPS_DELIVERY_SECRET:?FOUNDEROPS_DELIVERY_SECRET is required}"
  : "${FOUNDEROPS_GITHUB_ACTOR:?FOUNDEROPS_GITHUB_ACTOR is required}"
  BACKFILL_AFTER_TASK_ID="${BACKFILL_AFTER_TASK_ID:-}"
  if [[ "$BACKFILL_MODE" != "dry-run" && "$BACKFILL_MODE" != "apply" ]]; then
    echo "BACKFILL_MODE must be dry-run or apply." >&2
    return 1
  fi

  local response_file
  local error_file
  response_file="$(mktemp)"
  error_file="$(mktemp)"
  trap "rm -f '$response_file' '$error_file'" EXIT

  local attempt=1
  local backoff
  local jitter
  local wait_seconds
  local -a backoffs=(0 45 90 180)
  for backoff in "${backoffs[@]}"; do
    if (( backoff > 0 )); then
      jitter=$((RANDOM % 6))
      wait_seconds=$((backoff + jitter))
      echo "Health preflight retry ${attempt}/4 after ${wait_seconds}s."
      sleep "$wait_seconds"
    fi
    if curl --fail-with-body --show-error --silent \
      --connect-timeout 15 --max-time 45 \
      "${APP_URL%/}/api/health" > /dev/null 2> "$error_file"; then
      break
    fi
    if (( attempt == 4 )); then
      echo "Health preflight failed after four attempts: $(<"$error_file")" >&2
      return 1
    fi
    attempt=$((attempt + 1))
  done

  if [[ "$BACKFILL_MODE" == "apply" ]]; then
    if ! request_backfill "$response_file" "$error_file"; then
      echo "Apply request had an ambiguous failure. Do not replay blindly; rerun the workflow so the endpoint observes current state first." >&2
      echo "Backfill request failed: $(<"$error_file")" >&2
      return 1
    fi
  else
    attempt=1
    for backoff in "${backoffs[@]}"; do
      if (( backoff > 0 )); then
        jitter=$((RANDOM % 6))
        wait_seconds=$((backoff + jitter))
        echo "Dry-run retry ${attempt}/4 after ${wait_seconds}s."
        sleep "$wait_seconds"
      fi
      if request_backfill "$response_file" "$error_file"; then
        break
      fi
      if (( attempt == 4 )); then
        echo "Dry-run request failed after four attempts: $(<"$error_file")" >&2
        return 1
      fi
      attempt=$((attempt + 1))
    done
  fi

  cp "$response_file" "$BACKFILL_REPORT_PATH"
  write_summary "$response_file"
  if ! validate_response "$response_file"; then
    echo "Backfill returned invalid tasks or processing errors. Inspect the uploaded report." >&2
    return 1
  fi
  jq -c '{inventory:.report.inventory,mode:.report.mode,summary:.report.summary,target:.report.target}' "$response_file"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
