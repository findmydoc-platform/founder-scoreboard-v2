import { authorizeCredentialAction } from "@/lib/credentials";
import "server-only";

import type {
  AdministrationProfile,
  AdministrationReadModel,
} from "@/features/administration/model/administration-read-model";
import { mapNotificationDelivery, mapNotificationEvent } from "@/lib/planning-row-mappers";
import type { DbNotificationDelivery, DbNotificationEvent } from "@/lib/planning-row-types";
import type { PlatformRole } from "@/lib/types";
import { googleChatDeliveryStatus } from "@/lib/google-chat";
import { resolveGitHubMentionTeam } from "@/lib/github-mention-team-config";

type GrantRow = {
  profile_id: string;
  eligible: boolean;
  active_until: string | null;
};

export type AdministrationDirectorySnapshot = {
  people?: Array<{
    id: string;
    name: string;
    platformRole: PlatformRole;
    orgRole: string;
    technicalBasis?: import("../model/administration-read-model").TechnicalIdentityBasis;
    githubLogin?: string;
    githubConnection?: {
      status: "incomplete" | "prepared" | "active";
      description: string;
      lastSignInAt: string | null;
    };
    googleChatUserId?: string;
    googleChatDmSpace?: string;
    notificationsEnabled?: boolean;
    eligible: boolean;
    activeUntil: string | null;
  }>;
  project?: { id: string; owner: string; number: number } | null;
};

export type AdministrationProjectRow = { id: string; github_project_owner: string | null; github_project_number: number | null; github_mention_team_slug: string | null };
type DataResult<T> = PromiseLike<{ data: T | null; error: { code?: string } | null }>;
export type AdministrationDataAccess = {
  readDirectory(): DataResult<AdministrationDirectorySnapshot>;
  readNotificationEvents(): DataResult<DbNotificationEvent[]>;
  readNotificationDeliveries(): DataResult<DbNotificationDelivery[]>;
  readProject(): DataResult<AdministrationProjectRow>;
};

function accessForGrant(grant: GrantRow | undefined, now: number) {
  const active = Boolean(
    grant?.eligible
    && grant.active_until
    && new Date(grant.active_until).getTime() > now,
  );
  return {
    eligible: grant?.eligible === true,
    active,
    expiresAt: active ? grant?.active_until || null : null,
  };
}

export function createSupabaseAdministrationReadModel(
  data: AdministrationDataAccess,
): AdministrationReadModel {
  return {
    async load({ capabilities }) {
      if (!capabilities.manageAdministratorEligibility) return { status: "forbidden" };
      const technical = capabilities.technicalAdministration;
      const [directoryResult, eventResult, deliveryResult, githubAppStatus, githubProjectResult] = await Promise.all([
        data.readDirectory(),
        technical
          ? data.readNotificationEvents()
          : Promise.resolve({ data: [], error: null }),
        technical
          ? data.readNotificationDeliveries()
          : Promise.resolve({ data: [], error: null }),
        technical ? authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.installation.status" }) : Promise.resolve(null),
        technical
          ? data.readProject()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if ([directoryResult, eventResult, deliveryResult, githubProjectResult].some(result => result.error?.code === "42501")) {
        return { status: "forbidden" };
      }
      if (directoryResult.error || eventResult.error || deliveryResult.error || githubProjectResult.error) {
        return { status: "unavailable" };
      }

      const now = Date.now();
      const directory = (directoryResult.data || {}) as AdministrationDirectorySnapshot;
      const people: AdministrationProfile[] = (directory.people || []).map((profile) => ({
        id: profile.id,
        name: profile.name,
        platformRole: profile.platformRole,
        orgRole: profile.orgRole || "",
        technicalBasis: technical ? profile.technicalBasis : undefined,
        githubLogin: technical ? profile.githubLogin || "" : "",
        githubConnection: technical && profile.githubConnection ? profile.githubConnection : null,
        googleChatUserId: technical ? profile.googleChatUserId || "" : "",
        googleChatDmSpace: technical ? profile.googleChatDmSpace || "" : "",
        notificationsEnabled: technical ? profile.notificationsEnabled !== false : false,
        googleChatReady: technical && Boolean(profile.googleChatUserId && profile.googleChatDmSpace && profile.notificationsEnabled !== false),
        administratorAccess: accessForGrant({ profile_id: profile.id, eligible: profile.eligible, active_until: profile.activeUntil }, now),
      }));
      const projectRow = githubProjectResult.data as AdministrationProjectRow | null;
      const validatedMentionTeam = technical && projectRow?.github_project_owner && projectRow.github_mention_team_slug
        ? await resolveGitHubMentionTeam(projectRow.github_project_owner, projectRow.github_mention_team_slug)
        : undefined;
      const project = technical && projectRow ? {
        id: projectRow.id,
        owner: projectRow.github_project_owner || "",
        number: projectRow.github_project_number || 0,
        mentionTeamSlug: projectRow.github_mention_team_slug || "",
      } : directory.project ? { ...directory.project, mentionTeamSlug: "" } : null;
      const notificationEvents = ((eventResult.data || []) as DbNotificationEvent[]).map(mapNotificationEvent);
      const notificationDeliveries = ((deliveryResult.data || []) as DbNotificationDelivery[]).map(mapNotificationDelivery);
      const googleChatStatus = await googleChatDeliveryStatus();
      const revision = [
        ...(directory.people || []).map((profile) => profile.activeUntil || String(profile.eligible)),
        ...notificationEvents.map((event) => event.createdAt),
        ...notificationDeliveries.map((delivery) => delivery.createdAt),
      ].sort().at(-1) || "";

      return {
        status: "ready",
        model: {
          revision,
          coverage: { people: "complete", technical, notificationEvents: technical ? "partial" : "none", notificationDeliveries: technical ? "partial" : "none" },
          capabilities,
          people,
          githubProject: technical && project ? project : null,
          notificationEvents,
          notificationDeliveries,
          integrationStatus: {
            githubApp: githubAppStatus,
            mentionTeam: {
              state: githubAppStatus?.available && Boolean(validatedMentionTeam) ? "ready" : "fallback",
              githubHandle: validatedMentionTeam ? `@${validatedMentionTeam.organization}/${validatedMentionTeam.teamSlug}` : "",
              profilesWithoutGitHubLogin: people.filter((person) => !person.githubLogin).length,
            },
            googleChat: {
              ...googleChatStatus,
              mode: googleChatStatus.mode as "direct-dm" | "space-webhook" | "not-configured",
            },
            pendingDeliveries: notificationEvents.filter((event) => event.status === "pending").length,
            failedDeliveries: notificationDeliveries.filter((delivery) => delivery.status === "failed").length,
          },
        },
      };
    },
  };
}
