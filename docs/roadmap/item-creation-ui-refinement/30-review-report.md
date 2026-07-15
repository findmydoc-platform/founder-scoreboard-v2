# Reviewer Report and Disposition

Date: 2026-07-15
Reviewers: local Design and Accessibility review using Product Design Audit; local Domain and Implementation Feasibility review against the repository

## Summary

No P0 finding was reported. The reviewers identified seven P1, eight P2, and one P3 findings. All findings were accepted. One finding was deliberately bounded: Deliverable Milestone derivation is not introduced in this UI-only iteration because the current system accepts Initiative and Milestone as independent inputs.

## Design and accessibility findings

| ID | Priority | Finding | Disposition |
|---|---:|---|---|
| DA-01 | P1 | Initiative visual columns and semantic order could produce an unstable reading and focus path. | Accepted. DOM, reading, focus, and collapsed order now complete `Ziel & Wirkung` before `Einordnung & Verantwortung`. |
| DA-02 | P1 | The tall Initiative image did not prove the constrained-height scroll correction. | Accepted. A second, low-height scrolled state is required and linked. |
| DA-03 | P1 | Milestone title lacked its required marker. | Accepted. Marker, legend, and implementation semantics are aligned. |
| DA-04 | P2 | Deliverable GitHub creation looked active before direct approval. | Accepted. The whole option is visibly disabled until approval is selected. |
| DA-05 | P2 | Sub-Issue inherited context was cryptic and unlabelled. | Accepted. Initiative, Epic / Milestone, and Verantwortung are labelled explicitly. |
| DA-06 | P2 | Milestone close treatment differed from the shared creation family. | Accepted. The bordered 44-pixel close control is used. |
| DA-07 | P2 | Shared required-field semantics were incomplete. | Accepted. Every surface shows `* Pflichtfeld`; implementation must match native or ARIA required semantics. |
| DA-08 | P3 | Initiative create CTA said `Initiative speichern`. | Accepted. Create mode now says `Initiative erstellen`. |

## Domain and feasibility findings

| ID | Priority | Finding | Disposition |
|---|---:|---|---|
| DF-01 | P1 | Deliverable Milestone derivation was visually proposed but not authorized by the current payload behavior. | Accepted with boundary. Preserve the editable selector; defer automatic derivation or consistency enforcement. |
| DF-02 | P1 | The hidden required `creationRequestId` lifecycle was undocumented. | Accepted. One UUID lives for one open Task form and survives validation/server retries. |
| DF-03 | P1 | Direct Deliverable approval also requires an already approved Initiative. | Accepted. CEO capability and Initiative approval both gate the control, with a disabled reason. |
| DF-04 | P1 | Local/seed Sub-Issue creation does not currently guarantee the same inherited context as Supabase after a parent change. | Accepted. Parent, Initiative, and Milestone must update atomically or share one derivation helper. |
| DF-05 | P2 | The shared failed-submit contract differs from current optimistic Initiative creation. | Accepted as a scoped modal-lifecycle correction. Failed creation keeps the form and draft open; domain creation behavior does not change. |
| DF-06 | P2 | Initiative creation redesign could accidentally remove shared edit-mode metadata and behavior. | Accepted. Edit title, approval metadata, revision, reason, and save behavior are explicitly preserved. |
| DF-07 | P2 | Deliverable image omitted the editable relationship-type control. | Accepted. Existing relationship types remain selectable. |
| DF-08 | P2 | Deliverable image turned free-text `Bereich` into an unsupported select. | Accepted. It remains a free-text input. |

## Remaining evidence gap

Images cannot prove focus trapping, document scroll lock, keyboard scrolling, `inert`, sticky positioning, 200/400-percent reflow, hit areas, server-error focus, UUID retry behavior, or local/Supabase inheritance parity. These remain implementation acceptance checks rather than additional design variants.
