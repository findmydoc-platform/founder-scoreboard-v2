import { afterEach, expect, test, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

function configure() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }));
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY_PATH", "");
}

test("technical resources reuse installation access without exposing its secret or granting actor authority", async () => {
  configure();
  let acquisitions = 0;
  vi.stubGlobal("fetch", async (input, options) => {
    const url = new URL(input);
    if (url.pathname === "/app/installations/456/access_tokens") {
      acquisitions++;
      return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
    }
    if (url.pathname === "/repos/findmydoc-platform/management/issues/1/comments") {
      expect(options.headers.authorization).toBe("Bearer synthetic-installation");
      return Response.json([{ id: 7, body: "Projected", user: { login: "bot" } }]);
    }
    throw new Error(`Unexpected synthetic protocol ${url.pathname}`);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { listGitHubIssueComments } = await importTestModule("src/lib/github.ts");
  const input = { credential: { kind: "github-installation" }, action: "github.issue.read", target: { repositories: ["findmydoc-platform/management"] } };
  const first = await authorizeCredentialAction(input);
  const second = await authorizeCredentialAction(input);
  expect(JSON.stringify(first)).not.toContain("synthetic-installation");
  expect(await listGitHubIssueComments(1, first.github, "findmydoc-platform/management")).toMatchObject([{ id: 7 }]);
  expect(await listGitHubIssueComments(1, second.github, "findmydoc-platform/management")).toMatchObject([{ id: 7 }]);
  expect(acquisitions).toBe(1);
  expect(await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "governance.ceo" })).toMatchObject({ ok: false, status: 403 });
});

async function workflow(action = "github.issue.read", target = { repositories: ["findmydoc-platform/management"] }) {
  const seam = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const resources = await importTestModule("src/lib/github.ts");
  return { ...resources, authorize: () => seam.authorizeCredentialAction({ credential: { kind: "github-installation" }, action, target }) };
}
function issued(token = "synthetic-installation", lifetime = 3600000) {
  return Response.json({ token, expires_at: new Date(Date.now() + lifetime).toISOString() });
}

test("expiring installation access renews before the next real resource read", async () => {
  configure();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  let acquisitions = 0;
  const resourceCredentials = [];
  vi.stubGlobal("fetch", async (url, options) => {
    if (String(url).endsWith("/access_tokens")) return issued(`synthetic-${++acquisitions}`);
    resourceCredentials.push(options.headers.authorization);
    return Response.json([]);
  });
  const app = await workflow();
  const { github } = await app.authorize();
  await app.listGitHubIssueComments(1, github);
  vi.setSystemTime(new Date("2026-10-17T10:56:00Z"));
  await app.listGitHubIssueComments(1, github);
  expect(resourceCredentials).toEqual(["Bearer synthetic-1", "Bearer synthetic-2"]);
  expect(acquisitions).toBe(2);
});

test("wrong repository and changed installation cannot reuse an issued capability", async () => {
  configure();
  const resources = [];
  vi.stubGlobal("fetch", async url => {
    if (String(url).endsWith("/access_tokens")) return issued();
    resources.push(String(url));
    return Response.json([]);
  });
  const app = await workflow();
  const { github } = await app.authorize();
  await expect(app.listGitHubIssueComments(1, github, "findmydoc-platform/website")).rejects.toThrow("GitHub-Ziel");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "999");
  await expect(app.listGitHubIssueComments(1, github)).rejects.toThrow("Konfiguration wurde geändert");
  const replacement = await app.authorize();
  await app.listGitHubIssueComments(1, replacement.github);
  expect(resources).toHaveLength(1);
});

test.each([403, 503])("installation provider failure %s stays safe and does not call a resource", async status => {
  configure();
  const requests = [];
  vi.stubGlobal("fetch", async url => {
    requests.push(String(url));
    return Response.json({ message: "synthetic-secret must remain internal" }, { status });
  });
  const app = await workflow();
  await expect(app.authorize()).rejects.toMatchObject({ status, message: "GitHub-App-Installationstoken konnte nicht erzeugt werden." });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("/app/installations/456/access_tokens");
});

