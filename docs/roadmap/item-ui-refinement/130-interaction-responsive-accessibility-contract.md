# Item Detail — Interaction, Responsive, and Accessibility Contract

Status: normative implementation contract
Applies to: full-page Item UI, 920-pixel modal, and viewports below 768 pixels
Visual baseline: Operational Command Strip and the eight development screens
Scope: presentation and interaction behavior only

## Authority and Normative Language

This document closes the interaction, responsive, state, and accessibility gaps that cannot be proven by the static development screens.

- **MUST** and **MUST NOT** are implementation gates.
- **SHOULD** is the default unless an existing verified product constraint requires another accessible behavior.
- **MAY** is optional polish and does not block implementation.

Where screenshot text or example counts conflict with this document, this document is authoritative. Those corrections supersede illustrative screenshot data only. They do not authorize new fields, workflows, permissions, relationship types, or product capabilities.

## Shared Information and DOM Order

Every surface MUST preserve this semantic order:

1. container navigation and exit controls;
2. item identity and hierarchy context;
3. one `h1` item title;
4. existing item actions;
5. operational facts: status, primary owner, priority, target date, Sub-Issue progress;
6. Planning summary and its inline controls;
7. grouped dependency summary;
8. conditional Approval and Review workflow strips;
9. local Item tabs;
10. active tab panel; Activity ends with compact history metadata.

Rules:

- Status, primary owner, hierarchy, active waits-on state, and Sub-Issue progress MUST remain above long-form content.
- Planning and workflow metadata MUST NOT duplicate authoritative header values.
- Only the active tab panel is exposed to assistive technology.
- Visual reordering MUST NOT change keyboard or screen-reader order.
- The page MUST have one `h1`. Active tab panels use `h2`; groups inside a panel use `h3`.

## Responsive Layout Contract

### Profile A — Wide Full Page

Applies when the available Item content width is normally 1280 pixels or wider.

- The application shell and collapsed navigation retain their existing behavior.
- The Item uses one document scroll. Inline operational sections MUST NOT create independent vertical scroll regions.
- The operational header and dependency band scroll with the document.
- The local tab list becomes sticky at the top of the Item content viewport when it reaches that position.
- The sticky tab list MUST remain below persistent application chrome and MUST NOT cover focused content.
- A subtle bottom divider MAY appear while the tab list is sticky. It MUST NOT become a floating card.
- The active panel uses the full readable Item width; no secondary metadata rail is rendered.
- Main authored text maintains an approximate 60–65-character reading measure.
- No horizontal page scroll is permitted at 200% zoom.

### Profile B — Constrained Full Page and 920-Pixel Modal

This profile applies to full-page layouts from 768 to 1279 pixels and to the modal with a maximum content width of 920 pixels.

#### Constrained full page

- The main content becomes one column before the reading measure or action layout becomes cramped.
- Planning controls expand in place from the Planning summary with `aria-expanded` and `aria-controls`.
- The operational facts may wrap to two rows. Status and primary owner remain first.
- The dependency rows may wrap internally but retain their text labels, linked title, status, and owner.
- The full page continues to use the document as its only vertical scroll container.
- The local tab list follows the full-page sticky behavior defined above.

#### 920-pixel modal

- The dialog width is at most 920 pixels and MUST preserve at least a 16-pixel viewport gutter on each side.
- The dialog height is at most the viewport height minus a 16-pixel gutter at the top and bottom.
- The dialog shell remains fixed. The modal body is the only vertical scroll container.
- The modal container controls and operational header remain sticky at the top of the dialog.
- The Planning summary is the first body content; Planning, dependencies, and workflow strips scroll away.
- The local tab list appears after the dependency summary and becomes sticky directly below the modal header when reached.
- The sticky header and sticky tabs MUST NOT overlap, obscure focus indicators, or reduce the active panel to an unusable height.
- The active panel and inline operational sections use the same modal-body scroll. No nested panel or rail scroll is allowed.
- Close remains visible at every scroll position.
- Closing the dialog returns focus to the control that opened it, if that control still exists.

### Profile C — Below 768 Pixels

