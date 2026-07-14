# Existing Capability Placement — Item Detail

Status: binding implementation bridge for the approved Item UI direction
Initial review baseline: `origin/main@66bf53945c5b999512df09ab6cfd2b2e40414c4d`
Integration baseline: `origin/main@1bbe36f`
Applies to: active Deliverable and Sub-Issue detail, full page and modal
Scope: placement and presentation of existing capabilities only

## Purpose

The development screens reorganize the Item UI, but they do not visibly account for every capability already present in FounderOps. This document fixes that gap.

It is normative for the capabilities listed below. Implementations must preserve the current data, mutations, permission predicates, and domain distinctions while adopting the new information hierarchy. A mockup artifact never authorizes a new action or the removal of an existing capability.

## Binding Principles

1. **One data meaning, one visible place.** A value may have a compact header representation and an editing control in the same semantic slot, but it must not appear as two competing facts.
2. **Authored requirement and operational proof stay separate.** `Evidence Required` is not the same field as the submitted Evidence Link.
3. **Governance stays secondary.** Approval and Review remain available but do not compete with work status or `Zuständig`.
4. **Narrative blockers are not relationship edges.** A reported `TaskBlocker` remains distinct from `Wartet auf` and `Andere warten hierauf`.
5. **Existing permission helpers are authoritative.** Do not copy or reinterpret role matrices inside new UI components.
6. **The modal and full page use the same semantic content.** Only the rail-to-disclosure transformation and container chrome differ.
7. **Visible state is routine success feedback.** Do not add a success toast when the saved value, new row, imported comment, or sync status is already visible.
8. **Failure is placed with the affected capability.** Do not route all item errors to one page-bottom message.
9. **Empty optional read content is omitted.** Editing may reveal an empty field when the current user is allowed to populate it.
10. **No unsupported screen action is implemented.** In particular, the mockup labels `Archivieren`, `Löschen`, and `Antworten` do not map to current Item capabilities.

## Placement Summary

| Existing capability | Authoritative data | Primary new placement | Secondary trace |
|---|---|---|---|
| Evidence Required | `task.evidenceRequired` | `Übersicht` authored content | Activity after a saved change, using existing activity behavior |
| Evidence Link | `task.evidenceLink` | `Übersicht` proof card / edit field | GitHub import may update it through the existing workflow |
| Approval | approval fields on `Task` | Secondary rail / `Weitere Details`; policy note near header only when work is locked | Activity and existing decision history |
| Review | review fields on `Task` | Secondary rail / `Weitere Details` | Relevant Review activity in `Aktivität` |
| Reported Task Blocker | `TaskBlocker[]` | `Übersicht` operational-risk section | Header work status and Activity event |
| Work status | `task.status` | Operational header | Relevant Activity event |
| Primary owner | `task.assigneeId` / `task.assignee` | Operational header | Relevant Activity event |
| Priority | `task.priority` | Operational header | Relevant Activity event |
| Initiative, Sprint, Milestone, period | Task planning fields plus referenced entities | Resolved Epic / Meilenstein in the identity line; controls in secondary rail / `Weitere Details` | Relevant Activity event |
| GitHub comment import | `TaskExternalComment[]` plus import state | `Aktivität` | Compact local notice inside Activity |
| GitHub Issue sync | GitHub Issue and sync fields on `Task` | Secondary rail / `Weitere Details` | GitHub-related Activity where already recorded |
| Withdraw to trash | approval/trash state plus current permission predicate | Last action in secondary rail / `Weitere Details` | Redirect or modal close after success |

## 1. Evidence Required and Evidence Link

### Domain distinction

- `task.evidenceRequired` answers: **What proof must exist for this item to be accepted?**
- `task.evidenceLink` answers: **Where is the submitted proof?**

They must remain separate fields with separate labels. Never copy the URL into Evidence Required and never use Evidence Required as the link-card title.

Visible German labels:

- `Erforderlicher Nachweis` for `evidenceRequired`;
- `Nachweis` for `evidenceLink`.

### Data source and current code path

