# FounderOps Planning Items API

The FounderOps Planning Items API lets CEO, Deputy, and Founder profiles read safe planning context, create planning items, and—when a token explicitly includes the update scope—partially update existing items. Milestone creation and updates are restricted to CEO and Deputy. A separate, default-off capability lets those two roles delete an empty Milestone. Each request is attributed to the profile that created the personal token. Viewer profiles cannot create tokens or use this API.

## Authentication and token scopes

Create and revoke personal tokens in **My Profile → API Access** and send the token as a bearer credential:

```http
Authorization: Bearer fmd_ti_<opaque-token>
```

Every token always includes:

- `read:planning-context`
- `write:planning-items:create`

The UI exposes a separate **Allow updates** choice when a token is created. Only that explicit choice adds `write:planning-items:update`. Task status updates use this existing scope. Existing update-enabled tokens continue to work without rotation; read/create-only tokens remain unable to update any field.

CEO and Deputy also see **Allow empty Milestone deletes**. Enabling it adds `write:planning-items:delete-empty`. Founder and Viewer profiles cannot request or see this capability. It permits only deletion of a Milestone with zero Initiative and zero Task references; it never moves, detaches, or deletes child items. Existing tokens keep exactly their previous scopes.

Create, update, and delete commits require a UUID idempotency key. Replaying the same canonical request with the same key returns the immutable original response. Reusing the key for another request returns `409 Conflict`.

```http
Idempotency-Key: 5e627de3-8e91-47ba-8c3f-e06ed8e26059
```

## Endpoints

- `GET /api/team/planning-items/v1/context` reads non-sensitive planning context.
- `POST /api/team/planning-items/v1/items/preview` validates and normalizes one to 30 new items without writing.
- `POST /api/team/planning-items/v1/items` validates and creates a complete batch atomically.
- `POST /api/team/planning-items/v1/items/{id}/preview` validates and previews an update without writing.
- `PATCH /api/team/planning-items/v1/items/{id}` commits one partial update.
- `POST /api/team/planning-items/v1/items/{id}/delete/preview` checks whether a Milestone is empty without writing.
- `DELETE /api/team/planning-items/v1/items/{id}` deletes one empty Milestone.
- `GET` and `POST /api/team/planning-items/v1/tokens` list or create the caller's tokens.
- `DELETE /api/team/planning-items/v1/tokens/{id}` revokes one active token.

No legacy HTTP aliases or parallel planning-item creation routes are retained. This is the sole supported API contract for automated planning-item creation.

## Create payload

Create uses the collection endpoint with the strict shape `{"items":[...]}` and `itemType = milestone | initiative | deliverable | sub_issue`.

For `milestone`, only `title`, `description`, `targetDate`, and `status` are accepted. `status` is `planned`, `active`, or `done` and defaults to `planned`. The project, identifier, and sort position are server-owned. Milestones have no approval, owner, RACI, Initiative parent, Sprint, score, or GitHub fields.

```json
{
  "items": [
    {
      "itemType": "milestone",
      "title": "Market readiness",
      "description": "Prepare the operating model.",
      "targetDate": "2026-10-31",
      "status": "planned"
    }
  ]
}
```

Sub-Issue create accepts `itemType`, `title`, optional `description`, optional work-brief text (`problemStatement`, `intendedOutcome`, `scopeConstraints`, `acceptanceCriteria`, `evidenceRequired`, and `definitionOfDone`), required `parentTaskId`, optional `ownerId`, and optional `githubRepo`. The owner defaults to the token profile. Status is server-owned and starts as `Offen`; Initiative and Milestone derive from the parent Deliverable. `evidenceRequired` is text context only and does not create an Evidence requirement.

```json
{
  "items": [
    {
      "itemType": "sub_issue",
      "title": "Confirm the rollout window",
      "description": "Coordinate the date with the delivery owner.",
      "parentTaskId": "deliverable-id",
      "githubRepo": "findmydoc-platform/management"
    }
  ]
}
```

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

A Milestone PATCH accepts only `title`, `description`, `targetDate`, and `status`. A PATCH containing only `expectedUpdatedAt` is invalid and returns `400 Bad Request`.

Deliverable PATCH requests accept `Offen`, `In Arbeit`, `Review`, `Nacharbeit`, `Blockiert`, or `Erledigt`. Sub-Issue PATCH requests use the separate four-state contract `Offen`, `In Arbeit`, `Blockiert`, or `Erledigt`; `Review` and `Nacharbeit` are rejected. Initiatives do not accept `status`; Milestones continue to use only `planned`, `active`, or `done`.

`expectedUpdatedAt` is required for every update and compares against the current item version. A stale version returns `409 Conflict`. An exact idempotent replay is returned before this version check. The `itemType` is determined by the target and is immutable; a PATCH body must not contain it.

```json
{
  "expectedUpdatedAt": "2026-07-13T18:30:00.000Z",
  "priority": "P1",
  "deadline": null
}
```

Status updates use the same endpoint, version check, update scope, and idempotency key:

