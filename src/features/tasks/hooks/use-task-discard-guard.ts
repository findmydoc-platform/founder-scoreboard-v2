"use client";

import { useCallback, useRef, useState } from "react";

type PendingAction = () => void | Promise<void>;

export function useTaskDiscardGuard(dirty: boolean) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingActionRef = useRef<PendingAction | null>(null);

  const request = useCallback((action: PendingAction, force = false) => {
    if (busyRef.current) return;
    if (!dirty && !force) {
      action();
      return;
    }

    pendingActionRef.current = action;
    setOpen(true);
  }, [dirty]);

  const keepEditing = useCallback(() => {
    if (busyRef.current) return;
    pendingActionRef.current = null;
    setOpen(false);
  }, []);

  const discard = useCallback(async () => {
    if (busyRef.current) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    busyRef.current = true;
    setBusy(true);
    try {
      await action?.();
    } finally {
      busyRef.current = false;
      setBusy(false);
      setOpen(false);
    }
  }, []);

  return {
    busy,
    discard,
    keepEditing,
    open,
    request,
  };
}