- Data: `Task.evidenceRequired` and `Task.evidenceLink` in `src/lib/types.ts`.
- Authored brief mapping: `TaskBriefSection` and `buildTaskBriefDraft` in `src/features/tasks/molecules/task-brief-section.tsx` and `src/features/tasks/model/task-detail-state.ts`.
- Evidence Link presentation/editing: `TaskEvidenceLinkSection` in `src/features/tasks/molecules/task-evidence-link-section.tsx`.
- Client state and mutations: `useTaskDetailController`; both fields ultimately use the existing `PATCH /api/tasks/[id]` path.
- GitHub comment import may supply an Evidence Link through `useTaskComments` and `POST /api/tasks/[id]/github-comments`.

### New UI placement

`Übersicht` renders authored and operational proof content in this order when present:

1. Problem Statement
2. Intended Outcome
3. Scope & Constraints
4. Acceptance Criteria
5. `Erforderlicher Nachweis`
6. `Nachweis`
7. Definition of Done
8. immediate risk or next-step content that is backed by existing data

`Erforderlicher Nachweis` is plain authored content. `Nachweis` is a compact external-link row, not another prose card.

### Read behavior

- Omit either section independently when its value is empty.
- Preserve line breaks in Evidence Required.
- For an Evidence Link, show a link icon, a display-safe label, hostname/provider when it can be derived locally, and an external-open action.
- The full URL remains the link target and accessible name source.
- When no stored or locally derivable document title exists, use the hostname or a safely shortened URL. Do not fabricate a document title.
- One URL remains one Evidence object. Do not imply multiple evidence attachments.

### Edit behavior

- The Item/Overview edit state exposes both fields separately.
- Evidence Required uses the authored brief textarea.
- Evidence Link uses a labelled URL/text input plus a local preview.
- `Speichern` submits permitted dirty values through the existing Task update flow. `Abbrechen` restores both values from the current Task.
- Do not retain the current read-mode input or blur-only save behavior in the new display-first surface.
- If one field is not editable for the current user, keep its read representation while other permitted fields enter edit state.

### Permissions

- Evidence Required follows `permissions.canEditBrief`.
- Evidence Link follows `permissions.canEditEvidence`.
- Read visibility follows Item-detail read access; edit access must not be inferred from whether the field is currently empty.
- Preserve all existing server-side update authorization and approval-revision behavior.

### Loading, error, and success

- Base Task loading uses the Overview skeleton; do not show empty Evidence states while the Task is unresolved.
- A field validation or update failure is shown below the affected field and keeps the draft intact.
- If GitHub import cannot refresh Evidence, show that failure in Activity with the import control; do not erase the last successful link.
- Successful save is confirmed by the updated read content/link card. No success toast is required.

### Full-page and modal treatment

- The same section order and link representation appear in both surfaces.
- Full page keeps the readable main-column measure.
- Modal keeps the same content inside the active `Übersicht` panel; it must not move Evidence into `Weitere Details`.

### Non-goals

- No file upload in the Evidence section.
- No multiple-Evidence model.
- No remote Open Graph, Drive, Notion, or GitHub metadata fetch.
- No automatic Evidence acceptance or completion rule.
- No replacement of Evidence Required by the Evidence Link.

## 2. Approval

### Data source and current code path

- Data: `approvalStatus`, `approvalRevision`, proposal/decision actor and time fields, `decisionNote`, and inherited `parentApprovalStatus` on `Task`.
- Policy: `approval-domain.ts`, including `isTaskPlanningActive`, `canApproveDeliverableApproval`, `canRejectDeliverableApproval`, `canReturnDeliverableForRevision`, and `currentApprovalDecisionReason`.
- Current UI: `TaskDetailPanelSidebar`, `ApprovalDecisionDialog`.
- Mutation: existing `POST /api/tasks/[id]/approval` flow through the Planning controller.

### New UI placement

- Routine Approval state belongs in a rail group labelled `Freigabe`.
- In the modal or constrained layout, the same group appears inside `Weitere Details`.
- Approval never replaces `task.status` in the operational header.
- When lack of Approval currently prevents work, show one compact persistent policy note directly below the operational facts. The full status, revision, reason, and actions stay in the secondary group.

### Read behavior

