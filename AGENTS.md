<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Founder Scoreboard v2 Rules

- Brand spelling is `findmydoc` in all user-facing copy and documentation. Do not write `FindMyDoc`, `Find My Doc`, or other capitalization variants unless quoting an external source or a technical identifier that already uses another spelling.
- When the user asks to start "Localhost", "den Localhost", or the "Dev-Server" without naming another project, this means the new FounderOps app in this `fmd-planning/` directory. Start this Next.js app, not the legacy static dashboard in `../docs/findmydoc/dashboard-server.mjs`.
- If `3000` or `3001` are already occupied by other projects, use a free app port such as `3002`. Verify the page responds with the title `findmydoc Planning` before reporting the URL.
- Never report the old static dashboard URL `http://localhost:3005` as the FounderOps app unless the user explicitly asks for the old findmydoc Founder Task Dashboard.
- Auth and roles are security boundaries. Any change to GitHub OAuth, `profiles.platform_role`, deputy handling, or API guards must include a focused test or contract check.
- Use `.agents/skills/fmd-planning-security` for changes touching authentication, logout, API guards, Supabase sessions, provider tokens, grants, or RLS policies.
- Use `.agents/skills/fmd-supabase-migrations` for Supabase SQL. Supabase schema changes must be additive by default, stored under `supabase/`, and reflected in `verify:supabase` when they add core tables.
- Codex may apply additive Supabase SQL itself with `npm run apply:sql -- supabase/<file>.sql` when `.env.local` contains credentials. Ask first before any destructive DB action such as drop, truncate, broad delete, disabling RLS, or removing columns.
- Decision Log entries are CEO-editable only. Deputies may operate sprint/task workflows, but must not edit CEO decisions.
- Task Intake, KI-gestützte Aufgabenerstellung und Bulk-Planung sind CEO-only. Do not expose these workflows to Deputy, Accountable, Responsible, Founder, Assignee, or Viewer roles without explicit CEO approval. Any change to Intake, Team-KI access, task role guards, or status permissions must include focused contract tests.
- Agent API access must stay token-guarded and CEO-scoped. Do not expose direct database credentials, Supabase service keys, GitHub provider tokens, OpenAI keys, or in-app AI model calls through FounderOps; changes to Agent API scopes, intake writes, or planning reads must include focused contract tests.
- GitHub Issues are a one-way backup from the app to `findmydoc-platform/management`; do not make GitHub the source of truth without a new plan.
- User-triggered GitHub comments, attachments, and issue updates should use the logged-in GitHub user's Supabase `provider_token` when available. Never persist or log provider tokens.
- Google Chat bot branding is `FounderOps`. The planned public Chat app event endpoint after GitHub Actions deployment and domain cutover is `https://founder-ops.findmydoc.eu/api/google-chat/events`; keep this decision aligned with `docs/google-chat-rollout.md`. Personal Google Chat DMs are not complete until GitHub Actions deployment, `/api/google-chat/events`, and Chat API delivery to `profiles.google_chat_dm_space` are implemented.
- Planning hierarchy is fixed: `Epic / Milestone -> Initiative -> Deliverable -> Sub-Issue`; Sprint is a time container, not a parent level. Keep `docs/planning-hierarchy.md`, Supabase, UI, GitHub sync, and tests aligned.
- Milestone management is a core workflow: keep the `milestones` table, `packages.milestone_id`, task assignment, GitHub mapping, and UI CRUD in sync when expanding this area.
- New deliverables use `docs/task-template-v2.md`: keep Problem Statement, Intended Outcome, Acceptance Criteria, Evidence, and Definition of Done separate.
- Use `.agents/skills/fmd-initiative-planning`, `.agents/skills/fmd-story-writing`, and `.agents/skills/fmd-german-utf8` when creating, reviewing, restructuring, or syncing initiatives, tasks, stories, deliverables, sub-issues, GitHub issue bodies, task templates, or Acceptance Criteria. Do not silently rewrite approved, reviewed, released, or GitHub-synced stories; content changes need explicit approval or a revision/follow-up comment.
- Execution Layer is planned in `docs/execution-layer-plan.md`: Focus Board / Heute-Modus, Aging & Hygiene Alerts, and Decision-to-Task Links should be treated as one coherent feature layer when extending task, sprint, review, or decision workflows.
- Use `.agents/skills/fmd-code-stewardship` for broad cleanup, refactoring, architecture, readability, duplication, maintainability, or "spaghetti code" tasks. Preserve user-visible behavior and run `npm run audit:stewardship` before broad cleanup.
- Use `.agents/skills/fmd-german-utf8` for German UI copy, docs, task text, GitHub issue bodies, Supabase seed/import data, and any persisted German content. German visible text must use real UTF-8 umlauts and be checked before finishing. After writing German task/story text into Supabase or GitHub, run `npm run verify:task-utf8` or an equivalent stored-data scan before reporting completion.
- Use `.agents/skills/fmd-custom-controls` for dropdowns, selects, filters, menus, mini calendars, date pickers, datetime pickers, and compact table controls. Do not add native `<select>`, `<option>`, `input type="date"`, or `input type="datetime-local"` to app UI.
- When actively working on a Founder Scoreboard task from the app as an execution/research task, keep drafts, evidence matrices, private analyses, and working notes outside all Git repositories under `C:\tmp\fmd-private-work\` in a task-specific subfolder. Do not store sensitive founder reviews, personal performance notes, internal conflict analysis, or unfinished report drafts in this repo or GitHub unless explicitly requested. Publish final approved report content to Notion/Gmail/shared tools only after the user asks for that publication step. German-language private reports, Markdown drafts, Notion-ready text, and email drafts must use real UTF-8 German umlauts (`ä`, `ö`, `ü`, `Ä`, `Ö`, `Ü`, `ß`) instead of ASCII fallbacks such as `ae`, `oe`, `ue`, or `ss`, except in technical identifiers, URLs, slugs, or file names.
- After meaningful frontend or API changes run `npm test`, `npm run lint`, and `npm run build`.
- If a pattern is repeated three times across API guards, schema verification, GitHub sync, Decision Log, or Meeting Finder, propose extracting it into a project skill/check before adding more duplication.

### Planning UI Structure

- Planning UI follows feature-first Atomic Design: feature UI belongs under `src/features/<domain>/{atoms,molecules,organisms,templates,hooks,model}`.
- `src/shared` is only for domain-neutral primitives. Components or helpers named around Task, Sprint, Meeting, Decision, Founder, Milestone, GitHub issue, review, or planning workflow semantics must stay inside the owning feature.
- Do not create new `src/components` or `src/hooks` directories. Do not add imports from `@/components`, `@/hooks`, `src/components`, or `src/hooks`; move code into the owning feature or `src/shared` instead.
- Templates and shell components orchestrate layout and pass typed props. Business logic, API calls, mutations, auth/role decisions, and derived data belong in hooks, model/view-model files, API routes, or service helpers.
- The custom-control policy is part of the UI structure contract: do not add native `<select>`, `<option>`, `input type="date"`, or `input type="datetime-local"` to app UI.
