import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdministrationProfile,
  AdministrationReadModel,
} from "@/features/administration/model/administration-read-model";
import { mapNotificationDelivery, mapNotificationEvent } from "@/lib/planning-row-mappers";
import type { DbNotificationDelivery, DbNotificationEvent } from "@/lib/planning-row-types";
import type { PlatformRole } from "@/lib/types";
import { googleChatDeliveryStatus } from "@/lib/google-chat";
import { getGitHubAppOperationalStatus } from "@/lib/github-app";

type GrantRow = {
  profile_id: string;
  eligible: boolean;
  active_until: string | null;
};

type DirectorySnapshot = {
  people?: Array<{
    id: string;
    name: string;
    platformRole: PlatformRole;
    orgRole: string;
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
  supabase: SupabaseClient,
): AdministrationReadModel {
  return {
    async load({ capabilities }) {
      if (!capabilities.manageAdministratorEligibility) return { status: "forbidden" };
      const technical = capabilities.technicalAdministration;
      const [directoryResult, eventResult, deliveryResult, githubAppStatus] = await Promise.all([
        supabase.rpc("administrator_directory_snapshot"),
        technical
          ? supabase.from("notification_events").select("id,type,actor_profile_id,actor_label,recipient_profile_id,entity_type,entity_id,title,body,target_path,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at").order("created_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        technical
          ? supabase.from("notification_deliveries").select("id,event_id,channel,status,attempts,target,payload,last_error,delivered_at,created_at").order("created_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        technical ? getGitHubAppOperationalStatus() : Promise.resolve(null),
      ]);

      if (directoryResult.error?.code === "42501") {
        return { status: "forbidden" };
      }
      if (directoryResult.error || eventResult.error || deliveryResult.error) {
        return { status: "unavailable" };
      }

      const now = Date.now();
      const directory = (directoryResult.data || {}) as DirectorySnapshot;
      const people: AdministrationProfile[] = (directory.people || []).map((profile) => ({
        id: profile.id,
        name: profile.name,
        platformRole: profile.platformRole,
        orgRole: profile.orgRole || "",
        githubLogin: technical ? profile.githubLogin || "" : "",
        githubConnection: technical && profile.githubConnection ? profile.githubConnection : null,
        googleChatUserId: technical ? profile.googleChatUserId || "" : "",
        googleChatDmSpace: technical ? profile.googleChatDmSpace || "" : "",
        notificationsEnabled: technical ? profile.notificationsEnabled !== false : false,
        googleChatReady: technical && Boolean(profile.googleChatUserId && profile.googleChatDmSpace && profile.notificationsEnabled !== false),
        administratorAccess: accessForGrant({ profile_id: profile.id, eligible: profile.eligible, active_until: profile.activeUntil }, now),
      }));
      const project = directory.project || null;
      const notificationEvents = ((eventResult.data || []) as DbNotificationEvent[]).map(mapNotificationEvent);
      const notificationDeliveries = ((deliveryResult.data || []) as DbNotificationDelivery[]).map(mapNotificationDelivery);
      const googleChatStatus = googleChatDeliveryStatus();
      const revision = [
        ...(directory.people || []).map((profile) => profile.activeUntil || String(profile.eligible)),
        ...notificationEvents.map((event) => event.createdAt),
        ...notificationDeliveries.map((delivery) => delivery.createdAt),
      ].sort().at(-1) || "";

      return {
        status: "ready",
        model: {
          revision,
          capabilities,
          people,
          githubProject: technical && project ? project : null,
          notificationEvents,
          notificationDeliveries,
          integrationStatus: {
            githubApp: githubAppStatus,
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
