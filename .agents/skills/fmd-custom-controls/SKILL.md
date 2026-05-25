---
name: fmd-custom-controls
description: Use when building, reviewing, or refactoring Founder Scoreboard dropdowns, selects, filters, menus, mini calendars, date pickers, datetime pickers, time inputs, compact table controls, or popover choice UI. Enforces custom branded controls and blocks native browser select/date picker regressions.
---

# FMD Custom Controls

## Rule

Do not add native browser choice controls for app UI:

- no `<select>` or `<option>` in feature UI
- no `input type="date"` or `input type="datetime-local"`
- no Chrome-default date/calendar picker for Founder Scoreboard workflows

Use existing shared components first: `src/components/custom-select.tsx` and `src/components/custom-date-picker.tsx`.

## Workflow

1. Search before editing:

```bash
rg '<select|</select|<option|type="date"|type="datetime-local"' src -n
```

2. Convert options to structured data: `{ value, label }`.
3. Preserve typed values at the call site, e.g. `Number(value)` or `value as TaskStatus`.
4. Preserve date contracts such as `YYYY-MM-DD` and datetime contracts such as `YYYY-MM-DDTHH:mm`.
5. Keep controls stable in dense layouts with fixed min-height, truncation, and no layout shift when opened.
6. Maintain accessibility: button trigger, `aria-haspopup`, `aria-expanded`, listbox/dialog semantics, visible focus ring, Escape close, and outside-click close.
7. For mini calendars, keep month navigation, today action, clear action, selected state, muted adjacent-month days, and German labels with real umlauts.
8. Update the shared component instead of adding a one-off control unless the existing component cannot support the required behavior.

## Required checks

Run:

```bash
npm test
npm run lint
```

Visually inspect at least one changed dropdown or calendar when a dev server is practical.
