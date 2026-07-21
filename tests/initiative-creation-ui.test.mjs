import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const dialogPath = "src/features/projects/organisms/initiative-dialog.tsx";
const commandPath = "src/features/projects/hooks/use-initiative-commands.ts";

let saveInitiativeRequest = async () => ({ response: { ok: true }, body: { initiative: null } });

const { useInitiativeCommands } = await loadTranspiledModule(commandPath, {
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
  title: "Partnerpraxen standardisieren",
  milestoneId: "milestone-1",
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
    packages: [],
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

test("initiative creation shell keeps header and footer fixed around one bounded body", async () => {
  const [dialog, modalHook, modalStack] = await Promise.all([
    readFile(dialogPath, "utf8"),
    readFile("src/shared/hooks/use-modal-dialog.ts", "utf8"),
    readFile("src/shared/model/modal-stack.ts", "utf8"),
  ]);

  assert.match(dialog, /max-h-\[calc\(100dvh-4rem\)\]/);
  assert.match(dialog, /min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain/);
  assert.match(dialog, /\[scrollbar-gutter:stable\]/);
  assert.match(modalHook, /registerModal\(dialog\)/);
  assert.match(modalStack, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modalStack, /document\.body\.style\.overscrollBehavior = "none"/);
  assert.match(modalStack, /element\.inert = true/);
  assert.match(dialog, /<header className="[^"]*shrink-0/);
  assert.match(dialog, /<footer className="shrink-0/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /useModalDialog/);
});

test("initiative creation keeps authored outcome before classification and responsibility", async () => {
  const dialog = await readFile(dialogPath, "utf8");
  const authoredGroup = dialog.indexOf("Ziel &amp; Wirkung");
  const goal = dialog.indexOf("Zielbild *");
  const constraints = dialog.indexOf("\n                Umfang &amp; Grenzen\n", goal);
  const contextGroup = dialog.indexOf("Einordnung &amp; Verantwortung");
  const milestone = dialog.indexOf("Epic / Meilenstein *");
  const accountable = dialog.indexOf("Accountable *");

  assert.ok(authoredGroup < goal);
  assert.ok(goal < constraints);
  assert.ok(constraints < contextGroup);
  assert.ok(contextGroup < milestone);
  assert.ok(milestone < accountable);
  assert.match(dialog, /\* Pflichtfeld/);
  assert.match(dialog, /aria-required/);
  assert.match(dialog, /showValidationError\("title"\)/);
  assert.match(dialog, /onBlur=\{\(\) => touchValidationField\("title"\)\}/);
  assert.match(dialog, /setSubmitAttempted\(true\)/);
  assert.match(dialog, /\{hasVisibleValidationErrors && \(/);
  assert.match(dialog, /role="status"/);
  assert.doesNotMatch(dialog, /\{!canSave && \(\s*<p id=\{primaryDisabledReasonId\}/);
  assert.match(dialog, /required\s+minLength=\{3\}/);
  assert.match(dialog, /Initiative erstellen/);
  assert.match(dialog, /Erstellen und freigeben/);
  assert.match(dialog, /Wird erstellt…/);
});

test("failed Supabase initiative creation keeps the dialog and draft state open", async () => {
  saveInitiativeRequest = async () => ({
    response: { ok: false },
    body: { error: "Initiative konnte nicht angelegt werden." },
  });
  const fixture = commandFixture();
  const { saveInitiative } = useInitiativeCommands(fixture.options);

  await assert.rejects(saveInitiative(draft), /Initiative konnte nicht angelegt werden/);

  assert.deepEqual(fixture.getData().packages, []);
  assert.deepEqual(fixture.dialogDefaults, []);
  assert.equal(fixture.saveErrors.at(-1), "Initiative konnte nicht angelegt werden.");
});

test("successful Supabase initiative creation closes only after the server result is stored", async () => {
  const savedInitiative = {
    id: "initiative-1",
    ...draft,
    milestoneId: draft.milestoneId,
    approvalStatus: "proposed",
    approvalRevision: 1,
    sortOrder: 1,
  };
  saveInitiativeRequest = async () => ({
    response: { ok: true },
    body: { initiative: savedInitiative },
  });
  const fixture = commandFixture();
  const { saveInitiative } = useInitiativeCommands(fixture.options);

  await saveInitiative(draft);

  assert.deepEqual(fixture.getData().packages, [savedInitiative]);
  assert.deepEqual(fixture.dialogDefaults, [null]);
  assert.equal(fixture.saveErrors[0], "");
});

test("initiative edit metadata and existing save behavior remain present", async () => {
  const [dialog, commands] = await Promise.all([
    readFile(dialogPath, "utf8"),
    readFile(commandPath, "utf8"),
  ]);

  assert.match(dialog, /approvalStatus/);
  assert.match(dialog, /approvalRevision/);
  assert.match(dialog, /decisionReason/);
  assert.match(dialog, /Initiative bearbeiten/);
  assert.match(dialog, /isEdit\s+\? "Speichern"/);
  assert.match(commands, /source !== "supabase" \|\| isEdit/);
  assert.match(commands, /data\.packages\.find\(\(original\) => original\.id === draft\.id\)/);
});
