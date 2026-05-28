---
name: fmd-story-writing
description: Use when creating, reviewing, restructuring, or syncing Founder Scoreboard tasks, stories, deliverables, sub-issues, GitHub issue bodies, task templates, or story acceptance criteria. Enforces FMD Template v2, protects approved or synced stories from silent content rewrites, separates problem statements from implementation details, and keeps acceptance criteria measurable and owner-controllable.
---

# FMD Story Writing

## Goal

Create clear Founder Scoreboard stories that describe real problems, define useful outcomes, and remain fair to review. Do not silently rewrite already approved or synced stories.

## Story Protection

Classify the story before editing:

- **New or draft story**: improve wording, structure, clarity, and completeness freely within Template v2.
- **Approved, released, reviewed, or GitHub-synced story**: preserve meaning. Only fix formatting, typos, broken structure, or obvious encoding issues.
- **Content change to protected story**: require explicit user approval. Prefer a comment, revision note, or follow-up story instead of overwriting Acceptance Criteria or the target outcome.

Never change Acceptance Criteria, score-relevant expectations, owner responsibility, or intended outcome of a protected story without making that change explicit.

## Template v2

Use this structure for score-relevant Deliverables:

1. `Problem Statement`
2. `Intended Outcome`
3. `Scope & Constraints`
4. `Acceptance Criteria`
5. `Evidence Required`
6. `Definition of Done`

Keep the planning hierarchy aligned with `fmd-planning-structure`: Epic / Milestone -> Group Commitment -> Deliverable -> Sub-Issue. Sprint is a time container.

## Writing Rules

### Problem Statement

Describe:

- current state,
- concrete problem or pain point,
- why the problem matters now.

Do not describe the solution, implementation steps, UI layout, database changes, or what the assignee should build.

### Intended Outcome

Describe the finished state in plain business language. The outcome should make it clear why the task can be considered useful when done.

### Scope & Constraints

Put hard requirements here when they are real constraints, especially:

- legal, compliance, privacy, security, brand, or medical-claims rules,
- external API or platform limitations,
- mandatory integration boundaries,
- explicit non-goals.

Implementation suggestions may go here only when they are binding constraints. Otherwise move them to a comment or implementation note.

### Acceptance Criteria

Write criteria that are:

- objective and testable,
- specific to this story,
- controlled by the owner,
- phrased as completed-state facts.

Avoid criteria that depend mostly on external reactions, such as an investor replying positively. Prefer criteria such as clean research, sent outreach, tracked follow-up status, or documented blocker.

### Evidence Required

State the expected proof: GitHub issue/PR, Notion link, Drive link, screenshot, CSV, CRM view, decision entry, or comment.

### Definition of Done

Keep DoD separate from Acceptance Criteria. DoD is a general quality standard or a saved snapshot of central standards, not a second issue-specific checklist.

Write DoD as multiple short checklist lines when there is more than one condition. Do not bundle several conditions into one paragraph.

Do not put template-compliance meta work into a story DoD. For example, `Template v2 is complete`, `task is assigned to the current sprint`, or `owner is set` are creation-quality checks for the agent, not completion criteria for the assignee.

Good DoD items describe the expected quality bar of the finished work, such as:

- The result is documented in a place the team can access.
- Open blockers, access gaps, or follow-up decisions are explicitly recorded.
- The result can be reviewed by the intended reviewer without needing hidden context.

## Review Checklist

Before finishing a new or revised story, verify:

- Problem Statement contains current state, pain point, and motivation.
- Problem Statement contains no direct solution or implementation instruction.
- Hard constraints are in Scope & Constraints.
- Acceptance Criteria are measurable and owner-controllable.
- DoD is written as separate checklist lines when it contains multiple conditions.
- DoD contains no template-compliance or assignment metadata.
- DoD is not mixed with Acceptance Criteria.
- Protected stories were not silently rewritten.
- German visible text uses real UTF-8 umlauts.

For examples, read `references/examples.md` when writing or reviewing a complex story.
