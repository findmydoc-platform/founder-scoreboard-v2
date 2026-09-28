import Link from "next/link";
import { AppBrand } from "@/shared/atoms/app-brand";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { assertGoogleSession, requireWorkspaceAccess, workspaceAccessContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
export default async function LinkGooglePage() {
  const client = await getServerAuthSupabase();
  const user = client ? (await client.auth.getUser()).data.user : null;
  const context = await workspaceAccessContext(user ? { userId: user.id } : {}).catch(() => null);
  const available = context?.mode === "linking" && process.env.VERCEL_ENV !== "preview";
  const session = user && context?.linked && context.linkingEnforced ? (await client?.auth.getSession())?.data.session : null;
  const approved = session && user ? await Promise.all([
    requireWorkspaceAccess({ userId: user.id }), assertGoogleSession(session.access_token, user.id),
  ]).then(() => true).catch(() => false) : false;
  return <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 py-8 text-slate-900">
    <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-xl">
      <AppBrand />
      <h1 className="mt-8 text-2xl font-semibold">Google-Konto verknüpfen</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Verbinde dein bestehendes FounderOps-Profil mit deinem Google-Workspace-Konto. Aufgaben, Rollen und deine GitHub- und Kalenderverbindungen bleiben erhalten.</p>
      <div className="mt-7 grid gap-4">
        {!available ? <p>Die Kontoverknüpfung ist derzeit nicht geöffnet.</p> : !user ?
          <a className="flex min-h-11 items-center justify-center rounded bg-blue-700 p-3 text-center font-semibold text-white" href="/auth/login?provider=github&next=/auth/link-google">Mit bestehendem Konto anmelden</a> :
          !context?.profileId ? <p>Diesem Konto ist kein Teamprofil zugeordnet. Bitte wende dich an die Administration.</p> : context.linked ? <>
            <p className="text-sm text-emerald-700">Dein Google-Konto ist verknüpft.</p>
            <a className="flex min-h-11 items-center justify-center rounded bg-blue-700 p-3 text-center font-semibold text-white" href={approved ? "/" : "/auth/login?provider=google"}>{approved ? "Zur Anwendung" : "Neu mit Google anmelden"}</a>
          </> :
            <form action="/auth/google-link/start" method="post"><button className="min-h-11 w-full rounded bg-blue-700 p-3 font-semibold text-white" type="submit">Mit Google verknüpfen</button></form>}
        {user && <form action="/auth/signout" method="post"><button className="min-h-11 w-full rounded border border-slate-300 p-3 font-semibold" type="submit">Abmelden</button></form>}
        {!context?.linkingEnforced && <Link className="min-h-11 underline" href="/">Zurück zur Anwendung</Link>}
      </div>
    </section>
  </main>;
}
