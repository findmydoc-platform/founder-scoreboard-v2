import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";
import { createSupabaseEventsReadModel } from "@/features/events/server/events-read-model-supabase";

export const GET = (request: NextRequest) => supportingWorkspaceGet(request, createSupabaseEventsReadModel, "Termine und Erinnerungen");
