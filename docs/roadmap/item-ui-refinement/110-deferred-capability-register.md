# Deferred Capability Register — Item Detail

Status: temporary deferred-capability register; negative scope only
Initial review baseline: `origin/main@66bf53945c5b999512df09ab6cfd2b2e40414c4d`
Integration baseline: `origin/main@1bbe36f`
Applies to: active Deliverable and Sub-Issue detail, full page and modal

> **Every capability in this register is NOT PART OF THE CURRENT UI IMPLEMENTATION.**
>
> The mockups are visual evidence of possible future intent, not authorization to add a control, mutation, field, permission, or provider integration. The current implementation must follow `120-existing-capability-placement.md`: omit unsupported controls, preserve existing capabilities, and use safe local fallbacks.

## Purpose and release discipline

This register prevents visually plausible mockup details from becoming accidental product scope. Each entry records:

- where the future affordance appears in the development screens;
- what the current product actually supports;
- why the affordance is excluded now;
- the minimum data, API, permission, UI, and failure contract required before it can be approved;
- the evidence required to remove the `deferred` status.

No entry may move into the Item UI through presentation work alone. It requires a separately approved product and implementation scope. Existing authorization helpers remain authoritative until that scope explicitly changes them.

## Summary

| Deferred capability | Visible mockup origin | Current supported behavior | Current implementation rule |
|---|---|---|---|
| Generic archive | `02-overview-lower-end.png`, rail action `Archivieren` | Eligible Deliverables can be withdrawn to the planning trash | Omit `Archivieren`; retain `Deliverable zurückziehen` only when currently permitted |
| Direct delete | `02-overview-lower-end.png`, destructive action `Löschen` | Direct Task DELETE returns `410`; expired trash is purged by protected maintenance | Omit `Löschen` |
| Activity replies | `08-activity-composer.png`, `Antworten` below a comment | Flat local and imported comments in one Activity timeline | Omit `Antworten` |
| Row kebab menus | `05-sub-issues-manage.png` and `07-relationships-manage.png`, trailing ellipsis controls | Rows open Items; removable relationships use the current explicit remove control | Omit menus until every action is defined and permission-backed |
| Initiative relationship target | `07-relationships-manage.png`, target placeholder naming Initiative | Relationship edges connect Task records only; the current picker offers Deliverables | Omit Initiative targets |
| Document title and provider metadata | `02-overview-lower-end.png`, Evidence card title and `Google Slides · drive.google.com` | One `evidenceLink` string, rendered through a safe local link preview | Use hostname or shortened URL fallback; do not fetch or invent a title |

## 1. Generic archive

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Visible mockup origin

- `development-screens/02-overview-lower-end.png`
- Right rail, `Weitere Aktionen`, neutral action labelled `Archivieren`.

### Current product state

There is no generic archived state for planning Items.

- `src/lib/status.ts:4` defines only the active work statuses `Offen`, `In Arbeit`, `Review`, `Nacharbeit`, `Blockiert`, and `Erledigt`.
- `supabase/migrations/20260713120959_production_baseline.sql:4793-4871` defines `active_tasks` by `trashed_at is null`; it has no archive predicate or archive metadata.
- `src/features/tasks/organisms/task-detail-panel-sidebar.tsx:425-453` exposes only the existing planning-trash action `Deliverable zurückziehen`.
- `src/features/planning/model/planning-trash-contract.ts:45-61` limits withdrawal to eligible draft/proposed roots and the existing proposer/operational-lead policy.
- `src/app/api/tasks/[id]/withdraw/route.ts` and `src/lib/planning-trash-api.ts:114-170` implement withdrawal, revision checks, audit metadata, and GitHub lifecycle handling.
- `src/lib/github.ts` contains a provider-level `archiveGitHubIssue` helper, but it is not an Item archive capability and is not wired to the active Task DELETE or detail UI.

### Why excluded now

`Archivieren` has no agreed domain meaning. It could mean completed-history cleanup, removal from active planning, reversible retention, or a GitHub lifecycle action. Those meanings have different effects on Sub-Issues, relationships, Review, notifications, counts, search, reporting, and restore behavior. Mapping it to the trash workflow would also bypass the current eligibility wording and make archive and withdrawal appear interchangeable.

