import { expect, it } from "vitest";
import { withIsolatedLocalDatabase } from "./helpers/local-database";
import { verifyDatabaseSecurity } from "../../scripts/lib/database-security.mjs";

it("keeps the Notification publication and source clock behind their fixed database boundary", async () => {
  await withIsolatedLocalDatabase(async client => {
    await expect(verifyDatabaseSecurity(client)).resolves.toBeDefined();
    await client.query("grant select on workspace_private.notification_scope_revision to authenticated");
    await expect(verifyDatabaseSecurity(client)).rejects.toThrow("Notification source revision must remain private");
    await client.query("revoke select on workspace_private.notification_scope_revision from authenticated");
    await client.query("grant execute on function public.notification_publication_context() to anon");
    await expect(verifyDatabaseSecurity(client)).rejects.toThrow("Notification publication context must remain a fixed user-bound fence");
    await client.query("revoke execute on function public.notification_publication_context() from anon");
    await client.query("grant execute on function public.notification_count_fast_path(uuid,uuid,text,text,timestamptz) to authenticated");
    await expect(verifyDatabaseSecurity(client)).rejects.toThrow("Notification count fast path must remain read-only");
    await client.query("revoke execute on function public.notification_count_fast_path(uuid,uuid,text,text,timestamptz) from authenticated");
    await client.query("grant execute on function public.notification_content_fast_path(uuid,uuid,text,text,timestamptz,text,integer) to anon");
    await expect(verifyDatabaseSecurity(client)).rejects.toThrow("Notification content fast path must remain read-only");
    await client.query("revoke execute on function public.notification_content_fast_path(uuid,uuid,text,text,timestamptz,text,integer) from anon");
    await client.query("grant execute on function workspace_private.notification_scope_snapshot(uuid,uuid,text,text,timestamptz,text,integer) to service_role");
    await expect(verifyDatabaseSecurity(client)).rejects.toThrow("Notification shared snapshot must remain read-only");
  });
}, 30_000);
