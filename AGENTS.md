<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Founder Scoreboard v2 Rules

- Auth and roles are security boundaries. Any change to GitHub OAuth, `profiles.platform_role`, deputy handling, or API guards must include a focused test or contract check.
- Use `.agents/skills/fmd-planning-security` for changes touching authentication, logout, API guards, Supabase sessions, provider tokens, grants, or RLS policies.
- Use `.agents/skills/fmd-supabase-migrations` for Supabase SQL. Supabase schema changes must be additive by default, stored under `supabase/`, and reflected in `verify:supabase` when they add core tables.
- Codex may apply additive Supabase SQL itself with `npm run apply:sql -- supabase/<file>.sql` when `.env.local` contains credentials. Ask first before any destructive DB action such as drop, truncate, broad delete, disabling RLS, or removing columns.
- Decision Log entries are CEO-editable only. Deputies may operate sprint/task workflows, but must not edit CEO decisions.
- GitHub Issues are a one-way backup from the app to `findmydoc-platform/management`; do not make GitHub the source of truth without a new plan.
- User-triggered GitHub comments, attachments, and issue updates should use the logged-in GitHub user's Supabase `provider_token` when available. Never persist or log provider tokens.
- Google Chat bot branding is `FounderOps`. The planned public Chat app event endpoint after Vercel/domain setup is `https://founderops.findmydoc.eu/api/google-chat/events`; keep this decision aligned with `docs/google-chat-rollout.md`. Personal Google Chat DMs are not complete until Vercel/domain setup, `/api/google-chat/events`, and Chat API delivery to `profiles.google_chat_dm_space` are implemented.
- Planning hierarchy is fixed: `Epic / Milestone -> Group Commitment -> Deliverable -> Sub-Issue`; Sprint is a time container, not a parent level. Keep `docs/planning-hierarchy.md`, Supabase, UI, GitHub sync, and tests aligned.
- Milestone management is a core workflow: keep the `milestones` table, `packages.milestone_id`, task assignment, GitHub mapping, and UI CRUD in sync when expanding this area.
- New deliverables use `docs/task-template-v2.md`: keep Problem Statement, Intended Outcome, Acceptance Criteria, Evidence, and Definition of Done separate.
- Execution Layer is planned in `docs/execution-layer-plan.md`: Focus Board / Heute-Modus, Aging & Hygiene Alerts, and Decision-to-Task Links should be treated as one coherent feature layer when extending task, sprint, review, or decision workflows.
- Use `.agents/skills/fmd-code-stewardship` for broad cleanup, refactoring, architecture, readability, duplication, maintainability, or "spaghetti code" tasks. Preserve user-visible behavior and run `npm run audit:stewardship` before broad cleanup.
- Use `.agents/skills/fmd-german-utf8` for German UI copy and docs. German visible text must use real UTF-8 umlauts and be checked before finishing.
- Use `.agents/skills/fmd-custom-controls` for dropdowns, selects, filters, menus, mini calendars, date pickers, datetime pickers, and compact table controls. Do not add native `<select>`, `<option>`, `input type="date"`, or `input type="datetime-local"` to app UI.
- After meaningful frontend or API changes run `npm test`, `npm run lint`, and `npm run build`.
- If a pattern is repeated three times across API guards, schema verification, GitHub sync, Decision Log, or Meeting Finder, propose extracting it into a project skill/check before adding more duplication.
