"use client";

import { useGitHubCommentImage } from "@/features/tasks/hooks/use-github-comment-image";

export function GitHubCommentImage({ href, alt }: { href: string; alt: string }) {
  const { failed, loadViaProxy, loading, src } = useGitHubCommentImage(href);

  return (
    <a href={href} target="_blank" rel="noreferrer" className="mt-2 block max-w-full">
      {loading ? (
        <span className="grid min-h-24 max-w-full place-items-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
          GitHub-Anhang wird geladen ...
        </span>
      ) : failed ? (
        <span className="grid min-h-16 max-w-full place-items-center rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700">
          Vorschau konnte nicht geladen werden. Der Anhang lässt sich in GitHub öffnen.
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            void loadViaProxy();
          }}
          className="max-h-[420px] max-w-full rounded-md border border-slate-200 bg-white object-contain"
        />
      )}
      <span className="mt-1 inline-flex text-xs font-semibold text-blue-600 hover:text-blue-700">Anhang in GitHub öffnen</span>
    </a>
  );
}
