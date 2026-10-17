"use client";

import { useEffect, useState } from "react";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import { AppBrand } from "@/shared/atoms/app-brand";

export function SessionLoginStart() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    createBrowserSessionAdapter().startLogin(window.location.search).then(success => { if (active && !success) setFailed(true); });
    return () => { active = false; };
  }, []);
  return <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
    <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-xl">
      <AppBrand />
      <h1 className="mt-5 text-xl font-semibold">Anmeldung vorbereiten</h1>
      <p className="mt-2 text-sm leading-6" role="status">{failed ? "Die Anmeldung konnte nicht sicher vorbereitet werden. Bitte versuche es erneut." : "Deine sichere Anmeldung wird vorbereitet."}</p>
      {failed && <button className="mt-5 min-h-11 rounded bg-blue-700 px-4 text-white" onClick={() => window.location.reload()}>Erneut versuchen</button>}
    </section>
  </main>;
}
