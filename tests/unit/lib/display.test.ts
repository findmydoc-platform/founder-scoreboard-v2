import {
  compactDateRange,
  dateRange,
  focusStatusLabel,
  formatDate,
  initiativeOptionLabel,
  relationTypeLabel,
  relationshipHelpText,
  taskAssigneeLabel,
  taskAssigneeOptions,
  unassignedAssigneeLabel,
} from "@/lib/display";
import { describe, expect, it } from "vitest";

describe("display helpers", () => {
  it("labels unassigned and assigned profiles", () => {
    const profiles = [{ id: "volkan", name: "Volkan" }];

    expect(unassignedAssigneeLabel).toBe("Nicht zugeordnet");
    expect(taskAssigneeLabel({ assignee: "" })).toBe("Nicht zugeordnet");
    expect(taskAssigneeLabel({ assignee: "Volkan" })).toBe("Volkan");
    expect(taskAssigneeOptions("deliverable", profiles)).toEqual([
      { value: "volkan", label: "Volkan" },
    ]);
  });

  it("labels planning relationships and focus states", () => {
    expect(initiativeOptionLabel({ title: "Initiative A" })).toBe("Initiative A");
    expect(relationTypeLabel("blocked_by")).toBe("Wartet auf");
    expect(relationTypeLabel("blocks")).toBe("Blockiert");
    expect(relationTypeLabel("relates_to")).toBe("Verknüpft mit");
    expect(focusStatusLabel("needs_decision")).toBe("Entscheidung nötig");
    expect(relationshipHelpText("Wartet auf")).toMatch(/sauber weitergehen/);
  });

  it("formats individual dates without inventing values", () => {
    const dateWithoutYear = formatDate("2026-06-09");
    const dateWithYear = formatDate("2026-06-09", { includeYear: true });
    expect(dateWithoutYear).toMatch(/09/);
    expect(dateWithoutYear).not.toMatch(/2026/);
    expect(dateWithYear).toMatch(/2026/);
    expect(formatDate("")).toBe("ohne Datum");
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("Sprint 1", { includeYear: true })).toBe("Sprint 1");
  });

  it("formats date ranges and their empty state", () => {
    expect(dateRange({ startDate: "2026-06-09", endDate: "2026-06-10" })).toMatch(/09.*10/);
    expect(dateRange({ startDate: "", endDate: "" })).toBe("ohne Zeitraum");
    expect(compactDateRange({ startDate: "2026-06-02", endDate: "2026-06-04" })).toBe(
      "02.–04. Juni",
    );
    expect(compactDateRange({ startDate: "2026-05-30", endDate: "2026-06-02" })).toBe(
      "30. Mai–02. Juni",
    );
    expect(compactDateRange({ startDate: "", endDate: "" })).toBe("Zeitraum offen");
  });
});
