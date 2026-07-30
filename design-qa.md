---
result: passed
---

# Planning Kanban Card Density - Design QA

## Variant 2 rollup and shared card addendum

### Evidence

- Selected source visual truth: `/Users/razorspoint/.codex/generated_images/019faf44-bf37-78c1-8495-ba22c80b0cb8/call_7TJukMBkkpM9ytwjzunGeOns.png`
- Collapsed Board implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/board-collapsed.png`
- Expanded Board implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/board-expanded.png`
- Full expanded Board implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/board-expanded-full.png`
- Shared Structure implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/structure-shared-card.png`
- Focused reference and implementation comparison: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/reference-vs-implementation.png`

### Comparison and findings

- The selected target keeps the same `3 von 5 Sub-Issues`, `60%`, 4-pixel progress rail, `2 offen · 3 erledigt`, icon sizes, and disclosure-row typography in both states. Only the chevron direction and child-list visibility change, eliminating the previous size jump.
- The expanded child list uses the card's white base without an accordion box, outer list border, rounded list shell, or per-row separators. One restrained rule separates unfinished from completed work.
- Board and Structure now render the same `TaskCard` implementation with the same shell, GitHub reference, exception-only badges, Sub-Issue rollup, owner, and date hierarchy. The previous visual variant and display-control prop branches were removed.
- Sub-Issue grouping is shared through one pure feature-model helper instead of being duplicated by each view.
- The normalized focused comparison confirms the selected hierarchy and content order. The implementation preserves the product's denser 320-pixel Board lane rather than scaling the isolated mockup card to its presentation canvas.
- No actionable P0, P1, or P2 findings remain.

### Runtime checks

- The disclosure opens and closes in place with stable header and summary typography.
- The parent Board card remains `draggable="true"`.
- The disclosure trigger and all five child links remain `draggable="false"`, preserving the existing drag-and-drop gesture boundary.
- The Structure view shows the same simulated GitHub reference and five-Sub-Issue rollup from the same card component.
- Browser console: no warnings or errors.

### Final result

final result: passed

## Sub-Issue card disclosure addendum

### Evidence

- Closed-state source visual truth: `/Users/razorspoint/.codex/generated_images/019faf44-bf37-78c1-8495-ba22c80b0cb8/call_EXu4XMtQ7i5xiQnkC4zwsLMh.png`
- Expanded-state source visual truth: `/Users/razorspoint/.codex/generated_images/019faf44-bf37-78c1-8495-ba22c80b0cb8/call_IWs0lFzmXz7jcZeoWtcMASgy.png`
- Closed implementation screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hybrid-closed-full.png`
- Expanded implementation screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hybrid-expanded-full.png`
- Closed focused crop: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hybrid-closed.png`
- Expanded focused crop: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hybrid-expanded.png`
- Closed comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hybrid-qa-closed.png`
- Expanded comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hybrid-qa-expanded.png`
- Compact-hierarchy feedback source: `/var/folders/q5/4tfj719d17d39dfk6lq_7m8h0000gn/T/codex-clipboard-04bc3451-b5f9-4fdf-9912-5685fe1acf23.png`
- Compact closed implementation: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hierarchy-compact-closed.png`
- Compact before/after comparison: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/sub-issue-hierarchy-compact-comparison.png`
- GitHub-status ownership implementation: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/github-sync-card-cleanup/board-without-routine-github-status.png`
- GitHub-status ownership focused crop: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/github-sync-card-cleanup/card-without-routine-github-status.png`
- GitHub-status ownership comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/github-sync-card-cleanup/before-after-card-comparison.png`
- Compact-trigger feedback source: `/var/folders/q5/4tfj719d17d39dfk6lq_7m8h0000gn/T/codex-clipboard-a5399870-8bc1-435c-8c1d-d5f6e0c73b2b.png`
- Compact-trigger implementation: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/github-sync-card-cleanup/compact-subissue-trigger/card-compact-subissue-trigger.png`
- Endpoint-rollup source visual truth: `/Users/razorspoint/.codex/generated_images/019faf44-bf37-78c1-8495-ba22c80b0cb8/call_qVAJ5fL9wRuvgkurkMzMwk01.png`
- Endpoint-rollup full implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/subissue-endpoint-rollup/board-variant-3.png`
- Endpoint-rollup focused implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/subissue-endpoint-rollup/card-variant-3.png`
- Endpoint-rollup comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/subissue-endpoint-rollup/comparison-variant-3.png`
- Expanded implementation after endpoint-rollup change: `/Users/razorspoint/.codex/visualizations/2026/07/30/019faf44-bf37-78c1-8495-ba22c80b0cb8/subissue-endpoint-rollup/board-variant-3-expanded.png`

