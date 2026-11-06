# Manual acceptance checklist

Use these repeatable checks against an identified commit/environment with controlled accounts and disposable planning data. Record results outside the repository. External sends, provider changes, production data changes and Sprint closure require their existing operator authorization. A source merge or successful build is not live acceptance.

## Prerequisites and session lifecycle

- Validate migrations, ordinary tests, lint and build through the supported development/CI procedure. Use `verify:auth` for configured profile/role mappings; it does not prove live Directory membership.
- Confirm the environment's actual legacy/linking/Google mode. Use the configured sign-in action; local development creates the seeded session without contacting a provider.
- Reload, reopen the browser and resume after standby. Protected data must not appear before authorization and a valid reload must not flash an incorrect login gate.
- Check `GET /api/health` for base readiness. It is not an integration or full authorization test.
- Exercise session refresh, local clear, account replacement and normal global logout with suitable test accounts. Delayed responses must not restore old cookies or protected data. Temporary failures must not clear a usable local session.
- Inspect an unmapped account and Viewer/Founder/Deputy/CEO access. Temporary administrator correction must expire and must not grant CEO or Review governance.

See [Authentication flow](auth-flow.md) and [Workspace acceptance/recovery](google-workspace-access.md#acceptance-and-recovery) for linking, epoch, membership-deadline and explicit Bearer checks. Do not use global logout for a shared-backend smoke account with an active production session.

## Planning creation and editing

1. Create each permitted item type using the current hierarchy. Check parentless Initiative/Deliverable proposals, approval parent requirements and mandatory approved Deliverable parent for Sub-Issues.
2. Submit invalid content and simulate a definite server rejection. Keep entered values, visible error/focus and the original creation request ID. Correct and retry.
3. Exercise an unconfirmed creation result. Check the existing operation instead of creating a duplicate. If creation succeeds but approval fails, preserve the created item and explain that partial result.
4. Open the same item from Planning and as a full page. Verify three local tabs, direct children in Overview and type-specific actions. The stored update date and time appear below the title in both views. Child title and "Öffnen" open the same item with keyboard support; free row space remains non-interactive. Sub-Issues are not independent board cards.
5. Save Overview content, a direct status/owner/planning change and multiple Evidence links under the applicable permissions. Cancel Overview and verify that confirmed direct changes remain.
6. Change the item from another test session. Verify revision conflict, preserved draft, current-server comparison and explicit permitted resave. An uncertain save must not be blindly repeated.
7. Navigate, switch tabs, close or reopen full view with a dirty draft. Verify discard/stay behavior and focus restoration.
8. Change Kanban status through direct control and drag/drop where allowed, then reload. In Edge on macOS, verify one native moving card preview and a faded source card. Repeat drags, cancel, leave the board and drop; previews must clear and a successful drop must update the existing item once. Check lock reasons and the authorized completed-item reopen flow.

Use the [Planning Item UI contract](planning-item-ui.md) for exact counts, error placement, unsupported controls, keyboard behavior, scroll ownership and responsive parity. Inspect the relevant repository viewport sizes, focus visibility, modal background lock and absence of page-level horizontal scrolling.

## Comments, blockers, relationships and Review

- Post a comment with an attachment and mention. Once safe recovery capture accepts the text, verify an empty, focused composer at the same viewport position and one ordinary submitted entry below it. Submit another while the first request is unresolved, complete responses out of order and verify stable newest-first submission order. Navigate away and back while both continue.
- Delay GitHub delivery and verify app-storage confirmation completes independently. Lose a response before or after storage, perform an actual same-tab reload and check the authorized submission receipt. Confirm the existing comment without another POST or duplicate side effects. An empty early discussion read or missing receipt must remain unconfirmed.
- Switch tabs, items and detail views with unsent drafts. Each item's draft must return within the session; a full reload must not restore unsent text. Late results must preserve newer writing. Test logout, account replacement, expiry and denied access so protected drafts, recovery capture and stale responses cannot reveal another account's content.
- Simulate browser-storage capture failure. Keep the composer text and show its error without starting a POST.
- Report reason, impact and requested help for a blocker. Keep the report distinct from a `blocked_by` relationship and verify the existing status effect.
- Add/remove an authorized dependency. Check direction, inverse deduplication, neutral duplicate suppression, counts, protected endpoints and local rollback after rejection.
- Request Review with valid Evidence or an explicit allowed exception note. A linked GitHub Issue alone is not Review evidence. Verify owner/reviewer/state restrictions and the content/parent/relationship locks.
- Open unfinished and completed Sub-Issues during Review. With unsaved Review input, verify "Weiter bearbeiten" retains the input and "Änderungen verwerfen" opens the chosen child. Preserve existing editing permissions.
- Exercise acceptance and both rework outcomes. Acceptance finalizes completion/score; rework returns work to `Nacharbeit`. Check withdrawal/reopening and current revision handling. Comments remain available through their independent permission while protected content stays locked.

## Sprint, trash and compatibility

- Set owner commitments and Weekly attendance under self/operational-lead permissions, reload and verify task/Weekly scoring separately.
- Close a disposable Sprint with unfinished blocked work. Inspect carry-over origin, accepted blocker state, score and notification effects. Do not close an active business Sprint as a smoke test.
- Withdraw an eligible Deliverable with a reason, verify its children leave active planning, then inspect permitted restoration and rejection rollback. Direct Deliverable deletion is not an available replacement.
- Delete only an empty Epic with authorized operational-lead access and a current revision. Reject non-empty, stale and unauthorized deletion.
- Check historical Initiative URLs and retired Execution/Review redirects. Legacy Focus storage/API compatibility must not restore visible Execution UI.

## GitHub and Google Chat

- Confirm installation availability separately from the personal author connection. A missing author connection must not block Issue projection.
- Run explicit single/bulk sync on eligible Deliverables/Sub-Issues. Check parent-first processing, explicit creation intent, stable markers, queue/error state and duplicate prevention. Strategic items have no projection.
- Use a Viewer to verify allowed sync/import reads and denied field/comment writes. Deliver authored comments with the original author's connection, even when another actor triggers synchronization. Reconnect and reconcile waiting comments without duplication.
- For separately approved webhook acceptance, verify an authorized structured edit, rejected/locked edit correction, comment refresh, dependency/Sub-Issue change and managed Project field. Inspect durable receipt, final state and Cron recovery under the [webhook contract](github-webhook-intake.md).
- Verify Chat disabled mode, readiness, one controlled digest/DM, missing-DM failure without group fallback, preference opt-out and explicit retry using [Google Chat operations](google-chat-rollout.md). Keep operational messages separate from release publishing.

## Workweek and Decision Log

Check owner-private draft isolation, selected-week/context behavior, stale-context 409, published-only team calendar, range/history completeness and reconnect/refresh/disconnect. Under controlled provider faults, preserve journal-based reconciliation and avoid repeating uncertain mutations. The [credential contract](credential-verification.md) defines owner, permit and provider boundaries.

Decision Log is a mapped-reader Notion view with external source/form/archive links. Check safe unavailable configuration/provider states and reader access. Do not expect an application edit/confirmation action or mutate retired local Decision Log tables.
