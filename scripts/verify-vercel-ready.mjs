import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const requiredFiles = [
  "package.json",
  "vercel.json",
  "next.config.ts",
  "src/app/page.tsx",
  "src/app/api/health/route.ts",
  "src/lib/supabase.ts",
  ".env.example",
  ".github/dependabot.yml",
  ".github/workflows/deploy-preview.yml",
  ".github/workflows/deploy-production.yml",
  ".github/scripts/deploy/vercel-deploy-prebuilt.sh",
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
  "GOOGLE_CHAT_WEBHOOK_URL",
  "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_CHAT_PRIVATE_KEY",
  "GOOGLE_CHAT_DELIVERY_ENABLED",
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
for (const script of ["build", "start", "lint", "test", "verify:vercel-ready", "verify:google-chat", "verify:deploy", "vercel:build"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json missing script: ${script}`);
}
if (!packageJson.scripts?.["verify:deploy"]?.includes("npm test")) failures.push("verify:deploy must run npm test.");
if (!packageJson.scripts?.["vercel:build"]?.includes("npm run verify:deploy")) failures.push("vercel:build must run verify:deploy before build.");
if (!packageJson.scripts?.["vercel:build"]?.includes("npm run build")) failures.push("vercel:build must run npm run build.");

if (!packageJson.dependencies?.next) failures.push("Next.js dependency missing.");
if (!packageJson.dependencies?.["@supabase/supabase-js"]) failures.push("Supabase client dependency missing.");

const vercelJson = JSON.parse(await read("vercel.json"));
if (vercelJson.framework !== "nextjs") failures.push("vercel.json must set framework to nextjs.");
if (vercelJson.installCommand !== "npm ci") failures.push("vercel.json must set installCommand to npm ci.");
if (vercelJson.buildCommand !== "npm run vercel:build") failures.push("vercel.json must set buildCommand to npm run vercel:build.");

const nextConfig = await read("next.config.ts");
if (!nextConfig.includes("avatars.githubusercontent.com")) {
  failures.push("next.config.ts must allow GitHub avatar images.");
}

const envExample = await read(".env.example");
for (const key of requiredEnvKeys) {
  if (!new RegExp(`^${key}=`, "m").test(envExample)) failures.push(`.env.example missing ${key}`);
}
if (/^GITHUB_SYNC_TOKEN=/m.test(envExample)) {
  failures.push(".env.example must not include GITHUB_SYNC_TOKEN; production sync must use the logged-in GitHub user provider token.");
}

const supabase = await read("src/lib/supabase.ts");
if (!supabase.includes("SUPABASE_SERVICE_ROLE_KEY")) failures.push("Server Supabase client must support SUPABASE_SERVICE_ROLE_KEY.");
if (!supabase.includes("REQUIRE_SUPABASE_AUTH")) failures.push("Production auth gate env is missing.");

const page = await read("src/app/page.tsx");
if (!page.includes('dynamic = "force-dynamic"')) failures.push("Home page should force dynamic rendering for auth/data readiness.");
if (!page.includes("requiresSupabaseAuth")) failures.push("Home page should respect REQUIRE_SUPABASE_AUTH.");

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
  "Supabase Auth",
  "GOOGLE_CHAT_DELIVERY_ENABLED=false",
  productionDomain,
  "Operational event messages stay inside the application",
  "GitHub OAuth App owned by `findmydoc-platform`",
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
for (const marker of ["provider_token", "Never persist or log provider tokens"]) {
  if (!workspaceRules.includes(marker)) failures.push(`AGENTS.md missing Vercel/security marker: ${marker}`);
}

const previewWorkflow = await read(".github/workflows/deploy-preview.yml");
for (const marker of [
  "branches: [main]",
  "github.event.pull_request.head.repo.full_name == github.repository",
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
if (!/name: Build Vercel Output[\s\S]*NEXT_PUBLIC_SUPABASE_URL:/.test(productionWorkflow)) {
  failures.push("deploy-production.yml must expose NEXT_PUBLIC_SUPABASE_URL during the Vercel build step.");
}
if (!/name: Build Vercel Output[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY:/.test(productionWorkflow)) {
  failures.push("deploy-production.yml must expose NEXT_PUBLIC_SUPABASE_ANON_KEY during the Vercel build step.");
}
for (const marker of [
  "workflow_dispatch",
  "refs/heads/main",
  "name: production",
  "url: ${{ steps.vercel_production.outputs.deploymentUrl }}",
  "pull --yes --environment=production",
  "build --prod",
  "vercel-deploy-prebuilt.sh production",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "GITHUB_SYNC_OWNER: findmydoc-platform",
]) {
  if (!productionWorkflow.includes(marker)) failures.push(`deploy-production.yml missing: ${marker}`);
}

const deployScript = await read(".github/scripts/deploy/vercel-deploy-prebuilt.sh");
for (const marker of [
  "RUNNER_TEMP",
  ".vercel/output",
  ".vercel/project.json",
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

const ciWorkflowPresent = existsSync(".github/workflows/ci.yml");
if (ciWorkflowPresent) {
  const ci = await read(".github/workflows/ci.yml");
  for (const marker of ["npm ci", "node --test tests/*.test.mjs", "npm run build", "npm run verify:release"]) {
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
    scripts: ["build", "start", "lint", "test", "verify:vercel-ready", "verify:google-chat", "verify:deploy", "vercel:build"],
    workflows: ["deploy-preview", "deploy-production"],
    healthRoute: true,
    deploymentDoc: true,
    skill: "fmd-vercel-readiness",
  },
}, null, 2));
