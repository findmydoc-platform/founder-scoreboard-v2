# Planning Item UI contract

The creation drawer, item detail page and item detail modal present the same Planning Item model. [Planning hierarchy](planning-hierarchy.md) defines item types, parent rules and compatibility. [Task template](task-template-v2.md) defines authored Deliverable content. This document owns their UI interaction and presentation contract; it does not grant an API permission or introduce a workflow.

## Creation

`src/features/tasks/organisms/new-task-dialog.tsx` owns the shared creation surface. `task-creation-draft.ts` owns request projection. Use the current form and server validation rather than copying an old field matrix.

| Type | Creation behavior |
| --- | --- |
| Epic | Strategic title, context, owner and optional target date. No approval, Sprint, Review, Evidence or GitHub workflow. |
| Initiative | Strategic goal, success criteria, scope, owner, optional Epic and RACI context. Approval has the additional hierarchy and RACI requirements in the hierarchy contract. |
| Deliverable | Title, authored brief, responsibility, planning context and optional initial relationship. It may be proposed without an Initiative; approval requires an approved Initiative. Sprint is assigned through planning, not created as a parent. |
| Sub-Issue | Required approved Deliverable parent and title, default owner, optional context, work brief, repository and initial relationship. Parent context is inherited, not duplicated as independently editable Initiative, Epic or RACI fields. No independent priority, Sprint, schedule, estimate, workstream, approval, Review, score or manual Evidence gate. |

The title must contain at least three characters after trimming. The form validates required parent selection for Sub-Issues and applies the shared content-length rules. Owner defaults and further server requirements remain effective. Optional brief fields must not become mandatory through presentation changes. Approval and external Issue creation are separate, permission-gated intents; changing the selected Initiative must not leave an invalid approve/create combination enabled.

Each opened form keeps one valid `creationRequestId`, generated once unless supplied by its opening context. Draft changes, validation failures and retry after a definite rejection reuse it. A fresh opening without a supplied ID gets a new UUID. The ID is not a visible input and grants no authority.

Creation is not safely repeatable merely because an HTTP response failed:

- `saving` blocks another submission of the operation.
- A definite rejection preserves the draft and allows correction with the same ID.
- An `unconfirmed` outcome retains the submitted operation and temporary item. Check its authoritative result before another creation; do not generate a new ID to bypass it.
- A `blocked` operation explains why related removal or another uncertain operation prevents dispatch.
- `partiallyConfirmed` means the item exists but a later approval step failed. Show the created item and approval problem; do not create it again.
- Session replacement discards obsolete results and protected operation state.

The existing operation notices and check actions own these distinctions. A successful visible insertion or drawer close is routine success feedback. A failure keeps the form and entered values available, with one local error summary. Untouched required fields do not show error styling. Show field validation after interaction or submission, associate it with the input, and focus the first invalid field or form error without resetting the draft or scroll position.

## Reading an item

`TaskDetailSurface` is shared by full page and modal and supports all four item types. Its information order is item identity and hierarchy, title/actions, operational facts, Planning context, dependencies, conditional workflow content, then tabs and the active panel. Type-inapplicable fields and actions are omitted. A primary owner is not a Review Owner, creator or RACI assignment.

The stored item update date and time appear directly below the title in both detail views. This timestamp is distinct from the fixed date and individual comment timestamps; it does not summarize discussion or descendant activity.

The local tabs are `Übersicht`, `Beziehungen` and `Aktivität`, in that order. Direct children belong in the Overview, not a fourth tab. The child type follows the hierarchy: Initiative below Epic, Deliverable below Initiative, Sub-Issue below Deliverable, and none below Sub-Issue. The child title and "Öffnen" use the same keyboard-accessible navigation; free row space does not open the item. Open and completed Sub-Issues remain reachable during Review under the existing permissions. Unsaved Review input uses the existing discard guard before opening a child.

Overview keeps authored requirements and submitted proof distinct:

- `evidenceRequired` describes the expected proof.
- `evidenceLinks` contains manual proof URLs; legacy `evidenceLink` remains compatible.
- Review evidence may also come from linked Pull Requests. The GitHub Issue link is not sufficient Review evidence by itself.
- Strategic items and Sub-Issues do not acquire a Deliverable Evidence workflow merely because they share a detail component.

Evidence normalization accepts at most 20 non-empty HTTP(S) URL entries, validates the 2,048-character URL limit, and removes duplicate normalized URLs using the current case-insensitive comparison. Link labels derive from the hostname or local GitHub/Notion mapping. There is no remote document-title or metadata request. Invalid edits retain the complete draft.

Empty optional read sections are omitted. Unknown or failed detail data must not become an empty list, a zero count or a claim that the item has no dependencies. Preserve loaded content and place the unavailable-data notice with its affected section.

## Counts and dependencies

The selectors in `task-detail-state.ts` and `task-detail-presentation.ts`, composed by `TaskDetailSurface`, own counts:

