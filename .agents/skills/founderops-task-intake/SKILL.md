---
name: founderops-task-intake
description: Draft, place, clarify, preview, and submit approval-aware FounderOps Initiatives, Deliverables, or Sub-Issues through personal Team Task Intake tokens. Use when the user wants to formulate a planning item, assess its Initiative placement, review a structured preview, approve a later commit, or manage the local macOS or Windows credential securely.
---

# FounderOps Task Intake

Use the bundled client so the personal API token stays in the native operating-system credential store and never enters chat, repository files, payload files, logs, environment variables, or shell arguments. Use only the personal Team Task Intake v2 API, never the separate Agent API.

## Token setup

1. Ask the user to create a personal token in FounderOps under **My Profile → API Access** only when no credential is configured.
2. Never ask the user to paste the token into chat.
3. Run `node scripts/configure-token.mjs status` first. The script automatically uses macOS Keychain or Windows Credential Manager; never ask which operating system is active.
4. When the user confirms that the token is in the local clipboard, run `node scripts/configure-token.mjs set-clipboard`. Never run or print `pbpaste` or `Get-Clipboard` separately.
5. Alternatively, run `node scripts/configure-token.mjs set` in an interactive terminal so the native adapter accepts the token without echoing it.

Rerun `set-clipboard` or `set` to replace an expired or rotated token. Use `delete` only when the user explicitly wants the local credential removed. `scripts/configure-token.sh` remains a macOS compatibility wrapper for the same Node entry point.

## Intake workflow

1. Run `node scripts/founderops-intake.mjs context` to load the current complete task-centered team context.
2. Read `references/intake-authoring.md` completely before drafting or asking intake questions.
3. For every new Deliverable, assess all non-rejected Initiatives using `approvalStatus`, `goal`, `scopeConstraints`, `successCriteria`, Milestone, and RACI. Recommend one best placement with a short reason; ask only when multiple candidates are equally plausible.
4. If no Initiative fits, draft and preview only a new Initiative. After its later approved commit, reload context and then draft the Deliverable as a separate approval step.
5. Never batch dependent new hierarchy items. Create Initiative before Deliverable and Deliverable before Sub-Issue, reloading context between commits.
6. Prepare an API payload outside Git repositories. Use the strict v2 shape `{"items":[...]}` with `itemType = initiative | deliverable | sub_issue` and only documented fields.
7. Run `node scripts/founderops-intake.mjs preview --file <payload.json>`; preview is read-only.
8. Always present the structured field-by-field chat preview defined in the reference. Never commit from the user's initial task request, even when it says to create or submit the task.
9. Ask one compact round of material placement or content questions when needed. Prefer explicit assumptions for light ambiguity and avoid completeness questions that do not change meaning.
10. Commit only after a later user message explicitly approves the shown draft. If the user only answers questions, show the revised structured preview and wait for approval. If the same later message answers questions and explicitly approves creation, re-preview internally and then commit.
11. Run `node scripts/founderops-intake.mjs commit --confirm --file <payload.json>`. Preserve the printed idempotency key when retrying the same commit.
12. Return a clickable FounderOps link for every created item. Never omit links from batch results; use the client's `itemLinks` output.
13. Remove temporary payload files after use.

Use `--file -` to read the payload from stdin. Set `FOUNDEROPS_BASE_URL` only for an explicitly requested non-production target; the client otherwise uses `https://founder-ops.findmydoc.eu`.

## Product boundaries

- A Founder may read all team tasks.
- CEO and Deputy may propose Initiatives; only the CEO approves them in FounderOps.
- CEO, Deputy, and Founder may propose Deliverables in any non-rejected Initiative.
- CEO, Deputy, and Founder may create Sub-Issues under any Deliverable.
- Initiative and Deliverable items always enter as `proposed`; this skill never implies approval, even for CEO-authored items.
- Sub-Issues have no approval status and inherit the current parent state.
- Deliverables always use `findmydoc-platform/management`; only Sub-Issues may select an allowed technical `githubRepo`.
- Intake-created items receive no Sprint assignment and do not start Review, scoring, or GitHub sync.

## Security boundaries

- Never print the bearer token, inspect the clipboard directly, or pass the token through command-line arguments.
- Never store the token in `.env`, environment variables, shell profiles, Codex memory, repositories, task payloads, screenshots, or external artifacts.
- Let `scripts/founderops-intake.mjs` retrieve the token directly from macOS Keychain or Windows Credential Manager into process memory.
- Fail closed on unsupported operating systems or credential-store errors; never fall back to plaintext storage.
- Stop on authentication failures and ask the user to rotate the token through profile settings and rerun `node scripts/configure-token.mjs set`.

