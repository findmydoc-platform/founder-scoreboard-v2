import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
export type AdministrationDeliverySelection = {
    kind: "events";
    eventIds: readonly number[];
} | {
    kind: "pending";
    limit: number;
} | {
    kind: "webhook-test";
} | {
    kind: "direct-message-test";
    profileId: string;
};
export type AdministrationDeliveryItem = {
    eventId: number;
    status: "sent" | "failed" | "skipped";
    error?: string;
};
export type AdministrationDeliveryPhase = "saving" | "reported" | "partial" | "rejected" | "unconfirmed" | "ended";
export type AdministrationDeliveryView = {
    id: string;
    selection: AdministrationDeliverySelection | null;
    phase: AdministrationDeliveryPhase;
    sent: number | null;
    failed: number | null;
    skipped: number | null;
    results: readonly AdministrationDeliveryItem[];
    error: string;
    readStatus: PlanningReadStatus;
    checking: boolean;
};
export type AdministrationDeliveryResponse = {
    ok: boolean;
    status: number;
    sent?: number;
    failed?: number;
    skipped?: number;
    results?: readonly AdministrationDeliveryItem[];
    error?: string;
    code?: string;
};
export interface AdministrationDeliveriesState {
    runAdministrationDelivery(selection: AdministrationDeliverySelection): Promise<AdministrationDeliveryView>;
    administrationDeliveries(): readonly AdministrationDeliveryView[];
    checkAdministrationDelivery(id: string): Promise<boolean>;
    administrationDeliveryAvailability(selection: AdministrationDeliverySelection): "available" | "pending" | "forbidden";
}
export type AdministrationDeliveryAdapter = {
    executeAdministrationDelivery?: (selection: AdministrationDeliverySelection) => Promise<AdministrationDeliveryResponse>;
};
