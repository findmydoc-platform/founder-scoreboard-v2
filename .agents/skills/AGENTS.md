# Project Skill Policy

- Project skills are default-deny. The approved skill directories are `release-publish` and `supabase-migrations`.
- Admit a new project skill only after at least three completed project tasks demonstrate the same workflow.
- Require a unique trigger, a project-specific executable resource or fragile operational sequence, and a measurable benefit over normal repository instructions.
- Reject skills that only restate architecture, UI, copy, planning, authorization, security, or test policy. Put those rules in the nearest `AGENTS.md` and enforce them with code or tests when possible.
- Compare every proposed skill with installed global skills before adding it. Keep one canonical copy and never create a compatibility copy under `skills/`.
- Keep frontmatter to `name` and `description`, match the directory name, and keep the body below 200 lines.
- Run `pnpm test` after changing project skills. Use the official skill validator when its runtime dependencies are available; do not install global dependencies only for validation.
