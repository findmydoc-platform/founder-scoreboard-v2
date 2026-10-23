import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createHmac } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { chromium, type Browser, type BrowserContext } from "playwright";

// Run only in the integration project's isolated environment. All Auth responses are synthetic.
let tls: HttpsServer;
let auth: Server, app: ChildProcess, browser: Browser, authOrigin: string, appOrigin: string;
let releaseRefresh: (() => void) | undefined;
let refreshEntered: (() => void) | undefined;
let holdRefresh = false;
let holdLogin = false;
let holdLogout = false;
let logoutEntered: (() => void) | undefined;
let releaseLogout: (() => void) | undefined;
let heldLogoutScope: string | null = null;
let releaseLogin: (() => void) | undefined;
let loginEntered: (() => void) | undefined;
const certificateDirectory = mkdtempSync(path.join(tmpdir(), "session-browser-tls-"));
const evidenceDirectory = mkdtempSync(path.join(tmpdir(), "session-browser-evidence-"));
let logs = "";
function captureDiagnostics() {
  let partial = "";
  return (chunk: Buffer) => {
    const lines = (partial + String(chunk)).split(/\r?\n/);
    partial = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.replace(/\u001b\[[0-9;]*m/g, "");
      if (/Network:/.test(line) || !/^(?:▲ Next|✓ Ready|⨯|Error:|Type error:|TypeError:|SyntaxError:|Failed to compile|(?:\.\/)?src\/|(?:\.\/)?tests\/)/.test(line.trimStart())) continue;
      logs = `${logs}${line.replace(/https?:\/\/\S+/g, "[synthetic endpoint]")}\n`.slice(-4000);
    }
  };
}
const pendingGates = new Set<() => void>();
function heldResponse(assign: (release: () => void) => void) {
  return new Promise<void>(resolve => { const release = () => { pendingGates.delete(release); resolve(); }; pendingGates.add(release); assign(release); });
}
async function checkpoint<T>(name: string, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser checkpoint failed: ${name}`)), 10_000); })]); }
  finally { clearTimeout(timer!); }
}
let role = "founder", mapped = true, activeAdministrator = false;
let browserClientCode = "", userCalls = 0, rejectUserAt = 0;
let permanentAuthDenial = false;
const cookieBase = "sb-localhost-auth-token";
const userA = "b1111111-1111-4111-8111-111111111111";
const userB = "b2222222-2222-4222-8222-222222222222";
let loginUser = userB;
let sessionSequence = 0;
let workspaceMode = "legacy", linkingEnforced = false, workspaceLinked = false, loginRecorded = false;
let linkNonce: string | null = null;
beforeEach(() => { permanentAuthDenial = false; role = "founder"; mapped = true; activeAdministrator = false; workspaceMode = "legacy"; linkingEnforced = false; workspaceLinked = false; loginRecorded = false; linkNonce = null; loginUser = userB; rejectUserAt = 0; holdLogout = false; logoutEntered = undefined; releaseLogout = undefined; heldLogoutScope = null; });
function token(userId: string) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const value = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: userId, aud: "authenticated", role: "authenticated", amr: [{ method: "oauth" }], iss: `${authOrigin}/auth/v1`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, session_id: userId })}`;
  return `${value}.${createHmac("sha256", "synthetic-browser-signing-key").update(value).digest("base64url")}`;
}
function session(userId: string) {
  return { access_token: token(userId), refresh_token: `synthetic-refresh-${++sessionSequence}-${userId}`, expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user: { id: userId, aud: "authenticated", user_metadata: {} } };
}
async function listen(server: Server | HttpsServer, protocol = "http:") {
  server.listen(0, "localhost"); await once(server, "listening");
  return `${protocol}//localhost:${(server.address() as { port: number }).port}`;
}
async function freePort() { const server = createServer(); const url = await listen(server); await new Promise<void>(resolve => server.close(() => resolve())); return new URL(url).port; }