### Required future contract

**Data**

- Decide whether archive is a separate lifecycle state or a projection of an existing state. It must not silently reuse `status` or `trashed_at`.
- If separate, define archive metadata such as actor, timestamp, reason, revision, root type, and cascade scope.
- Define whether archiving a Deliverable includes its Sub-Issues and how archived endpoints affect relationship counts and blockers.
- Define archive retention and whether archived Items are ever automatically purged.

**API**

- Add explicit archive and unarchive operations with compare-and-set revision handling and idempotent retry behavior.
- Record audit events and define the GitHub projection: unchanged, closed, reopened on restore, or another approved state.
- Update active/detail/search/count loaders so archived Items are neither lost nor returned as active by accident.

**Permissions**

- Approve an archive/unarchive role-and-state matrix separately from `canWithdrawPlanningRoot`.
- Authorize on the server for both the root and affected children; the UI must consume the same policy projection.
- Decide whether owners may archive completed work or whether the action is operational-lead only.

**UI**

- Define the confirmation copy, optional or required reason, post-success destination, archive browser, and restore entry point.
- Show the number and type of affected children before confirmation when the action cascades.
- Keep archive distinct from `Erledigt`, `Deliverable zurückziehen`, and permanent deletion.

**Errors and edge cases**

- Concurrent update or stale revision.
- Item already archived, trashed, rejected, or restored in another session.
- Active Sub-Issues, open Review, open blockers, or relationships to active Items.
- Partial GitHub lifecycle failure after the local archive succeeds.
- Archived Item opened through an old notification or direct link.

### Later release gate

Archive may be released only when its domain meaning, cascade and restore semantics, GitHub behavior, permission matrix, data migration, active/archive read models, audit events, and full-page/modal states are approved and covered by focused policy, API, and interaction tests.

## 2. Direct delete

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Visible mockup origin

- `development-screens/02-overview-lower-end.png`
- Right rail, `Weitere Aktionen`, red destructive action labelled `Löschen`.

### Current product state

Direct deletion is intentionally unavailable from an active Item.

- `src/app/api/tasks/[id]/route.ts:457-459` returns `410` with `Direktes Löschen ist nicht mehr verfügbar. Nutze den Papierkorb-Workflow.`
- `tests/platform-github-contract.test.mjs:118-140` explicitly verifies that the Task route does not call the legacy deletion transaction or delete from `tasks`, and that the detail UI shows the planning-trash workflow instead.
- `src/features/tasks/hooks/use-task-withdraw-command.ts` performs reversible optimistic removal, server withdrawal, and rollback on failure.
- `supabase/migrations/20260713120959_production_baseline.sql:3549-3672` gives withdrawn roots a 90-day purge date.
- `.github/workflows/purge-planning-trash.yml` invokes the protected bounded purge job; `src/app/api/maintenance/planning-trash/purge/route.ts` requires the maintenance secret and calls `purge_expired_planning_trash_batch`.
- The baseline still contains service-role-only legacy `task_deletion_operations` and prepare/finalize/cancel functions. They are dormant schema primitives, not an available product contract, and must not be reconnected implicitly.

### Why excluded now

Immediate deletion would bypass the approved recovery window and can cascade across Sub-Issues, comments, attachments, relationships, notifications, review history, audit references, and the GitHub projection. The current product deliberately separates reversible withdrawal from protected retention-based purge. A red mockup label is not enough to reverse that lifecycle policy.

### Required future contract

**Data**

- Approve which Item roots can ever be permanently deleted and whether children, attachments, comments, relationships, notifications, and audit records are deleted, anonymized, detached, or retained.
- Define an immutable deletion audit record and a preflight impact snapshot.
- Review the dormant deletion-saga schema against the current Initiative/Deliverable/Sub-Issue hierarchy before any reuse.

**API**

- Do not simply restore the old `DELETE /api/tasks/[id]` behavior.
- Define a protected preflight plus commit operation with an operation ID, compare-and-set revision, idempotency, bounded retries, and an explicit external GitHub side-effect contract.
- Define attachment/storage cleanup and reconciliation after ambiguous provider failures.
- Decide whether permanent deletion is ever an interactive Item action or remains maintenance-only.

