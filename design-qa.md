# GitHub Panel Design QA

- Source visual truth: `/Users/razorspoint/.codex/generated_images/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/exec-f042a384-b941-4afa-9281-4b14764b09b0.png`
- Source interaction evidence: user-provided Microsoft Edge screenshots from 2026-07-16 showing the production panel before and after opening the connection popover.
- Implementation screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-final.png`
- Problem-state screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-problem-state-final.png`
- Local unconfigured screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-local-unconfigured.png`
- Local connection-details screenshot: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-local-connection-details.png`
- Full-view comparison: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-comparison-final.png`
- Focused panel comparison: `/Users/razorspoint/.codex/visualizations/2026/07/16/019f6b0b-05a9-7f10-9a71-ac4fceb0de3f/github-panel-focused-comparison-final.png`
- Viewports: `1488 x 1058` for the selected design comparison and `1280 x 720` for the local unconfigured-state verification.
- State: right-side GitHub panel open. Healthy, missing-author, missing-installation, and local-unconfigured states were captured. The final local capture has the connection popover open.
- Fixture note: the local seed data and connection state were temporarily adapted only for browser capture, then reverted. The captured component code and layout match the final implementation.

## Full-view comparison evidence

The implementation preserves the selected direction: a narrow right-side GitHub surface, one compact header trigger, a compact panel header, semantic green/amber/red status colors, lightweight action rows, and one full-width bulk action in the footer. The surrounding application header and workspace remain unchanged.

The local unconfigured state now keeps the GitHub trigger visible, identifies the missing local GitHub App configuration in red, and explains why both issue sync and the author connection are unavailable. Opening the details popover does not change the queue heading position: the measured top position remains `87px` before and after opening (`0px` delta).

The implementation intentionally moves the panel title to the top of the drawer and removes the large global-header-height spacer visible in the generated mock. This implements the explicit refinement request to reduce the excessive space above the GitHub content.

## Focused region comparison evidence

The focused comparison confirms that the GitHub mark, title, status dot, status label, disclosure chevron, action count, row actions, dividers, and footer hierarchy match the visual direction. The implementation uses the existing application typography and token palette instead of reproducing image-generated font artifacts. The local status details remain readable without pushing the queue content downward.

## Required fidelity surfaces

- Fonts and typography: Existing application typography is preserved. Title, status, row titles, metadata, and footer action have matching hierarchy, readable line heights, and no clipping in the final captures.
- Spacing and layout rhythm: The panel is `520px` wide with a compact header, consistent `20px` horizontal padding, restrained row spacing, and an overlaid connection popover. The queue heading keeps a constant height and position in every popover state. No header-height change was made outside the GitHub surface.
- Colors and visual tokens: Existing slate, blue, emerald, amber, and red tokens are used. The backdrop was reduced to two percent opacity to stay close to the bright mock.
- Image quality and asset fidelity: The GitHub mark is a dedicated vector asset reused by the trigger and panel. It remains sharp at both rendered sizes and is not recreated with CSS or text glyphs.
- Copy and content: Healthy state explains both connection layers. Problem states identify the failing layer, explain the impact, and expose only actions that actually exist. The local state explicitly says that the GitHub App is not configured and does not offer an ineffective OAuth or management action. Queue and badge use the same projection, so the displayed count matches the visible rows.

## Comparison history

1. Initial finding `[P2]`: the first implementation dimmed the workspace more strongly than the source. Fix: backdrop opacity reduced from ten percent to two percent. Post-fix evidence: `github-panel-comparison-final.png`.
2. Initial finding `[P2]`: the open info popover could overlap the first queue row, especially in a problem state with explanatory copy and a reconnect action. Fix: the queue heading now reserves state-aware vertical clearance only while the popover is open. Post-fix evidence: `github-panel-final.png` and `github-panel-problem-state-final.png`.
3. Production finding `[P1]`: that state-aware clearance visibly moved the queue content whenever the connection popover opened. Fix: the popover remains in the header layer while the queue heading uses constant `py-4` spacing. Post-fix evidence: `github-panel-local-unconfigured.png` and `github-panel-local-connection-details.png`; measured heading movement is `0px`.
4. Local-state finding `[P1]`: the GitHub trigger was restricted to authenticated Supabase mode, so local users could not open the panel or see that the GitHub App was unavailable. Fix: the trigger is rendered in every workspace mode, local mode receives an explicit unconfigured state, the full status line opens connection details, and the duplicate `Verbindung verwalten` footer link was removed. Post-fix evidence: both local screenshots above.

## Findings

No actionable P0, P1, or P2 mismatch remains.

One acceptable P3 difference remains: the mock shows an extra row chevron. The implementation omits that secondary navigation affordance because task titles and issue references already provide the relevant destinations.

## Interaction and browser checks

- Opened the panel through the compact GitHub trigger.
- Opened and closed the connection info popover.
- Verified the GitHub trigger remains visible in local seed mode without a configured GitHub App.
- Verified the local panel reports the installation and author connection as unavailable without exposing a dead management action.
- Measured identical queue-heading position before and after opening connection details.
- Verified first Escape closes connection details and the second Escape closes the panel.
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
- [x] Always-visible local trigger with explicit unconfigured status.
- [x] One connection-details disclosure instead of duplicate info and footer controls.
- [x] No panel-content movement when connection details open.
- [x] Responsive full-width mobile drawer behavior.

final result: passed
