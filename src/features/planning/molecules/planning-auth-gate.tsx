import { AppBrand } from "@/shared/atoms/app-brand";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { AuthControl } from "@/features/settings/organisms/auth-control";

type PlanningAuthGateProps = {
  controller: PlanningAppController;
  state: "sign-in" | "loading";
};

export function PlanningAuthGate({ controller, state }: PlanningAuthGateProps) {
  const {
    authBusy,
    authChecked,
    authError,
    authNotice,
    authUser,
    githubProviderTokenAvailable,
    signIn,
    signOut,
  } = controller;

  const isLoadingState = state === "loading";

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-xl">
        <div className="grid gap-5">
          <AppBrand />
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {isLoadingState ? "Session aktiv" : "Geschützter Teamzugriff"}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">
              {isLoadingState
                ? authError
                  ? "Planungsdaten konnten nicht geladen werden"
                  : "Planungsdaten werden geladen"
                : "findmydoc Founder Execution"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {isLoadingState
                ? authError
                  ? "Die Session ist aktiv, aber die geschützte Daten-API hat nicht erfolgreich geantwortet."
                  : "Die Session ist gültig. Die Daten werden jetzt über die geschützte API geladen."
                : "Bitte melde dich mit GitHub an. Ohne gültige Supabase-Session werden keine Planungsdaten geladen."}
            </p>
          </div>
        </div>
        {authNotice && <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{authNotice}</p>}
        {authError && <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</p>}
        <div className="mt-6">
          {authChecked ? (
            <AuthControl
              user={authUser}
              error={authError}
              busy={authBusy}
              githubProviderTokenAvailable={githubProviderTokenAvailable}
              onSignIn={signIn}
              onSignOut={signOut}
              variant="gate"
            />
          ) : (
            <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">Session wird geprüft...</div>
          )}
        </div>
      </section>
    </main>
  );
}
