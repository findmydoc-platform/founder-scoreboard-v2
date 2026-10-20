import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const origin = "https://draft-auth.example.test";
const userId = "a1111111-1111-4111-8111-111111111111";
const sessionId = "b1111111-1111-4111-8111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "calendar-proof", alg: "ES256", use: "sig" };
let publicationGate, publishedFailure, writeNetworkFailure, conflictFailure, calls, privateVersion, publications, pendingPublication, automaticPublication, sourcePublication, conflictVersion, sourceVersion, editContext, writeResult, writeError;
let counts, member, directoryFailure, sessionAllowed, mappedProfile, delayDirectory, role, permits, dataFailure, changedBindingAt, deniedAccountAt, currentUser, precedingAuthDelay;

function token(overrides = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", typ: "JWT", kid: jwk.kid })}.${encode({
    sub: userId, session_id: sessionId, aud: "authenticated", role: "authenticated",
    iss: `${origin}/auth/v1`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600,
    amr: [{ method: "oauth" }], ...overrides,
  })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function protocol(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const count = category => { counts[category] = (counts[category] || 0) + 1; };
  if (url.pathname.endsWith("/.well-known/jwks.json")) { count("jwks"); return Response.json({ keys: [jwk] }); }
  if (url.pathname === "/auth/v1/user") { count("auth"); if (counts.auth === 1 && precedingAuthDelay) vi.setSystemTime(Date.now() + precedingAuthDelay); if (deniedAccountAt && counts.auth >= deniedAccountAt) return Response.json({ message: "Account unavailable" }, { status: 401 }); return Response.json({ id: currentUser, aud: "authenticated", identities: [] }); }
  if (url.pathname.endsWith("/rpc/workspace_access_context")) {
    count("binding");
    return Response.json({ mode: "linking", linkingEnforced: true, userId: currentUser, profileId: changedBindingAt && counts.binding >= changedBindingAt ? "rebound-profile" : mappedProfile, linked: true,
      identity: { sub: "google-subject", email: "member@findmydoc.eu", email_verified: true, iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } } });
  }
  if (url.pathname.endsWith("/rpc/workspace_linking_session_allowed")) { count("session"); return Response.json(sessionAllowed); }
  if (url.hostname === "sts.googleapis.com") { count("exchange"); return Response.json({ access_token: "synthetic-exchange" }); }
  if (url.hostname === "iamcredentials.googleapis.com") { count("impersonation"); return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now()+3600000).toISOString() }); }
  if (url.hostname === "admin.googleapis.com") {
    count("directory");
    if (delayDirectory) await delayDirectory();
    return directoryFailure ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ isMember: member });
  }
  if (url.pathname.endsWith("/rpc/workspace_issue_permit")) { count("permit"); permits.push(await request.json()); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/workspace_release_permit")) { count("release"); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/current_authenticated_profile")) { count("profile"); return Response.json({ id: mappedProfile, name: "Founder", platform_role: role }); }
  if (url.pathname.startsWith("/rest/v1/")) {
    calls.push({ path: url.pathname, search: url.searchParams, method: request.method, body: request.method === "POST" ? await request.json() : null, permit: request.headers.get("x-founderops-workspace-permit"), service: request.headers.get("apikey") === "synthetic-service" });
    count("data");
    if (dataFailure) return Response.json({ message: "query rejected" }, { status: 400 });
    if (url.pathname.endsWith("/rpc/team_workweek_edit_context")) return Response.json(editContext);
    if (url.pathname.includes("/rpc/create_private_")) { if (writeNetworkFailure) throw new Error("Synthetic lost mutation response"); return writeError ? Response.json(writeError, { status: 400 }) : Response.json(writeResult); }
    if (url.pathname.endsWith("/team_workweek_google_conflicts")) return conflictFailure ? Response.json({message:"private upstream detail"},{status:400}) : Response.json(conflictVersion ? { resolution_version_id: conflictVersion } : null);
    if (url.pathname.endsWith("/team_workweek_versions")) return Response.json(url.searchParams.has("id") ? sourceVersion : privateVersion);
    if (url.pathname.endsWith("/team_workweek_publications")) {
      if (url.searchParams.has("source_version_id")) return Response.json(sourcePublication?.byVersion ? sourcePublication.byVersion[url.searchParams.get("source_version_id").slice(3)] ?? null : sourcePublication);
      if (url.searchParams.get("status") === "eq.published") { if (publicationGate) await publicationGate.promise; return publishedFailure ? Response.json({message:"private upstream detail"},{status:400}) : Response.json(publications); }
      return Response.json(url.searchParams.get("select").includes("write_journal_version") ? pendingPublication : automaticPublication);
    }
  }
  throw new Error(`Unexpected protocol ${url.origin}${url.pathname}`);
}

