import { type NextRequest, NextResponse } from "next/server";
import { restartPrivateTeamWorkweek } from "@/features/team-workweek/server/team-workweek-restart";
import { TeamWorkweekPublicationError } from "@/features/team-workweek/server/team-workweek-publication";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requireTeamMember } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase-user";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
  const context=await requireApiContext(request,requireTeamMember);
  if(!context.ok)return context.response;
  const token=bearerToken(request);const userSupabase=token?getSupabaseForToken(token):null;
  const serviceSupabase=getServerServiceRoleSupabase();const ownerProfileId=context.permission.profile?.id;
  if(!userSupabase)return apiError("Anmeldung erforderlich.",401);
  if(!ownerProfileId)return apiError("Gebundenes Teamprofil erforderlich.",403);
  if(!serviceSupabase)return apiError("Neustart ist derzeit nicht verfügbar.",503);
  const input=await readJsonPayload<Record<string,unknown>|null>(request,null);
  if(!input || Object.keys(input).some(key=>key!=="versionId") || typeof input.versionId!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.versionId))return apiError("Gültige private Wochenversion ist erforderlich.",400);
  try{
    const result=await restartPrivateTeamWorkweek({ownerProfileId,versionId:input.versionId,userSupabase,serviceSupabase});
    return NextResponse.json(result,{status:result.restart.state==="delayed"?202:200});
  }catch(error){
    if(error instanceof TeamWorkweekPublicationError)return apiError(error.message,error.code==="forbidden"?403:error.code==="not_found"?404:error.code==="conflict"?409:503);
    return apiError("Private Version konnte nicht neu begonnen werden.",503);
  }
}
