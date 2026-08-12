import type { Profile, Sprint, SprintCommitment, Task } from "@/lib/types";

export type BacklogModel = Readonly<{
  revision: string;
  items: readonly Task[];
  people: readonly Profile[];
  sprints: readonly Sprint[];
  commitments: readonly SprintCommitment[];
}>;

export type BacklogReadContext = Readonly<{
  authorized: boolean;
  actorProfileId: string | null;
}>;

export type BacklogLoadResult =
  | { status: "ready"; model: BacklogModel }
  | { status: "forbidden" }
  | { status: "unavailable" };

export interface BacklogReadModel {
  load(context: BacklogReadContext): Promise<BacklogLoadResult>;
}

export type BacklogAction =
  | { type: "modelLoaded"; model: BacklogModel }
  | { type: "itemsPatched"; patches: readonly (Partial<Task> & Pick<Task, "id">)[] };

export function backlogModelReducer(model: BacklogModel, action: BacklogAction): BacklogModel {
  if (action.type === "modelLoaded") return action.model;
  const patchById = new Map(action.patches.map((patch) => [patch.id, patch]));
  if (!patchById.size) return model;
  return {
    ...model,
    items: model.items.map((item) => {
      const patch = patchById.get(item.id);
      return patch ? { ...item, ...patch } : item;
    }),
  };
}
