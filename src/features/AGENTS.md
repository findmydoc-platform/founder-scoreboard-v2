# Feature UI Rules

- Keep domain UI under `src/features/<domain>/{atoms,molecules,organisms,templates,hooks,model}` and create only directories the feature uses.
- Use atoms for small display or control primitives, molecules for composed sections, organisms for workflow-sized surfaces, and templates for page or workspace orchestration.
- Keep ephemeral presentation state in components. Put workflow state, API calls, mutations, auth transitions, and cross-surface side effects in hooks; put pure mapping, sorting, filtering, and policy projections in model files.
- Do not create `src/components` or `src/hooks`, add compatibility re-export shims, or move domain-specific code into `src/shared`.
- Reuse `CustomSelect` and `CustomDatePicker`. Do not add native `select`, `option`, `input[type=date]`, or `input[type=datetime-local]` controls.
- Follow `docs/table-filtering.md` for operational tables, use `DataTableFrame`, and declare `embedded` or `external` filtering explicitly.
- Preserve keyboard navigation, visible focus, Escape handling, outside-click handling, and correct ARIA semantics for interactive UI.
- Auth-related UI must clear protected client state during logout and must never display or persist raw tokens.
- Write German visible copy with real UTF-8 umlauts. Run focused tests and lint after UI changes, and include an inline screenshot when handing off a UI change.
