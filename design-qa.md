# GitHub Panel Design QA

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/exec-f042a384-b941-4afa-9281-4b14764b09b0.png`
- Implementation screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-final.png`
- Problem-state screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-problem-state-final.png`
- Full-view comparison: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-comparison-final.png`
- Focused panel comparison: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-focused-comparison-final.png`
- Viewport: `1488 x 1058`
- State: right-side GitHub panel open, two queued actions, connection info popover open; an additional simulated missing-author connection state was captured.
- Fixture note: the local seed data and connection state were temporarily adapted only for browser capture, then reverted. The captured component code and layout match the final implementation.

## Full-view comparison evidence

The implementation preserves the selected direction: a narrow right-side GitHub surface, one compact header trigger, a compact panel header, semantic green/amber status colors, two lightweight action rows, and one full-width bulk action in the footer. The surrounding application header and workspace remain unchanged.

The implementation intentionally moves the panel title to the top of the drawer and removes the large global-header-height spacer visible in the generated mock. This implements the explicit refinement request to reduce the excessive space above the GitHub content.

## Focused region comparison evidence

The focused comparison confirms that the GitHub mark, title, status dot, status label, info control, action count, row actions, dividers, and footer hierarchy match the visual direction. The implementation uses the existing application typography and token palette instead of reproducing image-generated font artifacts.

## Required fidelity surfaces

- Fonts and typography: Existing application typography is preserved. Title, status, row titles, metadata, and footer action have matching hierarchy, readable line heights, and no clipping in the final captures.
- Spacing and layout rhythm: The panel is `520px` wide with a compact header, consistent `20px` horizontal padding, restrained row spacing, and state-aware clearance below the info popover. No header-height change was made outside the GitHub surface.
- Colors and visual tokens: Existing slate, blue, emerald, amber, and red tokens are used. The backdrop was reduced to two percent opacity to stay close to the bright mock.
- Image quality and asset fidelity: The GitHub mark is a dedicated vector asset reused by the trigger and panel. It remains sharp at both rendered sizes and is not recreated with CSS or text glyphs.
- Copy and content: Healthy state explains both connection layers. Problem states identify the failing layer, explain the impact, and expose the available corrective action. Queue and badge use the same projection, so the displayed count matches the visible rows.

## Comparison history

1. Initial finding `[P2]`: the first implementation dimmed the workspace more strongly than the source. Fix: backdrop opacity reduced from ten percent to two percent. Post-fix evidence: `github-panel-comparison-final.png`.
2. Initial finding `[P2]`: the open info popover could overlap the first queue row, especially in a problem state with explanatory copy and a reconnect action. Fix: the queue heading now reserves state-aware vertical clearance only while the popover is open. Post-fix evidence: `github-panel-final.png` and `github-panel-problem-state-final.png`.

## Findings

No actionable P0, P1, or P2 mismatch remains.

One acceptable P3 difference remains: the mock shows an extra row chevron and repeats a management link inside the healthy info popover. The implementation omits the chevron and keeps `Verbindung verwalten` once in the panel footer to reduce density and avoid duplicate affordances.

## Interaction and browser checks

- Opened the panel through the compact GitHub trigger.
- Opened and closed the connection info popover.
- Verified healthy, missing-author, and missing-installation content.
- Closed the panel through its close control.
- Confirmed the badge count and visible queue rows use the same data projection.
- Checked the browser console: no warnings or errors.
- Verified the page title is `findmydoc Planning`.

## Implementation checklist

- [x] Single compact GitHub trigger across authenticated Supabase workspaces.
- [x] Same trigger on the full task detail route.
- [x] Shared queue projection for header badge and panel rows.
- [x] Compact panel header and footer action.
- [x] Healthy and problem connection explanations with corrective action.
- [x] Keyboard/focus-compatible dialog and popover controls.
- [x] Responsive full-width mobile drawer behavior.

final result: passed