async function application() {
  return importTestModule("src/app/api/team-workweek/private-draft/route.ts", { "server-only": {} });
}
function request(jwt = token(), search = "") {
  const url = new URL(`https://application.example.test/api/team-workweek/private-draft${search}`);
  return { headers: new Headers({ authorization: `Bearer ${jwt}` }), nextUrl: url };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_SECRET_KEY: "synthetic-service",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_URL: origin, SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_SECRET_KEY: "synthetic-service", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    REQUIRE_SUPABASE_AUTH: "true", VERCEL_OIDC_TOKEN: token(), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience",
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(key, value);
  publicationGate = null; publishedFailure = false; writeNetworkFailure = false; conflictFailure = false; calls = []; privateVersion = null; publications = []; pendingPublication = null; automaticPublication = null; sourcePublication = null; conflictVersion = null; sourceVersion = null; editContext = null; writeResult = {id: "saved-draft"}; writeError = null;
  counts = {}; member = true; directoryFailure = false; sessionAllowed = true; mappedProfile = "profile-1"; delayDirectory = null; role = "founder"; permits = []; dataFailure = false; changedBindingAt = null; deniedAccountAt = null; currentUser = userId; precedingAuthDelay = 0;
  vi.stubGlobal("fetch", protocol);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("first private draft load uses five separately permitted owner operations", async () => {
  const route = await application();
  const jwt = token();
  const result = await route.GET(request(jwt));
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ version: null, publication: null, weekContext: null });
  expect(calls).toHaveLength(5);
  expect(calls.find(call => call.search.get("team_workweek_versions.origin") === "eq.google_reconciliation").search.get("status")).toBe("eq.preparing");
  expect(calls.find(call => call.search.get("status") === "eq.published")).toBeTruthy();
  expect(calls.find(call => call.search.get("select")?.includes("write_journal_version")).search.get("status")).toBe("eq.preparing");
  const privateRead = calls.find(call => call.search.get("origin") === "eq.owner");
  expect(privateRead.search.get("retired_at")).toBe("is.null");
  expect(privateRead.search.get("limit")).toBe("1");
  expect(calls.every(call => call.permit && !call.service)).toBe(true);
  expect(calls.filter(call => call.path.endsWith("/rpc/team_workweek_edit_context"))).toHaveLength(1);
  expect(calls.filter(call => call.method === "GET").every(call => call.search.get("owner_profile_id") === "eq.profile-1")).toBe(true);
  expect(new Set(permits.map(permit => permit.p_hash)).size).toBe(6);
  expect(counts.release).toBe(6);
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(1);
});

const draftRow = (overrides = {}) => ({ id: "draft-1", owner_profile_id: "profile-1", effective_from: "2026-10-19", selected_week_start: "2026-10-19", activation_mode: "future_monday", timezone: "Europe/Berlin", status: "preparing", created_at: "2026-10-17T09:00:00Z", team_workweek_windows: [{ weekday: 1, start_minute: 540, end_minute: 720 }], ...overrides });
const publicationRow = (overrides = {}) => ({ id: "publication-1", source_version_id: "source-1", effective_from: "2026-10-12", status: "published", sync_state: "confirmed", publication_revision: 1, published_at: "2026-10-12T08:00:00Z", last_sync_at: "2026-10-12T08:00:00Z", windows: [{ weekday: 1, startMinute: 540, endMinute: 720 }], ...overrides });

function saveRequest(payload, jwt = token()) {
  const req = request(jwt);
  return { ...req, json: async () => payload };
}
function input(overrides = {}) {
  return { selectedWeekStart: "2026-10-19", contextToken: "a".repeat(32), windows: { monday: [{start:"09:00",end:"12:00"}], tuesday:[], wednesday:[], thursday:[], friday:[], saturday:[], sunday:[] }, ...overrides };
}

