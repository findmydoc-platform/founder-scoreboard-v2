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
export interface AdministrationPeopleState {
    administration(): AdministrationStateView;
    loadAdministration(): Promise<boolean>;
    beginAdministrationPersonEdit(person: AdministrationProfile): AdministrationPersonEditor;
    administrationPersonEdits(profileId: string): readonly AdministrationPersonEditView[];
    resumeAdministrationPersonEdit(profileId: string): AdministrationPersonEditor | null;
}
export type AdministrationPersonAdapter = {
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
