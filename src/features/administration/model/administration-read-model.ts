import type {
  AdministratorAccessSnapshot,
  AuthorityCapabilities,
} from "@/features/administrator-access/model/administrator-access";
import type { NotificationDelivery, NotificationEvent, PlatformRole } from "@/lib/types";

export type GitHubConnectionStatus = "incomplete" | "prepared" | "active";

export type GitHubConnection = Readonly<{
  status: GitHubConnectionStatus;
  description: string;
  lastSignInAt: string | null;
}>;

export type AdministrationProfile = Readonly<{
  id: string;
  name: string;
  platformRole: PlatformRole;
  orgRole: string;
  githubLogin: string;
  githubConnection: GitHubConnection | null;
  googleChatUserId: string;
  googleChatDmSpace: string;
  notificationsEnabled: boolean;
  googleChatReady: boolean;
  administratorAccess: AdministratorAccessSnapshot;
}>;

export type PersonAdministrationPatch = Readonly<{
  eligible: boolean;
  technicalIdentity: {
    githubLogin: string;
    googleChatUserId: string;
    googleChatDmSpace: string;
  };
}>;

export type AdministrationIntegrationStatus = Readonly<{
  googleChat: {
    ready: boolean;
    webhookConfigured: boolean;
    apiConfigured: boolean;
    deliveryEnabled: boolean;
    mode: "direct-dm" | "space-webhook" | "not-configured";
  };
  pendingDeliveries: number;
  failedDeliveries: number;
}>;

export type AdministrationWorkspaceModel = Readonly<{
  revision: string;
  capabilities: AuthorityCapabilities;
  people: readonly AdministrationProfile[];
  githubProject: Readonly<{
    id: string;
    owner: string;
    number: number;
  }> | null;
  notificationEvents: readonly NotificationEvent[];
  notificationDeliveries: readonly NotificationDelivery[];
  integrationStatus: AdministrationIntegrationStatus;
}>;

export type AdministrationLoadResult =
  | { status: "ready"; model: AdministrationWorkspaceModel }
  | { status: "forbidden" }
  | { status: "unavailable" };

export interface AdministrationReadModel {
  load(context: {
    capabilities: AuthorityCapabilities;
  }): Promise<AdministrationLoadResult>;
}
