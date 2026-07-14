# Selected Direction Refinement — Operational Command Strip

Status: confirmed visual direction, temporary design document  
Selected source: first displayed ideation result  
Date anchor: 2026-07-14  
Scope: presentation only; no repository implementation

## Confirmed Direction

Preserve the selected Operational Command Strip composition:

- existing collapsed findmydoc navigation;
- quiet hierarchy line, one dominant title, and compact item actions;
- status, primary owner, priority, target date, and Sub-Issue progress in one facts row;
- dependency information immediately below the facts row;
- visible text-labelled tabs;
- one continuous authored-content surface plus a compact secondary rail.

Do not reinterpret the direction or introduce a relationship canvas, new workflow, new status, or new data field.

## Confirmed Dependency Weighting

The display answers two different questions in this order:

1. **Can this item proceed?** — `Wartet auf` is the primary operational signal.
2. **What is the downstream impact?** — `Andere warten hierauf` is adjacent and quantified, but initially secondary.

Direction alone does not define total business severity. Downstream impact may gain emphasis when several items are affected, but the first scan still answers whether the current item is actionable.

## Refined Dependency Band

Use one grouped dependency band directly below the operational facts. It contains two rows separated by a subtle divider; it is not two unrelated cards.

### Primary row — incoming prerequisite

- Pale amber surface and amber border.
- Slightly taller and visually stronger than the second row.
- Hourglass or incoming-dependency icon with visible text.
- Exact leading copy: `Wartet auf 1`.
- Linked title: `Summit-Investorenstatus aktualisieren`.
- Trailing linked metadata: `Offen · Volkan`.
- The title is the strongest text after the relationship label.
- Do not use `Blockiert` as a standalone label.

### Secondary row — downstream impact

- White or very light slate/blue surface inside the same container.
- Slightly quieter typography; no warning fill unless existing urgency data justifies it.
- Outgoing/branch icon with visible text.
- Exact leading copy: `Andere warten hierauf 2`.
- Show the first affected item: `Pitchdeck-Freigabe vorbereiten`.
- Show compact continuation: `+1 weitere`.
- Do not repeat the current item title or primary owner.

### Combined-state reading

The two rows must scan as one chain without becoming a graph:

`Wartet auf 1` → current item → `Andere warten hierauf 2`

The current item is already established by the page title and must not be rendered again inside the band.

## State Variants

| Existing data state | Display behavior |
|---|---|
| Incoming only | Show only the amber `Wartet auf` row |
| Outgoing only | Show only `Andere warten hierauf`; give it normal operational emphasis without implying the current item is blocked |
| Incoming and outgoing | Show both rows in the shared band; incoming remains primary and outgoing quantifies ripple effect |
| Neither | Omit the entire dependency band |
| Several incoming | Show first existing-order title plus `+N weitere`; do not invent severity ranking |
| Several outgoing | Show first affected title plus `+N weitere` |
| Dependency load error | Show one aggregated inline section error; never claim zero relationships |

## Color and Severity Rules

- Amber means active waiting or operational risk.
- Blue/slate means downstream structure or navigation.
- Red is reserved for an existing critical failure, escalation, or overdue state; normal dependency direction is not an error.
- Color never replaces `Wartet auf` or `Andere warten hierauf` text.
- Do not label the chain `Kritischer Pfad` unless the product actually computes that concept.

## Selected-View Polish

Preserve the selected view while correcting visible ambiguity:

- Keep one title and one owner/status presentation.
- Keep all core tabs visible with a clear active state.
- Keep the two dependency rows above the tabs.
- Keep body content and secondary rail in their selected positions.
- Preserve realistic German copy and real UTF-8 umlauts.
- Avoid typographic artifacts in right-rail labels such as misspelled `Zieltermin`.
- Keep empty GitHub, relationship, and optional-content messages suppressed.
- Do not add a toast to the static frame.

## Visual Acceptance Checks

1. A five-second scan reveals that the current item cannot proceed and that two later items are affected.
2. `Wartet auf` is visibly primary without making `Andere warten hierauf` disappear.
3. Relationship direction is understandable without arrows, icons, or color.
4. Both rows read as one compact dependency group, not two cards.
5. The linked prerequisite exposes title, status, and owner.
6. The downstream impact exposes count, first affected item, and `+N weitere`.
7. The dependency group does not push the text-labelled tabs below the first 1024-pixel viewport.
8. Everything outside the dependency band remains materially faithful to the selected source image.

## Generated Preview

- Refined preview: `/Users/razorspoint/.codex/generated_images/019f603e-092f-7e61-80dc-16362dd518aa/exec-365b6a3a-8fb8-427b-a997-0917db24395d.png`
- Visual review: both directions are visible in one grouped band; incoming waiting remains primary; downstream impact is quantified and adjacent; the selected header, tabs, authored content, and secondary rail remain materially unchanged.