| Display | Formula and availability |
| --- | --- |
| Direct-child progress | Completed direct children divided by all direct children of the appropriate type. Completion uses normalized `Erledigt`; deeper descendants are excluded. |
| `Beziehungen N` | Sum of the normalized `waitsOn`, `blocks` and `related` row counts. Deduplicate each direction by linked item; suppress a neutral row already represented directionally. A linked item in two distinct directions is not one global unique-item count. |
| `Aktivität N` | Local comments plus imported comments plus system activities accepted by `isUsefulTaskActivity`, plus Review entries. Date headings and composer controls do not count. |

Detail tab counts are shown only for known, positive totals. Visual numeric counts above 99 use `99+`; accessible names retain the full count. Loading or error states omit definitive totals. `Übersicht` always exists. Relationships and Activity remain available while data is unknown, when they have content, or when an authorized add/comment action is available. If an active destination disappears, return to Overview and announce it.

The dependency summary answers whether the current item waits before showing downstream impact. `Wartet auf` represents unresolved incoming prerequisites; `Andere warten hierauf` represents downstream dependency direction. Use explicit text, linked item context and `+N weitere` for compact continuation. Neither direction creates a stored work status, severity score or computed critical path. Amber emphasizes active waiting; downstream structure is quieter. Color never carries the meaning alone.

Reported `TaskBlocker` records are separate operational reports with reason, impact, requested help and lifecycle state. They belong in the Overview blocker section and retain their report action and history. They are not converted to relationship edges or included in the relationship count. Status `Blockiert` remains the authoritative work status.

## Editing and independent actions

Overview edit captures server-backed baseline values and submits only permitted dirty Overview fields. Merely focusing a control does not make a draft dirty. The shared length and Evidence validation apply before dispatch. One Save/Cancel group owns pending state and errors; repeated saves are blocked. A failed save retains every draft value. A successful save returns to updated read content.

An editor retains its revision basis. A concurrent update shows the conflict with the baseline, submitted and current server values available through the existing editor workflow. Refreshing the conflict is a read; it does not silently overwrite the draft. Explicit resave is available only when the editor reports that it is allowed. Unconfirmed saves must be checked rather than blindly resent.

Status, owner, priority, fixed date, hierarchy, Sprint and Review responsibility use their existing independent direct operations. Their state is not part of Overview Save/Cancel. Cancel resets the Overview draft only and cannot undo a confirmed direct change. Approval decisions, Review request/decision/withdraw/reopen, relationships, blockers, comments, attachments, GitHub actions and withdrawal are independent operations too.

Failures stay with the affected operation: validation at its field, conflict/save failure in the editor, relationship failure in Relationships, comment/upload/import failure in Activity, and approval or Review failure in its workflow. Keep entered notes, selected targets and existing content after rejection. An unknown result is not proof of failure or permission to repeat an external effect. Confirmed updates provide visible success feedback without a routine global toast.

Overview dirty state protects tab changes, Cancel, close, Back and navigation through the existing discard dialog. Detail also tracks an active Review draft and installs browser-unload protection. Modal and full page use the same discard guard. Review draft persistence and the Review-specific full-page handoff retain their existing behavior; navigation must not invent a second draft lifecycle.

## Comment submission and recovery

The composer stays open above the timeline. Before accepting a submission, the planning owner captures its UUID, item, immutable text and submission time in account-scoped `sessionStorage`. If capture fails, no request starts and the composer retains its text with an error. After acceptance, the composer clears only the captured draft, retains focus without scrolling and accepts another comment immediately. Each accepted submission appears once as an ordinary comment entry. Results for an earlier submission cannot change a newer draft.

Comments use immutable submission time for newest-first order, with creation time as the fallback for legacy comments. Out-of-order responses and restored submissions keep that order. Confirmed records replace their pending entry. App persistence confirms success independently of GitHub delivery; existing GitHub badges, queue actions and permissions remain unchanged.

Submitted operations may continue while the user changes tabs, items or views. They do not cause a discard confirmation. Same-tab reload restores pending or unconfirmed submitted operations as unconfirmed and checks their authorized receipt before exposing recovered text. A matching receipt confirms the existing comment without another POST. A missing receipt or an early empty discussion read does not prove failure; an unknown outcome must be checked before the same submission can be sent again.

A confirmed app-storage failure retains the submitted text and failure message at its entry. "Erneut versuchen" resends the same logical submission with its original UUID and submission time. Repeated retry clicks cannot create a separate entry; success replaces the failed entry in place. An unconfirmed outcome offers a receipt check rather than resend. Failure and retry leave the composer, newer drafts and unrelated submissions usable. Confirmed rejected entries remain in the current owner session; an accepted retry is captured again for reload recovery. This retry concerns app storage, not GitHub delivery.

Unsent drafts stay per item in the planning owner's memory across tab, item and detail-view changes. They are not stored for reload recovery. Logout, account replacement, session expiry and protected-state reset clear protected drafts and operations. A different account cannot recover the previous account's submitted text, and late results cannot repopulate cleared state.

## Permissions and workflow placement