### Comparison setup

- Source images: 1299 x 1211 pixels. Focused source crops were normalized to 330 pixels wide and placed beside the implementation crops.
- Browser viewport: 1280 x 720 CSS pixels at device pixel ratio 2. Browser output was normalized to 1269 x 714 pixels.
- Focused implementation crops: 330 x 281 pixels closed and 330 x 455 pixels expanded.
- State: local Planning Board with one Deliverable containing five simulated Sub-Issues: two unfinished and three completed.
- The selected target intentionally combines the compact closed trigger from option 3 with the inline worklist from option 1.
- Endpoint-rollup pass: 1444 x 1085 source image and 1023 x 954 browser implementation from a 1034 x 964 CSS viewport at device pixel ratio 2. Both focused card regions were normalized to 302 x 221 pixels and placed in the same comparison input.

### Findings and comparison history

#### Pass 1

- The closed state preserves the selected compact summary, status marks, right-facing disclosure affordance, progress bar, owner, and dates.
- The expanded state keeps the list inside the card, orders unfinished items before completed items, truncates every title to one line, and retains readable status labels plus semantic color.
- The expanded summary row remains as the reversible accordion header. This is an intentional interaction adaptation of the selected hybrid, not visual drift.
- At this comparison pass, the live local card additionally showed `GitHub offen` because the simulated record was not marked synced. The later GitHub-status ownership pass removes this routine integration state from planning surfaces.
- No actionable P0, P1, or P2 findings remain. No code-level visual correction loop was required.

#### Pass 2 - compact hierarchy

- P2: the closed Sub-Issue area occupied too much vertical space and competed visually with the parent title, GitHub state, and priority.
- Fix: reduced the rollup to 10-pixel medium-weight metadata, reduced the progress bar from 6 to 4 pixels, and reduced the closed disclosure row to about 28 pixels with a near-neutral surface and lighter border.
- Post-fix evidence: the closed card height fell from about 253 to 240 pixels while the open state, exact counts, status colors, focus treatment, and canonical child links remained intact.
- The focused before/after comparison shows the parent title and exception badges reclaiming the primary hierarchy. No actionable P0, P1, or P2 finding remains.

#### Pass 3 - GitHub status ownership

- P2: `GitHub offen`, `Kein GitHub Issue`, and `Sync läuft` duplicated the global Sync Center, competed with task priority and Sub-Issue progress, and made an internal projection state look like task status.
- Fix: routine GitHub sync states were removed from cards, the planning table, and the sprint table. The direct repository-and-issue link remains on linked board cards. `Sync fehlgeschlagen` remains available through the critical task-attention signal.
- Source pixels: 666 x 590 at 144 dpi. The 603 x 505 card crop was normalized to 302 x 253 pixels. The implementation card is 302 x 240 CSS pixels; both were placed in the same comparison input.
- Browser viewport: 1034 x 964 CSS pixels at device pixel ratio 2. The in-app Browser capture is normalized to 1023 x 954 pixels.
- Post-fix evidence: all 14 visible board cards and all planning table rows contain zero occurrences of the three routine sync labels. The direct `management #9999` link remains, while the header Sync Center still exposes 19 actions.
- No actionable P0, P1, or P2 finding remains.

