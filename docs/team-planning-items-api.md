# FounderOps Planning Items API

The FounderOps Planning Items API exposes the current planning hierarchy through personal tokens. Its source is `tasks`; Epic, Initiative, Deliverable, and Sub-Issue are all planning-item types in that one model.

`/api/team/planning-items/v2/*` is the supported contract. It accepts only current Epic and `parentTaskId` forms. V1 has been removed.

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

## Access metadata

Every response produced after an active personal token has been recognized includes an additive `_meta` object. It identifies the requested operation and mode, the safe token hint, granted and required scopes, any missing scopes, and the remaining token lifetime. `expiresAt` is authoritative; `remainingSeconds` is calculated from the same database timestamp in `evaluatedAt` and is never negative.

```json
{
  "_meta": {
    "operation": "planningItems.update",
    "mode": "preview",
    "access": {
      "evaluatedAt": "2026-08-19T10:00:00Z",
      "decision": "allowed",
      "token": {
        "hint": "…a8F31x",
        "grantedScopes": ["write:planning-items:update"],
        "expiresAt": "2026-09-03T10:00:00Z",
        "remainingSeconds": 1296000
      },
      "requiredScopes": ["write:planning-items:update"],
      "missingScopes": []
    }
  }
}
```

A valid token without all required scopes receives `403 Forbidden`, `code: "INSUFFICIENT_SCOPE"`, `decision: "denied"`, and a `WWW-Authenticate` challenge. Preview or commit execution does not start. Missing credentials receive `401` with `TOKEN_REQUIRED`; unknown, revoked, and expired tokens remain intentionally indistinguishable as `TOKEN_INACTIVE` and expose no token metadata. Token-management endpoints are session-authorized and do not use this bearer-token receipt.

## Endpoints

- `GET /api/team/planning-items/v2/context` — reads non-sensitive canonical planning context.
- `POST /api/team/planning-items/v2/items/preview` — validates one to 30 new items without writing.
- `POST /api/team/planning-items/v2/items` — creates a complete batch atomically.
- `POST /api/team/planning-items/v2/items/{id}/preview` — validates and previews a partial update.
- `PATCH /api/team/planning-items/v2/items/{id}` — commits a partial update.
- `POST /api/team/planning-items/v2/items/{id}/github-sync` — syncs one Deliverable or Sub-Issue.
- `POST /api/team/planning-items/v2/items/{id}/delete/preview` — checks whether one Epic is empty.
- `DELETE /api/team/planning-items/v2/items/{id}` — deletes one empty Epic.
- `GET` and `POST /api/team/planning-items/v2/tokens` — lists or creates the caller’s tokens.
- `DELETE /api/team/planning-items/v2/tokens/{id}` — revokes one active token.

Token management is session-authorized; bearer-token planning operations use the same v2 contract.

## Context and canonical references

The v2 context response provides one canonical `items` list plus convenience lists `epics`, `initiatives`, and `tasks` (Deliverables and Sub-Issues). Every list uses the same canonical projection. `parentTaskId` is the hierarchy reference, and Initiative strategy is available only through the nested `strategy` object. There is no `milestones` collection and no flat Initiative `goal`, `successCriteria`, or strategy-level `scopeConstraints` alias.

V2 rejects the retired `milestone` item type and the `milestoneId` and `packageId` parent fields. Path and parent references must use current planning-item IDs. It also refuses a replay receipt written under the older response contract.

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

Only an Epic with zero direct Initiative and Deliverable references can be deleted. A non-empty Epic returns `valid: false`, `canDelete: false`, and `EPIC_NOT_EMPTY`. The operation never moves, detaches, or deletes children.

## Current contract

The legacy hierarchy tables and v1 transport adapters were removed in the controlled cutover. Historical Initiative links and immutable delete replay receipts remain available under canonical storage names; they are not active planning write paths.

The OpenAPI document is available at `/founderops-team-planning-items-v2-openapi.json`.
