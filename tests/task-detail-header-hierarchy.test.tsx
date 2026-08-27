import assert from "node:assert/strict";
import test from "node:test";
import { TaskDetailOperationalHeader } from "../src/features/tasks/molecules/task-detail-operational-header";
import { renderTestUi, taskFixture } from "./task-detail-component-test-helpers";

test("the rendered hierarchy link targets and opens the Deliverable parent", async () => {
  const initiative = taskFixture({
    id: "initiative-parent",
    title: "Parent Initiative",
    taskType: "initiative",
  });
  const deliverable = taskFixture({
    id: "deliverable-child",
    title: "Child Deliverable",
    taskType: "deliverable",
    parentTaskId: initiative.id,
  });
  const openedTaskIds: string[] = [];
  const view = await renderTestUi(
    <TaskDetailOperationalHeader
      task={deliverable}
      initiative={initiative}
      profiles={[]}
      subIssues={[]}
      statusOptions={["Offen"]}
      canChangeStatus={false}
      canManageTaskMeta={false}
      onOpenTask={(taskId) => openedTaskIds.push(taskId)}
      onUpdate={() => undefined}
    />,
  );

  try {
    const parentLink = view.container.querySelector<HTMLAnchorElement>('a[href="/tasks/initiative-parent"]');
    assert.ok(parentLink);
    assert.equal(parentLink.textContent, initiative.title);

    assert.equal(await view.click(parentLink), false);
    assert.deepEqual(openedTaskIds, [initiative.id]);

    assert.equal(await view.click(parentLink, { ctrlKey: true }), true);
    assert.equal(await view.click(parentLink, { metaKey: true }), true);
    assert.equal(await view.click(parentLink, { button: 1 }), true);
    assert.deepEqual(openedTaskIds, [initiative.id]);
  } finally {
    await view.cleanup();
  }
});

test("a missing hierarchy parent remains static", async () => {
  const deliverable = taskFixture({
    id: "deliverable-without-parent",
    title: "Unparented Deliverable",
    taskType: "deliverable",
    parentTaskId: "",
  });
  const view = await renderTestUi(
    <TaskDetailOperationalHeader
      task={deliverable}
      profiles={[]}
      subIssues={[]}
      statusOptions={["Offen"]}
      canChangeStatus={false}
      canManageTaskMeta={false}
      onOpenTask={() => assert.fail("Missing parents must not be interactive.")}
      onUpdate={() => undefined}
    />,
  );

  try {
    assert.match(view.container.textContent || "", /Ohne Initiative/);
    assert.equal(view.container.querySelector("a"), null);
  } finally {
    await view.cleanup();
  }
});
