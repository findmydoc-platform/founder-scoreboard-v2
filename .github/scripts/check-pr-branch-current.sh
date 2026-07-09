#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-main}"
CONTEXT="Branch Update Required"

status_for_result() {
  local head_sha="$1"
  local state="$2"
  local description="$3"
  local target_url="${4:-${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}}"

  gh api \
    --method POST \
    "repos/${GITHUB_REPOSITORY}/statuses/${head_sha}" \
    -f state="${state}" \
    -f context="${CONTEXT}" \
    -f description="${description}" \
    -f target_url="${target_url}" >/dev/null
}

fetch_base() {
  git fetch --no-tags origin "+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}" >/dev/null
}

fetch_head_branch() {
  local pr_number="$1"
  local head_ref="$2"
  git fetch --no-tags origin "+refs/heads/${head_ref}:refs/remotes/pr/${pr_number}/head" >/dev/null
}

check_current() {
  local pr_number="$1"
  local head_ref="$2"
  local head_repo="$3"
  local head_sha="$4"
  local pr_url="$5"
  local fail_when_stale="$6"

  if [[ "${head_repo}" != "${GITHUB_REPOSITORY}" ]]; then
    status_for_result "${head_sha}" "success" "Fork PRs are not checked for branch freshness." "${pr_url}"
    echo "- PR #${pr_number}: skipped fork branch ${head_repo}:${head_ref}" >> "${GITHUB_STEP_SUMMARY}"
    return 0
  fi

  fetch_head_branch "${pr_number}" "${head_ref}"
  local head_rev="refs/remotes/pr/${pr_number}/head"

  if git merge-base --is-ancestor "refs/remotes/origin/${BASE_BRANCH}" "${head_rev}"; then
    status_for_result "${head_sha}" "success" "Branch contains latest ${BASE_BRANCH}." "${pr_url}"
    echo "- PR #${pr_number}: current" >> "${GITHUB_STEP_SUMMARY}"
    return 0
  fi

  status_for_result "${head_sha}" "failure" "Update branch with latest ${BASE_BRANCH} before merging." "${pr_url}"
  echo "- PR #${pr_number}: update required" >> "${GITHUB_STEP_SUMMARY}"

  if [[ "${fail_when_stale}" == "true" ]]; then
    echo "Branch ${head_ref} is behind ${BASE_BRANCH}. Update the branch before merging." >&2
    return 1
  fi
}

fetch_base
{
  echo "## Branch Update Required"
  echo
} >> "${GITHUB_STEP_SUMMARY}"

if [[ "${EVENT_NAME:-}" == "pull_request" ]]; then
  check_current "${PR_NUMBER}" "${HEAD_REF}" "${HEAD_REPO}" "${HEAD_SHA}" "${PR_URL}" "true"
  exit 0
fi

open_prs="$(gh pr list --base "${BASE_BRANCH}" --state open --json number,headRefName,headRefOid,headRepository,url,isCrossRepository --jq '.[] | [.number, .headRefName, .headRefOid, .headRepository.nameWithOwner, .url] | @tsv')"

if [[ -z "${open_prs}" ]]; then
  echo "- No open PRs targeting ${BASE_BRANCH}." >> "${GITHUB_STEP_SUMMARY}"
  exit 0
fi

while IFS=$'\t' read -r pr_number head_ref head_sha head_repo pr_url; do
  check_current "${pr_number}" "${head_ref}" "${head_repo}" "${head_sha}" "${pr_url}" "false"
done <<< "${open_prs}"
