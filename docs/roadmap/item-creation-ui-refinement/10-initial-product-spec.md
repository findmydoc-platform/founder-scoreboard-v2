# Initial Product Spec: Item Creation Forms

Status: Implemented v1.0
Date: 2026-07-15
Scope owner: Product Design / Planning UI

## 1. Objective

Redesign the existing Item creation forms so that users describe the intended result before they configure secondary system metadata.

The redesign must:

- preserve the existing creation capabilities and permission model;
- separate the Deliverable and Sub-Issue information hierarchies;
- make inherited hierarchy and responsibility context recognizable without presenting it as duplicate editable input;
- keep the primary action and close action available at every scroll position;
- prevent background scrolling while a creation surface is open;
- remain usable in constrained desktop, tablet, zoomed, and mobile-sized viewports.

This iteration does not authorize schema changes, new fields, new workflow actions, or broader planning behavior changes. It does include the modal-lifecycle corrections required to keep a failed form open and render its existing validation or server error in context.

## 2. Current problems

### Shared Deliverable and Sub-Issue form

The current form gives hierarchy selectors, disabled Sprint state, and Initiative RACI more visual weight than the Item title and authored brief. It then presents all authored, planning, approval, GitHub, dependency, and quality fields in one long column.

Changing the type to Sub-Issue retains Deliverable-specific copy and exposes hierarchy fields that should be understood through the selected parent Deliverable.

### Initiative form

The Initiative modal has no bounded internal scroll owner. In a constrained viewport, the surface extends beyond the viewport at `Constraints`. Wheel scrolling moves the background rather than the form, and the footer actions cannot be reached reliably.

### Milestone form

The Milestone form is already appropriately small. Its remaining problems are consistency issues: action naming, close treatment, validation timing, and shared responsive behavior.

## 3. Shared creation-surface contract

### 3.1 Shell

- The overlay locks document scrolling for the complete lifetime of the creation surface.
- The creation shell uses at most `calc(100dvh - 32px)` above 768 CSS pixels and preserves a minimum 16-pixel viewport gutter.
- Below 768 CSS pixels, the surface becomes edge-to-edge and uses the available `100dvh`.
- The shell has three regions: fixed header, one scrollable body, fixed footer.
- The body is the only vertical scroll owner. Individual sections, cards, columns, and text areas do not create nested page-level scroll regions.
- Close remains visible in the fixed header. The primary action and Cancel remain visible in the fixed footer.
- Background content stays visible only as spatial context. It is inert, non-scrollable, and unavailable to pointer or keyboard interaction while the surface is open.

### 3.2 Header

Every creation surface uses:

1. an eyebrow in the form `ITEM ERSTELLEN · {TYPE}`;
2. one `h1`-equivalent dialog title;
3. one concise sentence describing the user outcome;
4. one bordered icon close button with an accessible label and a 44-by-44 CSS-pixel target.

The header must not contain duplicate Save, Create, or Approval actions.

### 3.3 Footer

- Each surface has exactly one primary action and one `Abbrechen` action.
- `Erstellen und freigeben` appears once, on the left side of the fixed footer, and only for authorized Initiative or Deliverable creation.
- A non-obvious domain-disabled primary action, such as an approval blocked by an unapproved Initiative, is accompanied by a concise reason in or immediately above the footer.
- An untouched form does not present missing input as an error. Input-specific validation appears after the relevant field loses focus or after a submission attempt.
- Any reason derives from the existing validation contract. The UI must not invent new required fields.
- Submission changes the primary action to a visible pending label and blocks repeat submission.

### 3.4 Validation and errors

- Required markers reflect the existing save predicate, not design preference.
- Every surface explains `* Pflichtfeld` once near the first form section. Required controls also use native `required` where applicable or `aria-required="true"` when a custom control cannot expose native required semantics.
- Untouched fields show no error-styled validation message, regardless of whether they are required or optional.
- Before interaction, minimum-length and required-field requirements may be expressed as neutral helper copy only when the requirement would otherwise be unclear.
- Field errors appear adjacent to the field and are connected through `aria-describedby`.
- On client-side validation failure, focus moves to the first invalid field. Entered values and body scroll position are preserved.
- On a server failure, the surface remains open, the draft and body scroll position are preserved, and focus moves to the form-wide error summary unless a field-specific error can be identified.
- A form-wide server failure appears once above the first section in the scrollable body.
- Immediate success is represented by closing the creation surface and showing the created Item in its destination. No success toast is required when the result is immediately visible.