test("concurrent installation misses coalesce and retain repository narrowing", async () => {
  configure();
  let acquisitions = 0;
  vi.stubGlobal("fetch", async (_url, options) => {
    acquisitions++;
    expect(JSON.parse(options.body)).toEqual({ repositories: ["management"] });
    return issued();
  });
  const app = await workflow();
  const capabilities = await Promise.all([app.authorize(), app.authorize(), app.authorize()]);
  expect(capabilities.every(result => result.ok)).toBe(true);
  expect(acquisitions).toBe(1);
});

test("a possibly completed technical mutation is not replayed after network failure", async () => {
  configure();
  let mutations = 0;
  vi.stubGlobal("fetch", async (url) => {
    if (String(url).endsWith("/access_tokens")) return issued();
    mutations++;
    throw new Error("lost success response");
  });
  const app = await workflow("github.projection.apply");
  const { github } = await app.authorize();
  await expect(app.archiveGitHubIssue(1, github)).rejects.toMatchObject({ status: 0, retryable: true });
  expect(mutations).toBe(1);
});

test("a read-only installation capability cannot mutate or send arbitrary GraphQL", async () => {
  configure();
  let external = 0;
  vi.stubGlobal("fetch", async () => { external++; return issued(); });
  const app = await workflow();
  const { github } = await app.authorize();
  await expect(app.archiveGitHubIssue(1, github)).rejects.toThrow("Aktion ist nicht freigegeben");
  const { githubGraphql } = await importTestModule("src/lib/github-graphql.ts");
  await expect(githubGraphql({ token: github, query: "query { viewer { login } }", operation: "read", errorMessage: "safe" })).rejects.toThrow("Ziel ist nicht freigegeben");
  expect(external).toBe(1);
});

test("installation status rejects a different provider installation without credential diagnostics", async () => {
  configure();
  vi.stubGlobal("fetch", async () => Response.json({ id: 999 }));
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  expect(await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.installation.status" })).toMatchObject({ available: false, state: "unavailable" });
});


test("a user credential cannot select installation access even when naming a technical action", async () => {
  configure();
  let calls = 0;
  vi.stubGlobal("fetch", async () => { calls++; return issued(); });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  expect(await authorizeCredentialAction({ credential: { kind: "personal-token", token: "synthetic-personal" }, action: "github.projection.apply", target: { repositories: ["findmydoc-platform/management"] } })).toMatchObject({ ok: false, status: 403 });
  expect(calls).toBe(0);
});


test.each([401, 403])("resource denial %s never refreshes or repeats a technical mutation", async status => {
  configure();
  let acquisitions = 0;
  let mutations = 0;
  vi.stubGlobal("fetch", async url => {
    if (String(url).endsWith("/access_tokens")) { acquisitions++; return issued(); }
    mutations++;
    return Response.json({ message: "Permission denied" }, { status });
  });
  const app = await workflow("github.projection.apply");
  const { github } = await app.authorize();
  await expect(app.archiveGitHubIssue(1, github)).rejects.toMatchObject({ status });
  expect({ acquisitions, mutations }).toEqual({ acquisitions: 1, mutations: 1 });
});

test("native relationship reconciliation remains in its resource workflow behind installation transport", async () => {
  configure();
  let connected = false;
  let mutations = 0;
  vi.stubGlobal("fetch", async (url, options) => {
    if (String(url).endsWith("/access_tokens")) return issued();
    const body = JSON.parse(options.body);
    if (body.query.startsWith("query")) return Response.json({ data: {
      parentRepository: { issue: { id: "parent-node", number: 1 } },
      childRepository: { issue: { id: "child-node", number: 2, parent: connected ? { number: 1, repository: { nameWithOwner: "findmydoc-platform/management" } } : null } },
    } });
    mutations++;
    connected = true;
    throw new Error("provider applied mutation, response lost");
  });
  const app = await workflow("github.projection.apply");
  const { github } = await app.authorize();
  const command = { parentRepository: "findmydoc-platform/management", parentIssueNumber: 1, childRepository: "findmydoc-platform/management", childIssueNumber: 2, token: github };
  await expect(app.connectGitHubSubIssue(command)).rejects.toMatchObject({ status: 0 });
  expect(mutations).toBe(1);
  expect(await app.connectGitHubSubIssue(command)).toMatchObject({ addSubIssue: { issue: { number: 1 }, subIssue: { number: 2 } } });
  expect(mutations).toBe(1);
});


test("concurrent failed acquisition never exposes provider credential diagnostics to another waiter", async () => {
  configure();
  vi.stubGlobal("fetch", async () => Response.json({ message: "synthetic-private-diagnostic" }, { status: 403 }));
  const app = await workflow();
  const results = await Promise.allSettled([app.authorize(), app.authorize()]);
  expect(results.map(result => result.reason.message)).toEqual([
    "GitHub-App-Installationstoken konnte nicht erzeugt werden.",
    "GitHub-App-Installationstoken konnte nicht erzeugt werden.",
  ]);
});


test("user-authored attachments cannot inherit technical installation access", async () => {
  configure();
  let calls = 0;
  vi.stubGlobal("fetch", async () => { calls++; return issued(); });
  const app = await workflow("github.projection.apply");
  const { github } = await app.authorize();
  await expect(app.uploadGitHubAttachment("attachments/file.txt", Buffer.from("payload"), github, "Synthetic upload", "findmydoc-platform/management")).rejects.toThrow("Aktion ist nicht freigegeben");
  expect(calls).toBe(1);
});


test.each(["installation","key"].flatMap(change=>["authorize","resource","asset"].map(phase=>({change,phase}))))("configuration $change changing during $phase issuance cannot release provider access",async({change,phase})=>{
  configure();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  let release,started,acquisitions=0;const pending=new Promise(r=>{release=r;}),entered=new Promise(r=>{started=r;});
  const resources=[];
  vi.stubGlobal("fetch",async(url)=>{
    if(String(url).endsWith("/access_tokens")) {
      acquisitions++;
      if(phase==="authorize" || acquisitions===2){started();await pending;}
      return issued();
    }
    resources.push(String(url));return Response.json({});
  });
  const assetUrl="https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111";
  const app=await workflow(phase==="asset" ? "github.asset.read":"github.projection.apply",{repositories:["findmydoc-platform/management"],...(phase==="asset"?{assetUrl}:{})});
  let operation;
  if(phase==="authorize") operation=app.authorize();
  else {const {github}=await app.authorize();vi.setSystemTime(new Date("2026-10-17T10:56:00Z"));operation=phase==="asset" ? github.asset(assetUrl) : app.archiveGitHubIssue(1,github);}
  await entered;
  if(change==="installation")vi.stubEnv("GITHUB_APP_INSTALLATION_ID","999");
  else {const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));}
  release();await expect(operation).rejects.toThrow("Konfiguration wurde geändert");expect(resources).toHaveLength(0);
});


