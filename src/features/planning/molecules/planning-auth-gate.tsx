import Image from "next/image";

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
    authUser,
    signIn,
    signOut,
  } = controller;

  const isLoadingState = state === "loading";

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-950">
      <section className="grid min-h-screen lg:grid-cols-[minmax(390px,34.5vw)_minmax(0,1fr)]">
        <div className="flex min-h-screen bg-white px-6 py-12 sm:px-10 lg:border-r lg:border-slate-300 lg:px-12">
          <div className="m-auto w-full max-w-[324px] lg:-translate-y-2 lg:translate-x-2">
            <AppBrand size="login" />

            <div className="mt-20 min-w-0">
              <div className="text-base font-medium text-[#28c99a]">
                Founder Planning
              </div>
              <h1 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-[#070119]">
                {isLoadingState
                  ? authError
                    ? "Laden fehlgeschlagen"
                    : "Planung wird geladen"
                  : "Willkommen zurück"}
              </h1>
            </div>

            <div className="mt-12 border-t border-slate-300 pt-12">
              {authError && (
                <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {authError}
                </p>
              )}
              {authChecked ? (
                <AuthControl
                  user={authUser}
                  busy={authBusy}
                  onSignIn={signIn}
                  onSignOut={signOut}
                  variant="gate"
                />
              ) : (
                <div className="grid h-14 place-items-center rounded-[5px] border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-600">
                  Anmeldung wird geprüft...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative hidden min-h-screen overflow-hidden bg-[#f8fafc] lg:block" aria-hidden="true">
          <Image
            src="/assets/planning-login-network.svg"
            alt=""
            fill
            priority
            unoptimized
            sizes="65.5vw"
            className="object-cover object-center"
          />
        </div>
      </section>
    </main>
  );
}
