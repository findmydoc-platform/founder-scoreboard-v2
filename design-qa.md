---
result: passed
---

# Review in Issue - Design QA

## Sources and implementation

- Reference sidepanel: `/Users/razorspoint/.codex/generated_images/019f67a4-cfed-73e0-99b2-ba6cd39f3d18/exec-534a077b-e079-4ad5-89de-71fd5354b42e.png`
- Implementation sidepanel: `/Users/razorspoint/.codex/visualizations/2026/07/18/review-decision-semantics/20-sidepanel-major-rework-traffic-1440.png`
- Sidepanel comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/18/review-decision-semantics/22-compare-sidepanel-traffic.png`
- Reference full page: `/Users/razorspoint/.codex/generated_images/019f67a4-cfed-73e0-99b2-ba6cd39f3d18/exec-7a603821-8f8d-40d9-9cd6-dfa8c5c2e7a9.png`
- Implementation full page: `/Users/razorspoint/.codex/visualizations/2026/07/18/review-decision-semantics/18-fullscreen-major-rework-traffic-1440.png`
- Full-page comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/18/review-decision-semantics/23-compare-fullscreen-traffic.png`
- Responsive evidence: `/Users/razorspoint/.codex/visualizations/2026/07/18/review-decision-semantics/21-sidepanel-mobile-traffic.png`
- Primary implementation: `src/features/tasks/organisms/task-detail-surface.tsx`, `src/features/tasks/molecules/task-detail-tabs.tsx`, `src/features/reviews/organisms/task-review-rail.tsx`
- Shared shells: `src/features/tasks/organisms/task-detail-panel.tsx`, `src/features/tasks/templates/task-detail-page.tsx`

## Comparison setup

- Viewport: 1440 x 1000 pixels for both implementation screenshots; references were proportionally fitted to the same comparison canvas.
- State: active requested review, zero of four checks selected, derived score 0/10, `Grundlegend überarbeiten` selected, and a required draft comment present.
- Each reference and implementation pair was emitted together in one comparison input after the final code change.
- A separate crop was unnecessary: the full-resolution pairs keep header, content boundary, checklist, comment, decision bar, and primary action readable together.

## Comparison history

### Pass 1

- P1: the review UI introduced a second card-like surface inside the issue and weakened the original two-column composition.
- P1: the rail started next to the planning and tab rows, creating broken horizontal lines.
- P1: the locked status repeated a long explanation in the metadata row.
- P2: the 1180-pixel drawer and 380-pixel rail proportions differed visibly from the supplied sidepanel reference.

### Pass 2

- Flattened the issue content and review rail onto one white canvas.
- Kept planning and tabs full-width; the two-column split now begins below the tabs.
- Replaced nested borders with one stable vertical divider and restrained section rules.
- Reduced the active-review drawer to 1060 pixels and widened the rail to 460 pixels.
- Reduced the locked status to a compact, accessible status field.

### Pass 3

- Added a visible label for the derived score while retaining the existing scoring logic.
- Re-ran sidepanel and full-page comparisons at the reference viewport and state.
- No unresolved P0, P1, or P2 fidelity findings remain.

### Pass 4 - consistency audit

- P1: all four `Ansehen` links could target zero-height sections when the corresponding issue data was empty.
- P1: a review jump from `Aktivität` did not reveal the target in `Übersicht`.
- P1: switching issue tabs incorrectly treated the review draft as disposable and opened the discard dialog.
- P1: an active review could still show the approval strip, including `Revision undefined`, and push the review action below the reference viewport.
- P2: the review comment field used only part of the available rail width.
- Added explicit empty-state sections for Zielbild, Abnahmekriterien, Nachweis, Abhängigkeiten, and Qualitätsstandard while the review is active.
- Review jumps now switch to `Übersicht`, scroll to and focus the original section, and keep the client-side review draft intact.
- Active reviews suppress the contradictory approval strip; the comment field now fills the rail width.
- Repeated the sidepanel and full-page reference comparisons at 1487 x 1058 after the fixes. No unresolved P0, P1, or P2 finding remains.

### Pass 5 - workflow invariant audit

