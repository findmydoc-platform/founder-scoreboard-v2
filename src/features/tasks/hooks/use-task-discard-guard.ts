"use client";

import { useCallback, useRef, useState } from "react";

type PendingAction = () => void;

export function useTaskDiscardGuard(dirty: boolean) {
  const [open, setOpen] = useState(false);
  const pendingActionRef = useRef<PendingAction | null>(null);

  const request = useCallback((action: PendingAction, force = false) => {
    if (!dirty && !force) {
      action();
      return;
    }

    pendingActionRef.current = action;
    setOpen(true);
  }, [dirty]);

  const keepEditing = useCallback(() => {
    pendingActionRef.current = null;
    setOpen(false);
  }, []);

  const discard = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setOpen(false);
    action?.();
  }, []);

  return {
    discard,
    keepEditing,
    open,
    request,
  };
}