- Deliverable: show current Approval status, revision, decision reason when present, and relevant decision provenance already available on the Task.
- Sub-Issue: show the inherited Parent-approval state only when it changes whether the Sub-Issue is active; otherwise omit the routine inherited state.
- Do not promote an approved state as a large success card.
- Do not display raw actor profile IDs.

### Edit/action behavior

- Approval remains action-based, not a free-form editable select.
- Reuse the existing actions `Freigeben`, `Ablehnen`, and `Zur Überarbeitung` only when their current predicates allow them.
- Reuse the existing decision dialog and note behavior for reject/return decisions.
- Approval actions are independent of the Overview edit mode and must not be mixed into its Save/Cancel contract.

### Permissions

- The existing approval-domain predicates are the sole visibility and enablement source.
- Do not implement a client-side role shortcut such as “CEO sees every action” without evaluating the current Task state and revision.
- Disabled policy state uses the current reason near the group or header policy note.

### Loading, error, and success

- While a decision is pending, disable all competing Approval actions and keep the dialog content stable.
- A rejected decision request shows one persistent error in `Freigabe`, preserving the entered note.
- On success, the new Approval status/revision and changed action set are the confirmation.
- If the decision changes whether the Task can be worked, update the header policy note without a second message.

### Full-page and modal treatment

- Full page: compact rail definition rows and actions.
- Modal: same group inside `Weitere Details`; a work-locking policy note remains above the tabs and is never hidden in the disclosure.

### Non-goals

- No new Approval state, transition, auto-approval, or permission.
- No Approval tab.
- No use of Approval as work status.
- No redesign of the decision/revision model.

## 3. Review

### Data source and current code path

- Data: `reviewStatus`, `reviewOwnerProfileId`, `reviewRequestedAt`, `scoreFinal`, and `scorePoints` on `Task`.
- Permission projection: `taskDetailPermissions`, plus existing Review and final-status policies.
- Current UI: Review block in `TaskDetailPanelSidebar`; detailed workflow in `TaskReviewSheet`.
- Mutations: existing Review, reopen, Task update, and review-sheet endpoints/controllers.

### New UI placement

- Place Review in the secondary rail below Planning and above GitHub.
- Use `Weitere Details` in the modal.
- Show Review Owner only here; it never competes with primary `Zuständig` in the header.
- Review-related events remain part of `Aktivität` when already present in `taskActivity`.

### Read behavior

- Show Review status in plain text.
- Show Review Owner by display name when assigned.
- Show request timestamp and final score only when they exist and are relevant.
- When Review is not active and no Review Owner exists, omit the empty Review Owner row in reading mode.
- Preserve the `Self-Review` clarification when the current data identifies it.

### Edit/action behavior

- Review Owner changes use the existing `CustomSelect` and current Task update path.
- `Zum Review-Blatt` opens the existing Review surface when current state and permission permit.
- Reopen/finalization actions stay in the existing Review workflow; they are not recreated as generic Item edit fields.
- Review actions remain independent of Overview Save/Cancel.

### Permissions

- `canManageReviewOwner` controls the Review Owner selector.
- `canOpenReview` plus the existing approved/active-state checks control the Review-sheet action.
- Current Review/final-status predicates control reopen and finalization.
- Non-editors may read the Review state but must not see a misleading editable control.

### Loading, error, and success

- Pending owner or Review actions disable their initiating controls.
- Errors remain inside the Review group or Review sheet, not in a toast.
- Successful owner change or completed Review is confirmed by the updated Review group and Activity where already recorded.

### Full-page and modal treatment

- Content and actions are identical.
- Full page uses the rail; modal uses `Weitere Details`.
- An open Review sheet remains its existing overlay/workflow and is not embedded into the Item tab content.

### Non-goals

- No Review tab in the Item detail.
- No new score, reviewer, or finalization model.
- No promotion of Review Owner to primary Item owner.
- No inline replacement for the existing Review sheet.

## 4. Reported Task Blockers

### Domain distinction

A `TaskBlocker` is a founder-reported operational escalation with:

- reason;
- impact;
- person or party whose help is needed;
- open/resolved/carryover state.

It is not a `blocked_by` relationship. A Task may have a reported blocker, a `Wartet auf` edge, both, or neither.

### Data source and current code path

