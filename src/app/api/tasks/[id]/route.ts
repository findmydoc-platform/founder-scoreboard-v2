import type { NextRequest } from "next/server";
import {
  handleBrowserTaskDelete,
  handleBrowserTaskUpdate,
} from "@/features/planning-items/model/planning-items-browser-task-update";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleBrowserTaskUpdate(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleBrowserTaskDelete(request, context);
}
