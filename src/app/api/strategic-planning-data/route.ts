import { observeRuntimeHandler } from "@/lib/runtime-logging";
import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";

const handleGET = (request: NextRequest) => supportingWorkspaceGet(request, "strategic.read");

export const GET = observeRuntimeHandler("planning.strategic", handleGET);
