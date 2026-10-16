import { expect, it } from "vitest";
import { selectedWorkweek, weekStartFromInput, workweekInputValue, workweekLabel } from "../../../src/features/team-workweek/model/team-workweek-week";

it("offers the current Berlin week without backdating its activation", () => {
  expect(selectedWorkweek("2026-10-12", new Date("2026-10-15T10:00:00Z"))).toEqual({
    ok: true, weekStart: "2026-10-12", activationMode: "immediate",
  });
  expect(selectedWorkweek("2026-10-19", new Date("2026-10-15T10:00:00Z"))).toEqual({
    ok: true, weekStart: "2026-10-19", activationMode: "future_monday",
  });
  expect(selectedWorkweek("2026-10-05", new Date("2026-10-15T10:00:00Z")).ok).toBe(false);
  expect(selectedWorkweek("2026-10-20", new Date("2026-10-15T10:00:00Z")).ok).toBe(false);
});

it("round-trips ISO weeks across a year boundary and rejects non-existent week 53", () => {
  expect(workweekInputValue("2025-12-29")).toBe("2026-W01");
  expect(weekStartFromInput("2026-W01")).toBe("2025-12-29");
  expect(weekStartFromInput("2026-W53")).toBe("2026-12-28");
  expect(weekStartFromInput("2025-W53")).toBeNull();
});

it("uses Berlin's Monday even while UTC is still Sunday", () => {
  expect(selectedWorkweek("2026-10-19", new Date("2026-10-18T22:30:00Z"))).toMatchObject({ activationMode: "immediate" });
  expect(workweekLabel("2026-10-12", "2026-10-15")).toBe("Diese Woche · 12.–18. Oktober 2026");
  expect(workweekLabel("2026-10-19", "2026-10-15")).toBe("Nächste Woche · 19.–25. Oktober 2026");
  expect(workweekLabel("2026-10-26", "2026-10-19", true)).toBe("Nächste Woche · 26. Okt.–1. Nov.");
});
