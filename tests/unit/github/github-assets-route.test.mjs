import assert from "node:assert/strict";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

let permission = { ok: true };
let fetchToken = "installation-token";
const route = await importTestModule("src/app/api/github-assets/route.ts", {
  "@/lib/authz": {
    requirePlanningContributor: async () => permission,
  },
  "@/lib/github-app": {
    getGitHubAppInstallationToken: async () => fetchToken,
  },
  "@/lib/api-response": {
    apiError: (message, status) => Response.json({ message }, { status }),
    authzError: () => Response.json({ message: "forbidden" }, { status: 403 }),
  },
});

function request(url) {
  return { nextUrl: new URL(`https://app.example/api/github-assets?url=${encodeURIComponent(url)}`) };
}

test("GitHub asset route follows only allowed redirects and does not forward its token", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: new Headers(options.headers).get("authorization"), redirect: options.redirect });
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://objects.githubusercontent.com/assets/42" },
      });
    }
    return new Response("image", { headers: { "content-type": "image/png" } });
  };

  try {
    const response = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "image");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].authorization, "Bearer installation-token");
    assert.equal(calls[0].redirect, "manual");
    assert.equal(calls[1].authorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub asset route rejects unapproved URLs before making an outbound request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };

  try {
    const response = await route.GET(request("https://github.com.evil.test/user-attachments/assets/42"));
    assert.equal(response.status, 400);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub asset route stops when an approved host redirects outside the allowlist", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: new Headers(options.headers).get("authorization") });
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1:8080/admin" },
    });
  };

  try {
    const response = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(response.status, 502);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, "Bearer installation-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub asset route stops after the redirect limit", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let finalRedirectCanceled = false;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(new ReadableStream({
      cancel() {
        if (fetchCalls === 4) finalRedirectCanceled = true;
      },
    }), {
      status: 302,
      headers: { location: "https://objects.githubusercontent.com/assets/42" },
    });
  };

  try {
    const response = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(response.status, 502);
    assert.equal(fetchCalls, 4);
    assert.equal(finalRedirectCanceled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub asset route requires authorization and enforces image responses", async () => {
  const originalFetch = globalThis.fetch;
  permission = { ok: false };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };

  try {
    const denied = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(denied.status, 403);
    assert.equal(fetchCalls, 0);

    permission = { ok: true };
    globalThis.fetch = async () => new Response("not an image", { headers: { "content-type": "text/plain" } });
    const unsupported = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(unsupported.status, 415);
  } finally {
    permission = { ok: true };
    globalThis.fetch = originalFetch;
  }
});

