import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const githubHttp = await loadTranspiledModule("src/lib/github-http.ts");

async function withFetch(fetchImplementation, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GitHub reads retry one transient response and preserve the read contract", async () => {
  let calls = 0;
  const body = await withFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "temporary" }), {
        status: 503,
        headers: { "retry-after": "0" },
      });
    }
    return new Response(JSON.stringify({ login: "founder" }), { status: 200 });
  }, () => githubHttp.githubJson("https://api.github.com/user", {
    token: "installation-token",
    errorMessage: "GitHub user failed",
  }));

  assert.deepEqual(body, { login: "founder" });
  assert.equal(calls, 2);
});

test("GitHub reads retry one network failure", async () => {
  let calls = 0;
  const body = await withFetch(async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket closed");
    return new Response(JSON.stringify({ login: "founder" }), { status: 200 });
  }, () => githubHttp.githubJson("https://api.github.com/user", {
    token: "installation-token",
    errorMessage: "GitHub user failed",
  }));

  assert.deepEqual(body, { login: "founder" });
  assert.equal(calls, 2);
});

test("GraphQL POST queries are retryable reads", async () => {
  let calls = 0;
  const body = await withFetch(async (_url, init) => {
    calls += 1;
    assert.equal(init.method, "POST");
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "temporary" }), {
        status: 502,
        headers: { "retry-after": "0" },
      });
    }
    return new Response(JSON.stringify({ data: { viewer: { login: "founder" } } }), { status: 200 });
  }, () => githubHttp.githubJson("https://api.github.com/graphql", {
    token: "installation-token",
    method: "POST",
    operation: "read",
    body: { query: "query { viewer { login } }" },
    errorMessage: "GitHub query failed",
  }));

  assert.equal(body.data.viewer.login, "founder");
  assert.equal(calls, 2);
});

test("GitHub mutations never retry and expose safe retry metadata", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "temporary mutation failure" }), {
      status: 503,
      headers: {
        "retry-after": "0",
        "x-github-request-id": "request-123",
        "x-ratelimit-remaining": "17",
        "x-ratelimit-reset": "1893456000",
      },
    });
  }, async () => {
    await assert.rejects(
      () => githubHttp.githubJson("https://api.github.com/repos/org/repo/issues", {
        token: "secret-installation-token",
        method: "POST",
        operation: "mutation",
        body: { title: "secret request body" },
        errorMessage: "GitHub mutation failed",
      }),
      (error) => {
        assert.equal(error instanceof githubHttp.GitHubApiError, true);
        assert.equal(error.status, 503);
        assert.equal(error.method, "POST");
        assert.equal(error.requestId, "request-123");
        assert.equal(error.retryAfterSeconds, 0);
        assert.equal(error.rateLimitRemaining, 17);
        assert.equal(error.rateLimitReset, 1893456000);
        assert.equal(error.retryable, true);
        assert.doesNotMatch(error.message, /secret-installation-token|secret request body/);
        return true;
      },
    );
  });
  assert.equal(calls, 1);
});

for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
  test(`GitHub ${method} mutations make exactly one transport attempt`, async () => {
    let calls = 0;
    await withFetch(async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "temporary" }), {
        status: 503,
        headers: { "retry-after": "0" },
      });
    }, async () => {
      await assert.rejects(
        () => githubHttp.githubRequest("https://api.github.com/repos/org/repo/resource", {
          token: "installation-token",
          method,
          operation: "mutation",
          ...(method === "DELETE" ? {} : { body: { value: true } }),
          errorMessage: "GitHub mutation failed",
        }),
        (error) => error instanceof githubHttp.GitHubApiError,
      );
    });
    assert.equal(calls, 1);
  });
}

test("GitHub mutations do not retry an ambiguous network failure", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    throw new Error("socket closed after request write");
  }, async () => {
    await assert.rejects(
      () => githubHttp.githubRequest("https://api.github.com/repos/org/repo/issues", {
        token: "installation-token",
        method: "POST",
        operation: "mutation",
        body: { title: "Issue" },
        errorMessage: "GitHub mutation failed",
      }),
      (error) => {
        assert.equal(error.status, 0);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });
  assert.equal(calls, 1);
});

test("GitHub reads do not wait through a long Retry-After window", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "rate limited" }), {
      status: 429,
      headers: { "retry-after": "3" },
    });
  }, async () => {
    await assert.rejects(
      () => githubHttp.githubRequest("https://api.github.com/user", {
        token: "installation-token",
        errorMessage: "GitHub read failed",
      }),
      (error) => {
        assert.equal(error.retryAfterSeconds, 3);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });
  assert.equal(calls, 1);
});

test("non-GET requests require an explicit operation classification", async () => {
  await assert.rejects(
    () => githubHttp.githubRequest("https://api.github.com/graphql", {
      token: "installation-token",
      method: "POST",
      body: { query: "query { viewer { login } }" },
      errorMessage: "GitHub query failed",
    }),
    /explizite Read- oder Mutation-Klassifizierung/,
  );
});