test("an existing owner draft loads its source publication with a separate permit", async () => {
  privateVersion = draftRow(); sourcePublication = publicationRow({ status: "preparing", source_version_id: "draft-1" });
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.version).toMatchObject({id:"draft-1",windows:{monday:[{start:"09:00",end:"12:00"}]}});
  expect(body.publication.id).toBe("publication-1");
  const sourceReads = calls.filter(call => call.search.has("source_version_id"));
  expect(sourceReads).toHaveLength(1);
  expect(sourceReads[0].search.get("source_version_id")).toBe("eq.draft-1");
  expect(sourceReads[0].search.get("owner_profile_id")).toBe("eq.profile-1");
  expect(calls).toHaveLength(6);
  expect(new Set(permits.map(permit => permit.p_hash)).size).toBe(7);
});

test("conflict resolution is owner-filtered and separately authorized before reading its publication", async () => {
  privateVersion = draftRow(); conflictVersion = "resolution-1";
  sourcePublication = {byVersion:{"resolution-1":publicationRow({id:"resolved-publication",status:"preparing"})}};
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect((await response.json()).publication.id).toBe("resolved-publication");
  const conflict = calls.find(call => call.path.endsWith("/team_workweek_google_conflicts"));
  expect(conflict.service).toBe(true);
  expect(conflict.search.get("owner_profile_id")).toBe("eq.profile-1");
  expect(conflict.search.get("founderops_version_id")).toBe("eq.draft-1");
  expect(conflict.search.get("state")).toBe("eq.resolving");
  expect(calls.filter(call => call.search.has("source_version_id")).map(call => call.search.get("source_version_id"))).toEqual(["eq.draft-1","eq.resolution-1"]);
  expect(counts.profile).toBe(2);
  expect(counts.permit).toBe(9);
});

test.each([null, "2026-10-19"])("expired automatic reconciliation preserves selected-week semantics: %s", async week => {
  automaticPublication = publicationRow({ id:"automatic-1", source_version_id:"automatic-source", status:"preparing", sync_state:"delayed", attempt_generation:1, effective_at:"2026-10-17T09:00:00Z" });
  sourceVersion = draftRow({id:"automatic-source",activation_mode:"immediate",selected_week_start:null});
  const route = await application(); const response = await route.GET(request(token(), week ? `?week=${week}` : ""));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.version?.id ?? null).toBe(week ? null : "automatic-source");
  expect(body.restartAvailable).toBe(!week);
  const automaticReads = calls.filter(call => call.search.has("id"));
  expect(automaticReads).toHaveLength(week ? 0 : 1);
  if (!week) {
    expect(automaticReads[0].search.get("owner_profile_id")).toBe("eq.profile-1");
    expect(automaticReads[0].search.get("origin")).toBe("eq.google_reconciliation");
    expect(automaticReads[0].search.get("retired_at")).toBe("is.null");
  }
});

test("a selected context is consumed once and a mixed publication snapshot returns 409", async () => {
  publications = [publicationRow()];
  editContext = {basePublicationId:"publication-1",basePublicationRevision:2};
  const route = await application(); const response = await route.GET(request(token(), "?week=2026-10-19"));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({code:"edit_context_stale"});
  expect(calls.filter(call => call.path.endsWith("/rpc/team_workweek_edit_context"))).toHaveLength(1);
});

test("a private draft future week chooses its own edit context and preserves recovery", async () => {
  privateVersion = draftRow();
  pendingPublication = {id:"pending",source_version_id:"draft-1",effective_from:"2026-10-19",effective_at:"2026-10-18T22:00:00Z",attempt_generation:1,write_journal_version:1,restart_requested_at:null};
  sourcePublication = publicationRow({id:"pending",status:"preparing",attempt_generation:1,effective_at:"2026-10-18T22:00:00Z"});
  editContext = {basePublicationId:null,basePublicationRevision:null};
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({restartAvailable:true,pendingPublication:{id:"pending",resumeAllowed:true},version:{selectedWeekStart:"2026-10-19"}});
  expect(calls.find(call => call.path.endsWith("/rpc/team_workweek_edit_context")).body).toEqual({p_week_start:"2026-10-19"});
});

test("successful save retains the selected owner-bound RPC and exactly one mutation", async () => {
  const route = await application(); const response = await route.POST(saveRequest(input()));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({version:{id:"saved-draft"}});
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({path:"/rest/v1/rpc/create_private_selected_team_workweek_version",method:"POST",body:{p_week_start:"2026-10-19",p_context_token:"a".repeat(32),p_windows:[{weekday:1,startMinute:540,endMinute:720}]}});
  expect(calls[0].permit).toBeTruthy();
  expect(counts.release).toBe(2);
});