- Data: `TaskBlocker` in `src/lib/types.ts`; loaded as `taskBlockers` by `loadTaskDetailData`.
- Current UI: `TaskDetailPanelBlockerSection`.
- Permission: `permissions.canReportBlocker` from `taskDetailPermissions`.
- Mutation: existing `POST /api/tasks/[id]/blockers` through the Planning collaboration controller.

### New UI placement

- Place full blocker content in `Übersicht` after the authored brief and proof content under `Gemeldete Blocker`.
- Open blockers appear first. Resolved or accepted-carryover entries may remain in a collapsed history disclosure.
- The operational header continues to show authoritative `task.status`. When that status is `Blockiert`, no second status badge is added.
- A compact `1 offener Blocker` or `{N} offene Blocker` anchor may be shown in the operational-risk slot when at least one open report exists. It links to the Overview section and must not be merged into the dependency band.
- Blocker creation and important blocker changes may appear in `Aktivität` only through the existing activity data.

### Read behavior

- Every Item reader who may read the detail can see safe blocker content.
- A blocker row shows reporting person, state, reason, impact when present, and `Braucht Hilfe von` when present.
- Do not render empty `Impact` or help rows.
- No blockers means no Overview section. If an authorized user explicitly opens the report form, the form itself supplies the context.

### Edit/action behavior

- `Blocker melden` reveals or focuses one local form in Overview.
- The form keeps the existing three inputs and server validation.
- Reporting is an independent operational action, not part of Overview Save/Cancel.
- The current detail surface does not provide a general edit or resolve mutation for existing blocker records; do not invent one.

### Permissions

- `canReportBlocker` controls form/action visibility.
- Read access and report access are separate; do not hide existing blocker records merely because the current user cannot report one.
- Server authorization remains authoritative.

### Loading, error, and success

- While detail data loads, show a compact blocker-section skeleton only when the Overview risk region is reached; do not claim zero open blockers.
- Report failures appear below the form and preserve reason, impact, and help input.
- Successful reporting inserts the visible blocker and updates the work status through the existing workflow. No success toast is needed.
- A detail-data failure must not be represented as `Keine Blocker`.

### Full-page and modal treatment

- Both surfaces use the same Overview section.
- Modal does not move blocker content into `Weitere Details` because it is operational work state.
- Long blocker text wraps inside the main content measure; no nested card stack is introduced.

### Non-goals

- No conversion between reported blockers and relationship edges.
- No new blocker resolution/edit API.
- No SLA, severity, or escalation score.
- No red treatment for every blocker; red remains reserved for an existing critical failure state.

## 5. Status, Owner, Priority, and Planning Edits

### Data source and current code path

- Work facts: `status`, assignee/owner fields, `priority`, and `deadline` on `Task`.
- Planning: `packageId`, `sprintId`, `milestoneId`, `startDate`, `endDate`, and for Sub-Issues `parentTaskId` plus inherited values.
- Referenced data: `Package[]`, `Sprint[]`, `Milestone[]`, `Profile[]`, and direct Parent Tasks.
- Current UI: `TaskStatusControl` plus controls in `TaskDetailPanelSidebar`.
- Client normalization/mutation: `buildClientTaskUpdatePatch`, `taskUpdateRequestPayload`, Planning update commands, and `PATCH /api/tasks/[id]`.

### New UI placement

Operational header:

1. work status;
2. `Zuständig`;
3. priority when present;
4. `Ziel` from `task.deadline` when present;
5. resolved Epic / Meilenstein as read-only hierarchy context when one exists.

Secondary rail / `Weitere Details`:

- Initiative;
- Sprint;
- Epic / Milestone controls;
- start/end period;
- Parent-Deliverable and inherited planning context for a Sub-Issue;
- Initiative-RACI as contextual information, not an Item owner.

The rail must not repeat status, owner, priority, or deadline as read-only facts.

### Read behavior

- Header facts use text-first, compact presentation. A resolved Epic / Meilenstein is hierarchy context, not a second planning control.
- Missing optional priority or deadline is omitted.
- Missing owner is visible as `Zuständig · Nicht zugewiesen` because it is actionable work state.
- Planning values use compact definition rows; expected empty values such as no Sprint or no Epic remain visible only when they explain the item's planning position.
- Use `task.deadline` for `Zieltermin`; never display a Sprint name as the deadline value.

