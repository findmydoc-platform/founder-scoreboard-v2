import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import { readFile } from "node:fs/promises";
import { readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("fullscreen and planning panel use one task detail surface", async () => {
  const route = await readFile("src/app/tasks/[id]/page.tsx", "utf8");
  const detailDataRoute = await readFile("src/app/api/tasks/[id]/detail-data/route.ts", "utf8");
  const page = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");
  const panel = await readFile("src/features/tasks/organisms/task-detail-panel.tsx", "utf8");
  const surface = await readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8");
  const controller = await readFile("src/features/tasks/hooks/use-task-detail-controller.ts", "utf8");
  const panelHeader = await readFile("src/features/tasks/molecules/task-detail-panel-header.tsx", "utf8");
  const operationalHeader = await readFile("src/features/tasks/molecules/task-detail-operational-header.tsx", "utf8");
  const tabs = await readFile("src/features/tasks/molecules/task-detail-tabs.tsx", "utf8");
  const ui = await readPlanningSurface();

  assert.match(route, /loadTaskDetailData\(supabase, id\)/);
  assert.match(route, /SeedTaskDetailPage/);
  assert.match(route, /source === "seed"/);
  assert.match(detailDataRoute, /\["ceo", "founder", "deputy", "viewer"\]/);
  assert.match(page, /TaskDetailSurface/);
  assert.match(page, /usePlanningAppController/);
  assert.match(page, /PlanningOverlayLayer/);
  assert.match(panel, /TaskDetailSurface/);
  assert.equal((page.match(/<TaskDetailSurface/g) || []).length, 1);
  assert.equal((panel.match(/<TaskDetailSurface/g) || []).length, 1);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /bg-slate-950\/20/);
  assert.match(panelHeader, /Große Ansicht/);
  assert.match(panelHeader, /href=\{`\/tasks\/\$\{task\.id\}`\}/);
  assert.match(surface, /TaskDetailOperationalHeader/);
  assert.match(surface, /TaskDetailTabs/);
  assert.match(surface, /TaskOverviewPanel/);
  assert.match(surface, /TaskRelationshipsSection/);
  assert.match(surface, /TaskDetailPanelSubIssuesSection/);
  assert.match(surface, /TaskDetailPanelBlockerSection/);
  assert.match(surface, /TaskDetailPanelSidebar/);
  assert.match(surface, /TaskCommentThread/);
  assert.match(operationalHeader, /Wartet auf/);
  assert.match(operationalHeader, /Andere warten hierauf/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /aria-selected/);
  assert.match(controller, /useTaskDetailController/);
  assert.match(controller, /saveOverview/);
  assert.match(controller, /taskOverviewPatch/);
  assert.match(controller, /overviewDirty/);
  assert.match(ui, /TaskDetailPanel/);
});

