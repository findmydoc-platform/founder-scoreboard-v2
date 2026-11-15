// Keep native timers and every explicit Date constructor argument unchanged.
// Only the story's current wall time moves to the declared fixture instant.
export function setAdvancingStoryDate(isoDate: string) {
  const OriginalDate = globalThis.Date;
  const base = OriginalDate.parse(isoDate), began = performance.now();
  if (!Number.isFinite(base)) throw new Error("Story date must be a valid instant");
  const now = () => base + Math.floor(performance.now() - began);
  globalThis.Date = new Proxy(OriginalDate, {
    apply: () => new OriginalDate(now()).toString(),
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    get: (target, property, receiver) => property === "now" ? now : Reflect.get(target, property, receiver),
  });
  return () => { globalThis.Date = OriginalDate; };
}
