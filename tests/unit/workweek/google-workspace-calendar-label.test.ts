import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { probeGoogleWorkspacePrimaryCalendar } from "../../../src/features/team-workweek/server/google-workspace-oauth";

afterEach(() => vi.unstubAllGlobals());

it("reads the primary calendar label with the existing event permission and no event contents", async () => {
  const provider = vi.fn().mockResolvedValue(Response.json({ kind: "calendar#events", summary: "Calendar owner" }));
  vi.stubGlobal("fetch", provider);
  expect(await probeGoogleWorkspacePrimaryCalendar("test-access-token")).toBe("Calendar owner");
  const request = new URL(provider.mock.calls[0][0]);
  expect(request.pathname).toBe("/calendar/v3/calendars/primary/events");
  expect(request.searchParams.get("fields")).toBe("kind,summary");
  expect(request.searchParams.get("privateExtendedProperty")).toBe("founderOpsProbe=__never__");
  expect(request.searchParams.has("access_token")).toBe(false);
});

it("does not invent a calendar identity when Google supplies no label", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({kind:"calendar#events"})));
  expect(await probeGoogleWorkspacePrimaryCalendar("test-access-token")).toBeNull();
});