- Full-page and modal surfaces preserve the shared DOM and information order.
- A modal becomes an edge-to-edge dialog or sheet using the available `100dvh`; it MUST NOT retain a desktop-sized floating frame.
- Container exit controls remain visible. In a modal, they remain part of the sticky dialog header.
- The full-page operational header scrolls normally. The modal operational header remains sticky.
- Title text wraps naturally and MUST NOT be ellipsized as the only title presentation.
- Status and primary owner remain visible first. Optional facts wrap below them without empty placeholders.
- The dependency band becomes a single-column two-row group. Long linked titles wrap to two lines before truncation.
- The tab list remains horizontal and text-labelled. It scrolls horizontally when necessary and MUST NOT become icon-only navigation.
- Activating a partly hidden tab scrolls that tab fully into view without moving the document vertically.
- The active panel and inline operational sections form one content column.
- Linked-item rows stack secondary metadata below the title before truncating essential title, status, or owner text.
- No viewport-wide horizontal scrolling is permitted at 320 CSS pixels or at 400% zoom.

## Scroll and Sticky Behavior

| Surface | Vertical scroll owner | Sticky regions | Non-sticky regions |
|---|---|---|---|
| Wide full page | Document | Local tab list after it reaches the shell offset | Operational header, Planning, workflow, dependency band, content |
| 768–1279 full page | Document | Local tab list after it reaches the shell offset | Operational header, Planning, workflow, dependency band, content |
| 920-pixel modal | Modal body | Dialog header; local tab list below it after operational sections pass | Planning, workflow, dependency band, active panel |
| Below-768 full page | Document | Local tab list | Operational header, Planning, workflow, dependency band, panel |
| Below-768 modal | Modal body | Dialog header; local tab list | Planning, workflow, dependency band, panel |

Additional rules:

- A sticky transition MUST NOT move keyboard focus or trigger a live announcement.
- Anchor or validation focus MUST use the current sticky offsets so the target is not hidden.
- Scroll position is retained when switching between temporary edit validation states.
- Switching tabs returns each tab to its last scroll position only if the existing application already preserves it. Otherwise the active panel starts at its heading. No new cross-session scroll persistence is required.

## Local Tab Contract

### Labels and Counts

The stable visual order is:

1. `Übersicht`
2. `Sub-Issues 2/4`
3. `Beziehungen 3`
4. `Aktivität 4`

The numbers above are the current mock-data values. The formulas below, not hard-coded example values, are authoritative.

### Semantics

- Use a `tablist` with one `tab` per rendered destination and one associated `tabpanel`.
- Every tab has `aria-selected`, `aria-controls`, and a roving `tabindex`.
- Every panel has `aria-labelledby` pointing to its tab.
- Inactive panels are hidden and removed from the accessibility tree.
- The active tab is identified by text weight and a structural indicator such as an underline; color alone is insufficient.
- Counts are part of the accessible tab name. The screen reader receives the full value even when the visual display uses `99+`.

### Keyboard and Focus

- `Tab` enters the tab list on the active tab and then moves to the active panel content.
- Left and Right Arrow move focus between tabs without wrapping.
- Home and End move focus to the first and last rendered tab.
- Enter or Space activates the focused tab. This is a manual-activation model so async panels are not loaded merely by arrow navigation.
- Pointer activation selects the tab immediately.
- Focus remains on the activated tab after a normal tab switch. The panel heading is not programmatically focused.
- A deep-linked destination may be selected on load, but initial focus follows the normal page or dialog entry contract.
- If the active tab is removed because its last visible row disappears and the destination is no longer actionable, activate `Übersicht`, move focus to its tab, and announce `Übersicht geöffnet.`

### Tab Availability

- `Übersicht` is always rendered.
- `Sub-Issues` and `Beziehungen` render when their count is greater than zero or when an existing authorized add action is available in that destination.
- `Aktivität` renders when visible timeline entries exist or the current user can use the existing comment composer.
- A hidden zero-count tab MUST NOT leave an empty separator or unreachable panel.

## Normative Count Formulas

### Sub-Issues

`Sub-Issues X/Y` uses direct children only.

- `Y` is the number of direct Sub-Issues available to the current view under existing permissions.
- `X` is the number of those direct Sub-Issues in a terminal state under the existing status model.
- Descendants below the direct-child level are excluded.
- Loading or failed data never renders `0/0`; omit the numeric count until authoritative data exists.
- Current mock example: `2/4` and visible progress copy `2 von 4 erledigt`.

