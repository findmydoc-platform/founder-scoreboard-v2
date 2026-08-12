import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";
import { createSupabaseTeamReadModel } from "@/features/team/server/team-read-model-supabase";

export const GET = (request: NextRequest) => supportingWorkspaceGet(request, createSupabaseTeamReadModel, "Team");
