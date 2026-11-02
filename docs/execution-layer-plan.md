# Execution retirement and attention signals

Status: retired visible workspace, legacy-compatible data surface.

## Visible workspace retirement

Execution is no longer a top-level workspace. Reviews, sprint work, and task editing stay in their existing areas. The former hygiene alert wall is replaced by a small computed task signal model that appears only where tasks are already read and acted on.

## Navigation and compatibility

- `Execution` must not appear in the sidebar, workspace picker, header metadata, or profile default workspace options.
- Workspace navigation is path-based. The root route applies saved profile defaults; workspace query parameters and the retired local-storage key are ignored.
- Visible Execution surfaces stay removed: metrics strip, review queue, today focus, focus history, day close, suggestions, and hygiene alert wall.
- Task detail pages and panels do not show Focus context.
- `/api/focus`, `task_focus_items`, existing data loading, and schema checks remain for legacy compatibility only. They are not a visible product surface.
- Attention signals are computed from existing Planning data, not a new stored execution workflow.
- `/execution` redirects to `/planning`; `/reviews` redirects to `/planning?tasks.review=requested`. Legacy workspace preferences resolve to Planning, and historical Initiative URLs resolve through `planning_item_historical_links` to item detail. These supported redirects must remain.

## Task attention model

`TaskAttentionSignal` is a view-model signal, not stored state.

Critical signals:

- `Owner fehlt`: P0 Deliverable with no assignee/owner identity.
- `Blocker fehlt`: task with status `Blockiert` but no open blocker.
- `Wartet`: task waiting on an open blocking dependency.
- `Sync fehlgeschlagen`: Deliverable or Sub-Issue with failed GitHub sync.

Review signals:

- `Review >2d`: Deliverable in Review/requested state whose request date is more than two calendar days old.
- `Ohne Review Owner`: Deliverable in Review/requested state without a Review Owner.

Quality signals:

- `AC fehlt`: Deliverable without acceptance criteria.
- `DoD fehlt`: Deliverable without Definition of Done.
- `Evidence fehlt`: unfinished Sprint Deliverable without its compatible Evidence, Issue or GitHub Issue link. This attention heuristic is not the stricter Review evidence gate.

Removed signal:

- No `Kein Update seit 48 Stunden` replacement. It should not re-enter Planning as a badge, alert, or filter.

## Placement rules

- Planning shows compact task badges and quick filters only.
- Planning quick filters include `Kritisch`; `Blockiert` and `Ohne Evidence` stay connected to the same task-signal semantics.
- Review is reached through Planning filters and task detail; there is no standalone Review workspace. `taskReviewAttentionSignals` retains the Review-only selectors. Their existence does not imply a separate rendered queue or badge placement.
- Quality signals are subtle badges in task cards, task tables, or task detail; they are not red alert surfaces.
- Task cards and rows show at most two attention badges. Additional signals collapse into `+N`.
- Badges do not include long descriptions, next-action copy, or focus actions.
- Settings show only global system states such as a missing GitHub App connection. Task-specific hygiene signals do not belong in Settings.

## Stored legacy data

A later data-model cleanup can remove Focus API, types, schema checks, and Supabase structure in a separate PR. That follow-up must be explicit because it changes stored legacy data rather than only removing visible UI.

See [Planning Item UI](planning-item-ui.md) for current item/Review interaction and [Planning hierarchy](planning-hierarchy.md#migration-compatibility) for hierarchy compatibility.