test.each([["42501",403],["22023",400],["P0003",409],["P0004",409],["XX000",503]])("save retains safe query error contract %s", async (code, status) => {
  writeError = {code,message:"sensitive provider identity"};
  const route = await application(); const response = await route.POST(saveRequest(input()));
  expect(response.status).toBe(status);
  expect(JSON.stringify(await response.json())).not.toMatch(/sensitive provider identity/);
  expect(calls).toHaveLength(1);
  expect(counts.release).toBe(2);
});

test.each([input({contextToken:"invalid"}),input({ownerProfileId:"another-owner"}),input({windows:null})])("invalid save input has no mutation", async payload => {
  const route = await application(); const response = await route.POST(saveRequest(payload));
  expect(response.status).toBe(400);
  expect(calls).toHaveLength(0);
});

for (const [name, credential] of Object.entries({malformed:()=>"malformed",expired:()=>token({exp:Math.floor(Date.now()/1000)}),wrongAudience:()=>token({aud:"another-service"})})) {
  test.each(["GET","POST"])(`%s rejects ${name} credentials before reading or saving`, async method => {
    const route = await application(); const jwt = credential();
    const response = method === "GET" ? await route.GET(request(jwt)) : await route.POST(saveRequest(input(),jwt));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
}

test.each(["GET","POST"])("%s denies invalid role and removed session before data", async method => {
  const route = await application(); role = "unknown-role";
  const invoke = () => method === "GET" ? route.GET(request()) : route.POST(saveRequest(input()));
  expect((await invoke()).status).toBe(403);
  role = "founder"; sessionAllowed = false;
  expect((await invoke()).status).toBe(403);
  expect(calls).toHaveLength(0);
});

test("private draft evidence expires at the original deadline despite repeat reads", async () => {
  const route = await application(); const jwt = token(); const started = Date.now();
  expect((await route.GET(request(jwt))).status).toBe(200);
  for (const elapsed of [300000,600000,899999]) { vi.setSystemTime(started+elapsed); expect((await route.GET(request(jwt))).status).toBe(200); }
  expect(counts.directory).toBe(1);
  vi.setSystemTime(started+900000); directoryFailure = true;
  const before = calls.length;
  expect((await route.GET(request(jwt))).status).toBe(503);
  expect(calls).toHaveLength(before);
});

test("read and write capabilities do not grant each other's operations", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", {"server-only":{}});
  const read = await authorizeCredentialAction({credential:{kind:"session-request",request:request()},action:"workweek.private.read"});
  const write = await authorizeCredentialAction({credential:{kind:"session-request",request:request()},action:"workweek.private.write"});
  expect(read.ok && write.ok).toBe(true);
  expect(read.privateDraft).not.toHaveProperty("save");
  expect(write.privateDraft).not.toHaveProperty("readPrivateVersion");
  const authBefore = counts.auth;
  vi.setSystemTime(Date.now()+900000);
  expect((await write.privateDraft.save({...input(),windows:[],effectiveFrom:"2026-10-19"})).error).not.toBeNull();
  expect(counts.auth).toBe(authBefore);
  expect(calls).toHaveLength(0);
});

test("private draft read failures return the established safe load error", async () => {
  dataFailure = true;
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:"Offene Veröffentlichung konnte nicht geladen werden."});
  expect(counts.release).toBe(counts.permit);
});

test("private draft response omits internal provider identities from publication snapshots", async () => {
  publications = [publicationRow({team_workweek_google_series:[{id:"private-series",google_event_id:"secret-event",confirmed_etag:"secret-etag",state:"confirmed",provider_state:"active",projection_part:"legacy",source_window_ids:[]}],refresh_token:"secret-refresh"})];
  privateVersion = draftRow(); sourcePublication = publicationRow({status:"preparing"});
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toMatch(/secret-event|secret-etag|secret-refresh|private-series|google_event_id|refresh_token/);
});

test.each([
  [{activationMode:"immediate"},"create_private_immediate_team_workweek_version"],
  [{activationMode:"immediate",basePublicationId:"a1111111-1111-4111-8111-111111111111",basePublicationRevision:1},"create_private_current_team_workweek_version"],
  [{activationMode:"future_monday"},"create_private_team_workweek_version"],
  [{activationMode:"future_monday",basePublicationId:"a1111111-1111-4111-8111-111111111111",basePublicationRevision:1},"create_private_monday_team_workweek_version"],
])("legacy save preserves its owner-bound operation %s", async (intent,rpc) => {
  const {windows} = input();
  const route = await application(); const response = await route.POST(saveRequest({effectiveFrom:"2026-10-19",windows,...intent}));
  expect(response.status).toBe(201);
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe(`/rest/v1/rpc/${rpc}`);
  expect(calls[0].body.p_windows).toEqual([{weekday:1,startMinute:540,endMinute:720}]);
  expect(calls[0].permit).toBeTruthy();
});

