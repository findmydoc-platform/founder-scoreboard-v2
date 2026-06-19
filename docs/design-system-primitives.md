# Design System Primitives

Issue #21 consolidates repeated Planning UI styling without changing behavior or redesigning screens.

## Shared primitives

The shared primitive layer lives in `src/shared/atoms/ui-primitives.tsx` and is intentionally domain-neutral:

- `UiPanel` for the standard white bordered panel/card surface.
- `UiButton`, `UiLinkButton`, and `UiAnchorButton` for repeated action button variants.
- `UiBadge` for rounded status/count labels.
- `UiNotice` for inline info, success, warning, and error messages.
- `UiEmptyState` for dashed empty/loading placeholders.
- `UiField`, `UiTextInput`, and `UiTextArea` for repeated form label and text field styling.

## Migration policy

- Preserve the existing visual language. Do not use this layer for redesign work.
- Keep task, sprint, meeting, decision, founder, milestone, review, and planning workflow semantics inside their owning feature.
- Put only globally reusable visual primitives in `src/shared`.
- Prefer migrating exact repeated Tailwind recipes first.
- Leave feature-specific composites local when the class mix expresses workflow state, density, drag/drop behavior, calendar positioning, or table layout.

## Migrated coverage

The first consolidation pass covers repeated panels, buttons, badges, notices, empty states, field labels, text inputs, and text areas across tools, projects, reviews, settings, execution, decisions, sprint controls, meetings, events, team profiles, intake, task detail sections, task relationships, and the new-task dialog.

## Feature-specific exceptions

The following patterns are intentionally left feature-local:

- Table row, calendar grid, Gantt, and task board geometry, because their utility classes define feature layout rather than global tokens.
- Relationship, review, status, and notification mapping functions, because their tone decisions are domain model behavior.
- Custom select and date picker internals, because they are already shared controls and include portal/focus behavior beyond token drift.
- Auth, Supabase, GitHub Sync, and controller code, because Issue #21 must not merge with the infra or workflow-logic scopes from Issues #19 and #20.
- `TaskGitHubSyncCard` is left feature-local because its surface is tied to GitHub provider-token availability and sync state; that belongs with the later infra-boundary work, not the neutral primitive pass.
- `GitHubCommentImage` keeps its local loading/error placeholders because the component owns authenticated GitHub asset proxy behavior and provider-token refresh side effects.
