"use client";

import { useEffect, useRef, useState } from "react";
import { isGitHubAssetUrl } from "@/features/tasks/model/github-comment-image";
import { loadGitHubAssetBlob } from "@/features/tasks/model/task-api-client";
import { createBrowserApiClient } from "@/lib/browser-api-client";

export function useGitHubCommentImage(href: string) {
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

  return { failed, loadViaProxy, loading, src };
}