**Permissions**

- Approve a dedicated destructive-operation policy, including whether reauthentication, a second approver, or a typed confirmation is required.
- Enforce the policy server-side with service-role functions inaccessible to normal clients.
- Separate permission to withdraw, restore, purge expired trash, and force-delete before expiry.

**UI**

- Present an impact summary before confirmation: root, descendant count, linked records, external Issue state, and irreversibility.
- Do not place permanent delete in a row kebab or next to routine actions without a separated danger zone.
- Keep the Item visible and the action locked while the operation is unresolved; never claim success after only a local optimistic removal.

**Errors and edge cases**

- Stale revision, duplicate operation, or Item already withdrawn/purged.
- Open children, incoming/outgoing relationships, pending GitHub comments, or unresolved lifecycle outbox entries.
- GitHub close succeeds but database deletion fails, or the response is lost after either side succeeds.
- Storage cleanup fails after relational deletion.
- Old direct links, notifications, or audit references target a deleted Item.

### Later release gate

Direct delete may be released only after an explicit retention and irreversibility decision, security review, approved authorization/reauthentication model, impact-preview contract, recoverability decision, GitHub and storage reconciliation design, service-role isolation proof, audit coverage, and lost-response/idempotency tests. Until then, the only active-detail removal path is the existing eligible withdrawal to trash.

## 3. Activity replies

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Visible mockup origin

- `development-screens/08-activity-composer.png`
- Inline `Antworten` affordance below Volkan's comment.

### Current product state

Comments are flat timeline entries.

- `src/lib/types.ts:248-269` gives local and imported comments no parent, thread, or reply-target field.
- `supabase/migrations/20260713120959_production_baseline.sql:5772-5778` stores only Task, author, body, and creation time for `task_comments`.
- `src/features/tasks/organisms/task-comment-thread.tsx:27-67` merges activities, local comments, and imported GitHub comments into one chronological list.
- `src/features/tasks/molecules/task-comment-timeline.tsx` renders comment bodies and provider links but exposes no reply callback.
- `src/features/tasks/molecules/task-comment-composer.tsx` creates only a new top-level comment.
- `src/app/api/tasks/[id]/comments/route.ts:10-49` accepts only `comment`; it has no reply validation or parent lookup.
- Local comments may be delivered as top-level GitHub Issue comments. GitHub Issue comments themselves do not provide the local threaded-reply model implied by the mockup.

### Why excluded now

The mockup does not decide whether a reply is visual indentation only, a persisted local thread, a quote plus mention, or a provider-linked response. It also does not define replies to imported GitHub comments, notification recipients, maximum nesting, ordering, deletion behavior, or GitHub delivery. Adding the affordance without those decisions would produce either a non-working control or data that cannot round-trip reliably.

### Required future contract

**Data**

- Store a stable reply target that can distinguish a local comment from an imported provider comment.
- Decide one-level replies versus arbitrary nesting and define root/thread identifiers and ordering.
- Preserve the referenced author and a safe excerpt when an imported or parent comment later disappears.
- Extend client and server comment types without losing current GitHub delivery status.

**API**

- Extend comment creation with an explicit reply target and validate that the target belongs to the same active Item.
- Define how a local reply projects to GitHub: top-level comment with durable reply metadata/quote, provider mention, or local-only.
- Make notification recipient selection explicit for parent author, mentions, assignee, and operational leads to avoid duplicate notifications.
- Preserve idempotent GitHub delivery markers for retried replies.

**Permissions**

- Start from the existing `canComment`/planning-contributor policy, but decide whether replying to imported content requires an active GitHub user connection.
- Read access to the parent must be revalidated server-side.
- Define behavior when the Item or target comment becomes unavailable between opening and submitting the reply.

**UI**

- `Antworten` must open or focus a composer with visible target author/excerpt and an explicit cancel action.
- Define reply depth, chronological order, collapsed threads, counts, mobile/modal indentation, and keyboard/focus behavior.
- Distinguish local reply state from GitHub delivery state without duplicating the same comment in the timeline.

