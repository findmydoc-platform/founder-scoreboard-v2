import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { subIssueEvidenceSummary } from "@/features/tasks/model/sub-issue-evidence";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";
import { SubIssueEvidenceSection } from "./sub-issue-evidence-section";

const parent = taskDetailStoryTask({ id: "evidence-parent" });
const shared = { title: "Kontaktformular anbinden", repository: "example/web", number: 42,
  url: "https://github.com/example/web/pull/42", status: "merged" as const };
const summary = subIssueEvidenceSummary(parent, [
  taskDetailStoryTask({ id: "form", title: "Kontaktformular prüfen", taskType: "sub_issue", parentTaskId: parent.id,
    evidenceLinks: ["https://example.com/form-test"], linkedPullRequests: [shared,
      { ...shared, title: "Formularvalidierung ergänzen", number: 43, url: "https://github.com/example/web/pull/43", status: "open" }] }),
  taskDetailStoryTask({ id: "redirect", title: "Weiterleitungen prüfen", taskType: "sub_issue", parentTaskId: parent.id,
    evidenceLinks: ["https://example.com/redirect-test"], linkedPullRequests: [shared,
      { ...shared, title: "Kontaktlinks korrigieren", number: 44, url: "https://github.com/example/web/pull/44" }] }),
]);

const meta = {
  component: SubIssueEvidenceSection,
  title: "Features/Tasks/Molecules/SubIssueEvidenceSection",
  parameters: { layout: "padded" },
  tags: ["domain:tasks", "layer:molecule"],
  args: { ...summary, onOpenTask: fn() },
  decorators: [(Story) => <section className="max-w-4xl"><h3 className="mb-3 text-sm font-semibold">Nachweis</h3><Story /></section>],
} satisfies Meta<typeof SubIssueEvidenceSection>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Nachweise aus Sub-Issues")).toBeVisible();
    await expect(canvas.getByText("5", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Kontaktformular anbinden")).not.toBeVisible();
  },
};

export const Expanded: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Nachweise aus Sub-Issues: 5"));
    await expect(canvas.getByText("Kontaktformular anbinden")).toBeVisible();
    await expect(canvas.getAllByRole("link").filter((link) => link.getAttribute("href") === shared.url)).toHaveLength(1);
    await expect(canvas.getByText("Auch zugeordnet:")).toBeVisible();
    await userEvent.click(canvas.getAllByRole("link", { name: "Weiterleitungen prüfen" })[0]);
    await expect(args.onOpenTask).toHaveBeenCalledWith("redirect");
    await userEvent.click(canvas.getByLabelText("Nachweise aus Sub-Issues: 5"));
    await expect(canvas.getByText("Kontaktformular anbinden")).not.toBeVisible();
  },
};

export const Empty: Story = {
  args: { count: 0, groups: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText("Nachweise aus Sub-Issues")).not.toBeInTheDocument();
  },
};


export const CurrentAndRetainedEvidenceStayDistinct: Story = {
  args: { count: null, coverage: "partial", knownCount: 1,
    groups: [{ ...summary.groups[0], entries: [summary.groups[0].entries[0]] }], retainedGroups: [summary.groups[1]] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Der aktuelle Stand der Nachweise aus Sub-Issues ist noch nicht vollständig bestätigt.")).toBeVisible();
    const current = canvas.getByLabelText("Nachweise aus Sub-Issues: Mindestens 1");
    await expect(current).toBeVisible();
    await expect(canvas.queryByLabelText("Nachweise aus Sub-Issues: 3")).not.toBeInTheDocument();
    await userEvent.click(current);
    await expect(canvas.getByText("Kontaktformular anbinden")).toBeVisible();
    await userEvent.click(canvas.getByText("Zuvor geladene Nachweise – Aktualität unbestätigt"));
    await expect(canvas.getAllByRole("link").some(link => link.getAttribute("href") === "https://example.com/redirect-test")).toBe(true);
  },
};
