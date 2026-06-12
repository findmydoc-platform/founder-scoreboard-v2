---
name: fmd-initiative-planning
description: Use when creating, reviewing, restructuring, or translating FounderOps CEO Initiatives, Initiative briefs, owner-led Deliverables, or Sub-Issue breakdowns. Enforces the Epic / Milestone to Initiative to Deliverable to Sub-Issue hierarchy, keeps Initiatives outcome-focused, and prevents CEO micromanagement by separating CEO direction from owner execution.
---

# FMD Initiative Planning

## Hierarchy

Use this structure:

```text
Epic / Milestone
  -> Initiative
      -> Deliverable
          -> Sub-Issue
```

Sprint is a time container for Deliverables, not a parent level. `packages` is the compatibility database table for Initiatives.

## Initiative Brief

Write Initiatives as CEO or leadership outcome briefs. Include only:

1. `Title`
2. `Epic / Milestone`
3. `Initiative Owner`
4. `Mini-RACI`
5. `Priority`
6. `Goal / Outcome`
7. `Success Criteria`
8. `Target Date`
9. `Scope & Constraints`

The Initiative says what must become true and why it matters. It must not prescribe every operational step, design choice, message variant, or implementation sequence.

## Mini-RACI

Use Mini-RACI only on the Initiative:

- `Accountable`: exactly one profile, responsible for the decision and final accountability.
- `Responsible`: one or more profiles doing or leading the work.
- `Consulted`: profiles actively asked before or during execution.
- `Informed`: profiles kept updated without needing to decide.

Do not add RACI to Sub-Issues. Add separate Deliverable-level responsibility only when a Deliverable truly crosses owners and the Initiative context is insufficient.

## Owner-Led Deliverables

Let the Initiative Owner turn the Initiative into concrete Deliverables. A Deliverable must be specific enough to review and score, and must use the Founder Deliverable Template v2:

1. `Problem Statement`
2. `Intended Outcome`
3. `Scope & Constraints`
4. `Acceptance Criteria`
5. `Evidence Required`
6. `Definition of Done`

Only Deliverables are score-relevant. Initiatives and Sub-Issues are not score-relevant.

## Sub-Issues

Use Sub-Issues only for the assignee's personal work breakdown below one Deliverable. Do not use Sub-Issues to create hidden score expectations or extra CEO control.

## Review Checklist

Before finishing an Initiative or derived Deliverables, verify:

- The Initiative has one clear Owner.
- The Initiative has exactly one Accountable profile.
- Responsible, Consulted, and Informed use real profile IDs or names, not free-form teams.
- The Initiative describes outcome and constraints, not a step-by-step execution plan.
- Success Criteria are observable by the team.
- Deliverables under the Initiative are owner-controllable and reviewable.
- Sub-Issues remain non-score-relevant personal work structure.
- German visible text uses real UTF-8 umlauts.
