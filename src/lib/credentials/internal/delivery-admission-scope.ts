import "server-only";
import type { GitHubJobContext } from "../github-job-types";
import { AsyncLocalStorage } from "node:async_hooks";
// A trigger can restrict a separately authorized delivery job, never authorize one.
// Undefined checks trigger transport; null identifies a provider dispatch without a claimed job.
export type DeliveryRestriction = (claim?: GitHubJobContext | null) => Promise<() => void>;
const deliveryAdmission = new AsyncLocalStorage<DeliveryRestriction>();
export function runWithDeliveryAdmission<T>(restriction: DeliveryRestriction, operation: () => T): T {
  const outer = deliveryAdmission.getStore();
  return deliveryAdmission.run(async (claim) => {
    const previous = outer ? await outer(claim) : () => { };
    const current = await restriction(claim);
    return () => { previous(); current(); };
  }, operation);
}
export async function reassertDeliveryAdmission(claim?: GitHubJobContext | null) {
  return deliveryAdmission.getStore()?.(claim) ?? (() => { });
}
