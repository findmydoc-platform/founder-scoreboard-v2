# Test Rules

- Test executable behavior and stable contracts. Do not use `AGENTS.md` or `SKILL.md` prose as a product behavior source.
- Prefer direct unit tests of pure functions and focused route or policy tests over broad source-text assertions.
- Use source-text assertions only when runtime execution is impractical and the assertion protects a stable boundary rather than exact implementation wording.
- Cover unauthenticated, wrong-role, invalid-input, missing-record, empty-state, and external-failure paths when the edited code handles them.
- Use the ordered migration helpers for schema-wide contracts. A focused migration regression test may read the migration it specifically owns.
- Add focused domain test files instead of growing large `platform-*` contract files by default.
- Keep tests deterministic and isolated from production services. Use real UTF-8 for German fixtures.
