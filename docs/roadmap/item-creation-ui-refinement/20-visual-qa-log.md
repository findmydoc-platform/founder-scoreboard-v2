# Visual QA Log

Status: implementation correction pass complete
Date: 2026-07-15

## Review basis

The first generated mockups were compared with:

- the existing Deliverable and Sub-Issue creation fields;
- the existing Initiative save predicate and RACI model;
- the existing Milestone form;
- the accepted Item Detail visual language;
- the reported Initiative viewport and background-scroll failure.

## Findings and required corrections

| ID | Screen | Finding | Severity | Required correction | Resolution |
|---|---|---|---|---|---|
| D-01 | Deliverable | Required markers were added to optional brief, planning, and responsibility fields. | High | Keep required markers only for the existing required title and Initiative structure requirement. | Resolved in `01-new-deliverable.png`. |
| D-02 | Deliverable | `Erstellen und freigeben` appeared twice and in contradictory checked states. | High | Render it once in the fixed footer. | Resolved in `01-new-deliverable.png`. |
| D-03 | Deliverable | Sprint showed a concrete Sprint although proposal creation says assignment happens after approval. | High | Show only the read-only value `Nach Freigabe zuweisen`. | Resolved in `01-new-deliverable.png`. |
| D-04 | Deliverable | An editable GitHub repository selector was invented while the existing form exposes only the create-Issue boolean for Deliverables. | High | Replace it with `Zusätzlich extern anlegen`; show the configured repository only as non-editable helper copy if needed. | Resolved in `01-new-deliverable.png`. |
| D-05 | Deliverable | The dense composition made the internal scroll contract visually ambiguous. | Medium | Preserve readable type and show the body as the bounded scroll region with a fixed footer. | Resolved in `01-new-deliverable.png`. |
| D-06 | Deliverable | The GitHub option looked active before direct approval was selected. | Medium | Disable checkbox, label, and helper copy until `Erstellen und freigeben` is selected. | Resolved in `01-new-deliverable.png`. |
| D-07 | Deliverable | The Milestone looked derived/read-only although the current payload keeps it independently editable. | High | Preserve an editable `Epic / Meilenstein` selector; defer automatic derivation. | Resolved in `01-new-deliverable.png`. |
| D-08 | Deliverable | The relationship type was reduced to a static `Wartet auf` label. | Medium | Restore an explicit relationship-type selector plus task selector and note. | Resolved in `01-new-deliverable.png`. |
| D-09 | Deliverable | `Bereich` looked like a select without an option source. | Medium | Render the existing free-text input without a select chevron. | Resolved in `01-new-deliverable.png`. |
| S-01 | Sub-Issue | The required parent Deliverable lacked a required marker. | Medium | Mark `Übergeordnetes Deliverable` as required. | Resolved in `02-new-sub-issue.png`. |
| S-02 | Sub-Issue | Inherited context used unlabelled fragments and `RACI wird übernommen`. | Medium | Label inherited Initiative, Epic / Milestone, and RACI context explicitly. | Resolved in `02-new-sub-issue.png` and implementation. |
| S-03 | Sub-Issue | Inherited RACI and editable Item ownership both used `Verantwortung`, slowing responsibility scanning. | Low | Name the inherited summary `RACI-Kontext` and describe it as `Vom Deliverable übernommen`; keep editable Item ownership under `Verantwortung`. | Resolved in implementation. |
| I-01 | Initiative | The footer showed `Bitte alle Pflichtfelder ausfüllen.` although every existing required field was populated. | High | Remove the invalid-state message and show the enabled Save state. | Resolved in `03-new-initiative-constrained.png`. |
| I-02 | Initiative | Priority, Status, target date, success criteria, and Constraints were incorrectly marked required. | High | Match the existing save predicate documented in the Product Spec. | Resolved in `03-new-initiative-constrained.png`. |
| I-03 | Initiative | A tall image did not prove the reported constrained-height scroll behavior. | High | Add a low-height, scrolled reference with fixed header/footer and reachable Constraints. | Resolved in `03b-new-initiative-constrained-scrolled.png`. |
| I-04 | Initiative | The primary action used generic `Initiative speichern` in create mode. | Low | Use `Initiative erstellen` unless direct approval changes the action. | Resolved in both Initiative references. |
| I-05 | Initiative | Internal scrolling worked but was initially subtle at constrained desktop heights. | Low | Reserve a stable scrollbar gutter while preserving the single scroll owner and fixed header/footer. | Resolved in implementation. |
| M-01 | Milestone | The background showed an open Item Detail surface rather than the Milestones and Initiatives page from which the form launches. | Medium | Replace only the background context; keep the accepted modal unchanged. | Resolved in `04-new-milestone.png`. |
| M-02 | Milestone | Required title had no required marker. | High | Add the shared required marker and legend. | Resolved in `04-new-milestone.png`. |
| M-03 | Milestone | The free `×` close treatment broke the shared form family. | Medium | Use the same bordered 44-pixel icon control as the other creation surfaces. | Resolved in `04-new-milestone.png`. |
| A-01 | All | Asterisks had no shared visible or programmatic meaning. | Medium | Add one `* Pflichtfeld` legend per surface and require matching native/ARIA semantics in implementation. | Resolved in all mockups and the Product Spec. |
| A-02 | Deliverable, Sub-Issue, Initiative | Untouched required fields produced error-like footer copy before the user interacted. | Medium | Keep pristine forms quiet; reveal field-level validation after blur or a submission attempt and connect it programmatically to the field. | Resolved in implementation. |

No known visual mismatch or accepted final-audit finding remains open. Interaction behavior is covered by the repository-level implementation QA.

## Accepted without correction

- Sub-Issue uses the parent Deliverable as the primary structural choice.
- Sub-Issue hides duplicate editable Milestone, Initiative, Sprint, and RACI controls.
- Initiative uses a bounded internal body scroll and a fixed action footer, evidenced in initial and scrolled constrained states.
- Milestone remains a compact form and does not become a wizard.

## Evidence limits

Raster mockups can specify hierarchy and intended scroll ownership, but they cannot prove focus trapping, keyboard scrolling, `inert` behavior, sticky offsets, reflow, hit-area size, or screen-reader semantics. Those behaviors require implementation QA.