beforeAll(async () => {
  auth = createServer(async (request, response) => {
    const url = new URL(request.url!, authOrigin);
    const send = (data: unknown, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(data)); };
    if (url.pathname === "/auth/v1/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_to")!); redirect.searchParams.set("code", "synthetic-code-b");
      response.writeHead(302, { location: redirect.href }); response.end(); return;
    }
    if (url.pathname === "/auth/v1/user") {
      userCalls++;
      if (permanentAuthDenial || userCalls === rejectUserAt) { send({ message: "Synthetic credential rejected before effect", code: "bad_jwt" }, 401); return; }
      const claims = JSON.parse(Buffer.from(request.headers.authorization!.slice(7).split(".")[1], "base64url").toString());
      send({ id: claims.sub, aud: "authenticated", user_metadata: { platform_role: "ceo" }, identities: [{ provider: "github" }] }); return;
    }
    if (url.pathname === "/auth/v1/user/identities/authorize") { const target = new URL("/auth/v1/authorize", authOrigin); target.search = url.search; send({ url: target.href }); return; }
    if (url.pathname === "/auth/v1/token") {
      if (permanentAuthDenial) { send({ message: "Synthetic refresh rejected", code: "refresh_token_not_found" }, 400); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (url.searchParams.get("grant_type") === "pkce") { send({ ...session(loginUser), provider_token: "synthetic-provider-proof" }); return; }
      if (holdRefresh) { refreshEntered?.(); await new Promise<void>(resolve => { releaseRefresh = resolve; }); }
      send(session(body.refresh_token.endsWith(userB) ? userB : userA)); return;
    }
    if (url.pathname === "/auth/v1/logout") {
      if (holdLogout) { heldLogoutScope = url.searchParams.get("scope"); logoutEntered?.(); await heldResponse(release => { releaseLogout = release; }); }
      response.writeHead(204); response.end(); return;
    }
    if (["/rest/v1/rpc/workspace_access_context", "/rest/v1/rpc/workspace_calendar_entry"].includes(url.pathname)) {
      if (holdLogin && url.pathname.endsWith("workspace_access_context")) { holdLogin = false; loginEntered?.(); await new Promise<void>(resolve => { releaseLogin = resolve; }); }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      send({ mode: workspaceMode, linkingEnforced, linked: workspaceLinked, userId: body.p_user_id || loginUser, profileId: mapped ? "synthetic-profile" : null,
        sessionAllowed: workspaceMode === "legacy" || !linkingEnforced ? null : loginRecorded, sessionError: false,
        identity: workspaceMode === "legacy" ? null : { sub: "synthetic-google-subject", iss: "https://accounts.google.com", email: "synthetic@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } } }); return; }
    if (url.pathname === "/rest/v1/rpc/workspace_dispatch_prepare") { send(workspaceMode === "google" || (workspaceMode === "linking" && linkingEnforced)); return; }
    if (url.pathname === "/rest/v1/rpc/workspace_begin_link" || url.pathname === "/rest/v1/rpc/workspace_complete_link" || url.pathname === "/rest/v1/rpc/workspace_record_google_login") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString());
      if (body.p_user_id !== userA) { send({ message: "Wrong bound actor" }, 403); return; }
      if (url.pathname.endsWith("workspace_begin_link")) linkNonce = body.p_nonce_hash;
      if (url.pathname.endsWith("workspace_complete_link")) {
        if (!linkNonce || linkNonce !== body.p_nonce_hash || body.p_subject !== "synthetic-google-subject") { send({ message: "Nonce rejected" }, 403); return; }
        linkNonce = null; workspaceLinked = true;
      }
      if (url.pathname.endsWith("workspace_record_google_login")) loginRecorded = true;
      send(null); return;
    }
    if (url.pathname === "/rest/v1/rpc/workspace_linking_session_allowed") { send(loginRecorded); return; }
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile") { send(mapped ? { id: "synthetic-profile", name: "Synthetic Founder", platform_role: role } : null); return; }
    if (url.pathname === "/rest/v1/rpc/administrator_access_snapshot") { send({ eligible: activeAdministrator, active: activeAdministrator, expiresAt: activeAdministrator ? new Date(Date.now() + 60000).toISOString() : null }); return; }
    if (url.pathname === "/rest/v1/platform_releases") {
      const summary = loginUser === userA ? "Synthetic previous account release" : "Synthetic replacement release";
      const manifest = { schemaVersion: 2, version: "v1.0.0", summary, highlights: [], changes: [], components: [], visuals: [], publishedAt: "2026-10-01T00:00:00Z" };
      send([{ version: "v1.0.0", summary, published_at: manifest.publishedAt, manifest_digest: "synthetic", manifest }]); return;
    }
    if (url.pathname === "/rest/v1/profiles") {
      response.writeHead(200, { "content-type": "application/json", "content-range": "*/0" }); response.end("[]"); return;
    }
    if (url.pathname.startsWith("/rest/v1/")) { send([]); return; }
    send({ error: "Unscripted synthetic protocol" }, 501);
  });
  authOrigin = await listen(auth);
  const port = await freePort();
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(certificateDirectory, "key.pem"), "-out", path.join(certificateDirectory, "cert.pem"), "-subj", "/CN=localhost", "-days", "1", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  tls = createHttpsServer({ key: readFileSync(path.join(certificateDirectory, "key.pem")), cert: readFileSync(path.join(certificateDirectory, "cert.pem")) }, (request, response) => {
    const upstream = httpRequest({ hostname: "localhost", port, path: request.url, method: request.method,
      headers: { ...request.headers, "x-forwarded-proto": "https", "x-forwarded-host": request.headers.host } }, result => {
      response.writeHead(result.statusCode || 502, result.headers); result.pipe(response);
    });
    upstream.on("error", () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
  });
  appOrigin = await listen(tls, "https:");
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "HOME", "TMPDIR", "NODE_OPTIONS", "FOUNDEROPS_PROTOCOL_ONLY"].includes(key))), NODE_ENV: "production" };
  Object.assign(env, { NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: `${env.NODE_OPTIONS || ""} --require=${path.resolve("tests/helpers/session-browser-protocol.cjs")}`,
    VERCEL_OIDC_TOKEN: token(userA), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", APP_URL: appOrigin, NEXT_PUBLIC_SUPABASE_URL: authOrigin, SUPABASE_URL: authOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service", ENABLE_LOCAL_LOGIN: "true", NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: "true" });
  // Production output keeps development hot reloads out of cookie/navigation ordering evidence.
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout!.on("data", captureDiagnostics()); app.stderr!.on("data", captureDiagnostics());
  const [built] = await once(app, "exit");
  if (built !== 0) throw new Error(`Synthetic session app build failed: ${logs}`);
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", port], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout!.on("data", captureDiagnostics());
  app.stderr!.on("data", captureDiagnostics());
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error(`Synthetic session app exited: ${logs}`);
    try { if ((await fetch(`http://localhost:${port}/api/auth/login-mode`)).ok) break; } catch { /* Wait for the local app socket. */ }
    if (attempt === 119) throw new Error(`Synthetic session app did not start: ${logs}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const compiled = await build({ configFile: false, logLevel: "silent", resolve: { alias: { "@": path.resolve("src") } },
    build: { write: false, lib: { entry: path.resolve("tests/fixtures/session-browser-entry.ts"), name: "FounderOpsBrowser", formats: ["iife"] } } });
  const outputs = Array.isArray(compiled) ? compiled : [compiled];
  const chunk = outputs.flatMap(output => "output" in output ? output.output : []).find(output => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Browser public transport fixture did not compile");
  browserClientCode = chunk.code;
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterEach(context => { if (context.task.result?.state === "fail") console.info(`Synthetic app diagnostics: ${logs}`); });

afterAll(async () => {
  releaseRefresh?.(); releaseLogin?.(); pendingGates.forEach(release => release()); await browser?.close(); app?.kill("SIGTERM");
  if (app && app.exitCode === null) await once(app, "exit");
  if (tls) await new Promise<void>(resolve => tls.close(() => resolve()));
  if (auth) await new Promise<void>(resolve => auth.close(() => resolve()));
  rmSync(certificateDirectory, { recursive: true, force: true });
  rmSync(evidenceDirectory, { recursive: true, force: true });
});

async function start() {
  const context = await newBrowserContext();
  await context.addCookies([{ name: cookieBase, value: `base64-${Buffer.from(JSON.stringify(session(userA))).toString("base64url")}`, url: appOrigin, sameSite: "Lax" }]);
  const page = await context.newPage(); await page.goto(`${appOrigin}/api/auth/login-mode`);
  const current = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  expect(current.session.userId).toBe(userA);
  return { context, page, expected: { userId: current.session.userId, revision: current.session.revision } };
}
async function beginDelayedRefresh(page: Awaited<ReturnType<typeof start>>["page"], expected: { userId: string; revision: string }) {
  holdRefresh = true;
  const entered = new Promise<void>(resolve => { refreshEntered = resolve; });
  const pending = page.evaluate(async expected => {
    const response = await fetch("/api/auth/session/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected }) });
    return { status: response.status, body: await response.json() };
  }, expected);
  pending.catch(() => undefined);
  await entered;
  return { pending };
}
async function current(context: BrowserContext) { const response = await context.request.get(`${appOrigin}/api/auth/session`); return { status: response.status(), body: await response.json() }; }

test.each([userA, userB])("Chromium keeps newer login %s after an older refresh writes its actual Set-Cookie headers", async replacementUser => {
  loginUser = replacementUser;
  const { context, page, expected } = await start();
  try {
    const initial = "legacy".padEnd(32, "0");
    expect((await context.cookies()).find(cookie => cookie.name === `${cookieBase}-active`)).toBeUndefined();
    const { pending } = await beginDelayedRefresh(page, expected);
    const other = await context.newPage();
    await other.goto(`${appOrigin}/auth/login?provider=github&next=/auth/error`);
    await other.waitForURL(`${appOrigin}/auth/error`);
    const replacement = (await context.cookies()).find(cookie => cookie.name === `${cookieBase}-active`)!.value;
    expect(replacement).not.toBe(initial);
    expect((await current(context)).body.session.userId).toBe(replacementUser);
    releaseRefresh!(); holdRefresh = false;
    expect((await pending).status).toBe(200);
    const actualCookies = await context.cookies();
    expect(actualCookies.find(cookie => cookie.name === `${cookieBase}-g-${initial}`)).toBeDefined();
    expect(actualCookies.find(cookie => cookie.name === `${cookieBase}-active`)!.value).toBe(replacement);
    expect(actualCookies.find(cookie => cookie.name === `${cookieBase}-g-${replacement}`)!.httpOnly).toBe(true);
    expect((await current(context)).body.session.userId).toBe(replacementUser);
    const encoded = actualCookies.find(cookie => cookie.name === `${cookieBase}-g-${replacement}`)!.value;
    expect(JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString()).provider_token).toBeUndefined();
  } finally { releaseRefresh?.(); holdRefresh = false; loginUser = userB; await context.close(); }
}, 120_000);

test("Chromium cannot resurrect a logged-out session when the delayed refresh response arrives last", async () => {
  const { context, page, expected } = await start();
  try {
    const { pending } = await beginDelayedRefresh(page, expected);
    const result = await context.request.post(`${appOrigin}/api/auth/session/logout`, { headers: { origin: appOrigin }, data: { expected } });
    expect(result.status()).toBe(200);
    expect((await current(context)).status).toBe(401);
    releaseRefresh!(); holdRefresh = false;
    expect((await pending).status).toBe(200);
    expect((await context.cookies()).some(cookie => cookie.name.endsWith("-revoked") && cookie.value === "1")).toBe(true);
    expect((await current(context)).status).toBe(401);
  } finally { releaseRefresh?.(); holdRefresh = false; await context.close(); }
}, 120_000);


test("concurrent tabs serialize actual login-start cookie writes and unavailable locks fail visibly", async () => {
  const context = await newBrowserContext();
  const starts: string[] = [];
  context.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/session/login") starts.push(request.method()); });
  try {
    holdLogin = true;
    const entered = new Promise<void>(resolve => { loginEntered = resolve; });
    const first = await context.newPage(); await first.goto(`${appOrigin}/auth/login?next=/auth/error`);
    await entered;
    const second = await context.newPage(); await second.goto(`${appOrigin}/auth/login?next=/auth/error`);
    await expect.poll(async () => second.locator('[role="status"]').textContent()).toContain("nicht sicher vorbereitet");
    expect(starts).toEqual(["POST"]);
    releaseLogin!(); await first.waitForURL(`${appOrigin}/auth/error`);
    expect((await current(context)).body.session.userId).toBe(userB);
    expect((await context.cookies()).some(cookie => cookie.name === cookieBase)).toBe(false);
    expect(await first.evaluate(() => document.cookie)).not.toContain("auth-token");
  } finally { releaseLogin?.(); holdLogin = false; await context.close(); }
}, 120_000);

test("login error remains usable at supported phone, tablet and desktop viewports without leaking credentials", async () => {
  const context = await newBrowserContext();
  await context.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
  const protocols: string[] = []; const scripts: Promise<string>[] = [];
  context.on("request", request => { protocols.push(new URL(request.url()).pathname); });
  context.on("response", response => { if (new URL(response.url()).pathname.startsWith("/_next/static/") && response.url().includes(".js")) scripts.push(response.text().catch(() => "")); });
  try {
    const page = await context.newPage(); await page.goto(`${appOrigin}/auth/login?next=//unapproved.example.test`);
    await expect.poll(async () => page.locator('[role="status"]').textContent()).toContain("Bitte aktualisiere deinen Browser");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    for (const [width, height] of [[320,568],[390,844],[768,1024],[1024,768],[1440,900]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.getByRole("button", { name: "Erneut versuchen" }).count()).toBe(0);
      await page.screenshot({ path: path.join(evidenceDirectory, `login-error-${width}.png`), fullPage: true });
    }
    expect(protocols).not.toContain("/api/auth/session/login");
    expect(protocols.some(protocol => protocol === "/auth/v1/user" || protocol === "/auth/v1/token")).toBe(false);
    const clientCode = (await Promise.all(scripts)).join("\n");
    expect(clientCode).not.toContain("synthetic-service");
    expect(clientCode).not.toContain("GoTrueClient");
    console.info(`Session browser viewport evidence: ${evidenceDirectory}`);
  } finally { await context.close(); }
}, 120_000);

