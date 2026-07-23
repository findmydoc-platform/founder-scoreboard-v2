# API Boundary Rules

- Declare every accepted caller class and its trust boundary: an explicit session and role guard, a verified external secret or signature, a local-only development gate, or a deliberately public health, OAuth callback, or inert event-receiver contract.
- Use `requireApiContext` or `requireJsonApiContext` with the narrowest existing guard for session-authorized routes. Fail closed when auth or Supabase is unavailable.
- Derive authorization from mapped profiles and `profiles.platform_role`, never from names, email addresses, request payload roles, or UI state.
- Validate and normalize input before database writes or external side effects. Preserve established response shapes and status codes through the shared response helpers.
- Planning-item automation must use `/api/team/planning-items/v1/*`; do not add parallel role-specific import or agent endpoints.
- Keep service-role clients and provider tokens server-side. Never include secrets or authorization headers in logs or responses, and do not expose security-sensitive upstream details in new error paths.
- Make retried external effects idempotent or lock-protected, and persist state transitions before reporting success.
- Add focused tests for unauthenticated access, wrong roles, invalid input, missing dependencies, and relevant external-service failures.
