# Team Task Intake API

The Team Task Intake API lets operational FounderOps profiles use external Codex or ChatGPT clients without sharing the CEO Agent API token. Each request is attributed to the profile that created the personal token.

## Authentication

Create and revoke personal tokens in **My Profile → API Access**. A token is shown once, expires after 90 days, and is stored by FounderOps only as a SHA-256 hash.

Send the token as a bearer credential:

```http
Authorization: Bearer fmd_ti_<opaque-token>
```

Tokens have the fixed scopes `read:task-context` and `write:task-intake`. CEO, Deputy, and Founder profiles may create tokens; Viewer profiles may not.

## Endpoints

- `GET /api/team/task-context` returns task-centered team context without scores, final review data, meetings, settings, audit records, comment bodies, evidence URLs, or provider credentials.
- `POST /api/team/task-intake/preview` validates and normalizes one to 30 proposals or sub-issues without writing data.
- `POST /api/team/task-intake/commit` validates again and commits the complete batch atomically.

Commit requests require a UUID idempotency key:

```http
Idempotency-Key: 5e627de3-8e91-47ba-8c3f-e06ed8e26059
```

Retrying the same payload with the same key returns the existing batch. Reusing the key with changed data returns `409 Conflict`.

## Write policy

- `proposal` is stored with status `Vorschlag`, without a sprint, and is not score-relevant.
- `sub_issue` requires `parentTaskId` for an existing Deliverable, inherits Initiative and Epic / Milestone, has no sprint, and is not score-relevant.
- Founder tokens may create Sub-Issues only under Deliverables assigned to their profile. CEO and Deputy tokens may use any Deliverable.
- `deliverable`, score changes, final review changes, Sprint configuration, and GitHub sync are rejected.

## Example

```bash
curl -X POST \
  -H "Authorization: Bearer $FOUNDEROPS_TEAM_INTAKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"taskType":"proposal","title":"Clarify onboarding risks","problemStatement":"The current risk list is incomplete.","intendedOutcome":"The team has a reviewable proposal.","acceptanceCriteria":["The main risks are listed."],"evidenceRequired":"Link to the proposal.","definitionOfDone":"CEO or Deputy can decide the next step."}]}' \
  https://founder-ops.findmydoc.eu/api/team/task-intake/preview
```

The OpenAPI document is available at `/founderops-team-intake-openapi.json`.