### 3.5 Focus and keyboard behavior

- Opening moves focus to the first required authored field, except Sub-Issue, where the required parent Deliverable is first.
- Focus is trapped inside the modal or drawer while it is open.
- Escape follows the existing safe close behavior and does not close during submission.
- Closing restores focus to the control that opened the surface when that control still exists.
- Sticky regions never obscure a focused field or its validation message.

### 3.6 Hidden implementation invariants

- Task creation keeps one valid `creationRequestId` UUID for the lifetime of an opened Deliverable or Sub-Issue form.
- Validation failures, server failures, and retry submissions reuse that UUID. A fresh form opening receives a new UUID.
- This value is never shown as a form field and must survive component extraction, responsive rendering, and draft updates.
- Creation and edit surfaces that share a component retain their existing edit-only fields, approval metadata, conflict tokens, and save behavior even when this specification shows only the creation state.

## 4. Screen specification: New Deliverable

Visual reference: `mockups/01-new-deliverable.png`

### 4.1 Container and hierarchy

- Use the large right-side creation drawer aligned with the Item Detail surface.
- Wide layout: dominant authored-content column plus compact context column.
- Constrained layout: one column in the normative order below.
- The first interactive field is `Titel`, followed by the authored brief.

Normative reading and focus order:

1. Titel
2. Aufgabenbrief
3. Zusätzlicher Kontext
4. Struktur
5. Verantwortung
6. Planung
7. Erste Abhängigkeit
8. Freigabe and GitHub
9. Footer actions

Visual columns must not change this semantic order.

### 4.2 Authored fields

| Visible label | Existing value | Required today | Presentation |
|---|---|---:|---|
| Titel | `title` | Yes, minimum 3 characters | First and strongest input |
| Problem | `problemStatement` | No | Primary brief text area |
| Zielbild | `intendedOutcome` | No | Primary brief text area |
| Umfang & Grenzen | `scopeConstraints` | No | Brief text area |
| Abnahmekriterien | `acceptanceCriteria` | No | Brief text area; line-oriented helper copy may remain |
| Nachweis | `evidenceRequired` | No | Brief text area |
| Qualitätsstandard | `definitionOfDone` | No | Brief text area |
| Zusätzlicher Kontext | `description` | No | De-emphasized optional text area |

The redesign must not add required markers to the optional brief fields without a separately approved validation change.

### 4.3 Structure and inherited context

| Visible label | Existing value | Required today | Presentation |
|---|---|---:|---|
| Initiative | `packageId` | Yes for Deliverables | Primary structure selector |
| Epic / Meilenstein | `milestoneId` | No independent requirement | Compact editable selector preserving the current payload semantics |
| Initiative RACI | selected Initiative and profiles | Read-only | One compact summary, never a second editable responsibility form |
| Sprint | `sprintId` | Not assigned during proposal | Quiet read-only row: `Nach Freigabe zuweisen` |

This presentation preserves the current independent `packageId` and `milestoneId` inputs. Selecting an Initiative must not silently overwrite a user-selected Milestone. The UI may show the Initiative's assigned Milestone as helper context, but automatic derivation or consistency enforcement requires a separate product decision and is not authorized by this visual refinement.

### 4.4 Responsibility, planning, and dependency fields

| Group | Visible fields | Existing values |
|---|---|---|
| Verantwortung | Zuständig, Priorität | `assignee`, `priority` |
| Planung | Status, Aufwand, Bereich, Start, Ende, Zieltermin | `status`, `hours`, `workstream`, `startDate`, `endDate`, `deadline` |
| Erste Abhängigkeit | Beziehungstyp, Aufgabe, Hinweis | `relationType`, `relatedTaskId`, `relationNote` |

Only the existing invalid date-range rule blocks creation. Defaulted planning values are not visually marked as new required business input.

`Bereich` remains a free-text input. `Beziehungstyp` remains an explicit selector with the existing values `Wartet auf`, `Blockiert`, and `Verknüpft mit`; the selected relation must not be reduced to a static section label.

### 4.5 Approval and GitHub

