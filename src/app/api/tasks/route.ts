import type { NextRequest } from "next/server";
import { handleBrowserTaskCreate } from "@/features/planning-items/model/planning-items-browser-task-create";

export async function POST(request: NextRequest) {
  return handleBrowserTaskCreate(request);
}