### Relationships

`Beziehungen N` equals the number of unique relationship rows included in the complete relationship destination after permission filtering, invalid-row filtering, and duplicate suppression.

- Included groups are `Wartet auf`, `Blockiert` or `Andere warten hierauf`, and `Verknüpft mit`.
- Parent and Sub-Issues are excluded.
- A neutral duplicate of a directional row is suppressed and counted once.
- A row is unique by effective relationship direction and linked-item identity after suppression.
- Collapsed completed groups still contribute because their rows remain available in the destination data set.
- Loading, total failure, or unknown permission-filtered totals omit the count rather than showing zero.
- Current mock example: one `Wartet auf` row plus two `Andere warten hierauf` rows equals `Beziehungen 3`.

### Activity

`Aktivität M` equals the number of visible timeline entries after the current activity filter and permission filtering.

- Comments and system events each count as one entry.
- Date headings, the composer, loading skeletons, and unconfirmed optimistic entries do not count.
- A confirmed new comment increments the count once.
- A failed optimistic entry never increments the confirmed count.
- Loading or failed totals omit the count rather than showing zero.
- Current mock example: one comment plus three system/history entries equals `Aktivität 4`.

### Count Updates

- Header, tab, progress, and destination values MUST derive from one authoritative selector per count.
- Confirmed count changes update all visible instances in the same render cycle.
- A user-triggered confirmed addition or removal is announced once in the polite live region; raw count changes are not announced separately.

## Overview Edit Contract

### Enter Edit Mode

- Header `Bearbeiten` enters the existing Overview edit mode only.
- Status, owner, priority, deadline, Planning metadata, and Review Owner remain independent direct controls and do not join the Overview dirty state.
- The read content is replaced by one form; it is not duplicated beneath the form.
- Focus moves to the first editable Overview field and the polite live region announces `Bearbeitungsmodus geöffnet.`
- The initial server-backed values form the dirty-state baseline.
- Merely focusing, opening a select, or blurring a field does not make the form dirty.

### Dirty and Validation State

- The form becomes dirty only when a value differs from the baseline after normalization already used by the product.
- `Speichern` is disabled while the form is pristine, invalid, or submitting.
- Field validation appears adjacent to the field and is connected with `aria-describedby`.
- On submit with invalid fields, focus moves to the first invalid field. A concise form-level summary may precede the form when more than one field is invalid.
- User-entered values remain intact after validation or server errors.

### Save

- The single visible `Speichern` control submits the Overview form and owns its disabled, pending, and error state.
- Use exactly one persistent Overview action group with `Abbrechen` and `Speichern` on every surface. It may become a sticky footer in the 920-pixel modal and below 768 pixels. The duplicate header and end-of-form action groups in the raster mockup are superseded.
- During submission, the form is `aria-busy="true"`, repeated submits are blocked, and the primary action shows a visible pending label such as `Speichert …`.
- On success, return to reading mode, focus the existing `Bearbeiten` control or the edited section heading, and announce `Änderungen gespeichert.`
- Do not show a success toast when the updated read content is immediately visible.
- On a field-specific server error, remain in edit mode and focus the affected field.
- On a form-wide server error, remain in edit mode, preserve values, place one persistent error above the form, and focus that error summary.

### Cancel, Close, and Navigation

- Cancel on a pristine form returns to reading mode and restores focus to `Bearbeiten`.
- Cancel, Back, tab switching, modal Close, or route navigation with a dirty form opens one confirmation dialog.
- The confirmation heading is `Ungespeicherte Änderungen verwerfen?`.
- The safe default keeps editing. The destructive confirmation discards changes.
- Escape follows the same dirty-state protection; it MUST NOT silently close a dirty modal or form.
- After dismissing the confirmation, focus returns to the control that invoked it.

## Local Add-Form Contract

### Sub-Issue Form