- `Erstellen und freigeben` maps to `approveNow` and appears once in the footer for CEO users.
- The control is enabled only when the selected Initiative is already approved. Otherwise it remains disabled with the concise reason `Initiative zuerst freigeben`.
- `Zusätzlich extern anlegen` maps to `createGitHubIssue` and remains unavailable until `approveNow` is selected.
- The disabled checkbox, label, and helper text must all communicate that GitHub creation becomes available only after `Erstellen und freigeben` is selected.
- Deliverable creation does not introduce an editable GitHub repository selector. The existing configured default repository remains implicit or may be shown as non-editable helper text.
- When `approveNow` is selected, the primary label becomes `Erstellen und freigeben`; otherwise it remains `Deliverable vorschlagen`.

## 5. Screen specification: New Sub-Issue

Visual reference: `mockups/02-new-sub-issue.png`

### 5.1 Container and hierarchy

Use the same large creation drawer, with a shorter and more direct information hierarchy than Deliverable creation.

Normative order:

1. Übergeordnetes Deliverable
2. inherited Initiative, Milestone, and RACI context
3. Titel
4. Beschreibung / zusätzlicher Kontext
5. Aufgabenbrief
6. Verantwortung
7. Planung
8. GitHub-Ziel
9. Erste Abhängigkeit
10. Footer actions

The selected parent Deliverable is the primary structural choice. Separate editable Initiative, Milestone, Sprint, or RACI controls are not shown in the proposed design.

### 5.2 Required behavior

- `parentTaskId` is required and receives the first focus.
- `title` is required with the existing minimum length.
- `taskType` is fixed to `sub_issue`; no type selector is rendered.
- Initiative, Milestone, and RACI are shown as a compact, explicitly labelled inherited context strip: `Initiative`, `Epic / Meilenstein`, and `RACI-Kontext`. The inherited value reads `Vom Deliverable übernommen` so it cannot be confused with the editable `Zuständig` field.
- The note `Sub-Issues sind nicht score-relevant und übernehmen Initiative sowie RACI vom Deliverable.` remains visible but subordinate.
- Approval controls and the Deliverable-only `Zusätzlich extern anlegen` control are absent.
- `GitHub-Ziel` preserves the existing Sub-Issue repository selector.
- Parent changes update `parentTaskId`, `packageId`, and `milestoneId` atomically in local/seed mode. Supabase and local creation must resolve the same inherited Initiative and Milestone from the selected Deliverable.

### 5.3 Remaining fields

Sub-Issue creation retains the existing optional authored brief, assignee, priority, status, effort, workstream, date, deadline, dependency, and quality fields. They use the same labels and validation rules as Deliverable creation unless the existing domain behavior differs.

## 6. Screen specification: New Initiative

Visual references:

- `mockups/03-new-initiative-constrained.png`
- `mockups/03b-new-initiative-constrained-scrolled.png`

### 6.1 Container and scroll correction

- Use the fixed-header, fixed-footer creation shell.
- The body is explicitly bounded with `min-height: 0` and vertical overflow.
- The scroll body reserves a stable scrollbar gutter so constrained desktop layouts communicate that more content is available without shifting the form when scrolling begins.
- Wheel, trackpad, touch, Page Down, and Space scrolling move the form body, never the dimmed page.
- The constrained references demonstrate both states of the same low-height viewport: an initial body position and a scrolled body position where `Constraints` is reachable while header and footer remain fixed.

### 6.2 Information hierarchy

Wide and constrained-desktop layouts use two conceptual groups:

- `Ziel & Wirkung`: Titel, Ziel / Outcome, Erfolgskriterien, Constraints.
- `Einordnung & Verantwortung`: Epic / Meilenstein, Owner, Priorität, Status, Zieltermin, RACI.

The two groups are semantic containers, not a visual-only rearrangement. DOM, reading, focus, and one-column order remain stable across breakpoints:

1. Titel
2. Ziel / Outcome
3. Erfolgskriterien
4. Constraints
5. Epic / Meilenstein
6. Owner
7. Priorität, Status, and Zieltermin
8. RACI

On wide layouts, the first four fields stay in the `Ziel & Wirkung` column and the remaining fields stay in the `Einordnung & Verantwortung` column. Keyboard focus completes the first group before entering the second; it never jumps back and forth between columns.

### 6.3 Field contract

| Visible label | Existing value | Required today |
|---|---|---:|
| Titel | `title` | Yes, minimum 3 characters |
| Epic / Meilenstein | `milestoneId` | Yes |
| Owner | `ownerId` | Yes |
| Accountable | `accountableProfileId` | Yes |
| Responsible | `responsibleProfileIds` | Yes, at least one profile |
| Consulted | `consultedProfileIds` | No |
| Informed | `informedProfileIds` | No |
| Ziel / Outcome | `goal` | Yes, minimum 3 characters |
| Erfolgskriterien | `successCriteria` | No |
| Constraints | `scopeConstraints` | No |
| Priorität | `priority` | Defaulted, not part of the current save predicate |
| Status | `status` | Defaulted, not part of the current save predicate |
| Zieltermin | `targetDate` | No |