```json
{
  "expectedUpdatedAt": "2026-07-22T09:30:00.000Z",
  "status": "In Arbeit"
}
```

For a Deliverable, `status: "Review"` performs the complete existing review request transition. The Deliverable must be approved, have a contributing Review Owner (directly or inherited from its Initiative), and must not belong to a score-locked Sprint or have a final score. A successful transition sets the review request timestamp, resets the score, keeps the score non-final, notifies the Review Owner, records activity and audit, and marks the GitHub projection `not_synced`. Preview returns these effects before the write. Sending the already-current status succeeds as a no-op without activity, audit, notification, or GitHub projection changes.

Legacy Sub-Issues stored as `Review` or `Nacharbeit` are returned as `In Arbeit`. Legacy review, score, and Evidence values are ignored without being deleted. An explicit valid status PATCH persists the selected four-state value, including an explicit `In Arbeit` PATCH used to normalize a legacy state.

The update preview returns `currentItem`, `normalizedPatch`, `resultingItem`, `changedFields`, and system effects such as approval revision, Sprint/review/score resets, derived hierarchy values, and GitHub projection status.

## Empty Milestone deletion

Both delete endpoints require `write:planning-items:delete-empty`, a CEO or Deputy actor, a fixed-project Milestone, and `expectedUpdatedAt`.

```json
{
  "expectedUpdatedAt": "2026-07-14T12:00:00.000Z"
}
```

Delete preview is read-only. An empty Milestone returns HTTP `200` with `valid: true` and `canDelete: true`. A non-empty Milestone also returns HTTP `200`, but with `valid: false`, `canDelete: false`, code `MILESTONE_NOT_EMPTY`, and current Initiative and Task counts. The preview states explicitly that no child is moved or deleted.

Delete commit uses `DELETE /api/team/planning-items/v1/items/{id}` plus `Idempotency-Key`. A non-empty Milestone returns HTTP `409` with the same public code and fresh child counts. Active and trashed Initiatives and Tasks both count because the base-table references are authoritative. Stale versions and incompatible idempotency replays also return `409` without changing the Milestone or any child reference.

## Type and permission boundaries

| Type | Create and PATCH fields | Status contract | Derived or unavailable fields |
| --- | --- | --- | --- |
| Milestone | `title`, `description`, `targetDate`, `status` | `planned`, `active`, `done` | No parent, owner, RACI, Sprint, score, or GitHub fields |
| Initiative | Brief, Milestone, owner/accountable/RACI, priority | No work status | Approval revision remains server-owned |
| Deliverable | Brief, Initiative, owner, priority, workstream, dates, hours, work status | `Offen`, `In Arbeit`, `Review`, `Nacharbeit`, `Blockiert`, `Erledigt` | Milestone derives from Initiative; review, score, and approval side effects remain server-owned |
| Sub-Issue | `title`, `description`, optional work brief, `parentTaskId`, `ownerId`, `githubRepo`, and PATCH `status` | `Offen`, `In Arbeit`, `Blockiert`, `Erledigt` | Initiative, Milestone, approval, and RACI derive from parent; no priority, Sprint, schedule, estimate, workstream, review, score, manual-Evidence, or quality-gate writes |

- An Initiative accepts its brief, Milestone, owner/accountable/RACI, and priority fields. Material brief or Milestone changes start a new approval revision.
- A Milestone accepts only title, description, target date, and status. Only CEO and Deputy may preview or commit its creation, update, or empty-only deletion.
- A Deliverable accepts its brief, Initiative, owner, priority, workstream, dates, hours, and work status. The Milestone derives from its Initiative. Material changes reset approval, Sprint, review, and score state.
- A Sub-Issue accepts title, context, its optional work brief, parent Deliverable, owner, `githubRepo`, and its four work statuses. Only Sub-Issues may select an allowed technical repository. Its Initiative and Milestone derive from the parent.
- CEO and Deputy may update all allowed fields. A Founder may update only their own Initiative fields or the brief of an owned/assigned Deliverable; for an owned or assigned Sub-Issue they may update title, context, work brief, parent, and ordinary work status.
- CEO and Deputy may change ordinary work statuses. Founder may change ordinary work statuses only on owned or assigned Issues.
- Only CEO may directly complete or reopen a Deliverable. CEO, Deputy, and Founder may complete any Sub-Issue or reopen it to `Offen`, provided its parent Deliverable is approved.
- Active and final review locks and restricted `Nacharbeit` transitions remain enforced for Deliverables. Sub-Issue legacy review states never lock updates. Parent approval and optimistic concurrency remain enforced for Sub-Issue status changes.
- The API never accepts direct approval, Sprint configuration, Review Owner, review outcome, final-score, manual Evidence links, or GitHub synchronization fields for Sub-Issues. Their reopen transition has no review or score side effects. `evidenceRequired` remains optional text in the work brief.

Every commit validates the authorization, current version, hierarchy references, and GitHub repository policy again in the transaction.

The OpenAPI document is available at `/founderops-team-planning-items-openapi.json`.
