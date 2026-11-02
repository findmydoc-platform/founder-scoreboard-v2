# findmydoc Planning

Internal findmydoc planning, Review, Sprint scoring and collaboration application. Supabase owns planning state. GitHub receives the Issue projection; authorized edits to existing projected Issues pass through the same FounderOps domain permissions before writeback.

## Local development

```bash
pnpm run local:reset
pnpm run dev:local
```

The reset starts the disposable local Supabase stack, applies tracked migrations, loads `src/lib/seed/source.json` and creates the local CEO Auth identity. The app runs on `http://localhost:3000`. The local sign-in action creates a real cookie session without contacting GitHub. Use the development profile switch to inspect Founder, Deputy and Viewer access. External integrations remain disabled locally.

`local:start`, `local:seed` and `local:stop` manage the same stack. Reset and seed refuse remote database targets. Generated credentials stay in ignored `.env.local` and are not printed. Planning reads Supabase; missing configuration or unavailable core data produces a data-unavailable state, not a browser seed fallback.

## Identity and planning

Application authorization binds the verified Auth user through `profiles.auth_user_id` and `profiles.platform_role`. CEO, Founder, Deputy and Viewer have distinct rights. Temporary administrator access is a separate, expiring capability. The configured Workspace mode selects legacy GitHub login, account linking or enforced Google access; this README does not establish the currently deployed mode.

Normal browser requests use server-owned HttpOnly session cookies. GitHub Issue projection uses installation credentials; authored comments and attachments use encrypted server-side GitHub App user connections with refresh rotation. Raw provider tokens never belong in browser state.

The hierarchy is Epic → Initiative → Deliverable → Sub-Issue. All four types are stored in `tasks`; Sprint is a time container. Deliverables own Review and scoring. The Decision Log reads Notion and links to external sources; the app provides no Decision Log edit/confirmation workflow.

## Documentation

| Topic | Reference |
| --- | --- |
| Domain terms and hierarchy | [Context](CONTEXT.md), [Planning hierarchy](docs/planning-hierarchy.md) |
| Item creation, detail and interaction | [Planning Item UI](docs/planning-item-ui.md), [Task template](docs/task-template-v2.md) |
| Authentication and credential ownership | [Authentication flow](docs/auth-flow.md), [Credential verification](docs/credential-verification.md) |
| Login modes and Workspace operations | [Google Workspace access](docs/google-workspace-access.md) |
| Personal Planning API | [Planning Items API](docs/team-planning-items-api.md) |
| GitHub projection and incoming edits | [Projection architecture](docs/github-sync-architecture.md), [Webhook contract](docs/github-webhook-intake.md) |
| Notification delivery | [Google Chat operations](docs/google-chat-rollout.md) |
| Deployment and diagnostics | [GitHub Actions deployment](docs/vercel-deployment.md), [Runtime logging](docs/logging.md) |
| Repeatable manual checks | [Acceptance checklist](docs/acceptance-checklist.md) |

## Validation and deployment

```bash
pnpm run verify:migrations
pnpm test
pnpm run lint
pnpm run build
```

`pnpm run verify:auth` checks configured Auth/profile mappings and roles; it does not prove live Workspace membership or every provider flow. `GET /api/health` reports basic readiness from configuration and fixed `profiles`/`tasks` probes, without credentials.

Schema changes use timestamp migrations under `supabase/migrations/`. Create one with `pnpm run db:migration:new <clear_name>`. Production applies pending migrations only through the protected GitHub Actions workflow. Deployment, provider cutover and live acceptance follow their documented operator procedures.
