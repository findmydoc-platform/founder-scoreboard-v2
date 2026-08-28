# Feature UI Rules

- Apply Atomic Design.
- Keep domain UI under `src/features/<domain>/{atoms,molecules,organisms,templates,hooks,model}` and create only directories the feature uses.
- Do not create `src/components` or `src/hooks`, add compatibility re-export shims, or move domain-specific code into `src/shared`.
- Reuse `CustomSelect` and `CustomDatePicker`. Do not add native `select`, `option`, `input[type=date]`, or `input[type=datetime-local]` controls.
- Follow `docs/table-filtering.md` for operational tables, use `DataTableFrame`, and declare `embedded` or `external` filtering explicitly.
- Preserve keyboard navigation, visible focus, Escape handling, outside-click handling, and correct ARIA semantics for interactive UI.
- Auth-related UI must clear protected client state during logout and must never display or persist raw tokens.