**Errors and edge cases**

- Parent deleted, imported comment no longer returned, or target belongs to another Item.
- Reply saves locally but GitHub delivery waits, retries, or fails.
- Duplicate submit, stale target, blocked author connection, or notification failure.
- Long chains, deeply quoted content, attachments, mentions, and provider-authored HTML/Markdown.

### Later release gate

Replies may be released only after the threading depth and provider-projection decisions are approved; schema, mapper, API, notification, and delivery contracts are migrated; keyboard and screen-reader behavior is specified; and tests cover local, imported, pending-delivery, failed-delivery, missing-parent, and duplicate-submit states.

## 4. Row kebab menus

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Visible mockup origin

- `development-screens/05-sub-issues-manage.png`: trailing ellipsis on each Sub-Issue row.
- `development-screens/07-relationships-manage.png`: trailing ellipsis on each relationship row.

### Current product state

The current Item rows do not have a generic action menu.

- `src/features/tasks/molecules/task-detail-panel-sub-issues-section.tsx:31-38` exposes the Sub-Issue reference plus status/assignee and opens the Item through `TaskReferenceLink`.
- `src/features/tasks/molecules/relationship-list.tsx:54-84` opens the linked Task and conditionally exposes the existing direct remove action.
- `src/features/tasks/model/task-relationship-permissions.ts:22-51` computes the current relation-type and remove permissions.
- `src/shared/molecules/custom-action-menu.tsx` is an existing accessible menu primitive, but no Task-row action matrix supplies it with actions.
- No generic row-menu API exists. Every current mutation has its own hook, permission predicate, pending state, and error contract.

### Why excluded now

An ellipsis communicates that meaningful actions exist. The mockups do not define those actions, their order, destructive confirmation, disabled reasons, or role/state rules. A decorative or empty menu would reduce trust; a menu populated from guesswork could expose unauthorized or unsupported mutations.

### Required future contract

**Data**

- No new persistence is required for the menu itself.
- Every row must supply stable entity type, entity ID, current revision/state, and a typed capability projection containing visible/enabled state and disabled reason for each approved action.
- Any newly proposed action must have its own domain data contract; it cannot hide inside the menu implementation.

**API**

- Map each approved menu item to an existing mutation or a separately approved endpoint.
- Preserve each mutation's compare-and-set, audit, rollback, and error behavior; do not create a generic untyped `rowAction` endpoint.
- Revalidate permission and current state on selection because menu state can become stale while open.

**Permissions**

- Approve separate action matrices for Sub-Issue rows and relationship rows.
- Derive visibility/enabled state from existing centralized helpers where the capability already exists.
- Define when an unavailable action is hidden versus disabled with a reason.

**UI**

- Reuse `CustomActionMenu` for menu semantics, focus restoration, arrow navigation, Escape, outside click, and portalled positioning.
- Define exact labels, grouping, order, icons, danger treatment, confirmations, and whether row navigation remains a separate affordance.
- Only one row menu may be open at a time; opening or selecting it must not also open the Item.

**Errors and edge cases**

- Row is removed, completed, reparented, or permission-changed while the menu is open.
- Action succeeds but the list refresh fails, or optimistic state must be rolled back.
- Portalled menu is clipped or detached during modal/page scrolling.
- Disabled menu has no available actions, long translated labels, or keyboard focus returns to a removed row.

### Later release gate

Row menus may be released only after an approved per-row action table names every action, endpoint, permission predicate, confirmation, success state, and failure placement. Both row types must pass keyboard/focus tests, stale-state tests, and full-page/modal visual verification. Until then, render only explicit existing row affordances.

## 5. Initiative as a relationship target

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Visible mockup origin

- `development-screens/07-relationships-manage.png`
- Target placeholder: `Initiative, Deliverable oder Sub-Issue suchen`.

The same placeholder also promises Sub-Issue targets. That is a separate mismatch: the current picker explicitly excludes Sub-Issues.

### Current product state

Relationships are Task-to-Task edges.

