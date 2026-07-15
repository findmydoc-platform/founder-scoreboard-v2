# Item Detail — Normative Development Specification

Status: normative UI implementation contract
Visual direction: Operational Command Strip with two-direction dependency band
Initial review baseline: `origin/main@66bf53945c5b999512df09ab6cfd2b2e40414c4d`
Integration baseline: `origin/main@1bbe36f`
Target surfaces: desktop full page, 920-pixel side-panel modal, constrained one-column layouts
Date anchor: 2026-07-14

## Purpose

This document is the implementation source for the Item Detail presentation. It consolidates the selected mockups, the three design workstreams, and the current product capabilities into one conflict-free contract.

The implementation reorganizes existing Item information and existing actions. It does not add a database field, API capability, permission, relationship target type, workflow transition, or collaboration model.

## Normative Precedence

When artifacts disagree, use this order:

1. this specification;
2. `120-existing-capability-placement.md` for current feature placement and permissions;
3. `130-interaction-responsive-accessibility-contract.md` for state, responsive, modal, focus, and accessibility behavior;
4. `95-selected-direction-refinement.md` for visual weighting of the dependency band;
5. raster mockups in `development-screens/` for composition and visual character.

Mockup text, counts, or actions that conflict with this contract are superseded. `110-deferred-capability-register.md` documents future ideas only and must not be implemented in the current Item UI.

## Scope Boundary

### In scope

- one shared information contract for full page and modal;
- operational header with Item identity, work state, responsibility, target, and Sub-Issue progress;
- the confirmed two-direction dependency band;
- four text-labelled local tabs;
- Overview read and edit presentation using existing Task fields;
- Sub-Issue read and existing create behavior in a local tab;
- task-to-task relationship read, add, and remove behavior already supported by the product;
- existing comments, imported GitHub comments, relevant activity, mentions, and attachment upload;
- placement of current Approval, Review, Blocker, GitHub, planning, history, and withdraw-to-trash capabilities;
- responsive, modal, loading, empty, error, permission, keyboard, and focus behavior.

### Out of scope

- archive and direct-delete actions;
- threaded Activity replies;
- undefined header or row overflow menus;
- Initiative relationship targets;
- fetching or storing remote document titles, previews, thumbnails, or provider metadata;
- relationship editing, bulk linking, drag-and-drop, or graph editing;
- new activity actor data, unread state, or structured event data;
- schema, API, RLS, permission, workflow, or GitHub projection changes.

See `110-deferred-capability-register.md` for the future contract of every excluded capability.

## Canonical Example Data

All mockup states represent the same Item. Implementation fixtures and visual tests must use one internally consistent dataset.

| Property | Canonical example |
|---|---|
| Type | `Deliverable` |
| Title | `CEO-Briefing für Pitchdeck v2 liefern` |
| Initiative | `Investor Readiness & Funding` |
| Status | `Offen` |
| Primary owner | `Volkan` |
| Priority | `P1` |
| Target date | `18.07.2026` |
| Sub-Issues | `2 von 4 erledigt` |
| Active prerequisites | one unresolved `Wartet auf` Item |
| Downstream dependents | two `Andere warten hierauf` Items |
| Relationship tab count | `3` unique visible linked Items |
| Activity tab count | `4` visible timeline entries after filtering |

The inline Planning section must not repeat the target date. The visible mockup value `Zieltermin · Sprint 1` is invalid and must not be implemented.

## Shared Visual Invariants

Every surface preserves:

- collapsed 64-pixel findmydoc navigation where the application shell is visible;
- Inter typography, white/slate surfaces, blue interaction accents, restrained amber risk treatment, compact radii, and Lucide-style icons;
- one dominant title and one authoritative work-status presentation;
- `Zuständig` as the visually primary responsibility;
- the grouped dependency band with incoming waiting visually stronger than downstream impact;
- tabs in the stable order `Übersicht`, `Sub-Issues 2/4`, `Beziehungen 3`, `Aktivität 4` for the canonical example;
- the same labels, counts, information order, permissions, and available actions in full page and modal;
- no status, owner, priority, date, relationship, or progress duplication below the header.

## Operational Header Contract

Render in this semantic order:

1. container navigation: Back on full page; Back history, `Große Ansicht`, and Close in the modal;
2. identity line: Item type plus resolved Epic / Meilenstein and Initiative or Parent context; omit the Epic / Meilenstein segment when no milestone is assigned;
3. one authoritative Item title;
4. existing Item action `Bearbeiten` when at least one Overview field is editable;
5. operational facts: work status, `Zuständig`, priority, target date, and Sub-Issue progress;
6. grouped dependency band;
7. local tab bar.

Header controls reuse existing permissions:

