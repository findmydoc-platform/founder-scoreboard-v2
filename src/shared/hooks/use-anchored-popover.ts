"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type AnchoredPopoverPosition = {
  top: number;
  left: number;
  triggerWidth: number;
};

export function useAnchoredPopover({
  open,
  onClose,
  gap = 6,
  ignoreOutsideSelector,
}: {
  open: boolean;
  onClose: () => void;
  gap?: number;
  ignoreOutsideSelector?: string;
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

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect() || rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + gap, left: rect.left, triggerWidth: rect.width });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [gap, open]);

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
