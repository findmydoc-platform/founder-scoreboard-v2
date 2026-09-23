import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const rpcCalls = [];
let administratorGuardCalls = 0;
let sessionClaim = { claimToken: "claim", eventIds: [] };
let sessionClaimError = null;
let notificationEvents = [];
let notificationEventError = null;

function queryResult(result) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
}

const route = await importTestModule("src/app/api/notifications/deliver/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/api-response": {
    apiError: (error, status) => Response.json({ error }, { status }),
    authzError: (permission) => Response.json({ error: permission.error, ...(permission.code ? { code: permission.code } : {}) }, { status: permission.status }),
    supabaseUnavailable: () => Response.json({ error: "unavailable" }, { status: 501 }),
  },
  "@/lib/authz": {
    bearerToken: () => "session-token",
    requireActiveAdministrator: async () => {
      administratorGuardCalls += 1;
      return { ok: true, profile: { id: "administrator" } };
    },
    resolveAdministratorAccessFailure: async () => ({
      ok: false,
      status: 403,
      code: "administrator_access_expired",
      error: "Der Adminzugang ist abgelaufen.",
    }),
  },
  "@/lib/google-chat": {
    googleChatDeliveryStatus: () => ({ ready: true, webhookConfigured: true, apiConfigured: false }),
    isGoogleChatDmSpace: () => false,
    sendGoogleChatDigest: async () => undefined,
    sendGoogleChatSpaceDigest: async () => undefined,
  },
  "@/lib/notification-policy": {
    shouldSendToGoogleChatDigest: () => false,
    shouldSendToGoogleChatDm: () => false,
  },
  "@/lib/notification-resolution": { reconcileNotificationEvents: async () => undefined },
  "@/lib/supabase": {
    getServerSupabase: () => ({
      rpc: async (name, params) => {
        rpcCalls.push(["pipeline", name, params]);
        if (name === "claim_notification_delivery") {
          return { data: { claimToken: "pipeline-claim", eventIds: [] }, error: null };
        }
        if (name === "finalize_notification_delivery_claim") {
          return { data: params.p_event_ids.length, error: null };
        }
        return { data: 1, error: null };
      },
      from: (table) => {
        if (table === "notification_events") {
          return queryResult({ data: notificationEvents, error: notificationEventError });
        }
        if (table === "notification_deliveries") {
          return queryResult({ data: [], error: null });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    }),
    getSupabaseForToken: () => ({
      rpc: async (name, params) => {
        rpcCalls.push(["session", name, params]);
        return { data: sessionClaim, error: sessionClaimError };
      },
    }),
  },
});

beforeEach(() => {
  rpcCalls.length = 0;
  administratorGuardCalls = 0;
  sessionClaim = { claimToken: "claim", eventIds: [] };
  sessionClaimError = null;
  notificationEvents = [];
  notificationEventError = null;
  process.env.FOUNDEROPS_DELIVERY_SECRET = "delivery-secret";
});

afterEach(() => {
  delete process.env.FOUNDEROPS_DELIVERY_SECRET;
});

test("pipeline secret contract rejects an invalid secret without falling back to session access", async () => {
  const response = await route.POST(new Request("http://localhost/api/notifications/deliver", {
    method: "POST",
    headers: { "x-founderops-delivery-secret": "wrong-secret" },
    body: JSON.stringify({ eventIds: [7], limit: 1 }),
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Ungültiger Delivery-Secret." });
  assert.equal(administratorGuardCalls, 0);
  assert.equal(rpcCalls.length, 0);
});

test("session delivery claims the normalized job atomically and preserves the empty result shape", async () => {
  const response = await route.POST(new Request("http://localhost/api/notifications/deliver", {
    method: "POST",
    body: JSON.stringify({ eventIds: [7, 7, "8", -1], limit: 99 }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sent: 0, failed: 0, skipped: 0, results: [] });
  assert.deepEqual(rpcCalls, [["session", "claim_notification_delivery", {
    p_event_ids: [7, 8],
    p_limit: 50,
    p_test_delivery: null,
    p_recipient_profile_id: null,
  }]]);
});

test("pipeline delivery uses the same atomic claim contract without the administrator guard", async () => {
  const response = await route.POST(new Request("http://localhost/api/notifications/deliver", {
    method: "POST",
    headers: { "x-founderops-delivery-secret": "delivery-secret" },
    body: JSON.stringify({ eventIds: [11], limit: 1 }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sent: 0, failed: 0, skipped: 0, results: [] });
  assert.equal(administratorGuardCalls, 0);
  assert.deepEqual(rpcCalls, [["pipeline", "claim_notification_delivery", {
    p_event_ids: [11],
    p_limit: 1,
    p_test_delivery: null,
    p_recipient_profile_id: null,
  }]]);
});

test("session delivery finalizes every terminally skipped event with its claim token", async () => {
  sessionClaim = { claimToken: "claim-7", eventIds: [7] };
  notificationEvents = [{
    id: 7,
    type: "in_app_only",
    actor_profile_id: null,
    recipient_profile_id: null,
    entity_type: "task",
    entity_id: "task-7",
    title: "In-app event",
    body: null,
    created_at: "2026-09-23T08:00:00.000Z",
  }];

  const response = await route.POST(new Request("http://localhost/api/notifications/deliver", {
    method: "POST",
    body: JSON.stringify({ eventIds: [7] }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    sent: 0,
    failed: 0,
    skipped: 1,
    results: [{ eventId: 7, status: "skipped", error: "Nur In-App-Benachrichtigung." }],
  });
  assert.deepEqual(rpcCalls.at(-1), ["pipeline", "finalize_notification_delivery_claim", {
    p_claim_token: "claim-7",
    p_event_ids: [7],
  }]);
});

test("session delivery releases a claim when event loading fails before delivery", async () => {
  sessionClaim = { claimToken: "claim-9", eventIds: [9] };
  notificationEventError = { message: "read failed" };

  const response = await route.POST(new Request("http://localhost/api/notifications/deliver", {
    method: "POST",
    body: JSON.stringify({ eventIds: [9] }),
  }));

  assert.equal(response.status, 500);
  assert.deepEqual(rpcCalls.at(-1), ["pipeline", "release_notification_delivery_claim", {
    p_claim_token: "claim-9",
  }]);
});

test("session delivery returns the shared expired-access contract when the atomic claim loses authority", async () => {
  sessionClaimError = { code: "42501", message: "active administrator access required" };

  const response = await route.POST(new Request("http://localhost/api/notifications/deliver", {
    method: "POST",
    body: JSON.stringify({ eventIds: [12] }),
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Der Adminzugang ist abgelaufen.",
    code: "administrator_access_expired",
  });
});