- status renders the current `TaskStatusControl` behavior in place;
- owner and priority are editable only when existing task-meta permissions allow it;
- target-date editing remains part of Planning metadata and must replace, not duplicate, the header date while active;
- locked actions retain the existing reason adjacent to the affected control;
- Approval state never replaces work status.

The header and row ellipsis icons visible in generated mockups have no current action contract and must not render in the implementation.

## Dependency Band Contract

### Primary row — `Wartet auf N`

- Meaning: the current Item cannot proceed until N unresolved prerequisite Items are terminal.
- Visual treatment: restrained amber surface, hourglass or equivalent supporting icon, explicit direction text.
- With one prerequisite, show its title, status, and responsible person.
- With several, show the first existing-order Item and `+N weitere`.
- This row owns the first scan because inability to proceed is the immediate operational risk.

### Secondary row — `Andere warten hierauf N`

- Data mapping: existing `blocks` direction.
- Meaning: N downstream Items depend on the current Item.
- Visual treatment: quiet slate/blue surface with flag or direction cue.
- Show the first linked Item and `+N weitere` in the compact band.
- Keep this row visible when present, but subordinate it to active incoming waiting.

### Combined chain state

When both directions exist, the complete Relationships tab may display `Position in der Kette: blockiert und blockierend`. These are derived display terms only. They do not create a stored status or severity score.

## Local Navigation and Count Contract

| Tab | Count formula | Canonical example |
|---|---|---|
| `Übersicht` | no count | `Übersicht` |
| `Sub-Issues X/Y` | terminal direct children / all direct children | `Sub-Issues 2/4` |
| `Beziehungen N` | unique visible non-hierarchy linked Items across `Wartet auf`, `Andere warten hierauf`, and `Verknüpft mit` after duplicate suppression | `Beziehungen 3` |
| `Aktivität N` | visible local comments + imported GitHub comments + relevant filtered system activities | `Aktivität 4` |

Counts are recalculated from rendered data and never copied from mockup text. Large counts display `99+`; Sub-Issues retain the completed/total format.

Tabs use the semantic and keyboard contract in `130-interaction-responsive-accessibility-contract.md`. Changing tabs never resets the operational header.

## Overview — Read Contract

Render only non-empty sections in this order:

1. `Problem` from `problemStatement`;
2. `Zielbild` from `intendedOutcome`;
3. `Umfang & Grenzen` from `scopeConstraints`;
4. `Abnahmekriterien` from `acceptanceCriteria`;
5. `Erforderlicher Nachweis` from `evidenceRequired`;
6. `Nachweis` from `evidenceLink`;
7. `Qualitätsstandard` from `definitionOfDone`;
8. `Gemeldete Blocker` from current open `TaskBlocker` records;
9. `Interne Notiz` from `note` when the current permission model allows the user to read it.

`Nächster Schritt` is not a Task Detail field and must not render. `TaskFocusItem` data is outside this Item UI scope.

`updatedAt` may produce `Zuletzt aktualisiert am {date}`. Do not append an actor because the Task model does not provide `updatedBy`.

### Checklist display

- Acceptance Criteria and Quality Standard use the existing checklist behavior where editing is allowed.
- A checkbox must not appear interactive if the current user cannot change it.
- Empty authored sections are omitted; the Overview tab remains available.

## Evidence Contract

`evidenceRequired` and `evidenceLink` are separate concepts.

### `Erforderlicher Nachweis`

- Authored text describing what proof is expected.
- Rendered as normal Overview content.
- Edited with the other brief fields.

### `Nachweis`

- The actual saved URL from `evidenceLink`.
- Read mode renders one compact link object with an external-open affordance.
- The primary fallback label is `Nachweis öffnen`.
- The secondary line shows the safe hostname, for example `drive.google.com`.
- A provider name or icon may be derived locally from a small known-host mapping; no network metadata lookup is allowed.
- Do not display a generated document title as authoritative data.
- If the URL is empty, omit the read section.

### Evidence edit

- Label: `Nachweis-Link`.
- Show the complete current URL in an input.
- Show a compact derived preview containing only locally derivable provider/hostname information.
- Invalid URL errors remain at the field and preserve the draft.

Richer document titles and remote metadata belong exclusively to the deferred capability register.

## Overview — Edit Contract

The existing `Bearbeiten` action opens one local Overview edit state. It may combine existing Task fields into one visual form and one existing Task update request.

Editable fields, subject to existing permissions:

- `Titel`;
- `Problem`;
- `Zielbild`;
- `Umfang & Grenzen`;
- `Abnahmekriterien`;
- `Erforderlicher Nachweis`;
- `Nachweis-Link`;
- `Qualitätsstandard`;
- `Interne Notiz`.

