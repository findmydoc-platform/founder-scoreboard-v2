#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
vercel_cli_version="${VERCEL_CLI_VERSION:-54.1.0}"
runner_temp="${RUNNER_TEMP:-}"
max_inspect_attempts="${VERCEL_INSPECT_MAX_ATTEMPTS:-18}"
inspect_delay_seconds="${VERCEL_INSPECT_DELAY_SECONDS:-10}"

case "${target}" in
  preview)
    deploy_target_args=(--target=preview)
    label="Preview"
    ;;
  production)
    deploy_target_args=(--prod)
    label="Production"
    ;;
  *)
    echo "Unsupported target '${target}'. Use 'preview' or 'production'." >&2
    exit 1
    ;;
esac

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN is required." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash "${script_dir}/assert-vercel-project-binding.sh"

if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "GITHUB_OUTPUT is required." >&2
  exit 1
fi

if [[ -z "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "GITHUB_STEP_SUMMARY is required." >&2
  exit 1
fi

if [[ -z "${runner_temp}" ]]; then
  echo "RUNNER_TEMP is required." >&2
  exit 1
fi

if [[ ! -d ".vercel/output" ]]; then
  echo ".vercel/output is missing. Run the Vercel build step before deploying." >&2
  exit 1
fi

if [[ ! -f ".vercel/project.json" ]]; then
  echo ".vercel/project.json is missing. Run the Vercel pull step before deploying." >&2
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "node_modules is missing. Run pnpm install --frozen-lockfile before deploying prebuilt output." >&2
  exit 1
fi

if [[ ! -f ".next/package.json" ]]; then
  echo ".next/package.json is missing. Run the Vercel build step before deploying." >&2
  exit 1
fi

if ! [[ "${max_inspect_attempts}" =~ ^[0-9]+$ ]] || [[ "${max_inspect_attempts}" -lt 1 ]]; then
  echo "VERCEL_INSPECT_MAX_ATTEMPTS must be a positive integer." >&2
  exit 1
fi

if ! [[ "${inspect_delay_seconds}" =~ ^[0-9]+$ ]]; then
  echo "VERCEL_INSPECT_DELAY_SECONDS must be a non-negative integer." >&2
  exit 1
fi

staging_dir="${runner_temp}/vercel-prebuilt-${target}"
deploy_output_file="$(mktemp)"
deploy_error_file="$(mktemp)"
inspect_output_file="$(mktemp)"
inspect_error_file="$(mktemp)"
promote_output_file="$(mktemp)"
promote_error_file="$(mktemp)"
trap 'rm -f "${deploy_output_file}" "${deploy_error_file}" "${inspect_output_file}" "${inspect_error_file}" "${promote_output_file}" "${promote_error_file}"' EXIT

rm -rf "${staging_dir}"
mkdir -p "${staging_dir}/.vercel"
git archive HEAD | tar -x -C "${staging_dir}"
cp -R ".vercel/output" "${staging_dir}/.vercel/output"
cp ".vercel/project.json" "${staging_dir}/.vercel/project.json"
cp "package.json" "${staging_dir}/package.json"
cp "pnpm-lock.yaml" "${staging_dir}/pnpm-lock.yaml"
cp -R "node_modules" "${staging_dir}/node_modules"
cp -R ".next" "${staging_dir}/.next"

if [[ -d "${staging_dir}/.git" ]] || find "${staging_dir}" -type d -name ".git" -print -quit | grep -q .; then
  echo "Refusing to deploy: staging directory contains Git metadata." >&2
  exit 1
fi

extract_deployment_url() {
  local file_path="$1"
  if command -v rg >/dev/null 2>&1; then
    rg -o 'https://[[:alnum:].-]+\.vercel\.app' "${file_path}" | tail -n 1 || true
    return 0
  fi

  grep -Eo 'https://[[:alnum:].-]+\.vercel\.app' "${file_path}" | tail -n 1 || true
}

is_already_current_production_error() {
  local pattern='provided deploymentId .* is already the current production deployment\. \(409\)'
  if command -v rg >/dev/null 2>&1; then
    rg -qi "${pattern}" "$@"
    return $?
  fi

  grep -Eqi "${pattern}" "$@"
}

json_field() {
  local file_path="$1"
  local field_path="$2"

  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const fieldPath = process.argv[2].split(".");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    let value = data;
    for (const segment of fieldPath) value = value?.[segment];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "${file_path}" "${field_path}"
}

add_env_flag_if_present() {
  local key="$1"
  local value="${!key-}"
  if [[ -n "${value}" ]]; then
    deploy_command+=(--env "${key}=${value}")
  fi
}

deploy_command=(pnpm dlx "vercel@${vercel_cli_version}" deploy --prebuilt --yes --no-wait --token="${VERCEL_TOKEN}" "${deploy_target_args[@]}")
if [[ -n "${VERCEL_ORG_ID:-}" ]]; then
  deploy_command+=(--scope="${VERCEL_ORG_ID}")
fi

add_env_flag_if_present "NEXT_PUBLIC_SUPABASE_URL"
add_env_flag_if_present "NEXT_PUBLIC_SUPABASE_ANON_KEY"
add_env_flag_if_present "SUPABASE_SERVICE_ROLE_KEY"
add_env_flag_if_present "REQUIRE_SUPABASE_AUTH"
add_env_flag_if_present "APP_URL"
add_env_flag_if_present "GITHUB_SYNC_OWNER"
add_env_flag_if_present "GITHUB_SYNC_REPO"
add_env_flag_if_present "GOOGLE_CHAT_DELIVERY_ENABLED"

echo "${label} deployment from Git-metadata-free prebuilt artifact."
echo "Staging directory: ${staging_dir}"

if (cd "${staging_dir}" && "${deploy_command[@]}") >"${deploy_output_file}" 2>"${deploy_error_file}"; then
  cat "${deploy_output_file}"
else
  cat "${deploy_output_file}"
  cat "${deploy_error_file}" >&2
  exit 1
fi

deployment_url="$(extract_deployment_url "${deploy_output_file}")"
if [[ -z "${deployment_url}" ]]; then
  echo "Could not parse deployment URL from Vercel output:" >&2
  cat "${deploy_output_file}" >&2
  exit 1
fi

echo "deploymentUrl=${deployment_url}" >> "${GITHUB_OUTPUT}"

inspect_command=(pnpm dlx "vercel@${vercel_cli_version}" inspect "${deployment_url}" --format=json --token="${VERCEL_TOKEN}")
if [[ -n "${VERCEL_ORG_ID:-}" ]]; then
  inspect_command+=(--scope="${VERCEL_ORG_ID}")
fi

ready_state=""
error_message=""
ready_state_reason=""
seat_block=""
promote_status="not-required"

for ((attempt = 1; attempt <= max_inspect_attempts; attempt++)); do
  if (cd "${staging_dir}" && "${inspect_command[@]}") >"${inspect_output_file}" 2>"${inspect_error_file}"; then
    ready_state="$(json_field "${inspect_output_file}" "readyState" || true)"
    error_message="$(json_field "${inspect_output_file}" "errorMessage" || true)"
    ready_state_reason="$(json_field "${inspect_output_file}" "readyStateReason" || true)"
    seat_block="$(json_field "${inspect_output_file}" "seatBlock.blockCode" || true)"

    case "${ready_state}" in
      READY|ERROR|BLOCKED|CANCELED)
        break
        ;;
    esac
  fi

  if [[ "${attempt}" -lt "${max_inspect_attempts}" ]]; then
    sleep "${inspect_delay_seconds}"
  fi
done

{
  echo "## ${label} Vercel Deployment Inspect"
  echo "- **URL**: ${deployment_url}"
  echo "- **Ready State**: ${ready_state:-unknown}"
  if [[ -n "${ready_state_reason}" ]]; then
    echo "- **Ready State Reason**: ${ready_state_reason}"
  fi
  if [[ -n "${error_message}" ]]; then
    echo "- **Error Message**: ${error_message}"
  fi
  if [[ -n "${seat_block}" ]]; then
    echo "- **Seat Block**: ${seat_block}"
  fi
  if [[ "${seat_block}" == "TEAM_ACCESS_REQUIRED" ]]; then
    echo "- **Author Access Block**: TEAM_ACCESS_REQUIRED means Vercel still attributed the deployment to a Git author outside the Hobby team."
  fi
} >> "${GITHUB_STEP_SUMMARY}"

case "${ready_state}" in
  READY)
    if [[ "${target}" == "production" ]]; then
      promote_command=(pnpm dlx "vercel@${vercel_cli_version}" promote "${deployment_url}" --yes --timeout=3m --token="${VERCEL_TOKEN}")
      if [[ -n "${VERCEL_ORG_ID:-}" ]]; then
        promote_command+=(--scope="${VERCEL_ORG_ID}")
      fi

      echo "Promoting ${deployment_url} to the current Vercel production deployment."
      if (cd "${staging_dir}" && "${promote_command[@]}") >"${promote_output_file}" 2>"${promote_error_file}"; then
        cat "${promote_output_file}"
        cat "${promote_error_file}" >&2
        promote_status="success"
      else
        cat "${promote_output_file}"
        cat "${promote_error_file}" >&2
        if is_already_current_production_error "${promote_output_file}" "${promote_error_file}"; then
          echo "Production deployment is already current; treating promotion as an idempotent success."
          promote_status="already-current"
        else
          echo "Production promotion failed for ${deployment_url}." >&2
          exit 1
        fi
      fi
    fi

    {
      echo "- **Production Promotion**: ${promote_status}"
    } >> "${GITHUB_STEP_SUMMARY}"
    echo "${label} deployment ready: ${deployment_url}"
    ;;
  BLOCKED|ERROR|CANCELED)
    echo "${label} deployment finished with readyState=${ready_state}." >&2
    if [[ -n "${ready_state_reason}" ]]; then
      echo "${ready_state_reason}" >&2
    fi
    if [[ -n "${error_message}" ]]; then
      echo "${error_message}" >&2
    fi
    if [[ -n "${seat_block}" ]]; then
      echo "seatBlock=${seat_block}" >&2
    fi
    exit 1
    ;;
  *)
    echo "${label} deployment did not reach a terminal state after inspection." >&2
    cat "${inspect_error_file}" >&2 || true
    exit 1
    ;;
esac
