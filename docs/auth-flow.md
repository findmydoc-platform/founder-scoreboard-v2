# Authentication Flow

This document is the source of truth for the FounderOps web authentication flow. It covers the Supabase session, role authorization, reload-stable GitHub App connections, and the UI states shown during reconnects.

## Principles

- Supabase owns the user session and refresh token through SSR-compatible auth cookies.
- `profiles.platform_role` is the application authorization boundary.
- Planning data is never rendered or serialized in strict auth mode until the request has a verified Supabase user and a mapped profile role.
- GitHub issue sync, dependencies, GitHub comment import, private asset proxying, and issue archival use server-side GitHub App installation tokens.
- User-authored GitHub comments and attachments use the original author's encrypted server-side GitHub App user token with refresh rotation.
- Every valid mapped team session, including viewers, may trigger issue sync. Task mutations and comment creation keep their stricter role rules.
- Issue projection status and comment delivery status are independent. A missing author connection never turns a successful issue sync into a failure.
- GitHub App user tokens are never exposed to the browser, logs, GitHub issues, API responses, or documentation.
- GitHub reconnect UI is centralized in the header/notification area. GitHub-dependent cards may show disabled actions, but they must not repeat their own reconnect button or start OAuth automatically.

## Production Boot

```mermaid
flowchart TD
  A["Browser requests page"] --> B["Next proxy refreshes Supabase auth cookies"]
  B --> C["Server component reads Supabase cookies"]
  C --> D{"Valid Supabase user?"}
  D -- "No" --> E["Render login gate without planning data"]
  D -- "Yes" --> F["Map user through profiles.auth_user_id or profiles.github_login"]
  F --> G{"Allowed platform_role?"}
  G -- "No" --> H["Render access error without planning data"]
  G -- "Yes" --> I["Load planning data on the server"]
  I --> J["Render app with initial data and current profile"]
  J --> K["Client hook adopts SSR auth state"]
  K --> L["Client checks /api/github-app/status with Supabase bearer token"]
```

## Supabase GitHub Login

Supabase GitHub login is only the application login path. It restores the FounderOps session after reloads and maps the user to a team profile. It is not used as the GitHub API credential for FounderOps GitHub operations.

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Browser UI
  participant SB as Supabase Auth
  participant GH as GitHub OAuth
  participant CB as /auth/callback
  participant APP as FounderOps App

  U->>UI: Click "Mit GitHub anmelden"
  UI->>SB: signInWithOAuth(provider=github, scopes=repo read:user user:email)
  SB->>GH: Redirect to GitHub OAuth
  GH->>SB: OAuth code
  SB->>CB: Redirect with code and next path
  CB->>SB: exchangeCodeForSession(code)
  SB-->>CB: Set Supabase auth cookies
  CB->>APP: Redirect to safe relative next path
  APP->>APP: Verify session and role before loading data
```

## GitHub App Connect: Author Connection

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Browser UI
  participant APP as /api/github-app/connect
  participant GH as GitHub App OAuth
  participant CB as /api/github-app/callback
  participant DB as Supabase service role

  U->>UI: Click central GitHub App connect action
  UI->>APP: GET /api/github-app/connect?next=...
  APP->>APP: Verify Supabase cookie session and team profile
  APP->>APP: Create signed short-lived state
  APP-->>GH: Redirect to GitHub App user authorization
  GH-->>CB: Redirect with code and state
  CB->>CB: Validate state and current Supabase session
  CB->>GH: Exchange code for GitHub App user token
  CB->>GH: Read /user login
  CB->>CB: Require login to match profiles.github_login
  CB->>DB: Store encrypted access and refresh tokens
  CB->>DB: Retry pending comments for this original author
  CB-->>UI: Redirect to safe relative next path
```

## Runtime UI States

```mermaid
stateDiagram-v2
  [*] --> CheckingSession
  CheckingSession --> LoginGate: no Supabase user
  CheckingSession --> AccessDenied: user not mapped or role denied
  CheckingSession --> LoadingPlanningData: user and role accepted
  LoadingPlanningData --> AppReady: planning data loaded
  LoadingPlanningData --> LoadError: API or data load failed
  AppReady --> GitHubAppConnected: /api/github-app/status connected
  AppReady --> GitHubAppReconnectNeeded: no saved token, revoked token, login mismatch, or refresh failed
  GitHubAppReconnectNeeded --> GitHubAppConnectStarted: user clicks central header action
  GitHubAppConnectStarted --> GitHubAppConnected: callback stores encrypted token
  GitHubAppConnectStarted --> GitHubAppReconnectNeeded: callback fails or user cancels
  AppReady --> LoggedOut: user signs out
  LoggedOut --> LoginGate
```

## GitHub API Credential Rules

```mermaid
sequenceDiagram
  participant UI as App UI
  participant API as App API
  participant VAULT as GitHub App token vault
  participant GH as GitHub API

  UI->>API: Sync issue, import comments, archive issue, or load private GitHub asset
  API->>GH: Use short-lived GitHub App installation token
  GH-->>API: Result
  API-->>UI: Return non-secret response

  UI->>API: Create local comment
  API->>API: Atomically create comment and delivery outbox row
  API->>VAULT: Load encrypted user token for original author profile
  alt author connection is missing or invalid
    API->>API: Keep waiting_for_author_connection
    API-->>UI: HTTP 200 with informational notice
  else author connection is valid
    API->>GH: Search issue comments for durable marker
    API->>GH: Post only when no marker or exact legacy match exists
    API->>API: Mark delivery as delivered
  end

  UI->>API: Upload attachment
  API->>VAULT: Load encrypted user token for current uploader profile
  alt access token expires soon
    VAULT->>GH: Refresh GitHub App user token
    VAULT->>VAULT: Store encrypted rotated tokens
  end
  API->>GH: Write user-authored content with GitHub App user token
  GH-->>API: Result
  API-->>UI: Return non-secret response
```

## Scenario Expectations

- Page reload with a valid session: the server verifies the cookie session, loads planning data, and the client checks `/api/github-app/status`. It must not flash the login gate.
- Browser closed and reopened: Supabase cookies restore the app session when still valid; the saved encrypted GitHub App user token keeps GitHub comments and attachments usable without another manual reconnect.
- Laptop standby then resume: the proxy and client refresh paths refresh the Supabase session. `/api/github-app/status` refreshes a soon-expiring GitHub App user access token when possible.
- Missing, revoked, expired, or mismatched GitHub App user connection: issue sync remains available. A locally saved comment waits for its original author's connection and is retried after OAuth reconnect or a later task/bulk sync. It must not start OAuth only because a task was opened.
- Expired or revoked Supabase session: the app clears protected client state and returns to the login gate.

## Token Handling

Allowed:

- Supabase SSR auth cookies managed by `@supabase/ssr`.
- Process-memory GitHub App installation token cache.
- Encrypted GitHub App user access and refresh tokens in `github_app_user_tokens`, readable only through service-role server code.

Forbidden:

- Sending raw GitHub tokens to the browser or accepting `x-github-provider-token` request headers.
- Persisting raw GitHub tokens in `localStorage`, `sessionStorage`, IndexedDB, logs, GitHub issues, API responses, or documentation.
- Persisting Supabase access tokens, refresh tokens, or `Authorization` headers outside Supabase auth cookies.
- Adding multiple component-local reconnect buttons across GitHub-dependent cards.
- Starting GitHub OAuth automatically when a user opens a task, settings page, or other GitHub-dependent view.