test("calendar base windows and retained future plan remain distinct in the private editor", async () => {
  publications = [publicationRow({id:"future",effective_from:"2026-10-19",publication_revision:2,windows:[{weekday:1,startMinute:600,endMinute:960}]}),publicationRow({effective_to:"2026-10-18"})];
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({editBase:{basePublicationId:"publication-1",windows:{monday:[{start:"09:00",end:"12:00"}]}},preparedSuccessor:{id:"future"},latestPublished:{id:"publication-1"},immediateAllowed:true});
});

test("a selected future week compares against its own publication and requests its context once", async () => {
  publications = [publicationRow({id:"future",effective_from:"2026-10-19",publication_revision:2}),publicationRow({effective_to:"2026-10-18"})];
  editContext = {basePublicationId:"future",basePublicationRevision:2};
  const route = await application(); const response = await route.GET(request(token(),"?week=2026-10-19"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({weekContext:{basePublicationId:"future"},latestPublished:{id:"publication-1"}});
  expect(calls.filter(call => call.path.endsWith("/rpc/team_workweek_edit_context"))).toHaveLength(1);
});

test("two minutes before a successor starts the immediate option stays fenced", async () => {
  vi.setSystemTime(new Date("2026-10-18T21:58:00Z"));
  vi.stubEnv("VERCEL_OIDC_TOKEN", token());
  publications = [publicationRow({id:"future",effective_from:"2026-10-19",publication_revision:2}),publicationRow({effective_to:"2026-10-18"})];
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({immediateAllowed:false,editBase:{basePublicationId:"publication-1"}});
});

test.each(["private","published"])("expired automatic recovery retains the intended source with %s owner history", async history => {
  publications = [publicationRow()];
  privateVersion = draftRow({activation_mode:"immediate",selected_week_start:null,base_publication_id:"publication-1",base_publication_revision:1});
  sourceVersion = draftRow({id:"automatic-source",activation_mode:"immediate",selected_week_start:null,team_workweek_windows:[{weekday:1,start_minute:600,end_minute:1080}]});
  automaticPublication = publicationRow({id:"automatic",source_version_id:"automatic-source",status:"preparing",attempt_generation:1,effective_at:"2026-10-17T09:00:00Z"});
  if (history === "published") sourcePublication = publicationRow();
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({restartAvailable:true,publication:{id:"automatic"},version:{id:history === "private" ? "draft-1" : "automatic-source"}});
  expect(calls.filter(call => call.search.has("id"))).toHaveLength(history === "published" ? 1 : 0);
});

test.each([
  [{attempt_generation:0,write_journal_version:0,effective_at:null},true],
  [{attempt_generation:1,write_journal_version:0,effective_at:null},false],
  [{attempt_generation:1,write_journal_version:1,effective_at:"2026-10-18T22:00:00Z",last_error_class:"provider_identity_mismatch"},false],
  [{attempt_generation:1,write_journal_version:1,effective_at:"2026-10-18T22:00:00Z",restart_requested_at:"2026-10-17T09:00:00Z"},false],
])("pending publication preserves recovery eligibility %s", async (state,resumeAllowed) => {
  pendingPublication = {id:"pending",source_version_id:"source",effective_from:"2026-10-19",restart_requested_at:null,...state};
  const route = await application(); const response = await route.GET(request(token(),"?week=2026-10-26"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({pendingPublication:{id:"pending",resumeAllowed}});
});

test("a changed pinned successor mapping offers restart without revealing its identity", async () => {
  const future = publicationRow({id:"future",source_version_id:"future-source",effective_from:"2026-10-19",effective_at:"2026-10-18T22:00:00Z",publication_revision:2,windows:[],team_workweek_google_series:[{id:"series",google_event_id:"private-event",confirmed_etag:"old",state:"confirmed",provider_state:"active",projection_part:"legacy",source_window_ids:null}]});
  publications = [future,publicationRow()];
  privateVersion = draftRow({activation_mode:"immediate",selected_week_start:null,base_publication_id:"publication-1",base_publication_revision:1,successor_snapshot:[{id:"future",revision:2,start:future.effective_at,until:null,effectiveTo:null,sourceVersionId:"future-source",supersededBy:null,windows:[],series:[{id:"series",googleEventId:"private-event",etag:"old",state:"confirmed",providerState:"active",part:"legacy",sources:null}]}]});
  const route = await application(); const jwt = token();
  expect((await (await route.GET(request(jwt))).json()).restartAvailable).toBe(false);
  future.team_workweek_google_series[0].confirmed_etag = "new";
  const response = await route.GET(request(jwt));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.restartAvailable).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/private-event|confirmed_etag/);
});


test("unmapped sessions cannot open private conflict state", async () => {
  mappedProfile = null;
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(403);
  expect(calls).toHaveLength(0);
});

test("a separately authorized conflict lookup failure retains the safe load contract", async () => {
  privateVersion = draftRow(); conflictFailure = true;
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:"Privater Konfliktstatus konnte nicht geladen werden."});
});

