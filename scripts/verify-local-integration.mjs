import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
      "insert into tasks (id,project_id,title,status,task_type,score_relevant,approval_status) values ($1,$2,$3,'Offen','epic',false,null)",
      ["local-stale-epic", source.project.id, "Local Stale Epic"],
    );
    await client.query(
      "insert into tasks (id,project_id,parent_task_id,title,status,priority,task_type,score_relevant,approval_status) values ($1,$2,$3,$4,'Offen','P2','initiative',false,'proposed')",
      ["local-stale-initiative", source.project.id, "local-stale-epic", "Local Stale Initiative"],
    );
    await client.query(
      "insert into tasks (id,project_id,parent_task_id,title,status,priority,sprint_id,task_type,score_relevant,approval_status) values ($1,$2,$3,$4,'Offen','P3',$5,'deliverable',false,'proposed')",
      ["local-stale-task", source.project.id, "local-stale-initiative", "Local Stale Task", "local-stale-sprint"],
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
        (select count(*)::integer from tasks where project_id=$1) as tasks,
        (select count(*)::integer from tasks where project_id=$1 and task_type='epic') as epics,
        (select count(*)::integer from tasks where project_id=$1 and task_type='initiative') as initiatives,
        (select count(*)::integer from tasks where project_id=$1 and task_type='deliverable') as deliverables,
        (select count(*)::integer from tasks where project_id=$1 and task_type='sub_issue') as sub_issues,
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
      tasks: source.epics.length + source.packages.length + source.tasks.length,
      epics: source.epics.length,
      initiatives: source.packages.length,
      deliverables: source.tasks.filter((task) => (task.taskType || "deliverable") === "deliverable").length,
      sub_issues: source.tasks.filter((task) => task.taskType === "sub_issue").length,
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

async function verifyUnmappedAuthReadBoundary(status) {
  const adminKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!adminKey) throw new Error("Local Supabase status did not expose an admin key.");

  const admin = createClient(status.API_URL, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const unmapped = createClient(status.API_URL, status.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `unmapped-rls-${Date.now()}@example.test`;
  const password = "Local-only-unmapped-RLS-2026!";
  let userId = "";

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error("Could not create the temporary unmapped local Auth user.");
    }
    userId = created.user.id;

    const { data: signIn, error: signInError } = await unmapped.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signIn.session) {
      throw new Error("Temporary unmapped local Auth user could not sign in.");
    }

    for (const table of ["profiles", "tasks"]) {
      const { data, error } = await unmapped.from(table).select("id").limit(1);
      if (error) throw new Error(`Unmapped Auth RLS read failed unexpectedly for ${table}.`);
      if (data?.length) {
        throw new Error(`Unmapped Auth user unexpectedly read team data from ${table}.`);
      }
    }
  } finally {
    await unmapped.auth.signOut({ scope: "local" }).catch(() => undefined);
    if (userId) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw new Error("Temporary unmapped local Auth user could not be removed.");
    }
  }
}

async function verifyDirectProfileMutationDenied(supabase, userId) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,platform_role")
    .eq("auth_user_id", userId)
    .single();
  if (profileError || !profile) throw new Error("Mapped local profile could not be read through RLS.");

  const { data, error } = await supabase
    .from("profiles")
    .update({
      role: profile.role,
      platform_role: profile.platform_role,
    })
    .eq("id", profile.id)
    .select("id");
  if (!error || error.code !== "42501" || data?.length) {
    throw new Error("Authenticated user unexpectedly mutated an authorization profile directly.");
  }
}

