# Authentication Flow

This document is the source of truth for the FounderOps web authentication flow. It covers the Supabase session, role authorization, GitHub provider-token handling, and the UI states shown during reloads or reconnects.

## Principles

- Supabase owns the user session and refresh token through SSR-compatible auth cookies.
- `profiles.platform_role` is the application authorization boundary.
- Planning data is never rendered or serialized in strict auth mode until the request has a verified Supabase user and a mapped profile role.
- The GitHub provider token is used only for user-attributed GitHub writes and stays in browser memory.
- The app may store short-lived reconnect metadata in `sessionStorage`, but it must not store Supabase tokens, refresh tokens, GitHub provider tokens, or `Authorization` headers.
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
```

## Supabase GitHub Login

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

## Runtime UI States

```mermaid
stateDiagram-v2
  [*] --> CheckingSession
  CheckingSession --> LoginGate: no Supabase user
  CheckingSession --> AccessDenied: user not mapped or role denied
  CheckingSession --> LoadingPlanningData: user and role accepted
  LoadingPlanningData --> AppReady: planning data loaded
  LoadingPlanningData --> LoadError: API or data load failed
  AppReady --> GitHubAvailable: provider token in memory
  AppReady --> GitHubReconnectNeeded: provider token missing in GitHub context
  GitHubReconnectNeeded --> GitHubReconnectStarted: user clicks central header action
  GitHubReconnectStarted --> GitHubAvailable: provider token returned
  GitHubReconnectStarted --> GitHubReconnectFailed: session returned without provider token
  GitHubReconnectFailed --> GitHubReconnectStarted: user retries from header
  AppReady --> LoggedOut: user signs out
  LoggedOut --> LoginGate
```

## GitHub Provider Token Reconnect

```mermaid
sequenceDiagram
  participant UI as App UI
  participant H as Auth Hook
  participant SS as sessionStorage
  participant SB as Supabase Auth
  participant GH as GitHub API
  participant API as App API

  UI->>H: Open GitHub-dependent context or central header status
  H->>H: Check in-memory provider token
  alt provider token exists
    UI->>API: Send x-github-provider-token for GitHub write
    API->>GH: Write as logged-in user
  else provider token missing
    H->>UI: Keep app session active and show central header status
    UI->>H: User clicks central reconnect action
    H->>SS: Store reconnect metadata only
    H->>SB: Start GitHub OAuth reconnect
    SB-->>H: Session callback
    alt provider token returned
      H->>H: Keep provider token in memory
      H->>SS: Clear reconnect metadata
      UI->>API: Retry user-triggered GitHub action when clicked
    else provider token still missing
      H->>UI: Show centralized header reconnect warning
    end
  end
```

## Scenario Expectations

- Page reload with a valid session: the server verifies the cookie session, loads planning data, and the client shows either the app or a loading shell. It must not flash the login gate.
- Browser closed and reopened: Supabase cookies restore the session when still valid; otherwise the login gate appears without serialized planning data.
- Laptop standby then resume: the proxy and client refresh paths refresh the Supabase session. If only the GitHub provider token is missing, the app remains usable and exposes one central reconnect action for GitHub-backed actions. It must not start OAuth only because a task was opened.
- Expired or revoked Supabase session: the app clears protected client state and returns to the login gate.

## Token Handling

Allowed:

- Supabase SSR auth cookies managed by `@supabase/ssr`.
- In-memory GitHub provider token for the active tab/session.
- Reconnect metadata in `sessionStorage`, limited to user id, reason, return path, and timestamp.

Forbidden:

- Persisting GitHub provider tokens in `localStorage`, `sessionStorage`, IndexedDB, Supabase, logs, or GitHub issues.
- Persisting Supabase access tokens, refresh tokens, or `Authorization` headers outside Supabase auth cookies.
- Adding multiple component-local reconnect buttons across GitHub-dependent cards.
- Starting GitHub OAuth automatically when a user opens a task, settings page, or other GitHub-dependent view.
