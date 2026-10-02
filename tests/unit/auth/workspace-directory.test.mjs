import { test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test.each(["production", "preview"])("%s uses WIF, caches only the service credential and rechecks membership", async environment => {
  vi.stubEnv("VERCEL_ENV", environment);
  vi.stubEnv("GOOGLE_AUTHORIZED_GROUP", "internal-tool-founder-ops-access@findmydoc.eu");
  vi.stubEnv("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE", "configured-audience");
  vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT", "reader@example.iam.gserviceaccount.com");
  let memberships = 0;
  const network = vi.fn(async (url, init) => {
    if (new URL(url).hostname === "sts.googleapis.com") {
      expect(JSON.parse(init.body).audience).toBe("configured-audience");
      return Response.json({ access_token:"test-sts" });
    }
    if (new URL(url).hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken:"test-reader",expireTime:new Date(Date.now()+3_600_000).toISOString() });
    memberships++;
    return Response.json({ isMember:memberships===1 });
  });
  vi.stubGlobal("fetch",network);
  try {
    const directory = await importTestModule("src/lib/workspace-directory.ts", { "server-only":{}, "@vercel/oidc":{getVercelOidcToken:async()=>"test-oidc"} });
    expect(await directory.isWorkspaceGroupMember("member@findmydoc.eu")).toBe(true);
    expect(await directory.isWorkspaceGroupMember("member@findmydoc.eu")).toBe(false);
    expect(network).toHaveBeenCalledTimes(4);
    expect(memberships).toBe(2);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});
