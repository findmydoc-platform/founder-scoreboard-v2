# Founder Scoreboard Planning Hierarchy

## Canonical structure

```text
Epic
└── Initiative
    └── Deliverable
        └── Sub-Issue
```

`tasks` is the active source for all four item types. `parent_task_id` is the canonical direct-parent relation. Sprint is a time container, never a hierarchy parent.

## Item boundaries

### Epic

An Epic is a strategic goal across multiple Initiatives. It has an owner, optional target date, strategic working status, and no approval, GitHub, Sprint, Review, score, or Evidence workflow.

### Initiative

An Initiative is an outcome brief inside an Epic. It carries target date, priority, owner, strategy (`goal`, success criteria, scope boundaries), and RACI assignments. It has no Sprint, Review, score, Evidence, or GitHub workflow.

An Initiative can be proposed before it has an Epic. Approval requires an Epic, exactly one Accountable, and at least one Responsible. Its working status is independent from its children.

### Deliverable

A Deliverable is executable work under an Initiative. It retains owner, priority, Sprint, work brief, Review, score, Evidence, and GitHub behavior. A Deliverable can be proposed before it has an Initiative, but approval requires an approved Initiative.

### Sub-Issue

A Sub-Issue is one small work step under an approved Deliverable. It may have one owner, optional context, an optional work brief, an optional GitHub repository, and no child items. It does not have its own priority, Sprint, schedule, estimate, workstream, RACI, approval, Review, score, manual Evidence, or quality gate.

Its only working statuses are `Offen`, `In Arbeit`, `Blockiert`, and `Erledigt`. Retained legacy `Review` and `Nacharbeit` values are presented as `In Arbeit` until an explicit valid update normalizes them.

## Approval and parent changes

Epic has no approval. Initiative and Deliverable use `draft`, `proposed`, `approved`, and `rejected`; `draft` is reserved for a return-for-rework state, not initial creation. Sub-Issue has no approval.

Changing an approved Initiative or Deliverable to a different direct parent resets its approval to `proposed` and increments its approval revision. It preserves the item’s work status and children. Parent and child statuses do not automatically change each other.

## UI model

Backlog is a level-aware tree for Epics, Initiatives, and Deliverables. Its chevron opens only direct children; selecting the row opens the common item detail. Sub-Issues appear only in their Deliverable detail. Child counts and progress are direct-child roll-ups.

On a planning card, the direct-child roll-up has its own expander. It opens the same compact, flat child list for Epics → Initiatives, Initiatives → Deliverables, and Deliverables → Sub-Issues. Selecting a child opens that item's detail; deeper levels are not nested into the card.

Kanban displays one selectable level at a time: Epics, Initiatives, or Deliverables. Initiative Kanban has a visible Epic filter; Deliverable Kanban has a visible Initiative filter. The same card and detail framework is used at every applicable level, with type-inapplicable controls hidden.

## GitHub boundary

FounderOps remains the source of truth. GitHub projection is available only for Deliverables and Sub-Issues. Epics and Initiatives have no GitHub sync button, badge, repository field, queue/outbox entry, warning, notification, GitHub comment import, or GitHub attachment.

For a Sub-Issue, the next explicit GitHub sync replaces the native parent relationship after its approved Deliverable parent changes.

## Migration compatibility

Existing Milestones were losslessly migrated to Epics and Packages to Initiatives. Historical URL redirects remain in `planning_item_historical_links`; the legacy hierarchy tables, derived columns, compatibility RPCs, and Team API v1 are removed.
