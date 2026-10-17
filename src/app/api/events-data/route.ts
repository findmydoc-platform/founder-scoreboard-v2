import type { NextRequest } from "next/server";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";

export const GET = (request: NextRequest) => supportingWorkspaceGet(request, "events.read");