### Edit behavior

- Work status retains the existing direct `TaskStatusControl` behavior and lock explanation. It is not delayed behind Overview Save.
- Header `Bearbeiten` enters only the local Overview edit mode defined in `100-development-screen-spec.md` and `130-interaction-responsive-accessibility-contract.md`; it does not establish a page-wide Item edit context.
- Owner, priority, and deadline retain their own permission-gated in-place controls in the operational header.
- Initiative, Sprint, Milestone, period, Parent, and Review Owner retain their own permission-gated in-place controls in the secondary rail / `Weitere Details`.
- Each direct control submits its smallest valid Task patch through the existing update flow. Existing coupled patches for Initiative/Milestone and Parent inheritance remain permitted.
- These direct changes do not participate in the Overview dirty state and are not reverted by Overview `Abbrechen`.
- Overview `Speichern` submits only the permitted dirty Overview fields listed in `100-development-screen-spec.md`; Overview `Abbrechen` restores only that local draft.
- Approval and Review actions, GitHub actions, reported-blocker creation, relationship management, Sub-Issue creation, and withdraw remain independent actions outside this edit transaction.

### Permissions

- `canUpdateStatus` and `canUpdateWorkingStatus` govern work-status transitions.
- `canManageFinalStatus`, `canCompleteSubIssue`, and `canReopenSubIssue` retain their existing transition effects.
- `canManageTaskMeta` governs owner, priority, Initiative, Sprint, Milestone, period, and deadline controls.
- `canReparentSubIssue` governs Parent-Deliverable changes.
- `canEditBrief`, `canEditChecklist`, `canEditEvidence`, and `canEditNotes` continue to gate their respective Overview fields.
- The UI consumes `taskStatusOptionsForPermissions` and existing lock reasons. It must not expose options and then rely on the server to hide unauthorized transitions.

### Loading, error, and success

- Task-level initial loading reserves the header fact positions without displaying default values.
- Pending direct status changes disable competing status transitions.
- Overview edit keeps its complete local dirty draft until success or explicit Cancel.
- Field-specific validation appears beside the affected field; a server conflict appears once above the edit area and retains safe current content.
- Successful direct changes are confirmed by the updated value in their semantic slot. Successful Overview edit is confirmed by returning to read mode with updated Overview values.

### Full-page and modal treatment

- The same values, options, permission decisions, and edit state apply to both surfaces.
- Full page keeps planning controls in the rail.
- Modal keeps direct Planning controls in `Weitere Details`; using one does not enter or leave Overview edit mode.
- The modal header may wrap controls but must keep status and owner first.

### Non-goals

- No new status, priority, planning field, overdue rule, or role.
- No owner inference from creator, Review Owner, or RACI.
- No status/owner duplication between header and rail.
- No automatic reparenting, sprint assignment, or approval bypass.

## 6. GitHub Comment Import and GitHub Issue Sync

### Domain distinction

- **Comment import** refreshes external GitHub comments and may discover an Evidence Link.
- **Issue sync** creates or updates the GitHub Issue projection for the Task.

They are separate actions with separate pending and failure states.

### Data source and current code path

Comment import:

- Data: `TaskExternalComment[]`, local import notice/pending state, and existing comment delivery state.
- UI/hooks: `TaskCommentThread`, `TaskCommentTimeline`, `useTaskComments`, and Planning collaboration commands.
- Mutation: `POST /api/tasks/[id]/github-comments`.

Issue sync:

- Data: `githubRepo`, `githubIssueNumber`, `githubIssueUrl`, `githubIssueSyncStatus`, `githubIssueLastSyncedAt`, `githubIssueSyncError`, and `githubIssueSyncPendingSince`.
- UI/hooks: current GitHub group in `TaskDetailPanelSidebar`, GitHub sync command and queue helpers.
- Mutation: `POST /api/tasks/[id]/sync-github`.

### New UI placement

- `GitHub aktualisieren` for comment import belongs in the `Aktivität` panel toolbar.
- Imported GitHub comments appear in the same Activity timeline with their GitHub source and open-link affordance.
- Issue link, sync state, `Sync`, and `GitHub Issue anlegen` belong in one compact `GitHub` group in the secondary rail / `Weitere Details`.
- Global installation/user-connection state remains application chrome and must not interrupt the Item header.