- `Sub-Issue hinzufügen` expands one local form in the Sub-Issues panel.
- The trigger exposes `aria-expanded` and `aria-controls`.
- When opened, focus moves to the required `Titel` field.
- Only one form instance may be open.
- While open, the original trigger is hidden or relabelled as a close action; it MUST NOT remain as a second indistinguishable `Sub-Issue hinzufügen` action.
- Cancel closes the form and restores focus to the original trigger.
- Successful creation closes the form, updates `X/Y`, focuses the new row, and announces `Sub-Issue hinzugefügt.`
- Validation or server failure preserves entered title and owner values.

### Relationship Form

- `Beziehung hinzufügen` expands one local form in the Relationships panel.
- The trigger exposes `aria-expanded` and `aria-controls`.
- If relationship type already has a valid default, focus moves to `Item auswählen`; otherwise focus moves to `Beziehungstyp`.
- The submit action remains disabled until all existing required values are valid.
- The picker MUST exclude or reject self-reference and existing duplicates according to current product rules.
- A rejected invalid, duplicate, or conflicting relationship is explained inline without clearing the selected values.
- While open, the original trigger is hidden or relabelled as a close action; the opener and submit action MUST NOT share the same visible and accessible label.
- Cancel restores focus to the original trigger.
- Successful creation closes the form, updates `Beziehungen N`, focuses the new row, and announces `Beziehung hinzugefügt.`

### Shared Add-Form Submission

- Submitting sets `aria-busy="true"` on the local form and blocks repeated submission.
- The pending button uses a visible verb, for example `Wird hinzugefügt …`.
- Field errors remain beside fields; a shared server failure appears once above the form.
- Permission loss during submission preserves input and shows one persistent permission error in the form.

## Tab State Matrices

### `Übersicht`

| State | Required presentation | Focus and announcement |
|---|---|---|
| Loaded with content | Render only authored sections that have values, in the approved order | Normal reading order; no announcement |
| Loading | Keep the operational header stable; show a small number of content-line skeletons | Panel uses `aria-busy`; no focus movement |
| Empty | Show one compact Overview-level empty state; expose the existing edit action only when authorized | Focus remains on the tab; no repeated empty messages |
| Partial load error | Keep loaded sections and show one persistent error for the affected section | Retry retains focus unless it succeeds and user context changes |
| Total panel error | Show one persistent panel error with the existing retry action | Focus error summary only after a user-triggered failed action |
| Read-only permission | Render readable content; omit unauthorized edit controls | No permission toast |
| Permission failure during edit | Preserve input and show the error in the form | Focus the form error; announce assertively once |
| Save success | Return to updated read mode | Focus `Bearbeiten` or edited heading; polite success announcement |

### `Sub-Issues`

| State | Required presentation | Focus and announcement |
|---|---|---|
| Loaded with children | Show unfinished direct children first and `Erledigt N` according to the existing grouping contract | Normal list navigation |
| Loading | Show progress placeholder plus two or three neutral row skeletons; never show `0/0` | Panel uses `aria-busy`; no focus movement |
| Empty, add allowed | One message `Keine Sub-Issues vorhanden.` plus one add action | Focus remains on tab or invoked action |
| Empty, add not allowed | One neutral empty message without a disabled decorative action | No permission toast |
| Partial row failure | Keep valid rows and show one aggregate message with the number unavailable | Error is associated with the list |
| Total panel error | Omit numeric progress and show one persistent panel error | User-triggered retry failure announces once |
| Restricted linked child | Do not expose title, owner, status, or body; use only the existing safe restricted-row treatment | Accessible name contains no private data |
| Add success | Insert the confirmed row and update `X/Y` once | Focus new row; polite success announcement |
| Add failure | Keep the form and all values | Focus first field error or shared form error |

### `Beziehungen`

