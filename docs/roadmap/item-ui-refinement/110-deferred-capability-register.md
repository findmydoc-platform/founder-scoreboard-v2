# Deferred Capability Register — Item Detail

Status: temporary deferred-capability register; negative scope only
Initial review baseline: `origin/main@66bf53945c5b999512df09ab6cfd2b2e40414c4d`
Integration baseline: `origin/main@1bbe36f`
Applies to: active Deliverable and Sub-Issue detail, full page and modal

> **Every capability in this register is NOT PART OF THE CURRENT UI IMPLEMENTATION.**
>
> The current implementation must follow `120-existing-capability-placement.md`: omit unsupported controls, preserve existing capabilities, and use safe local fallbacks.

## Purpose and release discipline

This register lists capabilities excluded from the current Item UI. Each entry records:

- what the current product actually supports;
- why the affordance is excluded now;
- the minimum data, API, permission, UI, and failure contract required before it can be approved;
- the evidence required to remove the `deferred` status.

No entry may move into the Item UI through presentation work alone. It requires a separately approved product and implementation scope. Existing authorization helpers remain authoritative until that scope explicitly changes them.

## Summary

| Deferred capability | Current supported behavior | Current implementation rule |
|---|---|---|
| Generic archive | Eligible Deliverables can be withdrawn to the planning trash | Omit `Archivieren`; retain `Deliverable zurückziehen` only when currently permitted |
| Direct delete | Direct Task DELETE returns `410`; expired trash is purged by protected maintenance | Omit `Löschen` |
| Activity replies | Flat local and imported comments in one Activity timeline | Omit `Antworten` |
| Row kebab menus | Rows open Items; removable relationships use the current explicit remove control | Omit menus until every action is defined and permission-backed |
| Initiative relationship target | Relationship edges connect Task records only; the current picker offers Deliverables | Omit Initiative targets |
| Document title and provider metadata | One `evidenceLink` string, rendered through a safe local link preview | Use hostname or shortened URL fallback; do not fetch or invent a title |

## 1. Generic archive

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Current product state

There is no generic archived state for planning Items.

- `src/lib/status.ts:4` defines only the active work statuses `Offen`, `In Arbeit`, `Review`, `Nacharbeit`, `Blockiert`, and `Erledigt`.
- The `active_tasks` view in `supabase/migrations/20260827064853_current_schema_baseline.sql` filters by `trashed_at is null`; it has no archive predicate or archive metadata.
- `src/features/tasks/molecules/task-detail-header-actions.tsx` exposes only the existing planning-trash action `Deliverable zurückziehen` through the Item action menu.
- `src/features/planning/model/planning-trash-contract.ts:45-61` limits withdrawal to eligible draft/proposed roots and the existing proposer/operational-lead policy.
- `src/app/api/tasks/[id]/withdraw/route.ts` and `src/lib/planning-trash-api.ts:114-170` implement withdrawal, revision checks, audit metadata, and GitHub lifecycle handling.
- `src/lib/github.ts` contains a provider-level `archiveGitHubIssue` helper, but it is not an Item archive capability and is not wired to the active Task DELETE or detail UI.

### Why excluded now

`Archivieren` has no agreed domain meaning. It could mean completed-history cleanup, removal from active planning, reversible retention, or a GitHub lifecycle action. Those meanings have different effects on Sub-Issues, relationships, Review, notifications, counts, search, reporting, and restore behavior. Mapping it to the trash workflow would also bypass the current eligibility wording and make archive and withdrawal appear interchangeable.

## 2. Direct delete

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Current product state

Direct deletion is intentionally unavailable from an active Item.

- `src/app/api/tasks/[id]/route.ts:457-459` returns `410` with `Direktes Löschen ist nicht mehr verfügbar. Nutze den Papierkorb-Workflow.`
- Focused planning-trash route and interaction tests verify reversible withdrawal and the unavailable direct-delete path.
- `src/features/tasks/hooks/use-task-withdraw-command.ts` performs reversible optimistic removal, server withdrawal, and rollback on failure.
- The planning-trash functions in `supabase/migrations/20260827064853_current_schema_baseline.sql` give withdrawn roots a purge date, but no scheduled workflow executes the purge.
- `src/app/api/maintenance/planning-trash/purge/route.ts` remains a manual operator endpoint. It requires the maintenance secret and calls `purge_expired_planning_trash_batch`; no scheduled workflow invokes it.
- The baseline still contains service-role-only legacy `task_deletion_operations` and prepare/finalize/cancel functions. They are dormant schema primitives, not an available product contract, and must not be reconnected implicitly.

### Why excluded now

Immediate deletion would bypass the approved recovery window and can cascade across Sub-Issues, comments, attachments, relationships, notifications, review history, audit references, and the GitHub projection. The current product deliberately separates reversible withdrawal from protected retention-based purge. A red mockup label is not enough to reverse that lifecycle policy.

## 3. Activity replies

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Current product state

Comments are flat timeline entries.

