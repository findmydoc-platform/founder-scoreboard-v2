"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

const phoneQuery = "(max-width: 639px)";
const subscribeToPhone = (notify: () => void) => {
  const query = window.matchMedia(phoneQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

export function usePhoneHeader() {
  return useSyncExternalStore(subscribeToPhone, () => window.matchMedia(phoneQuery).matches, () => false);
}

type GlobalActions = { links: ReactNode; calendar: ReactNode; notifications: ReactNode; help: ReactNode; github: ReactNode; account: ReactNode };

export function ApplicationHeaderOverflow({ phone, triggerRef, actions }: { phone: boolean; triggerRef: RefObject<HTMLButtonElement | null>; actions: GlobalActions }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialItemRef = useRef<"first" | "last">("first");
  const id = useId();
  const visible = phone && open;

  useEffect(() => {
    const revealTourTarget = (event: Event) => {
      const selector = (event as CustomEvent<{ selector?: string }>).detail?.selector;
      if (!phone || !selector) return;
      setOpen(Boolean(menuRef.current?.querySelector(selector)));
    };
    const closeForHelp = () => { setOpen(false); if (phone) requestAnimationFrame(() => triggerRef.current?.focus()); };
    window.addEventListener("fmd:reveal-header-action", revealTourTarget);
    window.addEventListener("fmd:open-help-menu", closeForHelp);
    window.addEventListener("fmd:close-header-actions", closeForHelp);
    return () => {
      window.removeEventListener("fmd:reveal-header-action", revealTourTarget);
      window.removeEventListener("fmd:open-help-menu", closeForHelp);
      window.removeEventListener("fmd:close-header-actions", closeForHelp);
    };
  }, [phone, triggerRef]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
      items?.[initialItemRef.current === "last" ? items.length - 1 : 0]?.focus();
    });
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [triggerRef, visible]);

  if (!phone) return <>{actions.links}{actions.calendar}{actions.notifications}{actions.help}{actions.github}{actions.account}</>;

  return <>
    {actions.notifications}
    {actions.account}
    <div
      ref={menuRef}
      id={id}
      role={phone ? "menu" : undefined}
      aria-label={phone ? "Weitere globale Aktionen" : undefined}
      className={`${visible ? "flex" : "hidden"} absolute right-0 top-14 z-50 w-60 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-xl`}
      onClickCapture={event => {
        if (!phone || !(event.target instanceof Element) || !event.target.closest("[role='menuitem']")) return;
        triggerRef.current?.focus();
        setOpen(false);
      }}
      onKeyDown={event => {
        if (!visible) return;
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") || []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >{actions.links}{actions.calendar}{actions.help}{actions.github}</div>
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={visible}
      aria-controls={id}
      onClick={() => { initialItemRef.current = "first"; setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          initialItemRef.current = event.key === "ArrowUp" ? "last" : "first";
          setOpen(true);
        }
      }}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
    >Mehr</button>
  </>;
}
