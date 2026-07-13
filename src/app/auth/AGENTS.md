# Auth Entrypoint Rules

- Exchange OAuth authorization codes only on the server.
- Accept post-auth redirects only as validated relative paths. Reject protocol-relative or external redirects.
- Never put access tokens, refresh tokens, provider tokens, or secrets in URLs, browser storage, logs, or rendered error details.
- Treat logout and invalid sessions as security transitions: clear the server session and protected client state before returning to public UI.
- Keep auth error pages generic and preserve enough non-sensitive context for a safe retry.
- Run focused auth tests and `pnpm run verify:auth` after changing callback, session, redirect, or logout behavior.
