import assert from "node:assert/strict";

import { test } from "vitest";

import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const webhookSecret = "test-webhook-secret";

const expectedInstallationId = "42";

const expectedOrganizationId = "606";

test("the route rejects unsafe transport shapes and maps receipt outcomes", async () => {
  const issueDelivery = { eventName: "issues", deliveryId: "delivery-route" };
  const commentDelivery = { eventName: "issue_comment", deliveryId: "comment-delivery-route" };
  let intakeResult = { kind: "accepted", duplicate: false, delivery: issueDelivery };
  let intakeArguments = null;
  const afterCallbacks = [];
  const processedDeliveryIds = [];
  const supabase = { serviceRole: true };
  const store = { record: async () => "stored" };
  const projectionStore = { projection: true };
  const processedPlanningDeliveryIds = [];
  const route = await loadTranspiledModule("src/app/api/github/webhooks/route.ts", {
    "next/server": {
      after: (callback) => afterCallbacks.push(callback),
      NextResponse: {
        json: (body, init = {}) => ({
          body,
          status: init.status || 200,
          async json() { return body; },
        }),
      },
    },
    "@/lib/github-webhook-intake": {
      acceptGitHubIssueWebhook: async (args) => {
        intakeArguments = args;
        return intakeResult;
      },
      createSupabaseGitHubWebhookDeliveryStore: (client) => {
        assert.equal(client, supabase);
        return store;
      },
      githubWebhookMaxPayloadBytes: 1024,
    },
    "@/lib/github-issue-comment-webhook": {
      createSupabaseGitHubIssueCommentWebhookStore: (client) => {
        assert.equal(client, supabase);
        return projectionStore;
      },
      processGitHubIssueCommentWebhookDelivery: async ({ deliveryId, store: receivedStore }) => {
        assert.equal(receivedStore, projectionStore);
        processedDeliveryIds.push(deliveryId);
      },
    },
    "@/lib/github-planning-webhook": {
      processGitHubPlanningWebhookDelivery: async ({ deliveryId, supabase: receivedSupabase }) => {
        assert.equal(receivedSupabase, supabase);
        processedPlanningDeliveryIds.push(deliveryId);
      },
    },
    "@/lib/supabase-service-role": {
      getServerServiceRoleSupabase: () => supabase,
    },
  });

  const previousSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  const previousInstallation = process.env.GITHUB_APP_INSTALLATION_ID;
  const previousOrganization = process.env.GITHUB_WEBHOOK_ORGANIZATION_ID;
  const request = (body = "{\"ok\":true}", headerOverrides = {}, options = {}) => {
    const rawBody = Buffer.from(body);
    const headers = new Headers({
      "content-type": "application/json",
      "content-length": String(rawBody.byteLength),
      "x-github-delivery": "delivery-route",
      "x-github-event": "issues",
      "x-hub-signature-256": "sha256=" + "a".repeat(64),
    });
    for (const [name, value] of Object.entries(headerOverrides)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }

    const stream = options.streamError
      ? new ReadableStream({
          start(controller) {
            controller.error(new Error("stream failed"));
          },
        })
      : new ReadableStream({
          start(controller) {
            for (const chunk of options.chunks || [rawBody]) controller.enqueue(chunk);
            controller.close();
          },
        });

    return {
      headers,
      body: stream,
    };
  };

  try {
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    let response = await route.POST(request());
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "github_webhook_unavailable");

    process.env.GITHUB_APP_WEBHOOK_SECRET = webhookSecret;
    process.env.GITHUB_APP_INSTALLATION_ID = expectedInstallationId;
    process.env.GITHUB_WEBHOOK_ORGANIZATION_ID = expectedOrganizationId;

    response = await route.POST(request("{\"action\":\"edited\"}"));
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { ok: true, accepted: true });
    assert.equal(Buffer.from(intakeArguments.rawBody).toString("utf8"), "{\"action\":\"edited\"}");
    assert.equal(intakeArguments.store, store);
    assert.equal(intakeArguments.expectedOrganizationId, expectedOrganizationId);
    assert.equal(afterCallbacks.length, 1);
    await afterCallbacks.shift()();
    assert.deepEqual(processedPlanningDeliveryIds, ["delivery-route"]);

    intakeResult = { kind: "accepted", duplicate: true, delivery: commentDelivery };
    response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.equal(response.body.duplicate, true);
    assert.equal(afterCallbacks.length, 1);
    await afterCallbacks.shift()();
    assert.deepEqual(processedDeliveryIds, ["comment-delivery-route"]);

    intakeResult = { kind: "ignored" };
    response = await route.POST(request());
    assert.equal(response.status, 204);

    intakeResult = {
      kind: "rejected",
      status: 401,
      code: "github_webhook_unauthorized",
      message: "GitHub webhook signature is invalid.",
    };
    response = await route.POST(request());
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "github_webhook_unauthorized");

    response = await route.POST(request("{}", { "content-type": "text/plain" }));
    assert.equal(response.status, 415);

    response = await route.POST(request("{}", { "content-type": "text/application/json-evil" }));
    assert.equal(response.status, 415);

    response = await route.POST(request("{}", { "content-length": "1025" }));
    assert.equal(response.status, 413);

    response = await route.POST(request("x".repeat(1025), { "content-length": null }, {
      chunks: [Buffer.alloc(600), Buffer.alloc(425)],
    }));
    assert.equal(response.status, 413);
    assert.equal(response.body.code, "github_webhook_payload_too_large");

    response = await route.POST(request("{}", {}, { streamError: true }));
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "github_webhook_invalid_payload");
  } finally {
    if (previousSecret === undefined) delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    else process.env.GITHUB_APP_WEBHOOK_SECRET = previousSecret;
    if (previousInstallation === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
    else process.env.GITHUB_APP_INSTALLATION_ID = previousInstallation;
    if (previousOrganization === undefined) delete process.env.GITHUB_WEBHOOK_ORGANIZATION_ID;
    else process.env.GITHUB_WEBHOOK_ORGANIZATION_ID = previousOrganization;
  }
});

test("the proxy bypasses Supabase auth only for the exact webhook path", async () => {
  let authFactoryCalls = 0;
  let getUserCalls = 0;
  const webhookResponse = { kind: "webhook-bypass" };
  const authenticatedResponse = { kind: "authenticated" };
  const proxyModule = await loadTranspiledModule("src/proxy.ts", {
    "next/server": {
      NextResponse: {
        next: () => webhookResponse,
      },
    },
    "@/lib/supabase-server": {
      createProxyAuthSupabase: () => {
        authFactoryCalls += 1;
        return {
          supabase: {
            auth: {
              getUser: async () => {
                getUserCalls += 1;
              },
            },
          },
          response: authenticatedResponse,
        };
      },
    },
  });

  assert.equal(
    await proxyModule.proxy({ nextUrl: { pathname: "/api/github/webhooks" } }),
    webhookResponse,
  );
  assert.equal(authFactoryCalls, 0);
  assert.equal(getUserCalls, 0);

  assert.equal(
    await proxyModule.proxy({ nextUrl: { pathname: "/api/github/webhooks/extra" } }),
    authenticatedResponse,
  );
  assert.equal(authFactoryCalls, 1);
  assert.equal(getUserCalls, 1);
});
