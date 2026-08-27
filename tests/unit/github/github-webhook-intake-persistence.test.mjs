import assert from "node:assert/strict";

import { createHmac } from "node:crypto";

import { test } from "vitest";

import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const webhookSecret = "test-webhook-secret";

const expectedInstallationId = "42";

const expectedOrganizationId = "606";

const allowedRepositories = new Set([
  "findmydoc-platform/management",
  "findmydoc-platform/website",
  "findmydoc-platform/clinic-dashboard",
]);

const webhook = await loadTranspiledModule("src/lib/github-webhook-intake.ts", {
  "server-only": {},
  "./github-repositories": {
    normalizeGitHubRepository: (value) => allowedRepositories.has(value) ? value : null,
  },
});

function issuePayload(overrides = {}) {
  return {
    action: "edited",
    installation: { id: 42 },
    repository: {
      id: 101,
      full_name: "findmydoc-platform/management",
    },
    issue: {
      id: 202,
      node_id: "I_kwDOExample",
      number: 17,
      title: "Webhook intake",
      body: "Verified payload",
      updated_at: "2026-08-14T12:30:00Z",
    },
    sender: {
      id: 303,
      login: "founder",
    },
    ...overrides,
  };
}

function commentPayload(overrides = {}) {
  return issuePayload({
    action: "created",
    comment: {
      id: 404,
      node_id: "IC_kwDOExample",
      body: "Comment content must not be persisted.",
      updated_at: "2026-08-14T12:31:00Z",
    },
    ...overrides,
  });
}

function signedEnvelope(body, {
  deliveryId = "delivery-123",
  eventName = "issues",
  secret = webhookSecret,
} = {}) {
  const rawBody = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    rawBody,
    headers: {
      deliveryId,
      eventName,
      signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
    },
  };
}

function inspect(body, envelopeOptions = {}, intakeOptions = {}) {
  return webhook.inspectGitHubIssueWebhook({
    ...signedEnvelope(body, envelopeOptions),
    webhookSecret,
    expectedInstallationId,
    expectedOrganizationId,
    ...intakeOptions,
  });
}

test("delivery persistence distinguishes new, replayed, conflicting, and unavailable receipts", async () => {
  const envelope = signedEnvelope(issuePayload());
  const base = {
    ...envelope,
    webhookSecret,
    expectedInstallationId,
    expectedOrganizationId,
  };

  const stored = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => "stored" },
  });
  assert.equal(stored.kind, "accepted");
  assert.equal(stored.duplicate, false);
  assert.equal(stored.delivery.deliveryId, "delivery-123");

  const duplicate = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => "duplicate" },
  });
  assert.equal(duplicate.kind, "accepted");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.delivery.deliveryId, "delivery-123");

  const conflict = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => "conflict" },
  });
  assert.equal(conflict.kind, "rejected");
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "github_webhook_delivery_conflict");

  const unavailable = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => { throw new Error("database unavailable"); } },
  });
  assert.equal(unavailable.kind, "rejected");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.code, "github_webhook_storage_unavailable");
});

function supabaseFixture({ insertError = null, existing = null, expectedTable = "github_planning_webhook_deliveries" } = {}) {
  const state = {
    inserted: null,
    selectedColumns: null,
    selectedDeliveryId: null,
  };
  return {
    state,
    client: {
      from(table) {
        assert.equal(table, expectedTable);
        return {
          async insert(row) {
            state.inserted = row;
            return { error: insertError };
          },
          select(columns) {
            state.selectedColumns = columns;
            return {
              eq(column, value) {
                assert.equal(column, "delivery_id");
                state.selectedDeliveryId = value;
                return {
                  async maybeSingle() {
                    return existing || { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("the Supabase store inserts normalized metadata and reconciles delivery-id races", async () => {
  const accepted = inspect(issuePayload());
  assert.equal(accepted.kind, "accepted");

  const newDelivery = supabaseFixture();
  const newStore = webhook.createSupabaseGitHubWebhookDeliveryStore(newDelivery.client);
  assert.equal(await newStore.record(accepted.delivery), "stored");
  assert.equal(newDelivery.state.inserted.delivery_id, "delivery-123");
  assert.equal(newDelivery.state.inserted.payload_sha256, accepted.delivery.payloadSha256);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "payload"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "title"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "body"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "signature"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "comment_id"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "comment_node_id"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "comment_updated_at"), false);

  const acceptedComment = inspect(commentPayload(), { eventName: "issue_comment" });
  assert.equal(acceptedComment.kind, "accepted");
  const commentDelivery = supabaseFixture({ expectedTable: "github_webhook_deliveries" });
  const commentStore = webhook.createSupabaseGitHubWebhookDeliveryStore(commentDelivery.client);
  assert.equal(await commentStore.record(acceptedComment.delivery), "stored");
  assert.equal(commentDelivery.state.inserted.comment_id, 404);
  assert.equal(commentDelivery.state.inserted.comment_node_id, "IC_kwDOExample");
  assert.equal(commentDelivery.state.inserted.comment_updated_at, "2026-08-14T12:31:00Z");
  assert.equal(Object.hasOwn(commentDelivery.state.inserted, "comment"), false);
  assert.equal(Object.hasOwn(commentDelivery.state.inserted, "comment_body"), false);

  const duplicateDelivery = supabaseFixture({
    insertError: { code: "23505" },
    existing: {
      data: {
        event_name: "issues",
        payload_sha256: accepted.delivery.payloadSha256,
      },
      error: null,
    },
  });
  const duplicateStore = webhook.createSupabaseGitHubWebhookDeliveryStore(duplicateDelivery.client);
  assert.equal(await duplicateStore.record(accepted.delivery), "duplicate");
  assert.equal(duplicateDelivery.state.selectedDeliveryId, "delivery-123");

  const conflictingDelivery = supabaseFixture({
    insertError: { code: "23505" },
    existing: {
      data: { event_name: "issues", payload_sha256: "0".repeat(64) },
      error: null,
    },
  });
  const conflictStore = webhook.createSupabaseGitHubWebhookDeliveryStore(conflictingDelivery.client);
  assert.equal(await conflictStore.record(accepted.delivery), "conflict");

  const failedDelivery = supabaseFixture({ insertError: { code: "08006" } });
  const failedStore = webhook.createSupabaseGitHubWebhookDeliveryStore(failedDelivery.client);
  await assert.rejects(() => failedStore.record(accepted.delivery), /could not be stored/);
});
