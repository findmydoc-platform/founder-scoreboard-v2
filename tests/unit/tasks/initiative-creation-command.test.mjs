import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const commandPath = "src/features/projects/hooks/use-initiative-commands.ts";

let saveInitiativeRequest = async () => ({ response: { ok: true }, body: { task: null } });

const { useInitiativeCommands } = await importTestModule(commandPath, {
  "@/features/planning/model/planning-api-client": {
    saveInitiativeRequest: (...args) => saveInitiativeRequest(...args),
    decideInitiativeApprovalRequest: async () => ({ response: { ok: true }, body: {} }),
    withdrawInitiativeRequest: async () => ({ response: { ok: true }, body: {} }),
  },
  "@/features/planning/model/approval-domain": {
    applyOptimisticApprovalDecision: (initiative) => initiative,
  },
  "@/features/planning/model/planning-trash-contract": {
    canWithdrawPlanningRoot: () => true,
  },
  "@/features/planning/model/planning-trash-state": {
    removePlanningRootFromData: (data) => ({ data }),
  },
});

const draft = {
  creationRequestId: "11111111-1111-4111-8111-111111111111",
  title: "Partnerpraxen standardisieren",
  parentTaskId: "milestone-1",
  ownerId: "profile-1",
  accountableProfileId: "profile-1",
  responsibleProfileIds: ["profile-1"],
  consultedProfileIds: [],
  informedProfileIds: [],
  priority: "P2",
  status: "planned",
  targetDate: "",
  goal: "Erstkontakte zuverlässig weiterverarbeiten",
  successCriteria: "",
  scopeConstraints: "",
  approveNow: false,
};

function commandFixture() {
  let data = {
    tasks: [],
  };
  const dialogDefaults = [];
  const saveErrors = [];
  const options = {
    apiClient: {},
    currentProfile: { id: "profile-1", platformRole: "ceo" },
    data,
    setData: (update) => {
      data = typeof update === "function" ? update(data) : update;
    },
    setInitiativeDialogDefaults: (value) => dialogDefaults.push(value),
    setSaveError: (value) => saveErrors.push(value),
    source: "supabase",
    startTransition: (callback) => {
      void callback();
    },
  };
  return {
    dialogDefaults,
    getData: () => data,
    options,
    saveErrors,
  };
}

test("failed Supabase initiative creation keeps the dialog and draft state open", async () => {
  saveInitiativeRequest = async () => ({
    response: { ok: false },
    body: { error: "Initiative konnte nicht angelegt werden." },
  });
  const fixture = commandFixture();
  const { saveInitiative } = useInitiativeCommands(fixture.options);

  await assert.rejects(saveInitiative(draft), /Initiative konnte nicht angelegt werden/);

  assert.deepEqual(fixture.getData().tasks, []);
  assert.deepEqual(fixture.dialogDefaults, []);
  assert.equal(fixture.saveErrors.at(-1), "Initiative konnte nicht angelegt werden.");
});

test("successful Supabase initiative creation closes only after the server result is stored", async () => {
  const savedInitiative = {
    id: "initiative-1",
    ...draft,
    parentTaskId: draft.parentTaskId,
    approvalStatus: "proposed",
    approvalRevision: 1,
    sortOrder: 1,
  };
  saveInitiativeRequest = async () => ({
    response: { ok: true },
    body: { task: savedInitiative },
  });
  const fixture = commandFixture();
  const { saveInitiative } = useInitiativeCommands(fixture.options);

  await saveInitiative(draft);

  assert.deepEqual(fixture.getData().tasks, [savedInitiative]);
  assert.deepEqual(fixture.dialogDefaults, [null]);
  assert.equal(fixture.saveErrors[0], "");
});
