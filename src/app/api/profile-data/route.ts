import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";
import { createSupabaseProfileReadModel } from "@/features/profile/server/profile-read-model-supabase";

export const GET = (request: NextRequest) => supportingWorkspaceGet(request, createSupabaseProfileReadModel, "Profil");
