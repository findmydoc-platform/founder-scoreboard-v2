import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadGraphql(result, requests = []) {
  return importTestModule("src/lib/github-graphql.ts", {
    "./github-http": {
      githubJson: async (url, options) => {
        requests.push({ url, options });
        return result;
      },
    },
  });
}

test("GraphQL adapter owns the envelope and preserves operation classification", async () => {
  const requests = [];
  const graphql = await loadGraphql({ data: { viewer: { login: "founder" } } }, requests);
  const data = await graphql.githubGraphql({
    query: "query Viewer { viewer { login } }",
    variables: { expected: "founder" },
    token: "token",
    operation: "read",
    errorMessage: "Viewer failed",
  });

  assert.deepEqual(data, { viewer: { login: "founder" } });
  assert.equal(requests[0].url, "https://api.github.com/graphql");
  assert.equal(requests[0].options.operation, "read");
  assert.deepEqual(requests[0].options.body.variables, { expected: "founder" });
});

test("GraphQL adapter combines GraphQL errors and rejects missing data", async () => {
  const withErrors = await loadGraphql({
    data: { partial: true },
    errors: [{ message: "first" }, { message: "second" }],
  });
  await assert.rejects(
    () => withErrors.githubGraphql({
      query: "mutation Test { test }",
      token: "token",
      operation: "mutation",
      errorMessage: "Mutation failed",
    }),
    /first \| second/,
  );

  const withoutData = await loadGraphql({});
  await assert.rejects(
    () => withoutData.githubGraphql({
      query: "query Test { test }",
      token: "token",
      operation: "read",
      errorMessage: "Query failed",
      missingDataMessage: "Expected data missing.",
    }),
    /Expected data missing/,
  );
});
