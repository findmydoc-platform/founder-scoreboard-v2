---
name: fmd-code-stewardship
description: Use when reviewing, refactoring, simplifying, or improving Founder Scoreboard code quality, architecture, readability, duplication, component structure, API route design, or maintainability without changing user-visible behavior or business logic.
---

# FMD Code Stewardship

## Goal

Improve maintainability through small, behavior-preserving changes. Prefer code that is easier to read, test, and change over broad rewrites.

## Required Workflow

1. Read the relevant files and nearby call sites before proposing edits.
2. Run `npm run audit:stewardship` first when the task is broad, vague, or asks for cleanup, slimming down, architecture, spaghetti-code reduction, or general code quality.
3. Identify the behavior contract before editing: user flow, API response shape, data mutation, auth boundary, Supabase schema expectation, or GitHub sync side effect.
4. Make the smallest coherent improvement that preserves that contract.
5. Avoid mixed-purpose commits: do not combine feature work, visual redesign, schema changes, and cleanup unless the user explicitly asks for that scope.
6. After touching shared UI, API routes, data models, GitHub sync, Supabase interactions, or auth-sensitive paths, run the project checks listed below.
7. Summarize what got simpler and what behavior was intentionally left unchanged.

## Safe Refactoring Rules

- Prefer extraction when a file repeats the same decision, mapping, validation, or render block three or more times.
- Prefer named helpers for business rules over inline boolean expressions that mix roles, status, dates, or hierarchy checks.
- Keep API route response shapes stable unless the user explicitly approves a contract change.
- Keep German visible text as real UTF-8 umlauts.
- Do not remove code only because it is unused by local search if it may be an API contract, migration artifact, seed backup, or operational script.
- Do not rename database columns, Supabase tables, route paths, exported functions, or public component props without checking all call sites and tests.
- Do not "clean up" auth, RLS, provider-token, role, or session code without also using `fmd-planning-security`.
- Do not change native control policy; use `fmd-custom-controls` for selects, filters, menus, calendars, and date pickers.

## Feature-first Atomic Design

- Keep feature UI under `src/features/<domain>/{atoms,molecules,organisms,templates,hooks,model}`. Use `src/shared` only for domain-neutral primitives that make sense without Founder Scoreboard planning vocabulary.
- Create only the subdirectories a feature currently uses. Do not keep empty placeholder directories or commit `.gitkeep` files just to mirror the full Atomic shape.
- Put tiny display-only controls in `atoms`, composed UI sections in `molecules`, workflow-sized sections in `organisms`, and page/workspace shells in `templates`.
- Put local state orchestration, browser state, API calls, mutations, auth/role decisions, and side effects in `hooks`; put pure derived data, status mapping, sorting, filtering, and view-model builders in `model`.
- Do not create compatibility re-export shims from old global paths. Move call sites to the new feature or shared path in the same patch.
- Do not create new `src/components` or `src/hooks` directories, and do not import from `@/components`, `@/hooks`, `src/components`, or `src/hooks`.
- Do not move domain-specific components into `src/shared`: names or props centered on Task, Sprint, Meeting, Decision, Founder, Milestone, GitHub issue, review, or planning workflow semantics belong in a feature.
- Avoid growing large JSX shells with fetch, mutation, auth, role, or view-model logic. Extract behavior into hooks/model first, then split render sections.
- `src/features/planning/hooks/use-planning-app-controller.ts` is a known controller hotspot. Do not enlarge it casually; split it only in a dedicated, separately planned controller refactor.

## Code Smells To Prioritize

- Components that mix data fetching, mutation orchestration, filtering, modal state, and large JSX sections in one file.
- API routes that repeat auth, parsing, validation, Supabase writes, and error mapping.
- Duplicated status, priority, hierarchy, score, GitHub issue, or notification mapping logic.
- Long files where a named subcomponent or helper would reduce cognitive load without changing state ownership.
- Tests that only check happy paths while the edited code handles roles, missing records, empty arrays, or external-service failures.

## Project Checks

Use the narrowest check that covers the edit, then broaden when touching shared behavior.

```bash
npm run audit:stewardship
npm test
npm run lint
npm run build
```

Run domain checks when relevant:

```bash
npm run verify:hierarchy
npm run verify:auth
npm run verify:supabase
npm run verify:github-sync
```