- `src/features/tasks/model/task-detail-state.ts:134-137` builds targets from `Task[]`, excludes the current Task and every `sub_issue`, and therefore offers Deliverables only.
- `src/features/tasks/molecules/task-relationship-form.tsx:8-69` stores `relatedTaskId` and presents `Aufgabe auswählen`.
- `src/app/api/tasks/[id]/relationships/route.ts:81-129` validates both endpoints through the active Task read model before inserting an edge.
- `supabase/migrations/20260713120959_production_baseline.sql:5976-5985` stores `task_id` and `related_task_id`.
- The foreign keys at baseline lines `7183-7188` point both endpoints to `tasks`; an Initiative is stored as a `Package`, not a Task.
- `src/features/tasks/model/task-relationship-permissions.ts` evaluates rights from a current Task and its Initiative context, but it does not authorize an Initiative as an endpoint.

### Why excluded now

Initiative relationships require a cross-entity graph, not a picker-label change. The current schema, API, row mapper, permission model, counts, removal behavior, and GitHub projection all assume Task endpoints. The mockup does not decide which relation types are meaningful across levels or whether an Initiative blocks a Deliverable, contains it, or is merely related to it. Hierarchy must not be duplicated as a dependency edge by accident.

### Required future contract

**Data**

- Choose a cross-entity relation model: polymorphic endpoints or a separate Initiative/Task relationship table. Do not overload Task IDs with Package IDs.
- Store endpoint type and ID, relation type/direction, note, creator, timestamps, and a uniqueness rule.
- Define allowed endpoint pairs and relation types. Hierarchical parentage remains separate from dependency/related edges.
- Define cascade or tombstone behavior when either endpoint is trashed, restored, merged, or purged.

**API**

- Accept typed endpoint references and validate active existence, no self/duplicate relation, allowed pair, allowed direction, and cycle policy.
- Return a normalized display projection with endpoint type, stable ID, title, status where applicable, and responsible person.
- Extend detail loading, counts, create/remove activity, audit events, and any GitHub projection deliberately.

**Permissions**

- Authorize changes against both endpoint types. Task ownership alone cannot grant mutation rights over an Initiative.
- Define how Initiative Accountable/Owner, Task Owner/Assignee, CEO, and Deputy participate for each relation type and direction.
- Centralize the new matrix next to the current relationship policy and enforce it again in the API.

**UI**

- Group or label search results by Item type and show stable identifiers to disambiguate repeated titles.
- Restrict relation-type choices dynamically to the selected endpoint pair.
- Show Initiative rows with Initiative-appropriate metadata; do not fabricate Task status.
- Define whether the header dependency summary includes Initiative edges and how its count is calculated.

**Errors and edge cases**

- Initiative becomes inactive or is trashed between search and save.
- Duplicate reverse edge, forbidden pair, hierarchy mistaken for dependency, or cycle across entity levels.
- User can edit the Task but not the selected Initiative.
- Endpoint exists but is hidden by read permissions.
- GitHub cannot represent the cross-entity relationship or the Initiative has no Issue projection.

### Later release gate

Initiative targets may be released only after the allowed endpoint/relation matrix, direction semantics, hierarchy separation, schema and RLS model, dual-endpoint authorization, count rules, restore/purge behavior, and GitHub projection or explicit non-projection are approved. Search, add, remove, read, permission-denied, duplicate, cycle, and inactive-endpoint states require focused tests and full-page/modal screens.

## 6. Document title and provider metadata

**Status: DEFERRED — NOT PART OF THE CURRENT UI IMPLEMENTATION.**

### Visible mockup origin

- `development-screens/02-overview-lower-end.png`
- Evidence card displaying `Pitchdeck v2 – CEO-Briefing` and `Google Slides · drive.google.com` with a provider-specific icon.
- The early raster direction visually implies a document title and provider/host line. The current `100-development-screen-spec.md` explicitly supersedes that implication and permits only locally derivable provider/hostname information.

### Current product state

The product stores one Evidence URL string and no document metadata.