Status, owner, priority, deadline, Planning metadata, and Review Owner retain their existing permission-gated direct controls in the header or secondary details. They do not participate in the Overview draft and are not reverted by Overview `Abbrechen`. Approval, Review workflow actions, relationships, blockers, comments, GitHub actions, and withdrawal also remain independent.

Use one persistent action bar inside the active panel:

- secondary `Abbrechen`;
- primary `Speichern`;
- no duplicate header Save/Cancel controls;
- the normal `Bearbeiten` action is hidden while editing;
- Save is disabled until at least one editable value differs from the initial draft;
- a failed save preserves every draft value and shows one panel-level error plus any field error;
- successful visible replacement is sufficient confirmation; no routine success toast;
- tab change, modal close, Back, or `Große Ansicht` with a dirty draft requires an explicit discard-or-stay decision.

## Sub-Issues Tab

### Read state

- Show `X von Y erledigt` with a supplementary progress bar.
- Unfinished direct children appear first in an expanded `Offen N` group.
- Terminal direct children appear under `Erledigt N`.
- `Erledigt N` is collapsed when unfinished children exist and expanded when every child is terminal.
- Each row shows status, title, and responsible person; a stable display identifier appears only when one already exists.
- Opening a row uses the existing Item-opening behavior.

### Existing create behavior in local presentation

The local `Sub-Issue hinzufügen` action may present the existing creation workflow inline. It does not add a creation capability.

The implementation must preserve these defaults:

- `taskType = sub_issue`;
- `parentTaskId = current Item id`;
- inherited Initiative, Milestone, and Parent approval context;
- initial status `Offen`;
- existing assignee options and permissions;
- current API validation and failure messages.

While the add form is open, hide the trigger rather than duplicate it. On Cancel or successful creation, return focus to the trigger position. Existing rows expose only the current open-item behavior; no row overflow menu or inline edit action is added.

## Relationships Tab

Render populated groups in this order:

1. `Wartet auf` for `blocked_by` edges where the current Item waits;
2. `Andere warten hierauf` for existing downstream `blocks` direction;
3. `Verknüpft mit` for `relates_to` edges.

Direction is explained in text and not encoded by color alone. Active incoming waiting remains visually strongest. Empty groups are omitted. One completely empty destination shows one compact empty state.

### Existing add and remove behavior

- Reuse the existing relation types allowed by `taskRelationshipAccess`.
- The current selector offers existing supported Task targets only. It must not claim Initiative support.
- Current client behavior excludes Sub-Issues from new target selection; stored Sub-Issue relationships may still render when present.
- Duplicate and self-relationships remain invalid.
- The optional relationship note is shown below the linked row when present.
- Removal renders only when the existing permission allows it and uses a labelled direct affordance, not an undefined overflow menu.
- Relationship creation and removal errors stay in this tab; optimistic rollback preserves the last valid list.
- Existing behavior supports add and remove only. No relationship edit action is shown.

## Activity Tab

The Activity tab preserves the current unified timeline:

- local comments;
- imported GitHub comments;
- relevant filtered `TaskActivity` entries;
- the existing comment composer;
- mentions;
- current attachment upload;
- current GitHub comment refresh/import action.

### Composer

- Visible label: `Kommentar oder Update`;
- textarea placeholder may provide an example but is not the only accessible name;
- `Datei anhängen` uses the current accepted file types and upload behavior;
- `Kommentieren` remains disabled for an empty or too-short draft;
- pending and upload states preserve the draft;
- upload or submit failures remain adjacent to the composer.

### Timeline

- Newest entries render first and may be grouped by calendar day.
- Human comments show the author already available from comment/profile data.
- Imported GitHub comments show their existing GitHub author and external-open action.
- System activities use actor-neutral copy because `TaskActivity` has no structured actor field.
- The mockup action `Antworten` must not render; threaded replies are deferred.

## Existing Capability Placement

The following current capabilities remain in the new UI and must not disappear:

| Capability | Required placement |
|---|---|
| Evidence Required | Overview authored section and Overview edit form |
| Evidence Link | Overview link object and Overview edit URL field |
| Approval state and decisions | compact conditional workflow strip above the tabs |
| Review status, owner, and Review action | compact conditional workflow strip; dormant setup is opened from the Item action menu |
| Reported Task Blockers | Overview `Gemeldete Blocker` section with existing report behavior |
| Status | operational header using existing control and lock reason |
| Owner and priority | operational header; editable only under existing task-meta permissions |
| Initiative, Sprint, Milestone, period, target date, RACI | calm Planning summary below the operational facts; direct controls in its inline disclosure |
| GitHub Issue sync | compact linked-Issue action in the title row; sync/create in the Item action menu |
| GitHub comment import | Activity tab action |
| Creator and update timestamp | compact footer in `Aktivität` |
| Deliverable withdrawal | Item action menu; existing confirmation and permissions |

