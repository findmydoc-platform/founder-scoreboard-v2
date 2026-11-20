import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

it("authorized planning clients read each published prompt template with its version", async () => {
  await withPlanningCredentialDatabase(async fixture => {
    const tokens = await importTestModule("src/app/api/team/planning-items/v2/tokens/route.ts", { "server-only": {} });
    const context = await importTestModule("src/app/api/team/planning-items/v2/context/route.ts", { "server-only": {} });
    const admin = await importTestModule("src/app/api/administration/prompt-templates/route.ts", { "server-only": {} });
    const adminPath = "/api/administration/prompt-templates";
    const contextUrl = "http://localhost:3000/api/team/planning-items/v2/context";
    const issued = await tokens.POST(fixture.request("founder", "/api/team/planning-items/v2/tokens", "POST", {
      label: "Synthetic prompt template reader",
    }));
    expect(issued.status).toBe(200);
    const credential = await issued.json();
    expect(credential).toMatchObject({ token: expect.any(String), tokenRecord: { id: expect.any(String) } });

    const publishedText = "Beschreibe das Ergebnis aus Sicht des Owners.";
    let originalDeliverable: string | undefined;
    try {
      const read = async () => {
        const response = await context.GET(new NextRequest(contextUrl, { headers: { authorization: `Bearer ${credential.token}` } }));
        expect(response.status).toBe(200);
        return (await response.json()).context.promptTemplates;
      };
      const before = await read();
      expect(before).toEqual([
        { kind: "deliverable", text: expect.stringContaining("überprüfbare Ergebnis"), version: 1 },
        { kind: "general", text: expect.stringContaining("FounderOps"), version: 1 },
        { kind: "initiative", text: expect.stringContaining("Erfolgskriterien"), version: 1 },
        { kind: "sub_issue", text: expect.stringContaining("Arbeitsschritt"), version: 1 },
      ]);

      originalDeliverable = before[0].text;
      const response = await admin.PUT(fixture.request("administrator", adminPath, "PUT", {
        kind: "deliverable", text: publishedText, expectedVersion: 1,
      }));
      expect(response.status).toBe(200);
      expect(await read()).toEqual([
        { kind: "deliverable", text: publishedText, version: 2 },
        ...before.slice(1),
      ]);
    } finally {
      await fixture.db.query("delete from public.team_task_intake_tokens where id = $1", [credential.tokenRecord.id]);
      if (originalDeliverable !== undefined) {
        await fixture.db.query("update public.planning_prompt_templates set text = $1, version = 1 where kind = 'deliverable' and text = $2 and version = 2", [
          originalDeliverable, publishedText,
        ]);
      }
    }
  });
}, 60_000);
