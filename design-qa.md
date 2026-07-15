# Item Creation UI — Design QA

Status: final implementation QA
Date: 2026-07-15
Browser: Codex in-app browser

## Scope

- Deliverable creation drawer
- Sub-Issue creation drawer
- Initiative creation dialog
- Milestone creation dialog
- Shared modal, select, date, and profile-selection behavior

## Visual Evidence

Approved references:

- `docs/roadmap/item-creation-ui-refinement/mockups/01-new-deliverable.png`
- `docs/roadmap/item-creation-ui-refinement/mockups/02-new-sub-issue.png`
- `docs/roadmap/item-creation-ui-refinement/mockups/03-new-initiative-constrained.png`
- `docs/roadmap/item-creation-ui-refinement/mockups/03b-new-initiative-constrained-scrolled.png`
- `docs/roadmap/item-creation-ui-refinement/mockups/04-new-milestone.png`

Browser-rendered implementation:

- `docs/roadmap/item-creation-ui-refinement/implementation-screens/01-new-deliverable-implemented.jpg`
- `docs/roadmap/item-creation-ui-refinement/implementation-screens/02-new-sub-issue-implemented.jpg`
- `docs/roadmap/item-creation-ui-refinement/implementation-screens/03-new-initiative-implemented.jpg`
- `docs/roadmap/item-creation-ui-refinement/implementation-screens/03b-new-initiative-scrolled-implemented.jpg`
- `docs/roadmap/item-creation-ui-refinement/implementation-screens/03c-new-initiative-mobile-implemented.jpg`
- `docs/roadmap/item-creation-ui-refinement/implementation-screens/04-new-milestone-implemented.jpg`

Each desktop implementation was compared with its approved reference in the same visual inspection input. Initiative and Sub-Issue were additionally checked at 375 × 720.

## States and Interactions Tested

- Open and close all four creation surfaces.
- Fill authored fields and select dates, hierarchy, ownership, and relationship values.
- Verify inherited Initiative, Milestone, and RACI context for Sub-Issues.
- Verify independent Milestone selection and approval-aware GitHub gating for Deliverables.
- Scroll Initiative content while header and footer remain fixed.
- Verify a single-column mobile reflow without horizontal overflow.
- Verify body and root scroll locking while a modal is open and restoration after close.
- Verify focus trapping, focus return, and nested modal stacking.
- Press Escape with a custom select open: the select closes while the creation form remains open.
- Check browser console: no errors or warnings.

## Comparison History

### Pass 1

- **[P1] Deliverable and Sub-Issue used a wide floating modal instead of the approved right-edge drawer.**
  - Fixed with a full-height, right-aligned drawer capped at 64rem, fixed header/footer, and one scrollable body.
- **[P1] Escape on an expanded custom select closed the entire dialog.**
  - Fixed by letting the expanded control consume Escape before the modal stack handler.
- **[P1] Task creation had a second scroll-lock implementation.**
  - Removed; shared modal locking now owns body and root overflow consistently.
- **[P2] Custom select and date labels were not programmatically connected to their controls.**
  - Fixed with stable generated IDs and `aria-labelledby`.

### Pass 2

- **[P2] Sub-Issue context-card headings did not carry the approved accent hierarchy.**
  - Fixed with compact blue uppercase headings.
- **[P2] Initiative dialog was wider and taller than the approved reference.**
  - Fixed with a 5xl width cap and a four-rem viewport gutter while preserving the internal scroll region.
- **[P2] Mobile Initiative and Sub-Issue layouts required explicit overflow verification.**
  - Confirmed at 375 × 720 with no horizontal overflow and correct fixed action placement.

### Pass 3

- No actionable P0, P1, or P2 visual or interaction differences remained.
- Remaining differences are limited to realistic seed content, background page state, and native component text values; they do not alter hierarchy, layout, or behavior.

### Pass 4 — final Product Design audit

- **[P2] Untouched Deliverable, Sub-Issue, and Initiative forms showed error-like validation copy.**
  - Fixed with field-level validation that appears after blur or a submission attempt. Pristine forms keep the disabled primary action without presenting missing input as an error.
- **[P3] Sub-Issue inherited RACI and editable Item ownership used overlapping responsibility language.**
  - Fixed with `RACI-Kontext` and `Vom Deliverable übernommen`; editable ownership remains under `Verantwortung`.
- **[P3] Initiative internal scrolling was functional but initially subtle.**
  - Fixed with a stable scrollbar gutter while preserving fixed header/footer and the single scroll owner.

## Automated Verification

- `pnpm test`: 422 passed, 0 failed
- `pnpm run lint`: passed
- `pnpm run build`: passed

final result: passed
