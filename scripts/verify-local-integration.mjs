import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const supabaseCli = resolve(root, "node_modules/.bin/supabase");
const nextCli = resolve(root, "node_modules/.bin/next");
const localDevelopmentScript = resolve(root, "scripts/local-development.mjs");
const seedSourcePath = resolve(root, "src/lib/seed/source.json");
const appOrigin = "http://127.0.0.1:3012";

function parseEnvFile(content) {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function localStatus() {
  const status = JSON.parse(execFileSync(supabaseCli, ["status", "-o", "json"], { cwd: root, encoding: "utf8" }));
  const api = new URL(status.API_URL);
  const database = new URL(status.DB_URL);
  if (api.hostname !== "127.0.0.1" || api.port !== "54321" || database.hostname !== "127.0.0.1" || database.port !== "54322") {
    throw new Error("Local integration tests refuse non-loopback Supabase targets.");
  }
  return status;
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Next.js local integration server stopped before becoming ready.");
    try {
      const response = await fetch(`${appOrigin}/api/planning-data?workspace=planning`);
      if (response.status === 401) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("Next.js local integration server did not become ready within 60 seconds.");
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, received ${response.status}.`);
}

async function apiRequest(path, token, profileId, init = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (profileId) headers.set("x-fmd-dev-profile-id", profileId);
  return fetch(`${appOrigin}${path}`, { ...init, headers });
}

async function verifySeedConvergence(status, source) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      "insert into profiles (id,name,role,platform_role) values ($1,$2,'member','founder')",
      ["local-stale-profile", "Local Stale Profile"],
    );
    await client.query(
      "insert into fmd_tools (id,name,category,kind) values ($1,$2,'tool','internal')",
      ["local-stale-tool", "Local Stale Tool"],
    );
    await client.query(
      "insert into sprints (id,project_id,name,status) values ($1,$2,$3,'planning')",
      ["local-stale-sprint", source.project.id, "Local Stale Sprint"],
    );
    await client.query(
      "insert into packages (id,project_id,title) values ($1,$2,$3)",
      ["local-stale-package", source.project.id, "Local Stale Initiative"],
    );
    await client.query(
      "insert into tasks (id,project_id,package_id,title,status,priority,sprint_id,task_type,score_relevant,approval_status) values ($1,$2,$3,$4,'Offen','P3',$5,'deliverable',true,'approved')",
      ["local-stale-task", source.project.id, "local-stale-package", "Local Stale Task", "local-stale-sprint"],
    );
    await client.query(
      "insert into meetings (sprint_id,title,meeting_at) values ($1,$2,now())",
      ["local-stale-sprint", "Local Stale Meeting"],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  execFileSync(process.execPath, [localDevelopmentScript, "seed"], { cwd: root, stdio: "inherit" });

  const verifier = new pg.Client({ connectionString: status.DB_URL });
  await verifier.connect();
  try {
    const result = await verifier.query(
      `select
        (select count(*)::integer from profiles) as profiles,
        (select count(*)::integer from fmd_tools) as tools,
        (select count(*)::integer from packages where project_id=$1) as packages,
        (select count(*)::integer from tasks where project_id=$1) as tasks,
        (select count(*)::integer from sprints where project_id=$1) as sprints,
        (select count(*)::integer from meetings where sprint_id in (select id from sprints where project_id=$1)) as meetings,
        (select github_project_owner from projects where id=$1) as github_project_owner,
        (select github_project_number from projects where id=$1) as github_project_number`,
      [source.project.id],
    );
    const row = result.rows[0];
    const expected = {
      profiles: source.profiles.length,
      tools: source.fmdTools.length,
      packages: source.packages.length,
      tasks: source.tasks.length,
      sprints: source.sprints.length,
      meetings: source.meetings.length,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (row[key] !== value) throw new Error(`Local seed did not converge ${key}: expected ${value}, received ${row[key]}.`);
    }
    if (row.github_project_owner !== source.project.githubProjectOwner) {
      throw new Error("Local seed did not persist the GitHub Project owner.");
    }
    if (row.github_project_number !== source.project.githubProjectNumber) {
      throw new Error("Local seed did not persist the GitHub Project number.");
    }
  } finally {
    await verifier.end();
  }
}

async function verifyGitHubProjectRoleBoundary(status, source) {
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("savepoint deputy_attempt");
    try {
      await client.query(
        "select public.update_founderops_github_project_transaction($1,$2,$3,$2,$3,$4,$5,$6)",
        [
          source.project.id,
          source.project.githubProjectOwner,
          source.project.githubProjectNumber,
          "local-deputy",
          "127.0.0.1",
          "local-integration-verifier",
        ],
      );
      throw new Error("Deputy unexpectedly changed the global GitHub Project through the database RPC.");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Deputy unexpectedly")) throw error;
      if (error?.code !== "P0005") throw error;
    }
    await client.query("rollback to savepoint deputy_attempt");
    await client.query(
      "select public.update_founderops_github_project_transaction($1,$2,$3,$2,$3,$4,$5,$6)",
      [
        source.project.id,
        source.project.githubProjectOwner,
        source.project.githubProjectNumber,
        "volkan",
        "127.0.0.1",
        "local-integration-verifier",
      ],
    );
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

async function main() {
  localStatus();
  execFileSync(process.execPath, [localDevelopmentScript, "seed"], { cwd: root, stdio: "inherit" });
  const status = localStatus();
  const source = JSON.parse(readFileSync(seedSourcePath, "utf8"));
  await verifySeedConvergence(status, source);
  await verifyGitHubProjectRoleBoundary(status, source);
  const localEnv = parseEnvFile(readFileSync(resolve(root, ".env.local"), "utf8"));
  const app = spawn(nextCli, ["dev", "--hostname", "127.0.0.1", "--port", "3012"], {
    cwd: root,
    env: { ...process.env, ...localEnv, APP_URL: appOrigin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  app.stdout.on("data", (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-8000); });
  app.stderr.on("data", (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-8000); });

  const supabase = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  try {
    await waitForServer(app);

    const unauthenticated = await apiRequest("/api/planning-data?workspace=planning", "", "");
    assertStatus(unauthenticated, 401, "Unauthenticated planning data");

    const localLogin = await fetch(`${appOrigin}/api/auth/local-login`, { method: "POST" });
    assertStatus(localLogin, 200, "Simulated local login");
    if (!localLogin.headers.get("set-cookie")) throw new Error("Simulated local login did not create Supabase session cookies.");

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: localEnv.LOCAL_LOGIN_EMAIL,
      password: localEnv.LOCAL_LOGIN_PASSWORD,
    });
    if (signInError || !signInData.session) throw new Error("Seeded local Auth user could not sign in.");
    const token = signInData.session.access_token;

    const expectedProfiles = [
      ["", "ceo"],
      ["sebastian", "founder"],
      ["local-deputy", "deputy"],
      ["local-viewer", "viewer"],
    ];
    for (const [profileId, role] of expectedProfiles) {
      const response = await apiRequest("/api/planning-data?workspace=planning", token, profileId);
      assertStatus(response, 200, `${role} planning data`);
      const body = await response.json();
      if (body.currentProfile?.platformRole !== role) throw new Error(`${role} profile override was not applied.`);
      if (body.data?.tasks?.length !== source.tasks.length) throw new Error(`${role} did not receive the complete DB seed.`);
    }

    for (const profileId of ["sebastian", "local-viewer"]) {
      const response = await apiRequest("/api/milestones", token, profileId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertStatus(response, 403, `${profileId} milestone authorization`);
    }
    for (const profileId of ["", "local-deputy"]) {
      const response = await apiRequest("/api/milestones", token, profileId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertStatus(response, 400, `${profileId || "ceo"} milestone validation`);
    }

    const deputyGitHubProject = await apiRequest("/api/founderops-settings/github-project", token, "local-deputy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedGithubProjectOwner: source.project.githubProjectOwner,
        expectedGithubProjectNumber: source.project.githubProjectNumber,
        githubProjectOwner: source.project.githubProjectOwner,
        githubProjectNumber: source.project.githubProjectNumber,
      }),
    });
    assertStatus(deputyGitHubProject, 403, "Deputy global GitHub Project authorization");

    const localGitHubProject = await apiRequest("/api/founderops-settings/github-project", token, "", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedGithubProjectOwner: source.project.githubProjectOwner,
        expectedGithubProjectNumber: source.project.githubProjectNumber,
        githubProjectOwner: source.project.githubProjectOwner,
        githubProjectNumber: source.project.githubProjectNumber,
      }),
    });
    assertStatus(localGitHubProject, 409, "Local external GitHub Project configuration");

    await supabase.auth.signOut({ scope: "global" });
    console.log("Local DB, Auth, session cookies, API guards, and role overrides verified.");
  } catch (error) {
    if (serverOutput.trim()) console.error(serverOutput.replace(/(eyJ[a-zA-Z0-9._-]+)/g, "[redacted-token]"));
    throw error;
  } finally {
    app.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local integration verification failed.");
  process.exit(1);
});
