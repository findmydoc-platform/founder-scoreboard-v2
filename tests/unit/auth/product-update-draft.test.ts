import { expect, it } from "vitest";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { selectActiveProductUpdates, selectUnseenProductUpdates } from "@/features/product-updates/model/product-update-selection";
it("does not announce the Google cutover before the operator publishes its update", () => {
  const update = productUpdates.find(item => item.id === "2026-09-26-google-workspace-login")!;
  expect(selectActiveProductUpdates([update], new Date("2026-09-27"))).toEqual([]);
  expect(selectUnseenProductUpdates([update], [], new Date("2026-09-27"))).toEqual([]);
  expect(selectActiveProductUpdates([{ ...update, draft: false }], new Date("2026-09-27"))).toHaveLength(1);
});