test.each(["/planning", "/team/platform-releases"])("%s consumes server session views, navigates and clears protected UI on global logout", async workspace => {
  const context = await newBrowserContext();
  const requests: Array<{ path: string; authorization: string | undefined }> = [];
  context.on("request", request => requests.push({ path: new URL(request.url()).pathname, authorization: request.headers().authorization }));
  try {
    const page = await context.newPage();
    const sessionRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session");
    await page.goto(`${appOrigin}/auth/login?next=${encodeURIComponent(workspace)}`);
    await page.waitForURL(`${appOrigin}${workspace}`);
    expect((await sessionRead).status()).toBe(200);
    const updates = page.getByRole("button", { name: "Was ist neu schließen" });
    await page.addLocatorHandler(updates, async () => { await updates.click(); });
    await page.getByRole("button", { name: /Account-Menü öffnen/ }).click();
    holdLogout = true;
    const startedLogout = new Promise<void>(resolve => { logoutEntered = resolve; });
    const completedLogout = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/session/logout");
    completedLogout.catch(() => undefined);
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await checkpoint("global provider logout started", startedLogout);
    expect(heldLogoutScope).toBe("global");
    if (workspace === "/planning") {
      await page.getByRole("heading", { name: "Willkommen zurück" }).waitFor();
      expect(await page.getByRole("button", { name: /Account-Menü öffnen/ }).count()).toBe(0);
    }
    else {
      await page.getByRole("status").filter({ hasText: "Zugriff auf die Releases ist gesperrt" }).waitFor();
      expect(await page.getByRole("textbox", { name: "Releases durchsuchen" }).count()).toBe(0);
      expect(await page.getByRole("button", { name: /Account-Menü öffnen/ }).count()).toBe(0);
    }
    // Protected UI clears immediately; server logout is not complete while its response is held.
    expect((await current(context)).status).toBe(200);
    releaseLogout!();
    const logout = await checkpoint("global logout HTTP response", completedLogout);
    expect(logout.status()).toBe(200);
    await expect.poll(async () => (await current(context)).status, { timeout: 10_000 }).toBe(401);
    if (workspace !== "/planning") await page.waitForURL(`${appOrigin}/planning`);
    expect(requests.filter(request => request.path.startsWith("/api/")).every(request => !request.authorization)).toBe(true);
    expect(requests.some(request => request.path === "/auth/v1/token" || request.path === "/auth/v1/user")).toBe(false);
  } finally { releaseLogout?.(); holdLogout = false; await context.close(); }
}, 120_000);

