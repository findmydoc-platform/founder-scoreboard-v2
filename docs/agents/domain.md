# Domain docs

This repository has a single domain context.

## Before exploration

Read the root `GLOSSARY.md` when it exists, then the relevant decisions in `docs/adr/`.

If a root `GLOSSARY-MAP.md` is introduced, follow its pointers to the glossaries and ADRs relevant to the task.

If a glossary or ADR location does not exist, proceed without warning or creating empty files. The `domain-modeling` skill creates domain documentation when a task resolves a term or requires a durable decision.

## Vocabulary and decisions

Use glossary terms for domain concepts in specs, issues, tests and implementation discussions. Preserve established terminology rather than introducing synonyms.

Surface any conflict with a relevant ADR explicitly before proposing a different decision. Distinguish an ADR's document status from the approval status of its individual constraints.

## Layout

- `GLOSSARY.md` contains the shared domain vocabulary.
- `docs/adr/` contains repository-wide architecture decisions.

Keep implementation plans, temporary investigation notes and operator artifacts outside the glossary. Preserve the repository's rules for private material.
