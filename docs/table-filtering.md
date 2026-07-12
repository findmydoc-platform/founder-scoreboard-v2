# Table filtering contract

FounderOps operational tables use one interaction and implementation contract. Content-only tables rendered inside task comments are the only exception.

## Interaction model

- The filter toolbar is the primary entry point on desktop and mobile.
- Meaningful columns may expose a secondary filter trigger. Toolbar and column controls must update the same state.
- Every operational table provides search, expandable filters, removable active-filter chips, result counts, and a complete reset action.
- Values selected within one multi-value field use OR semantics. Different fields use AND semantics.
- Sorting belongs to column headers and never contributes to the active-filter count.
- Empty data and zero filtered results use different messages. A zero-result state must keep reset available.
- Filter and search changes update rows and counts immediately. Inline edits may therefore remove the edited row from the current result set.
- Wide tables use sticky headers and may use a sticky first data column. Horizontal scrolling remains available at mobile widths.

## Shared component choice

Every operational table uses `DataTableFrame` and declares exactly one filter mode:

- `embedded`: the table owns and renders its `FilterToolbar` inside the frame.
- `external`: the table references a toolbar shared with another view or table through `labelledBy`.

Use `DataColumnHeader` for sortable and filterable headers. Sorting and filtering are separate labelled buttons. Use `ColumnFilterPopover` for a column filter and the existing custom controls inside it. Native selects and native date inputs are not permitted.

`src/shared` contains presentation, generic URL state, and generic filter or sort primitives only. Task, Sprint, Review, Founder, Milestone, and other domain types remain in their owning feature.

## URL state

Operational table state uses `useTableUrlState(namespace, schema)`.

- Parameters are named `namespace.field`.
- Multi-values are repeated parameters.
- Feature defaults are omitted from the URL.
- Invalid schema values are ignored.
- Unknown parameters are preserved.
- Search uses delayed `replaceState`; discrete filters, chips, reset, and sort use `pushState`.
- Browser Back and Forward synchronize the visible table.
- Open panels, popovers, scroll positions, and row selections are not URL state.

Current namespaces are `tasks`, `reviews`, `backlog`, `sprintTasks`, `score`, `weekly`, and `deliverables`.

Initialization order is URL values, explicitly saved profile defaults, then feature defaults. Profile synchronization hydrates only. Active filters are never saved automatically; the existing explicit save action owns that mutation.

## Feature view-model pattern

Each operational table exports:

1. a typed filter state;
2. a `DEFAULT_*_FILTERS` value;
3. typed sort keys and direction;
4. a pure `build*TableViewModel` function.

Filtering and sorting decisions belong in the view-model, not in JSX. Sorts must be stable. View-model tests cover defaults, search, cross-field AND logic, same-field OR logic where present, sorting, counts, and no-result behavior.

## New-table checklist

- Use `DataTableFrame` with `caption`, result counts, and an explicit filter mode.
- Use `FilterToolbar`, active chips, and a full reset.
- Add a namespaced URL schema and preserve unrelated query parameters.
- Use semantic headers with `scope="col"` and accurate `aria-sort`.
- Label the table, scroll region, fields, popovers, and result announcements.
- Distinguish no data from no filtered results.
- Put domain filtering and stable sorting in a pure feature view-model.
- Add view-model, URL-state, accessibility, and structural contract tests.
- Verify desktop and mobile widths, horizontal scrolling, sticky headers, chips, no-results, and an open column filter.

