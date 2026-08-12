import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";
import { createSupabaseToolsReadModel } from "@/features/tools/server/tools-read-model-supabase";

export const GET = (request: NextRequest) => supportingWorkspaceGet(request, createSupabaseToolsReadModel, "Links und Tools");
