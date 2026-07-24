import assert from "node:assert/strict";
import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const presentation = await loadTranspiledModule(
  "src/features/tasks/model/task-detail-presentation.ts",
  {
    "@/lib/status": {
      normalizeStatus: (status) => {
        if (status === "done" || status === "Erledigt") return "Erledigt";
        return status || "Offen";
      },
    },
  },
);

const {
  buildQuickSubIssueCreationDraft,
  buildTaskOverviewDraft,
  isUsefulTaskActivity,
  partitionSubIssues,
  repairTaskActivityText,
  safeEvidenceHost,
  taskOverviewIsDirty,
  taskOverviewPatch,
  uniqueRelationshipCount,
  visibleTaskActivityCount,
} = presentation;

const fullPermissions = {
  canEditBrief: true,
  canEditChecklist: true,
  canEditEvidence: true,
  canEditNotes: true,
};

function task(overrides = {}) {
  return {
    id: 42,
    title: "Clarify reporting",
    description: "Legacy description",
    problemStatement: "Current problem",
    intendedOutcome: "Clear weekly reporting",
    scopeConstraints: "Planning UI only",
    acceptanceCriteria: "The report is readable",
    evidenceRequired: "Screenshot",
    evidenceLink: "https://example.com/evidence",
    evidenceLinks: ["https://example.com/evidence"],
    definitionOfDone: "Founder review completed",
    note: "Keep the scope narrow",
    status: "Offen",
    milestoneId: "milestone-7",
    packageId: "package-3",
    workstream: "Founder Ops",
    startDate: "2026-07-14",
    endDate: "2026-07-18",
    deadline: "2026-07-18",
    githubRepo: "findmydoc-platform/management",
    ...overrides,
  };
}

test("buildTaskOverviewDraft uses the description fallback and empty optional values", () => {
  const draft = buildTaskOverviewDraft(
    task({
      problemStatement: "",
      intendedOutcome: undefined,
      scopeConstraints: undefined,
      acceptanceCriteria: undefined,
      evidenceRequired: undefined,
      evidenceLink: undefined,
      evidenceLinks: [],
      definitionOfDone: undefined,
      note: undefined,
    }),
  );

  assert.deepEqual(draft, {
    title: "Clarify reporting",
    problemStatement: "Legacy description",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    evidenceLinks: [],
    definitionOfDone: "",
    note: "",
  });
  assert.equal(
    buildTaskOverviewDraft(task({ problemStatement: "Explicit problem" })).problemStatement,
    "Explicit problem",
  );
});

test("taskOverviewPatch and taskOverviewIsDirty ignore normalized whitespace-only changes", () => {
  const baseline = task({ note: "Line one\nLine two" });
  const draft = {
    ...buildTaskOverviewDraft(baseline),
    note: "Line one\r\nLine two   ",
  };

  assert.deepEqual(taskOverviewPatch(baseline, draft, fullPermissions), {});
  assert.equal(taskOverviewIsDirty(baseline, draft, fullPermissions), false);
});

test("taskOverviewPatch includes only changed fields allowed by permissions", () => {
  const baseline = task();
  const draft = {
    ...buildTaskOverviewDraft(baseline),
    title: "Changed title",
    acceptanceCriteria: "Changed checklist",
    evidenceLinks: ["https://proof.example/evidence", ""],
    note: "Changed note",
  };
  const evidenceOnlyPermissions = {
    canEditBrief: false,
    canEditChecklist: false,
    canEditEvidence: true,
    canEditNotes: false,
  };

  assert.deepEqual(taskOverviewPatch(baseline, draft, evidenceOnlyPermissions), {
    evidenceLinks: ["https://proof.example/evidence"],
  });
  assert.equal(taskOverviewIsDirty(baseline, draft, evidenceOnlyPermissions), true);
  assert.deepEqual(
    taskOverviewPatch(baseline, draft, {
      canEditBrief: false,
      canEditChecklist: false,
      canEditEvidence: false,
      canEditNotes: false,
    }),
    {},
  );
});

test("partitionSubIssues separates normalized completed statuses and preserves order", () => {
  const openOne = task({ id: 1, status: "Offen" });
  const completedOne = task({ id: 2, status: "done" });
  const openTwo = task({ id: 3, status: "In Arbeit" });
  const completedTwo = task({ id: 4, status: "Erledigt" });

  assert.deepEqual(partitionSubIssues([openOne, completedOne, openTwo, completedTwo]), {
    open: [openOne, openTwo],
    completed: [completedOne, completedTwo],
  });
});

