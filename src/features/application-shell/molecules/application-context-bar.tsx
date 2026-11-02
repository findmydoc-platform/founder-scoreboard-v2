import type { ReactNode } from "react";

export function ApplicationContextBar({ children }: { children: ReactNode }) {
  return <div aria-label="Bereichskontext" className="min-w-0 border-t border-slate-100 bg-white px-3 py-3 sm:px-5 min-[1200px]:px-8">
    {children}
  </div>;
}
