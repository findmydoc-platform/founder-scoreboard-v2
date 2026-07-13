import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const requiredFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "vercel.json",
  "next.config.ts",
  "src/app/page.tsx",
  "src/app/api/health/route.ts",
  "src/lib/supabase.ts",
  ".env.example",
  ".github/dependabot.yml",
  ".github/workflows/deploy-preview.yml",
  ".github/workflows/deploy-production.yml",
  ".github/workflows/purge-planning-trash.yml",
  ".github/scripts/deploy/vercel-deploy-prebuilt.sh",
  ".github/scripts/maintenance/purge-planning-trash.sh",
  ".github/workflows/send-release-google-chat.yml",
  "scripts/deploy-production-schema.mjs",
  "docs/vercel-deployment.md",
  "skills/fmd-vercel-readiness/SKILL.md",
];

const requiredEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REQUIRE_SUPABASE_AUTH",
  "APP_URL",
  "GITHUB_SYNC_OWNER",
  "GITHUB_SYNC_REPO",
  "GITHUB_APP_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CHAT_WEBHOOK_URL",
  "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_CHAT_PRIVATE_KEY",
  "GOOGLE_CHAT_DELIVERY_ENABLED",
  "FOUNDEROPS_DELIVERY_SECRET",
  "FOUNDEROPS_MAINTENANCE_SECRET",
];

const project = "founder-ops";
const rootDirectory = ".";
const productionDomain = "founder-ops.findmydoc.eu";
const googleChatDomain = "founderops.findmydoc.eu";
const githubEnvironments = ["preview", "production"];

async function read(path) {
  return readFile(path, "utf8");
}

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Missing required file: ${file}`);
}

const packageJson = JSON.parse(await read("package.json"));
const pnpmWorkspace = await read("pnpm-workspace.yaml");
for (const script of ["build", "start", "lint", "test", "verify:vercel-ready", "verify:google-chat", "verify:deploy", "vercel:build", "deploy:supabase-schema"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json missing script: ${script}`);
}
if (packageJson.packageManager !== "pnpm@10.13.1") failures.push("package.json must pin packageManager to pnpm@10.13.1.");
for (const marker of ["overrides:", "js-yaml: 4.3.0", "postcss: 8.5.15", "onlyBuiltDependencies:", "sharp", "unrs-resolver"]) {
  if (!pnpmWorkspace.includes(marker)) failures.push(`pnpm-workspace.yaml missing: ${marker}`);
}
if (!packageJson.scripts?.["verify:deploy"]?.includes("pnpm test")) failures.push("verify:deploy must run pnpm test.");
if (!packageJson.scripts?.["vercel:build"]?.includes("pnpm run verify:deploy")) failures.push("vercel:build must run verify:deploy before build.");
if (!packageJson.scripts?.["vercel:build"]?.includes("pnpm run build")) failures.push("vercel:build must run pnpm run build.");

if (!packageJson.dependencies?.next) failures.push("Next.js dependency missing.");
if (!packageJson.dependencies?.["@supabase/supabase-js"]) failures.push("Supabase client dependency missing.");

const vercelJson = JSON.parse(await read("vercel.json"));
if (vercelJson.framework !== "nextjs") failures.push("vercel.json must set framework to nextjs.");
if (vercelJson.installCommand !== "pnpm install --frozen-lockfile") failures.push("vercel.json must set installCommand to pnpm install --frozen-lockfile.");
if (vercelJson.buildCommand !== "pnpm run vercel:build") failures.push("vercel.json must set buildCommand to pnpm run vercel:build.");

const nextConfig = await read("next.config.ts");
if (!nextConfig.includes("avatars.githubusercontent.com")) {
  failures.push("next.config.ts must allow GitHub avatar images.");
}

const envExample = await read(".env.example");
for (const key of requiredEnvKeys) {
  if (!new RegExp(`^${key}=`, "m").test(envExample)) failures.push(`.env.example missing ${key}`);
}
if (/^GITHUB_SYNC_TOKEN=/m.test(envExample)) {
  failures.push(".env.example must not include GITHUB_SYNC_TOKEN; production sync must use GitHub App installation tokens.");
}

const supabase = await read("src/lib/supabase.ts");
if (!supabase.includes("SUPABASE_SERVICE_ROLE_KEY")) failures.push("Server Supabase client must support SUPABASE_SERVICE_ROLE_KEY.");
if (!supabase.includes("REQUIRE_SUPABASE_AUTH")) failures.push("Production auth gate env is missing.");

const page = await read("src/app/page.tsx");
const workspacePage = await read("src/app/(workspaces)/workspace-page.tsx");
if (!page.includes('dynamic = "force-dynamic"')) failures.push("Home page should force dynamic rendering for auth/data readiness.");
if (!page.includes("redirect(")) failures.push("Home page should redirect into routed workspaces.");
if (!workspacePage.includes("requiresSupabaseAuth")) failures.push("Workspace page should respect REQUIRE_SUPABASE_AUTH.");

const health = await read("src/app/api/health/route.ts");
for (const marker of ["status", "ready", "supabaseConfigured", "authRequired"]) {
  if (!health.includes(marker)) failures.push(`/api/health missing marker: ${marker}`);
}

