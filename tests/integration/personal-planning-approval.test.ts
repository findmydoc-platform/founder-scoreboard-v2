import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

it("personal approval honors current authority, revisions and safe retries", async () => {
  await withPlanningCredentialDatabase(async fixture => {
    const ids = Object.values(fixture.actors).map(actor => actor.profileId);
    try {
      const tokens = await importTestModule("src/app/api/team/planning-items/v2/tokens/route.ts", { "server-only": {} });
      const approval = await importTestModule("src/app/api/team/planning-items/v2/items/[id]/approval/route.ts", { "server-only": {} });
      const issue = async (actor: "ceo" | "deputy" | "founder") => {
        const response = await tokens.POST(fixture.request(actor, "/api/team/planning-items/v2/tokens", "POST", { label: "Synthetic approval" }));
        expect(response.status).toBe(200);
        const body = await response.json();
        if (typeof body.token !== "string") throw new Error("Missing personal credential");
        return body as { token: string; tokenRecord: { id: string } };
      };
      const ceo = await issue("ceo"), deputy = await issue("deputy"), founder = await issue("founder");
      await fixture.db.query("update public.team_task_intake_tokens set created_at=created_at-interval '1 day',expires_at=expires_at-interval '1 day' where id=$1", [ceo.tokenRecord.id]);
      const call = (credential: string, id: string, body: unknown = { expectedApprovalRevision: 1 }, key = randomUUID()) => approval.POST(
        new NextRequest(`http://localhost:3000/api/team/planning-items/v2/items/${id}/approval`, {
          method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
        }), { params: Promise.resolve({ id }) },
      );
      const create = async (suffix: string, type: "initiative" | "deliverable", parent: string | null) => {
        const id = `${fixture.prefix}-${suffix}`;
        await fixture.db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,assignee) values($1,'findmydoc-founder-execution','Synthetic approval',$2,'Offen','P2','proposed',$3,$4,$4)", [id, type, parent, fixture.actors.ceo.profileId]);
        if (type === "initiative") await fixture.db.query("insert into public.planning_item_raci_assignments(task_id,profile_id,role) values($1,$2,'accountable'),($1,$3,'responsible')", [id, fixture.actors.ceo.profileId, fixture.actors.deputy.profileId]);
        return id;
      };
      const epic = `${fixture.prefix}-epic`;
      const id = await create("approval-initiative", "initiative", epic);
      await fixture.db.query("insert into public.planning_item_strategy(task_id,goal,success_criteria,scope_constraints) values($1,'Original goal','Original success','Original scope')", [id]);
      await fixture.db.query("insert into public.planning_item_raci_assignments(task_id,profile_id,role) values($1,$2,'consulted'),($1,$3,'informed')", [id, fixture.actors.founder.profileId, fixture.actors.other.profileId]);
      const forbidden = await call(founder.token, id);
      expect(forbidden.status).toBe(403);
      expect((await forbidden.json())._meta.access.requiredScopes).toEqual([]);
      expect((await call(ceo.token, id, { expectedApprovalRevision: 1, action: "reject" })).status).toBe(400);
      expect((await call(ceo.token, id, { expectedApprovalRevision: 2 })).status).toBe(409);
      expect((await call(ceo.token, id, { expectedApprovalRevision: 2147483647 })).status).toBe(409);
      expect((await call(ceo.token, id, { expectedApprovalRevision: 2147483648 })).status).toBe(400);
      const key = randomUUID();
      const first = await call(ceo.token, id, undefined, key);
      expect(first.status).toBe(200);
      const result = await first.json();
      expect(result).toMatchObject({ ok: true, replayed: false, itemType: "initiative", item: {
        id, approvalStatus: "approved", intendedOutcome: "Original goal", acceptanceCriteria: "Original success", scopeConstraints: "Original scope",
        accountableProfileId: fixture.actors.ceo.profileId, responsibleProfileIds: [fixture.actors.deputy.profileId],
        consultedProfileIds: [fixture.actors.founder.profileId], informedProfileIds: [fixture.actors.other.profileId],
      }, _meta: { access: { requiredScopes: [], missingScopes: [] } } });
      expect(JSON.stringify(result).includes(ceo.token)).toBe(false);
      await fixture.db.query("update public.planning_item_strategy set goal='Changed goal',success_criteria='Changed success',scope_constraints='Changed scope' where task_id=$1", [id]);
      await fixture.db.query("delete from public.planning_item_raci_assignments where task_id=$1 and role in ('consulted','informed')", [id]);
      const replay = await call(ceo.token, id, undefined, key);
      expect(await replay.json()).toMatchObject({ ok: true, replayed: true, item: result.item });
      expect((await call(ceo.token, id, { expectedApprovalRevision: 2 }, key)).status).toBe(409);
      expect((await call(ceo.token, id)).status).toBe(409);
      expect((await fixture.db.query("select count(*)::int as count from public.task_activity where task_id=$1", [id])).rows[0].count).toBe(1);
      expect((await fixture.db.query("select count(*)::int as count from public.audit_log where entity_id=$1 and actor_profile_id=$2 and action='planning_item.approval_approve'", [id, fixture.actors.ceo.profileId])).rows[0].count).toBe(1);
      const deliverable = await create("approval-deliverable", "deliverable", fixture.initiativeId);
      const deliverableKey = randomUUID();
      const decision = await call(deputy.token, deliverable, undefined, deliverableKey);
      expect(decision.status).toBe(200);
      expect(await decision.json()).toMatchObject({ ok: true, itemType: "deliverable", item: { id: deliverable, approvalStatus: "approved" } });
      await fixture.db.query("insert into public.planning_github_lifecycle_outbox(root_type,root_id,root_trash_revision,task_id,action,source_type,source_revision,status,status_reason) values('deliverable',$1,1,$1,'reopen','approval',1,'failed','missing_close_target')", [deliverable]);
      const lifecycleReplay = await call(deputy.token, deliverable, undefined, deliverableKey);
      expect(await lifecycleReplay.json()).toMatchObject({ ok: true, replayed: true, lifecycle: { completed: false } });
      expect((await fixture.db.query("select count(*)::int as count from public.task_activity where task_id=$1", [deliverable])).rows[0].count).toBe(1);
      const deputyInitiative = await create("deputy-initiative", "initiative", epic);
      expect((await call(deputy.token, deputyInitiative)).status).toBe(200);
      const ceoDeliverable = await create("ceo-deliverable", "deliverable", fixture.initiativeId);
      expect((await call(ceo.token, ceoDeliverable)).status).toBe(200);
      const missingParent = await create("missing-parent", "initiative", null);
      expect((await call(ceo.token, missingParent)).status).toBe(409);
      const proposedParent = await create("proposed-parent", "initiative", epic);
      const unapprovedParent = await create("unapproved-parent", "deliverable", proposedParent);
      expect((await call(ceo.token, unapprovedParent)).status).toBe(409);
      const race = await create("concurrent-approval", "initiative", epic);
      const concurrent = await Promise.all([call(ceo.token, race), call(ceo.token, race)]);
      expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
      expect((await fixture.db.query("select count(*)::int as count from public.task_activity where task_id=$1", [race])).rows[0].count).toBe(1);
      await fixture.db.query("update public.profiles set platform_role='founder' where id=$1", [fixture.actors.ceo.profileId]);
      expect((await call(ceo.token, id, undefined, key)).status).toBe(403);
      await fixture.db.query("update public.team_task_intake_tokens set revoked_at=now() where id=$1", [deputy.tokenRecord.id]);
      expect((await call(deputy.token, deliverable)).status).toBe(401);
    } finally {
      await fixture.db.query("delete from public.team_task_intake_tokens where profile_id=any($1)", [ids]);
    }
  });
}, 60_000);
