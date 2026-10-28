import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
import type { GoogleWorkspaceConnectionStatus, GoogleWorkspaceDisconnectView } from "./google-workspace-connection";

export type GoogleWorkspaceReply<T> = { status: number; value: (Partial<T> & { error?: string; code?: string }) | null };
export type GoogleWorkspaceRead = { connection: GoogleWorkspaceConnectionStatus; disconnectPending?: boolean };
export type GoogleDisconnectRead = { disconnect: GoogleWorkspaceDisconnectView };
export type GoogleDisconnectResult = Readonly<{ state: "completed" | "cleaning" | "cleanup_pending" | "remove_pending"; recovery: "retry" | "reconnect" | null }>;
export type GoogleDisconnectConfirmation = { result: GoogleDisconnectResult };
export type GoogleDisconnectBasis = Readonly<{ kind: "google-disconnect"; preview: GoogleWorkspaceDisconnectView }>;
export type GoogleDisconnectOperation = Readonly<{
  phase: "idle" | "disconnecting" | "completed" | "partial" | "rejected" | "unconfirmed";
  submitted: Readonly<{ confirm: true; continuation: boolean; basis: GoogleDisconnectBasis | null }> | null;
  result: GoogleDisconnectResult | null; error: string; checked: boolean;
}>;
export type GoogleWorkspaceView = Readonly<{
  connection: GoogleWorkspaceConnectionStatus | null; readStatus: PlanningReadStatus; error: string; disconnectPending: boolean;
  preview: GoogleWorkspaceDisconnectView | null; previewStatus: PlanningReadStatus; previewError: string; previewBasis: GoogleDisconnectBasis | null;
  operation: GoogleDisconnectOperation; history: readonly GoogleDisconnectOperation[]; canContinue: boolean;
}>;
export type GoogleWorkspaceAdapter = {
  readGoogleWorkspace?: () => Promise<GoogleWorkspaceReply<GoogleWorkspaceRead>>;
  readGoogleDisconnect?: () => Promise<GoogleWorkspaceReply<GoogleDisconnectRead>>;
  disconnectGoogleWorkspace?: () => Promise<GoogleWorkspaceReply<GoogleDisconnectConfirmation>>;
};
export interface GoogleWorkspacePlanningState {
  googleWorkspace(): GoogleWorkspaceView;
  loadGoogleWorkspace(): Promise<GoogleWorkspaceReply<GoogleWorkspaceRead>>;
  loadGoogleDisconnectPreview(): Promise<GoogleWorkspaceReply<GoogleDisconnectRead>>;
  disconnectGoogleWorkspace(basis: GoogleDisconnectBasis): Promise<GoogleWorkspaceReply<GoogleDisconnectConfirmation>>;
  continueGoogleDisconnect(): Promise<GoogleWorkspaceReply<GoogleDisconnectConfirmation>>;
}
