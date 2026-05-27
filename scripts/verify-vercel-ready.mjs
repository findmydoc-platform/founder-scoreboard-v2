import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const requiredFiles = [
  "package.json",
  "next.config.ts",
  "src/app/page.tsx",
  "src/app/api/health/route.ts",
  "src/lib/supabase.ts",
  ".env.example",
  ".github/dependabot.yml",
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
  "GOOGLE_CHAT_DELIVERY_ENABLED",
];

const vercelProjectFile = ".vercel/project.json";

async function read(path) {
  return readFile(path, "utf8");
}

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Missing required file: ${file}`);
}

const packageJson = JSON.parse(await read("package.json"));
for (const script of ["build", "start", "lint", "test", "verify:vercel-ready", "verify:google-chat"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json missing script: ${script}`);
}

if (!packageJson.dependencies?.next) failures.push("Next.js dependency missing.");
if (!packageJson.dependencies?.["@supabase/supabase-js"]) failures.push("Supabase client dependency missing.");

const nextConfig = await read("next.config.ts");
if (!nextConfig.includes("avatars.githubusercontent.com")) {
  failures.push("next.config.ts must allow GitHub avatar images.");
}

const envExample = await read(".env.example");
for (const key of requiredEnvKeys) {
  if (!new RegExp(`^${key}=`, "m").test(envExample)) failures.push(`.env.example missing ${key}`);
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
for (const marker of ["vercel link", "vercel build --prod", "vercel deploy --prebuilt --prod", "Supabase Auth", "Domain Cutover", "GOOGLE_CHAT_DELIVERY_ENABLED=false"]) {
  if (!deploymentDoc.includes(marker)) failures.push(`docs/vercel-deployment.md missing: ${marker}`);
}

const skill = await read("skills/fmd-vercel-readiness/SKILL.md");
for (const marker of ["Vercel CLI", "REQUIRE_SUPABASE_AUTH=true", "GOOGLE_CHAT_DELIVERY_ENABLED=false", "Domain Cutover", "Deletion Safety"]) {
  if (!skill.includes(marker)) failures.push(`fmd-vercel-readiness skill missing: ${marker}`);
}

const ciWorkflowPresent = existsSync(".github/workflows/ci.yml");
if (ciWorkflowPresent) {
  const ci = await read(".github/workflows/ci.yml");
  for (const marker of ["npm ci", "node tests/platform-contract.test.mjs", "npm run build", "npm run verify:release"]) {
    if (!ci.includes(marker)) failures.push(`.github/workflows/ci.yml missing: ${marker}`);
  }
}

const localProjectLinked = existsSync(vercelProjectFile);
const manualNextSteps = [];
if (!localProjectLinked) {
  manualNextSteps.push("Run `vercel login` from fmd-planning and complete the browser login.");
  manualNextSteps.push("Run `vercel link --yes --project founder-ops` after login.");
  manualNextSteps.push("Run `vercel pull --yes --environment=production` once the project is linked.");
}

if (failures.length) {
  console.error(`Vercel readiness failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  status: localProjectLinked ? "ready-for-vercel-build-preflight" : "ready-for-vercel-cli-preflight",
  project: "founder-ops",
  rootDirectory: "fmd-planning",
  requiredEnvKeys,
  localProjectLinked,
  vercelProjectFile,
  manualNextSteps,
  checks: {
    files: requiredFiles.length,
    scripts: ["build", "start", "lint", "test", "verify:vercel-ready", "verify:google-chat"],
    ciWorkflowPresent,
    healthRoute: true,
    deploymentDoc: true,
    skill: "fmd-vercel-readiness",
  },
}, null, 2));
