import type { DbFmdTool } from "@/lib/planning-row-types";
import { slugify } from "@/lib/slug";

export type ToolValues = Pick<DbFmdTool, "name" | "category" | "kind" | "description" | "url" | "owner" | "status" | "is_curated" | "preview_image_url" | "preview_image_source">;
type ToolWrite = ToolValues & { id?: string; sort_order?: number; updated_at?: string };
type Result<T> = { data: T | null; error: { message: string } | null };
type ToolPersistence = {
  countCurated(): PromiseLike<{ count: number | null; error: { message: string } | null }>;
  maximumOrder(): PromiseLike<Result<{ sort_order: number }>>;
  save(row: ToolWrite): PromiseLike<Result<DbFmdTool>>;
  audit(row: ToolWrite, saved: DbFmdTool): PromiseLike<unknown>;
};

export async function persistTool(values: ToolValues, operation: "create" | "update", persistence: ToolPersistence) {
  if (values.is_curated) {
    const counted = await persistence.countCurated();
    if (counted.error) return { ok: false as const, status: 500, error: counted.error.message };
    if ((counted.count || 0) >= 5) return { ok: false as const, status: 400, error: "Es können maximal 5 kuratierte Links sein." };
  }
  let row: ToolWrite;
  if (operation === "create") {
    const { data: maximum } = await persistence.maximumOrder();
    const id = `tool-${slugify(values.name, { maxLength: 64 }) || "neu"}-${Date.now().toString(36)}`;
    row = { ...values, id, sort_order: Number(maximum?.sort_order || 0) + 10 };
  } else row = { ...values, updated_at: new Date().toISOString() };
  const result = await persistence.save(row);
  if (result.error || !result.data) return { ok: false as const, status: 500, error: result.error?.message || "Link konnte nicht gespeichert werden." };
  await persistence.audit(row, result.data);
  return { ok: true as const, tool: result.data };
}
