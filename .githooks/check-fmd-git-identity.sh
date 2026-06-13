#!/bin/sh
set -eu

required_name="Mehmet Volkan Kablan"
required_email="mehmetvolkan.kablan@findmydoc.eu"
required_github_user="MehmetVolkan"
required_repo="findmydoc-platform/founder-scoreboard-v2"
private_github_user="mehmetkablan93-byte"
private_email="mehmetkablan93@gmail.com"

fail() {
  echo "findmydoc Git identity check failed: $1" >&2
  echo "Required for this repo: $required_name <$required_email>, GitHub user $required_github_user." >&2
  echo "Use scripts/gh-fmd.ps1 for GitHub CLI commands." >&2
  exit 1
}

actual_name="$(git config --local --get user.name || true)"
actual_email="$(git config --local --get user.email || true)"
origin_url="$(git config --local --get remote.origin.url || true)"
push_url="$(git config --local --get remote.origin.pushurl || true)"
credential_user="$(git config --local --get credential.https://github.com.username || true)"

[ "$actual_name" = "$required_name" ] || fail "local user.name is '$actual_name'"
[ "$actual_email" = "$required_email" ] || fail "local user.email is '$actual_email'"

case "$origin_url" in
  *"$required_repo"*) ;;
  *) fail "origin remote is not $required_repo: $origin_url" ;;
esac

case "$origin_url $push_url $credential_user" in
  *"$private_github_user"*|*"$private_email"*) fail "private GitHub identity is referenced in local repo config" ;;
esac

if [ -n "$credential_user" ] && [ "$credential_user" != "$required_github_user" ]; then
  fail "credential username is '$credential_user'"
fi

exit 0
