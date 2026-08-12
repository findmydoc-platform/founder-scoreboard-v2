# FounderOps Planning Items API

The FounderOps Planning Items API exposes the current planning hierarchy through personal tokens. Its active source is `tasks`; Epic, Initiative, Deliverable, and Sub-Issue are all planning-item types in that one model. The API never writes to the retained legacy `milestones` or `packages` tables.

`/api/team/planning-items/v1/items` is the sole supported API contract for automated planning-item creation.

```text
Epic
└── Initiative
    └── Deliverable
        └── Sub-Issue
```

CEO, Deputy, and Founder profiles can read safe planning context and create planning items within their role. Viewer profiles cannot issue or use tokens. Every request is attributed to the profile that issued its personal token.

## Authentication and scopes

Create and revoke personal tokens in **My Profile → API Access**, then send the token as a bearer credential:

```http
Authorization: Bearer fmd_ti_<opaque-token>
```

Every token includes:

- `read:planning-context`
- `write:planning-items:create`

Optional, default-off scopes are issued only when selected while creating the token:

- `write:planning-items:update` — update an existing item.
- `write:planning-items:delete-empty` — CEO and Deputy only; delete an empty Epic.
- `write:planning-items:github-sync` — request GitHub projection for a Deliverable or Sub-Issue only.

Create, update, and delete commits require a UUID `Idempotency-Key`. Repeating the same canonical request with the same key returns the stored response. Reusing it for different input returns `409 Conflict`.

```http
Idempotency-Key: 5e627de3-8e91-47ba-8c3f-e06ed8e26059
```

## Endpoints

- `GET /api/team/planning-items/v1/context` — reads non-sensitive planning context.
- `POST /api/team/planning-items/v1/items/preview` — validates one to 30 new items without writing.
- `POST /api/team/planning-items/v1/items` — creates a complete batch atomically.
- `POST /api/team/planning-items/v1/items/{id}/preview` — validates and previews a partial update.
- `PATCH /api/team/planning-items/v1/items/{id}` — commits a partial update.
- `POST /api/team/planning-items/v1/items/{id}/github-sync` — syncs one Deliverable or Sub-Issue.
- `POST /api/team/planning-items/v1/items/{id}/delete/preview` — checks whether one Epic is empty.
- `DELETE /api/team/planning-items/v1/items/{id}` — deletes one empty Epic.
- `GET` and `POST /api/team/planning-items/v1/tokens` — lists or creates the caller’s tokens.
- `DELETE /api/team/planning-items/v1/tokens/{id}` — revokes one active token.

## Context and canonical references

The context response provides one canonical `items` list plus convenience lists `epics`, `initiatives`, and `tasks` (Deliverables and Sub-Issues). `parentTaskId` is the only canonical hierarchy reference. The transitional `initiatives` convenience list additionally retains the former flat `goal`, `successCriteria`, and `scopeConstraints` fields. New clients should read the nested `strategy` object from `items` instead.

The retained response field `milestones` and the input type `milestone` are deprecated compatibility aliases. They resolve to an Epic before any validation or write. `milestoneId` and `packageId` are also accepted only during transition and resolve to `parentTaskId`; new clients must use `parentTaskId`.

## Create payload

The collection endpoint has the strict shape `{"items":[...]}`. Canonical `itemType` values are `epic`, `initiative`, `deliverable`, and `sub_issue`.

```json
{
  "items": [
    {
      "itemType": "epic",
      "title": "Market readiness",
      "description": "Prepare the operating model.",
      "ownerId": "profile-id",
      "targetDate": "2026-10-31",
      "status": "Offen"
    },
    {
      "itemType": "initiative",
      "title": "Legal launch readiness",
      "ownerId": "profile-id",
      "parentTaskId": "epic-id",
      "intendedOutcome": "A launch-ready legal foundation.",
      "status": "Offen"
    }
  ]
}
```

