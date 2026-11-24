import "server-only";

import { Suspense } from "react";
import { PlanningServerHeaderReceipt } from "../organisms/planning-server-header-receipt";
import type { PlanningServerHeaderRead, PlanningServerHeaderResult, PlanningServerHeaderSlot } from "../model/planning-server-header-read";

async function HeaderSlot({ read, slot, result }: { read: PlanningServerHeaderRead; slot: PlanningServerHeaderSlot; result: Promise<PlanningServerHeaderResult> }) {
  return <PlanningServerHeaderReceipt read={read} slot={slot} result={await result} />;
}

export function PlanningServerHeaderSlots({ read, results }: { read: PlanningServerHeaderRead; results: Record<PlanningServerHeaderSlot, Promise<PlanningServerHeaderResult>> }) {
  return <>{(["quickLinks", "calendarEvents"] as const).map(slot => <Suspense key={slot} fallback={null}><HeaderSlot read={read} slot={slot} result={results[slot]} /></Suspense>)}</>;
}