- P1: changing tasks could reuse the mounted review rail and momentarily carry the previous task's draft into the next task.
- P1: the active-review owner control allowed clearing the reviewer or assigning a Viewer who cannot submit a review.
- P1: a reviewer selected before the request could be overwritten by the Initiative fallback when the Review started.
- P2: the same `changes_requested` state appeared as both `Nacharbeit` and `Änderungen angefordert`.
- The review rail now remounts per task, keeps an explicitly selected reviewer, rejects ownerless requests and reopens, and limits reviewer choices to contributing roles.
- Both rework decisions consistently set the task status to `Nacharbeit`; their decision labels are refined separately below.
- Re-captured and compared both desktop views after these changes. The owner selector contains only eligible named profiles and no empty option; the browser reports no warning or error.

### Pass 6 - rework semantics

- Replaced the misleading final-sounding `Mit Abweichung akzeptiert` decision with `Kleine Nacharbeit` while keeping the compatible internal `partial` value.
- Renamed the stronger rework decision from the generic `Nacharbeit` label to `Grundlegend überarbeiten` while retaining the internal `changes_requested` value.
- Both rework decisions now keep the task in `Nacharbeit`, keep the score open, require a comment, and unlock the issue for editing; only `Akzeptiert` completes the task and finalizes its score.
- The Sprint table shows `Review öffnen` only for an active requested review; rework rows expose the next action `Review anfragen` without a duplicate historical-review action.
- The three decision buttons use restrained green, amber, and red outlines as a persistent traffic-light cue. The selected state adds only a pale tint and stronger outline, avoiding a saturated alarm surface.
- Verified that validation stays hidden until submission; an invalid submission then explains the missing decision, checklist state, or required comment next to the action.
- Verified that the selected decision and comment survive Sidepanel to full-page navigation and reopening the Sidepanel without server persistence.
- Re-captured Sidepanel, full-page, and 390-pixel responsive evidence. The final comparison inputs place each supplied reference and implementation screenshot side by side. No unresolved P0, P1, or P2 finding remains.

## Required fidelity surfaces

- Typography: existing product font, weights, and type hierarchy retained; heading and body scale align with the references.
- Spacing and layout: issue content appears once; one vertical divider separates the 3:2 full-page columns and the modal content from its review rail.
- Colors and tokens: existing white, slate, blue, emerald, amber, and red design tokens reused; no new visual language introduced.
- Image and icon quality: the target contains no raster content; existing Lucide icons are reused without custom or approximate artwork.
- Copy: `Kleine Nacharbeit` and `Grundlegend überarbeiten` explicitly distinguish limited from fundamental rework without presenting either outcome as accepted. Owner, timestamp, and derived-score labels implement the approved functional requirements.
- Validation state: the primary action remains available for a validation attempt, and errors appear only after submission as requested.

## Responsive and interaction checks

- At 768 pixels, issue and review stack without horizontal overflow.
- At 420 pixels and wider, the three decision buttons remain horizontal, equal-height, and fully contained; long labels wrap inside their selection surface.
- At 390 pixels, the decisions stack vertically with equal widths.
- The selected `Grundlegend überarbeiten` decision and its comment survive Sidepanel → full page → Sprint → reopened Sidepanel as a client-side draft.
- Review links have target-specific accessible names; jumps place focus on the original issue section.
- Review links, controls, and native semantic inputs remain keyboard reachable.
- The final browser pass reports no warnings or errors.

## Final result

passed

final result: passed

---

# Issue Sharing - Design QA

