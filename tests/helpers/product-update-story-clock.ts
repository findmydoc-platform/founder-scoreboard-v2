export function useActiveProductUpdateClock() {
  const originalDate = globalThis.Date;
  const startedAt = performance.now();
  const fixtureTime = originalDate.parse("2026-10-20T12:00:00Z");
  const now = () => fixtureTime + performance.now() - startedAt;

  globalThis.Date = new Proxy(originalDate, {
    apply: () => new originalDate(now()).toString(),
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    get: (target, property, receiver) => property === "now" ? now : Reflect.get(target, property, receiver),
  });

  return () => { globalThis.Date = originalDate; };
}
