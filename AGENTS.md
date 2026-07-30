<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Repository-Wide Rules

- Brand spelling is `findmydoc` in user-facing copy and documentation. Preserve other capitalization only when quoting source text or using an existing technical identifier.
- When the user asks for Localhost or the dev server without naming another project, start this Next.js app. Use a free port such as `3002` when `3000` or `3001` is occupied, and verify the page title is `findmydoc Planning` before reporting the URL.
- Follow the nearest nested `AGENTS.md` for the files being changed. Keep repository-wide rules here and domain-specific rules near their code.
- The only project skills are `.agents/skills/supabase-migrations` and `.agents/skills/release-publish`. Do not add aliases or compatibility copies under `skills/`.
- Repository rules override conflicting generic global Supabase or Vercel skills. Tracked schema changes must use timestamp migrations; deployments must use the repository's GitHub Actions workflows, never a direct local Vercel deployment.
- Auth and roles are security boundaries. Changes to OAuth, sessions, `profiles.platform_role`, deputy handling, API guards, grants, or RLS require focused tests.
- Supabase schema changes are additive by default. Use `.agents/skills/supabase-migrations`, store migrations under `supabase/migrations/`, and ask before drops, truncation, broad deletes, disabling RLS, or removing columns.
- Production migrations run only through the protected deployment workflow. Local resets are allowed only against the disposable local stack.
- Decision Log entries are CEO-editable only. Deputies may operate sprint and task workflows but must not edit CEO decisions.
- Task Intake, AI-assisted task creation, and bulk planning remain CEO-only unless the CEO explicitly approves a broader product scope.
- Never expose database credentials, Supabase service keys, raw GitHub tokens, OpenAI keys, authorization headers, or in-app model access through browser state, logs, API responses, issues, or documentation.
- GitHub Issues are a one-way backup from the app to `findmydoc-platform/management`; do not make GitHub the source of truth without a new approved plan.
- Server-side GitHub sync uses GitHub App installation tokens. User-authored GitHub comments and attachments use encrypted server-side GitHub App user tokens with refresh rotation.
- Google Chat bot branding is `FounderOps`. Keep `https://founder-ops.findmydoc.eu/api/google-chat/events` aligned with `docs/google-chat-rollout.md`.
- Planning hierarchy is `Epic / Milestone -> Initiative -> Deliverable -> Sub-Issue`. Sprint is a time container, not a parent. Keep docs, Supabase, UI, GitHub projection, and tests aligned.
- Keep milestone storage, initiative assignment, GitHub mapping, and UI CRUD aligned when changing milestone behavior.
- New deliverables follow `docs/task-template-v2.md`; keep Problem Statement, Intended Outcome, Acceptance Criteria, Evidence, and Definition of Done separate.
- Execution workspace is retired as visible UI. Keep legacy Focus data compatible, and represent attention as compact Planning or Review signals.
- German visible or persisted text must use real UTF-8 umlauts. Run `pnpm run verify:task-utf8` after writing German task content to Supabase or GitHub.
- Keep private execution drafts and sensitive founder analysis outside Git repositories. Do not publish them to shared systems without an explicit publication request.
- After meaningful frontend or API changes, run `pnpm test`, `pnpm run lint`, and `pnpm run build`.
- Prefer a deterministic helper, test, verifier, or nearest regional rule for repeated patterns. Add a project skill only when `.agents/skills/AGENTS.md` admits it.

## Maintainability Review System

- Read-only maintainability reviewers live under `.codex/agents/`. Before a run, use `pnpm run review:route -- --base origin/main --format json`, state the selected and omitted reviewers with reasons, and obtain explicit user confirmation.
- The main agent selects and starts only relevant specialists in parallel, normally at most three. It deduplicates by underlying cause without inventing or strengthening findings.
- Present every retained finding before proposing or applying fixes. Findings never block handoff or merge automatically; the user decides whether to fix, defer, or reject each one.
- Validate approved fixes deterministically. Do not rerun reviewers by routine; rerun only after an explicitly requested review or a material scope expansion that receives new confirmation.
- Keep router output ephemeral. Do not persist manifests, reviewer transcripts, findings, or local review artifacts in the repository.
- Do not report style-only, metric-only, low-confidence, or pre-existing-debt findings. Do not convert broad SOLID, DRY, Clean Code, YAGNI, coverage, file-length, or clone-count preferences into review rules.
- Keep deterministic architecture and contract invariants in tests or CI. Keep context-dependent judgment in reviewer agents.

## Authorization Parity

- Every database path reachable with user credentials must enforce the same or stricter permissions as the corresponding app action. Match RLS, grants, and RPC execution to the app's real role and ownership checks; if the app exposes no action, the database must not expose one. Authentication alone is not authorization.
- Resolve team membership and platform roles through the authoritative `profiles.auth_user_id = auth.uid()` binding, never from user-controlled metadata, request data, or UI state.
- Treat unclear access as denied. Authorization changes require focused positive and negative coverage for unmapped sessions and the affected role or ownership boundary.

## Product Update Release Contract

- Product updates are reserved for new or materially expanded UI functionality with clear relevance and user benefit. Bug fixes, maintenance changes, copy or visual polish, and minor UI or UX improvements must not create or extend a product update.
- If it is unclear whether a change meets this threshold, ask the user for confirmation before creating or changing product update, screenshot, or tour artifacts, following the same confirmation pattern as reviewer execution.
- Every qualifying production deployment must add or extend an entry in `src/features/product-updates/model/product-updates.json` with at least one current screenshot under `public/product-updates/` and short, non-technical German copy that explains the user benefit.
- Every product update must have its own small, meaningful Driver.js tour in `src/features/product-tours/model/feature-tour-registry.ts`, link it through the update-level `featureTourId`, and keep the gallery action **Lass dich leiten** usable. Do not add a tour that merely repeats the gallery text; guide the user to the changed interaction in as few steps as practical.
- Every product update must set `expiresAt`. Use 30 days after `releasedAt` by default and never more than 60 days. Expired updates must disappear from automatic display and the help menu.
- Purely operational deployments must not invent product news. Run `pnpm run verify:product-updates` before handoff.
