# Test Rules

- Methods: Freeman and Pryce's Outside-In TDD; Kent Beck's Test Desiderata.
- Keep business logic in `tests/unit/`, presentational UI contracts in colocated Storybook stories, and critical infrastructure-backed paths in `tests/integration/`.
- Unit tests cover business rules without real database, network, filesystem, or application processes.
- Storybook tests cover reusable presentational components, relevant UI states, accessibility, and user interaction in a real browser.
- Integration tests cross public application boundaries and use real local infrastructure. Keep them sparse and limited to critical behavior and security boundaries.
- Test executable behavior and stable contracts. Do not use `AGENTS.md` or `SKILL.md` prose as a product behavior source.
- Use direct tests of observable behavior. Do not assert source text, file layout, removed behavior, pipeline implementation, or script internals.
- Cover unauthenticated, wrong-role, invalid-input, missing-record, empty-state, and external-failure paths when the edited code handles them.
- Use the ordered migration helpers for schema-wide contracts. A focused migration regression test may read the migration it specifically owns.
- Add focused domain test files instead of growing large `platform-*` contract files by default.
- Keep tests deterministic and isolated from production services. Use real UTF-8 for German fixtures.
