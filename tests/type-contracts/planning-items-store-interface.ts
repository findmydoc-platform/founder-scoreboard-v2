import type { PlanningItemsStore } from "../../src/features/planning-items/model/planning-items-store";

type Assert<T extends true> = T;

export type PlanningItemsStoreHasOnlyTwoOperations = Assert<
  keyof PlanningItemsStore<unknown, unknown> extends "prepare" | "commit" ? true : false
>;