Epics and Initiatives require an owner when they are created. Only CEO and Deputy may create them. An Initiative or Deliverable may be proposed without a parent, but an Initiative needs an Epic and a Deliverable needs an approved Initiative before approval can succeed. A Sub-Issue always requires an approved Deliverable parent.

Use `githubSync` only on Deliverables and Sub-Issues. If any item includes `githubSync`, the top-level `githubSyncMode` must be `async` or `wait`.

```json
{
  "items": [
    {
      "itemType": "sub_issue",
      "title": "Confirm the rollout window",
      "parentTaskId": "deliverable-id",
      "githubRepo": "findmydoc-platform/management",
      "githubSync": { "createIfMissing": true }
    }
  ],
  "githubSyncMode": "async"
}
```

## Status, approval, and hierarchy rules

| Type | Working statuses | Approval | Parent rule |
| --- | --- | --- | --- |
| Epic | `Offen`, `In Arbeit`, `Pausiert`, `Blockiert`, `Erledigt` | None | No parent |
| Initiative | `Offen`, `In Arbeit`, `Pausiert`, `Blockiert`, `Erledigt` | `draft`, `proposed`, `approved`, `rejected` | An Epic is required at approval time |
| Deliverable | `Offen`, `In Arbeit`, `Review`, `Nacharbeit`, `Blockiert`, `Erledigt` | Existing approval flow | An approved Initiative is required at approval time |
| Sub-Issue | `Offen`, `In Arbeit`, `Blockiert`, `Erledigt` | None | An approved Deliverable is always required |

Initiative approval additionally requires exactly one Accountable and at least one Responsible RACI assignment. `draft` is reserved for a return-for-rework state; new Initiative and Deliverable proposals start as `proposed`.

Changing the parent of an approved Initiative or Deliverable creates a new `proposed` approval revision while preserving its work status and children. Parent and child working statuses stay independent: an Epic or Initiative may be completed while direct children are still open.

## PATCH semantics

PATCH processes only properties present in the request body. Omitted properties do not change. Nullable text, date, and reference fields can be cleared with `null` or a blank string. `expectedUpdatedAt` is required and provides optimistic concurrency; a stale value returns `409 Conflict`. `itemType` is immutable.

```json
{
  "expectedUpdatedAt": "2026-07-30T09:30:00.000Z",
  "parentTaskId": "initiative-id"
}
```

Strategic items accept only strategic fields. They do not accept Review, score, Evidence gates, Sprint, repository, or GitHub fields. Deliverables retain their existing Review and scoring transitions. Sub-Issues retain their separate four-state status contract and never accept Review or Nacharbeit.

## GitHub projection

GitHub projection is intentionally unavailable for Epics and Initiatives. The API rejects strategic GitHub commands before writing; no strategic item can create a GitHub queue, outbox entry, sync warning, comment import, or GitHub attachment.

Deliverables and Sub-Issues retain the existing response contract. The Planning commit stores its GitHub projection request durably and atomically with the item and idempotency receipt. `wait` processes that stored request before returning; `async` returns `accepted` after the durable commit and only uses request-lifecycle work as a wake-up optimization. GitHub failure never rolls back a successful FounderOps create or update, and replaying the same idempotency key never creates another request.

## Empty Epic deletion

The preview and delete endpoints require `write:planning-items:delete-empty`, a CEO or Deputy actor, and `expectedUpdatedAt`.

```json
{
  "expectedUpdatedAt": "2026-07-30T12:00:00.000Z"
}
```

Only an Epic with zero direct Initiative and Deliverable references can be deleted. A non-empty Epic returns `valid: false`, `canDelete: false`, and code `MILESTONE_NOT_EMPTY` for legacy wire compatibility. The operation never moves, detaches, or deletes children.

## Compatibility window

The old database tables and legacy HTTP-shaped values remain read-only compatibility and recovery data during the transition. They are not a second write path. New integrations must use canonical types and `parentTaskId`; compatibility aliases will be removed only in a separately approved cleanup.

The OpenAPI document is available at `/founderops-team-planning-items-openapi.json`.