#### Pass 4 - closed trigger density

- P2: the closed disclosure still rendered as a full-width bordered surface and inherited a 16-pixel native button font, so it remained visually heavier than the surrounding card metadata.
- Fix: the closed state is now a borderless inline metadata action. Its content is explicitly 10 pixels with a 10-pixel line height inside a 24-pixel-high, approximately 140-pixel-wide click target. The expanded full-width header and inline list remain unchanged.
- Post-fix evidence: the closed card height fell from about 240 to 224 pixels. The count, semantic open/completed icons, disclosure chevron, keyboard focus ring, and accessible name remain present.
- No actionable P0, P1, or P2 finding remains.

#### Pass 5 - endpoint rollup

- P2: the compact disclosure still grouped both state counts at the left edge, making them read like a separate metadata sentence instead of belonging to the progress rail.
- Fix: the closed state now labels the rail with `Sub-Issues` and `3/5 · 60%`, uses a 3-pixel rail, and places `2 offen` and `3 erledigt` at the corresponding visual endpoints. All closed-state type is 9 pixels, while the full-width button retains its keyboard focus treatment and accessible name.
- Post-fix evidence: the card is 302 x 221 CSS pixels. The focused comparison matches the selected option's hierarchy and alignment without increasing the card height. The expanded state retains the previously selected inline worklist.
- No actionable P0, P1, or P2 finding remains.

### Required fidelity surfaces

- Fonts and typography: the existing product type stack, 9-pixel closed rollup metadata, title weight, tabular counts, one-line truncation, and status hierarchy are preserved.
- Spacing and layout rhythm: the card remains 302 pixels inside the 320-pixel board lane. It measures about 221 pixels closed and 412 pixels expanded, with no horizontal overflow or nested card treatment.
- Colors and visual tokens: blue indicates active work, slate indicates open work, emerald indicates completion, and the existing focus-ring and border tokens remain unchanged.
- Image quality and asset fidelity: the changed component contains no raster assets. Status and disclosure affordances use the installed Lucide icon set; no custom SVG or CSS artwork was introduced.
- Copy and content: the closed state says `Sub-Issues`, `3/5 · 60%`, `2 offen`, and `3 erledigt`; the expanded state shows all five exact titles, their normalized statuses, and no duplicate parent metadata.
- Interaction and accessibility: the trigger exposes `aria-expanded` and `aria-controls`; its accessible name includes both counts. A child row opens the canonical task detail dialog. The parent card remains draggable, while the trigger and child links explicitly remain non-draggable so card drag-and-drop keeps a clear gesture boundary.
- GitHub status hierarchy: routine integration copy is absent from planning cards and tables. The direct issue reference retains its explicit accessible name, and only a failed sync may re-enter the card as a critical exception.

### Runtime checks

- Clicking the trigger opened and closed the inline list.
- Clicking `404-Regressionstest ergänzen` opened the existing task detail dialog without changing the board route.
- Browser attributes confirmed `draggable="true"` on the card and `draggable="false"` on the disclosure trigger and child links.
- The endpoint-rollup browser pass reported no warning or error.
- The fixed board-lane width, `min-w-0`, and title truncation preserve the established narrow-screen horizontal-board behavior. A separate responsive source target was not supplied for this component.
- The final local pass opened and closed the Sub-Issue list, switched to the planning table and back to the board, and reported no browser errors.

### Final result

final result: passed

