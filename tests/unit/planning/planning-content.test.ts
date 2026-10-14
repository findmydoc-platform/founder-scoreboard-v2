import { describe, expect, test } from "vitest";
import { codepointLength, renderGitHubIssueContent, validateGitHubIssueContent, type IssueContentTask } from "@/lib/github-issue-content";
import { validatePlanningContent } from "@/features/planning-items/model/planning-item-content";

const task: IssueContentTask = { id: "length-boundary", taskType: "sub_issue", title: "A valid title", description: "" };
const context = { appUrl: "https://founder-ops.findmydoc.eu" };

// The fixture has one context section, source link and durable marker.
function boundaryTask(extra = 0): IssueContentTask {
  const rendered = renderGitHubIssueContent({ ...task, description: "x" }, context);
  return { ...task, description: "😀".repeat(65_536 - codepointLength(rendered.body) + 1 + extra) };
}

describe("Planning content contract", () => {
  test("accepts the exact final body boundary and rejects the next codepoint", () => {
    expect(validatePlanningContent(boundaryTask(), context)).toEqual([]);
    const errors = validatePlanningContent(boundaryTask(1), context);
    expect(errors).toEqual([expect.objectContaining({ field: "githubBody", actual: 65_537, maximum: 65_536, excess: 1 })]);
  });
  test("counts Unicode codepoints without normalizing combining marks", () => {
    expect(codepointLength("ä😀a\u0308")).toBe(4);
    expect(validatePlanningContent({ ...task, title: "😀😀" })).toEqual([expect.objectContaining({ field: "title", actual: 2 })]);
    expect(validatePlanningContent({ ...task, title: "😀".repeat(240) })).toEqual([]);
    expect(validatePlanningContent({ ...task, title: "😀".repeat(241) })).toEqual([expect.objectContaining({ field: "title", actual: 241 })]);
  });
  test("checks the rendered title including its type prefix", () => {
    const title = `[Deliverable] ${"x".repeat(242)}`;
    expect(validateGitHubIssueContent({ title, body: "" })).toEqual([]);
    expect(validateGitHubIssueContent({ title: `${title}x`, body: "" })).toEqual([expect.objectContaining({ field: "githubTitle", actual: 257 })]);
  });
  test.each(["epic", "initiative"] as const)("%s allows 65536 codepoints independently per long field", (taskType) => {
    const item = { ...task, taskType, description: "ä".repeat(65_536), intendedOutcome: "😀".repeat(65_536) };
    expect(validatePlanningContent(item)).toEqual([]);
    expect(validatePlanningContent({ ...item, description: `${item.description}x` })).toEqual([expect.objectContaining({ field: "description", actual: 65_537 })]);
  });
  test("validates hidden fallback text even when the renderer does not project it", () => {
    expect(validatePlanningContent({ ...task, taskType: "deliverable", description: "x".repeat(65_537), problemStatement: "Visible" })).toEqual([expect.objectContaining({ field: "description" })]);
  });
  test("counts list markup, source and expanded mentions before accepting a body", () => {
    const item = { ...task, description: "@all", acceptanceCriteria: "first\nsecond" };
    const rendered = renderGitHubIssueContent(item, { ...context, mentionTeam: { organization: "findmydoc-platform", teamSlug: "founders" } });
    expect(rendered.body).toContain("@findmydoc-platform/founders");
    expect(rendered.body).toContain("## Acceptance Criteria\n- first\n- second");
    expect(rendered.body).toContain("https://founder-ops.findmydoc.eu/tasks/length-boundary");
    expect(rendered.body).toContain("<!-- founderops-task-id:length-boundary -->");
    const base = boundaryTask();
    const mentioned = { ...base, description: `${base.description!.slice(0, -8)}@all` };
    expect(validatePlanningContent(mentioned, { ...context, mentionTeam: { organization: "findmydoc-platform", teamSlug: "founders" } })).toEqual([expect.objectContaining({ field: "githubBody", excess: 24 })]);
  });
});