async function verifyPlanningApiGitHubSyncScope(sessionToken, taskId) {
  const issuedTokenIds = [];
  const issueToken = async (allowGitHubSync) => {
    const response = await apiRequest(
      "/api/team/planning-items/v1/tokens",
      sessionToken,
      "sebastian",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: allowGitHubSync ? "Local GitHub sync verification" : "Local default scope verification",
          allowGitHubSync,
        }),
      },
    );
    assertStatus(response, 200, `Planning API token issuance (${allowGitHubSync ? "enabled" : "disabled"})`);
    const body = await response.json();
    if (!body.token || !body.tokenRecord?.id || !Array.isArray(body.tokenRecord.scopes)) {
      throw new Error("Planning API token issuance returned an incomplete response.");
    }
    issuedTokenIds.push(body.tokenRecord.id);
    return body;
  };

  try {
    const defaultToken = await issueToken(false);
    if (defaultToken.tokenRecord.scopes.includes("write:planning-items:github-sync")) {
      throw new Error("New Planning API token unexpectedly received the GitHub sync scope by default.");
    }
    const denied = await apiRequest(
      `/api/team/planning-items/v1/items/${taskId}/github-sync`,
      defaultToken.token,
      "",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubSyncMode: "async",
          createIfMissing: false,
        }),
      },
    );
    assertStatus(denied, 403, "Planning API GitHub sync without scope");

    const enabledToken = await issueToken(true);
    if (!enabledToken.tokenRecord.scopes.includes("write:planning-items:github-sync")) {
      throw new Error("Planning API token did not receive the explicitly requested GitHub sync scope.");
    }
    const ineligible = await apiRequest(
      `/api/team/planning-items/v1/items/${taskId}/github-sync`,
      enabledToken.token,
      "",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubSyncMode: "async",
          createIfMissing: false,
        }),
      },
    );
    assertStatus(ineligible, 409, "Planning API GitHub sync preflight");
  } finally {
    for (const tokenId of issuedTokenIds.reverse()) {
      const response = await apiRequest(
        `/api/team/planning-items/v1/tokens/${tokenId}`,
        sessionToken,
        "sebastian",
        { method: "DELETE" },
      );
      assertStatus(response, 200, "Planning API verification token cleanup");
    }
  }
}

async function verifyEmptyEpicDeleteRoutes(sessionToken) {
  const createEpic = async (title) => {
    const response = await apiRequest("/api/milestones", sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description: "Local integration fixture", status: "planned" }),
    });
    assertStatus(response, 200, `${title} creation`);
    const body = await response.json();
    if (!body.milestone?.id || !body.milestone?.updatedAt) throw new Error(`${title} creation returned an incomplete response.`);
    return body.milestone;
  };

  const browserEpic = await createEpic("Browser empty Epic delete verification");
  const founderDenied = await apiRequest(`/api/milestones/${browserEpic.id}`, sessionToken, "sebastian", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: browserEpic.updatedAt }),
  });
  assertStatus(founderDenied, 403, "Founder empty Epic deletion");
  const browserDelete = await apiRequest(`/api/milestones/${browserEpic.id}`, sessionToken, "", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: browserEpic.updatedAt }),
  });
  assertStatus(browserDelete, 200, "Browser empty Epic deletion");
  const browserBody = await browserDelete.json();
  if (browserBody.milestone?.id !== browserEpic.id) throw new Error("Browser empty Epic deletion changed its response shape.");

  const teamEpic = await createEpic("Team empty Epic delete verification");
  let tokenId = "";
  try {
    const issued = await apiRequest("/api/team/planning-items/v1/tokens", sessionToken, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Local empty Epic delete verification", allowEmptyEpicDeletes: true }),
    });
    assertStatus(issued, 200, "Empty Epic delete token issuance");
    const tokenBody = await issued.json();
    tokenId = String(tokenBody.tokenRecord?.id || "");
    if (!tokenBody.token || !tokenId || !tokenBody.tokenRecord?.scopes?.includes("write:planning-items:delete-empty")) {
      throw new Error("Empty Epic delete token issuance returned an incomplete response.");
    }
    const payload = JSON.stringify({ expectedUpdatedAt: teamEpic.updatedAt });
    const preview = await apiRequest(`/api/team/planning-items/v1/items/${teamEpic.id}/delete/preview`, tokenBody.token, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assertStatus(preview, 200, "Team empty Epic deletion preview");
    const previewBody = await preview.json();
    if (!previewBody.valid || !previewBody.canDelete || previewBody.itemType !== "epic") {
      throw new Error("Team empty Epic deletion preview changed its response shape.");
    }

    const idempotencyKey = randomUUID();
    const commitRequest = {
      method: "DELETE",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: payload,
    };
    const committed = await apiRequest(`/api/team/planning-items/v1/items/${teamEpic.id}`, tokenBody.token, "", commitRequest);
    assertStatus(committed, 200, "Team empty Epic deletion");
    const committedBody = await committed.json();
    if (committedBody.replayed || committedBody.itemType !== "epic" || committedBody.item?.id !== teamEpic.id) {
      throw new Error("Team empty Epic deletion changed its response shape.");
    }
    const replayed = await apiRequest(`/api/team/planning-items/v1/items/${teamEpic.id}`, tokenBody.token, "", commitRequest);
    assertStatus(replayed, 200, "Team empty Epic deletion replay");
    const replayedBody = await replayed.json();
    if (!replayedBody.replayed || replayedBody.item?.id !== teamEpic.id) {
      throw new Error("Team empty Epic deletion replay was not stable.");
    }
  } finally {
    if (tokenId) {
      const revoked = await apiRequest(`/api/team/planning-items/v1/tokens/${tokenId}`, sessionToken, "", { method: "DELETE" });
      assertStatus(revoked, 200, "Empty Epic delete token cleanup");
    }
  }
}