test("a configuration change while an asset redirect is pending prevents the next hop",async()=>{
  configure();const resources=[];
  vi.stubGlobal("fetch",async url=>{
    if(String(url).endsWith("/access_tokens")) return issued();
    resources.push(String(url));vi.stubEnv("GITHUB_APP_INSTALLATION_ID","999");
    return new Response(null,{status:302,headers:{location:"https://objects.githubusercontent.com/synthetic.png"}});
  });
  const assetUrl="https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111";
  const app=await workflow("github.asset.read",{repositories:["findmydoc-platform/management"],assetUrl});
  const {github}=await app.authorize();
  await expect(github.asset(assetUrl)).rejects.toThrow("Konfiguration wurde geändert");expect(resources).toEqual([assetUrl]);
});
test("installation tokens at their exact provider expiry cannot release a capability",async()=>{
  configure();vi.useFakeTimers({toFake:["Date"]});
  vi.stubGlobal("fetch",async()=>issued("synthetic-expired",0));
  const app=await workflow();await expect(app.authorize()).rejects.toThrow("Installationstoken ist ungültig");
});


test("a changed installation cannot dispatch a bounded HTTP read retry",async()=>{
  configure();let reads=0;
  vi.stubGlobal("fetch",async url=>{
    if(String(url).endsWith("/access_tokens"))return issued();
    reads++;vi.stubEnv("GITHUB_APP_INSTALLATION_ID","999");return Response.json({message:"temporary"},{status:503});
  });
  const app=await workflow();const {github}=await app.authorize();
  await expect(app.listGitHubIssueComments(1,github)).rejects.toThrow("Konfiguration wurde geändert");expect(reads).toBe(1);
});
