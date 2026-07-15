# Item Detail UI — Refined Placement Design QA

Status: final implementation QA
Date: 2026-07-15
Browser: Codex in-app browser
Viewport baseline: 1440 × 1024
Responsive check: 390 × 844

## Evidence

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019f603e-092f-7e61-80dc-16362dd518aa/exec-6ab9f9dc-298f-4680-85ff-efad07545581.png`
- Browser-rendered modal: `docs/roadmap/item-ui-refinement/implementation-screens/implementation-modal-refined.png`
- Browser-rendered mobile modal: `docs/roadmap/item-ui-refinement/implementation-screens/implementation-modal-refined-mobile.png`
- Browser-rendered Approval strip: `docs/roadmap/item-ui-refinement/implementation-screens/implementation-workflow-strip-refined.png`
- Full-view same-input comparison: `docs/roadmap/item-ui-refinement/implementation-screens/comparison-modal-refined.png`
- Focused header/operational comparison: `docs/roadmap/item-ui-refinement/implementation-screens/comparison-modal-refined-focus.png`

The source mock shows a proposed Deliverable, while the active Planning board intentionally contains only active/approved Items. The modal comparison therefore uses the same canonical Item content with an approved state; the shared Approval-strip implementation is additionally proven on the full-page surface with the proposed state. Layout judgments avoid treating that domain-state difference as visual drift.

## Required Fidelity Surfaces

- **Fonts and typography:** The implementation uses the existing application font stack and preserves the mock's hierarchy: compact uppercase identity, one dominant title, small operational labels, and text-labelled tabs. Weight and wrapping remain readable at desktop and mobile sizes.
- **Spacing and layout rhythm:** Identity, actions, operational facts, Planning summary, workflow state, tabs, and content use one stable vertical order. The existing 920-pixel modal is intentionally wider than the illustrative generated drawer; this preserves the binding product contract and direct controls without crowding.
- **Colors and tokens:** White/slate surfaces, blue interaction accents, restrained amber attention, and subtle dividers match the selected direction. Routine metadata is no longer presented as competing cards.
- **Image quality and assets:** The Item UI contains no target imagery. Lucide icons remain vector UI icons and no image or logo was replaced by CSS art, emoji, or placeholder graphics.
- **Copy and content:** `Zuständig` remains the primary Item responsibility. `Accountable` is read-only Initiative context. `Wartet auf Freigabe`, `Planung bearbeiten`, Review responsibility, GitHub sync/create, and `Deliverable zurückziehen` use existing domain language and capabilities.

## Primary Interactions Tested

- Open and close the Item modal from Planning.
- Open the compact linked GitHub Issue action.
- Open the keyboard-accessible Item action menu and verify its disabled reason.
- Reveal dormant Review responsibility from the Item action menu.
- Expand and collapse Planning controls in place.
- Verify Initiative, Sprint, Epic / Meilenstein, period, and Initiative-Team disclosure placement.
- Open `Aktivität` and verify creator/update/carryover metadata at the end of the timeline.
- Verify the conditional Approval strip with existing decision actions on a proposed Deliverable.
- Resize the open modal from 1440 × 1024 to 390 × 844.
- Check browser console errors: none.

## Comparison History

### Pass 1

- **[P1] Mobile title collapsed beside header actions.** At 390 pixels the action group retained 304 pixels and reduced the title column to 37 pixels, producing a vertically stacked title and pushing operational facts far below the fold.
- **Fix:** The title/actions row now stacks below the small breakpoint. Header actions use full-width, left-aligned wrapping on mobile and return to compact right alignment from `sm` upward.
- **Post-fix evidence:** `implementation-modal-refined-mobile.png` shows the identity and title at full available width, followed by one intact 44-pixel action row and normally wrapped operational facts.

- **[P2] Planning action lacked the source's explicit edit signal.** The first implementation used muted ghost copy plus only a disclosure chevron.
- **Fix:** The action now uses the blue interaction token, a Pencil icon, its clear `Planung bearbeiten` label, and the disclosure chevron.
- **Post-fix evidence:** `implementation-modal-refined.png` and the focused comparison show the revised action in the Planning summary row.

### Pass 2

- No actionable P0, P1, or P2 differences remained. The modal width, direct operational controls, and separate Approval-state evidence are intentional existing-product constraints rather than unresolved design drift.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: The generated source uses a narrower illustrative drawer than the binding 920-pixel modal. No change is recommended because the wider modal materially improves direct-control and long-content usability.

final result: passed