## Evidence

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019faf44-bf37-78c1-8495-ba22c80b0cb8/call_nWqtxSEefdGvxU6CcT9woJDF.png`
- Implementation screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/implementation-desktop-final.png`
- Desktop board crop: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/implementation-desktop-board-final.png`
- Responsive evidence: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/implementation-mobile-board-final.png`
- Collapsed-column desktop evidence: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/implementation-collapsed-columns-desktop.png`
- Collapsed-column responsive evidence: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/implementation-collapsed-columns-mobile.png`
- Full-view comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/comparison-final.png`
- Focused card comparison input: `/Users/razorspoint/.codex/visualizations/2026/07/29/019faf44-bf37-78c1-8495-ba22c80b0cb8/kanban-card-density/comparison-card-focus-final.png`

## Comparison setup

- Source pixels: 1488 x 1058, normalized to 1440 x 1024 for the full-view comparison.
- Implementation pixels: 1429 x 1016 from a 1440 x 1024 CSS viewport at device pixel ratio 1, normalized to 1440 x 1024.
- Responsive viewport: 390 x 844 CSS pixels at device pixel ratio 1.
- State: Planning Board with the local development dataset. One Deliverable carries a simulated GitHub Issue and five simulated Sub-Issues so the direct link and 60 percent rollup are visible. The remaining statuses are empty and exercise the compact drop-rail state.

## Findings and comparison history

### Pass 1

- P2: the canonical task link still rendered an unlabeled panel glyph next to every board title, duplicating the title affordance and weakening the separate GitHub action.
- Fix: board cards now suppress that glyph while preserving the accessible canonical task link and drawer behavior.
- The browser-only Next.js development indicator was identified as non-product chrome. The handoff crops exclude it without altering the application UI.

### Pass 2

- The final desktop and focused card comparisons show the intended dense hierarchy: title, exception-only badges, Sub-Issue rollup area, responsible person, and date.
- Board columns fit four lanes at the desktop target while preserving horizontal scrolling for the remaining states.
- No actionable P0, P1, or P2 findings remain.

### Pass 3 - empty columns and drag targets

- Empty status columns now collapse to stable 96-pixel full-height rails instead of consuming card-width space.
- The status, zero count, and status-specific create action remain visible and accessible.
- A drag session does not resize the rails. Empty destinations gain an explicit drop treatment, and the hovered target changes to `Loslassen`.

## Required fidelity surfaces

- Fonts and typography: the existing Inter/system stack, title weight, compact metadata scale, and two-line wrapping are preserved. Titles remain visually dominant over signals and dates.
- Spacing and layout rhythm: board lanes shrink from 360 to 320 pixels; card and lane gaps are reduced without collisions. The card footer remains separated by one restrained rule.
- Colors and visual tokens: the existing white, slate, blue, and semantic warning tokens are retained. The responsible-person color is reduced to a narrow functional spine and dot instead of a card-wide gradient.
- Image quality and asset fidelity: the changed surface contains no raster assets. The direct external action uses the installed official GitHub icon and the existing icon library; no custom SVG or CSS artwork was introduced.
- Copy and content: status is not repeated inside its lane. P2/P3 priority, initiative text, and uncounted comment/file icons are removed from board cards. Linked cards expose a direct repository-and-issue reference; zero and non-zero Sub-Issue states use explicit counts.
- Interaction and accessibility: the task title opens the canonical detail panel, the panel closes with Escape, direct GitHub links open in a new tab with an explicit accessible name, progress uses native progressbar semantics, and focus rings remain visible. Every status column has a descriptive region label, and each create action names its target status.

## Responsive and runtime checks

- The 390 x 844 capture keeps the selected view, search/filter controls, first lane, and dense card hierarchy usable without card compression.
- Horizontal board scrolling remains the explicit mobile interaction.
- The local browser pass opened and closed a task detail panel successfully.
- Empty columns remain 96-pixel rails at 390 pixels, preserving a visible next-status affordance without compressing the populated card column.
- Browser console: no warnings or errors in the final desktop pass.
- The simulated GitHub reference and non-zero Sub-Issue rollup are visible in the captured local seed state.

## Final result

passed

final result: passed

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

# Evidence Link Editor Width - Design QA

## Evidence

- Source visual truth: `/var/folders/q5/4tfj719d17d39dfk6lq_7m8h0000gn/T/codex-clipboard-c9023d5f-4ac5-4787-a7c2-fe21d960aaee.png`
- Implementation screenshot: `/private/tmp/evidence-links-edit-wide-focused.png`
- Combined comparison input: `/private/tmp/evidence-links-edit-comparison.png`
- Source pixels: 1682 × 586
- Implementation pixels: 1340 × 390
- Desktop CSS viewport: 1668 × 900 at device pixel ratio 1
- Responsive CSS viewport: 768 × 900
- State: task overview edit mode with GitHub, Notion, generic web, and one trailing empty URL field

## Findings and comparison history

1. The supplied source showed a P1 usability issue: each URL input occupied only the browser-default input width while its provider label was positioned against the full-width wrapper. Complete URLs were visibly cut off despite unused horizontal space.
2. The input now fills its wrapper with `w-full min-w-0`; the existing provider adornment, padding, focus state, row height, and lazy-field behavior remain unchanged.
3. The focused comparison places the supplied source and final implementation in one normalized-width image. At 1668 pixels the fields fill the evidence section and the complete seeded URLs remain readable.
4. At 768 pixels every evidence input measures 654 pixels inside the 768-pixel viewport without horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: existing field typography, weights, line height, and labels are unchanged; URL text no longer appears prematurely truncated.
- Spacing and layout rhythm: fields now use the available section width on desktop and responsive layouts while retaining the existing vertical rhythm.
- Colors and visual tokens: existing border, focus, surface, and muted-provider tokens are unchanged.
- Image quality and asset fidelity: existing local provider icons remain sharp and aligned; no new assets were introduced.
- Copy and content: helper text, provider labels, and URL values are unchanged.
- Interaction and accessibility: keyboard focus, accessible URL labels, automatic trailing field creation, and disabled save behavior remain intact.

## Final result

No actionable P0, P1, or P2 findings remain.

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

---

# Evidence Links and Linked Pull Requests - Design QA

- Source reference: `/Users/razorspoint/.codex/generated_images/019f93ac-ee84-7d63-8a0a-05639751ca36/call_iJghlfbDU1fxrXLG0xTTDUwH.png`
- Implementation screenshot: `public/product-updates/2026-07-24-evidence-links/evidence-links.png`
- Comparison artifact: `/private/tmp/founder-scoreboard-evidence-links-comparison.png`
- Browser: Codex in-app browser
- Viewport: 1440 × 900 CSS pixels at browser default density
- State: seeded local CEO session, task overview read mode, three evidence providers, and open, merged, and closed linked pull requests
- Full-page evidence: task header, overview navigation, evidence section, and surrounding detail-page structure were checked in the live app
- Focused evidence: the final 1440 × 900 capture shows the complete Links and Linked Pull Requests groups together

## Iteration history

1. The first implementation preserved the selected vertical group order and compact bordered rows, but used uppercase subgroup labels and a plural section heading.
2. The subgroup typography was aligned with the reference's quieter title-case treatment, and the section heading was changed to singular.
3. The reference and final implementation were placed in one side-by-side comparison. Provider icons, row rhythm, external-link affordances, group order, and PR status colors matched the selected direction while preserving the current product shell.
4. Browser interaction verified that one filled URL creates exactly one new empty field and that empty intermediate fields do not create additional trailing inputs.

final result: passed

---

# Login Redesign QA

## Evidence

- Source visual truth: `.codex-login-reference.png`
- Normalized source: `.codex-login-reference-normalized.png`
- Browser-rendered implementation: `.codex-login-implementation-svg-2.png`
- Full-view comparison: `.codex-login-comparison-svg.png`
- Focused artwork comparison: `.codex-login-comparison-artwork-svg.png`
- Responsive evidence: `.codex-login-mobile-svg.png`
- State: signed-out login gate
- Route: `/planning`
- CSS viewport: `1440 x 1024`
- Source pixels: `1487 x 1058`, normalized to `1440 x 1024`
- Implementation pixels: `1440 x 1024`
- Device scale factor: `2`; the browser capture is normalized to CSS viewport pixels

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: The implementation preserves the source hierarchy with the existing Inter-based product font, a mint `Founder Planning` label, a strong `Willkommen zurück` heading, and a restrained button label. The lockup and control typography are intentionally slightly tighter than the generated mock to preserve the established brand component and the requested thin login treatment.
- Spacing and layout rhythm: The desktop split matches the source at approximately `34.5% / 65.5%`. The login rail, gray vertical divider, gray horizontal rule, title stack, and CTA alignment match the normalized source. The final rail width is `324px`.
- Colors and visual tokens: The implementation retains the white and pale blue-gray surfaces, slate-gray dividers, mint label, cobalt CTA, and existing FounderOps brand colors. Contrast remains clear without introducing extra panels or shadows.
- Image quality and asset fidelity: The right-side planning network is a native `1600 x 1600` vector asset at `public/assets/planning-login-network.svg`. Its paths, nodes, rings, panels, and dotted structures retain the reference art direction without embedding a raster image. The asset is crop-safe, stays sharp at any display size, and is served unoptimized through `next/image` as recommended for local SVG sources.
- Copy and content: The signed-out surface contains only the approved copy: `Founder Planning`, `Willkommen zurück`, and `Mit GitHub anmelden`. The previous explanatory access notice is absent. Runtime errors remain available when needed.
- Interaction and accessibility: The GitHub button resolves to exactly one enabled control, has a visible focus style, and keeps its existing sign-in behavior. OAuth was not invoked during visual QA because it would leave the local preview and start an external authentication flow.
- Responsiveness: At `390 x 844`, the decorative panel is removed, the login remains centered and readable, and document width remains exactly `390px` with no horizontal overflow.
- Console: No errors or warnings were recorded for the production preview on port `3003`.

## Comparison History

1. Initial browser pass:
   - P2: The signed-out status notice introduced an unnecessary explanatory panel and displaced the CTA.
   - Fix: Removed the benign notice from the login gate while preserving actionable error output.
   - P2: The login rail content was wider and vertically lower than the selected visual target.
   - Fix: Reduced the rail content width to `324px`, tightened the brand-to-title spacing, and adjusted the desktop alignment.
2. Post-fix pass:
   - Full-view and focused rail comparisons show matching hierarchy, dividers, copy, major-region proportions, CTA placement, and artwork treatment.
   - No further P0, P1, or P2 findings.
3. SVG replacement pass:
   - Rebuilt the decorative network as a native square SVG and replaced the generated PNG source.
   - The full-view and focused artwork comparisons confirm the same visual density, central-node hierarchy, mint and cobalt accents, gray connector system, and crop behavior.
   - Desktop natural image dimensions are `1600 x 1600`; mobile keeps the decorative panel hidden. No P0, P1, or P2 differences were introduced.

## Primary Interaction Checks

- Page title: `findmydoc Planning`
- Login CTA count: `1`
- Login CTA enabled: `true`
- Desktop viewport: passed
- Mobile viewport: passed
- Production console check: passed

## Follow-up Polish

- P3: The generated mock exaggerates the brand lockup scale slightly. The implementation keeps the established product lockup more compact to support the requested thin treatment.

## Final Result

final result: passed

## Sidebar and Header Visual Pass — 2026-07-30

### Comparison target

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019fb378-110a-7413-b650-d0512a892d65/exec-e0ed22a5-6ee8-4a46-b8dc-19e954b9b9d9.png` (1487x1058).
- Implementation desktop screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/30/019fb378-110a-7413-b650-d0512a892d65/founderops-sidebar-desktop-final.png` (captured at 1440x1024 CSS viewport).
- Implementation mobile screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/30/019fb378-110a-7413-b650-d0512a892d65/founderops-sidebar-mobile-final.png` (captured at 390x844 CSS viewport).
- Side-by-side comparison: `/Users/razorspoint/.codex/visualizations/2026/07/30/019fb378-110a-7413-b650-d0512a892d65/founderops-sidebar-design-comparison-final.png` (source and implementation normalized to 1429x1016 pixels).

