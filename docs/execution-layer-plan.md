# Execution Layer Retirement Plan

Status: retired visible workspace, legacy-compatible data surface.

## Goal

Execution is no longer a top-level workspace. Reviews, sprint work, and task editing stay in their existing areas. The former hygiene alert wall is replaced by a small computed task signal model that appears only where tasks are already read and acted on.

## Current Contract

- `Execution` must not appear in the sidebar, workspace picker, header metadata, or profile default workspace options.
- Workspace navigation is path-based. The root route applies saved profile defaults; workspace query parameters and the retired local-storage key are ignored.
- Visible Execution surfaces stay removed: metrics strip, review queue, today focus, focus history, day close, suggestions, and hygiene alert wall.
- Task detail pages and panels do not show Focus context.
- `/api/focus`, `task_focus_items`, existing data loading, and schema checks remain for legacy compatibility only. They are not a visible product surface.
- No Supabase migration is required for this cut. The replacement model is computed from existing Planning data.

## TaskAttentionSignal Model

`TaskAttentionSignal` is a view-model signal, not stored state.

Critical signals:

- `Owner fehlt`: P0 Deliverable without an accountable assignee, except Sub-Issues.
- `Blocker fehlt`: task with status `Blockiert` but no open blocker.
- `Wartet`: task waiting on an open blocking dependency.
- `Sync fehlgeschlagen`: failed GitHub sync.

Review signals:

- `Review >2d`: review-relevant task waiting longer than two days.
- `Ohne Review Owner`: review-relevant task without a review owner.

Quality signals:

- `AC fehlt`: task without acceptance criteria.
- `DoD fehlt`: task without definition of done.
- `Evidence fehlt`: sprint task without evidence, issue, or GitHub link.

Removed signal:

- No `Kein Update seit 48 Stunden` replacement. It should not re-enter Planning as a badge, alert, or filter.

## Placement Rules

- Planning shows compact task badges and quick filters only.
- Planning quick filters include `Kritisch`; `Blockiert` and `Ohne Evidence` stay connected to the same task-signal semantics.
- Review aging and missing review owner appear only in the Review workspace.
- Quality signals are subtle badges in task cards, task tables, or task detail; they are not red alert surfaces.
- Task cards and rows show at most two attention badges. Additional signals collapse into `+N`.
- Badges do not include long descriptions, next-action copy, or focus actions.
- Settings show only global system states such as a missing GitHub App connection. Task-specific hygiene signals do not belong in Settings.

## Future Work

A later data-model cleanup can remove Focus API, types, schema checks, and Supabase structure in a separate PR. That follow-up must be explicit because it changes stored legacy data rather than only removing visible UI.
