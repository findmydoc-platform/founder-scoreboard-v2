import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeCredentialAction } from "@/lib/credentials";
import { GoogleWorkspaceOAuthContractError } from "@/lib/google-calendar-errors";

export async function calendarForWorkweekOwner(_service: SupabaseClient, ownerProfileId: string, request?: NextRequest, operationId?: string) {
  if (!request) throw new GoogleWorkspaceOAuthContractError("reconnect_required", "Gebundene FounderOps-Sitzung ist erforderlich.");
  return (await authorizeCredentialAction({credential:{kind:"session-request",request},action:"google-calendar.workweek",target:{ownerProfileId,...(operationId ? {disconnectOperationId:operationId} : {})}})).calendar;
}
export async function removeWorkweekCalendarConnection(_service: SupabaseClient, ownerProfileId: string, request?: NextRequest, operationId?: string) {
  if (!request || !operationId) throw new GoogleWorkspaceOAuthContractError("reconnect_required", "Gebundene Trennung ist erforderlich.");
  await authorizeCredentialAction({credential:{kind:"session-request",request},action:"google-calendar.connection.remove",target:{ownerProfileId,operationId}});
}