test("uniqueRelationshipCount counts the normalized rendered relationship groups", () => {
  const relation = (id, linkedTaskId) => ({ relation: { id }, linkedTaskId });

  assert.equal(
    uniqueRelationshipCount({
      waitsOn: [relation(1, "task-a"), relation(2, "task-b")],
      blocks: [relation(3, "task-c")],
      related: [],
    }),
    3,
  );
  assert.equal(uniqueRelationshipCount({ waitsOn: [], blocks: [], related: [] }), 0);
});

test("activity helpers repair text, filter noise, and count visible entries", () => {
  assert.equal(
    repairTaskActivityText("PrioritÃ¤t geÃ¤ndert Â· ZustÃ¤ndigkeit"),
    "Priorität geändert · Zuständigkeit",
  );
  assert.equal(isUsefulTaskActivity(""), false);
  assert.equal(isUsefulTaskActivity("Aufgabe aktualisiert"), false);
  assert.equal(isUsefulTaskActivity("Unwichtige interne Änderung"), false);
  assert.equal(isUsefulTaskActivity("PrioritÃ¤t geÃ¤ndert"), true);
  assert.equal(isUsefulTaskActivity("GitHub-Sync erfolgreich"), true);

  assert.equal(
    visibleTaskActivityCount({
      activities: [
        { message: "Aufgabe aktualisiert" },
        { message: "Status geändert: Offen → In Arbeit" },
        { message: "Unwichtige interne Änderung" },
        { message: "Evidence hinzugefügt" },
      ],
      comments: [{ id: 1 }],
      externalComments: [{ id: 2 }],
    }),
    4,
  );
});

test("safeEvidenceHost accepts only HTTP(S) URLs and removes a leading www", () => {
  assert.equal(safeEvidenceHost("https://www.drive.google.com/file/123"), "drive.google.com");
  assert.equal(safeEvidenceHost("http://subdomain.example.com:8080/proof"), "subdomain.example.com");
  assert.equal(safeEvidenceHost("ftp://example.com/proof"), "");
  assert.equal(safeEvidenceHost("javascript:alert(1)"), "");
  assert.equal(safeEvidenceHost("not a URL"), "");
  assert.equal(safeEvidenceHost(""), "");
});

test("buildQuickSubIssueCreationDraft trims the title and inherits parent context", () => {
  assert.deepEqual(
    buildQuickSubIssueCreationDraft({
      assignee: "sebastian",
      creationRequestId: "request-9",
      parent: task(),
      title: "  Prepare founder summary  ",
    }),
    {
      creationRequestId: "request-9",
      title: "Prepare founder summary",
      description: "",
      problemStatement: "",
      intendedOutcome: "",
      scopeConstraints: "",
      acceptanceCriteria: "",
      evidenceRequired: "",
      taskType: "sub_issue",
      parentTaskId: 42,
      milestoneId: "milestone-7",
      packageId: "package-3",
      sprintId: "",
      assignee: "sebastian",
      priority: "P2",
      status: "Offen",
      workstream: "Founder Ops",
      startDate: "2026-07-14",
      endDate: "2026-07-18",
      deadline: "2026-07-18",
      hours: 2,
      definitionOfDone: "",
      createGitHubIssue: false,
      githubRepo: "findmydoc-platform/management",
      approveNow: false,
      relationType: "blocked_by",
      relatedTaskId: "",
      relationNote: "",
    },
  );

  const fallbackDraft = buildQuickSubIssueCreationDraft({
    assignee: "",
    creationRequestId: "request-10",
    parent: task({
      milestoneId: undefined,
      workstream: undefined,
      startDate: undefined,
      endDate: undefined,
      deadline: undefined,
      githubRepo: undefined,
    }),
    title: "Fallbacks",
  });

  assert.equal(fallbackDraft.milestoneId, "");
  assert.equal(fallbackDraft.workstream, "");
  assert.equal(fallbackDraft.startDate, "");
  assert.equal(fallbackDraft.endDate, "");
  assert.equal(fallbackDraft.deadline, "");
  assert.equal(fallbackDraft.githubRepo, "");
});
