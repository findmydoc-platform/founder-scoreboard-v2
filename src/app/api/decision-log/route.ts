import { NextResponse } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { authzError } from "@/lib/api-response";
import { loadNotionDecisionLog } from "@/lib/notion-decision-log";
import { observeRuntimeHandler } from "@/lib/runtime-logging";
async function handleGET() {
  const permission=await authorizeCredentialAction({credential:{kind:"server-cookies"},action:"decision-log.read"});
  if(!permission.ok) return authzError(permission);
  const result=await loadNotionDecisionLog(permission.notion);
  return NextResponse.json({result},{headers:{"Cache-Control":"no-store"}});
}
export const GET=observeRuntimeHandler("decision-log.read",handleGET);