### Read behavior

- Activity renders local comments, imported GitHub comments, and useful activity records without duplicating them in Overview.
- GitHub comments keep author login/avatar, timestamp, body, and `In GitHub öffnen` when available.
- The GitHub rail group shows one state sentence, one Issue link when present, and at most one primary action.
- When no Issue exists, show `Noch kein GitHub Issue` once. Do not repeat it as a card, caption, and disabled action message.

### Edit/action behavior

- Comment import is a direct refresh action, not part of Item edit mode.
- Issue sync/create is a direct asynchronous action, not part of Item edit mode.
- The Activity composer retains existing local comments, mentions, and attachment upload behavior.
- Attachment upload remains part of composing a comment; it is not the Overview Evidence upload mechanism.

### Permissions and eligibility

- Existing comment/read-only permissions control comment import and composer availability.
- Existing server guards remain authoritative for comment import, sync, and Issue creation.
- Reuse current approval/activity eligibility, GitHub installation availability, user connection, and pending-sync checks.
- Do not expose a sync action that is known to be unusable without its adjacent reason.

### Loading, error, and success

Comment import:

- Disable the refresh action while pending and show one local Activity notice.
- Keep already imported comments visible during refresh.
- Import failure appears at the top of Activity with the retry action.
- Success is the updated timeline plus one compact result notice; no toast.

Issue sync:

- Pending state replaces the action label with `Sync...` or `Anlegen...` and keeps the last known Issue link visible.
- A stale, locked, reconnect, or persistence failure appears inside the GitHub rail group using the existing classified message.
- Success updates the Issue link, sync state, and last-synced information. No toast is needed.

### Full-page and modal treatment

- Activity content is identical in both surfaces.
- Full page shows the GitHub group in the rail.
- Modal shows it inside `Weitere Details`; a sync error remains visible when that disclosure is opened and may contribute one compact attention marker on the disclosure label.
- Neither surface moves GitHub sync into the operational work-status row.

### Non-goals

- No bidirectional source-of-truth change.
- No GitHub label, milestone, project, PR, release, or deployment management added to this UI.
- No new attachment store; current uploads retain their existing GitHub-backed behavior.
- No automatic Issue creation outside the existing explicit action.

## 7. Withdraw to Trash

### Data source and current code path

- Eligibility: `canWithdrawPlanningRoot` evaluated for a Deliverable with its Approval and proposer state.
- Current UI: `TaskDetailPanelSidebar` plus `PlanningTrashActionDialog`.
- Client workflow: `useTaskWithdrawCommand` and Planning controller state removal/rollback.
- Mutation: existing `POST /api/tasks/[id]/withdraw`.
- Direct `DELETE /api/tasks/[id]` intentionally returns `410` and is not an available Item action.

### New UI placement

- Place the action last in `Weitere Aktionen` at the bottom of the secondary rail.
- In the modal, place it last inside `Weitere Details`, visually separated from routine metadata and GitHub actions.
- Use the existing label `Deliverable zurückziehen` and explanatory trash-retention copy.
- Do not use the mockup labels `Archivieren` or `Löschen`.

### Read/action behavior

- Render the action only when `canWithdrawTask` is true.
- Selecting it opens the existing confirmation dialog and requires the existing reason.
- The dialog must describe that the Deliverable and its Sub-Issues leave active planning while retained trash records remain available to the existing lifecycle.
- This action is independent of Overview edit mode.

### Permissions

- `canWithdrawPlanningRoot` remains the sole client visibility predicate.
- The server endpoint remains authoritative and validates expected Approval revision and actor permission.
- Do not expose disabled withdraw controls to users who have no actionable path unless an existing policy explanation is required.

### Loading, error, and success

- While pending, lock the confirmation action and prevent duplicate submission.
- On failure, keep the dialog open with its reason and show the server message inside the dialog.
- Roll back any optimistic removal through the existing command behavior.
- On full-page success, return to Planning using the existing route behavior.
- On modal success, remove/close the selected Item through the existing Planning controller. No success toast is required after the Item disappears.

### Full-page and modal treatment

