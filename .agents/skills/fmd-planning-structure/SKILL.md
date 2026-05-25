---
name: fmd-planning-structure
description: Use when changing Founder Scoreboard v2 planning hierarchy, task templates, GitHub sync, Supabase migrations, scoring, docs, tests, or UI labels. Enforces Epic / Milestone -> Group Commitment -> Deliverable -> Sub-Issue, with Sprint as a time container.
---

# FMD Planning Structure

## Required hierarchy

Use this model everywhere:

```text
Epic / Milestone
  -> Group Commitment
      -> Deliverable
          -> Sub-Issue
```

Sprint is a time container for Deliverables, not a parent level.

## Rules

- Keep `milestones` as Epic / Milestone.
- Keep `packages` as the database table for Group Commitments until a planned rename migration exists.
- Keep only Deliverables score-relevant.
- Keep Sub-Issues non-score-relevant and scoped under one Deliverable.
- Keep GitHub Issues as one-way backup/export from the app unless a new plan changes source of truth.
- If changing hierarchy, update docs, Supabase migration/verify scripts, UI copy, GitHub sync body, and tests in the same change.
- Use real German UTF-8 umlauts in visible German UI and docs.

## Required checks

Run after meaningful changes:

```bash
npm test
npm run verify:hierarchy
npm run lint
npm run build
```
