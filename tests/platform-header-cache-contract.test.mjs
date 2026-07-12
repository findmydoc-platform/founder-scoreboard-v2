import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared header slots use bounded caches while personalized notifications stay uncached", async () => {
  const headerData = await readFile("src/lib/planning-header-data.ts", "utf8");
  const headerCache = await readFile("src/lib/planning-header-cache.ts", "utf8");
  const planningData = await readFile("src/lib/planning-data.ts", "utf8");
  const headerRoute = await readFile("src/app/api/planning-header-data/route.ts", "utf8");
  const workspacePage = await readFile("src/app/(workspaces)/workspace-page.tsx", "utf8");
  const planningDataRoute = await readFile("src/app/api/planning-data/route.ts", "utf8");

  assert.match(headerCache, /unstable_cache/);
  assert.match(headerCache, /planning-header-quick-links-v1/);
  assert.match(headerCache, /planning-header-calendar-events-v1/);
  assert.match(headerCache, /revalidate: sharedHeaderCacheSeconds/);
  assert.doesNotMatch(headerCache, /planning-header-notifications-v1/);
  assert.doesNotMatch(headerData, /from "next\/cache"/);
  assert.match(planningData, /sharedSlotLoaders: options\.sharedHeaderSlotLoaders/);
  assert.match(headerRoute, /sharedSlotLoaders: sharedPlanningHeaderSlotLoaders/);
  assert.match(workspacePage, /sharedHeaderSlotLoaders: sharedPlanningHeaderSlotLoaders/);
  assert.match(planningDataRoute, /sharedHeaderSlotLoaders: sharedPlanningHeaderSlotLoaders/);
});

test("tool and event mutations invalidate their matching shared header cache", async () => {
  const files = {
    tools: await readFile("src/app/api/tools/route.ts", "utf8"),
    tool: await readFile("src/app/api/tools/[id]/route.ts", "utf8"),
    events: await readFile("src/app/api/events/route.ts", "utf8"),
    event: await readFile("src/app/api/events/[id]/route.ts", "utf8"),
  };

  assert.match(files.tools, /invalidateSharedPlanningHeaderCache\("quickLinks"\)/);
  assert.match(files.tool, /invalidateSharedPlanningHeaderCache\("quickLinks"\)/);
  assert.match(files.events, /invalidateSharedPlanningHeaderCache\("calendarEvents"\)/);
  assert.match(files.event, /invalidateSharedPlanningHeaderCache\("calendarEvents"\)/);
});
