import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { type NextRequest, NextResponse } from "next/server";
import { TeamWorkweekPublicationError } from "@/features/team-workweek/server/team-workweek-publication";
import { apiError, readJsonPayload } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";
export const dynamic="force-dynamic";
async function handlePOST(request:NextRequest){
  const input=await readJsonPayload<Record<string,unknown>|null>(request,null);
  const context=await requirePlanningContext(request,"workweek.restart",typeof input?.versionId === "string" ? input.versionId : "");
  if(!context.ok)return context.response;
  if(!input || Object.keys(input).some(key=>key!=="versionId") || typeof input.versionId!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.versionId))return apiError("Gültige private Wochenversion ist erforderlich.",400);
  try{
    const result=await context.planning.restartWorkweek();
    return observeRuntimePreparation(() => NextResponse.json(result,{status:result.restart.state==="delayed"?202:200}));
  }catch(error){
    if(error instanceof TeamWorkweekPublicationError)return apiError(error.message,error.code==="forbidden"?403:error.code==="not_found"?404:error.code==="conflict"?409:503);
    return apiError("Private Version konnte nicht neu begonnen werden.",503);
  }
}

export const POST = observeRuntimeHandler("workweek.restart", handlePOST);
