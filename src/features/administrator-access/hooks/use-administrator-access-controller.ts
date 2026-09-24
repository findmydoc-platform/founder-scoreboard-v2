"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  inactiveAdministratorAccess,
  sessionAuthority,
  type AdministratorAccessSnapshot,
} from "@/features/administrator-access/model/administrator-access";
import { createAdministratorAccessSynchronizer } from "@/features/administrator-access/model/administrator-access-synchronizer";
import { createBrowserApiClient, type BrowserApiClient } from "@/lib/browser-api-client";
import type { PlatformRole } from "@/lib/types";

const channelName = "founderops-administrator-access";
const revalidationIntervalMs = 15_000;

type AccessResponse = {
  administratorAccess?: AdministratorAccessSnapshot;
  error?: string;
  code?: string;
};

function normalizedSnapshot(snapshot: AdministratorAccessSnapshot): AdministratorAccessSnapshot {
  const expiresAt = snapshot.expiresAt;
  const active = snapshot.eligible && Boolean(expiresAt) && new Date(expiresAt || 0).getTime() > Date.now();
  return { eligible: snapshot.eligible, active, expiresAt: active ? expiresAt : null };
}

export function useAdministratorAccessController({
  apiClient: providedApiClient,
  initialAccess = inactiveAdministratorAccess,
  platformRole,
}: {
  apiClient?: BrowserApiClient;
  initialAccess?: AdministratorAccessSnapshot;
  platformRole?: PlatformRole | null;
}) {
  const fallbackApiClient = useMemo(() => createBrowserApiClient(), []);
  const apiClient = providedApiClient || fallbackApiClient;
  const pathname = usePathname();
  const router = useRouter();
  const [administratorAccess, setAdministratorAccess] = useState(() => normalizedSnapshot(initialAccess));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const synchronizerRef = useRef(createAdministratorAccessSynchronizer());
  const authority = useMemo(() => sessionAuthority({
    platformRole: platformRole || "viewer",
    credentialKind: "session",
    administratorAccess,
  }), [administratorAccess, platformRole]);

  const leaveAdministration = useCallback(() => {
    if (pathname === "/administration") router.replace("/planning");
  }, [pathname, router]);

  const applySnapshot = useCallback((snapshot: AdministratorAccessSnapshot, broadcast = false) => {
    const next = normalizedSnapshot(snapshot);
    setAdministratorAccess(next);
    if (!next.active && platformRole !== "ceo") leaveAdministration();
    if (broadcast) channelRef.current?.postMessage(next);
    return next;
  }, [leaveAdministration, platformRole]);

  const applyAuthoritativeSnapshot = useCallback((snapshot: AdministratorAccessSnapshot, broadcast = false) => {
    synchronizerRef.current.recordAuthoritativeChange();
    return applySnapshot(snapshot, broadcast);
  }, [applySnapshot]);

  const revalidate = useCallback(async () => {
    const readToken = synchronizerRef.current.beginRead();
    const { response, body } = await apiClient.requestJson<AccessResponse>("/api/administrator-access", {
      useDevProfileOverride: false,
    });
    if (!response.ok || !body?.administratorAccess) return null;
    if (!synchronizerRef.current.acceptsRead(readToken)) return null;
    return applySnapshot(body.administratorAccess);
  }, [apiClient, applySnapshot]);

  const activate = useCallback(async () => {
    synchronizerRef.current.recordAuthoritativeChange();
    setBusy(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<AccessResponse>("/api/administrator-access", {
        method: "POST",
        useDevProfileOverride: false,
      });
      if (!response.ok || !body?.administratorAccess) throw new Error(body?.error || "Adminzugang konnte nicht aktiviert werden.");
      applyAuthoritativeSnapshot(body.administratorAccess, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Adminzugang konnte nicht aktiviert werden.");
    } finally {
      setBusy(false);
    }
  }, [apiClient, applyAuthoritativeSnapshot]);

  const end = useCallback(async () => {
    synchronizerRef.current.recordAuthoritativeChange();
    setBusy(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<AccessResponse>("/api/administrator-access", {
        method: "DELETE",
        useDevProfileOverride: false,
      });
      if (!response.ok || !body?.administratorAccess) throw new Error(body?.error || "Adminzugang konnte nicht beendet werden.");
      applyAuthoritativeSnapshot(body.administratorAccess, true);
      if (pathname === "/administration" && platformRole !== "ceo") router.replace("/planning");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Adminzugang konnte nicht beendet werden.");
    } finally {
      setBusy(false);
    }
  }, [apiClient, applyAuthoritativeSnapshot, pathname, platformRole, router]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (!event.data || typeof event.data !== "object") return;
      synchronizerRef.current.recordAuthoritativeChange();
      void revalidate();
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [revalidate]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
      if (administratorAccess.active && administratorAccess.expiresAt && new Date(administratorAccess.expiresAt).getTime() <= Date.now()) {
        applyAuthoritativeSnapshot({ ...administratorAccess, active: false, expiresAt: null });
      }
    }, 1_000);
    return () => window.clearInterval(tick);
  }, [administratorAccess, applyAuthoritativeSnapshot]);

  useEffect(() => {
    const verify = () => void revalidate();
    const onVisibility = () => {
      if (document.visibilityState === "visible") verify();
    };
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", onVisibility);
    verify();
    const interval = window.setInterval(verify, revalidationIntervalMs);
    return () => {
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [revalidate]);

  const remainingSeconds = administratorAccess.active && administratorAccess.expiresAt
    ? Math.max(0, Math.ceil((new Date(administratorAccess.expiresAt).getTime() - now) / 1_000))
    : 0;

  return {
    administratorAccess,
    authority,
    busy,
    message,
    remainingSeconds,
    activate,
    end,
    revalidate,
    setMessage,
  };
}

export type AdministratorAccessController = ReturnType<typeof useAdministratorAccessController>;
