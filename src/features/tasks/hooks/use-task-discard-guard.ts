"use client";

import { useCallback, useRef, useState } from "react";

type PendingAction = () => void | Promise<void>;

export function useTaskDiscardGuard(dirty: boolean) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingActionRef = useRef<PendingAction | null>(null);

  const continueAction = useCallback((action: PendingAction) => {
    let completion: void | Promise<void>;
    try {
      completion = action();
    } catch (error) {
      setOpen(false);
      throw error;
    }
    if (!completion) {
      setOpen(false);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setOpen(true);
    return completion.finally(() => {
      busyRef.current = false;
      setBusy(false);
      setOpen(false);
    });
  }, []);

  const request = useCallback((action: PendingAction, force = false) => {
    if (busyRef.current) return;
    if (!dirty && !force) {
      void continueAction(action);
      return;
    }

    pendingActionRef.current = action;
    setOpen(true);
  }, [continueAction, dirty]);

  const keepEditing = useCallback(() => {
    if (busyRef.current) return;
    pendingActionRef.current = null;
    setOpen(false);
  }, []);

  const discard = useCallback(() => {
    if (busyRef.current) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) void continueAction(action);
    else setOpen(false);
  }, [continueAction]);

  return {
    busy,
    discard,
    keepEditing,
    open,
    request,
  };
}