test("Planning polling clears loaded protected state after permanent Auth denial without focus or reload", async () => {
  const context = await newBrowserContext();
  try {
    const page = await context.newPage();
    await page.clock.install();
    const initialRevision = page.waitForResponse(response => new URL(response.url()).pathname === "/api/planning-revision");
    await page.goto(`${appOrigin}/auth/login?next=%2Fplanning`);
    await page.waitForURL(`${appOrigin}/planning`);
    await page.getByRole("button", { name: /Account-Menü öffnen/ }).waitFor();
    const revision = await checkpoint("initial planning revision", initialRevision);
    expect(revision.status()).toBe(200);
    expect(await revision.finished()).toBeNull();
    // Let the completed initial check settle before advancing its polling interval.
    await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    await page.evaluate("window.__samePlanningDocument = true");
    const cleared = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session/clear");
    permanentAuthDenial = true;
    await page.clock.fastForward(60_001);
    expect((await checkpoint("terminal polling session clear", cleared)).status()).toBe(200);
    await page.getByRole("heading", { name: "Willkommen zurück" }).waitFor();
    expect(await page.getByRole("button", { name: /Account-Menü öffnen/ }).count()).toBe(0);
    expect(await page.evaluate("window.__samePlanningDocument")).toBe(true);
    expect((await current(context)).status).toBe(401);
  } finally { permanentAuthDenial = false; await context.close(); }
}, 120_000);