- The same eligibility, explanation, dialog, and mutation apply.
- Full page: action is last in the rail.
- Modal: action is last in `Weitere Details`; the confirmation remains a separate accessible dialog above the Item modal.

### Non-goals

- No direct delete.
- No generic archive state.
- No purge action from active Item detail.
- No Sub-Issue-only delete shortcut.
- No bypass of Approval revision or trash-retention rules.

## Cross-Capability Loading and Error Contract

The new UI cannot treat an unavailable detail query as empty content.

Implementation must preserve these distinctions:

| Data class | Loaded with | Failure placement |
|---|---|---|
| Base Task and planning references | Planning page/detail data | Item-level state below container chrome |
| Comments, external comments, Activity | Task detail data | `Aktivität` panel |
| Reported blockers | Task detail data | Overview blocker section / one partial-data notice |
| Relationship edges | Task detail data and current planning state | Relationship summary plus `Beziehungen` panel |
| GitHub connection/sync state | Task plus current auth snapshot | GitHub rail group or application utility when connection-wide |

Required implementation correction:

- full-page server rendering must propagate a non-404 Task-detail load error instead of replacing it silently with `emptyTaskDetailData`;
- partial-data behavior must never produce false zero counts or `Keine ...` copy;
- modal and full page must expose the same loaded/error semantics.

This correction does not add a product capability. It is required to present existing data truthfully.

## Full-Page and Modal Composition Contract

### Shared semantic component tree

Both surfaces consume one Item-detail presentation model containing:

- operational facts and permissions;
- authored Overview fields;
- reported blockers;
- direct Sub-Issues;
- relationship groups;
- comments/external comments/Activity;
- secondary Approval, Planning, Review, GitHub, provenance, and withdraw groups.

The full-page and modal wrappers may provide different chrome, but they must not calculate independent capability visibility or counts.

### Full page

- Operational header and tabs span the main content grid.
- Active content occupies the main readable column.
- Secondary capability groups remain in the compact rail.
- Permission-gated rail controls keep their existing independent direct-update behavior.

### Modal

- Use an explicit modal surface variant or container-aware layout. Do not rely only on viewport `lg:` rules inside the 920-pixel panel.
- Keep container Back, `Große Ansicht`, and Close separate from Item actions.
- Keep the operational header and tabs available in the modal scroll contract.
- Replace the rail with `Weitere Details` after the active content panel.
- Preserve active tab and dirty edit state when using `Große Ansicht` only if an existing safe routing/state mechanism is implemented; otherwise require an explicit unsaved-change decision before leaving.

## Screen Artifacts That Must Not Drive Implementation

- `Zieltermin: Sprint 1` — use the actual deadline date; Sprint remains a separate planning value.
- `Beziehungen 2` alongside three unique linked items — the count must use the finalized unique-visible-relationship contract.
- `Aktivität 3` without a defined count source — use the finalized relevant-system-activity count; comments remain separate timeline entries unless the normative count contract is changed.
- `Archivieren` and `Löschen` — replace with the existing eligible `Deliverable zurückziehen` action.
- `Antworten` — omit because there is no reply/thread capability.
- Initiative as a relationship target — omit because current relationship edges connect Tasks only.
- Row kebab menus — render only after their exact existing actions and permission predicates are defined; a decorative menu is not allowed.
- Remote Evidence document title — use a safe local fallback instead of invented metadata.

## Implementation Acceptance Gate

The capability placement is preserved only if all statements are true:

1. Evidence Required and Evidence Link remain separately readable and editable.
2. Status and `Zuständig` appear once in the header and keep current permissions.
3. Approval and Review remain usable from the rail / `Weitere Details` without competing with work ownership.
4. Reported blocker reason, impact, and requested help remain readable and reportable outside the relationship view.
5. Planning edits, reparenting, and status locks preserve existing server and client policy.
6. GitHub comment import stays in Activity; GitHub Issue sync stays in secondary details.
7. Withdraw uses the existing trash workflow, wording, confirmation, permission, and rollback behavior.
8. Full page and modal expose the same capabilities and error truth.
9. No current capability disappears merely because it is absent from the eight mockups.
10. No unsupported mockup action is implemented as a placeholder or inert control.