test.each(["2026-10-05","2026-10-20"])("invalid selected week %s cannot reach a save operation", async selectedWeekStart => {
  const route = await application(); const response = await route.POST(saveRequest(input({selectedWeekStart})));
  expect(response.status).toBe(400);
  expect(calls).toHaveLength(0);
});


test("publication load failure retains the specific established response", async () => {
  publishedFailure = true;
  const route = await application(); const response = await route.GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:"Veröffentlichungsstatus konnte nicht geladen werden."});
});

test("a lost save response releases its permit without replaying the mutation", async () => {
  writeNetworkFailure = true;
  const route = await application(); const response = await route.POST(saveRequest(input()));
  expect(response.status).toBe(503);
  expect(calls).toHaveLength(1);
  expect(counts.release).toBe(counts.permit);
});

test("selected current week accepts its elapsed Monday and derives activation on the server", async () => {
  const route = await application(); const response = await route.POST(saveRequest(input({selectedWeekStart:"2026-10-12"})));
  expect(response.status).toBe(201);
  expect(calls[0].body.p_week_start).toBe("2026-10-12");
});

test("client-provided activation instants remain invalid", async () => {
  const route = await application(); const response = await route.POST(saveRequest(input({effectiveAt:"2026-10-17T10:00:00Z"})));
  expect(response.status).toBe(400);
  expect(calls).toHaveLength(0);
});

test("an explicit empty selected context is accepted once", async () => {
  editContext = {basePublicationId:null,basePublicationRevision:null};
  const route = await application(); const response = await route.GET(request(token(),"?week=2026-10-19"));
  expect(response.status).toBe(200);
  expect((await response.json()).weekContext.basePublicationId).toBeNull();
  expect(calls.filter(call => call.path.endsWith("/rpc/team_workweek_edit_context"))).toHaveLength(1);
});

test.each(["base identity","base revision"])("parallel publication changes cannot mix a captured selected context: %s", async change => {
  editContext = {basePublicationId:"publication-1",basePublicationRevision:1};
  publications = [publicationRow()];
  const contextCaptured = Promise.withResolvers();
  const publicationReleased = Promise.withResolvers();
  publicationGate = publicationReleased;
  const fetchProtocol = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const response = await fetchProtocol(input, init);
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith("/rpc/team_workweek_edit_context")) contextCaptured.resolve();
    return response;
  });
  const route = await application(); const response = route.GET(request(token(),"?week=2026-10-19"));
  try {
    await Promise.race([contextCaptured.promise, response.then(() => { throw new Error("Draft request completed before edit context was captured"); })]);
    expect(calls.some(call => call.path.endsWith("/rpc/team_workweek_edit_context"))).toBe(true);
    publications = [publicationRow(change === "base identity" ? {id:"publication-2"} : {publication_revision:2})];
    publicationReleased.resolve();
    const result = await response;
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({code:"edit_context_stale"});
    expect(calls.filter(call => call.path.endsWith("/rpc/team_workweek_edit_context"))).toHaveLength(1);
  } finally {
    publicationReleased.resolve();
    await Promise.allSettled([response]);
  }
});


test("explicit Workspace denial remains distinguishable from verification failure", async () => {
  member = false;
  const route = await application(); const response = await route.POST(saveRequest(input()));
  expect(response.status).toBe(403);
  expect(calls).toHaveLength(0);
  member = true; directoryFailure = true;
  expect((await route.POST(saveRequest(input()))).status).toBe(503);
  expect(calls).toHaveLength(0);
});