| State | Required presentation | Focus and announcement |
|---|---|---|
| Loaded with rows | Render non-empty groups in order: `Wartet auf`, `Andere warten hierauf`, `Verknüpft mit` | Normal grouped-list navigation |
| Loading | Show two or three neutral rows and no definitive count | Panel uses `aria-busy`; no focus movement |
| Empty, add allowed | One message `Keine Beziehungen vorhanden.` plus one add action | Focus remains on tab or invoked action |
| Empty, add not allowed | One neutral empty message without separate empty group cards | No permission toast |
| One empty group | Omit that group entirely | No announcement |
| Partial row failure | Keep valid groups and show one aggregate inline error | Error remains inside the panel |
| Total panel error | Omit `Beziehungen N`; never claim zero or unblocked | User-triggered failure announces once |
| Restricted linked item | Render only the existing safe restricted-row treatment; reveal no title, owner, status, or body | Accessible name contains no private data |
| Add success | Insert the confirmed row and update `Beziehungen N` once | Focus new row; polite success announcement |
| Remove success | Remove the confirmed row and update count once | Focus next row, previous row, or group heading; announce removal |
| Add or remove failure | Preserve the existing rows and local input | Focus local error; announce assertively once |

### `Aktivität`

| State | Required presentation | Focus and announcement |
|---|---|---|
| Loaded with entries | Render visible entries grouped by date; composer appears only when authorized | Normal feed and composer order |
| Loading | Show two or three timeline skeletons; keep composer availability independent | Feed uses `aria-busy`; no focus movement |
| Empty, commenting allowed | Show one compact no-activity message and the composer | Composer keeps its persistent label |
| Empty, commenting not allowed | Show one neutral no-activity message without a disabled composer | No permission toast |
| Partial feed error | Keep loaded entries and show one persistent feed error | Retry remains local to feed |
| Total feed error | Preserve authorized composer when posting remains available; error only the feed | Announce a user-triggered failure once |
| Read-only permission | Omit the composer and attachment action; retain permitted entries | No hidden restricted action is exposed |
| Comment posting | Keep text visible, set composer busy, and block duplicate posting | Pending state is visible and programmatic |
| Comment success | Clear composer after confirmation, prepend or append according to existing order, and increment `Aktivität M` once | Focus new comment or composer; announce `Kommentar veröffentlicht.` |
| Comment failure | Preserve text and attachments; show one composer error | Focus error or invalid field; announce assertively once |
| Attachment upload | Show filename, progress, cancel when already supported, success, and per-file error | Progress has a text equivalent; completion announced once |

## Accessible Controls and Content

### Target Size

- Core tabs, buttons, disclosure toggles, defined direct row actions, icon buttons, and modal controls MUST provide a minimum 44-by-44-CSS-pixel hit area.
- A compact 32–36-pixel visual control MAY sit inside a transparent 44-pixel hit area to preserve the selected visual density.
- Inline text links are exempt when they have adequate line height and spacing from adjacent targets.
- Adjacent compact targets MUST not overlap at 200% zoom.

### Labels and Names

- Every input has a persistent visible label. Placeholder text is never the only label.
- Required and optional state is conveyed in text and programmatically, not by color or punctuation alone.
- Icon-only controls require a specific accessible name, for example `Beziehung entfernen` or `Nachweis in neuem Tab öffnen`. This requirement does not authorize an undefined overflow menu.
- Repeated row actions include the linked item title in their accessible name.
- Tooltips MAY reinforce icon meaning but MUST NOT be the accessible name or the only explanation.
- External links identify that they open a new tab in their accessible name.
- Status, owner, relationship direction, progress, and active-tab state retain text equivalents.
- Read-mode acceptance and Definition-of-Done markers MUST be true checkboxes only when they are interactive. Otherwise render them as non-interactive status indicators with equivalent text.

### Focus Visibility and Order

- Every interactive control has a visible focus indicator with at least a two-CSS-pixel perimeter or an equivalent existing token that meets WCAG contrast requirements.
- Focus is never indicated by color change alone.
- Entire clickable rows use one primary link target. Any defined nested direct action remains separate and does not create invalid nested interactions.
- If a currently supported menu exists elsewhere in the shared surface, opening it focuses its first enabled item and Escape returns focus to its trigger. No Sub-Issue or relationship row menu is required by this contract.
- Removing the currently focused row moves focus to the next logical row, previous row, or group heading in that order.
- Responsive reflow does not change the logical tab order.

### Contrast and Non-Color Meaning

- Text and interactive controls MUST meet the applicable WCAG 2.2 AA contrast ratios against their actual rendered background.
- Focus indicators and component boundaries required to identify controls MUST meet non-text contrast requirements.
- Amber, blue, emerald, and red remain supportive. Every state is also named in text.
- Disabled controls remain distinguishable without falling below readable text contrast when explanatory text is required.