The detailed data, permission, feedback, and cross-surface contract is in `120-existing-capability-placement.md`.

## Distributed Operational Placement

The full page and modal use the same one-column semantic order. There is no secondary rail and no generic `Weitere Details` collection.

1. Header: hierarchy, Accountable context, title, linked GitHub Issue, edit, and Item action menu.
2. Operational facts: status, `Zuständig`, priority, target date, and Sub-Issue progress.
3. Planning summary: Sprint and compact period; direct Planning controls expand in place.
4. Dependencies: `Wartet auf` before `Andere warten hierauf`.
5. Conditional workflow strips: Freigabe and active/configured Review only.
6. Tabs and active panel.
7. Creator, update time, and carryover metadata at the end of `Aktivität`.

The Item action menu contains low-frequency direct actions, including GitHub sync/create, Review responsibility setup, and the existing withdrawal workflow when permitted. It is not a generic metadata drawer.

`Archivieren` and direct `Löschen` from the generated Overview-lower mockup are invalid for the current implementation. Use only the existing `Deliverable zurückziehen` workflow.

## Full-Page, Modal, and Constrained Behavior

### Wide full page

- readable main column using the same inline operational hierarchy as the modal;
- document scroll is the single primary scroll container;
- operational header need not be sticky;
- tab bar may stick below application chrome;
- active panel is the only rendered tab destination.

### 920-pixel side-panel modal

- same information and actions, no reduced product contract;
- sticky modal header and tab bar;
- one modal scroll container;
- one content column regardless of viewport `lg` breakpoint;
- no secondary rail or generic details disclosure;
- Close and `Große Ansicht` remain reachable;
- dirty-state navigation uses the Overview edit contract.

### Below 768 pixels or equivalent constrained container

- order: identity, title/actions, operational facts, Planning summary, dependency band, conditional workflow strips, horizontally scrollable tabs, active panel;
- status and owner remain ahead of optional facts;
- core labels never collapse to unexplained icons;
- interactive targets are at least 44 by 44 CSS pixels where the control is not an inline text link;
- title wraps naturally and is never the only ellipsized title representation.

See `130-interaction-responsive-accessibility-contract.md` for the complete state and interaction matrix.

## Screen Inventory

| ID | Screen | State | Artifact status |
|---|---|---|---|
| 01 | Overview upper | Read | visual layout reference; counts and Evidence copy corrected by this specification |
| 02 | Overview lower/end | Read, scrolled | visual layout reference; unsupported actions and field content corrected by this specification |
| 03 | Overview | Edit | visual layout reference; field set and single action bar corrected by this specification |
| 04 | Sub-Issues | Read | visual layout reference |
| 05 | Sub-Issues | Add | visual layout reference; duplicate trigger and row menus must not render |
| 06 | Relationships | Read | visual layout reference; canonical relationship count is 3 |
| 07 | Relationships | Add | visual layout reference; target scope and row actions corrected by this specification |
| 08 | Activity | Read plus composer | visual layout reference; canonical count is 4 and Reply must not render |

### Raster references

- [01 Overview upper](development-screens/01-overview-upper-read.png)
- [02 Overview lower/end](development-screens/02-overview-lower-end.png)
- [03 Overview edit](development-screens/03-overview-edit.png)
- [04 Sub-Issues read](development-screens/04-sub-issues-read.png)
- [05 Sub-Issues add](development-screens/05-sub-issues-manage.png)
- [06 Relationships read](development-screens/06-relationships-read.png)
- [07 Relationships add](development-screens/07-relationships-manage.png)
- [08 Activity](development-screens/08-activity-composer.png)

## Implementation Acceptance Gate

Implementation may begin when the following files exist and agree:

- this normative specification;
- `110-deferred-capability-register.md`;
- `120-existing-capability-placement.md`;
- `130-interaction-responsive-accessibility-contract.md`.

The UI passes only when:

1. every visible count is calculated from the rendered dataset;
2. read and edit states represent the same Task values;
3. no deferred action or invented metadata appears;
4. every current capability in the placement table remains reachable under its existing permission;
5. full page and modal expose the same information and behavior;
6. empty, loading, partial-error, permission, pending, and failed-save states follow the state contract;
7. keyboard, focus, accessible naming, and responsive reflow follow the interaction contract;
8. no database, API, permission, workflow, or GitHub projection expansion is required;
9. tests prove count formulas, permission visibility, dirty-state protection, and full-page/modal parity;
10. visual QA compares the implementation against the selected composition while applying the normative text and action corrections above.
