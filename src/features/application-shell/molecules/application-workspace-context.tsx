"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type WorkspaceContext = {
  available: boolean;
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  register: () => () => void;
};

const Context = createContext<WorkspaceContext | null>(null);

export function ApplicationWorkspaceContext({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);
  const register = useCallback(() => {
    setCount(value => value + 1);
    return () => setCount(value => value - 1);
  }, []);
  const value = useMemo(() => ({ available: count > 0, target, setTarget, register }), [count, target, register]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApplicationWorkspaceContextAvailable() {
  return useContext(Context)?.available || false;
}

export function ApplicationWorkspaceContextOutlet() {
  const { available, setTarget } = useContext(Context) || {};
  return available ? <div ref={setTarget} className="flex min-w-0 max-w-full flex-wrap items-end gap-3" /> : null;
}

export function ApplicationWorkspaceControls({ children }: { children: ReactNode }) {
  const context = useContext(Context);
  const register = context?.register;
  useLayoutEffect(() => register?.(), [register]);
  if (!context) return children;
  return context.target ? createPortal(children, context.target) : null;
}
