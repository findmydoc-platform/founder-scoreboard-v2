"use client";

import { Check, ChevronDown, CircleDot, Lock } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "@/shared/hooks/use-anchored-popover";

export type CustomSelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  current?: boolean;
  locked?: boolean;
};

type CustomSelectProps = {
  value: string | number;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  onOpen?: () => void;
  onOpenChange?: (open: boolean) => void;
  selectedOptionLabel?: string;
  search?: { label: string; value: string; onChange: (value: string) => void; onSubmit: () => void };
  feedback?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "data-autofocus"?: boolean;
  className?: string;
  menuClassName?: string;
};

export function CustomSelect({
  value,
  options,
  onChange,
  onOpen,
  onOpenChange,
  selectedOptionLabel,
  search,
  feedback,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-required": ariaRequired,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "data-autofocus": dataAutofocus,
  className = "",
  menuClassName = "",
}: CustomSelectProps) {
  const id = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const searchable = Boolean(search);
  const closeOnOutside = useCallback(() => { setOpen(false); onOpenChange?.(false); }, [onOpenChange]);
  const { rootRef, triggerRef, popoverRef: menuRef, position: menuPosition } = useAnchoredPopover({
    open,
    onClose: closeOnOutside,
  });
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
    if (!open) { onOpen?.(); onOpenChange?.(true); }
    setActiveIndex(clampIndex(index));
    setOpen(true);
  };

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    onOpenChange?.(false);
    if (focusTrigger) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectOption = (option: CustomSelectOption) => {
    onChange(option.value);
    closeMenu(true);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (searchable && document.activeElement === triggerRef.current) searchRef.current?.focus();
      else if (!searchable || document.activeElement !== searchRef.current) optionRefs.current[activeIndex]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, open, searchable, triggerRef]);

  useEffect(() => {
    if (open && searchable && document.activeElement === document.body) searchRef.current?.focus();
  }, [open, searchable, feedback, options.length]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        data-autofocus={dataAutofocus ? "true" : undefined}
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
          {selectedOption?.icon}
          <span className="truncate">{selectedOption?.label || selectedOptionLabel || stringValue || "Nicht verfügbar"}</span>
          {selectedOption?.current && <CircleDot size={13} className="shrink-0 text-emerald-500" aria-label="Aktueller Sprint" />}
          {selectedOption?.locked && <Lock size={13} className="shrink-0 text-slate-400" aria-label="Geschützter Sprint" />}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          data-custom-control-popover
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeMenu(true);
              return;
            }
            if (event.target instanceof HTMLElement && event.target.closest("[data-select-feedback]")) return;
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
          style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.triggerWidth }}
          className={`fixed z-[120] max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-900/10 ${menuClassName}`}
        >
          {search && <div className="sticky top-0 bg-white p-1">
            <input ref={searchRef} type="search" aria-label={search.label} value={search.value} onChange={event => { setActiveIndex(0); search.onChange(event.target.value); }}
              onKeyDown={event => {
                if (event.key === "Escape") return;
                event.stopPropagation();
                if (event.key === "Enter") { event.preventDefault(); search.onSubmit(); }
                if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex(0); optionRefs.current[0]?.focus(); }
              }} className="min-h-11 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </div>}
          <div id={id} role="listbox" aria-activedescendant={activeOptionId}>
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
                  {option.icon}
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.current && <CircleDot size={13} className="shrink-0 text-emerald-500" aria-label="Aktueller Sprint" />}
                  {option.locked && <Lock size={13} className="shrink-0 text-slate-400" aria-label="Geschützter Sprint" />}
                </span>
                {selected && <Check size={14} className="shrink-0" />}
              </button>
            );
          })}
          </div>
          {feedback && <div data-select-feedback>{feedback}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
