# Script Rules

- Keep a script only when it has an active caller in `package.json`, `.github`, `.codex`, or a documented recurring operator workflow.
- Use timestamp migrations for durable schema or data transformations that must remain reproducible.
- Make operator scripts read-only by default. Production mutations require a fail-closed target guard plus a dry run or explicit confirmation; verification writes must stay inside a transaction that always rolls back.
- Fail closed when credentials, environment, or target identity is ambiguous.
- Reuse helpers under `scripts/lib` for environment parsing, Supabase clients, migration ordering, and production connection handling.
- Return non-zero on invariant failures and name the exact failing file, command, or contract.
- Remove obsolete scripts, package aliases, docs, tests, and orphaned helpers together.
