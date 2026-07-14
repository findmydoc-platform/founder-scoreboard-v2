# Item UI Refinement — Temporary Product Spec

Status: temporary Product Spec / Roadmap handoff
Initial review baseline: `origin/main@66bf53945c5b999512df09ab6cfd2b2e40414c4d`
Integration baseline: `origin/main@1bbe36f`
Scope: Item-detail presentation for the full-page and modal surfaces

This directory records the approved design direction, implementation contract, and implementation evidence for the Item UI refinement. It is a temporary roadmap artifact, not permanent product documentation and not a replacement for repository rules, domain documentation, tests, or the implemented UI.

## Read Order

1. `100-development-screen-spec.md` — primary, conflict-resolved UI contract.
2. `120-existing-capability-placement.md` — placement and behavior of functionality that already exists.
3. `130-interaction-responsive-accessibility-contract.md` — interaction, responsive, modal, focus, and accessibility requirements.
4. `95-selected-direction-refinement.md` — approved visual weighting and composition.
5. `110-deferred-capability-register.md` — negative scope only; listed capabilities are explicitly excluded from implementation.

The eight files in `development-screens/` are visual references. `implementation-screens/` contains the delivered full-page, modal, mobile, and source-comparison evidence. The repository-root `design-qa.md` records the final visual QA. When sample data, counts, labels, or controls conflict with the normative documents, the normative documents win.

## Boundaries

- Presentation and information hierarchy only.
- Preserve existing data models, workflows, permissions, and planning semantics.
- Do not implement any capability from the deferred register.
- Do not treat mockup-only actions or metadata as existing functionality.
- The current implementation changes only Item-detail presentation and preserves existing behavior through the code and tests referenced by this handoff.
- Deferred capabilities remain future scope and require a separate branch and approved implementation contract.

After implementation is complete and lasting behavior is represented by code, tests, and canonical documentation, this temporary handoff should be archived or removed.
