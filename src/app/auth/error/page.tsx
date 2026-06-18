import Link from "next/link";
import { AppBrand } from "@/components/app-brand";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

function safeRelativeNext(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function AuthErrorPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const returnPath = safeRelativeNext(next);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-xl">
        <div className="grid gap-5">
          <AppBrand />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anmeldung fehlgeschlagen</div>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">GitHub-Anmeldung konnte nicht abgeschlossen werden</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Bitte starte die Anmeldung erneut. Die App lädt erst Planungsdaten, wenn die Supabase-Session sicher geprüft wurde.
            </p>
          </div>
        </div>
        <Link
          href={returnPath}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Zurück zur App
        </Link>
      </section>
    </main>
  );
}
