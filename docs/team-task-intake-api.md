# Team Task Intake API

The Team Task Intake API lets CEO, Deputy, and Founder profiles submit planning items from external Codex or ChatGPT clients. Each request is attributed to the profile that created the personal token. Viewer profiles cannot create tokens or write items.

## Authentication

Create and revoke personal tokens in **My Profile → API Access** and send the token as a bearer credential:

```http
Authorization: Bearer fmd_ti_<opaque-token>
```

Commit requests require a UUID idempotency key. Replaying the same canonical request with the same key returns the immutable original response. Reusing the key with different data returns `409 Conflict`.

```http
Idempotency-Key: 5e627de3-8e91-47ba-8c3f-e06ed8e26059
```

## Endpoints

- `POST /api/team/task-intake/v2/preview` validates and normalizes one to 30 items without writing.
- `POST /api/team/task-intake/v2/commit` validates again and commits the complete batch atomically.
- `GET /api/team/task-context` returns non-sensitive planning context.

The strict v2 payload uses `items` and `itemType = initiative | deliverable | sub_issue`.

```json
{
  "items": [
    {
      "itemType": "deliverable",
      "title": "Clarify onboarding risks",
      "packageId": "initiative-id",
      "problemStatement": "The current risk list is incomplete.",
      "intendedOutcome": "The team has a reviewable risk register.",
      "acceptanceCriteria": ["The main risks are listed."],
      "evidenceRequired": "Link to the risk register.",
      "definitionOfDone": "The Initiative Accountable can make a decision."
    }
  ]
}
```

## Initiative context

`GET /api/team/task-context` includes an Initiative brief for every entry in `context.initiatives`. In addition to placement, ownership, status, priority, and target date, each Initiative exposes its approval status, goal, scope constraints, and success criteria.

External clients can use these briefs to explain why a new planning item belongs to an existing Initiative or to identify that no Initiative is a suitable match. FounderOps does not perform server-side matching or recommendations; the client and user retain the placement decision.

Decision notes, comments, credentials, tokens, and other internal planning data are not part of this context.

## Write and approval policy

- CEO and Deputy may propose Initiatives. Only the CEO may approve an Initiative in FounderOps.
- CEO, Deputy, and Founder may propose a Deliverable in any Initiative that is not rejected.
- Every Initiative and Deliverable created through v2 starts with `approvalStatus = proposed`.
- CEO creation through this external intake never implies approval; approval remains a separate FounderOps decision.
- CEO, Deputy, and Founder may create a Sub-Issue under any Deliverable.
- Sub-Issues have no independent approval status, inherit their effective state from the parent Deliverable, have no Sprint, and are never score-relevant.
- Deliverables always use `findmydoc-platform/management`. Only Sub-Issues may select an allowed technical `githubRepo`.
- Intake v2 never assigns a Sprint, runs Review, changes scores, or starts GitHub sync.

The OpenAPI document is available at `/founderops-team-intake-openapi.json`.
