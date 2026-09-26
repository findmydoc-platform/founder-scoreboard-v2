# Google Workspace access

FounderOps retains Supabase Auth. Google authenticates people; the app-specific Google group admits them; the existing profile binding and platform role authorize their actions. GitHub App and Calendar credentials remain separate encrypted connections.

The approved infrastructure contract is the [Ops handoff](https://github.com/findmydoc-platform/ops/blob/main/.codex/skills/provision-internal-tool-google-auth/references/founderops-google-login-handoff.md). Reuse its existing client, callbacks, group reader and workload identity resources. This application does not provision Google resources.

## Deployment and login modes

`workspace_private.configuration` is the authoritative mode, readable through the server-only `workspace_access_context` RPC. Its initial mode is `legacy`. Users and personal API tokens cannot change it.

- `legacy` keeps the existing GitHub sign-in while deploying compatible application code. Workspace group enforcement is not active yet.
- `linking` opens `/auth/link-google` and offers Google sign-in. Existing users can still sign in with GitHub to link their account. This is a migration stage, not completed Management-only enforcement.
- `google` requires the approved Google identity binding and fresh app-group membership on every protected online authorization decision. It also applies to personal Planning Items API tokens. Entering this mode starts a new session epoch. Prior application sessions cannot access protected data.

Production deployment and each production mode/provider change require separate operator approval. A merge to `main` starts the production workflow, so a reviewable PR must remain unmerged until that approval. Development and Production share the hosted Auth provider described by Ops. A change made for Development can therefore affect Production. Preview must not receive Google credentials, trusted return URLs, linking or sign-in access.

## Provider configuration and identity evidence

The operator needs administrator access to the actual FounderOps Supabase project. The connected account used during implementation did not list that project. Before enabling Google, confirm its Auth version and the identity data emitted by a real code flow. The implementation requires Supabase-validated Google identity data containing `iss`, `sub`, boolean `email_verified` and `custom_claims.hd`. Only `findmydoc.eu` is accepted. Missing claims fail closed. Editable `user_metadata`, a request `hd` hint and an email suffix are never sufficient.

Configure the existing Google client through the approved Keeper-backed credential workflow. Enable manual identity linking. Register only the exact provider callback and application return URLs from the Ops registry. Login requests `openid email profile`, explicitly sets `include_granted_scopes=false`, and requests neither Calendar scopes nor offline access. `APP_URL` must be the production origin, or an approved localhost origin during local development. Server-generated callbacks never derive their origin from an incoming Host header.

Before entering `google`, disable every other Supabase sign-in provider, including GitHub and email/password sign-in. The application checks the provider settings and rejects an OAuth session while another provider remains enabled. Disable anonymous sign-in. Keep the separate GitHub App OAuth integration enabled. No existing GitHub App or Calendar token is rotated or revoked.

## Account linking

Open the linking stage only after the provider configuration has been verified. Each intended Management member signs into their existing FounderOps account, opens the account menu and chooses **Google-Konto verknüpfen**. An unauthenticated user can open `/auth/link-google` and first authenticate with their existing GitHub account.

A server-created, expiring nonce binds the linking attempt to the original Auth user. The callback must return the same user, an existing profile and a valid Google identity with current group membership. Only then is the Google subject recorded in the private binding table. A conflicting subject is rejected. This supports different GitHub and Workspace email addresses without replacing a profile, changing `profiles.auth_user_id`, copying tasks or moving stored tokens. Cancellation does not grant access. Failed linking may leave an identity attached in Supabase, but cannot create an approved application binding; the user can retry from the original account.

Maintain the intended account roster privately. Set `REQUIRED_AUTH_LINKED_PROFILE_IDS` for verification, confirm every intended account has successfully linked and test each account. Do not publish personal mapping inventories in Git. Before disabling GitHub, run `pnpm run verify:auth -- --workspace-ready` to require the complete roster and validate Google bindings while still in linking mode. The normal verifier also checks those bindings in Google mode. Neither check proves live group membership or replaces the individual sign-in checks.

## Authorization and data paths

The server obtains a short-lived Vercel OIDC assertion through `@vercel/oidc`, exchanges it through Google STS and impersonates the existing group-reader service account. Configure the existing `GOOGLE_AUTHORIZED_GROUP`, `GOOGLE_WORKLOAD_IDENTITY_AUDIENCE` and `GOOGLE_WORKSPACE_SERVICE_ACCOUNT`. Cache only the reader access token in process memory. Never cache successful membership decisions between requests. Directory errors, malformed responses and timeouts deny access. Each provider request has a five-second timeout.

Application session guards verify Supabase authentication, the approved Workspace binding and the current group before loading the mapped profile or performing an effect. Roles still come from `profiles.auth_user_id = auth.uid()` and `profiles.platform_role`. A personal Planning Items token checks its owner's binding and current membership as well as the existing token scope and role. Removing that owner from Management therefore denies their next token request.

User-context database clients retain their Supabase user JWT and RLS. After checking identity, membership and the Google-only session epoch, the server creates a random database permit with a ten-second lifetime. It is bound to the verified JWT hash, user, HTTP method and database resource path. The PostgREST pre-request function requires that permit in Google mode. The browser never receives it. There is no generic forwarding endpoint.

Write transactions consume their permit atomically. GET and HEAD transactions are read-only, so the relay releases their permits immediately after receiving the database response; the database expiry remains the failure bound if cleanup is unavailable. Read permits are not a general one-use guarantee while a request is in flight. They remain private to the server. Retrying a failed database operation requires a new authorization decision and permit; the relay never retries mutations automatically.

Restrictive table policies require the admitted request context in addition to the existing policies. Realtime and GraphQL cannot gain direct table access from a user JWT alone. No Realtime browser client is used. The database verifier rejects new authenticated table policies without the Workspace boundary and any Realtime message access policy requiring a separate design. The pre-request hook by itself does not protect Storage or Realtime.

Existing service-only jobs and integration vaults keep their existing narrow guards. GitHub webhooks use signature verification; delivery and maintenance jobs use their existing machine credentials. They do not receive user sessions or arbitrary user-query forwarding. Group membership does not grant CEO, deputy or administrator capabilities.

## Private preview images

`fmd-tool-previews` is private. Uploads remain contributor-only. The application maps old public object references to `/api/tools/preview-image?path=...`; no object or task is deleted. Downloads require a mapped session and, in Google mode, a fresh Workspace authorization decision. The route accepts only the existing preview object path format and streams the object with `private, no-store`. It does not return signed Storage URLs. Direct user Storage access remains denied.

Static application artwork and explicitly external Open Graph images remain public. Previously downloaded files and copies retained outside the application cannot be recalled by changing bucket visibility.

## Calendar and GitHub continuity

Calendar authorization keeps its own state, encrypted tokens and refresh flow. Every request explicitly disables inherited scopes and names its complete operation-specific scopes. Existing tokens with additional granted scopes remain usable. Disconnect first completes the existing Calendar cleanup workflow, then deletes only the local connection and tokens. It does not call Google's project-wide grant revocation endpoint. Google consent remains until the user revokes it separately.

GitHub App installation operations and author-token operations preserve their existing distinction. Losing the author connection does not block unrelated planning, application login or installation-token projection. Connecting GitHub cannot create a FounderOps session.

## Acceptance and recovery

Before cutover, verify the local migration suite, user and token denial cases, direct REST/RPC denial, Storage and Realtime boundaries, account linking with differing email addresses, cancellation, callback restrictions, GitHub refresh and Calendar reconnect/refresh/disconnect. For live acceptance, remove and restore a test member under operator control and confirm that the next protected session and personal-token request is denied. Directory outages must never open access.

Only after the separately approved production deployment, provider configuration and complete account-linking evidence may an authorized database operator change the private mode to `google`. Reauthenticate each intended user after the epoch changes. Stop cutover on any access regression. The product-update entry remains `draft: true` until live acceptance; then set its actual release date and expiry thirty days later and publish it in the approved release.

The default recovery is to keep protected access closed and correct the provider or group-reader failure. Returning to `linking` or `legacy` removes Management enforcement and therefore requires an explicit security decision, not automatic fallback. In an approved rollback, re-enable the previous GitHub provider and return the private mode to `legacy`; preserve the private image route and local-only Calendar disconnect. Keep identity bindings and integration tokens. Re-entering `google` starts a fresh session epoch. Database corrections use forward migrations; never replay the immutable baseline or delete identities to roll back login.
