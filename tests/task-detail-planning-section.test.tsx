import assert from "node:assert/strict";
import test from "node:test";
import { TaskDetailPlanningSection } from "../src/features/tasks/molecules/task-detail-planning-section";
import type { Sprint } from "../src/lib/types";
import { renderTestUi, taskFixture } from "./task-detail-component-test-helpers";

function buttonByText(container: Element, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

test("Initiative planning hides the Epic until the section is expanded", async () => {
  const epic = taskFixture({
    id: "epic-parent",
    title: "Unique Parent Epic",
    taskType: "epic",
  });
  const initiative = taskFixture({
    id: "initiative-child",
    title: "Initiative",
    taskType: "initiative",
    parentTaskId: epic.id,
    targetDate: "2026-08-30",
  });
  const view = await renderTestUi(
    <TaskDetailPlanningSection
      task={initiative}
      teamProfiles={[]}
      allTasks={[epic, initiative]}
      sprints={[]}
      canManageTaskMeta={false}
      canReparentSubIssue={false}
      pending={false}
      onUpdate={() => undefined}
    />,
  );

  try {
    const section = view.container.querySelector<HTMLElement>('[aria-label="Strategische Einordnung"]');
    assert.ok(section);
    assert.match(section.textContent || "", /2026-08-30/);
    assert.doesNotMatch(section.textContent || "", /Unique Parent Epic/);

    await view.click(buttonByText(section, "Einordnung anzeigen"));
    assert.match(section.textContent || "", /Parent-Epic/);
    assert.match(section.textContent || "", /Unique Parent Epic/);
  } finally {
    await view.cleanup();
  }
});

test("Deliverable planning hides the Initiative until the section is expanded", async () => {
  const initiative = taskFixture({
    id: "initiative-parent",
    title: "Unique Parent Initiative",
    taskType: "initiative",
  });
  const deliverable = taskFixture({
    id: "deliverable-child",
    title: "Deliverable",
    taskType: "deliverable",
    parentTaskId: initiative.id,
    sprintId: "sprint-1",
  });
  const sprint: Sprint = {
    id: "sprint-1",
    name: "Sprint 1",
    status: "active",
    startDate: "2026-06-02",
    endDate: "2026-06-04",
    reviewDueAt: "2026-06-05T10:00:00.000Z",
    scoreLocked: false,
  };
  const view = await renderTestUi(
    <TaskDetailPlanningSection
      task={deliverable}
      teamProfiles={[]}
      allTasks={[initiative, deliverable]}
      sprints={[sprint]}
      canManageTaskMeta={false}
      canReparentSubIssue={false}
      pending={false}
      onUpdate={() => undefined}
    />,
  );

  try {
    const section = view.container.querySelector<HTMLElement>('[aria-label="Planung"]');
    assert.ok(section);
    assert.match(section.textContent || "", /Sprint 1/);
    assert.match(section.textContent || "", /02.–04\. Juni/);
    assert.doesNotMatch(section.textContent || "", /Unique Parent Initiative/);

    await view.click(buttonByText(section, "Planung anzeigen"));
    assert.match(section.textContent || "", /Initiative/);
    assert.match(section.textContent || "", /Unique Parent Initiative/);
  } finally {
    await view.cleanup();
  }
});
