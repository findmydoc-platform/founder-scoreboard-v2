#!/usr/bin/env bash
set -euo pipefail

if ! command -v rtk >/dev/null 2>&1; then
  echo "Codex bootstrap requires rtk to be available on PATH." >&2
  exit 127
fi

git_cmd() {
  rtk proxy git "$@"
}

if ! git_cmd rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Codex bootstrap must run inside a Git worktree." >&2
  exit 1
fi

repo_root="$(git_cmd rev-parse --show-toplevel)"
cd "$repo_root"

current_branch="$(git_cmd symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ -n "$current_branch" ]]; then
  echo "Refusing to align Codex setup on named branch '$current_branch'. Expected a detached Codex worktree." >&2
  exit 1
fi

if [[ -n "$(git_cmd status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing to align Codex setup because tracked changes are present." >&2
  git_cmd status --short --untracked-files=no >&2
  exit 1
fi

git_cmd fetch --prune origin main
git_cmd rev-parse --verify origin/main >/dev/null
git_cmd switch --detach --quiet origin/main

head_sha="$(git_cmd rev-parse HEAD)"
origin_main_sha="$(git_cmd rev-parse origin/main)"
if [[ "$head_sha" != "$origin_main_sha" ]]; then
  echo "Codex bootstrap failed to align HEAD with origin/main." >&2
  echo "HEAD: $head_sha" >&2
  echo "origin/main: $origin_main_sha" >&2
  exit 1
fi

rtk bash scripts/codex-pnpm.sh install --frozen-lockfile
