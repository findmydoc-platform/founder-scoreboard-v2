import assert from "node:assert/strict";
import { beforeEach, afterEach, test, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol, route, provider;
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
beforeEach(async () => {
  vi.resetModules();
  protocol = administratorProtocol();
  const authFetch = globalThis.fetch;
  vi.stubEnv("GITHUB_APP_ID", "123"); vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey); vi.stubEnv("GITHUB_APP_PRIVATE_KEY_PATH", "");
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname === "administrator-auth.example.test") return authFetch(request);
    if (url.hostname === "api.github.com") return providerFetch();
    return provider(request.url, { method: request.method, headers: request.headers, redirect: request.redirect });
  });
  route = await importTestModule("src/app/api/github-assets/route.ts", { "server-only": {} });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const providerFetch = () => Response.json({ token: "installation-token", expires_at: new Date(Date.now() + 3600000).toISOString() });
function request(url) { return protocol.request(`/api/github-assets?url=${encodeURIComponent(url)}`); }

test("GitHub asset route follows only allowed redirects and does not forward its token", async () => {
  const calls = [];
  provider = async (url, options) => {
    if (String(url).startsWith("https://api.github.com/")) return providerFetch();
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
    provider = undefined;
  }
});

test("GitHub asset route rejects unapproved URLs before making an outbound request", async () => {
  let fetchCalls = 0;
  provider = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };

  try {
    const response = await route.GET(request("https://github.com.evil.test/user-attachments/assets/42"));
    assert.equal(response.status, 400);
    assert.equal(fetchCalls, 0);
  } finally {
    provider = undefined;
  }
});

test("GitHub asset route rejects paths that escape the attachment endpoint", async () => {
  let fetchCalls = 0;
  provider = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };

  try {
    const response = await route.GET(request("https://github.com/user-attachments/assets/../../../settings"));
    assert.equal(response.status, 400);
    assert.equal(fetchCalls, 0);
  } finally {
    provider = undefined;
  }
});

test("GitHub asset route stops when an approved host redirects outside the allowlist", async () => {
  const calls = [];
  provider = async (url, options) => {
    if (String(url).startsWith("https://api.github.com/")) return providerFetch();
    calls.push({ url: String(url), authorization: new Headers(options.headers).get("authorization") });
    return new Response(null, {
      status: 302,
      headers: { location: "https://blocked.example.test/admin" },
    });
  };

  try {
    const response = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(response.status, 502);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, "Bearer installation-token");
  } finally {
    provider = undefined;
  }
});

test("GitHub asset route stops after the redirect limit", async () => {
  let fetchCalls = 0;
  let finalRedirectCanceled = false;
  provider = async () => {
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
    provider = undefined;
  }
});

test("GitHub asset route requires authorization and enforces image responses", async () => {
  protocol.state.profile = false;
  let fetchCalls = 0;
  provider = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };

  try {
    const denied = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(denied.status, 403);
    assert.equal(fetchCalls, 0);

    protocol.state.profile = true;
    provider = async () => new Response("not an image", { headers: { "content-type": "text/plain" } });
    const unsupported = await route.GET(request("https://github.com/user-attachments/assets/42"));
    assert.equal(unsupported.status, 415);
  } finally {
    protocol.state.profile = true;
    provider = undefined;
  }
});