const deploymentDoc = await read("docs/vercel-deployment.md");
for (const marker of [
  "GitHub Actions Deployment Workflow",
  "GitHub Actions",
  "deploy-preview.yml",
  "deploy-production.yml",
  "GitHub Environments",
  "`preview`",
  "`production`",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "SUPABASE_DB_PASSWORD",
  "deploy:supabase-schema",
  "Supabase Auth",
  "GOOGLE_CHAT_DELIVERY_ENABLED=false",
  productionDomain,
  "Operational event messages stay inside the application",
  "GitHub OAuth App owned by `findmydoc-platform`",
  "GitHub App Runtime",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_TOKEN_ENCRYPTION_KEY",
  "Do not configure a shared `GITHUB_SYNC_TOKEN`",
  "GitHub Actions job logs",
  "Git-metadata-free runner directory",
  "Vercel Hobby Private Repository Author Block",
  "readyStateReason",
  "seatBlock",
]) {
  if (!deploymentDoc.includes(marker)) failures.push(`docs/vercel-deployment.md missing: ${marker}`);
}
for (const banned of ["vercel login", "vercel link", "vercel deploy", "vercel build --prod", "vercel inspect", "vercel logs"]) {
  if (deploymentDoc.includes(banned)) failures.push(`docs/vercel-deployment.md must not include: ${banned}`);
}

const skill = await read("skills/fmd-vercel-readiness/SKILL.md");
for (const marker of [
  "GitHub Actions",
  "GitHub Actions job logs",
  "REQUIRE_SUPABASE_AUTH=true",
  "GOOGLE_CHAT_DELIVERY_ENABLED=false",
  "preview",
  "production",
  productionDomain,
  "Git-metadata-free temporary directory",
  "AI Guidance: Vercel Hobby Private Author Block",
  "TEAM_ACCESS_REQUIRED",
  "readyStateReason",
  "seatBlock",
]) {
  if (!skill.includes(marker)) failures.push(`fmd-vercel-readiness skill missing: ${marker}`);
}
for (const banned of ["vercel login", "vercel link", "vercel deploy", "vercel build --prod", "vercel inspect", "vercel logs"]) {
  if (skill.includes(banned)) failures.push(`fmd-vercel-readiness skill must not include: ${banned}`);
}

const workspaceRules = await read("AGENTS.md");
for (const marker of ["GitHub App installation tokens", "GitHub App user tokens", "Never expose raw GitHub tokens"]) {
  if (!workspaceRules.includes(marker)) failures.push(`AGENTS.md missing Vercel/security marker: ${marker}`);
}

const previewWorkflow = await read(".github/workflows/deploy-preview.yml");
for (const marker of [
  "branches: [main]",
  "github.event_name == 'push'",
  "github.event.pull_request.head.repo.full_name == github.repository",
  "Validate preview secrets",
  "preview_guard",
  "name: preview",
  "url: ${{ steps.vercel_preview.outputs.deploymentUrl }}",
  "pull --yes --environment=preview",
  "Build Vercel Output",
  "build --target=preview",
  "vercel-deploy-prebuilt.sh preview",
]) {
  if (!previewWorkflow.includes(marker)) failures.push(`deploy-preview.yml missing: ${marker}`);
}

const productionWorkflow = await read(".github/workflows/deploy-production.yml");
const trashPurgeWorkflow = await read(".github/workflows/purge-planning-trash.yml");
const trashPurgeScript = await read(".github/scripts/maintenance/purge-planning-trash.sh");
const googleChatReleaseWorkflow = await read(".github/workflows/send-release-google-chat.yml");
const productionSchemaDeployScript = await read("scripts/deploy-production-schema.mjs");
const productionSchemaConnection = await read("scripts/lib/production-schema-connection.mjs");
const productionSchemaDeployContract = `${productionSchemaDeployScript}\n${productionSchemaConnection}`;

