import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
// A trigger can restrict a separately authorized delivery job, never authorize one.
export type DeliveryRestriction = () => Promise<() => void>;
const deliveryAdmission = new AsyncLocalStorage<DeliveryRestriction>();
export function runWithDeliveryAdmission<T>(restriction: DeliveryRestriction, operation: () => T): T {
  const outer = deliveryAdmission.getStore();
  return deliveryAdmission.run(async () => {
    const previous = outer ? await outer() : () => { };
    const current = await restriction();
    return () => { previous(); current(); };
  }, operation);
}
export async function reassertDeliveryAdmission() {
  return deliveryAdmission.getStore()?.() ?? (() => { });
}