async function verifyPlanningRelationshipRoutes(sessionToken, sourceTaskId, relatedTaskId) {
  const created = await apiRequest(`/api/tasks/${sourceTaskId}/relationships`, sessionToken, "", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relationType: "blocked_by", relatedTaskId, note: "Local integration fixture" }),
  });
  assertStatus(created, 200, "Browser planning relationship creation");
  const createdBody = await created.json();
  if (
    !createdBody.ok
    || !Number.isInteger(createdBody.relation?.id)
    || createdBody.relation.taskId !== sourceTaskId
    || createdBody.relation.relatedTaskId !== relatedTaskId
    || createdBody.relation.relationType !== "blocked_by"
  ) {
    throw new Error("Browser planning relationship creation changed its response shape.");
  }

  const removed = await apiRequest(`/api/tasks/${sourceTaskId}/relationships`, sessionToken, "", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relationId: createdBody.relation.id }),
  });
  assertStatus(removed, 200, "Browser planning relationship removal");
  const removedBody = await removed.json();
  if (!removedBody.ok || removedBody.relationId !== createdBody.relation.id) {
    throw new Error("Browser planning relationship removal changed its response shape.");
  }
}

async function main() {
  localStatus();
  execFileSync(process.execPath, [localDevelopmentScript, "seed"], { cwd: root, stdio: "inherit" });
  const status = localStatus();
  const source = JSON.parse(readFileSync(seedSourcePath, "utf8"));
  await verifySeedConvergence(status, source);
  execFileSync(process.execPath, [resolve(root, "scripts/verify-backlog-bulk-sprint-assignment.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "scripts/verify-backlog-move-transaction.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "scripts/verify-planning-relationship-transaction.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "scripts/verify-planning-items-transaction.mjs")], { cwd: root, stdio: "inherit" });
  await verifyGitHubProjectRoleBoundary(status, source);
  await verifyUnmappedAuthReadBoundary(status);
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
    const unauthenticatedRevision = await apiRequest("/api/planning-data/revision", "", "");
    assertStatus(unauthenticatedRevision, 401, "Unauthenticated planning revision");

    const localLogin = await fetch(`${appOrigin}/api/auth/local-login`, { method: "POST" });
    assertStatus(localLogin, 200, "Simulated local login");
    if (!localLogin.headers.get("set-cookie")) throw new Error("Simulated local login did not create Supabase session cookies.");

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: localEnv.LOCAL_LOGIN_EMAIL,
      password: localEnv.LOCAL_LOGIN_PASSWORD,
    });
    if (signInError || !signInData.session) throw new Error("Seeded local Auth user could not sign in.");
    const token = signInData.session.access_token;
    await verifyDirectProfileMutationDenied(supabase, signInData.user.id);
    await verifyPlanningApiGitHubSyncScope(token, source.tasks[0].id);
    await verifyEmptyEpicDeleteRoutes(token);
    await verifyPlanningRelationshipRoutes(token, source.tasks[0].id, source.tasks[1].id);

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
      const expectedPlanningItems = source.epics.length + source.packages.length + source.tasks.length;
      if (body.data?.tasks?.length !== expectedPlanningItems) throw new Error(`${role} did not receive the complete DB seed.`);
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

    for (const profileId of ["sebastian", "local-viewer"]) {
      const response = await apiRequest("/api/tasks/bulk-sprint-assignment", token, profileId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertStatus(response, 403, `${profileId} bulk Sprint assignment authorization`);
    }
    for (const profileId of ["", "local-deputy"]) {
      const response = await apiRequest("/api/tasks/bulk-sprint-assignment", token, profileId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertStatus(response, 400, `${profileId || "ceo"} bulk Sprint assignment validation`);
    }

    const viewerToolWrite = await apiRequest("/api/tools", token, "local-viewer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertStatus(viewerToolWrite, 403, "Viewer tool write authorization");

    const founderToolWrite = await apiRequest("/api/tools", token, "sebastian", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertStatus(founderToolWrite, 400, "Founder tool write validation");

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
