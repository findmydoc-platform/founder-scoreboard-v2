import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

it("evaluates published templates for the verified personal token profile and preserves the planning context", async () => {
  await withPlanningCredentialDatabase(async fixture => {
    const tokens = await importTestModule("src/app/api/team/planning-items/v2/tokens/route.ts", { "server-only": {} });
    const context = await importTestModule("src/app/api/team/planning-items/v2/context/route.ts", { "server-only": {} });
    const admin = await importTestModule("src/app/api/administration/prompt-templates/route.ts", { "server-only": {} });
    const adminPath = "/api/administration/prompt-templates";
    const contextUrl = "http://localhost:3000/api/team/planning-items/v2/context";
    const tokenIds: string[] = [];
    const selected = fixture.actors.founder.profileId;
    const publishedText = "Beschreibe das Ergebnis aus Sicht des Owners.";
    let originalDeliverable: string | undefined;

    const issue = async (actor: "founder" | "other") => {
      const response = await tokens.POST(fixture.request(actor, "/api/team/planning-items/v2/tokens", "POST", {
        label: "Synthetic prompt template reader",
      }));
      expect(response.status).toBe(200);
      const { token, tokenRecord } = await response.json();
      expect(token).toEqual(expect.any(String));
      tokenIds.push(tokenRecord.id);
      return token;
    };
    const read = async (token: string, requestedProfile = selected) => {
      const response = await context.GET(new NextRequest(`${contextUrl}?profileId=${requestedProfile}`, {
        headers: { authorization: `Bearer ${token}` },
      }));
      expect(response.status).toBe(200);
      const { context: body } = await response.json();
      expect(body).not.toHaveProperty("audience");
      expect(body).not.toHaveProperty("profileIds");
      expect(body.initiatives).toEqual(expect.arrayContaining([expect.objectContaining({ id: fixture.initiativeId })]));
      return body;
    };
    const save = async (edit: { mode?: "selected" | "all"; profileIds?: string[] }) => {
      const response = await admin.PATCH(fixture.request("administrator", adminPath, "PATCH", edit));
      expect(response.status).toBe(200);
      return (await response.json()).audience;
    };

    try {
      const [founderToken, otherToken] = [await issue("founder"), await issue("other")];
      expect((await read(founderToken)).promptTemplates).toEqual([]);
      expect((await read(otherToken)).promptTemplates).toEqual([]);

      expect(await save({ profileIds: [selected] })).toEqual({ mode: "selected", profileIds: [selected] });
      const before = (await read(founderToken)).promptTemplates;
      expect(before).toEqual([
        { kind: "deliverable", text: expect.stringContaining("überprüfbare Ergebnis"), version: 1 },
        { kind: "general", text: expect.stringContaining("FounderOps"), version: 1 },
        { kind: "initiative", text: expect.stringContaining("Erfolgskriterien"), version: 1 },
        { kind: "sub_issue", text: expect.stringContaining("Arbeitsschritt"), version: 1 },
      ]);
      const excluded = await read(otherToken);
      expect(excluded.actor).toMatchObject({ id: fixture.actors.other.profileId });
      expect(excluded.promptTemplates).toEqual([]);

      const denied = await admin.PATCH(fixture.request("ceo", adminPath, "PATCH", { mode: "all" }));
      expect(denied.status).toBe(403);
      expect((await read(otherToken)).promptTemplates).toEqual([]);

      originalDeliverable = before[0].text;
      const response = await admin.PUT(fixture.request("administrator", adminPath, "PUT", {
        kind: "deliverable", text: publishedText, expectedVersion: 1,
      }));
      expect(response.status).toBe(200);
      const after = [
        { kind: "deliverable", text: publishedText, version: 2 },
        ...before.slice(1),
      ];
      expect((await read(founderToken)).promptTemplates).toEqual(after);

      expect(await save({ mode: "all" })).toEqual({ mode: "all", profileIds: [selected] });
      expect(await read(otherToken)).toEqual({ ...excluded, promptTemplates: after });
      expect(await save({ mode: "selected" })).toEqual({ mode: "selected", profileIds: [selected] });
      expect(await read(otherToken)).toEqual(excluded);
      expect((await read(founderToken)).promptTemplates).toEqual(after);

      expect(await save({ profileIds: [] })).toEqual({ mode: "selected", profileIds: [] });
      expect((await read(founderToken)).promptTemplates).toEqual([]);
    } finally {
      await save({ mode: "selected", profileIds: [] });
      await fixture.db.query("delete from public.team_task_intake_tokens where id = any($1)", [tokenIds]);
      if (originalDeliverable !== undefined) {
        await fixture.db.query("update public.planning_prompt_templates set text = $1, version = 1 where kind = 'deliverable' and text = $2 and version = 2", [
          originalDeliverable, publishedText,
        ]);
      }
    }
  });
}, 60_000);
