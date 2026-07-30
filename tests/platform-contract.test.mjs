import { readFile } from "node:fs/promises";
import { readPlanningSurface } from "./helpers/planning-surface.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("working status stays ownership-bound while Sub-Issue final transitions are role-based", async () => {
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const routeHelpers = await readFile("src/features/tasks/model/task-route-update-helpers.ts", "utf8");
  const routePolicy = `${route}\n${routeHelpers}`;
  const app = await readPlanningSurface();
  const taskCard = await readFile("src/features/tasks/molecules/task-card.tsx", "utf8");
  const detailPanel = await readFile("src/features/tasks/organisms/task-detail-panel.tsx", "utf8");
  const detailSurface = await readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8");
  const detailPermissions = await readFile("src/features/tasks/model/task-detail-permissions.ts", "utf8");
  const operationalHeader = await readFile("src/features/tasks/molecules/task-detail-operational-header.tsx", "utf8");
  const statusControl = await readFile("src/features/tasks/atoms/task-status-control.tsx", "utf8");

  assert.match(routePolicy, /taskAssignedToProfile/);
  assert.match(routePolicy, /Founder können nur den Status ihrer eigenen Aufgaben ändern/);
  assert.match(routePolicy, /roleBasedFinalTransition/);
  assert.match(routePolicy, /validateSubIssueStatusParentApproval/);
  assert.match(app, /canChangeTaskStatus/);
  assert.match(app, /canManageFinalTaskStatus/);
  assert.match(app, /taskBelongsToProfile\(task, currentProfile\)/);
  assert.match(app, /onDragStart=\{canUpdateStatus && onDragStart \? onDragStart : undefined\}/);
  assert.doesNotMatch(taskCard, /TaskStatusControl|statusDisabled/);
  assert.match(detailPanel, /TaskDetailSurface/);
  assert.match(detailSurface, /permissions\.canUpdateStatus/);
  assert.match(detailSurface, /permissions\.canCompleteSubIssue/);
  assert.match(detailSurface, /permissions\.canReopenSubIssue/);
  assert.match(detailPermissions, /taskOwnedByProfile/);
  assert.match(detailPermissions, /canContributorManageSubIssueFinalStatus/);
  assert.match(operationalHeader, /TaskStatusControl/);
  assert.match(detailSurface, /taskStatusOptionsForPermissions/);
  assert.match(statusControl, /lockedReason/);
  assert.match(statusControl, /isTaskStatusChange/);
});

test("header overlays close on outside click and escape", async () => {
  const notifications = await readFile("src/features/notifications/organisms/notification-inbox.tsx", "utf8");
  const calendar = await readFile("src/features/events/molecules/header-event-calendar.tsx", "utf8");

  assert.match(notifications, /rootRef/);
  assert.match(notifications, /pointerdown/);
  assert.match(notifications, /keydown/);
  assert.match(notifications, /href="\/notifications"/);
  assert.match(calendar, /rootRef/);
  assert.match(calendar, /pointerdown/);
  assert.match(calendar, /Escape/);
});

test("deployment workflows keep validation, artifact creation, and production safety separate", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const vercelJson = JSON.parse(await readFile("vercel.json", "utf8"));
  const dependencyValidationWorkflow = await readFile(".github/workflows/dependency-validation.yml", "utf8");
  const previewWorkflow = await readFile(".github/workflows/deploy-preview.yml", "utf8");
  const productionWorkflow = await readFile(".github/workflows/deploy-production.yml", "utf8");
  const deployScript = await readFile(".github/scripts/deploy/vercel-deploy-prebuilt.sh", "utf8");

  assert.equal(vercelJson.framework, "nextjs");
  assert.equal(vercelJson.installCommand, "pnpm install --frozen-lockfile");
  assert.equal(vercelJson.buildCommand, "pnpm run build");
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.mjs");
  assert.equal(packageJson.scripts.lint, "eslint");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts["verify:migrations"], "node scripts/verify-supabase-migrations.mjs");
  assert.equal(packageJson.scripts["verify:product-updates"], "node scripts/verify-product-updates.mjs");

  assert.match(
    dependencyValidationWorkflow,
    /name: Dependency Validation[\s\S]*fetch-depth: 0[\s\S]*Verify Supabase Migration History[\s\S]*pnpm run verify:migrations[\s\S]*Verify Product Updates[\s\S]*PRODUCT_UPDATE_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.sha \}\}[\s\S]*pnpm run verify:product-updates[\s\S]*pnpm test[\s\S]*pnpm run lint[\s\S]*pnpm run build/,
  );

  assert.match(previewWorkflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(previewWorkflow, /Validate preview secrets/);
  assert.match(
    previewWorkflow,
    /if \[\[ "\$ready" != "true" \]\]; then[\s\S]*::error title=Preview deployment blocked[\s\S]*exit 1/,
  );
  assert.match(previewWorkflow, /if \[\[ "\$PREVIEW_READY" != "true" \]\]; then[\s\S]*\*\*Status\*\*: Failed/);
  assert.match(previewWorkflow, /pull --yes --environment=preview/);
  assert.match(previewWorkflow, /assert-vercel-project-binding\.sh/);
  assert.match(previewWorkflow, /build --target=preview/);
  assert.match(previewWorkflow, /vercel-deploy-prebuilt\.sh preview/);

  assert.match(productionWorkflow, /refs\/heads\/main/);
  assert.match(
    productionWorkflow,
    /Verify Supabase Migration History[\s\S]*pnpm run verify:migrations[\s\S]*Build Vercel Output[\s\S]*build --prod[\s\S]*Apply Supabase Migrations to Production[\s\S]*pnpm run deploy:supabase-migrations[\s\S]*Verify Production Database Security[\s\S]*pnpm run verify:database-security -- --production[\s\S]*Verify Production Supabase Schema[\s\S]*pnpm run verify:supabase[\s\S]*Verify Production Auth Mapping[\s\S]*pnpm run verify:auth[\s\S]*vercel-deploy-prebuilt\.sh production/,
  );

  assert.match(deployScript, /git archive HEAD/);
  assert.match(deployScript, /\.vercel\/output/);
  assert.match(deployScript, /Refusing to deploy: staging directory contains Git metadata\./);
  assert.match(deployScript, /--prebuilt/);
  assert.match(deployScript, /--target=preview/);
  assert.match(deployScript, /--prod/);
  assert.match(deployScript, /promote/);
  assert.match(deployScript, /already the current production deployment/);
  assert.match(deployScript, /readyStateReason/);
  assert.match(deployScript, /seatBlock/);
  assert.match(deployScript, /TEAM_ACCESS_REQUIRED/);
  assert.match(deployScript, /deploymentUrl=/);
});
