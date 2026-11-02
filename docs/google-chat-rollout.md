# Google Chat operations

FounderOps uses Google Chat for filtered operational digests and personal action items. Supabase remains authoritative for notification events, preferences and delivery state. In-app notifications remain the main individual work channel. The separate GitHub Actions release channel sends only release details or deployment summaries.

## Configuration and channels

Runtime configuration:

```text
APP_URL=https://founder-ops.findmydoc.eu
GOOGLE_CHAT_WEBHOOK_URL=
GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=
GOOGLE_CHAT_PRIVATE_KEY=
GOOGLE_CHAT_DELIVERY_ENABLED=false
FOUNDEROPS_DELIVERY_SECRET=
```

The webhook targets the configured FounderOps group space. Personal DMs require the Chat API, the bot service account/key and each recipient's `profiles.google_chat_dm_space` in `spaces/...` format. `profiles.google_chat_user_id`, `profiles.notifications_enabled` and per-event `notification_preferences` retain their existing roles. Never publish webhook URLs, keys or recipient mappings.

Actual sending requires `GOOGLE_CHAT_DELIVERY_ENABLED=true` and credentials appropriate for the selected channel. With delivery disabled, the application still records and displays notifications. Missing DM configuration cannot redirect a private action item into the group webhook.

The bot application name is `FounderOps`. Its public configured endpoint is:

```text
https://founder-ops.findmydoc.eu/api/google-chat/events
```

The receiver is deliberately inert: reachability is not a signed incoming-command protocol. Chat commands, dialogs and generated conversational answers are unsupported. Use the FounderOps name for new configuration; old bot names are not current branding.

## Outbox and selection

Events include assignment/status changes, comments/mentions, blocker reports, Review requests/outcomes and Weekly feedback. They are not all sent individually to Chat.

- `notification_events` stores the domain event and in-app notification.
- `notification_deliveries` stores channel, attempt, result, target and safe failure state.
- `notification_preferences` and profile enablement govern delivery selection.
- Durable delivery claims prevent two workers from independently sending the same accepted event.

Personal action-item types are `task.review_requested`, `task.review_rework`, `task.mention`, `task.blocker_reported` and `task.deadline_overdue`. They use the recipient's DM space. A missing/invalid space records `failed` with `deliveryMode=direct_dm`, with no group fallback. Ordinary `task.comment` remains in-app; targeted mentions create their separate `task.mention` event. General eligible notifications use the group digest rather than becoming private commands.

Digest generation can create reminders for open Reviews, rework, blockers, proposals, due Sprint Reviews and overdue Deliverables. Dedupe binds type, entity, recipient and Berlin calendar day. It does not restore the retired Execution/Focus UI.

## Admission and API operations

`POST /api/notifications/generate-digest` accepts the delivery secret or a CEO/deputy session. `{ "limit": 20, "dryRun": true }` reports candidates/dedupe keys without writing events. A subsequent delivery request processes the outbox; generation does not itself send a message.

`POST /api/notifications/deliver` accepts the delivery secret or an active administrator session. `GET` inspection requires active administrator access. An ordinary operational-lead role alone is not delivery-administration authority. A supplied invalid technical secret cannot fall back to the user session.

```http
POST https://founder-ops.findmydoc.eu/api/notifications/deliver
x-founderops-delivery-secret: <configured delivery secret>
content-type: application/json

{ "limit": 20 }
```

Supported controlled selections include:

- `eventIds`, at most 20 IDs, for explicit pending-event retry; already delivered events are not sent again.
- `testDelivery=webhook_digest` for one controlled group test.
- `testDelivery=direct_dm` with `profileId` for a configured recipient.

Settings provides readiness, delivery mode, target, attempts, failure and retry controls under its current administrator policy. Inspect the result before repeating an uncertain send. Claims, original leases, live target/preference checks and exact finalization are defined in [Credential verification](credential-verification.md#technical-admission-claims-and-exact-completion). No built-in recurring operational delivery is implied; external scheduling is an explicit operating choice.

## Activation and repeatable checks

1. Configure the FounderOps Chat app/API and appropriate service account or group webhook in the approved environment. Establish intended DM spaces privately.
2. Keep delivery disabled and inspect Settings readiness. Create a controlled notification and verify in-app/outbox visibility.
3. Call delivery while disabled and confirm no external message was sent.
4. Enable delivery only for the approved test. Send one group digest or one personal test DM and inspect both the destination and stored delivery result.
5. Test a missing DM space. Expect `failed/direct_dm` and no group message. Correct the recipient mapping and use the explicit retry control.
6. Verify profile/event opt-out and already-delivered deduplication before relying on recurring delivery.

After configuration changes or deployment, repeat the relevant readiness and controlled channel checks. These are operator procedures, not evidence that a production test has already run.

## Separate release channel

`.github/workflows/send-release-google-chat.yml` is an externally dispatched release control plane. It accepts `message_payload_json` and uses the repository-level `GOOGLE_CHAT_WEBHOOK_URL` secret. It must not generate operational notification events or call the digest/delivery endpoints. Its secret and lifecycle are separate from Vercel runtime delivery configuration. Use the repository's release-publish workflow for authorized release communication.

## Rollback

For incorrect destinations, excessive messages or broken configuration, set `GOOGLE_CHAT_DELIVERY_ENABLED=false`, apply the environment change through the supported deployment procedure and verify disabled readiness. Preserve the outbox and delivery history. Inspect failed/uncertain attempts before any later explicit retry. Disabling application delivery does not disable the independent GitHub Actions release publisher.
