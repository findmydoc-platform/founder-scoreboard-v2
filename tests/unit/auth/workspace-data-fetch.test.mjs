import { test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("preserves the user JWT, releases permits after failure and never replays a mutation", async () => {
  const rpc = vi.fn(async()=>({error:null}));
  const network=vi.fn(async request=>{
    expect(request.headers.get("authorization")).toBe("Bearer user-session");
    expect(request.headers.get("x-founderops-workspace-permit")).toBeTruthy();
    throw new Error("Connection lost");
  });
  vi.stubGlobal("fetch",network);
  try {
    const relay=await importTestModule("src/lib/workspace-data-fetch.ts",{
      "server-only":{},
      "./workspace-access":{requireWorkspaceAccess:async()=>({userId:"user-1"}),assertGoogleSession:async()=>{}},
      "./supabase-service-role":{getServerServiceRoleSupabase:()=>({auth:{getUser:async()=>({data:{user:{id:"user-1"}},error:null})},rpc})},
    });
    await expect(relay.workspaceDataFetch("https://database.example/rest/v1/rpc/operation",{method:"POST",headers:{authorization:"Bearer user-session"}})).rejects.toThrow("Connection lost");
    expect(network).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(call=>call[0])).toEqual(["workspace_issue_permit","workspace_release_permit"]);
    expect(rpc.mock.calls[0][1]).toMatchObject({p_user_id:"user-1",p_method:"POST",p_path:"/rpc/operation"});
    expect(rpc.mock.calls[1][1].p_hash).toBe(rpc.mock.calls[0][1].p_hash);
  }finally{vi.unstubAllGlobals();}
});
