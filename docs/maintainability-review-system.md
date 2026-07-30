# Maintainability Review System

FounderOps uses five narrow read-only reviewers for evidence-backed maintainability review. The
main agent owns routing, parallel delegation, and deduplication; there is no reviewer orchestrator
and no automatic merge gate.

## Workflow

1. Run `pnpm run review:route -- --base origin/main --format json`.
2. Inspect the complete committed and working-tree surface.
3. State the selected and omitted reviewers with reasons. Normally select at most three.
4. Obtain explicit user confirmation before starting reviewers.
5. Start selected reviewers independently and in parallel.
6. Deduplicate findings by underlying cause and present every retained finding before fixes.
7. Let the user decide whether to fix, defer, or reject each finding.
8. Validate approved fixes deterministically. Do not rerun reviewers by routine.

Router output is temporary stdout. Do not persist manifests, transcripts, findings, or review
artifacts.

## Reviewer map

| Reviewer | Primary question |
| --- | --- |
| `minimal_change_reviewer` | Does the diff add avoidable production or dependency surface with a proven smaller equivalent? |
| `logic_state_reviewer` | Does a changed execution path introduce concrete state, ordering, side-effect, idempotency, or error ambiguity? |
| `module_boundary_reviewer` | Does the diff weaken an established ownership or dependency boundary? |
| `contract_stability_reviewer` | Does a known API, persistence, migration, exported type, or provider contract drift? |
| `test_quality_reviewer` | Can changed behavior regress while the affected tests still pass? |

Specialists report only high- or medium-severity findings with high or medium confidence. Every
finding requires changed code, observed repository evidence, concrete impact, and a minimal safe
alternative. Unresolved consumer or behavior questions require abstention.

## Boundaries

- Do not turn style, metrics, file length, clone counts, coverage, or pre-existing debt into findings.
- Do not run AI reviewers in CI.
- Do not treat findings as automatic implementation authorization.
- Do not retain local reviewer output in the repository.