for (const marker of [
  'cron: "15 3 * * *"',
  "workflow_dispatch",
  "name: production",
  "cancel-in-progress: false",
  "FOUNDEROPS_MAINTENANCE_SECRET",
  "purge-planning-trash.sh",
]) {
  if (!trashPurgeWorkflow.includes(marker)) failures.push(`purge-planning-trash.yml missing: ${marker}`);
}
for (const marker of [
  "sleep 45",
  "backoffs=(0 45 90 180)",
  "--fail-with-body",
  "/api/health",
  "/api/maintenance/planning-trash/github-lifecycle",
  "/api/maintenance/planning-trash/purge",
  "x-founderops-maintenance-secret",
]) {
  if (!trashPurgeScript.includes(marker)) failures.push(`purge-planning-trash.sh missing: ${marker}`);
}
if (!/name: Build Vercel Output[\s\S]*NEXT_PUBLIC_SUPABASE_URL:/.test(productionWorkflow)) {
  failures.push("deploy-production.yml must expose NEXT_PUBLIC_SUPABASE_URL during the Vercel build step.");
}
if (!/name: Build Vercel Output[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY:/.test(productionWorkflow)) {
  failures.push("deploy-production.yml must expose NEXT_PUBLIC_SUPABASE_ANON_KEY during the Vercel build step.");
}
if (!/name: Verify Production Supabase Schema[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY:[\s\S]*pnpm run verify:supabase/.test(productionWorkflow)) {
  failures.push("deploy-production.yml must expose NEXT_PUBLIC_SUPABASE_ANON_KEY during schema verification.");
}
for (const marker of [
  "workflow_dispatch",
  "refs/heads/main",
  "name: production",
  "url: ${{ steps.vercel_production.outputs.deploymentUrl }}",
  "pull --yes --environment=production",
  "build --prod",
  "Deploy Supabase Schema to Production",
  "SCHEMA_DEPLOY_TARGET: production",
  "SUPABASE_DB_HOST",
  "SUPABASE_DB_USER",
  "SUPABASE_DB_PASSWORD",
  "pnpm run deploy:supabase-schema",
  "Verify Production Supabase Schema",
  "pnpm run verify:supabase",
  "vercel-deploy-prebuilt.sh production",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "GITHUB_SYNC_OWNER: findmydoc-platform",
]) {
  if (!productionWorkflow.includes(marker)) failures.push(`deploy-production.yml missing: ${marker}`);
}
if (!/pnpm run deploy:supabase-schema[\s\S]*pnpm run verify:supabase[\s\S]*vercel-deploy-prebuilt\.sh production/.test(productionWorkflow)) {
  failures.push("deploy-production.yml must deploy and verify Supabase schema before Vercel production deploy.");
}

const deployScript = await read(".github/scripts/deploy/vercel-deploy-prebuilt.sh");
for (const marker of [
  "RUNNER_TEMP",
  "git archive HEAD",
  ".vercel/output",
  ".vercel/project.json",
  "package.json",
  "pnpm-lock.yaml",
  "node_modules",
  ".next/package.json",
  "Refusing to deploy: staging directory contains Git metadata.",
  "--prebuilt",
  "--no-wait",
  "--target=preview",
  "--prod",
  "inspect",
  "readyStateReason",
  "errorMessage",
  "seatBlock",
  "TEAM_ACCESS_REQUIRED",
  "deploymentUrl=",
]) {
  if (!deployScript.includes(marker)) failures.push(`vercel-deploy-prebuilt.sh missing: ${marker}`);
}

for (const marker of [
  "SCHEMA_DEPLOY_TARGET",
  "production",
  "refs/heads/main",
  "SUPABASE_DB_HOST",
  "SUPABASE_DB_USER",
  "SUPABASE_DB_PASSWORD",
  "supabase/schema.sql",
  "notify pgrst, 'reload schema'",
]) {
  if (!productionSchemaDeployContract.includes(marker)) failures.push(`production schema deploy contract missing: ${marker}`);
}
for (const marker of ["drop\\s+table", "drop\\s+schema", "truncate", "drop\\s+column"]) {
  if (!productionSchemaDeployScript.includes(marker)) failures.push(`deploy-production-schema.mjs missing destructive DDL guard: ${marker}`);
}

for (const marker of [
  "name: Send Release Google Chat",
  "workflow_dispatch",
  "message_payload_json",
  "release_tag",
  "permissions: {}",
  "cancel-in-progress: false",
  "GOOGLE_CHAT_WEBHOOK_URL",
  "messageReplyOption",
  "Google Chat Release Notification",
]) {
  if (!googleChatReleaseWorkflow.includes(marker)) failures.push(`send-release-google-chat.yml missing: ${marker}`);
}
for (const banned of [
  "/api/notifications/generate-digest",
  "/api/notifications/deliver",
  "FOUNDEROPS_DELIVERY_SECRET",
  "x-founderops-delivery-secret",
  "cron: \"0 7 * * 1-5\"",
]) {
  if (googleChatReleaseWorkflow.includes(banned)) failures.push(`send-release-google-chat.yml must not include: ${banned}`);
}

const ciWorkflowPresent = existsSync(".github/workflows/ci.yml");
if (ciWorkflowPresent) {
  const ci = await read(".github/workflows/ci.yml");
  for (const marker of ["pnpm install --frozen-lockfile", "node --test tests/*.test.mjs", "pnpm run build", "pnpm run verify:release"]) {
    if (!ci.includes(marker)) failures.push(`.github/workflows/ci.yml missing: ${marker}`);
  }
}

if (failures.length) {
  console.error(`Vercel readiness failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  status: "ready-for-github-actions-deployment",
  project,
  rootDirectory,
  productionDomain,
  googleChatDomain,
  githubEnvironments,
  requiredEnvKeys,
  checks: {
    files: requiredFiles.length,
    scripts: ["build", "start", "lint", "test", "verify:vercel-ready", "verify:google-chat", "verify:deploy", "vercel:build", "deploy:supabase-schema"],
    workflows: ["deploy-preview", "deploy-production", "send-release-google-chat"],
    healthRoute: true,
    deploymentDoc: true,
    skill: "fmd-vercel-readiness",
  },
}, null, 2));