test("task detail loading avoids server waterfalls and defers inactive client features", async () => {
  const route = await readFile("src/app/tasks/[id]/page.tsx", "utf8");
  const overlays = await readFile("src/features/planning/organisms/planning-overlay-layer.tsx", "utf8");
  const tours = await readFile("src/features/product-tours/organisms/feature-tour-provider.tsx", "utf8");

  assert.match(route, /const planningDataPromise = getPlanningData/);
  assert.match(route, /const taskDetailPromise = supabase/);
  assert.match(route, /Promise\.all\(\[planningDataPromise, taskDetailPromise\]\)/);

  assert.match(overlays, /dynamic\(\s*\(\) =>\s*import\("@\/features\/planning\/organisms\/status-guard-dialog"\)/);
  assert.match(overlays, /dynamic\(\s*\(\) =>\s*import\("@\/features\/projects\/organisms\/initiative-dialog"\)/);
  assert.match(overlays, /dynamic\(\s*\(\) =>\s*import\("@\/features\/projects\/organisms\/milestone-dialog"\)/);
  assert.match(overlays, /dynamic\(\s*\(\) =>\s*import\("@\/features\/projects\/organisms\/milestone-delete-dialog"\)/);
  assert.match(overlays, /dynamic\(\s*\(\) =>\s*import\("@\/features\/tasks\/organisms\/new-task-dialog"\)/);
  assert.match(overlays, /dynamic\(\s*\(\) =>\s*import\("@\/features\/tasks\/organisms\/task-detail-panel"\)/);
  assert.doesNotMatch(overlays, /^import \{ (?:StatusGuardDialog|InitiativeDialog|NewTaskDialog|TaskDetailPanel) \}/m);
  assert.equal((overlays.match(/loading: \(\) => <OverlayLoadingFallback/g) || []).length, 6);
  assert.match(overlays, /role="status"/);
  assert.match(overlays, /aria-live="polite"/);
  assert.match(overlays, /Aufgabendetails werden geladen …/);

  assert.doesNotMatch(tours, /import \{ driver \} from "driver\.js"/);
  assert.match(tours, /const \{ driver \} = await import\("driver\.js"\)/);
  assert.ok(tours.indexOf("await waitForElement") < tours.indexOf('await import("driver.js")'));
  assert.match(tours, /Hilfe-Tour wird vorbereitet …/);
  assert.match(tours, /role=\{tourStatus\.kind === "error" \? "alert" : "status"\}/);
  assert.match(tours, /shouldReleaseFeatureTourClaim/);
});

test("shared task detail surface keeps github-like field saves and role gates", async () => {
  const surface = await readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8");
  const sidebar = await readFile("src/features/tasks/organisms/task-detail-panel-sidebar.tsx", "utf8");
  const operationalHeader = await readFile("src/features/tasks/molecules/task-detail-operational-header.tsx", "utf8");
  const overview = await readFile("src/features/tasks/organisms/task-overview-panel.tsx", "utf8");
  const permissions = await readFile("src/features/tasks/model/task-detail-permissions.ts", "utf8");
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const routeHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");

  assert.match(surface, /useTaskDetailController/);
  assert.match(surface, /overviewPermissions/);
  assert.match(overview, /permissions\.canEditBrief/);
  assert.match(overview, /permissions\.canEditEvidence/);
  assert.match(overview, /permission: "canEditNotes"/);
  assert.match(surface, /permissions\.canComment/);
  assert.match(operationalHeader, /Bearbeiten/);
  assert.match(overview, /Speichern/);
  assert.doesNotMatch(overview, /onBlur=/);
  assert.match(operationalHeader, /onUpdate\(\{ priority: value \}\)/);
  assert.match(sidebar, /onUpdate\(\{ sprintId: value \}\)/);
  assert.match(sidebar, /canManageReviewOwner/);
  assert.match(sidebar, /canManageFinalTaskStatus/);
  assert.match(permissions, /taskOwnedByProfile/);
  assert.match(permissions, /role !== "viewer"/);
  assert.match(route, /taskDetailPermissions/);
  assert.match(routeHelpers, /founderOwnedTaskUpdateFields/);
});

test("planning hierarchy treats sprint as time container and packages as initiatives", async () => {
  const migration = await readSupabaseSchemaContract();
  const initiativeMigration = await readSupabaseSchemaContract();
  const raciMigration = await readSupabaseSchemaContract();
  const docs = await readFile("docs/planning-hierarchy.md", "utf8");
  const initiativeRoute = await readFile("src/app/api/initiatives/route.ts", "utf8");
  const ui = await readPlanningSurface();
  const display = await readFile("src/lib/display.ts", "utf8");
  const projectsOverview = await readFile("src/features/projects/organisms/projects-overview.tsx", "utf8");
  const initiativeDialog = await readFile("src/features/projects/organisms/initiative-dialog.tsx", "utf8");
  const pkg = await readFile("package.json", "utf8");

  assert.match(migration, /create table if not exists packages[^]*milestone_id text/);
  assert.match(initiativeMigration, /owner_id/);
  assert.match(initiativeMigration, /success_criteria/);
  assert.match(initiativeMigration, /scope_constraints/);
  assert.match(raciMigration, /accountable_profile_id/);
  assert.match(raciMigration, /responsible_profile_ids/);
  assert.match(raciMigration, /consulted_profile_ids/);
  assert.match(raciMigration, /informed_profile_ids/);
  assert.match(docs, /Epic \/ Meilenstein[\s\S]*Initiative[\s\S]*Deliverable[\s\S]*Sub-Issue/);
  assert.match(docs, /Sprint ist ein Zeitcontainer/);
  assert.match(initiativeRoute, /requireOperationalLead/);
  assert.match(initiativeRoute, /Initiative-Owner ist erforderlich/);
  assert.match(initiativeRoute, /accountableProfileId/);
  assert.match(initiativeRoute, /responsibleProfileIds/);
  assert.match(docs, /nicht als Text-Snapshot in die Issue-Beschreibung/);
  assert.match(projectsOverview, /Epic \/ Meilenstein/);
  assert.match(projectsOverview, /Aktives Projekt/);
  assert.match(projectsOverview, /Erfolgskriterien/);
  assert.match(projectsOverview, /onEditInitiative/);
  assert.match(projectsOverview, /openMilestoneIds/);
  assert.match(projectsOverview, /openInitiativeIds/);
  assert.match(projectsOverview, /aria-expanded=\{isMilestoneOpen\}/);
  assert.match(projectsOverview, /InitiativeTreeItem/);
  assert.match(projectsOverview, /DeliverableTable/);
  assert.match(projectsOverview, /taskAssigneeLabel/);
  assert.match(projectsOverview, /TaskReferenceLink/);
  assert.match(projectsOverview, /onOpenTask/);
  assert.match(display, /initiativeMetaLabel/);
  assert.match(ui, /Initiative/);
  assert.match(ui, /InitiativeDialog/);
  assert.match(initiativeDialog, /Initiative-Brief/);
  assert.match(initiativeDialog, /Neue Initiative/);
  assert.match(initiativeDialog, /CustomDatePicker/);
  assert.match(initiativeDialog, /CustomSelect/);
  assert.match(ui, /expandedPackages/);
  assert.match(ui, /Alle einklappen/);
  assert.match(ui, /Alle ausklappen/);
  assert.match(ui, /aria-expanded=\{expanded\}/);
  assert.match(pkg, /verify:hierarchy/);
});

test("management repo cleanup plan protects legacy templates from deletion without approval", async () => {
  const plan = await readFile("docs/management-repo-v2-plan.md", "utf8");
  const deliverableTemplate = await readFile("docs/management-templates-v2/deliverable.yml", "utf8");
  const groupTemplate = await readFile("docs/management-templates-v2/initiative.yml", "utf8");
  const subIssueTemplate = await readFile("docs/management-templates-v2/sub-issue.yml", "utf8");

  assert.match(plan, /Keine Datei im Management-Repo löschen/);
  assert.match(plan, /Erst archivieren statt endgültig löschen/);
  assert.match(plan, /auto-triage\.yml/);
  assert.match(plan, /sprint-title-sync\.yml/);
  assert.match(deliverableTemplate, /GitHub ist Backup, nicht Quelle der Wahrheit/);
  assert.match(deliverableTemplate, /Acceptance Criteria/);
  assert.match(groupTemplate, /Epic \/ Meilenstein/);
  assert.match(subIssueTemplate, /nicht score-relevant/);
});
