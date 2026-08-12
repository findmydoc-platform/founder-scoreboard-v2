import type { NextRequest } from "next/server";
import { handleBrowserInitiativeUpdate } from "@/features/planning-items/model/planning-items-browser-initiative-update";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleBrowserInitiativeUpdate(request, context);
}