- `src/lib/types.ts:248-269` gives local and imported comments no parent, thread, or reply-target field.
- The `task_comments` table in `supabase/migrations/20260827064853_current_schema_baseline.sql` stores only Task, author, body, and creation time.
- `src/features/tasks/organisms/task-comment-thread.tsx:27-67` merges activities, local comments, and imported GitHub comments into one chronological list.
- `src/features/tasks/molecules/task-comment-timeline.tsx` renders comment bodies and provider links but exposes no reply callback.
- `src/features/tasks/molecules/task-comment-composer.tsx` creates only a new top-level comment.
- `src/app/api/tasks/[id]/comments/route.ts:10-49` accepts only `comment`; it has no reply validation or parent lookup.
- Local comments may be delivered as top-level GitHub Issue comments. GitHub Issue comments themselves do not provide the local threaded-reply model implied by the mockup.

### Why excluded now

The mockup does not decide whether a reply is visual indentation only, a persisted local thread, a quote plus mention, or a provider-linked response. It also does not define replies to imported GitHub comments, notification recipients, maximum nesting, ordering, deletion behavior, or GitHub delivery. Adding the affordance without those decisions would produce either a non-working control or data that cannot round-trip reliably.

## 4. Row kebab menus

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Current product state

The current Item rows do not have a generic action menu.

- `src/features/tasks/molecules/task-detail-panel-sub-issues-section.tsx:31-38` exposes the Sub-Issue reference plus status/assignee and opens the Item through `TaskReferenceLink`.
- `src/features/tasks/molecules/relationship-list.tsx:54-84` opens the linked Task and conditionally exposes the existing direct remove action.
- `src/features/tasks/model/task-relationship-permissions.ts:22-51` computes the current relation-type and remove permissions.
- `src/shared/molecules/custom-action-menu.tsx` is an existing accessible menu primitive, but no Task-row action matrix supplies it with actions.
- No generic row-menu API exists. Every current mutation has its own hook, permission predicate, pending state, and error contract.

### Why excluded now

An ellipsis communicates that meaningful actions exist. The mockups do not define those actions, their order, destructive confirmation, disabled reasons, or role/state rules. A decorative or empty menu would reduce trust; a menu populated from guesswork could expose unauthorized or unsupported mutations.

## 5. Initiative as a relationship target

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Current product state

Relationships are Task-to-Task edges.

- `src/features/tasks/model/task-detail-state.ts:134-137` builds targets from `Task[]`, excludes the current Task and every `sub_issue`, and therefore offers Deliverables only.
- `src/features/tasks/molecules/task-relationship-form.tsx:8-69` stores `relatedTaskId` and presents `Aufgabe auswählen`.
- `src/app/api/tasks/[id]/relationships/route.ts:81-129` validates both endpoints through the active Task read model before inserting an edge.
- The `task_relationships` table in `supabase/migrations/20260827064853_current_schema_baseline.sql` stores `task_id` and `related_task_id`.
- Its foreign keys point both endpoints to `tasks`; an Initiative is stored as a `Package`, not a Task.
- `src/features/tasks/model/task-relationship-permissions.ts` evaluates rights from a current Task and its Initiative context, but it does not authorize an Initiative as an endpoint.

### Why excluded now

Initiative relationships require a cross-entity graph, not a picker-label change. The current schema, API, row mapper, permission model, counts, removal behavior, and GitHub projection all assume Task endpoints. The mockup does not decide which relation types are meaningful across levels or whether an Initiative blocks a Deliverable, contains it, or is merely related to it. Hierarchy must not be duplicated as a dependency edge by accident.

## 6. Document title and provider metadata

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Current product state

The product stores one Evidence URL string and no document metadata.

- `src/lib/types.ts:84-110` defines `Task.evidenceLink: string`; there are no title, provider, metadata source, or fetch-state fields.
- The `active_tasks` view in `supabase/migrations/20260827064853_current_schema_baseline.sql` projects only `evidence_link` from Tasks.
- `src/features/tasks/molecules/task-evidence-link-section.tsx:13-31` edits the URL and renders it through `CommentBody`.
- `src/features/tasks/atoms/task-comment-body.tsx:8-35` validates safe link protocols and renders the supplied text; it does not resolve remote metadata.
- `src/features/tasks/model/task-route-update-helpers.ts:191-202` stores a trimmed `evidence_link` through the existing Task PATCH.
- `src/features/tasks/model/task-detail-permissions.ts:89-105` uses `canEditEvidence`; there is no separate metadata permission.
- The current UI scope may derive a hostname/provider label locally and must fall back to hostname or a safely shortened URL. It must not fabricate the mockup title or call Drive, Notion, GitHub, or Open Graph metadata services.

### Why excluded now

A trustworthy document title usually requires remote provider access, a metadata cache, or a manual stored title. The mockup does not say which source is authoritative. Fetching arbitrary URLs introduces server-side request forgery, redirect, timeout, rate-limit, privacy, and private-document authorization risks. Provider icons and names also become misleading when the URL is a redirect, shared domain, or inaccessible document.

## Cross-capability release rule

Removing `DEFERRED` from any entry requires all of the following:

1. A separately approved product scope names the capability and its non-goals.
2. The data and API contract is migration-safe and preserves the planning hierarchy.
3. Server authorization is defined and tested; visual presence never grants permission.
4. GitHub, notification, audit, trash, restore, and provider effects are explicitly included or explicitly excluded.
5. Full-page and modal states cover read, pending, success, validation, permission-denied, stale/concurrent, empty, and failure behavior.
6. Accessibility covers labels, keyboard order, focus restoration, announcements, destructive confirmation, and responsive reflow.
7. The current binding implementation bridge is updated so implementers have one unambiguous source of truth.
