import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

// Run only in the integration project's isolated environment. All Auth responses are synthetic.
let auth: Server, app: ChildProcess, browser: Browser, authOrigin: string, appOrigin: string;
let releaseRefresh: (() => void) | undefined;
let refreshEntered: (() => void) | undefined;
let holdRefresh = false;
let holdLogin = false;
let releaseLogin: (() => void) | undefined;
let loginEntered: (() => void) | undefined;
const evidenceDirectory = mkdtempSync(path.join(tmpdir(), "session-browser-evidence-"));
let logs = "";
const cookieBase = "sb-localhost-auth-token";
const userA = "b1111111-1111-4111-8111-111111111111";
const userB = "b2222222-2222-4222-8222-222222222222";
function token(userId: string) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const value = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: userId, aud: "authenticated", role: "authenticated", iss: `${authOrigin}/auth/v1`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, session_id: userId })}`;
  return `${value}.${createHmac("sha256", "synthetic-browser-signing-key").update(value).digest("base64url")}`;
}
function session(userId: string) {
  return { access_token: token(userId), refresh_token: `synthetic-refresh-${userId}`, expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user: { id: userId, aud: "authenticated", user_metadata: {} } };
}
async function listen(server: Server) {
  server.listen(0, "localhost"); await once(server, "listening");
  return `http://localhost:${(server.address() as { port: number }).port}`;
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
      const claims = JSON.parse(Buffer.from(request.headers.authorization!.slice(7).split(".")[1], "base64url").toString());
      send({ id: claims.sub, aud: "authenticated", user_metadata: {} }); return;
    }
    if (url.pathname === "/auth/v1/token") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (url.searchParams.get("grant_type") === "pkce") { send({ ...session(userB), provider_token: "synthetic-provider-proof" }); return; }
      if (holdRefresh) { refreshEntered?.(); await new Promise<void>(resolve => { releaseRefresh = resolve; }); }
      send(session(body.refresh_token.endsWith(userB) ? userB : userA)); return;
    }
    if (url.pathname === "/auth/v1/logout") { response.writeHead(204); response.end(); return; }
    if (url.pathname === "/rest/v1/rpc/workspace_access_context") {
      if (holdLogin) { holdLogin = false; loginEntered?.(); await new Promise<void>(resolve => { releaseLogin = resolve; }); }
      send({ mode: "legacy", linkingEnforced: false, linked: false, userId: userA, profileId: "synthetic-profile", identity: null }); return; }
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile") { send({ id: "synthetic-profile", name: "Synthetic Founder", platform_role: "founder" }); return; }
    if (url.pathname === "/rest/v1/rpc/administrator_access_snapshot") { send({ eligible: false, active: false }); return; }
    if (url.pathname.startsWith("/rest/v1/")) { send([]); return; }
    send({ error: "Unscripted synthetic protocol" }, 501);
  });
  authOrigin = await listen(auth);
  const port = await freePort(); appOrigin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "HOME", "TMPDIR", "NODE_OPTIONS"].includes(key))), NODE_ENV: "development" };
  Object.assign(env, { NEXT_TELEMETRY_DISABLED: "1", APP_URL: appOrigin, NEXT_PUBLIC_SUPABASE_URL: authOrigin, SUPABASE_URL: authOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", port], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout!.on("data", chunk => { logs = (logs + String(chunk)).slice(-4000); });
  app.stderr!.on("data", chunk => { logs = (logs + String(chunk)).slice(-4000); });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error(`Synthetic session app exited: ${logs}`);
    try { if ((await fetch(`${appOrigin}/api/auth/login-mode`)).ok) break; } catch { /* Wait for the local app socket. */ }
    if (attempt === 119) throw new Error(`Synthetic session app did not start: ${logs}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  releaseRefresh?.(); releaseLogin?.(); await browser?.close(); app?.kill("SIGTERM");
  if (app && app.exitCode === null) await once(app, "exit");
  if (auth) await new Promise<void>(resolve => auth.close(() => resolve()));
});

async function start() {
  const context = await browser.newContext();
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

test("Chromium keeps a newer login after an older refresh response writes its actual Set-Cookie headers", async () => {
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
    expect((await current(context)).body.session.userId).toBe(userB);
    releaseRefresh!(); holdRefresh = false;
    expect((await pending).status).toBe(200);
    const actualCookies = await context.cookies();
    expect(actualCookies.find(cookie => cookie.name === `${cookieBase}-g-${initial}`)).toBeDefined();
    expect(actualCookies.find(cookie => cookie.name === `${cookieBase}-active`)!.value).toBe(replacement);
    expect(actualCookies.find(cookie => cookie.name === `${cookieBase}-g-${replacement}`)!.httpOnly).toBe(true);
    expect((await current(context)).body.session.userId).toBe(userB);
    const encoded = actualCookies.find(cookie => cookie.name === `${cookieBase}-g-${replacement}`)!.value;
    expect(JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString()).provider_token).toBeUndefined();
  } finally { releaseRefresh?.(); holdRefresh = false; await context.close(); }
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
  const context = await browser.newContext();
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
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
  const protocols: string[] = []; const scripts: Promise<string>[] = [];
  context.on("request", request => { protocols.push(new URL(request.url()).pathname); });
  context.on("response", response => { if (new URL(response.url()).pathname.startsWith("/_next/static/") && response.url().includes(".js")) scripts.push(response.text().catch(() => "")); });
  try {
    const page = await context.newPage(); await page.goto(`${appOrigin}/auth/login?next=//unapproved.example.test`);
    await expect.poll(async () => page.locator('[role="status"]').textContent()).toContain("nicht sicher vorbereitet");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/");
    for (const [width, height] of [[320,568],[390,844],[768,1024],[1024,768],[1440,900]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const retry = page.getByRole("button", { name: "Erneut versuchen" }); expect(await retry.isVisible()).toBe(true);
      const bounds = await retry.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
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
  const context = await browser.newContext();
  const requests: Array<{ path: string; authorization: string | undefined }> = [];
  context.on("request", request => requests.push({ path: new URL(request.url()).pathname, authorization: request.headers().authorization }));
  try {
    const page = await context.newPage();
    const sessionRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session");
    await page.goto(`${appOrigin}/auth/login?next=${encodeURIComponent(workspace)}`);
    await page.waitForURL(`${appOrigin}${workspace}`);
    expect((await sessionRead).status()).toBe(200);
    await page.getByRole("button", { name: /Account-Menü öffnen/ }).click();
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    if (workspace === "/planning") await expect.poll(async () => page.locator("body").textContent()).toContain("abgemeldet");
    else await page.waitForURL(`${appOrigin}/`);
    expect((await current(context)).status).toBe(401);
    expect(requests.filter(request => request.path.startsWith("/api/")).every(request => !request.authorization)).toBe(true);
    expect(requests.some(request => request.path === "/auth/v1/token" || request.path === "/auth/v1/user")).toBe(false);
  } finally { await context.close(); }
}, 120_000);
