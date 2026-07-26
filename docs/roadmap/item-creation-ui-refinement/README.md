# Item Creation UI Refinement

This folder contains the working Product Spec and visual references for the Item creation-form redesign.

The material is historical roadmap and implementation-planning input. Its Sub-Issue form specification and mockup were superseded by the simple-work-step model documented in [`docs/planning-hierarchy.md`](../../planning-hierarchy.md) and [`docs/task-template-v2.md`](../../task-template-v2.md). Do not use the older Sub-Issue form as the current product contract. The Deliverable, Initiative, and Milestone references remain historical QA material and are not rewritten retroactively.

## Current iteration

- Status: implemented, reviewed, and visually verified
- Scope: creation forms only
- Surfaces: Deliverable, Sub-Issue, Initiative, Epic / Milestone
- Out of scope: new capabilities, persistence changes, workflow changes, bug fixes outside these forms

## Documents

- [Initial Product Spec](./10-initial-product-spec.md)
- [Visual QA Log](./20-visual-qa-log.md)
- [Reviewer Report and Disposition](./30-review-report.md)

## Mockups

The accepted mockups live in [`mockups/`](./mockups/). Generated raster screens are visual references; the written Product Spec is authoritative when an image contains contradictory labels, validation markers, or state.

- [New Deliverable](./mockups/01-new-deliverable.png)
- [New Sub-Issue](./mockups/02-new-sub-issue.png)
- [New Initiative — constrained viewport](./mockups/03-new-initiative-constrained.png)
- [New Initiative — constrained viewport, scrolled](./mockups/03b-new-initiative-constrained-scrolled.png)
- [New Epic / Milestone](./mockups/04-new-milestone.png)

## Implementation evidence

Browser-rendered implementation screenshots live in [`implementation-screens/`](./implementation-screens/). The repository-level final implementation audit is recorded in [`design-qa.md`](../../../design-qa.md).
