import { test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("disconnect removes only the local Calendar connection without contacting Google", async () => {
  const network = vi.fn(() => { throw new Error("Unexpected provider request"); });
  vi.stubGlobal("fetch", network);
  try {
    const oauth = await importTestModule("src/features/team-workweek/server/google-workspace-oauth.ts", { "server-only": {} });
    const removed = [];
    const client = { from: (table) => ({ delete: () => ({ eq: async (key, value) => { removed.push({ table, key, value }); return { error: null }; } }) }) };
    await oauth.removeGoogleWorkspaceConnection(client, "profile-1");
    expect(removed).toEqual([{ table: "google_workspace_connections", key: "profile_id", value: "profile-1" }]);
    expect(network).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
