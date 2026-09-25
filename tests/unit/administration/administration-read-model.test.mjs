import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let githubAppStatusCalls = 0;
let githubAppStatusResult = null;
let validatedMentionTeam = null;

beforeEach(() => {
  githubAppStatusCalls = 0;
  githubAppStatusResult = {
    available: true,
    state: "ready",
    description: "Die GitHub App ist erreichbar und die Installation ist verfügbar.",
    nextStep: "",
  };
  validatedMentionTeam = { organization: "findmydoc-platform", teamSlug: "founderops" };
});

function createSupabaseFixture({ projectError = null } = {}) {
  const calls = [];
  const data = {
    profiles: [
      {
        id: "sebastian",
        name: "Sebastian",
        platform_role: "ceo",
        org_role: "CEO",
        github_login: "sebastian",
        github_connection: {
          status: "active",
          description: "GitHub sebastian ist verbunden. Letzte Anmeldung am 22. September 2026 um 13:45.",
          lastSignInAt: "2026-09-22T11:45:00.000Z",
        },
        google_chat_user_id: "chat-user",
        google_chat_dm_space: "spaces/dm",
        notifications_enabled: true,
      },
      {
        id: "volkan",
        name: "Volkan",
        platform_role: "founder",
        org_role: "Founder",
        github_login: "volkan",
        github_connection: {
          status: "prepared",
          description: "GitHub volkan ist vorbereitet. Die erste Anmeldung bei FounderOps steht noch aus.",
          lastSignInAt: null,
        },
        google_chat_user_id: "",
        google_chat_dm_space: "",
        notifications_enabled: true,
      },
      {
        id: "anil",
        name: "Anil",
        platform_role: "viewer",
        org_role: "Design",
        github_login: "anil",
        github_connection: {
          status: "incomplete",
          description: "GitHub-Login und GitHub-Identität stimmen nicht überein.",
          lastSignInAt: null,
        },
        google_chat_user_id: "",
        google_chat_dm_space: "",
        notifications_enabled: false,
      },
    ],
    administrator_access_grants: [{
      profile_id: "sebastian",
      eligible: true,
      active_until: "2999-01-01T00:00:00.000Z",
    }],
    projects: [{ id: "project", github_project_owner: "findmydoc-platform", github_project_number: 1, github_mention_team_slug: "founderops" }],
    notification_events: [{ id: "event", created_at: "2026-09-22T12:00:00.000Z" }],
    notification_deliveries: [{ id: "delivery", created_at: "2026-09-22T12:01:00.000Z" }],
  };

  return {
    calls,
    async rpc(name) {
      assert.equal(name, "administrator_directory_snapshot");
      calls.push({ rpc: name });
      return {
        data: {
          people: data.profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            platformRole: profile.platform_role,
            orgRole: profile.org_role,
            githubConnection: profile.github_connection,
            githubLogin: profile.github_login,
            googleChatUserId: profile.google_chat_user_id,
            googleChatDmSpace: profile.google_chat_dm_space,
            notificationsEnabled: profile.notifications_enabled,
            eligible: data.administrator_access_grants[0].eligible,
            activeUntil: data.administrator_access_grants[0].active_until,
          })),
          project: {
            id: data.projects[0].id,
            owner: data.projects[0].github_project_owner,
            number: data.projects[0].github_project_number,
          },
        },
        error: null,
      };
    },
    from(table) {
      const call = { table, select: "" };
      calls.push(call);
      const query = {
        select(value) { call.select = value; return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        maybeSingle() {
          return Promise.resolve({
            data: data[table]?.[0] || null,
            error: table === "projects" ? projectError : null,
          });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: data[table] || [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const { createSupabaseAdministrationReadModel } = await importTestModule(
  "src/features/administration/server/administration-read-model-supabase.ts",
  {
    "server-only": {},
    "@/lib/github-app": {
      getGitHubAppOperationalStatus: async () => {
        githubAppStatusCalls += 1;
        return githubAppStatusResult;
      },
    },
    "@/lib/github-mention-team-config": {
      resolveGitHubMentionTeam: async () => validatedMentionTeam,
    },
    "@/lib/planning-row-mappers": {
      mapNotificationEvent: (row) => ({ id: row.id, createdAt: row.created_at }),
      mapNotificationDelivery: (row) => ({ id: row.id, createdAt: row.created_at }),
    },
  },
);

const eligibilityManager = {
  technicalAdministration: false,
  manageAdministratorEligibility: true,
  operationalCorrection: false,
  ceoGovernance: true,
};

test("administration reader fails closed before querying", async () => {
  const supabase = createSupabaseFixture();
  assert.deepEqual(
    await createSupabaseAdministrationReadModel(supabase).load({
      capabilities: { ...eligibilityManager, manageAdministratorEligibility: false },
    }),
    { status: "forbidden" },
  );
  assert.equal(supabase.calls.length, 0);
});

test("CEO eligibility view omits technical identity and delivery data", async () => {
  const supabase = createSupabaseFixture();
  const result = await createSupabaseAdministrationReadModel(supabase).load({ capabilities: eligibilityManager });

  assert.equal(result.status, "ready");
  assert.equal(result.model.people[0].githubLogin, "");
  assert.equal(result.model.people[0].githubConnection, null);
  assert.equal(result.model.githubProject, null);
  assert.equal(result.model.integrationStatus.githubApp, null);
  assert.equal(githubAppStatusCalls, 0);
  assert.deepEqual(result.model.notificationEvents, []);
  assert.deepEqual(result.model.notificationDeliveries, []);
  assert.deepEqual(supabase.calls.map((call) => call.rpc || call.table), ["administrator_directory_snapshot"]);
});

test("active administrator view projects technical identity and delivery operations", async () => {
  const supabase = createSupabaseFixture();
  const result = await createSupabaseAdministrationReadModel(supabase).load({
    capabilities: {
      ...eligibilityManager,
      technicalAdministration: true,
      operationalCorrection: true,
      ceoGovernance: false,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.model.people[0].githubLogin, "sebastian");
  assert.deepEqual(result.model.people.map((person) => person.githubConnection?.status), ["active", "prepared", "incomplete"]);
  assert.equal(result.model.people[0].githubConnection.lastSignInAt, "2026-09-22T11:45:00.000Z");
  assert.equal("authUserId" in result.model.people[0], false);
  assert.deepEqual(result.model.githubProject, { id: "project", owner: "findmydoc-platform", number: 1, mentionTeamSlug: "founderops" });
  assert.deepEqual(result.model.integrationStatus.githubApp, {
    available: true,
    state: "ready",
    description: "Die GitHub App ist erreichbar und die Installation ist verfügbar.",
    nextStep: "",
  });
  assert.equal(githubAppStatusCalls, 1);
  assert.equal(result.model.integrationStatus.mentionTeam.state, "ready");
  assert.equal(result.model.integrationStatus.mentionTeam.githubHandle, "@findmydoc-platform/founderops");
  assert.deepEqual(result.model.notificationEvents.map(({ id }) => id), ["event"]);
  assert.deepEqual(result.model.notificationDeliveries.map(({ id }) => id), ["delivery"]);
  assert.equal(result.model.revision, "2999-01-01T00:00:00.000Z");
});

test("configured but unavailable GitHub team keeps @all in fallback", async () => {
  validatedMentionTeam = undefined;
  const result = await createSupabaseAdministrationReadModel(createSupabaseFixture()).load({
    capabilities: {
      ...eligibilityManager,
      technicalAdministration: true,
      operationalCorrection: true,
      ceoGovernance: false,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.model.integrationStatus.mentionTeam.state, "fallback");
  assert.equal(result.model.integrationStatus.mentionTeam.githubHandle, "");
});

test("GitHub project query failures stay inside the unavailable read-model result", async () => {
  const result = await createSupabaseAdministrationReadModel(createSupabaseFixture({
    projectError: { message: "project query failed" },
  })).load({
    capabilities: {
      ...eligibilityManager,
      technicalAdministration: true,
      operationalCorrection: true,
      ceoGovernance: false,
    },
  });

  assert.deepEqual(result, { status: "unavailable" });
});

test("active administrator view projects the provider-owned GitHub App status", async () => {
  githubAppStatusResult = {
    available: false,
    state: "configuration_required",
    description: "Die serverseitige GitHub-App-Konfiguration ist unvollständig.",
    nextStep: "GitHub-App-ID, Installation und privaten Schlüssel in der Laufzeitkonfiguration prüfen.",
  };
  const supabase = createSupabaseFixture();

  const result = await createSupabaseAdministrationReadModel(supabase).load({
    capabilities: {
      ...eligibilityManager,
      technicalAdministration: true,
      operationalCorrection: true,
      ceoGovernance: false,
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.model.integrationStatus.githubApp, {
    available: false,
    state: "configuration_required",
    description: "Die serverseitige GitHub-App-Konfiguration ist unvollständig.",
    nextStep: "GitHub-App-ID, Installation und privaten Schlüssel in der Laufzeitkonfiguration prüfen.",
  });
  assert.equal(githubAppStatusCalls, 1);
});
