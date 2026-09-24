import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const route = await importTestModule("src/app/api/profiles/[id]/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/api-input": {
    auditRequestMetadata: () => ({ request_ip: "127.0.0.1", user_agent: "test" }),
    cleanOptionalDate: (value) => value,
    cleanOptionalText: (value) => value,
  },
  "@/lib/api-response": {
    apiError: (error, status) => Response.json({ error }, { status }),
    authzError: (permission) => Response.json({ error: permission.error }, { status: permission.status }),
  },
  "@/lib/authz": {
    bearerToken: () => "session-token",
    requireCEO: async () => ({ ok: true, profile: { id: "sebastian" } }),
  },
  "@/lib/supabase": {
    getSupabaseForToken: () => ({
      rpc: async () => ({
        data: {
          profile: {
            id: "volkan",
            name: "Volkan",
            platform_role: "founder",
            org_role: "Founder",
            deputy_for: null,
            deputy_active_from: null,
            deputy_active_until: null,
            weekly_capacity: 31,
            auth_user_id: "must-not-leak",
            github_login: "must-not-leak",
          },
        },
        error: null,
      }),
    }),
  },
});

test("profile governance returns only governance fields", async () => {
  const response = await route.PATCH(new Request("http://localhost/api/profiles/volkan", {
    method: "PATCH",
    body: JSON.stringify({ weeklyCapacity: 31 }),
  }), { params: Promise.resolve({ id: "volkan" }) });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    profile: {
      id: "volkan",
      name: "Volkan",
      platformRole: "founder",
      orgRole: "Founder",
      deputyFor: "",
      deputyActiveFrom: "",
      deputyActiveUntil: "",
      weeklyCapacity: 31,
    },
    notificationPreferences: [],
  });
});
