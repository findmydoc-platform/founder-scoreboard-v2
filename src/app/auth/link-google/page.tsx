import Link from "next/link";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { workspaceAccessContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
export default async function LinkGooglePage() {
  const client = await getServerAuthSupabase();
  const user = client ? (await client.auth.getUser()).data.user : null;
  const context = await workspaceAccessContext(user ? { userId: user.id } : {}).catch(() => null);
  const available = context?.mode === "linking" && process.env.VERCEL_ENV !== "preview";
  return <main className="mx-auto grid max-w-lg gap-5 p-6 text-slate-900">
    <h1 className="text-2xl font-semibold">Google-Konto verknüpfen</h1>
    <p>Verbinde dein bestehendes FounderOps-Profil mit deinem Google-Workspace-Konto. Aufgaben, Rollen und deine GitHub- und Kalenderverbindungen bleiben erhalten.</p>
    {!available ? <p>Die Kontoverknüpfung ist derzeit nicht geöffnet.</p> : !user ?
      <a className="rounded bg-blue-700 p-3 text-center text-white" href="/auth/login?provider=github&next=/auth/link-google">Mit bestehendem GitHub-Konto anmelden</a> :
      !context?.profileId ? <p>Diesem Konto ist kein Teamprofil zugeordnet.</p> : context.linked ? <p>Dein Google-Konto ist verknüpft.</p> :
      <form action="/auth/google-link/start" method="post"><button className="min-h-11 w-full rounded bg-blue-700 p-3 text-white" type="submit">Google-Workspace-Konto verknüpfen</button></form>}
    <Link className="min-h-11 underline" href="/">Zurück zur Anwendung</Link>
  </main>;
}
