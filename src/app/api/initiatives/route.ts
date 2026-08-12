import type { NextRequest } from "next/server";
import {
  handleBrowserInitiativeCreate,
  handleBrowserInitiativesRead,
} from "@/features/planning-items/model/planning-items-browser-initiative-route";

export async function GET(request: NextRequest) {
  return handleBrowserInitiativesRead(request);
}

export async function POST(request: NextRequest) {
  return handleBrowserInitiativeCreate(request);
}