test.each([userA, userB])("a delayed terminal local clear cannot revoke replacement login %s", async replacementUser => {
  const { context, page, expected } = await start();
  let pending: Promise<unknown> | undefined;
  try {
    permanentAuthDenial = true; holdLogout = true;
    const entered = new Promise<void>(resolve => { logoutEntered = resolve; });
    pending = page.evaluate(async expected => {
      const response = await fetch("/api/auth/session/clear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected }) });
      return { status: response.status, body: await response.json() };
    }, expected);
    pending.catch(() => undefined);
    await checkpoint("bound local logout started", entered);
    expect(heldLogoutScope).toBe("local");
    permanentAuthDenial = false; loginUser = replacementUser;
    const other = await context.newPage();
    await other.goto(`${appOrigin}/auth/login?provider=github&next=/auth/error`);
    await other.waitForURL(`${appOrigin}/auth/error`);
    const replacement = (await context.cookies()).find(cookie => cookie.name === `${cookieBase}-active`)!.value;
    expect((await current(context)).body.session.userId).toBe(replacementUser);
    releaseLogout!();
    expect(await pending).toMatchObject({ status: 200, body: { outcome: "cleared", session: null } });
    expect((await context.cookies()).find(cookie => cookie.name === `${cookieBase}-active`)!.value).toBe(replacement);
    expect((await current(context)).body.session.userId).toBe(replacementUser);
  } finally {
    releaseLogout?.(); permanentAuthDenial = false; holdLogout = false;
    await pending?.catch(() => undefined); await context.close();
  }
}, 120_000);


test("real Google link form returns through PKCE and consumes the existing bound nonce", async () => {
  workspaceMode = "linking"; loginUser = userA;
  const { context, page } = await start();
  try {
    await page.goto(`${appOrigin}/auth/link-google`);
    await page.getByRole("button", { name: "Mit Google verknüpfen", exact: true }).click();
    await expect.poll(async () => page.locator("body").innerText(), { timeout: 30_000 }).toContain("Dein Google-Konto ist verknüpft.");
    expect(workspaceLinked).toBe(true); expect(linkNonce).toBeNull();
    expect((await current(context)).body.session.userId).toBe(userA);
    expect((await context.cookies()).find(cookie => cookie.name === "workspace_link")).toBeUndefined();
  } finally { await context.close(); }
}, 120_000);

test("real Google login return records only nonce-matched provider proof and navigates as the bound user", async () => {
  workspaceMode = "linking"; linkingEnforced = true; workspaceLinked = true; loginUser = userA;
  const context = await newBrowserContext();
  try {
    const page = await context.newPage(); await page.goto(`${appOrigin}/auth/login?next=/auth/error`);
    await page.waitForURL(url => url.pathname === "/auth/error");
    expect(loginRecorded).toBe(true);
    expect((await current(context)).body.session.userId).toBe(userA);
    expect((await context.cookies()).find(cookie => cookie.name === "workspace_google_login")).toBeUndefined();
  } finally { await context.close(); }
}, 120_000);


test("real browser API transport recovers one marked pre-effect rejection and replays the read once", async () => {
  const { context, page } = await start();
  const calls: string[] = [];
  context.on("request", request => { calls.push(new URL(request.url()).pathname); });
  try {
    await page.addScriptTag({ content: browserClientCode });
    await page.evaluate("FounderOpsBrowser.createBrowserSessionAdapter().current()");
    rejectUserAt = userCalls+2;
    const result = await page.evaluate<{ status: number; body: unknown }>("FounderOpsBrowser.createBrowserApiClient().requestJson('/api/team-workweek/team').then(result => ({status: result.response.status, body: result.body}))");
    expect(result.status).toBe(200);
    expect(calls.filter(call => call === "/api/team-workweek/team")).toHaveLength(2);
    expect(calls.filter(call => call === "/api/auth/session/recover")).toHaveLength(1);
    expect((await current(context)).body.session.userId).toBe(userA);
  } finally { await context.close(); }
}, 120_000);


test("release workspace clears the previous account before its replacement document or delayed data arrives", async () => {
  loginUser = userA;
  const context = await newBrowserContext();
  let releaseDocument: (() => void) | undefined, releaseData: (() => void) | undefined;
  try {
    const page = await context.newPage();
    await page.goto(`${appOrigin}/auth/login?next=/team/platform-releases`);
    await page.waitForURL(`${appOrigin}/team/platform-releases`);
    await page.getByText("Synthetic previous account release", { exact: true }).first().waitFor();
    await context.request.get(`${appOrigin}/auth/error`);
    await page.waitForLoadState("networkidle");
    await page.addScriptTag({ content: browserClientCode });
    await page.evaluate("FounderOpsBrowser.createBrowserSessionAdapter().current()");
    let observeLeaving: (value: {text: string; account: boolean}) => void;
    const leavingState = new Promise<{text: string; account: boolean}>(resolve => { observeLeaving = resolve; });
    await page.exposeBinding("observeLeavingSession", (_source, value) => observeLeaving(value));
    await page.evaluate("window.addEventListener('beforeunload', () => { void window.observeLeavingSession({text: document.body.innerText, account: !!document.querySelector('[aria-label=\"Account-Menü öffnen\"]')}); })");
    let observeData: (value: unknown) => void;
    const oldResult = new Promise<unknown>(resolve => { observeData = resolve; });
    await page.exposeBinding("observeOldSessionResult", (_source, value) => observeData(value));
    page.on("requestfailed", request => { if (new URL(request.url()).pathname === "/api/team-workweek/team") observeData({ kind: "aborted" }); });
    let dataEntered: () => void;
    const dataStarted = new Promise<void>(resolve => { dataEntered = resolve; });
    await page.route("**/api/team-workweek/team", async route => {
      dataEntered(); await heldResponse(release => { releaseData = release; });
      try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ secret: "previous-account-delayed-data" }) }); }
      catch (error) { if (!route.request().failure()) throw error; }
    });
    await page.evaluate("FounderOpsBrowser.createBrowserApiClient().requestJson('/api/team-workweek/team').then(result => window.observeOldSessionResult({status: result.response.status, body: result.body})); undefined");
    await checkpoint("previous account data request started", dataStarted);
    let documentEntered: () => void;
    const documentStarted = new Promise<void>(resolve => { documentEntered = resolve; });
    await page.route("**/team/platform-releases", async route => {
      documentEntered(); await heldResponse(release => { releaseDocument = release; }); await route.continue();
    });
    loginUser = userB;
    const other = await context.newPage(); await other.bringToFront();
    await other.goto(`${appOrigin}/auth/login?next=/auth/error`);
    await other.waitForURL(`${appOrigin}/auth/error`);
    await checkpoint("release page regained focus", page.bringToFront());
    await checkpoint("focused page session check scheduled", page.evaluate(() => { window.setTimeout(() => window.dispatchEvent(new Event("focus")), 0); }));
    const leaving = await checkpoint("replacement document starts after protected content clears", leavingState);
    expect(leaving.text).not.toContain("Synthetic previous account release");
    expect(leaving.account).toBe(false);
    await checkpoint("replacement SSR document requested", documentStarted);
    releaseData!();
    const obsolete = await checkpoint("obsolete data discarded", oldResult);
    expect([JSON.stringify({ kind: "aborted" }), JSON.stringify({ status: 409, body: { error: "Die Sitzung wurde ersetzt.", code: "session_superseded" } })]).toContain(JSON.stringify(obsolete));
    releaseDocument!();
    await page.getByText("Synthetic replacement release", { exact: true }).first().waitFor();
    expect((await current(context)).body.session.userId).toBe(userB);
  } finally { pendingGates.forEach(release => release()); await context.close(); }
}, 120_000);