## Visual sources

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019f8492-cc27-77b2-bb5a-4098ef686887/exec-781d3d1a-b68f-4e2d-973f-fc99ee38b045.png`
- Implementation screenshot: `/Users/razorspoint/.codex/worktrees/4af6/founder-scoreboard/public/product-updates/2026-07-21-issue-sharing/share-issue.png`
- Desktop viewport: 1440 x 810
- Mobile viewport checked live: 390 x 844
- Captured state: task detail open with the share popover open and an editable suggested message.

## Comparison evidence

The source and implementation screenshots were reviewed together at full-view scale. A focused comparison covered the task-header action, popover placement, message editor, action hierarchy, and dismissal control. The source board includes explanatory labels and an enlarged interaction inset; those are design annotations rather than production UI and were intentionally omitted.

## Fidelity surfaces

- Typography: Uses the existing application type scale, weights, and muted-label hierarchy. Passed.
- Spacing and layout: The popover aligns to the header action on desktop and remains inside the viewport on mobile. Passed.
- Colors and tokens: Uses the existing surface, border, muted, primary, and destructive tokens. Passed.
- Image quality and assets: The product-update screenshot is a native 1440 x 900 capture without upscaling or placeholder assets. Passed.
- Copy and content: The suggested German message contains issue type, title, status, priority, deadline when available, a state-aware request, and a deep link; the text stays editable. Passed.

## Interaction QA

- Opening and closing the share popover works from the task header.
- Editing the proposed message works in the textarea.
- `Nur Link kopieren` keeps the popover open and changes its own label temporarily to `Link kopiert`.
- `Nachricht kopieren & Google Chat öffnen` copies the edited message, opens Google Chat, closes the popover only after success, and shows no copied toast.
- Copy or popup failures leave the popover open and show an inline error.
- The dedicated two-step product tour opens an issue when needed, opens the share popover, and highlights the share action followed by the message composer.
- A clean browser session completed the tour without console errors or warnings.

## Comparison history

1. Pass 1 found mobile overflow because the desktop-aligned popover extended beyond the left viewport edge. Fixed with viewport-safe left alignment below the `sm` breakpoint.
2. Pass 1 found a content bug where a non-ISO deadline label such as `Sprint 1` was interpreted as a calendar date. Fixed by formatting only ISO date values.
3. Pass 1 found the guided tour could restart while preparing the task state. Fixed by keeping task-panel inputs in stable refs during the tour run.
4. Post-fix desktop and mobile checks passed, including the copy states and the complete guided-tour path.
5. The request sentence now distinguishes an open proposal, an active review, and all other task states. The updated product screenshot verifies the proposal wording; focused tests cover all three branches and review precedence.

## Final result

passed

---

# Task Header Repository Context - Design QA

## Evidence

- Source visual truth: user-provided task detail screenshot.
- Approved change: keep the current task-detail header, show the short GitHub repository beside the issue number, reduce Share to an accessible icon button, and keep Edit labeled.
- Implementation screenshot: local task detail capture reviewed during implementation; not committed.
- Primary viewport: 1280 x 720.
- Responsive check: 960 x 800.
- State: local task detail with `findmydoc-platform/clinic-dashboard #1`, Share closed for the primary screenshot.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the repository uses the existing compact UI typography; the issue number keeps the stronger emphasis and the repository stays secondary but legible.
- Spacing and layout rhythm: all four actions remain 44 px high. The GitHub control is 194 px wide, Share is 44 px wide, Edit is 137 px wide, and the row has no horizontal overflow at 960 px.
- Colors and visual tokens: existing slate borders, text colors, radius, focus treatment, and white surface are preserved.
- Image quality and asset fidelity: no raster assets are part of the changed control group; existing Lucide product icons remain consistent with the surrounding interface.
- Copy and content: the visible reference is `clinic-dashboard · #1`; the accessible label and tooltip retain `findmydoc-platform/clinic-dashboard #1`.
- Interaction and accessibility: the Share icon retains a 44 x 44 target, exposes the accessible name `Teilen`, opens the existing dialog, and the dialog closes successfully. No browser console errors were observed.

## Full-view Comparison

The implementation preserves the established task-detail hierarchy and control styling. The intended differences are isolated to the action group: repository context is added, Share loses its visible label, and Edit remains unchanged.

## Focused Region Comparison

The task-header action group was inspected at full desktop width and at 960 px. Controls stay aligned, retain equal height, and do not overflow. A separate crop was not needed because the primary screenshot renders the complete action group at readable size.

## Comparison History

- Initial implementation pass: no P0, P1, or P2 findings. No visual correction loop was required.

## Implementation Checklist

- [x] Show short repository name with issue number.
- [x] Preserve the full repository in the accessible label and tooltip.
- [x] Use an icon-only Share trigger with a 44 px target.
- [x] Keep Edit labeled.
- [x] Verify the Share popover interaction.
- [x] Verify desktop and 960 px layouts without horizontal overflow.
- [x] Check browser console errors.

final result: passed

---

# Task Header Icon Actions - Design QA

## Scope

- Follow-up change: remove the visible Edit label and make Edit the visually preferred header action.
- Implementation: 44 x 44 icon-only Edit button using the existing blue-outline token; Share remains neutral.
- Accessibility: `Bearbeiten` remains available as both accessible name and tooltip.

## Verification

- Static implementation and regression assertions passed.
- Full test suite, lint, and production build passed.
- Runtime screenshot and visual comparison are pending because the local preview URL was blocked by the browser security policy during this pass.

final result: visual verification pending
