import type { FmdTool, Profile } from "@/lib/types";

export type ToolsWorkspaceModel = Readonly<{
  revision: string;
  tools: readonly FmdTool[];
  people: readonly Profile[];
}>;

export type ToolsLoadResult = { status: "ready"; model: ToolsWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface ToolsReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<ToolsLoadResult>;
}