`Owner` remains the Initiative owner. `Accountable` remains a separate RACI responsibility and must not be merged into Owner.

`Erstellen und freigeben` maps to the existing `approveNow` capability and is rendered only when the current user may use it. Otherwise, create mode uses the primary action `Initiative erstellen`.

The shared `InitiativeDialog` edit mode remains supported. It retains its edit title, approval status, revision, decision reason, and existing save action; a creation-only redesign must not remove or reinterpret those fields.

## 7. Screen specification: New Epic / Milestone

Visual reference: `mockups/04-new-milestone.png`

### 7.1 Container

Use a compact centered modal from the shared creation family. The compact form still follows the same fixed header, bounded body, fixed footer, background lock, focus, and responsive rules.

### 7.2 Field contract

| Visible label | Existing value | Required today |
|---|---|---:|
| Titel | `title` | Yes, minimum 3 characters |
| Beschreibung | `description` | No |
| Zieltermin | `targetDate` | No |
| Status | `status` | Defaulted to `Geplant` |

- The untouched and valid state does not permanently display the minimum-length validation helper.
- `Titel` shows the shared required marker and exposes native required semantics.
- Zieltermin appears before Status in visual priority, while both remain in one compact row on wide layouts.
- The footer action is `Meilenstein erstellen` for create mode and retains the existing Save behavior for edit mode.

## 8. Responsive matrix

| Available width | Deliverable / Sub-Issue | Initiative | Milestone |
|---|---|---|---|
| 1280px and wider | Large right drawer; authored and context columns | Large two-group overlay; two columns | Compact centered modal |
| 768px to 1279px | Drawer or near-full overlay; single body scroll; columns collapse before fields become cramped | Near-full overlay; two columns only while each remains readable | Centered modal with 16px gutters |
| Below 768px | Edge-to-edge `100dvh`; one column | Edge-to-edge `100dvh`; one column | Edge-to-edge dialog; one column |
| 320px / 400% zoom | No horizontal viewport scroll; labels wrap; footer actions may stack | No horizontal viewport scroll; RACI controls stack | No horizontal viewport scroll; date and status stack |

At every size, the body is the only scroll owner and the fixed footer retains a usable content area above it.

## 9. Accessibility acceptance criteria

- Dialog semantics expose one accessible name and optional description.
- Background content is inert and hidden from the modal focus order.
- Labels remain programmatically associated with inputs.
- Required state, disabled state, validation state, and pending state are not communicated by color alone.
- The visible `* Pflichtfeld` legend and required label marker agree with native `required` or `aria-required` semantics.
- All pointer targets are at least 44 by 44 CSS pixels where space permits and never below the product's existing accessible minimum.
- At 200% zoom, no field or action requires horizontal page scrolling.
- At 400% zoom, one-column reflow preserves the full field and action order.
- Scrollable body regions are keyboard-scrollable after focus enters the form.
- Closing or successful creation restores focus predictably.

## 10. Non-goals and deferred decisions

- No new fields, reply models, row menus, or relationship types.
- No schema or API contract changes in this iteration.
- No change to approval permissions.
- No change to GitHub repository policy.
- No change to whether a created Item is proposed or immediately approved beyond the existing `approveNow` capability.
- Deliverable Initiative-to-Milestone derivation remains deferred. This iteration preserves both existing payload inputs.
- Sub-Issue parent inheritance remains existing domain behavior and must be aligned between Supabase and local/seed persistence rather than exposed as duplicate editable structure fields.

## 11. Initial implementation acceptance

Implementation may start only after the visual references and this field contract agree on:

1. required markers;
2. approval and GitHub controls;
3. Sprint presentation during Deliverable proposal;
4. Initiative scroll ownership and footer reachability;
5. the Milestone launch context;
6. responsive one-column order;
7. hidden `creationRequestId` lifetime and retry behavior;
8. Initiative create-error and edit-mode preservation;
9. Sub-Issue inheritance parity between Supabase and local/seed mode.

The reviewed visual references and field contract resolve the known mismatches listed in the QA and reviewer reports. Interaction behavior still requires implementation and browser QA.
