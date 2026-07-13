# FounderOps Planning Items API

The FounderOps Planning Items API lets CEO, Deputy, and Founder profiles read safe planning context, create planning items, and—when a token explicitly includes the update scope—partially update an existing Initiative, Deliverable, or Sub-Issue. Each request is attributed to the profile that created the personal token. Viewer profiles cannot create tokens or use this API.

## Authentication and token scopes

Create and revoke personal tokens in **My Profile → API Access** and send the token as a bearer credential:

```http
Authorization: Bearer fmd_ti_<opaque-token>
```

Every token always includes:

- `read:planning-context`
- `write:planning-items:create`

The UI exposes a separate **Allow updates** choice when a token is created. Only that explicit choice adds `write:planning-items:update`; existing tokens are migrated to read/create only.

Create and update commits require a UUID idempotency key. Replaying the same canonical request with the same key returns the immutable original response. Reusing the key for another request returns `409 Conflict`.

```http
Idempotency-Key: 5e627de3-8e91-47ba-8c3f-e06ed8e26059
```

## Endpoints

- `GET /api/team/planning-items/v1/context` reads non-sensitive planning context.
- `POST /api/team/planning-items/v1/items/preview` validates and normalizes one to 30 new items without writing.
- `POST /api/team/planning-items/v1/items` validates and creates a complete batch atomically.
- `POST /api/team/planning-items/v1/items/{id}/preview` validates and previews an update without writing.
- `PATCH /api/team/planning-items/v1/items/{id}` commits one partial update.
- `GET` and `POST /api/team/planning-items/v1/tokens` list or create the caller's tokens.
- `DELETE /api/team/planning-items/v1/tokens/{id}` revokes one active token.

No legacy HTTP aliases are retained. The separate CEO and Agent task-intake APIs are unchanged and are not part of this contract.

## Create payload

Create uses the collection endpoint with the strict shape `{"items":[...]}` and `itemType = initiative | deliverable | sub_issue`.

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

## PATCH semantics

PATCH processes only properties that are present in the request body. Omitted properties are never changed. Optional string, date, and reference fields may be set to `null` (or a blank string) to clear them; required fields such as `title` and Initiative `responsibleProfileIds` cannot be cleared. `acceptanceCriteria` accepts a string or an array of strings. `0` is a valid value for `hours`.

`expectedUpdatedAt` is required for every update and compares against the current item version. A stale version returns `409 Conflict`. An exact idempotent replay is returned before this version check. The `itemType` is determined by the target and is immutable; a PATCH body must not contain it.

```json
{
  "expectedUpdatedAt": "2026-07-13T18:30:00.000Z",
  "priority": "P1",
  "deadline": null
}
```

The update preview returns `currentItem`, `normalizedPatch`, `resultingItem`, `changedFields`, and system effects such as approval revision, Sprint/review/score resets, derived hierarchy values, and GitHub projection status.

## Type and permission boundaries

- An Initiative accepts its brief, Milestone, owner/accountable/RACI, and priority fields. Material brief or Milestone changes start a new approval revision.
- A Deliverable accepts its brief, Initiative, owner, priority, workstream, dates, and hours. The Milestone derives from its Initiative. Material changes reset approval, Sprint, review, and score state.
- A Sub-Issue accepts its brief, parent Deliverable, owner, priority, workstream, dates, hours, and (before GitHub synchronization) `githubRepo`. Only Sub-Issues may select an allowed technical repository. Its Initiative and Milestone derive from the parent.
- CEO and Deputy may update all allowed fields. A Founder may update only their own Initiative fields or the brief of an owned/assigned task, plus an owned/assigned Sub-Issue's parent.
- The API never updates approvals directly, Sprint configuration, review/final-score fields, or GitHub synchronization state.

Every commit validates the authorization, current version, hierarchy references, and GitHub repository policy again in the transaction.

The OpenAPI document is available at `/founderops-team-planning-items-openapi.json`.
