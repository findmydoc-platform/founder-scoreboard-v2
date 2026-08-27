#!/usr/bin/env bash
set -euo pipefail

operation="${1:-}"

validate_inputs() {
  if [[ "${CUTOVER_OPERATION}" == "backup" ]]; then
    [[ "${AGE_RECIPIENT:-}" =~ ^age1[0-9a-z]{58}$ ]] || {
      echo "::error::A valid public age recipient is required for backup."
      exit 1
    }
    return
  fi

  for hash in \
    "${EXPECTED_APPLICATION_SHA256:-}" \
    "${EXPECTED_LEDGER_SHA256:-}" \
    "${RESTORE_MANIFEST_SHA256:-}"; do
    [[ "$hash" =~ ^[a-f0-9]{64}$ ]] || {
      echo "::error::Repair requires three valid SHA-256 evidence values."
      exit 1
    }
  done
  [[ "${CONFIRMATION:-}" =~ ^repair-[0-9]{14}$ ]] || {
    echo "::error::Repair confirmation is invalid."
    exit 1
  }
}

configure_service() {
  local service_file="${RUNNER_TEMP}/pg_service.conf"
  install -m 600 /dev/null "$service_file"
  {
    echo "[founderops-production]"
    printf 'host=%s\n' "$SUPABASE_DB_HOST"
    printf 'user=%s\n' "$SUPABASE_DB_USER"
    echo "dbname=postgres"
    echo "port=5432"
    echo "sslmode=require"
  } >> "$service_file"
  echo "PGSERVICEFILE=$service_file" >> "$GITHUB_ENV"
  echo "PGSERVICE=founderops-production" >> "$GITHUB_ENV"
}

export_backup() {
  local backup_dir="${RUNNER_TEMP}/founderops-cutover-backup"
  local database_url="postgresql:///postgres?service=founderops-production"
  local manifest_file="${RUNNER_TEMP}/manifest.sha256"

  mkdir -p "$backup_dir"
  node scripts/supabase-baseline-cutover.mjs snapshot
  pnpm exec supabase db dump --db-url "$database_url" --file "$backup_dir/roles.sql" --role-only
  pnpm exec supabase db dump --db-url "$database_url" --file "$backup_dir/schema.sql"
  pnpm exec supabase db dump --db-url "$database_url" --file "$backup_dir/data.sql" --use-copy --data-only \
    --exclude storage.buckets_vectors --exclude storage.vector_indexes
  pnpm exec supabase db dump --db-url "$database_url" --file "$backup_dir/history-schema.sql" \
    --schema supabase_migrations
  pnpm exec supabase db dump --db-url "$database_url" --file "$backup_dir/history-data.sql" \
    --use-copy --data-only --schema supabase_migrations

  BACKUP_DIR="$backup_dir" node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";
import { normalizeSchemaDump, sha256 } from "./scripts/lib/supabase-baseline-cutover.mjs";
const schema = await readFile(`${process.env.BACKUP_DIR}/schema.sql`, "utf8");
await writeFile(
  `${process.env.BACKUP_DIR}/schema-normalized.sha256`,
  `${sha256(normalizeSchemaDump(schema))}\n`,
  { mode: 0o600 },
);
NODE

  (
    cd "$backup_dir"
    find . -type f -print0 | sort -z | xargs -0 sha256sum > "$manifest_file"
  )
  mv "$manifest_file" "$backup_dir/manifest.sha256"
  tar -C "$backup_dir" -czf "${RUNNER_TEMP}/founderops-production-backup.tar.gz" .
  age --recipient "$AGE_RECIPIENT" \
    --output "${RUNNER_TEMP}/founderops-production-backup.tar.gz.age" \
    "${RUNNER_TEMP}/founderops-production-backup.tar.gz"
  sha256sum "${RUNNER_TEMP}/founderops-production-backup.tar.gz.age" \
    > "${RUNNER_TEMP}/founderops-production-backup.tar.gz.age.sha256"
}

repair_ledger() {
  mkdir -p "$CUTOVER_OUTPUT_DIR"
  node scripts/supabase-baseline-cutover.mjs repair
}

cleanup() {
  rm -rf \
    "${RUNNER_TEMP}/founderops-cutover-backup" \
    "${RUNNER_TEMP}/founderops-cutover-repair" \
    "${RUNNER_TEMP}/founderops-production-backup.tar.gz" \
    "${RUNNER_TEMP}/manifest.sha256" \
    "${RUNNER_TEMP}/pg_service.conf"
}

case "$operation" in
  validate) validate_inputs ;;
  configure) configure_service ;;
  backup) export_backup ;;
  repair) repair_ledger ;;
  cleanup) cleanup ;;
  *)
    echo "Usage: $0 <validate|configure|backup|repair|cleanup>" >&2
    exit 2
    ;;
esac