- `src/lib/types.ts:84-110` defines `Task.evidenceLink: string`; there are no title, provider, metadata source, or fetch-state fields.
- `supabase/migrations/20260713120959_production_baseline.sql:4793-4811` projects only `evidence_link` from Tasks.
- `src/features/tasks/molecules/task-evidence-link-section.tsx:13-31` edits the URL and renders it through `CommentBody`.
- `src/features/tasks/atoms/task-comment-body.tsx:8-35` validates safe link protocols and renders the supplied text; it does not resolve remote metadata.
- `src/features/tasks/model/task-route-update-helpers.ts:191-202` stores a trimmed `evidence_link` through the existing Task PATCH.
- `src/features/tasks/model/task-detail-permissions.ts:89-105` uses `canEditEvidence`; there is no separate metadata permission.
- The current UI scope may derive a hostname/provider label locally and must fall back to hostname or a safely shortened URL. It must not fabricate the mockup title or call Drive, Notion, GitHub, or Open Graph metadata services.

### Why excluded now

A trustworthy document title usually requires remote provider access, a metadata cache, or a manual stored title. The mockup does not say which source is authoritative. Fetching arbitrary URLs introduces server-side request forgery, redirect, timeout, rate-limit, privacy, and private-document authorization risks. Provider icons and names also become misleading when the URL is a redirect, shared domain, or inaccessible document.

### Required future contract

**Data**

- Decide whether the single Evidence URL remains on `tasks` with a separate metadata record or moves to a dedicated one-link Evidence object. This decision must not imply multi-Evidence support automatically.
- Minimum metadata: canonical URL, safe display title, provider key, hostname, source (`manual`, `local`, or `provider`), resolution status, fetched/verified timestamp, last error class, and revision.
- Preserve the original user URL and a manual title override; remote refresh must not silently replace an explicit title.

**API**

- Add a server-only metadata resolver with strict URL parsing, private-network blocking, redirect limits, timeouts, response-size/content-type limits, caching, and provider rate-limit handling.
- Define provider adapters and scopes separately for public URLs and private Google Drive/Notion/GitHub documents.
- Never send provider access tokens to the browser or store them in Evidence metadata.
- Add explicit refresh/retry behavior and make URL/title updates compare-and-set safe.

**Permissions**

- URL and manual-title edits should remain governed by the approved Evidence-edit policy unless a new policy is explicitly approved.
- Metadata read follows Item read access.
- Provider refresh is server-authorized and may require the requesting user's own provider connection; one user's private token must not enrich data another reader is unauthorized to see.
- Define whether only an editor may trigger refresh and whether server maintenance may refresh stale public metadata.

**UI**

- Use a deterministic fallback order: manual title, verified stored title, safe locally derived label, then hostname or shortened URL.
- Show provider plus hostname only when confidently derived; use a generic link icon otherwise.
- Define loading, unavailable, stale, refresh, and manual-edit states without blocking the Evidence link itself.
- Preserve the full URL as link target and accessible context while avoiding long raw-URL noise in the visual title.

**Errors and edge cases**

- Invalid or unsupported URL, private-network target, redirect loop, oversized response, timeout, or rate limit.
- Private document, revoked provider authorization, deleted document, or access denied.
- Provider title changes after a manual override.
- Unicode/confusable hostname, untrusted HTML title, missing title, or provider mismatch.
- Stored metadata is stale while the original link remains valid.

### Later release gate

Document metadata may be released only after the authoritative title-source and one-link data model are approved; server-side URL-fetch security and provider-token boundaries are reviewed; schema, caching, refresh, and fallback contracts exist; and tests cover public, private, invalid, redirected, timed-out, stale, inaccessible, and manual-override cases. The implementation must still render a useful link when all metadata resolution fails.

## Cross-capability release rule

Removing `DEFERRED` from any entry requires all of the following:

1. A separately approved product scope names the capability and its non-goals.
2. The data and API contract is migration-safe and preserves the planning hierarchy.
3. Server authorization is defined and tested; visual presence never grants permission.
4. GitHub, notification, audit, trash, restore, and provider effects are explicitly included or explicitly excluded.
5. Full-page and modal states cover read, pending, success, validation, permission-denied, stale/concurrent, empty, and failure behavior.
6. Accessibility covers labels, keyboard order, focus restoration, announcements, destructive confirmation, and responsive reflow.
7. The current binding implementation bridge is updated so implementers have one unambiguous source of truth.
