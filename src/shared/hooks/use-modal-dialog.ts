"use client";

import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const modalStack: HTMLElement[] = [];

function isTopModal(dialog: HTMLElement | null) {
  return Boolean(dialog) && modalStack.at(-1) === dialog;
}

export function useModalDialog<T extends HTMLElement = HTMLElement>({
  open,
  onClose,
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
}): RefObject<T | null> {
  const dialogRef = useRef<T | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousRootOverflow = document.documentElement.style.overflow;
    const inertSiblings: Array<{ element: HTMLElement; inert: boolean }> = [];
    const previousTopModal = modalStack.at(-1);
    const previousTopModalInert = previousTopModal?.inert ?? false;
    let branch: HTMLElement | null = dialog;

    if (dialog) modalStack.push(dialog);
    if (previousTopModal && dialog && !previousTopModal.contains(dialog)) previousTopModal.inert = true;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    while (branch?.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        inertSiblings.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
      if (parent === document.body) break;
      branch = parent;
    }

    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) || [])
      .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    window.requestAnimationFrame(() => {
      const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus]");
      (preferred || focusable()[0] || dialog)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(dialog)) return;
      if (event.key === "Escape" && !closeDisabledRef.current) {
        if (dialog?.querySelector("[aria-expanded='true']")) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (dialog) {
        const stackIndex = modalStack.lastIndexOf(dialog);
        if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      }
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const { element, inert } of inertSiblings) element.inert = inert;
      if (previousTopModal?.isConnected) previousTopModal.inert = previousTopModalInert;
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected && !returnTarget.closest("[inert]")) {
          returnTarget.focus();
          return;
        }
        if (!previousTopModal?.isConnected || previousTopModal.inert) return;
        const previousPreferred = previousTopModal.querySelector<HTMLElement>("[data-autofocus]");
        const previousFocusable = previousTopModal.querySelector<HTMLElement>(focusableSelector);
        (previousPreferred || previousFocusable || previousTopModal).focus();
      });
    };
  }, [open]);

  return dialogRef;
}
