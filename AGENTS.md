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

## Database Authorization Contract

- Database access may be equal to or narrower than app authorization, never broader. Before changing a grant, RLS policy, or RPC execution privilege, trace the real caller, server-side app guard, Supabase client/key, allowed platform roles, ownership rule, and mutable fields. Unknown access is denied; do not invent compatibility grants.
- `authenticated` proves only that a Supabase session exists. It does not prove findmydoc team membership or a business role. Team-data policies must not use `TO authenticated` or `auth.uid() IS NOT NULL` as their sole authorization predicate.
- Resolve team membership and platform roles only through the durable `profiles.auth_user_id = auth.uid()` binding. Never authorize from user metadata, names, email addresses, GitHub logins, request payload roles, or UI state.
- Grant direct Data API access only when a verified browser or user-token path requires it. A server route using the service role does not justify `anon` or `authenticated` table privileges. Direct changes to `profiles.role`, `profiles.platform_role`, or `profiles.auth_user_id` remain server-only and transactional.
- Preserve self-service database rights only where the app exposes the same action and the policy enforces the same profile or resource ownership. Viewers remain read-only for business and planning data unless an explicit self-service contract proves otherwise.
- RLS or grant changes require positive and negative coverage for an unmapped authenticated session, each affected platform role, relevant ownership boundaries, and direct Data API access. Update `scripts/lib/database-security.mjs` for durable catalog assertions and run the local Auth integration verifier.
- Roll back authorization changes with a reviewed forward migration. A rollback must not silently restore a known-broad policy or grant; document the exact compatibility reason and the temporary scope.

## Product Update Release Contract

- Product updates are reserved for new or materially expanded UI functionality with clear relevance and user benefit. Bug fixes, maintenance changes, copy or visual polish, and minor UI or UX improvements must not create or extend a product update.
- If it is unclear whether a change meets this threshold, ask the user for confirmation before creating or changing product update, screenshot, or tour artifacts, following the same confirmation pattern as reviewer execution.
- Every qualifying production deployment must add or extend an entry in `src/features/product-updates/model/product-updates.json` with at least one current screenshot under `public/product-updates/` and short, non-technical German copy that explains the user benefit.
- Every product update must have its own small, meaningful Driver.js tour in `src/features/product-tours/model/feature-tour-registry.ts`, link it through the update-level `featureTourId`, and keep the gallery action **Lass dich leiten** usable. Do not add a tour that merely repeats the gallery text; guide the user to the changed interaction in as few steps as practical.
- Every product update must set `expiresAt`. Use 30 days after `releasedAt` by default and never more than 60 days. Expired updates must disappear from automatic display and the help menu.
- Purely operational deployments must not invent product news. Run `pnpm run verify:product-updates` before handoff.