### Findings

- The desktop sidebar now uses the selected fixed-width navigation treatment: 256px expanded, 64px collapsed, explicit chevron control, and no hover-driven resizing.
- The `FounderOps` identifier remains below the `findmydoc` logo as a muted 11px subline with a short teal rule. The former red badge is not rendered in the app sidebar.
- Navigation is grouped as `Work`, `Deliver`, and `People`; the former bottom access card is removed on desktop and mobile.
- The live header preserves its product controls while using a compact, right-aligned action cluster. At desktop width it stays on one row; at mobile width it wraps without horizontal overflow.
- Visual fidelity passes for the requested shell: typography, slate/blue/teal color system, section spacing, logo asset, icon system, and information hierarchy align with the approved target.
- The target's illustrative planning table intentionally differs from the existing live planning board. The task was limited to the navigation shell and header treatment; no board data or workflow was changed.
- No actionable P0, P1, or P2 visual differences remain.

### Runtime checks

- Verified desktop expand and collapse interaction, including 256px and 64px layout alignment.
- Verified collapsed preference persists after reload and restored the expanded state for the delivered preview.
- Verified mobile navigation opens correctly, contains no access card, and has no horizontal page overflow at 390px width.
- Checked browser console errors after the final interaction pass; none were present.

### Comparison history

