"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type AnchoredPopoverPlacement = "top" | "bottom";
export type AnchoredPopoverPreference = "auto" | AnchoredPopoverPlacement;

export type AnchoredPopoverPosition = {
  top: number;
  left: number;
  triggerWidth: number;
  placement: AnchoredPopoverPlacement;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function useAnchoredPopover({
  open,
  onClose,
  gap = 6,
  ignoreOutsideSelector,
  placement = "auto",
  viewportPadding = 12,
}: {
  open: boolean;
  onClose: () => void;
  gap?: number;
  ignoreOutsideSelector?: string;
  placement?: AnchoredPopoverPreference;
  viewportPadding?: number;
}): {
  rootRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  position: AnchoredPopoverPosition | null;
} {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<AnchoredPopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect() || rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const popoverRect = popoverRef.current?.getBoundingClientRect();
    const padding = Math.max(0, viewportPadding);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = popoverRect?.width || rect.width;
    const popoverHeight = popoverRect?.height || 0;
    const maxLeft = Math.max(padding, viewportWidth - popoverWidth - padding);
    const left = clamp(rect.left, padding, maxLeft);
    const belowTop = rect.bottom + gap;
    const aboveTop = rect.top - popoverHeight - gap;
    const canFitAbove = aboveTop >= padding;
    const resolvedPlacement: AnchoredPopoverPlacement = placement === "top" || (
      placement === "auto" && popoverHeight > 0 && belowTop + popoverHeight > viewportHeight - padding && canFitAbove
    ) ? "top" : "bottom";
    const preferredTop = resolvedPlacement === "top" ? aboveTop : belowTop;
    const maxTop = Math.max(padding, viewportHeight - popoverHeight - padding);
    const top = popoverHeight > 0 ? clamp(preferredTop, padding, maxTop) : Math.max(padding, preferredTop);
    const nextPosition = { top, left, triggerWidth: rect.width, placement: resolvedPlacement };

    setPosition((current) => (
      current
      && current.top === nextPosition.top
      && current.left === nextPosition.left
      && current.triggerWidth === nextPosition.triggerWidth
      && current.placement === nextPosition.placement
        ? current
        : nextPosition
    ));
  }, [gap, placement, viewportPadding]);

  useEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || !position) return;

    const frame = requestAnimationFrame(updatePosition);
    const popover = popoverRef.current;
    if (!popover || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(frame);

    const observer = new ResizeObserver(updatePosition);
    observer.observe(popover);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, position, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ignoreOutsideSelector && target instanceof Element && target.closest(ignoreOutsideSelector)) return;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) onClose();
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [ignoreOutsideSelector, onClose, open]);

  return { rootRef, triggerRef, popoverRef, position };
}
