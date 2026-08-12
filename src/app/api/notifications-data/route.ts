import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";
import { createSupabaseNotificationsReadModel } from "@/features/notifications/server/notifications-read-model-supabase";

export const GET = (request: NextRequest) => supportingWorkspaceGet(request, createSupabaseNotificationsReadModel, "Benachrichtigungen");