Consume `taskDetailPermissions`, `taskRelationshipAccess`, approval policies and the Review state model. UI visibility never grants server access. Re-evaluate current role, ownership, item type and state rather than copying a role-only matrix.

- Mapped viewers read; they do not edit fields, report blockers or compose comments. Existing authorized GitHub import and Issue projection remain distinct reader actions.
- Founder work permissions depend on ownership and the operation. Operational leads and temporary administrator correction have different limits; administrator access does not grant approval or Review governance.
- Review request, active/final Review and completed-item protections constrain content, planning, parent, relationship and attachment changes. Comments retain their separate availability. An authorized completed-item reopen must succeed before editing resumes.
- Approval is not work status. Initiative and Deliverable approval use their actual revision and parent state; Sub-Issues retain parent-context restrictions without an independent approval workflow.
- Review Owner is shown with Review, not as a duplicate primary owner. Active Review uses the existing Review rail/surface and its request, decision, withdrawal and reopening operations.
- GitHub Issue actions retain type eligibility, explicit creation intent and pending/error state. Comment import is separate from projection. Missing author credentials cannot turn successful installation-token projection into failure.
- Import may populate Evidence only under the existing Evidence-edit permission and empty-evidence rule; an allowed comment read does not grant a field mutation.
- Deliverable withdrawal uses its eligibility, reason, expected approval revision and reversible trash workflow. A rejected withdrawal retains its reason and rolls back optimistic removal.

Relationship selection currently excludes the current item and Sub-Issues; Epic and Initiative records are not excluded merely because they are strategic. Stored relationships can still render other supported endpoints. Server validation remains authoritative for self-links, duplicates, ownership, revisions and protected endpoints/parents. Existing add/remove operations do not imply an edit, bulk-link or graph editor.

## Containers, keyboard and accessibility

The shared modal stack locks document scrolling and makes the background inert. Only the top modal owns its keyboard loop. Opening focuses the declared autofocus target or first focusable control. Tab and Shift+Tab remain inside the dialog. Escape respects pending/close-disabled state and lets an expanded owned control handle its own dismissal. Closing restores the connected opener or the next active modal's appropriate target.

Creation uses a fixed header, one bounded scroll body and fixed footer. At narrow widths it fills the dynamic viewport; wider drawers use the current type-specific width. Close and submission actions remain reachable. Detail modal chrome remains separate from item actions; the normal maximum width is 920 pixels and active Review can use 1,060 pixels. At small widths the surface fills the viewport. Its responsive scroll ownership is implemented by `TaskDetailSurface`; full-page content uses normal page scrolling. Do not add competing panel or metadata-rail scroll regions. Sticky regions must not obscure focused controls or errors.

Full page and modal share selectors, content, permissions and operation/error semantics. Container navigation and available width may differ. Review-specific layout remains supported; parity does not require identical pixel geometry. Responsive reflow preserves DOM and reading order, wraps titles and labels, and confines horizontal scrolling to its owning surface, such as the tab strip. Follow the repository's Mobile First, Responsive Web Design, WCAG 2.2 AA and WAI-ARIA Modal Dialog Pattern requirements.

Full pages use the [application header and context](application-shell.md). The global area is `Planung`; the Item title and operational actions remain in the content. Supported return navigation belongs in the context bar and uses the same discard guard as other departures. Global GitHub access does not grant Item projection to Epics or Initiatives.

Tabs use manual activation: Left/Right move focus without wrapping, Home/End move focus to the first/last tab, and Enter/Space activate. Pointer activation is immediate. Each tab has a roving tabindex, selected state and associated panel; only the active panel is rendered. Scrolling a partly hidden tab into view must not scroll the page vertically.

Inputs retain visible labels and programmatic required, invalid and pending state. Field errors use `aria-describedby`; local blocking errors and confirmed changes use the existing alert/live regions without duplicate announcements. Icons, dependency direction, status and progress have text equivalents. Restricted content must not leak through labels or unavailable-row placeholders. Read-only checklist markers must not appear editable. Touch targets follow the repository minimums, with 44-pixel targets on phone/coarse-pointer layouts and no page-level horizontal overflow.

## Unsupported capabilities and verification references

There is no generic Item archive, threaded Activity reply, undefined child-row action menu, relationship edit/bulk/graph UI, or remote Evidence metadata resolution. The header's defined action menu is supported. Empty Epic deletion is a separate operations-lead, revision-checked contract; it does not authorize direct deletion of Deliverables or Sub-Issues. Trash purge remains protected operator maintenance. Legacy Focus data does not restore a visible execution workspace or a next-step field in item detail.

Current behavior is covered by the existing task detail tab, presentation, relationship, permission, Evidence and creation-draft tests; Planning lifecycle/save tests; and the new-task/detail Storybook scenarios. See `tests/unit/tasks/`, `tests/unit/planning/planning-task-lifecycle.test.ts`, `tests/unit/planning/task-save-outcome.test.ts` and the feature stories. These executable contracts are distinct from a fresh visual or production accessibility acceptance.
