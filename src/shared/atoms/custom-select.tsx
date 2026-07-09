"use client";

import { Check, ChevronDown, CircleDot, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CustomSelectOption = {
  value: string;
  label: string;
  current?: boolean;
  locked?: boolean;
};

type CustomSelectProps = {
  value: string | number;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
  menuClassName?: string;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

export function CustomSelect({
  value,
  options,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  className = "",
  menuClassName = "",
}: CustomSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const stringValue = String(value);
  const selectedOptionIndex = options.findIndex((option) => option.value === stringValue);
  const selectedIndex = selectedOptionIndex >= 0 ? selectedOptionIndex : 0;
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = selectedOptionIndex >= 0 ? options[selectedOptionIndex] : undefined;
  const activeOptionId = options.length > 0 ? `${id}-option-${activeIndex}` : undefined;

  const clampIndex = (index: number) => {
    if (options.length === 0) return 0;
    return Math.max(0, Math.min(options.length - 1, index));
  };

  const openMenu = (index = selectedIndex) => {
    if (disabled) return;
    setActiveIndex(clampIndex(index));
    setOpen(true);
  };

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectOption = (option: CustomSelectOption) => {
    onChange(option.value);
    closeMenu(true);
  };

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus());
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeMenu();
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenu();
          }
          if (event.key === "Home") {
            event.preventDefault();
            openMenu(0);
          }
          if (event.key === "End") {
            event.preventDefault();
            openMenu(options.length - 1);
          }
        }}
        className="flex h-full min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-left font-normal text-slate-800 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-70"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{selectedOption?.label || stringValue || "Nicht verfügbar"}</span>
          {selectedOption?.current && <CircleDot size={13} className="shrink-0 text-emerald-500" aria-label="Aktueller Sprint" />}
          {selectedOption?.locked && <Lock size={13} className="shrink-0 text-slate-400" aria-label="Geschützter Sprint" />}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={id}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={activeOptionId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeMenu(true);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => clampIndex(current + 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => clampIndex(current - 1));
              return;
            }
            if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
              return;
            }
            if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(clampIndex(options.length - 1));
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              const option = options[activeIndex];
              if (option) selectOption(option);
            }
          }}
          style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
          className={`fixed z-[100] max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-900/10 ${menuClassName}`}
        >
          {options.map((option, index) => {
            const selected = option.value === stringValue;
            const active = index === activeIndex;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  selectOption(option);
                }}
                className={`flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition ${
                  selected ? "bg-blue-50 font-semibold text-blue-700" : active ? "bg-slate-50 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.current && <CircleDot size={13} className="shrink-0 text-emerald-500" aria-label="Aktueller Sprint" />}
                  {option.locked && <Lock size={13} className="shrink-0 text-slate-400" aria-label="Geschützter Sprint" />}
                </span>
                {selected && <Check size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
