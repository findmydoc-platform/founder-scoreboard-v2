# Design system primitives

`src/shared/atoms/ui-primitives.tsx` owns domain-neutral visual controls. Feature components compose them without moving workflow or permission decisions into shared styling.

## Shared controls

| Export | Purpose |
| --- | --- |
| `UiPanel` | Bordered panel/card with shared surface and spacing variants |
| `UiButton`, `UiLinkButton`, `UiAnchorButton` | Button, application-link and anchor action presentation |
| `UiBadge` | Compact status/count presentation |
| `UiNotice` | Inline information, success, warning and error presentation |
| `UiEmptyState` | Empty or loading placeholder presentation |
| `UiField`, `UiTextInput`, `UiTextArea` | Field labels and text-input presentation |

Use supported variants rather than repeating the same Tailwind recipes. Preserve visible language, accessible names and feature behavior when replacing a repeated visual pattern.

## Ownership boundaries

`src/shared` contains reusable presentation and generic interaction controls. Tasks, Sprints, Review, meetings, hierarchy and notifications keep their domain rules, status/tone mapping, permissions and mutations in their owning features.

Table rows, calendar grids, Gantt geometry and board layouts remain feature-owned. Shared select/date controls retain their existing portal and focus behavior. Authenticated images and GitHub action composites keep their own loading/error behavior; a shared panel does not own provider acquisition or connection policy.

See [Planning Item UI](planning-item-ui.md) for item-specific interaction and [Table filtering](table-filtering.md) for operational table composition. Follow repository responsive and accessibility rules when using these controls.
