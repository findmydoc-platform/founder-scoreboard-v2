import type { AdministrationDeliveriesState } from "./administration-delivery-state";
import type { AdministrationProfile, AdministrationReadCoverage, AdministrationWorkspaceModel, PersonAdministrationPatch, TechnicalIdentityBasis } from "./administration-read-model";
import type { AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
export type AdministrationPersonStep = {
    phase: "not-needed" | "saving" | "confirmed" | "rejected" | "unconfirmed";
    error: string;
};
export type AdministrationPersonEditView = {
    profileId: string;
    phase: "editing" | "saving" | "saved" | "partial" | "unconfirmed" | "rejected" | "conflict" | "blocked" | "ended";
    submitted: PersonAdministrationPatch | null;
    technical: AdministrationPersonStep;
    eligibility: AdministrationPersonStep;
    error: string;
    readStatus: PlanningReadStatus;
    serverPerson: AdministrationProfile | null;
    canResave: boolean;
};
export type AdministrationPersonResult = {
    ok: boolean;
    kind?: "partial" | "unconfirmed" | "rejected" | "versionConflict" | "sessionSuperseded";
    error?: string;
};
export interface AdministrationPersonEditor {
    view(): AdministrationPersonEditView;
    save(patch: PersonAdministrationPatch): Promise<AdministrationPersonResult>;
    checkOutcome(): Promise<boolean>;
    refreshConflict(): Promise<boolean>;
    resave(patch: PersonAdministrationPatch): Promise<AdministrationPersonResult>;
    close(): void;
}
export type AdministrationStateView = {
    model: AdministrationWorkspaceModel | null;
    readStatus: PlanningReadStatus;
    coverage: AdministrationReadCoverage;
};
export interface AdministrationPeopleState extends AdministrationDeliveriesState {
    beginAdministrationProjectEdit(project: AdministrationProjectSettings): AdministrationProjectEditor;
    administrationProjectEdits(): readonly AdministrationProjectEditView[];
    resumeAdministrationProjectEdit(): AdministrationProjectEditor | null;
    administration(): AdministrationStateView;
    loadAdministration(): Promise<boolean>;
    beginAdministrationPersonEdit(person: AdministrationProfile): AdministrationPersonEditor;
    administrationPersonEdits(profileId: string): readonly AdministrationPersonEditView[];
    resumeAdministrationPersonEdit(profileId: string): AdministrationPersonEditor | null;
}
export type AdministrationPersonAdapter = import("./administration-delivery-state").AdministrationDeliveryAdapter & {
    saveAdministrationProject?: (project: AdministrationProjectSettings, expected: AdministrationProjectSettings) => Promise<{
        project: AdministrationProjectSettings;
    }>;
    readAdministration?: () => Promise<AdministrationWorkspaceModel>;
    saveAdministrationTechnical?: (profileId: string, patch: PersonAdministrationPatch["technicalIdentity"], expected: TechnicalIdentityBasis) => Promise<{
        profile?: {
            id: string;
        } & TechnicalIdentityBasis;
    }>;
    saveAdministrationEligibility?: (profileId: string, eligible: boolean, expectedEligible: boolean) => Promise<AdministratorAccessSnapshot & {
        profileId: string;
    }>;
};
export type AdministrationProjectSettings = NonNullable<AdministrationWorkspaceModel["githubProject"]>;
export type AdministrationProjectEditView = {
    phase: "editing" | "saving" | "saved" | "rejected" | "unconfirmed" | "conflict" | "blocked" | "ended";
    submitted: AdministrationProjectSettings | null;
    serverProject: AdministrationProjectSettings | null;
    error: string;
    readStatus: PlanningReadStatus;
    canResave: boolean;
};
export type AdministrationProjectResult = { ok: boolean; kind?: "unconfirmed" | "rejected" | "versionConflict" | "sessionSuperseded"; error?: string };
export interface AdministrationProjectEditor {
    view(): AdministrationProjectEditView;
    save(project: AdministrationProjectSettings): Promise<AdministrationProjectResult>;
    checkOutcome(): Promise<boolean>;
    refreshConflict(): Promise<boolean>;
    resave(project: AdministrationProjectSettings): Promise<AdministrationProjectResult>;
    close(): void;
}
