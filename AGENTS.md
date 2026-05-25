<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Founder Scoreboard v2 Rules

- Auth and roles are security boundaries. Any change to GitHub OAuth, `profiles.platform_role`, deputy handling, or API guards must include a focused test or contract check.
- Supabase schema changes must be additive by default, stored under `supabase/`, and reflected in `verify:supabase` when they add core tables.
- Decision Log entries are CEO-editable only. Deputies may operate sprint/task workflows, but must not edit CEO decisions.
- GitHub Issues are a one-way backup from the app to `findmydoc-platform/management`; do not make GitHub the source of truth without a new plan.
- User-triggered GitHub comments, attachments, and issue updates should use the logged-in GitHub user's Supabase `provider_token` when available. Never persist or log provider tokens.
- Milestone management is a planned core workflow: keep the `milestones` table, task assignment, GitHub mapping, and UI CRUD in sync when expanding this area.
- New deliverables use `docs/task-template-v2.md`: keep Problem Statement, Intended Outcome, Acceptance Criteria, Evidence, and Definition of Done separate.
- German UI copy must use real UTF-8 umlauts.
- After meaningful frontend or API changes run `npm test`, `npm run lint`, and `npm run build`.
- If a pattern is repeated three times across API guards, schema verification, GitHub sync, Decision Log, or Meeting Finder, propose extracting it into a project skill/check before adding more duplication.
