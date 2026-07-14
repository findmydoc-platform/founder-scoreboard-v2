# Item Detail UI — Design QA

Status: final implementation QA  
Date: 2026-07-14  
Browser: Codex in-app browser

## Evidence

- Source mock: `docs/roadmap/item-ui-refinement/development-screens/01-overview-upper-read.png`
- Full-page implementation: `docs/roadmap/item-ui-refinement/implementation-screens/implementation-full-page.jpg`
- Modal implementation: `docs/roadmap/item-ui-refinement/implementation-screens/implementation-modal.jpg`
- Mobile modal implementation: `docs/roadmap/item-ui-refinement/implementation-screens/implementation-mobile-modal.jpg`
- Combined same-input comparison: `docs/roadmap/item-ui-refinement/implementation-screens/comparison-overview.png`

## Viewports and states

| Surface | Viewport | State |
|---|---:|---|
| Full page | 1440 × 1024 | Overview read; one active prerequisite and one downstream dependent |
| Modal | 1440 × 1024 | Overview read; downstream dependency visible; secondary details collapsed |
| Mobile modal | 390 × 844 | Overview read; compact facts wrap; no horizontal overflow |

## Comparison history

1. The first implementation pass rendered operational facts as large cards and the two dependency directions as unrelated cards. This reduced fidelity to the selected command-strip direction.
2. Operational facts were changed to one compact text-first strip using existing controls. The dependency directions were changed to two rows inside one bordered group, with `Wartet auf` retaining the stronger amber treatment.
3. The mobile pass exposed vertical separators at wrapped row starts. Separators are now applied only from the small breakpoint upward.
4. The final combined comparison confirmed the same dominant title, compact operational facts, grouped dependency chain, visible text-labelled tabs, readable primary content, and secondary details rail.

The source mock uses canonical example content (`2/4` Sub-Issues, authored outcome/criteria/evidence, and two downstream dependents). The runtime screenshot intentionally uses the available seed Item and therefore omits empty authored sections and reports its real counts. These are data-state differences, not unresolved presentation mismatches.

## Functional visual checks

- One authoritative `h1` on the full-page surface.
- `Wartet auf` remains visually primary; `Andere warten hierauf` remains adjacent and explicit.
- Tab focus moves independently from selection; Enter activates the focused tab.
- Dirty Overview edits guard tab changes and surface exit.
- Modal uses one internal scroll surface and retains a clear close and full-page action.
- Mobile modal has no horizontal overflow (`dialogScrollWidth === dialogClientWidth`).
- No unsupported archive, direct-delete, reply, row-menu, Initiative-target, or remote-document-metadata affordance is present.
- Existing Approval, Review, blocker reporting, planning edits, GitHub actions, Activity import, and trash workflow retain a defined placement.

## Remaining severity

- P0: none.
- P1: none.
- P2: none.

final result: passed