## Live Announcements and Dynamic Updates

Use one visually hidden polite live region for confirmed, non-urgent outcomes and a local alert for blocking errors.

### Polite announcements

- `Bearbeitungsmodus geöffnet.`
- `Änderungen gespeichert.`
- `Sub-Issue hinzugefügt.`
- `Beziehung hinzugefügt.`
- `Beziehung entfernt.`
- `Kommentar veröffentlicht.`
- `Übersicht geöffnet.` when an active tab disappears.

### Assertive or alert behavior

- Form-wide save failure.
- Permission loss during an active mutation.
- Add, remove, post, or upload failure caused by the user's action.

Rules:

- Inline field errors use `aria-describedby`; do not announce the same error again in multiple live regions.
- Loading skeletons are hidden from assistive technology. Their container uses `aria-busy` and retains a concise accessible name.
- Background refresh failures that do not interrupt the current task remain persistent inline messages and are not assertively announced.
- Toasts MUST NOT be the only carrier of permission, persistent error, or unavailable-data information.
- Count changes caused by a confirmed action are included in the action outcome and are not announced a second time.

## Permission Presentation Contract

- Existing authorization remains authoritative; this document does not broaden or narrow access.
- Unauthorized actions that are normally hidden remain hidden.
- If the existing product intentionally renders a disabled action, its reason appears adjacent to the action and is programmatically associated with it.
- A permission failure discovered after an action remains in the affected form or panel and preserves user input.
- Item-specific permission limitations never use the global application banner.
- Restricted linked items expose no private title, owner, status, body, activity, or relationship context.

## Superseded Screenshot Text Data

The following screenshot values are illustrative data errors and are superseded by this contract. Correcting them is not a new feature.

| Screenshot data | Normative value | Reason |
|---|---|---|
| `Beziehungen 2` across the development screens | `Beziehungen 3` for the current mock item | The complete relationship view contains one waits-on row and two downstream rows |
| `Aktivität 3` across the development screens | `Aktivität 4` for the current mock item | The visible feed contains one comment and three system/history entries |
| `Evidence` and generic file-style presentation in Screen 01 | `Nachweis` using the existing link-object presentation defined in the development specification | Screen 01 predates the approved Evidence Contract |
| Any screenshot-only field label or value not backed by the current Item data contract | Existing canonical field and value only | A generated screenshot does not authorize a new field or data source |

The selected layout, spacing, hierarchy, relationship direction, and visual style remain the reference. Only the conflicting illustrative text and counts above are superseded.

## Implementation Acceptance Gate

Implementation is ready for visual and interaction QA only when all of the following are true:

- [ ] Full-page, 920-pixel modal, and below-768 layouts follow the same information and DOM order.
- [ ] Each surface has exactly one intended vertical scroll owner.
- [ ] Sticky tabs never cover focused content or the modal header.
- [ ] No right rail or generic `Weitere Details` collection remains; Planning controls expand in their semantic slot.
- [ ] Tabs implement the defined semantics, keyboard model, focus behavior, and horizontal overflow.
- [ ] Dirty edit, save, cancel, close, and navigation protection behave consistently.
- [ ] Sub-Issue and relationship add forms follow the focus, validation, and focus-return contract.
- [ ] Every tab passes its loaded, loading, empty, partial-error, total-error, permission, success, and mutation-failure states.
- [ ] Core controls provide a 44-pixel hit area and specific accessible names.
- [ ] Dynamic outcomes and blocking errors follow the live-announcement contract without duplication.
- [ ] Counts derive from the normative formulas and show current mock values `2/4`, `3`, and `4`.
- [ ] Screen-reader order remains correct across the shared inline hierarchy and at 400% zoom.
- [ ] No screenshot correction is implemented as a new workflow, field, permission, or data source.

## Non-Goals

- No new Item field, workflow state, relationship type, filter, permission, notification system, or attachment capability.
- No change to ownership, RACI, review-owner, Parent, Sub-Issue, or dependency business semantics.
- No new mobile application shell or unrelated responsive navigation redesign.
- No change to GitHub synchronization behavior.
- No implementation architecture mandate beyond the observable and accessible behavior in this contract.
