"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isTopModal, registerModal, unregisterModal } from "@/shared/model/modal-stack";

const focusableSelector = [
  "a[href]",
  "button:not([disabled]):not([tabindex='-1'])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useModalDialog<T extends HTMLElement = HTMLElement>({
  open,
  onClose,
  closeDisabled = false,
  manageEnvironment = true,
  restoreFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  manageEnvironment?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
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

    returnFocusRef.current = restoreFocusRef?.current
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = dialogRef.current;
    if (dialog && manageEnvironment) registerModal(dialog);

    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) || [])
      .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    window.requestAnimationFrame(() => {
      const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus]");
      (preferred || focusable()[0] || dialog)?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (manageEnvironment && !isTopModal(dialog)) return;
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
      const { nextTopModal, wasTopModal } = dialog && manageEnvironment
        ? unregisterModal(dialog)
        : { nextTopModal: null, wasTopModal: true };
      if (!wasTopModal) return;
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected && !returnTarget.closest("[inert]")) {
          returnTarget.focus({ preventScroll: true });
          return;
        }
        if (!nextTopModal?.isConnected || nextTopModal.inert) return;
        const previousPreferred = nextTopModal.querySelector<HTMLElement>("[data-autofocus]");
        const previousFocusable = nextTopModal.querySelector<HTMLElement>(focusableSelector);
        (previousPreferred || previousFocusable || nextTopModal).focus({ preventScroll: true });
      });
    };
  }, [manageEnvironment, open, restoreFocusRef]);

  return dialogRef;
}
