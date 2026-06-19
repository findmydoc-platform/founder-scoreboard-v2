"use client";

import { useEffect, useRef, useState } from "react";
import { loadGitHubAssetBlob } from "@/features/tasks/model/task-api-client";
import { createBrowserApiClient } from "@/lib/browser-api-client";

function isGitHubAssetUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "github.com"
      || hostname.endsWith("githubusercontent.com")
      || hostname === "objects.githubusercontent.com"
      || hostname.startsWith("github-production-user-asset-")
      || hostname.endsWith(".s3.amazonaws.com");
  } catch {
    return false;
  }
}

export function GitHubCommentImage({ href, alt }: { href: string; alt: string }) {
  const isGitHubAsset = isGitHubAssetUrl(href);
  const [src, setSrc] = useState(href);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proxyAttempted, setProxyAttempted] = useState(false);
  const objectUrlRef = useRef("");

  async function loadViaProxy() {
    if (!isGitHubAsset || proxyAttempted) {
      setFailed(true);
      return;
    }

    setLoading(true);
    setProxyAttempted(true);

    try {
      const { response, blob } = await loadGitHubAssetBlob(createBrowserApiClient(), href);
      if (!response.ok) throw new Error(`GitHub asset failed: ${response.status}`);
      if (!blob) throw new Error("GitHub asset failed: empty response");
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(blob);
      setSrc(objectUrlRef.current);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };
  }, []);

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