1. Initial real-data review showed the header action controls wrapping earlier than the visual target.
2. The header was refined with a desktop no-wrap action cluster, bounded action width, and tighter responsive spacing.
3. A final desktop/mobile interaction and visual pass confirmed the corrected layout.

### Final result

final result: passed

## Navigation Information Architecture and Label Refinement — 2026-07-30

### Comparison target

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019fb378-110a-7413-b650-d0512a892d65/exec-e0ed22a5-6ee8-4a46-b8dc-19e954b9b9d9.png` (1487x1058 pixels).
- Desktop implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019fb378-110a-7413-b650-d0512a892d65/navigation-labels/01-desktop-updated-navigation.png` (1269x714 pixels at the browser's default desktop viewport).
- Mobile implementation: `/Users/razorspoint/.codex/visualizations/2026/07/30/019fb378-110a-7413-b650-d0512a892d65/navigation-labels/02-mobile-updated-navigation.png` (379x820 pixels, captured from a 390x844 CSS viewport).
- Full-view comparison: `/Users/razorspoint/.codex/visualizations/2026/07/30/019fb378-110a-7413-b650-d0512a892d65/navigation-labels/03-source-vs-updated-navigation.png` (2538x714 pixels; source normalized to 1269x714 pixels before comparison).
- Focused comparison was not needed: the revised labels and section headings are fully readable in the desktop and mobile full views.

### Findings

- The source visual's navigation treatment remains intact: fixed white sidebar, current-page treatment, icon rhythm, group separation, FounderOps subline, and explicit collapse control.
- Copy intentionally differs from the source to reflect the approved information architecture: `Planung`, `Steuerung`, and `Team & Ressourcen`; `Meilensteine & Initiativen`, `Termine & Erinnerungen`, `Benachrichtigungen`, and `Links & Tools` replace the less specific labels.
- The longer labels remain single-line and legible in the 256px desktop sidebar and in the mobile drawer. No clipping or horizontal overflow was observed.
- No actionable P0, P1, or P2 visual differences remain.

### Runtime checks

- Verified the desktop navigation structure and every updated accessible link label.
- Opened the 390px mobile navigation drawer and verified all three groups and all labels.
- Opened `Meilensteine & Initiativen`; it navigated to `/projects` and rendered the matching page heading.
- Restored the planning preview, reset the temporary viewport override, and checked browser console errors; none were present.

### Comparison history

1. The prior shell pass established the fixed sidebar and the original three visual groups.
2. The information-architecture audit identified that `Deliver` contained planning and resource surfaces rather than delivery work.
3. This pass regrouped and relabeled the visible navigation without changing its interaction or visual system; desktop and mobile captures confirmed the new copy fits.

### Final result

final result: passed
