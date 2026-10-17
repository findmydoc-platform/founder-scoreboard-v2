import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyClientCredentialBundle } from "../../scripts/lib/client-credential-bundle.mjs";
function fixture(files, verify) {
  const root = mkdtempSync(path.join(tmpdir(), "client-credentials-"));
  try {
    for (const [name, text] of Object.entries(files)) { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
    verify(verifyClientCredentialBundle(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("requires an actual production client build", () => fixture({}, result => assert.equal(result.failures.length, 1)));
test("accepts safe client snapshots without scanning server chunks", () => fixture({ ".next/static/chunks/client.js": "const session={userId:'user',revision:'opaque'};", ".next/server/chunks/server.js": "SUPABASE_SERVICE_ROLE_KEY" }, result => { assert.equal(result.files, 1); assert.deepEqual(result.failures, []); }));
for (const marker of ["SUPABASE_SERVICE_ROLE_KEY", "GITHUB_APP_PRIVATE_KEY", "access_token", "refresh_token", "GoTrueClient", "workspace_issue_permit", "synthetic-service"]) {
  test(`rejects ${marker} in any nested client chunk`, () => fixture({ ".next/static/chunks/safe.js": "const user={id:'user'};", ".next/static/chunks/nested/other.js": marker }, result => assert.equal(result.failures.length, 1)));
}
test("checks source maps as well as executable chunks", () => fixture({ ".next/static/chunks/client.js": "safe", ".next/static/chunks/client.js.map": JSON.stringify({ sourcesContent: ["refresh_token"] }) }, result => assert.equal(result.failures.length, 1)));