async function newBrowserContext() {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return origin === appOrigin || origin === authOrigin ? route.continue() : route.abort("blockedbyclient");
  });
  return context;
}

test.each([
  ["ceo", false, 400, 400], ["founder", false, 400, 403], ["deputy", false, 400, 400],
  ["viewer", false, 403, 403], ["viewer", true, 403, 400],
] as const)("production Chromium preserves %s contributor and operational boundaries with administrator=%s", async (platformRole, administrator, toolStatus, eventStatus) => {
  role = platformRole; activeAdministrator = administrator;
  const { context, page } = await start();
  try {
    const statuses = await page.evaluate(async () => {
      const request = (path: string) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { tool: (await request("/api/tools")).status, event: (await request("/api/events")).status };
    });
    // 400 proves admission reached unchanged domain input validation, not a persisted mutation.
    expect(statuses).toEqual({ tool: toolStatus, event: eventStatus });
    expect((await context.request.post(`${appOrigin}/api/auth/local-login`, { data: { profileId: "synthetic-profile" } })).status()).toBe(404);
  } finally { await context.close(); }
}, 30_000);

test("production browser entry rejects anonymous and unmapped sessions even with local simulation flags", async () => {
  const anonymous = await newBrowserContext();
  try {
    expect((await anonymous.request.post(`${appOrigin}/api/tools`, { data: {} })).status()).toBe(401);
    expect((await anonymous.request.post(`${appOrigin}/api/auth/local-login`, { data: { profileId: "synthetic-profile" } })).status()).toBe(404);
  } finally { await anonymous.close(); }
  const { context, page } = await start();
  try {
    mapped = false;
    expect(await page.evaluate(async () => (await fetch("/api/tools", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)).toBe(403);
  } finally { await context.close(); }
}, 30_000);
