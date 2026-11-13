# Issue tracker

Engineering specs and implementation tickets for this repository live in GitHub Issues in `findmydoc-platform/founder-scoreboard-v2`. Use the `gh` CLI with an explicit `--repo findmydoc-platform/founder-scoreboard-v2` argument.

FounderOps planning remains authoritative in the app. Its existing one-way backup to `findmydoc-platform/management` is unchanged. Engineering issues do not replace or automatically update app planning records.

## Operations

- Create an issue with `gh issue create --repo findmydoc-platform/founder-scoreboard-v2 --title "..." --body-file <file>`.
- Read an issue with `gh issue view <number> --repo findmydoc-platform/founder-scoreboard-v2 --json number,title,body,labels,comments`.
- List issues with `gh issue list --repo findmydoc-platform/founder-scoreboard-v2 --state open --json number,title,body,labels,comments` and the required filters.
- Apply or remove labels with `gh issue edit <number> --repo findmydoc-platform/founder-scoreboard-v2 --add-label "..."` or `--remove-label "..."`.
- Comment with `gh issue comment <number> --repo findmydoc-platform/founder-scoreboard-v2 --body-file <file>`.
- Close with `gh issue close <number> --repo findmydoc-platform/founder-scoreboard-v2`.

Use UTF-8 body files for multiline content. Before creating an issue, check whether an existing issue already represents the same work. Follow the repository's language, content and authorization rules.

## Skill operations

When a skill says to publish to the issue tracker, create or update the relevant GitHub issue. Resolve the triage role requested by the skill against the existing GitHub labels. Query labels with `gh label list --repo findmydoc-platform/founder-scoreboard-v2 --limit 100`. Manage labels in GitHub only; keep no local mapping.

When a skill says to fetch a ticket, read the issue and its relevant comments. GitHub issue numbers and pull request numbers share a namespace; resolve the object type before acting.

## Relationships and wayfinding

Use native GitHub sub-issues and issue dependencies for parent/child and blocking relationships when supported. The `gh-issue-relationships` skill defines the relationship workflow. A body link alone is not a native relationship.

Wayfinder maps use `wayfinder:map`. Child work uses the matching `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task` label. Follow the active Wayfinder workflow for claims, progress and completion.

## Pull requests as a triage surface

**PRs as a request surface: no.**
