# GitHub Automation Rules

- GitHub Actions owns preview and production deployment. Do not introduce local or Vercel Git auto-deploy paths.
- Use the `preview` and `production` GitHub Environments and keep Vercel credentials in the matching environment.
- Never expose Vercel, Supabase, GitHub, Google Chat, or maintenance secrets in workflow output, artifacts, summaries, or pull requests.
- Run production deployment only from `main` through `deploy-production.yml`, automatically on push or explicitly through `workflow_dispatch`. Domain, DNS, project deletion, and migration repair require separate user approval.
- Reuse `.github/scripts` for deployment and maintenance behavior instead of duplicating shell blocks across workflows.
- Use `.agents/skills/release-publish` only for release publication and Google Chat release announcements, not for deployment.
- Run the relevant repository verifier after workflow changes and preserve actionable job summaries.
